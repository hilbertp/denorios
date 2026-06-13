# Per-Slice Tracking — Architecture Brief for Implementation

**From:** Dax (Architect)
**To:** O'Brien (Implementor)
**Date:** 2026-04-12
**Scope:** Bet 3 — Per-slice token, time, and human hours tracking

---

## Why this exists

O'Brien will be commissioning you to implement per-slice tracking. This file gives you the architecture context so you can build from intent, not just spec. Full ADR: `docs/architecture/BET3-PER-SLICE-TRACKING.md`. Read that before starting.

---

## What you're being asked to build

Six changes to the watcher and bridge infrastructure. All are in `bridge/watcher.js` and `bridge/bridge.config.json`, plus a new `bridge/slicelog.jsonl` file.

---

## The six changes — context for each

### 1. Config fix: add `--output-format json` to `claudeArgs`

`bridge/bridge.config.json` currently invokes Claude without `--output-format json`. That's why `extractTokenUsage()` returns null for every commission — it's parsing stream output, not JSON. Add the flag. **Verify that the existing stdout parsing in `invokeOBrien` still works correctly after the change** — this is the one risk worth checking before merge.

### 2. Update the DONE report template in the commission prompt

The prompt you receive via `invokeOBrien` injects a DONE report template. Add these five required fields to the frontmatter section of that template:

```yaml
tokens_in: 0
tokens_out: 0
elapsed_ms: 0
estimated_human_hours: 0.0
compaction_occurred: false
```

You (O'Brien) fill these in on every DONE report going forward. `elapsed_ms` is wall-clock time from when you picked up the commission to when you write DONE. `estimated_human_hours` is your honest judgment of how long a skilled human developer would take for the equivalent work. `compaction_occurred` is true if your context window filled and compacted mid-session (weight your hours estimate higher in that case).

### 3. Metrics validation gate in the DONE handler (~line 572)

After the watcher confirms the DONE file exists, parse its frontmatter and validate:
- `tokens_in` is a non-negative integer
- `tokens_out` is a non-negative integer
- `elapsed_ms` is a positive integer
- `estimated_human_hours` is a positive number
- `compaction_occurred` is a boolean

If any field is missing or malformed: write an ERROR file with `reason: "incomplete_metrics"`, do not proceed to evaluation. Log the validation failure. This is intentional — silent omission is the failure mode we're fixing.

### 4. Extract `appendSliceLog(entry)` as a reusable function

Write a small function (in `watcher.js` or a new `bridge/slicelog.js`) that appends a JSON line to `bridge/slicelog.jsonl`. Takes an entry object, stringifies, appends. Reused at both write points and later by the Ruflo runner.

### 5. Write Point 1 — append row at DONE

Immediately after validation passes, call `appendSliceLog()` with:

```json
{
  "id": "{commission id}",
  "title": "{commission title}",
  "runtime": "legacy",
  "tokens_in": {from DONE frontmatter},
  "tokens_out": {from DONE frontmatter},
  "cost_usd": {computed via computeCost()},
  "elapsed_ms": {from DONE frontmatter},
  "estimated_human_hours": {from DONE frontmatter},
  "compaction_occurred": {from DONE frontmatter},
  "estimated_by": "obrien",
  "expected_human_hours": {from commission frontmatter, nullable},
  "result": null,
  "cycle": null,
  "ts_pickup": {ISO string from pickupTime},
  "ts_done": {new Date().toISOString()},
  "ts_result": null
}
```

### 6. Write Point 2 — update row at terminal state

In `handleAccepted`, `handleStuck`, and the error closure paths, after the terminal event:
- Read `slicelog.jsonl`
- Find the entry by `id`
- Update: `result` ("ACCEPTED" | "STUCK" | "ERROR"), `cycle`, `ts_result`
- Write back (full file rewrite is fine — file is small)

If the entry doesn't exist (watcher restarted mid-flight), create it with available data and `"recovered": true`.

### 7. README update (same PR)

Add two missing entries to the project structure section in `README.md`:
- `bridge/staged/` — staging area for Philipp's commission review (Rubicon)
- `bridge/register.jsonl` — append-only event log

---

## What NOT to worry about

- Dashboard visualization of slicelog — later commission
- Ruflo runner implementation — not your problem until Ruflo is initialized; you just need the `appendSliceLog` function to exist so it can be called from the Ruflo path
- `timesheet.jsonl` — leave it alone

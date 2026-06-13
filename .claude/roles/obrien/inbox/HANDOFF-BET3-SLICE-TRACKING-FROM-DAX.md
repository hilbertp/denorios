# Per-Slice Tracking — Architecture Brief for Implementation

**From:** Dax (Architect)
**To:** O'Brien (Implementor)
**Date:** 2026-04-12T01:22:40Z
**Scope:** Bet 3 — Per-slice token, time, and human hours tracking

---

## Why this exists

O'Brien will be commissioning you to implement per-slice tracking. This file gives you the architecture context so you can build from intent, not just spec. Full ADR: `docs/architecture/BET3-PER-SLICE-TRACKING.md`. Read that before starting.

---

## What you're being asked to build

Eight changes across `bridge/orchestrator.js`, `bridge/bridge.config.json`, `bridge/slicelog.js` (new), and `README.md`.

---

## The eight changes — context for each

### 1. Config fix: add `--output-format json`

`bridge/bridge.config.json` currently invokes Claude without `--output-format json`. That's why `extractTokenUsage()` returns null on every commission. Add the flag:

```json
"claudeArgs": ["-p", "--permission-mode", "bypassPermissions", "--output-format", "json"]
```

Verify the existing stdout parsing in `invokeOBrien` still works after the change before merging.

### 2. Update DONE report template

The commission prompt injects a DONE report template. Add these five required fields to its frontmatter section:

```yaml
tokens_in: 0
tokens_out: 0
elapsed_ms: 0
estimated_human_hours: 0.0
compaction_occurred: false
```

You fill all five on every DONE report going forward. `elapsed_ms` is wall-clock ms from pickup to DONE. `estimated_human_hours` is your judgment of how long a skilled human developer would take. `compaction_occurred: true` if your context window compacted mid-session — weight your hours estimate higher in that case.

### 3. Metrics validation gate (~line 572 in DONE handler)

After confirming the DONE file exists, parse its frontmatter and validate:
- `tokens_in` — non-negative integer
- `tokens_out` — non-negative integer
- `elapsed_ms` — positive integer
- `estimated_human_hours` — positive number
- `compaction_occurred` — boolean

If any field is missing or malformed: write ERROR with `reason: "incomplete_metrics"`, do not proceed to evaluation. Log the failure. This is intentional — silent omission is the failure mode we're fixing.

### 4. Extract `appendTimesheet(entry)` in `bridge/slicelog.js`

New file. One function: takes an entry object, appends as a JSON line to `bridge/timesheet.jsonl`. Called at both write points and later by the Ruflo runner. Keep it small — just the append logic.

### 5. Write Point 1 — append row at DONE

Immediately after validation passes, call `appendTimesheet()` with:

```json
{
  "source": "watcher",
  "ts": "<new Date().toISOString()>",
  "id": "<commission id>",
  "title": "<commission title>",
  "runtime": "legacy",
  "tokens_in": "<from DONE frontmatter>",
  "tokens_out": "<from DONE frontmatter>",
  "cost_usd": "<computeCost(tokens_in, tokens_out)>",
  "elapsed_ms": "<from DONE frontmatter>",
  "estimated_human_hours": "<from DONE frontmatter>",
  "compaction_occurred": "<from DONE frontmatter>",
  "estimated_by": "obrien",
  "expected_human_hours": "<from commission frontmatter, null if absent>",
  "result": null,
  "cycle": null,
  "ts_pickup": "<new Date(pickupTime).toISOString()>",
  "ts_done": "<new Date().toISOString()>",
  "ts_result": null
}
```

### 6. Write Point 2 — update row at terminal state

In `handleAccepted`, `handleStuck`, and error closure paths:
- Read `timesheet.jsonl`, find the entry where `source === "watcher"` and `id === commissionId`
- Update: `result` ("ACCEPTED" | "STUCK" | "ERROR"), `cycle`, `ts_result`, `ts`
- Write back (full file rewrite is fine — file is small)

If the entry doesn't exist (watcher restarted mid-flight): create it with available data and `"recovered": true`.

### 7. Timestamp audit — datetime everywhere, never date-only

All `ts_*` fields and the `ts` field must use `new Date().toISOString()` — this produces a full ISO 8601 UTC datetime string (e.g. `"2026-04-12T01:22:40.000Z"`). **Never use date-only strings** (`"2026-04-12"`).

Also audit the commission frontmatter template (`created` field) and DONE report template (`completed` field) — both must use full datetime, not date-only. Fix if they don't.

### 8. README update — same PR

Add to the project structure section in `README.md`:
- `bridge/staged/` — staging area for Philipp's commission review (Rubicon)
- `bridge/register.jsonl` — append-only event log

---

## What NOT to worry about

- Dashboard visualization of timesheet data — later commission
- Ruflo runner implementation — just make `appendTimesheet()` importable from `bridge/slicelog.js`
- Existing manual `timesheet.jsonl` entries — leave them; `source: "watcher"` distinguishes new rows

# Bet 3 — Per-Slice Tracking Architecture

**Author:** Dax (Architect)
**Date:** 2026-04-12
**Status:** Final — for O'Brien implementation
**Scope:** Bet 3 prerequisite — token, time, and human hours tracking per commission
**Responds to:** `roles/dax/HANDOFF-PER-SLICE-TRACKING-FROM-OBRIEN.md`

---

## 0. Executive Summary

The current timesheet has 5 entries ever, most roles have zero, and the watcher captures null tokens on every commission. This is not a discipline problem — the architecture made logging optional and the token extraction was never wired correctly. This document fixes both at the structural level.

The solution has four parts: fix the root cause of null tokens (one config line), add structured metrics fields to the DONE report format, make the watcher enforce those fields as a hard gate, and append a per-commission record to `bridge/timesheet.jsonl` automatically. No role needs to remember anything. If metrics are missing, the pipeline stalls visibly.

> **Note (commission 057):** `bridge/slicelog.jsonl` has been retired. All watcher entries now write to the unified `bridge/timesheet.jsonl` alongside manual role entries, using `source: "watcher"` to distinguish them. References to `slicelog.jsonl` below are historical.

---

## 1. Root Cause — Why Tokens Are Currently Null

`bridge/bridge.config.json` invokes Claude as:

```json
"claudeArgs": ["-p", "--permission-mode", "bypassPermissions"]
```

`extractTokenUsage()` in the watcher parses token data from the JSON output of `claude -p`. But `--output-format json` is missing from the args. Claude is running in streaming text mode, not JSON mode. The function never gets structured data. Every DONE event in `register.jsonl` since at least commission 051 shows `tokensIn: null`.

**Fix:** add `"--output-format", "json"` to `claudeArgs`.

```json
"claudeArgs": ["-p", "--permission-mode", "bypassPermissions", "--output-format", "json"]
```

This is a one-line config change. O'Brien must verify the output format hasn't changed in ways that break other stdout parsing in `invokeOBrien` before merging, but there is no architectural risk — the extractors are already written, they just need the right input.

> **Risk classification: Acceptable.** Known solution path, standard config fix, verify during implementation.

---

## 2. Human Hours Estimation — O'Brien, Intra-Slice

O'Brien is the only role that lives the full inference: the dead ends, the complexity, the decisions made mid-session. O'Brien sees brief and result. Anon sees ACs and DONE report. O'Brien is the right estimator.

O'Brien writes five structured fields to every DONE report frontmatter:

| Field | Type | Description |
|---|---|---|
| `tokens_in` | integer | Input tokens consumed this session |
| `tokens_out` | integer | Output tokens generated this session |
| `elapsed_ms` | integer | Wall-clock ms from commission pickup to DONE |
| `estimated_human_hours` | float | Judgment: how long a skilled human developer would take |
| `compaction_occurred` | boolean | True if context window filled and compacted mid-session |

`compaction_occurred: true` is an estimation-influencing event — a compaction signals the work was complex enough to exhaust a context window. O'Brien should weight `estimated_human_hours` higher when this is true.

O'Brien may optionally add `expected_human_hours` to commission frontmatter as a pre-estimate. Over time, the delta between O'Brien's expected and O'Brien's actual reveals scope accuracy.

**Enforcement:** the watcher validates all five fields exist after reading the DONE file. If any field is missing or non-numeric (for the numeric ones), the commission is written as `ERROR` with reason `incomplete_metrics` and does not proceed to evaluation. The DONE report template in the commission prompt must list these fields as required.

---

## 3. Data Schema — Watcher entries in `bridge/timesheet.jsonl`

One JSON line per completed commission, appended to the unified `bridge/timesheet.jsonl`. Watcher entries use `source: "watcher"` and coexist with manual role entries (`source: "manual"`).

```json
{
  "id": "054",
  "title": "...",
  "runtime": "legacy",
  "tokens_in": 14200,
  "tokens_out": 3800,
  "cost_usd": 0.054,
  "elapsed_ms": 187000,
  "estimated_human_hours": 2.0,
  "compaction_occurred": false,
  "estimated_by": "obrien",
  "expected_human_hours": null,
  "result": "ACCEPTED",
  "cycle": 1,
  "ts_pickup": "2026-04-12T10:00:00.000Z",
  "ts_done": "2026-04-12T10:03:07.000Z",
  "ts_result": "2026-04-12T10:05:22.000Z"
}
```

**Field notes:**

- `runtime` — `"legacy"` or `"ruflo"`. Set by the watcher, not self-reported by O'Brien.
- `tokens_in`, `tokens_out` — sourced from O'Brien's DONE frontmatter (primary). The watcher's stdout extraction (`extractTokenUsage`) is the secondary path once the config fix above is in — but DONE frontmatter is the enforced gate and is always present before the watcher reads it.
- `cost_usd` — computed by the watcher via the existing `computeCost()` function. Not self-reported.
- `result` — `null` when the row is first created (at DONE), updated to `"ACCEPTED"`, `"STUCK"`, or `"ERROR"` when the terminal event fires.
- `cycle` — how many evaluation cycles ran. 1 = accepted on first try. Updated at terminal state.
- `estimated_by` — always `"obrien"` for watcher-processed commissions. Reserved for future manual override.

---

## 4. Watcher Integration — Two Write Points

Both write points use `fs.appendFileSync` / read-modify-write at path `bridge/timesheet.jsonl`. Safe because the watcher is single-threaded and processes one commission at a time.

### Write Point 1 — DONE Handler (inside `invokeOBrien`, ~line 572)

After the watcher confirms the DONE file exists:

1. Parse DONE frontmatter.
2. **Validate** required fields: `tokens_in`, `tokens_out`, `elapsed_ms`, `estimated_human_hours`, `compaction_occurred`. If any missing or malformed → write ERROR with reason `incomplete_metrics`, do not proceed to evaluation.
3. Read commission frontmatter for `expected_human_hours` (nullable, default null).
4. Compute `cost_usd` via `computeCost(tokens_in, tokens_out)`.
5. Append new timesheet entry with `result: null`, `cycle: null`, `ts_result: null`.

### Write Point 2 — Terminal State Handlers

In `handleAccepted`, `handleStuck`, and the error closure paths:

1. Read `timesheet.jsonl`, find the watcher entry by `commission_id` (where `source === "watcher"`).
2. Update: `result`, `cycle`, `ts_result`.
3. Write back (full file rewrite or line replacement — file will be small, full rewrite is fine).

If the entry doesn't exist (watcher restarted between DONE and terminal), create it from available data with `estimated_human_hours: null` and a note field `"recovered": true`.

---

## 5. Ruflo Parallel Tracking

Ruflo doesn't exist in the repo yet. When it's built, the `bet3/ruflo` branch introduces a `bridge/ruflo-runner.js` that:

- Accepts the same commission format
- Produces the same five DONE frontmatter metrics fields
- Calls a shared `appendTimesheet(entry)` utility function (in `bridge/slicelog.js`)

The watcher's poll loop gets a config flag `"runtime": "legacy"` (default) in `bridge.config.json`. The Ruflo runner sets `"runtime": "ruflo"`. The `runtime` field in every timesheet row distinguishes the two. The comparison query reads both paths from the same file.

**Ruflo token accounting:** Ruflo may route sub-tasks to multiple models within a single commission. Aggregate per-slice is sufficient for the Bet 3 comparison — we're comparing total cost and time, not per-model breakdown. An optional `model_breakdown` array field is reserved in the schema but not required.

---

## 6. Fork/Branch Strategy — `bet3/ruflo` off Main

**Recommendation: feature branch, not a GitHub fork.**

The experiment compares runtimes on identical commissions. A fork diverges structurally, requiring constant schema sync. A branch in the same repo shares `timesheet.jsonl`, the commission format, the queue lifecycle, and the schema. When the experiment concludes: merge the Ruflo runner (if it wins), or delete the branch (if legacy wins).

To run both in parallel: two terminal sessions, each in the same repo checkout, one running `watcher.js` with `"runtime": "legacy"` config, one running `ruflo-runner.js` with `"runtime": "ruflo"` config. Both append to the same `timesheet.jsonl`. The `runtime` field keeps the rows distinguishable.

---

## 7. README Status

The `README.md` is usable for a first-time contributor but is missing two structural elements that now exist:

1. **`bridge/staged/`** — the staging area for Philipp's commission review flow (Rubicon). Not listed in the project structure.
2. **`bridge/register.jsonl`** — the append-only event log that the watcher and evaluator both read. Not listed anywhere in the README.

These omissions won't break a clone-and-run, but they will confuse anyone trying to understand the pipeline from the README. O'Brien should update the project structure section as part of this commission.

---

## 8. Implementation Checklist for O'Brien

- [ ] Add `"--output-format", "json"` to `claudeArgs` in `bridge.config.json`. Verify stdout parsing still works.
- [ ] Update DONE report template (injected in commission prompt) to require the five metrics fields.
- [ ] Add metrics validation in the DONE handler. Missing fields → `ERROR` with reason `incomplete_metrics`.
- [ ] Extract `appendTimesheet(entry)` as a standalone function (in `bridge/slicelog.js`).
- [ ] Write Point 1: append timesheet entry at DONE.
- [ ] Write Point 2: update timesheet entry at terminal state (ACCEPTED, STUCK, ERROR).
- [ ] Update `README.md` project structure section: add `bridge/staged/` and `bridge/register.jsonl`.

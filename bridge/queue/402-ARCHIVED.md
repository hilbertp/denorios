---
id: "402"
title: "History cost includes Jordan: his tokens and cost are recorded per review"
from: rom
to: nog
status: DONE
slice_id: "402"
branch: "slice/402"
completed: "2026-09-24T19:52:00.000Z"
tokens_in: 92
tokens_out: 56651
elapsed_ms: 698557
estimated_human_hours: 3.0
compaction_occurred: false
tokens_cache_read: 4638435
cost_usd: 5.222731499999999
---

## Summary

Jordan's session always ended with a `result` event carrying what the review cost — `nog-399-round1.log`
says $1.7242135, against Sam's $1.0700555 for the same slice — and nothing read it. The orchestrator now
reads it once per round and spreads it onto whatever event the verdict ends on; `/api/bridge` fills each
review stage from its own NOG_DECISION; the History row sums both sessions. For a 399-shaped register the
COST cell reads **$2.79** with no "partial" mark.

Julian left the `missing` list. His suite is not a metered session the orchestrator can read a bill from,
so his absent numbers were not late data — they were a mark that could never clear. His stage still shows
its minutes; it just owes no money.

Nothing is estimated on Jordan's path. `reviewTelemetry` is deliberately **not** `sessionTelemetry`: where
Sam's reader falls back to `computeCost`, Jordan's writes nothing at all. A killed, timed-out or
rate-limited review records no token and no cost, and no key is written for it.

One thing to flag, not a scope change: **ESCALATE and OVERSIZED write no NOG_DECISION at all** — that path
emits `ESCALATED_TO_OBRIEN` and renames to STUCK. slice-402-ac-1 names those two verdicts, so I put the
numbers on the event that round actually ends on rather than inventing a new NOG_DECISION, which would
change what a "decision" means to every register consumer (`hasTerminalLandedEvent`, `countUnreadableVerdicts`,
the stale-DONE sweep). If O'Brien wants an escalated round to appear as a priced review stage in History,
that is a follow-up: the History row reads NOG_DECISION only, so an escalated slice still shows no review
cost even now.

The daemon and the dashboard both need a restart before any of this is live
(`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`, and the dashboard server plus a hard
reload of the tab). Nothing is back-filled: slices that finished before this lands keep their partial rows.

## What changed

- `bridge/orchestrator.js` — new `reviewTelemetry(stdout)` beside `sessionTelemetry`: reads `total_cost_usd`
  and `usage` off Jordan's own `result` event and returns an object to spread, `{}` when the session wrote
  no result. It requires `type === 'result'`, because `extractResultObject` falls back to the last JSON
  object on the stream and on a killed session that is an assistant message carrying one turn's usage.
  `invokeNog`'s exit handler calls it once (`const reviewUsage = ...`) and spreads it onto every event a
  round can end on: the unreadable-verdict NOG_DECISION, `rejectedDecision`, `acceptedDecision` (via a new
  eighth argument to `handleAccepted`), and `ESCALATED_TO_OBRIEN`. Exported for the safety net.
- `dashboard/server.js` — `stagesForSlice`: each review stage's `tokens` and `costUsd` now come from its
  round's NOG_DECISION (`stageTokens(dec)` / `stageNum(dec.costUsd)`), so cache reads are counted the same
  way Sam's are. `missing` no longer pushes the QA role; `STAGE_ROLE_QA` is gone with it (it had no other
  reference). The QA stage stays inside the summed `all` list, so if his numbers are ever recorded they
  count — he is only absent from "who owes a number".
- `dashboard/lcars-dashboard.html` — the `Review · Jordan` line already rendered `v.tokens` and `v.costUsd`
  through `fmtTokens`/`fmtStageCost`; slice 401 shipped it that way and the server fed it nulls. No logic
  change was needed for slice-402-ac-7 and I did not invent one. What I changed is the comment above that
  line, which said the values are never there — it now says when the em dashes are real.
- `regression/observability/j-history-cost-includes-jordan.test.js` — new, 8 tests (7 criteria + 1 trap).
- `regression/observability/j-history-tells-the-truth.test.js` — two assertions retargeted; see
  **Tests moved or weakened**.

No `e2e/` file was touched.

## Acceptance criteria verification

Command for every row: `node --test regression/observability/j-history-cost-includes-jordan.test.js` — 8/8 pass.

| Criterion | Test file | Result |
|---|---|---|
| slice-402-ac-1 | `regression/observability/j-history-cost-includes-jordan.test.js` | PASS — `reviewTelemetry` on the real 399 result returns exactly `{tokensIn: 34, tokensOut: 17732, tokensCacheRead: 1045779, costUsd: 1.7242135}`, `costUsd` **is** `total_cost_usd`; one call site; ACCEPTED, REJECTED, unreadable and the ESCALATE/OVERSIZED event each carry it |
| slice-402-ac-2 | same | PASS — killed, rate-limited, empty, `undefined` and non-JSON output each return `{}`; zero keys, so not even nulls; spread onto a decision it leaves the event byte-identical |
| slice-402-ac-3 | same | PASS — 399-shaped fixture: `totals.tokens` = 540,188 + 1,063,545, `totals.costUsd` = 1.0700555 + 1.7242135, `missing` = `[]`, and the rendered row's COST cell reads `$2.79` with no "partial" anywhere on it |
| slice-402-ac-4 | same | PASS — two fixtures with an unpriced QA stage, neither names Julian; no row in the payload does; the cost cell never explains itself by naming him; `missing.push(STAGE_ROLE_QA)` is gone from the source |
| slice-402-ac-5 | same | PASS — two builds and two reviews: `totals.tokens` = 2,105, `totals.costUsd` = $1.50, each round's review line shows its own $0.25 / $0.50 |
| slice-402-ac-6 | same | PASS — a review with no numbers keeps `costUsd: null` (asserted `!== 0`), `missing` = `['Jordan']`, the row reads `$1.07 partial`, the tooltip names Jordan and not Julian, and nothing is estimated |
| slice-402-ac-7 | same | PASS — the `Review · Jordan` line reads `1.1M` / `$1.72`; for the unrecorded review both are `—` (asserted not `$0.00`) while its 3m 38s stays |
| Trap 1 | same | PASS — `sessionTelemetry` still returns slice 383's pinned five numbers and still estimates via `computeCost` when a session carries no `total_cost_usd`; `reviewTelemetry` on that same output records the tokens and no cost; its body mentions neither `computeCost` nor a price constant nor `sessionTelemetry` |

## Safety-net tests

`regression/observability/j-history-cost-includes-jordan.test.js` — 8 tests: one per criterion plus one for
the brief's single trap. It joins the same two sides slice 401 joined: the orchestrator required directly,
and the server over a real HTTP `/api/bridge` against a fixture register in `os.tmpdir()` (live `bridge/*`
is never touched) with the page's own `historyStagesHtml`/`fmtStageCost`/`fmtTokens` lifted out of the
shipped HTML — so the two halves cannot drift apart while both stay green. The fixture numbers are slice
399's real pair of sessions.

**Break check (fix stashed, test file kept):** all 8 went red, each for its own reason —

| Test | Red because |
|---|---|
| slice-402-ac-1 | `TypeError: reviewTelemetry is not a function` |
| slice-402-ac-2 | `TypeError: reviewTelemetry is not a function` |
| slice-402-ac-3 | `Jordan's review carries his own tokens: null !== 1063545` |
| slice-402-ac-4 | `slice 399 must not name Julian among the missing` |
| slice-402-ac-5 | review tokens `null` where `60` was expected |
| slice-402-ac-6 | `Jordan is named; nobody else is` (the list was `['Jordan','Julian']`) |
| slice-402-ac-7 | `the review line shows Jordan's own tokens` — the line drew `—` |
| Trap 1 | `TypeError: reviewTelemetry is not a function` |

The fix was restored from the stash and both files re-run green (8/8 and 10/10). The stash was pushed with a
unique tag, applied by SHA and dropped by tag, so no other session's entry was touched.

I did **not** open a browser. The live dashboard runs the code it was started with, and restarting the
operator's server from a worktree is not mine to do; the page's renderer was exercised instead through the
functions lifted from the shipped `lcars-dashboard.html`, which is the closest honest thing available here.

I also ran the one existing file I edited (`j-history-tells-the-truth.test.js`, 10/10) to confirm my edit to
it is correct. No other test file was run; no suite was run.

## Screen hooks

The brief pre-named the COST cell for slice-402-ac-3 and slice-402-ac-6 and I used those names. I declare
the rest, all of them already shipped by slice 401 — no new test-id scheme.

| Hook | What it is | Starting state |
|---|---|---|
| `div.history-row[data-history-id="<id>"] .col-cost` | the row's COST cell | always drawn; `$2.79` when everything is recorded, `$1.07 partial` when a role is not |
| `span.cost-partial` inside that cell | the partial marker; its `title` names the missing roles | present only when `totals.missing` is non-empty — absent on a fully recorded row, and it never contains "Julian" |
| `#history-expand-<id>` | the expanded pane holding the stage lines | in the DOM always; has class `open` only when expanded. Toggled by `#history-chevron-<id>` |
| `div.history-stage-line[data-stage="review-1"]` | the `Review · Jordan` line for round 1 (`review-2`, … for later rounds) | drawn for every round that has a review |
| `.history-stage-role` in that line | the label, plus `span.history-stage-verdict` with the verdict | always |
| `.history-stage-time` / `.history-stage-tokens` / `.history-stage-cost` in that line | this review's minutes, tokens and cost | always; tokens and cost read `—` when that review recorded none, never `$0.00` |
| `div.history-stage-line[data-stage="total"]` | the `Sam start → landed on dev` line | always; its cost carries the same partial marker as the row cell |

## Tests moved or weakened

Two assertions in `regression/observability/j-history-tells-the-truth.test.js` (slice 401) pinned the
behaviour slice-402-ac-4 replaces. Both stay strict — nothing was deleted, skipped or relaxed:

1. **slice-401-ac-3** — `assert.deepEqual(rowOf('399').stages.totals.missing, ['Jordan', 'Julian'])` is now
   `['Jordan']`. Why: slice-402-ac-4 says Julian never appears among the missing roles. The comment above it
   records why and points at the new file.
2. **slice-401-ac-4** — `assert.match(title, /Julian/, 'the partial marker names Julian')` is now
   `assert.doesNotMatch(title, /Julian/, …)`. Why: same criterion, and the inverted form keeps the test
   guarding the tooltip rather than dropping the check. The neighbouring `assert.match(title, /Jordan/)` is
   untouched, as is `'$1.07 partial'` (Jordan is genuinely unrecorded in that fixture).
   One assertion message in the same test — "marked partial because two roles recorded nothing" — now says
   "because Jordan recorded nothing", so the prose matches what it asserts.

No slice-401 acceptance criterion text was changed; only the two expectations that slice 402 supersedes.
This is the list Nog signs as the second signature. The commit carries
`Test-Loosen-OK: slice-401-ac-3 reworded …` and `Test-Loosen-OK: slice-401-ac-4 reworded …`.

## Commit

Branch `slice/402`, cut from `11cd305` (dev). One commit, `S402: …`, carrying the seven `AC:` trailers
verbatim, the two `Test-Loosen-OK:` trailers above, and `Slice-Id` / `Slice-Branch` / `Lane: core`.
Files: `bridge/orchestrator.js`, `dashboard/server.js`, `dashboard/lcars-dashboard.html`,
`regression/observability/j-history-cost-includes-jordan.test.js` (new),
`regression/observability/j-history-tells-the-truth.test.js`, and this report (`git add -f`).
No lock file was regenerated and no `e2e/` file was touched.

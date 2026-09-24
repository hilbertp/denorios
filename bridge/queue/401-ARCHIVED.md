---
id: "401"
title: "History tells the truth: time per role, working time from Sam's start to landing, honest tokens and cost"
from: rom
to: nog
status: DONE
slice_id: "401"
branch: "slice/401"
completed: "2026-09-24T01:18:00.000Z"
tokens_in: 70
tokens_out: 29363
elapsed_ms: 349527
estimated_human_hours: 0.75
compaction_occurred: false
tokens_cache_read: 2380969
cost_usd: 2.7447334999999993
---

# Amendment round 1 — rounds are numbered by the round each event names

## Summary

Nog's one finding is fixed. `rounds` was composed positionally — `reviews[i]` became round
`i + 1` — so a re-invoked review invented a round that never happened. Slice 401's own live
register reproduced it: two `NOG_INVOKED round=1` (the first review never finished) against one
`DONE` produced `rounds.length = 2`, and the expanded row would have printed
`Build · Sam · round 2   —   —   —`.

The round number now comes from the `NOG_INVOKED`'s own `round` field, as Task 1 names it.
Repeated invocations of one round fold into a single review stage, and the array is sized by the
highest round anyone reached rather than by how many invocations were written.

Fixing the identity exposed a second, quieter lie in the same events: the old cursor let an
**abandoned** invocation claim the verdict that followed its replacement. On slice 401 that read
Jordan's review as 21m 43s (00:37:42 → 00:59:25) when he reviewed for 6m 59s (00:52:25 → 00:59:25).
A decision now closes the latest invocation before it, so the review that is reported is the run
that reached the verdict.

Verified on the live register, not only on the fixture, by lifting the shipped `buildStagesById`
through the real `lifecycle-translate` shim:

| Slice | Before | After |
|---|---|---|
| 401 | 2 rounds; review 1303178 ms | 1 round; review 419962 ms (6m 59s) REJECTED |
| 163 | round 1, build null | round 2, build null — the round it actually was |
| 399 | build 143982 / review 218853 ACCEPTED / qa 569327 / queued 1714 / elapsed 373572 | unchanged |
| 400 | elapsed 1025424 (17m 05s) | unchanged |

**A `server.js` change goes live only after the dashboard restarts.** Until then the page receives
rows with no `stages` and the three cells read `—`; the renderer guards for it. Restart the server
and hard-reload the tab.

Nog's five flags for O'Brien and three for Julian's stage are left where he put them — `approvedAt`
under-reporting the queue wait, `totals.missing` being role-level, and the literal role labels are
all spec decisions, not mine to make inside an amendment.

## What changed

- `dashboard/server.js` — `stagesForSlice`, three changes in one place:
  - new `roundOf(ev, i)` reads the event's `round` field, falling back to position only when the
    field is absent or not a round number (the auto-accepted merge writes `round: 0`);
  - the invocation→decision cursor now refuses a decision that falls at or after the *next*
    invocation, so an abandoned run cannot claim its successor's verdict;
  - `reviewByRound` folds repeated invocations of one round into one review stage (the run that
    reached a verdict wins; an unfinished run is kept only while nothing closed that round), the
    loop is sized by `max(dones.length, highest round seen)`, and a round with neither a build nor
    a review is dropped instead of drawn as an empty line.
- `dashboard/lcars-dashboard.html` — one line in `historyStagesHtml`: the `· round N` label now
  also appears when the *only* round is not round 1. Slice 163's lone round-2 review was otherwise
  drawn as if it were the first round — the display half of the same defect.
- `regression/observability/j-history-tells-the-truth.test.js` — fixture slice **913**, slice 401's
  own live shape (one `DONE`, two `NOG_INVOKED round=1`, one `NOG_DECISION`), and the assertions
  for it inside the existing `slice-401-ac-7` test. No new test: the lane target is 10 and this is
  the other side of the criterion already under test, not a criterion of its own.

No `e2e/` file touched. No `bridge/orchestrator.js` change.

## Acceptance criteria verification

All seven still pass, on the same command: `node --test regression/observability/j-history-tells-the-truth.test.js` → **10 tests, 10 pass, 0 fail**.

| Tag | Test file | Result |
|---|---|---|
| slice-401-ac-1 | `regression/observability/j-history-tells-the-truth.test.js` | pass — every row carries `stages`; `durationMs`/`tokensIn`/`tokensOut`/`costUsd` untouched |
| slice-401-ac-2 | same | pass — the 399 fixture still reports 143982 / 218853 accepted / 569327 / 1714 / 373572, and the **live** register agrees to the millisecond |
| slice-401-ac-3 | same | pass — missing is `null`, never 0 or negative; `missing` names the roles |
| slice-401-ac-4 | same | pass — `6m 13s`, `540k`, `$1.07 partial` |
| slice-401-ac-5 | same | pass — build / review / qa / queued / total, `—` where nothing was recorded |
| slice-401-ac-6 | same | pass — each top-level name declared once (239 declarations, zero duplicates) |
| slice-401-ac-7 | same | pass — **extended this round**: 910 still shows two rounds with summed totals, and 913 (two invocations of round 1) shows **one** round, timed from the run that reached the verdict |

Trap 1's owner, `regression/observability/j-inspect-slice-history.test.js`, is unmodified and green.
The two files Task 4 touched are green. All three together: **29 tests, 29 pass**.

## Safety-net tests

Ten tests, unchanged in count — seven criterion tests plus three trap tests. This round added
assertions to the existing `slice-401-ac-7` test rather than an eleventh test.

**Break-it check for this round's fix.** I copied the fixed `server.js` and `lcars-dashboard.html`
aside, checked out the round-1 versions from `HEAD`, and ran the new test file against them
(no `git stash` — the stash stack is shared with the other worktrees):

- `slice-401-ac-7` → **RED**: `one build and one decided round is one round, not two — 2 !== 1`.
  That is Nog's finding, caught by the test.
- The other nine stayed green, correctly: round-1 code was already right about everything else,
  and Nog verified all ten red against `main` last round.

Files restored, all ten green again, and the live-register probe re-run after the restore to
confirm the shipped files are the fixed ones.

**What I saw without a browser.** The dashboard has not been restarted, so I checked the live data
the way Nog did instead of clicking: the shipped `buildStagesById`, lifted out of `dashboard/server.js`
and run over `bridge/register.jsonl` through the real `lifecycle-translate` shim. Slice 401 returns
one round with a 6m 59s REJECTED review; slice 163 returns its round 2; slices 399 and 400 return
the brief's table unchanged.

## Screen hooks

Unchanged from round 1 — no hook was added, removed or renamed. The two the brief left to me:

- **slice-401-ac-4** (the row's cells) — `[data-history-id="<id>"]`, and within it `.col-duration`,
  `.col-tokens`, `.col-cost`; `.cost-partial` wraps the cost when a role's numbers are missing
  (visible whenever the row is drawn; `.cost-partial` only when `totals.missing` is non-empty).
- **slice-401-ac-5** (the expanded row) — `#history-expand-<id>` with `#history-chevron-<id>`;
  inside it `.history-stages` holding one `.history-stage-line[data-stage]` per stage, keyed
  `build-<n>`, `review-<n>`, `qa`, `queued`, `total`, each with `.history-stage-role`,
  `.history-stage-time`, `.history-stage-tokens`, `.history-stage-cost`; `.history-stage-verdict`
  inside the review line; `.history-stage-total` on the last line. Visible after the row is clicked.

One note for Julian, from this round's change: `data-stage` keys carry the **real** round number, so
a slice whose earlier rounds predate the register wipe can have `build-2` with no `build-1`. Select
by the key you expect, never by position.

## Tests moved or weakened

None this round. No existing test was moved, renamed, weakened or removed; the only test edit is
additive — a fixture slice and new assertions inside a test that already existed. Round 1's two
`extractFn` lifts in `j-history-chronological-order.test.js` and `j-ten-rows-a-page.test.js` are
unchanged and still green.

## Commit

Branch `slice/401`, on top of round 1's `f12d6db`. The AC trailers are declared on the commit.

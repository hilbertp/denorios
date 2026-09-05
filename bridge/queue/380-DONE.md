---
id: "380"
title: "History must be chronological, and reachable past the first five rows"
from: rom
to: nog
status: DONE
slice_id: "380"
branch: "slice/380"
completed: "2026-09-05T15:05:35.000Z"
tokens_in: 2640000
tokens_out: 34000
elapsed_ms: 848000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

The logbook is ordered by time again, and it says how much of itself it is showing.

**Order.** `renderHistoryPanel` ended on `.sort((a, b) => parseInt(b.id) - parseInt(a.id))`. That is
now `orderHistoryRowsByRecency(classified)`, a comparator that reads each row's terminal timestamp —
the `_terminalTs` the row already carried and the classification step already set — and puts the
newest first. On the log the brief measured, slice 367's 18:02 failure moves from position 8 to
position 1, above 379's 17:24, which is where the second-newest event in the log belongs.

The comparator is a **total** order, deliberately: terminal timestamp desc → slice id desc →
arrival index asc. Nothing is left to the engine's sort, so two renders of the same rows draw the
same list; a row with no parseable terminal timestamp sorts after every dated row instead of riding
a NaN comparison to wherever it lands; and because the last tie-break is arrival index rather than
identity, the function is a **permutation** of its input — it never groups, never dedupes, never
drops. Two entries that share a slice id (a restaged slice, one entry per attempt) come out as two
entries.

**Reach.** Three things were in the way and all three are gone. The page held five rows, which
cannot hold one day's work — it is 25 now, inside a list that already scrolls. The count bar was
drawn only when there was more than one page, so a view of 25-of-200 and a view of all-25 looked
identical; it is now drawn whenever there is anything to count, and reads `showing 1–25 of 200
entries · page 1 of 8`. And the container answered only to `#history-pagination`, which is why the
brief's probe for `.history-pager` came back empty; it now carries that name too.

The ordering key is also written where the operator can read it, which the panel never did: the row
tooltip says `S367 · finished 09-04 21:02`, the expanded row shows the same time next to the
description, and every row carries `data-terminal-ts` for Julian. Without it, a time-ordered list of
slice numbers looks exactly like an unsorted one — which is the reading that produced the id-sort
this slice removes.

**One thing for O'Brien, not acted on.** An amendment is folded into its parent row
(`foldLegacyApendments`), and the folded row is ordered by the *parent's* terminal timestamp, not the
amendment's. So a parent whose amendment finished an hour ago still sorts by its own older time —
the same class of invisibility this slice fixes, one level down. Task 1 says to order by "the
timestamp the row already carries", so I did exactly that and did not invent a folded timestamp.
It is worth a brief if amendments are common enough to matter.

## What changed

- `dashboard/lcars-dashboard.html`
  - `orderHistoryRowsByRecency()` + `historyTerminalTime()` — new, the total order described above.
  - `renderHistoryPanel()` — the id sort is replaced by that call; the classified rows now land in a
    local `classified` before ordering, so the two steps read as two steps.
  - `HISTORY_PAGE_SIZE` 5 → 25.
  - `renderHistoryPage()` — the count bar is unconditional (rows > 0) and states
    `showing A–B of N entries`, adding `· page P of T` only when there is more than one page. The
    newer/older buttons come with it, disabled at the ends.
  - `fmtTerminalTs()` — new; formats the terminal timestamp as `MM-DD HH:MM` in the operator's own
    timezone, or `no terminal timestamp` when there is none.
  - The history row gains `data-terminal-ts`, a `title` on `.history-row-main`, and a
    `.history-expand-ts` span in the expanded area; `.history-pager` is added as a second class on
    the pagination container.
  - Two small CSS rules for `.history-expand-ts` (light + the token override block), matching the
    muted-ink treatment the row metrics already use. No layout, grid or column widths touched.
- `regression/observability/j-history-chronological-order.test.js` — new, 9 tests.
- `regression/COVERAGE.lock` — regenerated with `node scripts/build-coverage-map.js`; the five
  slice-380 tags now map to `dashboard/lcars-dashboard.html`. Not doing this fails the lock's own
  integrity guard.

No `e2e/` file was touched.

## Acceptance criteria verification

Command for every row: `node --test regression/observability/j-history-chronological-order.test.js`
→ **9 tests, 9 pass, 0 fail**.

| criterion | test | result |
|---|---|---|
| slice-380-ac-1 | `slice-380-ac-1 — the logbook is ordered by when each slice finished, newest first, whatever its id` | pass |
| slice-380-ac-2 | `slice-380-ac-2 — every entry is reachable from the panel itself, by turning its pages` | pass |
| slice-380-ac-3 | `slice-380-ac-3 — the panel says how many entries exist, so a page is never mistaken for the log` | pass |
| slice-380-ac-4 | `slice-380-ac-4 — equal or missing timestamps still order the same way on every render` | pass |
| slice-380-ac-5 | `slice-380-ac-5 — a restaged slice keeps one entry per attempt; ordering merges nothing` | pass |
| trap 1 (shared / missing timestamp) | `slice-380-ac-4 trap 1 — a shared or missing timestamp has a defined fallback…` | pass |
| trap 2 (restaged slice, no merge or drop) | `slice-380-ac-5 trap 2 — ordering is a permutation: same rows in, same rows out` | pass |
| trap 3 (outcomes unchanged) | `slice-380-ac-1 trap 3 — what an outcome means, and which pill it wears, is untouched` | pass |
| trap 4 (do not unfold) | `slice-380-ac-2 trap 4 — an amendment is still folded into its parent…` | pass |

ac-1 is checked twice over: the exact six-row order from the brief's measured table, and the
property behind it (no row is newer than the row above it). ac-2 walks the pager the way the
operator clicks it, page by page, and asserts the union of what it drew equals all 79 fixture
entries.

Full safety-net suite before commit: `npm test` → **527 tests, 520 pass, 2 fail, 5 skipped**. The two failures are
`J-ac-manifest slice-99826-ac-1` and `slice-379-ac-5`, both the stale `regression/AC-MANIFEST.lock`
integrity check. **They fail identically on the branch point with none of my changes applied**
(measured: 518 tests / 511 pass / **the same 2 fail**), they read nothing this slice touches, and
regenerating that lock is another slice's business — I left it alone.

## Safety-net tests

Nine tests in `regression/observability/j-history-chronological-order.test.js`. They run the page's
own functions, lifted out of `lcars-dashboard.html` with the `extractFn` harness
`j-backlog-row-controls.test.js` established, plus an `extractConst` for `HISTORY_PAGE_SIZE` so a
quiet return to five rows cannot pass. A hand-kept copy of the comparator would keep passing after
the page changed underneath it.

**Break-it-on-purpose.** I did not use the shared stash. The fix was copied aside and restored from
that copy each time.

*Fix removed wholesale* (`git show HEAD:dashboard/lcars-dashboard.html > …`): **all 9 red** — with
`orderHistoryRowsByRecency` gone the harness cannot load the page's history functions at all. That
is a blunt result, so I ran four surgical reverts as well, each putting back exactly one old
behaviour and leaving everything else in place:

| what I put back | tests that went red |
|---|---|
| the `parseInt(b.id) - parseInt(a.id)` sort | **ac-1**, **ac-5** |
| `HISTORY_PAGE_SIZE = 5` | **ac-1**, **ac-3** |
| the count bar drawn only when `totalPages > 1` | **ac-3** |
| the pagination container without `history-pager` | **ac-2** |
| a naive `Date.parse(b) - Date.parse(a)` comparator | **ac-4**, **trap 1** |
| a comparator that dedupes by id before sorting | **ac-4**, **ac-5**, **trap 1**, **trap 2** |

So every criterion test has a specific, isolated way to fail. **trap 3 and trap 4 stay green under
every surgical revert, and go red only under the wholesale one** — by construction: they assert that
outcome classification and the amendment fold are *unchanged*, and this slice changes neither. I am
flagging that rather than dressing it up: they are anti-regression guards on behaviour I deliberately
preserved, not proof of new behaviour.

**Browser.** I did not open a browser — this is a headless run. What I did instead: rendered the
panel's real `renderHistoryPanel`/`renderHistoryPage` against the brief's measured six-row log and
read the markup it produced. Rows came out `367, 379, 372, 373, 376, 375`; 367 wore
`outcome-pill outcome-error` with its `data-terminal-ts` and the tooltip `S367 · finished 09-04
21:02`; the expanded 367 row showed `09-04 21:02` beside its reason; the count bar read
`showing 1–6 of 6 entries` with both arrows disabled. (The times display in local time, so the
brief's UTC-looking fixture values render three hours on — the ordering is unaffected.)

## Screen hooks

The brief said "Rom to declare". These are all in the shipped page.

**ac-1 — ordering**

| hook | what it is | visible when |
|---|---|---|
| `.history-row[data-history-id]` | one per entry on the current page, in screen order | whenever the log has at least one entry |
| `.history-row[data-terminal-ts]` | the ISO terminal timestamp the row is ordered by; empty string when the slice has none | on every rendered row |
| `.history-row-main[title]` | `S{id} · finished MM-DD HH:MM` | on hover, every row |
| `.history-expand-ts` | the same time as text, beside the description | when that row's chevron is open (`.history-expand.open`) |

Ordering is read off `data-terminal-ts` down the rendered rows: each value is ≤ the one above it.

**ac-2 / ac-3 — navigation and total**

| hook | what it is | visible when |
|---|---|---|
| `#history-pagination`, also `.history-pager` | the control region | whenever there is ≥ 1 entry; carries `hidden` (which is `visibility:hidden`) only on an empty log |
| `.history-pg-btn` | two buttons, `← newer` and `older →`; `disabled` at the first / last page | with the region |
| `.history-pg-info` | `showing A–B of N entries`, plus `· page P of T` when more than one page | with the region |
| `#history-list.history-list` | the scrolling row container (`overflow-y:auto`) | always |

## Tests moved or weakened

None. No existing test was moved, renamed, changed, or removed. `regression/COVERAGE.lock` is a
generated map, regenerated by its own deriver, not a test.

## Commit

- `015d3f8` — S380: History must be chronological, and reachable past the first five rows
  (`dashboard/lcars-dashboard.html`, the new test file, `regression/COVERAGE.lock`), with the five
  `AC:` trailers.
- This report, in its own commit.

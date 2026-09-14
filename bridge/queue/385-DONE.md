---
id: "385"
title: "Ten rows a page, everywhere — the queue gets a pager and History matches it"
from: rom
to: nog
status: DONE
slice_id: "385"
branch: "slice/385"
completed: "2026-09-14T15:56:01.000Z"
tokens_in: 96
tokens_out: 64915
elapsed_ms: 906840
estimated_human_hours: 3.5
compaction_occurred: false
tokens_cache_read: 4735822
cost_usd: 5.555735999999999
---

# Ten rows a page, everywhere — the queue gets a pager and History matches it

## Summary

Every list on the operations page now shows ten rows at a time. History's page size drops
from 25 to 10, and the two Backlog Queue sections — Approved Work Orders and Proposed
Improvement — get a pager each, paged independently, wearing History's pager.

Ten is written down once, as `LIST_PAGE_SIZE`, and every list reads it. There is no
selector, no dropdown, no "rows per page", no URL parameter and no stored preference; the
constant is never reassigned. A section whose list fits on one page renders no pager at
all, so the ordinary evening — one approved work order — shows nothing above the divider.

Two details that would have been easy to get wrong, and did not: the build-order number
counts from the head of the queue rather than the head of the page (row 1 of page 2 reads
"21."), and a drag still persists the whole list. The drop handlers were already sourcing
their order from the cached full list rather than from the DOM, which is exactly what
pagination would have broken; the guard tests now pin that, driving the drag through a DOM
that only holds the visible page.

## What changed

- `dashboard/lcars-dashboard.html`
  - `HISTORY_PAGE_SIZE = 25` → `LIST_PAGE_SIZE = 10`, moved out of the History section
    because it is no longer History's. Renamed rather than kept: the queue sections read
    it too, and a constant called `HISTORY_PAGE_SIZE` slicing the Backlog Queue would be a
    lie. It is the only page size declared on the page. (The brief's task 1 said "change
    `HISTORY_PAGE_SIZE` from 25 to 10" and task 4 said "one named constant … point every
    list at it"; the rename is how both hold at once. Value and scope are unchanged.)
  - New `clampListPage(page, total)` — one clamping rule for all three lists. History's
    two inline copies now call it; the arithmetic is identical.
  - New `queuePagerHtml(id, page, total, goFn)` — History's pager as markup a queue
    section can append. Returns `''` when the list fits on one page.
  - New `queueApprovedPage` / `queueProposedPage` state and
    `queueApprovedGoPage()` / `queueProposedGoPage()` controls. Two lists, two page
    numbers, turned separately.
  - `renderQueueList()` clamps both page numbers against the list as it stands, slices
    each section to its page, and appends that section's pager. The approved rows'
    `position` is now `approvedStart + idx + 1`.
  - `_glideQueueMove()`: the approve animation lands the card above the approved section's
    pager when there is one, else above the divider as before. Without this the glided
    card briefly appeared below the pager.
  - CSS: the pager's styling moved from `#history-pagination` to `.history-pager` (the
    class the element already carried), so the two new pagers inherit the same look; both
    the light base rule and the dark-mode override moved together, keeping their order and
    so their cascade. New `.queue-pager` trims the gutter and height for a pager that sits
    under a list of rows rather than at the foot of a panel.
- `regression/observability/j-history-chronological-order.test.js` — see
  `## Tests moved or weakened`.
- `regression/authoring-staging/j-ten-rows-a-page.test.js` — new, 10 tests.
- No `e2e/` file was touched.

## Acceptance criteria verification

All in `regression/authoring-staging/j-ten-rows-a-page.test.js`, run with
`node --test regression/authoring-staging/j-ten-rows-a-page.test.js` — 10 tests, 10 pass,
0 fail. Every count in the file is derived from the page's own `LIST_PAGE_SIZE`; nothing
hardcodes ten.

| Tag | Test | Result |
|---|---|---|
| slice-385-ac-1 | `slice-385-ac-1 the History panel shows at most ten rows at a time and its pager reaches every completed slice` | pass — 34 slices, 10 a page, all 34 reachable by clicking "older" |
| slice-385-ac-2 | `slice-385-ac-2 the Approved Work Orders section shows at most ten rows at a time and has its own pager` | pass — 23 work orders, 10 a page, pages walk 1→2→3, last page numbers its rows 21/22/23 |
| slice-385-ac-3 | `slice-385-ac-3 the Proposed Improvement section pages ten at a time, independently of the approved section` | pass — turning one section's page leaves the other's exactly where it was, in both directions |
| slice-385-ac-4 | `slice-385-ac-4 a pager is not rendered for a list that fits on one page` | pass — 1 row, 3 rows and exactly 10 rows draw nothing pager-shaped; 11 draws the pager |
| slice-385-ac-5 | `slice-385-ac-5 dragging a row to a new position preserves the order of every row on the pages that are not visible` | pass — 30 work orders, drag inside page 1, all 30 persisted and pages 2–3 come back byte-identical |
| slice-385-ac-6 | `slice-385-ac-6 ten rows a page is fixed — the operations page offers no control, preference or parameter that changes it` | pass — one declaration, literal `10`, never reassigned, no storage/URL read, no control |

## Safety-net tests

Ten tests: one per acceptance criterion, one per trap.

- `slice-385-ac-1` … `slice-385-ac-6` — as above.
- `slice-385-ac-5 trap 1` — a reorder persists the whole list, never the ten ids in the
  DOM. The harness renders the panel, reads the ids that actually reached the screen, and
  gives the drag handlers a `document` that can only find those — the paginated world. A
  ten-id POST is asserted against explicitly, for both sections, and the client's cached
  order is checked to agree with what was sent.
- `slice-385-ac-2 trap 2` — the page number survives three consecutive re-renders, clamps
  from page 3 to page 2 when the list shrinks under it (not back to page 1), follows all
  the way down to 1 when the list shrinks to three rows, and clamps at both ends for a
  page number that never existed. Asserted for both sections.
- `slice-385-ac-5 trap 3` — a cross-page drag is not offered: a row two pages down has no
  element on the page to be dropped onto. The one way such a pair can arise — the panel
  re-pages under a drag in flight — is refused, persisting nothing and leaving the order
  untouched.
- `slice-385-ac-4 trap 4` — `#history-pagination` keeps both its id and its
  `history-pager` class; the two new pagers wear `history-pager` too and answer to
  `#queue-approved-pagination` / `#queue-proposed-pagination`, so one probe for
  `.history-pager` finds all three.

**Break-it-on-purpose.** Run twice, because the first run was too easy.

1. Fix fully stashed (`git checkout -- dashboard/lcars-dashboard.html` plus the guard
   file): **all 10 went red.** Honest, but most of them died on the missing constant
   rather than on behaviour, so:
2. Constant left in place, only the pagination removed from `renderQueueList()` (both
   sections back to `.map()` over the whole array, both `queuePagerHtml` calls dropped):
   **9 of 10 went red** — ac-2, ac-3, ac-4, ac-5, trap 1, trap 2, trap 3, trap 4 and ac-6
   (its closing block asserts each pager offers exactly two controls). ac-1 stayed green,
   correctly: that un-fix left History alone. Combined with run 1, where ac-1 went red,
   every test has been shown red for the right reason.

Fix restored and re-verified after both runs.

**Browser.** I did not look in a browser — this session is headless. What I did instead:
rendered the panel through its own `renderQueueList()` and read the markup. Two approved
work orders and fourteen proposals draw two rows, the dashed divider, ten proposal rows,
then `<div id="queue-proposed-pagination" class="history-pager queue-pager">` reading
`← prev` (disabled) · `showing 1–10 of 14 · page 1 of 2` · `next →`. Nothing above the
divider. That is markup, not a screen; Julian's browser tests are the real look.

**Other guards.** I ran three existing files once each, because my diff sits inside them:
`j-history-chronological-order.test.js` (9/9 — trap 4),
`j-reorder-proposed-backlog.test.js` (13/13 — the drag handlers) and
`j-backlog-row-controls.test.js` (6/6 — `renderQueueRow`). I did not run the full suite.

## Screen hooks

The brief pre-named the History hook; I used that name and declared the two new ones to
match its shape.

- **slice-385-ac-1** — `#history-list` rows (`.history-row[data-history-id]`) and
  `#history-pagination` (also `.history-pager`), with `.history-pg-btn` for the two
  controls and `.history-pg-info` for the count line. Visible whenever the operations
  page is loaded; the pager's buttons enable once more than ten slices have completed.
- **slice-385-ac-2** — the rows under the `Approved Work Orders` label inside
  `#queue-list`: `.queue-row[data-id][data-state="QUEUED"]`, with `.queue-position-num`
  carrying the build-order number. The pager is `#queue-approved-pagination`
  (`.history-pager.queue-pager`), the last child of the section, immediately above
  `hr.queue-section-divider`. Visible only when more than ten work orders are approved.
- **slice-385-ac-3** — the rows under `Proposed Improvement`:
  `.queue-row[data-id][data-state="STAGED"]` (and `[data-state="NEEDS_APENDMENT"]` for
  pinned ones). The pager is `#queue-proposed-pagination`
  (`.history-pager.queue-pager`), the last child of `#queue-list`. Visible only when more
  than ten proposals are staged.
- **slice-385-ac-4** — the absence of `#queue-approved-pagination` and
  `#queue-proposed-pagination`. Neither element exists in the DOM when its section holds
  ten rows or fewer; `#queue-list` then contains no `.history-pager` at all. This is the
  state on an ordinary evening.
- **slice-385-ac-5** — `.queue-drag-handle.active` on a `.queue-row[draggable="true"]`,
  and the persisted result at `POST /api/queue/order` / `POST /api/staged/order`. Visible
  on every approved and proposed row that is not an amendment.
- **slice-385-ac-6** — the whole operations page: no `select`, `input` or control anywhere
  offers a page size, and each pager contains exactly two `button.history-pg-btn`.

## Tests moved or weakened

One file, three changes, none of them a weakening. Trap 4 said this guard reads
`HISTORY_PAGE_SIZE` out of the source "rather than hard-coding 25, so changing the number
is safe" — that is true of two of its three page-size assertions. The third hard-coded it.

`regression/observability/j-history-chronological-order.test.js`:

1. `extractConst('HISTORY_PAGE_SIZE')` → `extractConst('LIST_PAGE_SIZE')`, and the key it
   exposes renamed with it (two call sites in `slice-380-ac-2`). Follows the rename; the
   test still reads the page's own constant rather than a copy of its value.
2. Added `${extractFn('clampListPage')}` to the same harness. Required: `renderHistoryPanel`
   now calls the shared clamp, so the sandbox has to have it. The guard therefore exercises
   the shipped clamping rule instead of a copy of it.
3. **`slice-380-ac-3` line 226 hard-coded `/showing 1–25 of 60 entries/`** and would have
   gone red on the page-size change alone. Now
   ``new RegExp(`showing 1–${h.LIST_PAGE_SIZE} of 60 entries`)`` — derived from the page,
   which is what that file's own harness comment always claimed it did. Strictly stronger:
   it now fails if the page size and the count line disagree, which the literal could not.

All 9 tests in that file pass unchanged in count and in intent. No browser test was
touched.

## Conflicts with the brief

One, resolved in favour of the explicit instruction; flagging it because it is a product
decision, not an implementation one.

**AC-4 vs. History.** Task 1 says "Nothing else in History changes", trap 4 says History's
existing guard must stay green — but the ac-4 screen hook lists `#history-pagination` "in
the one-page case — nothing rendered", and task 3 describes History's container as one
"which hides itself when everything fits on one page". That description is stale: slice 380
deliberately stopped it hiding, so that a log of 3 could be told apart from a page of 3
("showing 3 of 3"), and `j-history-chronological-order.test.js` slice-380-ac-3 pins it with
the comment *"The case the old code got wrong: fewer entries than a page. It hid the bar
entirely, so 3-of-3 and 3-of-200 looked exactly alike."*

I read the ac-4 hook as written under the stale belief that History already hid its bar —
i.e. as "no change needed there" — and followed the explicit instructions instead. So:

- the **two new queue pagers** are absent entirely when their list fits on one page, which
  is what ac-4 asks for and what task 3 spells out ("the operator sees no pager above the
  divider at all"). Pinned by my ac-4 test.
- **History keeps its slice-380 count bar** on a single page. Untouched, still green.

If O'Brien wants History's bar gone on one page too, that is a one-line change to
`renderHistoryPage()` plus a retirement of slice-380-ac-3 — but it reverses a decision
slice 380 made on purpose, so it needs his word, not mine.

**Trap 3, stated plainly as asked.** Dragging a row from one page onto a row on another
page is not possible, and this slice does not invent a mechanism for it. The target row is
not in the DOM, so the browser is never offered the drop. In practice a reorder can only
move a row within its own page of ten. Whether that matters is worth deciding once the
queue routinely runs past ten approved work orders; a "move to top" control or a drop onto
the pager's edge would both do it, and neither is in this brief.

**One thing I left alone.** `onDrop`'s QUEUED branch does not backfill queue ids that are
missing from `cachedQueueOrder`, the way its STAGED branch does. That gap is pre-existing
and is not made worse by pagination (the absent ids are re-appended by `buildQueueRows()`
on every render), and closing it would mean giving `onDrop` a new free identifier, which
breaks the sandbox `j-reorder-proposed-backlog.test.js` runs it in. Out of scope here;
worth a line in O'Brien's list.

## Commit

`S385: Ten rows a page, everywhere — the queue gets a pager and History matches it` on
`slice/385`, carrying the six `AC:` trailers and `Lane: core`.

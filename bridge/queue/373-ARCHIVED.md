---
id: "373"
title: "Remove the Edit button from the backlog rows"
from: rom
to: nog
status: DONE
slice_id: "373"
branch: "slice/373"
completed: "2026-09-03T21:53:54.000Z"
tokens_in: 214000
tokens_out: 16500
elapsed_ms: 569794
estimated_human_hours: 1.5
compaction_occurred: false
---
## Summary

The Backlog Queue rows carried three controls — Approve, Edit, Reject — but only two of them were
decisions. `queueEdit()` never edited anything from the row: it fetched the slice and opened the
slice-detail overlay in read mode (`sliceDetailTab = 'rendered'`). Both buttons are gone. A
proposed row is now Approve + Reject; an approved row is Un-approve alone. `queueEdit()` and the
`.queue-btn-edit` styling went with them — nothing else called either.

Two things worth your attention, neither of which blocked the work:

**The overlay's only opener was Edit.** Trap 2 says the slice-detail overlay is also reached from
History and from the detail controls. It is not. History has its own overlay
(`#history-detail-overlay`, opened by `openHistoryDetail`), and the row body opens the
*investigation* panel (`#inv-panel-overlay`). Grepping every assignment to
`#slice-detail-overlay`'s display turns up exactly two: `queueEdit` opening it and
`closeSliceDetail` closing it. So with Edit retired, `#slice-detail-overlay` is now unreachable
from the page, and with it go **Refine**, **Save edits**, **Return to Dev Lead**, **Remove from
queue** and the raw **Source** tab. Those are real capabilities that exist nowhere else in the UI.
I did as the brief instructed and left the overlay standing rather than deleting it, and I did not
invent a new entry point — that is scope, and scope is yours. Nothing dangles: every `onclick` in
the overlay markup still resolves to a defined function, and TRAP 2 is the test that keeps it that
way. Your call whether the overlay gets a new opener or is retired outright in a follow-up.

**Reading the brief still works.** The route that remains is the **row chevron** — see AC-4 below.

## What changed

- `dashboard/lcars-dashboard.html`
  - `renderQueueRow()`, approved (`QUEUED`) branch: `actionsHtml` is now just `unapproveBtn`. The
    dispatched slice, which hides Un-approve, now renders no controls at all instead of an
    orphaned Edit.
  - `renderQueueRow()`, proposed (`STAGED`) branch: the Edit button is gone from between Approve
    and Reject.
  - `queueEdit()` deleted — 26 lines, no remaining callers.
  - `.queue-btn-edit` and `.queue-btn-edit:hover` deleted — no remaining users.
  - Nothing else in the file was touched. The overlay markup, `renderSliceDetail`,
    `switchDetailTab`, `closeSliceDetail` and all eight `sliceDetail*` actions are untouched.
- `regression/authoring-staging/j-backlog-row-controls.test.js` — new, 6 tests.
- `regression/COVERAGE.lock` — regenerated (`node scripts/build-coverage-map.js`), 452 → 456 guards.
- `regression/AC-MANIFEST.lock` — regenerated (`node scripts/build-ac-manifest.js`), 221 tags.
- `regression/COVERAGE.md` — one journey row added to the Authoring & Staging table, matching the
  convention slice 376 used.

No `e2e/` file was created, edited or committed.

## Acceptance criteria verification

Command for all four, run from the worktree root:

    node --test regression/authoring-staging/j-backlog-row-controls.test.js

| Tag | Test file | Result |
|---|---|---|
| slice-373-ac-1 | `regression/authoring-staging/j-backlog-row-controls.test.js` | PASS |
| slice-373-ac-2 | `regression/authoring-staging/j-backlog-row-controls.test.js` | PASS |
| slice-373-ac-3 | `regression/authoring-staging/j-backlog-row-controls.test.js` | PASS |
| slice-373-ac-4 | `regression/authoring-staging/j-backlog-row-controls.test.js` | PASS |

- **slice-373-ac-1** — the test runs the page's own `renderQueueRow` against a `STAGED` row and
  reads the controls back out of `.queue-row-actions`: Approve and Reject are wired to
  `queueAccept`/`queueReject`, no `queue-btn-edit` / `queueEdit` / `>Edit<` appears, and the button
  count is exactly 2.
- **slice-373-ac-2** — same, for a `QUEUED` row: Un-approve wired to `queueUnapprove`, no Edit,
  button count exactly 1. It also renders the dispatched case (`heartbeat.current_slice` matching
  the row) and asserts 0 buttons — that row used to be left holding Edit as its only control.
- **slice-373-ac-3** — asserts the overlay markup (`#slice-detail-overlay`, `#slice-detail-body`,
  `#slice-detail-actions`, both tabs) is still in the shipped page and that all twelve
  `sliceDetail*` / overlay functions are still defined.
- **slice-373-ac-4** — asserts the proposed row still renders `#queue-chevron-{id}` wired to
  `toggleQueueExpand` and `#queue-expand-{id}`, then runs the page's own
  `buildQueueExpandContent` over a four-section brief and checks all four section markers land
  inside `.queue-expand-body`.

Full suite, once, before commit:

    rm -rf regression/_test_timeout_suite regression/_test_pass_suite
    node --test 'regression/**/*.test.js'
    → tests 420 · pass 416 · fail 0 · skipped 4 (pre-existing documented skips) · 11.5 s

**How a staged slice's full brief remains readable (AC-4, asked for by name):** the **row
chevron** — the `›` at the right of every backlog row, `#queue-chevron-{id}`, calling
`toggleQueueExpand(id)`. It expands the row inline into `#queue-expand-{id}`, which
`loadQueueExpandContent` fills from `GET /api/queue/{id}/content` — the same endpoint `queueEdit`
used — and `buildQueueExpandContent` renders through `marked.parse(body)` into
`.queue-expand-body`. The whole brief body arrives, not a goal line. This works on approved rows
as well as proposed ones. What is genuinely lost with the overlay is the raw **Source** tab; the
brief itself is not lost, so I shipped rather than stopping.

## Safety-net tests

Six tests, one per acceptance criterion plus one per trap. Trap 3 is the counting rule itself, so
it has no test of its own — traps 1 and 2 do.

| Test | Guards |
|---|---|
| `slice-373-ac-1 a proposed backlog row offers only Approve and Reject, with no Edit control` | AC-1 |
| `slice-373-ac-2 an approved row offers only the un-approve control, with no Edit control` | AC-2 |
| `slice-373-ac-3 the slice-detail overlay survives — only its Edit entry point was retired` | AC-3 |
| `slice-373-ac-4 a staged slice's full brief stays readable — the row chevron opens it` | AC-4 |
| `slice-373-ac-4 TRAP 1 the brief-reading route is whole: full text, both row states, real markdown` | trap 1 |
| `slice-373-ac-3 TRAP 2 the retirement is surgical — no overlay control is left pointing at nothing` | trap 2 |

The tests lift `escHtml`, `renderQueueRow`, `buildQueueExpandContent` and `loadQueueExpandContent`
straight out of `lcars-dashboard.html` and execute them. They do not keep a copy of the render
logic — `test/dashboard-render.test.js` shows why that matters (see below).

**Break-it-on-purpose.** Three of the six invert by undoing the fix; the other three are
preservation guards — they assert that something was *not* deleted, so restoring the Edit button
cannot make them fail. I proved those three can fail with two over-deletion mutants, which are
precisely the failure mode they exist to catch. All six can go red:

| Test | Red with the fix stashed | Red on mutant A (overlay deleted) | Red on mutant B (chevron deleted) |
|---|---|---|---|
| ac-1 | **RED** | green | green |
| ac-2 | **RED** | green | green |
| ac-3 | green | **RED** | green |
| ac-4 | green | green | **RED** |
| TRAP 1 | green | green | **RED** |
| TRAP 2 | **RED** | **RED** | green |

- Fix stashed (`git checkout HEAD -- dashboard/lcars-dashboard.html`, then restored from a copy —
  the shared stash stack was not touched): 3 fail / 3 pass.
- Mutant A — the `#slice-detail-overlay` markup block cut out of the page: 2 fail / 4 pass.
- Mutant B — `chevronHtml` set to `''` in `renderQueueRow`: 2 fail / 4 pass.

**What I saw in a browser.** I served this worktree's dashboard on port 4773 with a throwaway
staged slice (not committed; `bridge/staged/` is back to just its `.gitkeep`) and drove headless
Chrome at it. The proposed row read `Slice 990 · LOOK-FIXTURE … · [✓ Approve] [✕ Reject]` — two
buttons, nothing between them; `#queue-list .queue-btn-edit` matched 0 elements and
`typeof window.queueEdit` was `undefined`. Clicking `#queue-chevron-990` opened the row and
rendered the whole brief — heading, Goal, Tasks, Traps and Acceptance criteria, all four section
markers present, 448 characters of it, plus the `Proposer obrien` meta line. The screenshot shows
the row and the expanded brief sitting correctly in the Backlog Queue panel with no layout damage.
No test asserts any of this; it is a look, as the role file requires.

## Screen hooks

Existing names, no new test-id scheme.

| Hook | Starting state |
|---|---|
| `.queue-row[data-id="{id}"][data-state="STAGED"]` | one per proposed slice, in the Proposed Improvement section |
| `.queue-row[data-id="{id}"][data-state="QUEUED"]` | one per approved slice, in the Approved Work Orders section |
| `.queue-row-actions` | inside every row; holds only the controls listed below |
| `.queue-btn-accept` | visible on a proposed row (`✓ Approve`) — 1 per proposed row |
| `.queue-btn-reject` | visible on a proposed row (`✕ Reject`) — 1 per proposed row |
| `.queue-btn-unapprove` | visible on an approved row (`↶`), **absent** when that row is the dispatched slice |
| `.queue-btn-edit` | **must match zero elements anywhere in the page** — this is the slice |
| `#queue-chevron-{id}` | visible on every proposed and approved row; gains `.open` when expanded |
| `#queue-expand-{id}` | present but collapsed; gains `.open`, and `data-row-state` is `STAGED` or `QUEUED` |
| `.queue-expand-body` | inside `#queue-expand-{id}` once loaded; holds the markdown-rendered brief |
| `#slice-detail-overlay` | still in the DOM, `display:none`, and no longer openable from the backlog |

A proposed row holds exactly 2 buttons in `.queue-row-actions`; an approved row 1; the dispatched
row 0.

## Tests moved or weakened

None. No existing safety-net test was moved, renamed, changed, weakened or removed. The suite went
from 414 to 420 tests and COVERAGE.lock from 452 to 456 guards — nothing was subtracted.

One thing to flag rather than change: **`test/dashboard-render.test.js`** still asserts
`'Edit button visible for STAGED + 2 QUEUED rows (3 total)'`. It is not a safety-net test — `test/`
is deliberately excluded from the suite and from CI (`.github/workflows/ci.yml:15`), and nothing
runs it. It will keep passing regardless, because it asserts against its own local copy of a render
function that already diverged from production long before this slice (its copy still renders an
`Accepted` pill and a bare `Accept` button, neither of which the page has had for many slices). I
left it alone as outside the brief, but a `grep queue-btn-edit` will hit it, so it is named here
rather than discovered.

## Commit

`b919352` on branch `slice/373`, branched from `dev` at `4525a02`.

    S373: Remove the Edit button from the backlog rows

All four acceptance criteria are declared as `AC:` trailers on that commit, alongside
`Slice-Id: 373` and `Slice-Branch: slice/373`. The DONE report is committed separately, per the
temporary rule in the role file.

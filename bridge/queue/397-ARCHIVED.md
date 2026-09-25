---
id: "397"
title: "Every dev commit listed under the branch graph, subject in full"
from: rom
to: nog
status: DONE
slice_id: "397"
branch: "slice/397"
completed: "2026-09-25T20:41:00.000Z"
tokens_in: 56
tokens_out: 18640
elapsed_ms: 371115
estimated_human_hours: 0.7
compaction_occurred: false
tokens_cache_read: 1443690
cost_usd: 1.8338700000000003
---

# Every dev commit listed under the branch graph, subject in full

## Summary

The list under the branch graph in QA and Branches now prints one row per commit on dev — newest first — instead of printing the tip and throwing the rest of `dev.commits` away, and a subject wraps onto as many lines as it needs instead of being cut off with an ellipsis. One render function and one CSS rule in `dashboard/lcars-dashboard.html`; no server change, no new logic, and the base / pre-merge / reconciling rows are untouched and still come after the commit rows.

The trap is handled the way the brief asked: the loop walks the index backwards from `n - 1` down to `0`. `commits` is the same array `_lastBranchState` hands the Regression panel, whose "Tested commit (dev tip)" reads its last entry, so `reverse()` would have renamed the dev tip to the oldest commit on dev. Nothing in the render reorders or mutates the array, and a guard test pins that.

## What changed

- `dashboard/lcars-dashboard.html`, `renderTopoSvg(bs)` (:11073–11089) — the single `newest` row is replaced by a backwards loop over `commits` emitting one `<div class="topo-c-row topo-c-dev">` per commit. Each row carries `.topo-c-k` (`newest` on the first row, empty on the others), `.topo-c-sha` (7 characters), `.topo-c-subj` (the subject through `_promoteEsc`, or `S<slice_id>` when the subject is empty and the commit names a slice, or `origin/dev` on the tip row only, as today, and nothing on a lower row), and `.topo-c-age` (`· <formatAgeShort(age_s)>`, omitted entirely when `age_s` is null). The comment above the block now says the list shows every dev commit, newest first, then base.
- `dashboard/lcars-dashboard.html`, CSS `.topo-commits .topo-c-subj` (:3887) — `overflow:hidden`, `text-overflow:ellipsis` and `white-space:nowrap` removed; now `flex: 1 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere`. `flex:1 1 auto` keeps `.topo-c-age` at the right end of the row; `overflow-wrap:anywhere` breaks one unbroken word instead of pushing a horizontal scrollbar out of `#topo-svg-wrap`. The row keeps `align-items: baseline`, so a wrapped subject's first line still sits on the same baseline as its sha and age. As the brief intended, the base, pre-merge and reconciling rows wrap now too rather than being cut.
- `regression/gate-merge/j-dev-commit-list.test.js` (new) — two safety-net tests; see below.

No `e2e/` file was touched.

## Safety-net tests

Surface lane, so only the two criteria that assert a computed value got a test. AC-3, AC-4, AC-5, AC-6 and AC-7 are about what the screen shows and says — wrapping, no ellipsis, escaped markup, the empty-list row, the empty-subject fallback — and Jordan reads those in the diff while the browser suite covers the screen at the gate.

`regression/gate-merge/j-dev-commit-list.test.js` lifts the real `renderTopoSvg` out of `lcars-dashboard.html` with `new Function` (the pattern `j-panel-owner-names.test.js` uses), runs it against a fake `#topo-svg-wrap`, and parses the rows back off the html it wrote — so a hand-kept copy of the markup cannot keep the guard green after the page changes underneath it.

- `slice-397-ac-1` — 1, 2, 3 and 7 commits each render exactly that many `.topo-c-dev` rows plus exactly one row, and the last row is the `base` row. Then one row's cells: sha cut to 7 characters, that commit's own subject, and `· 2m ago` for `age_s: 120`.
- `slice-397-ac-2` — for A (oldest), B, C (tip) the rows read `C tip`, `B middle`, `A oldest`, `origin/main S350`; the labels read `newest`, ``, ``, `base`. Then the trap: after the render, `dev.commits` is still in its original oldest-first order and its last entry is still the tip. Then the reconciling case: the same commit rows, then `.topo-c-premerge`, then `.topo-c-reconciling`.

Command: `node --test regression/gate-merge/j-dev-commit-list.test.js` → 2 tests, 2 pass, 0 fail.

Break-it check is not required in the surface lane, but it was cheap, so I ran it: with the renderer restored to HEAD both tests go red — AC-1 with "1 commits on dev must render 1 commit rows, not 0", AC-2 with "the rows read tip → oldest, then base". The fix was put back and both are green again.

I also ran the one existing file that reads this renderer's source, `regression/gate-merge/j-merge-truth-now.test.js` (it pins the reconciling branch order and `topo-c-premerge`): 14 tests across the two files, all pass. I did not run the full safety-net suite or the browser suite.

I did not open a browser for this one. The change renders my worktree's HTML, and the running dashboard serves the merged file, so looking would have shown me the old list — I would rather say that than report a screenshot of someone else's code. The wrapping and the horizontal-scroll behaviour in AC-3 and AC-4 are the parts a browser would actually settle, and they are Julian's at the gate.

## Screen hooks

I used the names the brief pre-named. Starting state for all of them: the QA and Branches panel expanded (`#topo-panel` without `topo-collapsed`, localStorage `ops:topo-collapsed` unset) and `/api/branch-state` stubbed the way `e2e/s-numbering.spec.js:28-52` does it.

- Commit rows — `#topo-svg-wrap .topo-commits .topo-c-row.topo-c-dev`, one per entry of `dev.commits`, in DOM order newest first. `topo-c-dev` is the new class; there is one such row for every commit and none when `dev.commits` is empty.
- Inside each commit row — `.topo-c-k` (the label: `newest` on the first row, empty text on every other), `.topo-c-sha` (7 characters), `.topo-c-subj` (the full subject), `.topo-c-age` (`· <age> ago`; the span is absent, not empty, when `age_s` is null).
- Base row — the `#topo-svg-wrap .topo-c-row` whose `.topo-c-k` reads `base`; it comes straight after the oldest commit row. Unchanged.
- Reconciling (stub `github.reconciling: true`) — pre-merge base row `.topo-c-premerge`, reconciling note `.topo-c-reconciling`, both after the commit rows, both unchanged.
- Wrapping and sideways scroll — `.topo-c-dev .topo-c-subj` (compare its rendered height against one line; it has no `overflow:hidden` and no ellipsis) and `#topo-svg-wrap` (`scrollWidth` vs `clientWidth`).
- Escaping — `.topo-c-dev .topo-c-subj` text, with no `b` or `img` element inside it; the subject goes through `_promoteEsc`.

## Commit

`187cdb9` on `slice/397` — `S397: every dev commit listed under the branch graph, subject in full`, carrying the seven `AC:` trailers, with the two changed files: `dashboard/lcars-dashboard.html` and the new `regression/gate-merge/j-dev-commit-list.test.js`. This report follows in a second commit on the same branch (a commit cannot cite its own sha), staged with `git add -f`. Both commits stage explicit paths only. I did not run `build-coverage-map` or `build-ac-manifest` and did not touch `regression/*.lock`, as the brief instructed.

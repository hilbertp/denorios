---
id: "406"
title: "Every node on dev shows its label from the server, with an (i) that explains S, P and H"
from: rom
to: nog
status: DONE
slice_id: "406"
branch: "slice/406"
completed: "2026-09-26T00:00:00.000Z"
tokens_in: 62
tokens_out: 37207
elapsed_ms: 832470
estimated_human_hours: 2.5
compaction_occurred: false
tokens_cache_read: 1959266
cost_usd: 2.7148369999999997
---

## Summary

Every dev node in the QA and Branches graph now draws the label slice 405's server sends — `S402` for a landing, `P402` for the bookkeeping that filed it, `H` for a hand commit — instead of rebuilding `S<slice_id>` from the slice number. That was the whole distortion: slice 402's `autocommit` commit carries slice_id 402, so the old renderer printed S402 under it, the same text as the landing. Hovering a labelled node now adds one line above today's line saying what its letter means, and an `(i)` at the right end of the dev line explains all three letters at once.

The three sentences live in exactly one table (`KIND_MEANINGS`), which both the node hover and the `(i)` read, so the legend cannot drift from what a node says about itself. No server change; no change to how a kind or label is worked out. All six acceptance criteria are met.

## What changed

`dashboard/lcars-dashboard.html`, five edits, all inside `renderTopoSvg` and the two declarations above it:

1. **`KIND_MEANINGS` + `kindMeaning()`** (new, just above `commitLabel`): the three meanings, one line each, exactly as the criteria word them. `kindMeaning()` returns `''` for a kind the table has no line for. It tests `typeof … === 'string'` rather than truthiness, so a kind naming an inherited property (`toString`) reads as *no meaning* instead of stringifying `Object.prototype.toString` into the hover.
2. **Node label** (was `if (d.slice_id != null) … S${d.slice_id}`): now `if (label)` drawing `d.label`, escaped with `_promoteEsc`, at the same y (`devY + 18`), font-size 9, weight 500, fill `var(--ink-3, #6b7280)`. Only `label` decides it — neither `slice_id` nor `inferred` is consulted, so a commit sent without a label stays bare even when it has a slice number, and an inferred kind is drawn identically to a declared one.
3. **Node hover**: a first line `<label> — <meaning>` plus `\n` above today's text. With a label but no known meaning the first line is the bare label, so it can never read `S402 — undefined` or end in a dangling ` — `. With no label the hover is byte-for-byte today's single line.
4. **Both dev circles** gained `class="topo-dev-node"` and `data-sha="<sha7>"`; the label `<text>` gained `class="topo-node-label"` and the same `data-sha`.
5. **The `(i)`**: an SVG `<text class="topo-kind-info">` at `headX + 38`, `devY + 3.5`, with a `<title>` holding `S — …`, `P — …`, `H — …` built from the table. Drawn only when `n > 0` — no nodes, no letters to explain. It sits past the dashed tail (which ends at `headX + 28`) and inside the 72 units of `rightPad`, so it never overflows the viewBox. One CSS rule beside `.topo-svg-wrap`: `.topo-kind-info { cursor: help; }`.

**Trap respected.** `commitLabel()`, `commitSliceIdBySha()` and `commitTagBySha()` are untouched — the diff shows no line changed in any of them. The rollback dialog and the DevOps tested-at tag keep their `S402 · abc1234` text.

Two notes for Jordan, neither a change I made:
- The em dash is written `—` in the two new template literals. That is this file's own idiom (25 other occurrences), not an escaping accident.
- I checked slice 405's `commitKindEntry` cannot emit a malformed label: `commitKindOfSubject` always returns S, P or H, so `label` is always a letter plus an optional number. The defensive branches above exist for payload shapes the server does not currently produce.

## Screen hooks

- Node label: `#topo-svg-wrap svg text.topo-node-label[data-sha=<sha7>]` — `y="70"` (devY 52 + 18), `font-size="9"`, `font-weight="500"`, `fill="var(--ink-3, #6b7280)"`. Absent entirely when the commit has no label.
- Dev node: `#topo-svg-wrap svg circle.topo-dev-node[data-sha=<sha7>]`; hover text is the `textContent` of its `<title>` child, split on `\n`.
- The legend: `#topo-svg-wrap svg text.topo-kind-info`, visible text `(i)`; hover text is the `textContent` of its `<title>` child, split on `\n`. Note `.textContent` of the `<text>` element itself is `(i)` followed by the title's three lines, since the `<title>` is its child — select the `<title>` for the hover and check the `(i)` against the element's first text node.

## Safety-net tests

`regression/direct-controls/j-topo-node-kind.test.js` (added) — six tests, one per criterion, each carrying its `@ac-hash` line. They run the **real** `renderTopoSvg` lifted out of the page with `new Function`, reusing the harness slice 397 established in `regression/gate-merge/j-dev-commit-list.test.js`, so a hand-kept copy of the markup cannot go on passing after the page changes. Every asserted number (the newest node's `cx`, the dashed tail's `x2`, the viewBox width) is read back off the rendered graph rather than restated, so moving the tail or shrinking `rightPad` breaks the test instead of silently sliding the `(i)` out of view.

I tested all six criteria, including the three whose surface is mostly visual (ac-1, ac-2, ac-4) — each has a computed core worth pinning: which string a node gets, that nothing is keyed off `inferred`, and that the `(i)` exists exactly when a node does. What the nodes *look* like — the grey, the 9px, the exact pixel the `(i)` lands on — I left to the browser suite.

**6/6 pass.** Then, although the go-red check is core-lane only, I confirmed each test bites: restoring `S${d.slice_id}` reddened ac-1, ac-2, ac-5 and ac-6; blanking the hover's kind line reddened ac-3 and ac-6; blanking the `(i)`'s title reddened ac-4. Every criterion has at least one mutation that fails it. The file was restored from a byte copy afterwards and re-run: 6/6 green.

Two of those reds were my own fixtures at first, not the code: one subject contained the literal word "null" and tripped my own catch-all, and I had compared two nodes' full attribute strings including their differing `x`. Both fixed in the test, no change to the implementation.

I did **not** look in a browser. The live dashboard serves the main checkout, not this worktree, so my HTML is not on it; and the labels only appear once slice 405's server change is deployed (`launchctl kickstart -k gui/$(id -u)/dev.denorios.dashboard`). Until that restart every node renders with no label — which is exactly the ac-5 path, and it is tested. I ran only this one test file; never the full suite, never the browser suite.

## Commit

Branch `slice/406`, cut from the tip of `main` in this worktree (`24e6891`, slice 405's landing — its `kind`/`label`/`inferred` fields are present, confirmed in `dashboard/server.js:393-398`). One commit, carrying all six `AC:` trailers.

Files changed:
- `dashboard/lcars-dashboard.html` (modified) — 38 insertions, 5 deletions
- `regression/direct-controls/j-topo-node-kind.test.js` (added)
- `bridge/queue/406-DONE.md` (added, this report)

One formatting note worth carrying forward. My first commit put the six `AC:` lines in their own paragraph with `Co-Authored-By:` in a paragraph below, and git's trailer parser silently ignored all six — `git log --format='%(trailers:key=AC)'` came back empty. The merge-gate scan would still have found them (`lib/ac-range-scan.js:21` and the squash path at `bridge/orchestrator.js:9460` both use a line-anchored regex over `%B`, not git's parser), so the gate was never at risk. I amended anyway so the AC lines and `Co-Authored-By` share one final trailer block and git parses all seven. **Slice 405's commit reads the same way — AC lines last.** Anyone hand-inspecting a slice commit with git's own trailer tooling needs them in the last paragraph.

I did not touch `e2e/s-numbering.spec.js`. After this slice its "S350" search finds the string in the node's hover subject rather than under the node; that is Julian's to revisit, as the brief says. I did not run `build-coverage-map` or `build-ac-manifest`, and did not edit `regression/*.lock`.

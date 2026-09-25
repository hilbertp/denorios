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

<!-- ds9:sticker v1 -->

# Every node on dev shows its label from the server, with an (i) that explains S, P and H — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "406"
title: "Every node on dev shows its label from the server, with an (i) that explains S, P and H"
goal: "Every dev node in the QA and Branches graph shows the label the server sends (S402, P402, H), its hover adds what that letter means, and an (i) at the right end of the dev line explains S, P and H in one line each."
from: obrien
to: rom
priority: normal
lane: surface
created: "2026-09-24T21:05:45.753Z"
timeout_min: 20
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-25T19:17:06.777Z"
approval_sig: "0af97b2a31b99a7876ad7ad724ac9cb78d17d9a7e03c5ded9b0b9354de6df8d1"
rom_session_id: "91958dac-0aba-462d-b3ed-2a911b0e7fa2"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-26T00:00:00.000Z"
    durationMs: 832470
    tokensIn: 62
    tokensOut: 37207
    costUsd: 2.7148369999999997
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All six ACs met and verified against the diff: nodes draw the server's label only, the hover and the (i) read one byte-exact meanings table, geometry holds for any commit count, trap respected, 6/6 guards green with all six @ac-hash values recomputed and matching."
total_durationMs: 832470
total_tokensIn: 62
total_tokensOut: 37207
total_costUsd: 2.714837
round: 1
---

### Every node on dev shows its label from the server, with an (i) that explains S, P and H

<!-- Lane: surface. Draws fields that slice 405 already sends, inside one render function of the dashboard page; no server change and no new logic in the system. -->

#### Goal

Philipp, 2026-09-24: "397: yes! do the rewrites". This approves slice 397, "Every node on dev says why it exists: a kind letter, a slice number, and an (i) that explains them"; this slice is the third part of its split.

After it lands, every dev node in the QA and Branches graph shows the label the server sends (S402, P402, H), hovering a node adds what its letter means above today's full-subject line, and an (i) at the right end of the dev line explains S, P and H in one line each.

#### Context

- Depends on slice 405 and is filed with `--depends-on 405`. Slice 405 adds `kind` (S, P or H), `label` (for example S402, P402, H) and `inferred` to each entry of `dev.commits` in GET /api/branch-state. Today an entry holds only sha, full_sha, slice_id, subject and age_s (`dashboard/server.js:486-488`, in `_getGitTips` at :416), passed to the page at :4910-4911. If 405 landed with different field names, use those; the criteria describe the screen.
- Today the text under a node is drawn only when slice_id is set, as `S<slice_id>` (`dashboard/lcars-dashboard.html:11064`, in the dev-dot loop :11043-11065 of `renderTopoSvg` at :10977). So bookkeeping commits read exactly like landings: 9a8e46a "S404: archive…" shows S404, and 3ab96d7 "S402: autocommit…" shows S402.
- A node's hover is an SVG `<title>` child of its dev circle (:11059 for the newest node, :11061 for the others). Its text is built at :11051 as `dev: <sha7> — <subject> · <age>`, with `origin/dev:` on the newest node.
- Right end of the dev line: the newest node sits at `headX` (:11005), its short dashed tail runs to `headX + 28` (:11025), and the graph keeps 72 units of room right of the newest node (`rightPad`, :11000; width at :11002). With no dev commits no node is drawn, only one faint dashed line (:11027).
- The approved 397 puts the (i) "at the right end of the dev branch line … where the nodes end", so it goes inside the graph and uses the same `<title>` hover as the nodes. Its look follows the page's `.queue-info-icon` (:1715, :4671, used at :6907): small, muted grey, `cursor: help`.
- The browser test e2e/s-numbering.spec.js:67-72 looks for "S350" in the graph, using a fixture with no `label`. After this slice it finds "S350" in the node's hover subject, not under the node. That test is Julian's to revisit; Rom does not touch it.
- Slice 397 rewrites the commit rows in the same function (:11068-11092). This slice changes only the graph part (:11043-11066) and adds one table above `commitLabel` (:10957); whichever lands second re-reads the line numbers.
- Restart: this changes only the HTML, so a browser reload shows it. The labels come from slice 405's server change, which needs a dashboard restart after 405 lands (`launchctl kickstart -k gui/$(id -u)/dev.denorios.dashboard`); until then every node shows no label.

#### Out of scope

- Proposed follow-up: each commit's label in the rows under the graph. Slice 397 lists every dev commit there without labels; this slice labels only the graph nodes.
- Not planned: any change to /api/branch-state or to how a commit's kind and label are worked out. Slice 405 owns that.
- Not planned: meanings for letters other than S, P and H (the old brief's F, R and D, and the T that docs/adr/ADR-JULIAN-ALONGSIDE.md:309 proposes for test landings).
- Not planned: marking inferred kinds differently. They look the same as the others.
- Not planned here: the author's name in the label or the hover (the old brief's "H·chris" and "by <author>"). Slice 405 decides what the label says.
- Not planned: labels anywhere outside the dev nodes. The rollback dialog, the DevOps tested-at tag, the origin/main node and the collapsed strip keep their current text.
- Not planned here: stamping a Kind trailer on commits, and the old brief's commit-msg hook.

#### Tasks

1. `dashboard/lcars-dashboard.html`, just above `commitLabel` (:10957): add one table of the three meanings. It is the only place this wording lives; the node hover and the (i) both read from it:
   - S: `a slice landing: the finished work of the slice with that number`
   - P: `pipeline bookkeeping for the slice with that number: archiving its brief or saving files left uncommitted`
   - H: `a hand commit: made directly on dev, not by the slice pipeline`
2. `renderTopoSvg` (:10977), dev-dot loop (:11043-11065), node text at :11064: in place of `S${d.slice_id}`, draw `d.label` when it is a non-empty string, escaped with `_promoteEsc` (:11198).
   - Keep today's position and look: y = devY + 18, font-size 9, weight 500, fill `var(--ink-3, #6b7280)`.
   - Give the `<text>` `class="topo-node-label"` and `data-sha="<sha7>"`.
   - With no label, draw no `<text>`. Neither `d.slice_id` nor `d.inferred` decides the label or its look.
3. Same loop, hover text at :11051:
   - When the node has a label, put a first line above today's text, then a line break (`\n`). The first line is `<label> — <meaning of d.kind>`, or the label alone when `d.kind` is not S, P or H.
   - When the node has no label, keep today's text exactly.
   - Add `class="topo-dev-node"` and `data-sha="<sha7>"` to both dev circles (:11059, :11061).
4. Same function, after the loop and before `svg += '</svg>'` (:11066), only when `n > 0`: draw the (i) as an SVG `<text class="topo-kind-info">(i)</text>` at x = headX + 38, y = devY + 3.5, `text-anchor="start"`, font-size 10, fill `var(--ink-3, #6b7280)`, with a `<title>` child.
   - The `<title>` holds three lines, `S — <meaning>`, `P — <meaning>` and `H — <meaning>`, built from the table in task 1 and joined by `\n`.
   - Add `.topo-kind-info { cursor: help; }` next to the `.topo-svg-wrap` rules (:2240).

Write a safety-net test only for a criterion that asserts behaviour; otherwise write none, then stop.

#### Traps

1. Leave `commitLabel()` and `commitTagBySha()` (:10957-10975) alone. They feed the rollback dialog (:8839, :8862, :8890, :11301, :11397) and the DevOps tested-at tag (:9276). Switching them to the new label would change those panels' "S402 · abc1234" text, and no criterion here would catch it.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-406-ac-1: With the QA and Branches panel open, every dev node whose commit /api/branch-state sends with a label shows exactly that label beneath the node, the newest node included, in the same place, size and colour as today's S<id> text: S402 for a slice landing, P402 for pipeline bookkeeping, H for a hand commit; a commit sent with slice_id 402 and label P402 shows P402, never S402.
- slice-406-ac-2: Two commits sent identical except for their sha and inferred (true on one, false on the other) look the same: the same label text, colour, font size and weight beneath their nodes, hover text that differs only in the sha, and no extra mark on either node.
- slice-406-ac-3: Hovering a dev node whose commit is sent with a label and a kind of S, P or H shows exactly two lines: first "<label> — <meaning>", where the meaning is that kind's line in the (i) without its leading "S — ", "P — " or "H — " (so label S402 with kind S reads "S402 — a slice landing: the finished work of the slice with that number"); second, exactly today's text "dev: <sha7> — <full subject> · <age>" ("origin/dev:" on the newest node), with the subject never shortened.
- slice-406-ac-4: Whenever the graph draws at least one dev node, an "(i)" is drawn inside the graph at the right end of the dev line: right of the newest dev node and clear of the short dashed line after it, level with the dev nodes, and wholly inside the graph's visible area; hovering it shows exactly three lines in this order: "S — a slice landing: the finished work of the slice with that number", "P — pipeline bookkeeping for the slice with that number: archiving its brief or saving files left uncommitted", "H — a hand commit: made directly on dev, not by the slice pipeline". With no dev commits (dev.commits empty) no (i) is drawn.
- slice-406-ac-5: A dev commit sent with no label (field missing, null or empty) shows no text beneath its node even when its slice_id is set, its hover is exactly today's single line "dev: <sha7> — <subject> · <age>", the other nodes keep their labels, and the browser console shows no error.
- slice-406-ac-6: A dev commit sent with a label but with a kind other than S, P or H, or with no kind, shows its label beneath the node, and its hover's first line is the label alone, never containing "undefined" or "null" and never ending in " — ", followed by today's text as its second line.

#### Screen hooks

Starting state for every criterion: the QA and Branches panel is expanded (`#topo-panel` without `.topo-collapsed`; localStorage `ops:topo-collapsed` unset), and /api/branch-state is stubbed the way e2e/s-numbering.spec.js:28-52 does it, with the fixture commits in both `dev.commits` and `github.dev_commits`, oldest first.

- slice-406-ac-1: node label = `#topo-svg-wrap svg text.topo-node-label[data-sha=<sha7>]` (its y 18 below the node, font-size 9, fill `var(--ink-3, #6b7280)`); dev node = `#topo-svg-wrap svg circle.topo-dev-node[data-sha=<sha7>]`. Fixture: an S commit (label S401, kind S), a P commit (slice_id 402, label P402, kind P) and an H commit (slice_id null, label H, kind H), the H one newest.
- slice-406-ac-2: the same selectors; compare the two nodes' `text.topo-node-label` attributes and their hover text with the sha taken out. Fixture: two commits identical except for sha and `inferred`.
- slice-406-ac-3: hover text = the textContent of the `<title>` child of `circle.topo-dev-node[data-sha=<sha7>]`, split on `\n`. Fixture: one commit of each kind, the newest among them, one with a 200-character subject.
- slice-406-ac-4: `#topo-svg-wrap svg text.topo-kind-info` (text "(i)"); hover text = the textContent of its `<title>` child, split on `\n`; position from getBoundingClientRect against the newest `circle.topo-dev-node`, the dashed tail `#topo-svg-wrap svg line[stroke-dasharray="5 4"]` and the `svg`. Second fixture: `dev.commits` empty and `commits_ahead_of_main` 0.
- slice-406-ac-5: `text.topo-node-label[data-sha=<sha7>]` is absent for each unlabelled commit, and the `<title>` of its `circle.topo-dev-node[data-sha=<sha7>]` is one line; console errors collected from page load. Fixture: three commits with slice_id set and label missing, null and "", next to one labelled commit.
- slice-406-ac-6: the same selectors as ac-1 and ac-3. Fixture: one commit with label "T402" and kind "T", and one with label "S402" and no kind field.

#### Files expected to change

- dashboard/lcars-dashboard.html (modified)
- regression/direct-controls/j-topo-node-kind.test.js (added). Only if Rom writes a safety-net test; the name is his to choose.

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-406-ac-1: With the QA and Branches panel open, every dev node whose commit /api/branch-state sends with a label shows exactly that label beneath the node, the newest node included, in the same place, size and colour as today's S<id> text: S402 for a slice landing, P402 for pipeline bookkeeping, H for a hand commit; a commit sent with slice_id 402 and label P402 shows P402, never S402.
    AC: slice-406-ac-2: Two commits sent identical except for their sha and inferred (true on one, false on the other) look the same: the same label text, colour, font size and weight beneath their nodes, hover text that differs only in the sha, and no extra mark on either node.
    AC: slice-406-ac-3: Hovering a dev node whose commit is sent with a label and a kind of S, P or H shows exactly two lines: first "<label> — <meaning>", where the meaning is that kind's line in the (i) without its leading "S — ", "P — " or "H — " (so label S402 with kind S reads "S402 — a slice landing: the finished work of the slice with that number"); second, exactly today's text "dev: <sha7> — <full subject> · <age>" ("origin/dev:" on the newest node), with the subject never shortened.
    AC: slice-406-ac-4: Whenever the graph draws at least one dev node, an "(i)" is drawn inside the graph at the right end of the dev line: right of the newest dev node and clear of the short dashed line after it, level with the dev nodes, and wholly inside the graph's visible area; hovering it shows exactly three lines in this order: "S — a slice landing: the finished work of the slice with that number", "P — pipeline bookkeeping for the slice with that number: archiving its brief or saving files left uncommitted", "H — a hand commit: made directly on dev, not by the slice pipeline". With no dev commits (dev.commits empty) no (i) is drawn.
    AC: slice-406-ac-5: A dev commit sent with no label (field missing, null or empty) shows no text beneath its node even when its slice_id is set, its hover is exactly today's single line "dev: <sha7> — <subject> · <age>", the other nodes keep their labels, and the browser console shows no error.
    AC: slice-406-ac-6: A dev commit sent with a label but with a kind other than S, P or H, or with no kind, shows its label beneath the node, and its hover's first line is the label alone, never containing "undefined" or "null" and never ending in " — ", followed by today's text as its second line.

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

**Lane:** surface. Checked against the surface rules: no server change, no API endpoint or
response touched (`dashboard/server.js` is not in the diff), no git operation, no gate wiring,
no state. The two new conditionals (`if (label)` at :11095 and `if (n > 0)` at :11098) are draw
guards inside `renderTopoSvg` — they decide whether a glyph is emitted, not what the system
does — and both are prescribed verbatim by the brief's tasks 2 and 4. Not a lane mismatch.
The surface report's four headings are all present (`## Summary`, `## What changed`,
`## Screen hooks`, `## Commit`); `## Safety-net tests` is extra and welcome, not required.

**AC Check:**

- **slice-406-ac-1** → ✓ Satisfied. `dashboard/lcars-dashboard.html:11095` draws
  `text.topo-node-label` from `label` only, at `y="${devY + 18}"`, `font-size="9"`,
  `font-weight="500"`, `fill="var(--ink-3, #6b7280)"` — byte-identical position/size/colour to
  the `S${d.slice_id}` line it replaces. The statement sits outside the `isHead`/else split
  (:11086 vs :11088), so the newest node is labelled too. `slice_id` is read nowhere in the
  label path, so a commit with `slice_id: 402, label: 'P402'` can only render P402; I
  re-ran the guard and `allNodeLabels` came back `['S401','P402','H']` with no `S402` anywhere.
- **slice-406-ac-2** → ✓ Satisfied, and structurally rather than by accident: `grep -n inferred
  dashboard/lcars-dashboard.html` returns exactly one hit, and it is inside a comment (:11092).
  No attribute, class or extra glyph can be keyed off a field the renderer never reads. The
  two nodes' hovers differ only in `sha7`, which is the only other input that differs.
- **slice-406-ac-3** → ✓ Satisfied. `:11077` composes `kindLine + today's tip`, and today's tip
  string (`:11078`) is unchanged from the previous revision — `origin/dev`/`dev` prefix, full
  `_promoteEsc(d.subject)` with no truncation, `· ${age}`. The 200-character fixture subject
  survives whole. The requirement that the hover's meaning equal the (i)'s line minus its
  `"S — "` prefix is guaranteed, not coincidental: both sides read `KIND_MEANINGS`.
- **slice-406-ac-4** → ✓ Satisfied. `:11101` draws `text.topo-kind-info` reading `(i)` at
  `x = headX + 38`, `y = devY + 3.5`, `text-anchor="start"`, `font-size="10"`. Geometry holds for
  every `n`, not just the fixtures: `W = round(headX + rightPad)` = `headX + 72` (:11017), so the
  (i) always starts 38 units right of the newest node, 10 units clear of the dashed tail's end at
  `headX + 28` (:11046), with 34 units of room for a ~15-unit string — inside the viewBox at any
  commit count. `y = 55.5` puts a font-size-10 baseline's optical centre on `devY = 52`, level
  with the nodes. I verified the three `<title>` lines byte-exactly against the AC prose,
  including the U+2014 em dash and single spaces:
  `"S — a slice landing: …"`, `"P — pipeline bookkeeping … left uncommitted"`,
  `"H — a hand commit: … not by the slice pipeline"` — exact match, in that order, and
  `Object.keys(KIND_MEANINGS)` is exactly `S,P,H` (no F/R/D/T leaking in from the old brief).
  The `if (n > 0)` guard means empty `dev.commits` draws no (i).
- **slice-406-ac-5** → ✓ Satisfied. `typeof d.label === 'string'` (:11074) makes missing, `null`
  and `''` all collapse to `label = ''`; `if (label)` then emits no `<text>` and `kindLine` is
  `''`, so the hover is the single pre-existing line. No throw path: `KIND_MEANINGS[undefined]`
  is a plain miss, so no console error. Neighbouring labelled nodes are unaffected (the label is
  per-iteration).
- **slice-406-ac-6** → ✓ Satisfied. `kindMeaning()` (:10973) returns `''` for any kind not in the
  table, so `kindLine` degrades to the bare label — the ternary at :11077 omits the ` — `
  separator along with the meaning, which is why the first line can neither end in a dangling
  dash nor read `S402 — undefined`. The `typeof … === 'string'` test (rather than truthiness)
  also means a kind naming an inherited property (`toString`) reads as no meaning instead of
  stringifying a function into the tooltip. That case is inside AC-6's wording ("a kind other
  than S, P or H"), so it is covered criterion, not pinned dead code.

**Intent:** achieved. The slice exists because `S<slice_id>` was rebuilt client-side, so slice
402's bookkeeping commit printed the same text as the landing it filed. The fix removes the
rebuild entirely — `slice_id` no longer reaches the label — rather than special-casing the
bookkeeping shape, which is the difference between fixing the distortion and hiding one instance
of it. The single-table design (`KIND_MEANINGS` read by both the node hover and the (i)) means
the legend cannot drift from what a node says about itself, which is the part of the goal that a
weaker implementation would have satisfied with two copies of the prose.

**Scope:** clean. Three files: `dashboard/lcars-dashboard.html`, the new guard, and this slice's
DONE report — exactly the brief's "Files expected to change". Nothing outside the graph branch of
`renderTopoSvg` plus one CSS rule. No existing content lost: the only removals are the five lines
the new label/hover/circle code replaces.

**Trap 1:** respected, verified against the diff rather than the report —
`git diff HEAD~1 HEAD -- dashboard/lcars-dashboard.html | grep -E '^[-+].*(commitLabel|commitTagBySha|commitSliceIdBySha)'`
returns nothing. The rollback dialog and the DevOps tested-at tag keep their `S402 · abc1234`.

**Linting:** N/A — this repo has no linter configured (`npx eslint` fails with "couldn't find an
eslint.config.*", there is no `.eslintrc*`, and `package.json` has no `lint` script). Syntax is
clean: `node --check` passes on the new guard, and the changed page functions parse (the guard
`new Function`s them out of the page and runs them).

**Safety-net tests / screen hooks:** PASS.
- `regression/direct-controls/j-topo-node-kind.test.js` — ran it: **6/6 green**. I ran only this
  file; no suite, no browser suite, no lock builders.
- The harness lifts the **real** `renderTopoSvg` (plus `formatAgeShort`, `_promoteEsc`,
  `_ghReconciling`, `KIND_MEANINGS`, `kindMeaning`) out of `lcars-dashboard.html` by brace-match,
  so a hand-kept copy of the markup cannot keep passing after the page moves. Not hollow: the
  assertions are `deepEqual` over extracted strings, and a regex that stopped matching would
  surface as `[]` against a populated expectation, not as a silent pass.
- All six tests are tagged `slice-406-ac-N` in their titles and carry an `@ac-hash` line. I
  recomputed all six with the manifest's own algorithm (`sha256` over `replace(/[ \t]+/g,' ').trim()`,
  per `scripts/build-ac-manifest.js:52-57`) against the AC prose in the commit trailers: **all six
  match**. No stale or short hashes.
- AC-4's geometry assertions read `cx`, the tail's `x2` and the viewBox width back off the
  rendered graph instead of restating them, so moving the tail or shrinking `rightPad` reddens the
  guard rather than sliding the (i) out of sight. Good instinct.
- Break-it: not required in the surface lane, but Rom ran it and named which mutation reddened
  which criterion (restoring `S${d.slice_id}` → ac-1, ac-2, ac-5, ac-6; blanking the hover's kind
  line → ac-3, ac-6; blanking the (i)'s title → ac-4). Every criterion has at least one mutation
  that fails it. He also owned up to two fixture bugs of his own rather than calling them code
  bugs — that is the honest version of this section.
- Count: six tests, one per criterion, no extras.
- Screen hooks exist in the shipped page, each found by hand: `text.topo-node-label[data-sha]`
  (:11095), `circle.topo-dev-node[data-sha]` (:11086 and :11088 — both branches, not just the
  head), `text.topo-kind-info` (:11101), `.topo-kind-info { cursor: help; }` (:2247, inside the
  topo block beside `.topo-svg-wrap`, not in a mode-scoped or media-query branch). Starting state
  is written down in the brief's Screen hooks section.
- No safety-net test needed moving: the two existing guards that touch this function
  (`regression/gate-merge/j-dev-commit-list.test.js`, which asserts the commit **rows**, and
  `j-merge-truth-now.test.js`, which pins the source string `if (mainSha && reconciling)`) are both
  untouched by this diff. So no Test-Update trailer is owed and the absent
  `## Tests moved or weakened` heading is correct, not an omission.

**Flags (not findings):**

1. **For Julian.** `<text class="topo-kind-info">(i)<title>…</title></text>` (:11101) is the first
   `<title>` in this page to sit inside a `<text>` element and to follow a text node — the other
   five all sit alone inside a `<circle>`/`<path>`. It should be fine (Blink looks up the first
   *element* child of type `SVGTitleElement`, which skips the `(i)` text node), and the node
   hovers use the proven pattern, but the (i)'s tooltip is worth one real hover in the browser
   rather than an assumption. AC-4's hover half is the only claim in this slice I could not settle
   by reading. Also note Rom's caveat: `textContent` of the `<text>` is `(i)` plus the title's
   three lines, so select the `<title>` for the hover text.
2. **For Julian.** `e2e/s-numbering.spec.js:67-72` still passes but no longer tests what its
   comment says: its fixture sends no `label`, so after this slice `graph.textContent()` finds
   "S350" in the node's *hover subject*, not in a label under the node. The comment "This label is
   UI-DERIVED from slice_id" is now false. Rom correctly did not touch it — the brief assigns it
   to you.
3. **For O'Brien.** Trap 1 has no guard behind it. Surface lane does not ask for one, and Rom was
   right to stop, but nothing goes red if a later slice points `commitLabel()` at the new label
   and quietly changes the rollback dialog's and the DevOps tag's text. Worth one line in a future
   brief if those two panels matter.
4. **For Philipp / O'Brien, deployment order.** AC-5 deliberately removes the old fallback, so
   between this slice landing and the dashboard restart
   (`launchctl kickstart -k gui/$(id -u)/dev.denorios.dashboard`) **every node in the graph shows
   no label at all** — the S-numbers vanish rather than degrade. The brief anticipates this and
   AC-5 mandates it, so it is not a finding against Rom; it is a restart that must not be
   forgotten, and it is the same restart slice 405 already needs.
5. `data-sha="${sha7}"` is interpolated unescaped, as `sha7` already was inside the `<title>` text
   before this slice. It is a 7-char hex from `git log`, so there is nothing to escape; noted only
   so the next reader does not have to re-derive it.

## Rom's DONE report

#### Summary

Every dev node in the QA and Branches graph now draws the label slice 405's server sends — `S402` for a landing, `P402` for the bookkeeping that filed it, `H` for a hand commit — instead of rebuilding `S<slice_id>` from the slice number. That was the whole distortion: slice 402's `autocommit` commit carries slice_id 402, so the old renderer printed S402 under it, the same text as the landing. Hovering a labelled node now adds one line above today's line saying what its letter means, and an `(i)` at the right end of the dev line explains all three letters at once.

The three sentences live in exactly one table (`KIND_MEANINGS`), which both the node hover and the `(i)` read, so the legend cannot drift from what a node says about itself. No server change; no change to how a kind or label is worked out. All six acceptance criteria are met.

#### What changed

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

#### Screen hooks

- Node label: `#topo-svg-wrap svg text.topo-node-label[data-sha=<sha7>]` — `y="70"` (devY 52 + 18), `font-size="9"`, `font-weight="500"`, `fill="var(--ink-3, #6b7280)"`. Absent entirely when the commit has no label.
- Dev node: `#topo-svg-wrap svg circle.topo-dev-node[data-sha=<sha7>]`; hover text is the `textContent` of its `<title>` child, split on `\n`.
- The legend: `#topo-svg-wrap svg text.topo-kind-info`, visible text `(i)`; hover text is the `textContent` of its `<title>` child, split on `\n`. Note `.textContent` of the `<text>` element itself is `(i)` followed by the title's three lines, since the `<title>` is its child — select the `<title>` for the hover and check the `(i)` against the element's first text node.

#### Safety-net tests

`regression/direct-controls/j-topo-node-kind.test.js` (added) — six tests, one per criterion, each carrying its `@ac-hash` line. They run the **real** `renderTopoSvg` lifted out of the page with `new Function`, reusing the harness slice 397 established in `regression/gate-merge/j-dev-commit-list.test.js`, so a hand-kept copy of the markup cannot go on passing after the page changes. Every asserted number (the newest node's `cx`, the dashed tail's `x2`, the viewBox width) is read back off the rendered graph rather than restated, so moving the tail or shrinking `rightPad` breaks the test instead of silently sliding the `(i)` out of view.

I tested all six criteria, including the three whose surface is mostly visual (ac-1, ac-2, ac-4) — each has a computed core worth pinning: which string a node gets, that nothing is keyed off `inferred`, and that the `(i)` exists exactly when a node does. What the nodes *look* like — the grey, the 9px, the exact pixel the `(i)` lands on — I left to the browser suite.

**6/6 pass.** Then, although the go-red check is core-lane only, I confirmed each test bites: restoring `S${d.slice_id}` reddened ac-1, ac-2, ac-5 and ac-6; blanking the hover's kind line reddened ac-3 and ac-6; blanking the `(i)`'s title reddened ac-4. Every criterion has at least one mutation that fails it. The file was restored from a byte copy afterwards and re-run: 6/6 green.

Two of those reds were my own fixtures at first, not the code: one subject contained the literal word "null" and tripped my own catch-all, and I had compared two nodes' full attribute strings including their differing `x`. Both fixed in the test, no change to the implementation.

I did **not** look in a browser. The live dashboard serves the main checkout, not this worktree, so my HTML is not on it; and the labels only appear once slice 405's server change is deployed (`launchctl kickstart -k gui/$(id -u)/dev.denorios.dashboard`). Until that restart every node renders with no label — which is exactly the ac-5 path, and it is tested. I ran only this one test file; never the full suite, never the browser suite.

#### Commit

Branch `slice/406`, cut from the tip of `main` in this worktree (`24e6891`, slice 405's landing — its `kind`/`label`/`inferred` fields are present, confirmed in `dashboard/server.js:393-398`). One commit, carrying all six `AC:` trailers.

Files changed:
- `dashboard/lcars-dashboard.html` (modified) — 38 insertions, 5 deletions
- `regression/direct-controls/j-topo-node-kind.test.js` (added)
- `bridge/queue/406-DONE.md` (added, this report)

One formatting note worth carrying forward. My first commit put the six `AC:` lines in their own paragraph with `Co-Authored-By:` in a paragraph below, and git's trailer parser silently ignored all six — `git log --format='%(trailers:key=AC)'` came back empty. The merge-gate scan would still have found them (`lib/ac-range-scan.js:21` and the squash path at `bridge/orchestrator.js:9460` both use a line-anchored regex over `%B`, not git's parser), so the gate was never at risk. I amended anyway so the AC lines and `Co-Authored-By` share one final trailer block and git parses all seven. **Slice 405's commit reads the same way — AC lines last.** Anyone hand-inspecting a slice commit with git's own trailer tooling needs them in the last paragraph.

I did not touch `e2e/s-numbering.spec.js`. After this slice its "S350" search finds the string in the node's hover subject rather than under the node; that is Julian's to revisit, as the brief says. I did not run `build-coverage-map` or `build-ac-manifest`, and did not edit `regression/*.lock`.

## Nog's verdict and review

_None recorded._

## Julian's result

_Julian's stage has not recorded a result for this slice yet._

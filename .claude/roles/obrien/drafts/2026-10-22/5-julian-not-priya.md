# The crew list shows Julian, the name Philipp chose

<!-- Lane: surface (docs/adr/ADR-PROOF-LANES.md). What the screen says; no branch of logic changes. Shakedown slice 5 of 5; the only one that touches the screen. -->

## What is broken / Goal

The Ops crew list shows the QA engineer as "Priya" in light mode. Philipp decided on 2026-09-03 that the QA engineer is Julian (`docs/ROLE-RENAME-PLAN.md` §1), every contract and overlay message says Julian, and `docs/HOW-A-SLICE-TRAVELS.md` has carried a parenthesis apologising for the mismatch since September. Rename slice R3 will replace the whole role table with `bridge/roles.json`; until then the one name is wrong on the screen. After this lands the crew tile, the owner chips and the person labels say Julian.

## Why (evidence)

- `dashboard/lcars-dashboard.html:6986`: `<div class="crew-name">Priya</div>` inside `.crew-card[data-role="bashir"]` (line 6984).
- `dashboard/lcars-dashboard.html:9589`: `bashir: { lore: 'Bashir', name: 'Priya', white: 'QA Engineer', lcarsRole: 'QA Engineer' }` in the `ROLE` map that `personName`, `ownerChip` and `roleTitle` read.
- `bridge/roles.json` (the map R1 will load) already says Julian for `qa`.
- `regression/direct-controls/j-direct-controls-regression-coverage.test.js:369-381` asserts the light-mode label is "Priya" and that the ROLE map carries `name: 'Priya'`; the test guards that the card shows a human first name in light mode and the DS9 name only in the skin, which stays true with Julian.
- `e2e/lcars-mode.spec.js:52` and `:63` expect the bashir tile to read "Priya". Those are Julian's browser tests; he moves them at his stage.
- `grep -n Priya dashboard/server.js bridge/roles.json` finds nothing; the name lives only in the page.

## Tasks

1. In `dashboard/lcars-dashboard.html`, change the crew tile text at line 6986 and the `name` field of the `bashir` entry at line 9589 from `Priya` to `Julian`. Change nothing else in the ROLE map and nothing in the LCARS-mode name (`lore: 'Bashir'` stays).
2. Move the two assertions in `regression/direct-controls/j-direct-controls-regression-coverage.test.js` (around lines 378-381) from `Priya` to `Julian`, keeping them exactly as strict (a literal name match, not a looser pattern). List the move under `## Tests moved or weakened` as reworded.
3. Under `## Tests moved or weakened`, also list `e2e/lcars-mode.spec.js:52` and `:63` as browser tests that will read red until Julian moves them; do not edit them.

Write a safety-net test only for a criterion that asserts behaviour; otherwise write none, then stop.

## Screen hooks

- slice-NNN-ac-1: crew tile name = `.crew-card[data-role="bashir"] .crew-name`; visible on the Ops page in light mode with any register, including an empty one.
- slice-NNN-ac-2: Rom to declare (the owner chip and person label that read `ROLE.bashir.name`; name the element and the panel it appears on, and its starting state).

## Traps

1. The LCARS skin must still show "Bashir": only `name` changes, not `lore`. (Note for Rom and Nog; the skin itself is removed by R3.)
2. The served page is a 13,000-line file; a replace-all of `Priya` is the right tool, but confirm the count is exactly two before committing.

## What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

## Acceptance criteria

- slice-NNN-ac-1: On the served Ops page in light mode, the crew tile for the QA engineer reads `Julian` and its role line still reads `QA Engineer`; the string `Priya` does not occur anywhere in `dashboard/lcars-dashboard.html`.
- slice-NNN-ac-2: Every label that reads `ROLE.bashir.name` (owner chips, person labels, the crew dossier header) shows `Julian` in light mode and `Bashir` in the LCARS skin.
- slice-NNN-ac-3: `regression/direct-controls/j-direct-controls-regression-coverage.test.js` passes on the branch with its two name assertions moved to `Julian` and no assertion weakened.

## Quality + goal check

- Goal check: the parenthesis in `docs/HOW-A-SLICE-TRAVELS.md` ("The light-mode crew list currently labels him Priya") becomes false; Alex removes it afterwards.
- Quality check: two lines in the page, two assertions in one test; no other name, chip or skin behaviour changes; no new safety-net test (no criterion asserts behaviour).

## Files expected to change

- `dashboard/lcars-dashboard.html` (modified: two lines)
- `regression/direct-controls/j-direct-controls-regression-coverage.test.js` (modified: two assertions reworded)

## Custody

No criterion is retired. The two assertion moves are rewordings at equal strictness and need no trailer; if the gate reads either as loosened, stop and escalate to Alex rather than declare it. Julian's two browser assertions are his to move at his stage.

## REQUIRED — declare the ACs as commit trailers

    AC: slice-NNN-ac-1: On the served Ops page in light mode, the crew tile for the QA engineer reads `Julian` and its role line still reads `QA Engineer`; the string `Priya` does not occur anywhere in `dashboard/lcars-dashboard.html`.
    AC: slice-NNN-ac-2: Every label that reads `ROLE.bashir.name` (owner chips, person labels, the crew dossier header) shows `Julian` in light mode and `Bashir` in the LCARS skin.
    AC: slice-NNN-ac-3: `regression/direct-controls/j-direct-controls-regression-coverage.test.js` passes on the branch with its two name assertions moved to `Julian` and no assertion weakened.
    Lane: surface

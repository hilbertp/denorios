# The docs taxonomy describes the folders that exist

<!-- Lane: surface (docs/adr/ADR-PROOF-LANES.md). A document says what is true. Shakedown slice 3 of 5. -->

## What is broken / Goal

`docs/README.md` is the map of the documentation, and it is wrong: it lists `obrien/` and `ziyal/` folders that do not exist, omits `e2e-journeys/` and `ruflo/` which do, and says new ADRs go in `architecture/` while the last seven went in `adr/`. After this lands the table names every folder that exists, says what each holds, and sends a new ADR where the recent ones actually live.

## Why (evidence)

- `ls -d docs/*/`: `adr/`, `architecture/`, `contracts/`, `e2e-journeys/`, `ruflo/`, `runbooks/`. No `obrien/`, no `ziyal/`.
- `docs/README.md` table rows: `obrien/` ("O'Brien's working docs"), `ziyal/` ("Ziyal's design briefs"); `adr/` is called "legacy single-doc location" and the rule says "New ADRs go in `architecture/` with `-ADR` suffix".
- `docs/adr/` holds 7 files, the newest `ADR-JULIAN-ALONGSIDE.md` (2026-09-24) and `ADR-PROOF-LANES.md` (2026-09-07), all prefixed `ADR-`; `docs/architecture/` holds 6 files, the newest from June (`WORMHOLE-ADR.md`, the Bet 2 and Bet 3 documents).
- `docs/e2e-journeys/INDEX.md` and 16 journey files are Julian's; `docs/ruflo/` holds the May 2026 Ruflo findings. Neither is in the table.
- Top-level docs not in any folder: `CONTRIBUTOR-GUIDE.md`, `FEATURES.md`, `HOW-A-SLICE-TRAVELS.md`, `HISTORY.md`, `ROLE-RENAME-PLAN.md`, `SPRINT3-SCOPE.md`, `git-strategy.md`.

## Tasks

1. Rewrite the folder table in `docs/README.md` so it has one row per existing folder: `adr/` (decision records, `ADR-<NAME>.md`; where a new ADR goes), `architecture/` (the Bet-era architecture documents and the two older `-ADR` files; no new files), `contracts/` (unchanged text), `runbooks/` (unchanged text), `e2e-journeys/` (Julian's user journeys, one file per journey, `INDEX.md` first), `ruflo/` (the May 2026 Ruflo investigation; closed). Remove the `obrien/` and `ziyal/` rows.
2. Rewrite "Where to put new docs" to match: a decision goes in `adr/` as `ADR-<NAME>.md`; a role's working notes go in that role's folder under `.claude/roles/<role>/`, not under `docs/`.
3. Add one line listing the top-level files and what each is for (the seven named above), so a reader knows they are not strays.

Write a safety-net test only for a criterion that asserts behaviour; otherwise write none, then stop.

## Traps

1. `docs/contracts/` is Layer-2 locked and Philipp's to edit; this slice changes only `docs/README.md`.

## What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

## Acceptance criteria

- slice-NNN-ac-1: `docs/README.md` names exactly the six folders that exist under `docs/` (`adr`, `architecture`, `contracts`, `e2e-journeys`, `ruflo`, `runbooks`), one row each, and names no folder that does not exist.
- slice-NNN-ac-2: `docs/README.md` says a new ADR goes in `docs/adr/` as `ADR-<NAME>.md`, and no longer says new ADRs go in `architecture/`.
- slice-NNN-ac-3: `docs/README.md` lists the seven top-level documents by name with one clause each.

## Quality + goal check

- Goal check: a newcomer reading `docs/README.md` can find the newest ADR and Julian's journeys without guessing.
- Quality check: one file changed; prose only; no test written.

## Files expected to change

- `docs/README.md` (modified)

## Custody

No criterion is retired or reworded. No trailer is authorized or needed.

## REQUIRED — declare the ACs as commit trailers

    AC: slice-NNN-ac-1: `docs/README.md` names exactly the six folders that exist under `docs/` (`adr`, `architecture`, `contracts`, `e2e-journeys`, `ruflo`, `runbooks`), one row each, and names no folder that does not exist.
    AC: slice-NNN-ac-2: `docs/README.md` says a new ADR goes in `docs/adr/` as `ADR-<NAME>.md`, and no longer says new ADRs go in `architecture/`.
    AC: slice-NNN-ac-3: `docs/README.md` lists the seven top-level documents by name with one clause each.
    Lane: surface

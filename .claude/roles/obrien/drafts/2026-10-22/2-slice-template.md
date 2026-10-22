# The slice template that nothing reads goes

<!-- Lane: surface (docs/adr/ADR-PROOF-LANES.md). Deletes a document no code reads. Shakedown slice 2 of 5. -->

## What is broken / Goal

`bridge/templates/slice.md` presents itself as the slice template, and it is wrong on every field the slice tool enforces: it offers priorities `low | normal | high | spike` where the tool accepts `normal | high | critical`, it carries `references:` where the tool writes `amendment:`, and it has no `lane`. No code reads it; `bridge/new-slice.js` builds its default body inline. After this lands the file is gone and the only template is the tool.

## Why (evidence)

- `bridge/templates/slice.md` lines 1-20: `priority: low | normal | high | spike`, `references: null`, no `lane`. `bridge/new-slice.js:91-93`: `VALID_PRIORITIES = ['normal', 'high', 'critical']`, `VALID_LANES = ['surface', 'core']`; `buildFrontmatter` (lines 226-243) writes `amendment` and `lane`, never `references`.
- `grep -rn "templates/" bridge/*.js dashboard/server.js scripts/*.js lib/*.js` finds only the QA prompt templates and `report.md`; nothing names `slice.md`. The only mentions anywhere are two archived reports from April (`bridge/queue/075-DONE.md`, `bridge/trash/126-DONE.md`).
- `docs/contracts/slice-format.md` already says: "O'Brien never writes frontmatter by hand. All slices must be created via `bridge/new-slice.js`." A template for hand-written frontmatter contradicts the contract.
- Bucket: INERT (`lib/tests-needed.js` `bucketOf`: a `.md` outside the policed paths).

## Tasks

1. `git rm bridge/templates/slice.md`.
2. Confirm `bridge/templates/report.md`, `bashir-prompt.md` and `bashir-non-gate-prompt.md` are untouched and still named by their readers (`grep -n "templates/" bridge/orchestrator.js`).
3. Confirm `node bridge/new-slice.js --title t --goal g --lane surface` with a staged directory redirected to a temp dir (`DS9_STAGED_DIR`) still writes a file with a default body; delete that temp file.

Write a safety-net test only for a criterion that asserts behaviour; otherwise write none, then stop.

## Traps

1. `package.json` `files` lists `bridge/templates/` for packaging; the directory stays, only `slice.md` goes.

## What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

## Acceptance criteria

- slice-NNN-ac-1: `bridge/templates/slice.md` does not exist on the slice branch; `bridge/templates/report.md`, `bashir-prompt.md` and `bashir-non-gate-prompt.md` are byte-identical to dev.
- slice-NNN-ac-2: No file under `bridge/`, `dashboard/`, `scripts/`, `lib/`, `docs/` or `.claude/` (queue and trash excluded) names `templates/slice.md`.

## Quality + goal check

- Goal check: the only way to make a slice is `node bridge/new-slice.js`, as the contract says.
- Quality check: one deletion; no test written.

## Files expected to change

- `bridge/templates/slice.md` (deleted)

## Custody

No criterion is retired or reworded. No trailer is authorized or needed.

## REQUIRED — declare the ACs as commit trailers

    AC: slice-NNN-ac-1: `bridge/templates/slice.md` does not exist on the slice branch; `bridge/templates/report.md`, `bashir-prompt.md` and `bashir-non-gate-prompt.md` are byte-identical to dev.
    AC: slice-NNN-ac-2: No file under `bridge/`, `dashboard/`, `scripts/`, `lib/`, `docs/` or `.claude/` (queue and trash excluded) names `templates/slice.md`.
    Lane: surface

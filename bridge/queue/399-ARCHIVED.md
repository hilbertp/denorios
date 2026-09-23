---
id: "399"
title: "Jordan reviews without running the suites, and writes his verdict in one exact shape"
from: rom
to: nog
status: DONE
slice_id: "399"
branch: "slice/399"
completed: "2026-09-24T00:00:00.000Z"
tokens_in: 24
tokens_out: 12753
elapsed_ms: 143982
estimated_human_hours: 0.6
compaction_occurred: false
tokens_cache_read: 527411
cost_usd: 1.0700555
---

## Summary

Jordan's prompt no longer asks him to confirm "no regressions" himself, and now tells him in
so many words not to run the full safety-net suite, the browser suite or the lock builders —
naming `npm test` and `npx playwright test` so there is nothing to interpret. It says who does
run them instead (GitHub on landing, Julian's stage, the Promote button), because a prohibition
without a reason reads as carelessness and gets ignored. The same rule is now a paragraph in
his role file under Gate 2, citing ADR-PROOF-LANES Rule 1.

The verdict file was described in prose only — that is how the closing `---` went missing three
times in two days and cost 388 a whole round on a verdict that was ACCEPTED. The prompt now
shows the entire file, four unindented lines, and states the fence rule in words underneath.

Still FIVE parts. The new sentences live inside Part 1; nothing in `buildNogPrompt`'s
parameters, branches or lane logic moved.

## What changed

- `bridge/nog-prompt.js` — Part 1's review sentence now ends at "test coverage." Two sentences
  follow it: the machines that catch regressions, and the list of what Jordan does not run
  (`npm test`, `node --test regression/`, `npx playwright test`, `build-coverage-map`,
  `build-ac-manifest`) with the permission he does keep — the test files the slice adds or
  changes, and the linter on the changed files.
- `bridge/nog-prompt.js` — after the four verdict values, a complete example of the verdict
  file, emitted as four unindented lines (`---` / `verdict: ACCEPTED` / `summary: "One line."` /
  `---`), then the sentence about the first line and the closing fence. Unindented on purpose:
  an example indented five spaces to match the verdict list would be an example whose lines are
  not `---`, which is exactly the mistake being fixed.
- `.claude/roles/nog/ROLE.md` — a paragraph headed **What Nog does not run**, sitting directly
  after the five-item test-honesty list under Gate 2 and before "What Nog never rejects for",
  carrying the same rule and citing `docs/adr/ADR-PROOF-LANES.md` Rule 1.
- `regression/authoring-staging/j-reviewer-runs-nothing.test.js` — new, three tests.

## Screen hooks

None. This slice changes a prompt string and a role file; nothing reaches the dashboard.

## Safety-net tests

Three, in `regression/authoring-staging/j-reviewer-runs-nothing.test.js`, one per criterion that
asserts a computed value — the string `buildNogPrompt` returns. AC-4 is a document and gets no
test; Jordan reads it in the diff.

Each test runs all three lanes (`surface`, `core`, and lane-unset, which the orchestrator treats
as core), because the saving a surface slice buys is exactly what one full suite run spends, and
a guard pinning one lane would let the other drift back.

- `slice-399-ac-1` — both suites forbidden by name; the permission to run the slice's own test
  files is asserted too, so the fix cannot land as "run nothing".
- `slice-399-ac-2` — the string "no regressions" is absent, and the three machines are each
  named.
- `slice-399-ac-3` — scans the prompt's lines for a line that is exactly `---` followed by a
  verdict line, a summary line, and a closing line that is exactly `---`. The fixtures are free
  of `---` on purpose: a fence arriving through the slice file or the DONE report would satisfy
  a naive substring check while teaching Jordan nothing.

Ran only this file, plus the two files the traps point at. All green:

- `regression/authoring-staging/j-reviewer-runs-nothing.test.js` — 3/3.
- `regression/authoring-staging/j-lanes.test.js` (trap 1) — 11/11; "FIVE parts", "covering all
  five parts" and Part 5's wording are untouched.
- `test/nog-prompt-vocabulary.test.js` (trap 2) — passes; the four verdict values and their
  one-line descriptions are unchanged, and the example's `verdict: ACCEPTED` does not trip the
  legacy-literal checks.

No break-it check: surface lane. Trap 3 did not fire — no parameter, branch or lane-logic change
was needed, so there is nothing to report BLOCKED.

## Commit

`33f4aff` — S399: Jordan stops running the suites, and gets shown the verdict file
(branch `slice/399`), carrying the four `AC:` trailers and `Lane: surface`.

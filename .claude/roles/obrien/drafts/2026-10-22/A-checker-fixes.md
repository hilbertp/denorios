# Red means something: a removed-coverage declaration covers one source, and the manifest records criterion wording again

<!-- Lane: core (docs/adr/ADR-PROOF-LANES.md). Changes what the merge gate decides. ADR-JULIAN-ALONGSIDE §9 item A, Rule 7 (b) and (c); Rule 7 (a) landed as slice 410. -->

## What is broken / Goal

The merge press is about to become the only suite run in the pipeline (ADR-JULIAN-ALONGSIDE Rule 5). Before that, a red at the press has to mean a real problem. Slice 410 fixed the largest source of false reds: the coverage checker now credits a test that loads a file with `require` or runs it as a child process, not only one that reads it. Two of Rule 7's three faults remain. One `Coverage-Removed` trailer anywhere in the range excuses a coverage drop under every source, so a deleted test in one file can hide behind a declaration about another. And `AC-MANIFEST.lock` has recorded no criterion wording since slice 383 (unchanged through 411), so "an earlier criterion changed" cannot be detected for any recent slice and Julian's At-risk facts and the red report will have nothing to cite.

After this lands: a `Coverage-Removed` trailer clears a guard-count drop only for the source it names, and the gate names every source that shrank undeclared; and every landing records the wording of each criterion it declares, with the hash of that wording, in the manifest.

## Why (evidence)

Line numbers are from dev at 0df8720 (slice 411).

- `lib/tests-needed.js:136-143`: `coverageRemovalDeclared = (trailers.coverageRemoved || []).length > 0`. The `<source>` the trailer names (`parseTrailers`, lines 64-65, `{ source, reason }`) is parsed and then compared with nothing. `gather()` reads only `guardCountOf(lock)` (line 306), one total per lock, so a drop under `dashboard/server.js` and a drop under `lib/x.js` are one number. `docs/contracts/test-update-gate-trailers.md` says the trailer declares the drop "e.g. you deleted a source file and its tests together", which is per source.
- `regression/AC-MANIFEST.lock` on dev: 45 of 375 tags carry `"text"`; `slice-383-ac-1` has text, every tag from 385 to 411 has `"text": null`, including `slice-410-ac-1`. `scripts/build-ac-manifest.js` takes text from `AC:` trailers in history (header, line 9) and from tracked slice AC blocks (line 190). [Likely, to be confirmed by Sam] the sticker format introduced around slice 383 demotes `## Acceptance criteria` to `####` inside `## Brief`, and `lib/ac-block.js` `extractAcSection` (line 89-103) matches only `^##\s+Acceptance criteria`; the trailer path should still have filled the text, so a second cause is possible (the squash commit's trailers, `bridge/orchestrator.js` around the `regenerateLocksAtLanding` call, or the landing order). Sam establishes the root cause and reports it; this brief does not presume it.
- Slice 410 (`bridge/queue/410-ARCHIVED.md`) credits direct `require()` and direct runs and declares transitive loads out of scope on purpose ("a test that loads the orchestrator does not guard what the orchestrator loads"). This slice does not reopen that; the ADR's "directly or indirectly" is Alex's to re-decide with Taylor, not Sam's.
- Rule 7 of `docs/adr/ADR-JULIAN-ALONGSIDE.md` (lines 221-227) is the decision this slice implements.

## Tasks

1. In `lib/tests-needed.js`: `gather()` reads `bySource` from the base lock and the head lock and returns per-source guard counts; `decide()` computes the set of sources whose count fell; a `Coverage-Removed` trailer overrides the drop only for the source it names (exact path, or a path glob through `globToRe` when the value contains `/` or `*`); any source that fell without a matching trailer sets `coverageShrinkUndeclared` and the verdict is `red_flag`. The total-count ratchet stays as a second check. The facts object carries the undeclared sources by path.
2. `scripts/tests-needed.js` prints each undeclared shrunken source by path under the existing coverage line, so the operator and the red report (ADR Rule 6) can name it.
3. Establish why `AC-MANIFEST.lock` has recorded no text since 383 and fix it at the source, so that a landing records, for every tag the landing's `AC:` trailers declare, `text` equal to `normalizeAcText(<the trailer's text>)` and `acHash` equal to `acHashOf(<that text>)`. If the cause is the AC-block parser, teach `extractAcSection` the sticker's `####` heading inside `## Brief` as well as the `##` form; if it is the trailer path, fix that. Do not change `acHashOf` or `normalizeAcText`, and do not touch any existing manifest entry by hand.
4. Move the two existing tests that pin the old shrink rule to the new one: `regression/gate-merge/j-tests-needed-verdict.test.js` ac-15 and ac-16 now pass per-source counts and, for ac-16, a trailer that names the shrunken source. Both stay at least as strict.
5. Do not regenerate or edit `regression/COVERAGE.lock` or `regression/AC-MANIFEST.lock`; the pipeline regenerates both at landing. If task 3 changes what the deriver produces, say in the report that `j-coverage-map-integrity` ac-1 or the manifest integrity test is red on the branch for that reason and green after landing.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

## Traps

1. A `Coverage-Removed` trailer that names a source which did not shrink is not an override for one that did.
2. A base lock written before per-source counting (no `bySource`, or a shape the reader does not know) must read as "no per-source facts", not as a drop under every source and not as a crash; the total-count ratchet still applies.
3. If the recorded `text` and the recorded `acHash` disagree, every live tag reads AC-MUTATED at the next merge: a false red of the very class this slice removes. The hash in the manifest must be computed from the recorded text, by `acHashOf`, in one place.
4. Back-filling text for the 330 tags that have none is not this slice; a tag whose text cannot be found stays `null` with `acHash` as it is, so no historic hash moves.

## What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

## Acceptance criteria

- slice-NNN-ac-1: A `Coverage-Removed: <source> <reason>` trailer clears the guard-count drop for `<source>` only (exact path or path glob); when any other source's guard count fell between the base lock and the head lock with no trailer naming it, `decide()` returns `red_flag` with `coverageShrinkUndeclared` true and lists that source by path in its facts.
- slice-NNN-ac-2: `node scripts/tests-needed.js` prints each undeclared shrunken source by path, and prints none when every drop is declared.
- slice-NNN-ac-3: After a landing in a fixture repository, `regression/AC-MANIFEST.lock` holds, for every tag the landing's `AC:` trailers declared, a non-null `text` equal to `normalizeAcText` of the trailer's text and an `acHash` equal to `acHashOf` of that text; no entry that had `text: null` before the landing has a changed `acHash`; and the DONE report names the root cause of the gap since slice 383 and the commit that introduced it.

## Quality + goal check

- Goal check: after landing, the regenerated manifest carries text for this slice's three tags, and a range that deletes a test under one source while declaring a removal under another reads RED FLAG and names the undeclared source.
- Quality check: no change to `acHashOf` or `normalizeAcText`; no hand edits to either lock; no change to `scripts/build-coverage-map.js` (slice 410's work is not reopened); no new dependency.

## Files expected to change

- `lib/tests-needed.js` (modified)
- `scripts/tests-needed.js` (modified: prints undeclared sources)
- `scripts/build-ac-manifest.js` or `lib/ac-block.js` or `bridge/orchestrator.js` (modified: whichever holds the ac-3 root cause; Sam names which)
- `regression/gate-merge/j-tests-needed-verdict.test.js` (modified: ac-15, ac-16 moved to per-source counts)
- `regression/gate-merge/j-coverage-removed-per-source.test.js` (added: this slice's tests)
- `regression/COVERAGE.lock`, `regression/AC-MANIFEST.lock` (regenerated by the pipeline at landing, not by Sam)

## Custody

No criterion is retired or reworded by this slice. No `Test-Loosen-OK`, `Coverage-Removed` or `AC-Change-OK` trailer is authorized. The ac-15 and ac-16 moves in `j-tests-needed-verdict.test.js` are tightenings and need no trailer; if the gate reads one of them as loosened, stop and escalate to Alex instead of declaring it.

## REQUIRED — declare the ACs as commit trailers

    AC: slice-NNN-ac-1: A `Coverage-Removed: <source> <reason>` trailer clears the guard-count drop for `<source>` only (exact path or path glob); when any other source's guard count fell between the base lock and the head lock with no trailer naming it, `decide()` returns `red_flag` with `coverageShrinkUndeclared` true and lists that source by path in its facts.
    AC: slice-NNN-ac-2: `node scripts/tests-needed.js` prints each undeclared shrunken source by path, and prints none when every drop is declared.
    AC: slice-NNN-ac-3: After a landing in a fixture repository, `regression/AC-MANIFEST.lock` holds, for every tag the landing's `AC:` trailers declared, a non-null `text` equal to `normalizeAcText` of the trailer's text and an `acHash` equal to `acHashOf` of that text; no entry that had `text: null` before the landing has a changed `acHash`; and the DONE report names the root cause of the gap since slice 383 and the commit that introduced it.
    Lane: core

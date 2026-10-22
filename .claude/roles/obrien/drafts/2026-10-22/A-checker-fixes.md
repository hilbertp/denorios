# Red means something: the checker credits require and script runs, a removed-coverage declaration covers one source, and the manifest records criterion wording again

<!-- Lane: core (docs/adr/ADR-PROOF-LANES.md). Changes what the merge gate decides. ADR-JULIAN-ALONGSIDE §9 item A, Rule 7. -->

## What is broken / Goal

The merge press is about to become the only suite run in the pipeline (ADR-JULIAN-ALONGSIDE Rule 5). Before that, a red at the press has to mean a real problem. Today it often means the checker: it calls tested modules "untested" because it credits a test only when the test reads a file with `readFileSync`, not when it loads it with `require` or runs it as a script; one `Coverage-Removed` trailer anywhere in the range excuses a coverage drop under every source; and `AC-MANIFEST.lock` has recorded no criterion wording since slice 383, so "an earlier criterion changed" cannot be detected for any recent slice.

After this lands: a test that loads a behaviour file through `require` (directly or through a repo-internal module) or runs a repo script as a child process is credited to that file in `COVERAGE.lock`; a `Coverage-Removed` trailer clears a guard-count drop only for the source it names; and every landing records the wording of each criterion it declares, with a hash of that wording, in the manifest.

## Why (evidence)

- `scripts/build-coverage-map.js:60-84` (`sourcesReadBy`): the only credited reads are `READ_CONST_RE` and `READ_INLINE_RE`, both `readFileSync` patterns. Nothing credits `require(...)`. Two of the last three red merge runs were this class (runs 34991209808 and 34863455224; commit 77293b1 "fourth false red of this class"; ADR-JULIAN-ALONGSIDE §2 item 9).
- `lib/tests-needed.js:136-143`: `coverageRemovalDeclared = (trailers.coverageRemoved || []).length > 0`. The `<source>` the trailer names (`parseTrailers`, line 64-65, `{ source, reason }`) is parsed and then never compared with anything. `gather()` reads only `guardCountOf(lock)` (line 306), a single total, so a drop under `dashboard/server.js` and a drop under `lib/x.js` are one number.
- `regression/AC-MANIFEST.lock`: 45 of 375 tags carry `"text"`; `slice-383-ac-1` has text, `slice-385-ac-1`, `slice-399-ac-1` and `slice-402-ac-1` have `"text": null`. `scripts/build-ac-manifest.js` takes text from `AC:` trailers in history (header, line 9) and from tracked slice AC blocks (line 190). [Likely, to be confirmed by Sam] the sticker format introduced around slice 383 demotes `## Acceptance criteria` to `####` inside `## Brief`, and the AC-block parser reads only the `##` form; the trailer path should still have filled it, so a second cause is possible (the squash commit's trailers, `bridge/orchestrator.js:9480`, or the landing order at `:9063-9079`). Sam establishes the root cause and reports it; this brief does not presume it.
- Rule 7 of `docs/adr/ADR-JULIAN-ALONGSIDE.md` (lines 221-227) is the decision this slice implements.

## Tasks

1. In `scripts/build-coverage-map.js`, add credit for `require`: for each test file, resolve every `require('<relative path>')` and every `require(path.join(<known const>, ...))` that points inside the repo, follow the required modules' own repo-internal `require`s with a visited set, and credit the test to every BEHAVIOUR-bucketed file reached. Node built-ins and anything under `node_modules/` are never followed or credited. `readFileSync` credit stays as it is.
2. In the same file, add credit for script runs: a test that runs a repo script by path through `execFileSync`, `execSync`, `spawnSync`, `spawn` or `fork` (the path appears as a string literal or a resolved const, e.g. `node scripts/tests-needed.js` or `['scripts/build-ac-manifest.js']`) is credited to that script.
3. Do not regenerate or edit `regression/COVERAGE.lock` or `regression/AC-MANIFEST.lock`; the pipeline regenerates both at landing (`regenerateLocksAtLanding`). State in the report that `j-coverage-map-integrity` ac-1 is red on the branch for this reason and green after landing.
4. In `lib/tests-needed.js`: `gather()` reads `bySource` from the base and head locks and returns per-source guard counts; `decide()` computes the set of sources whose count fell; a `Coverage-Removed` trailer overrides the drop only for the source it names (exact path, or a path glob through `globToRe` when the value contains `/` or `*`); any source that fell without a matching trailer sets `coverageShrinkUndeclared` and the verdict stays `red_flag`. The total-count ratchet stays as a second check. `scripts/tests-needed.js` prints the undeclared sources by name.
5. Establish why `AC-MANIFEST.lock` has recorded no text since 383 and fix it at the source so a landing records, for every tag the landing's `AC:` trailers declare, `text` equal to `normalizeAcText(<the trailer's text>)` and `acHash` equal to `acHashOf(<that text>)`. If the cause is the AC-block parser, teach it the sticker's `####` heading inside `## Brief` as well as the `##` form; if it is the trailer path, fix that. Do not change the hash function and do not touch any existing manifest entry's hash by hand.
6. Move the two existing tests that pin the old shrink rule to the new one: `regression/gate-merge/j-tests-needed-verdict.test.js` ac-15 and ac-16 now pass per-source counts and, for ac-16, a trailer that names the shrunken source. Both stay at least as strict (a trailer naming a different source must still read `red_flag`; add that as the test for trap 4).

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

## Traps

1. A `require` chain that loops (a requires b requires a) or reaches `node_modules/` or a built-in must end, not hang the deriver and not credit the dependency.
2. A `require(` inside a comment or a string literal must not credit anything; a false credit is worse than a missing one, because credit is what the gate trusts.
3. The deriver must stay deterministic and free of wall-clock or randomness (`j-coverage-map-integrity` ac-2 and ac-3), and every new key must still be a BEHAVIOUR source (ac-5).
4. A `Coverage-Removed` trailer that names a source which did not shrink is not an override for one that did.
5. If the recorded `text` and the recorded `acHash` disagree, every live tag reads AC-MUTATED at the next merge: a false red of the very class this slice removes. The hash in the manifest must be computed from the recorded text, by `acHashOf`, in one place.

## What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

## Acceptance criteria

- slice-NNN-ac-1: A regression test that loads a BEHAVIOUR source with `require`, directly or through a repo-internal module it requires, is listed under that source in the map `scripts/build-coverage-map.js` builds; a test that only reads a file with `readFileSync` keeps its credit unchanged.
- slice-NNN-ac-2: A regression test that runs a repo script by path as a child process (`execFileSync`, `execSync`, `spawnSync`, `spawn` or `fork`) is listed under that script in the map.
- slice-NNN-ac-3: The deriver credits nothing outside the repo, nothing under `node_modules/` and no Node built-in, terminates on a circular require, and two builds of the same tree are byte-identical.
- slice-NNN-ac-4: A `Coverage-Removed: <source> <reason>` trailer clears the guard-count drop for `<source>` only; when any other source's guard count fell in the same range with no trailer naming it, `decide()` returns `red_flag` with `coverageShrinkUndeclared` true, and `node scripts/tests-needed.js` prints each such source by path.
- slice-NNN-ac-5: After a landing in a fixture repository, `regression/AC-MANIFEST.lock` holds, for every tag the landing's `AC:` trailers declared, a non-null `text` equal to `normalizeAcText` of the trailer's text and an `acHash` equal to `acHashOf` of that text; and the DONE report names the root cause of the gap since slice 383 and the commit that introduced it.

## Quality + goal check

- Goal check: after landing, `COVERAGE.lock` lists `lib/tests-needed.js` under the guards in `regression/gate-merge/j-tests-needed-verdict.test.js` (which requires it and reads nothing), and the regenerated manifest carries text for the tags of this slice. The next merge press cannot go red on "untested" for a module a test requires.
- Quality check: no change to `acHashOf` or `normalizeAcText`; no hand edits to either lock; no new dependency; the orchestrator is touched only if the root cause of ac-5 is there, and then only in `regenerateLocksAtLanding` or the manifest call.

## Files expected to change

- `scripts/build-coverage-map.js` (modified)
- `lib/tests-needed.js` (modified)
- `scripts/tests-needed.js` (modified: prints undeclared sources)
- `scripts/build-ac-manifest.js` or `lib/ac-block.js` or `bridge/orchestrator.js` (modified: whichever holds the ac-5 root cause; Sam names which)
- `regression/gate-merge/j-tests-needed-verdict.test.js` (modified: ac-15, ac-16 moved to per-source counts)
- `regression/gate-merge/j-checker-credits-require.test.js` (added: this slice's tests)
- `regression/COVERAGE.lock`, `regression/AC-MANIFEST.lock` (regenerated by the pipeline at landing, not by Sam)

## Custody

No criterion is retired or reworded by this slice. No `Test-Loosen-OK`, `Coverage-Removed` or `AC-Change-OK` trailer is authorized. The ac-15 and ac-16 moves in `j-tests-needed-verdict.test.js` are tightenings and need no trailer; if the gate reads one of them as loosened, stop and escalate to Alex instead of declaring it.

## REQUIRED — declare the ACs as commit trailers

    AC: slice-NNN-ac-1: A regression test that loads a BEHAVIOUR source with `require`, directly or through a repo-internal module it requires, is listed under that source in the map `scripts/build-coverage-map.js` builds; a test that only reads a file with `readFileSync` keeps its credit unchanged.
    AC: slice-NNN-ac-2: A regression test that runs a repo script by path as a child process (`execFileSync`, `execSync`, `spawnSync`, `spawn` or `fork`) is listed under that script in the map.
    AC: slice-NNN-ac-3: The deriver credits nothing outside the repo, nothing under `node_modules/` and no Node built-in, terminates on a circular require, and two builds of the same tree are byte-identical.
    AC: slice-NNN-ac-4: A `Coverage-Removed: <source> <reason>` trailer clears the guard-count drop for `<source>` only; when any other source's guard count fell in the same range with no trailer naming it, `decide()` returns `red_flag` with `coverageShrinkUndeclared` true, and `node scripts/tests-needed.js` prints each such source by path.
    AC: slice-NNN-ac-5: After a landing in a fixture repository, `regression/AC-MANIFEST.lock` holds, for every tag the landing's `AC:` trailers declared, a non-null `text` equal to `normalizeAcText` of the trailer's text and an `acHash` equal to `acHashOf` of that text; and the DONE report names the root cause of the gap since slice 383 and the commit that introduced it.
    Lane: core

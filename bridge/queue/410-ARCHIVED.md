---
id: "410"
title: "The merge gate sees tests that run a file or load it"
from: rom
to: nog
status: DONE
slice_id: "410"
branch: "slice/410"
completed: "2026-09-25T23:02:09.000Z"
tokens_in: 112
tokens_out: 85108
elapsed_ms: 1494307
estimated_human_hours: 5.0
compaction_occurred: false
tokens_cache_read: 7260781
cost_usd: 7.642399499999998
---

## Summary

The coverage deriver credited exactly one shape of proof — `readFileSync(<static path>)` — so a
test that RUNS a file or LOADS it left that file looking untested. `scripts/build-coverage-map.js`
now credits two more shapes: a static repo path passed as the command or as an argument-array
element of `spawn` / `spawnSync` / `execFile` / `execFileSync`, and a BEHAVIOUR file loaded with
`require()` of a static relative specifier (with or without `.js`) or of a static path const.

Over the repo as it stands the derived map gains **5 product sources and loses nothing**:
`scripts/install-dashboard-service.sh`, `scripts/dev.denorios.dashboard.plist`,
`bridge/git-finalizer.js`, `bridge/nog-prompt.js`, `scripts/land-untracked-runtime-state.sh`
(881 → 1068 guards from the deriver change alone; 881 → 1089 over 94 sources once this slice's own
two test files are in the tree). The three files that made promote 36190555313 go RED FLAG —
`scripts/install-dashboard-service.sh`, `scripts/dev.denorios.dashboard.plist`,
`lib/session-stream.js` — are all corroborated now, and deciding that exact range
(`9a8e46a..24e6891`) with the new map moves it from `red_flag` to `needs_review` with an **empty**
"New behaviour, no test". Alex's hand-written `Tests-Not-Needed` trailer is no longer needed for
this class of failure.

Two fences held: coverage is still **not transitive** (a test that loads `bridge/orchestrator.js`
does not guard the twenty modules the orchestrator loads), and still **not dynamic** (tmp paths,
function parameters and unknown variables resolve to null exactly as before).

**One thing beyond the brief's task 1 wording, because AC-1 requires it:** the plist path in
`j-dashboard-service.test.js` is written `path.join(REPO_ROOT, 'scripts', \`${LABEL}.plist\`)` — a
template literal. The old resolver rejected every template literal outright, so the plist could
never be credited and AC-1 could not pass. `segOf()` now resolves a template literal whose every
`${…}` is a plain string const (`const LABEL = 'dev.denorios.dashboard'`). Anything else — an
expression, an unknown name — still resolves to null. This is a resolver change, so it applies to
`readFileSync` too; it added no source on its own beyond the plist.

## What changed

- `scripts/build-coverage-map.js` — the deriver. `RUN_RE` + `callArgs()`/`splitTop()`/`staticPathOf()`
  read a child-process call's command and argument array; `REQUIRE_CONST_RE` + `REQUIRE_REL_RE` +
  `withJs()` read this file's own `require()`. `STR_CONST_RE` + `segOf()` resolve a template-literal
  path segment from plain string consts (see the note above). `resolveArgs()` takes a fourth
  argument (`strs`); its three existing forms are untouched and the string-literal branch moved
  below the `sym` lookup, which cannot change an outcome — the forms are disjoint, and the
  before/after comparison lost zero guards. Nothing here touches the filesystem: `lib/apply-draft.js`
  predicts an apply by deriving against a mirror that holds the suite and nothing else, so an
  existence check would make its prediction disagree with the map. Header comment rewritten to
  describe all three shapes and say why there is no existence check.
- `regression/dispatch-execution/j-session-streamed.test.js` — one test added (`slice-410-ac-5`),
  plus its `@ac-hash` line and a line in the file's Guards list. It drives the already-imported
  `streamSession` directly: a child writes a `result` event in two writes, cut inside the four
  bytes of a multi-byte character, and the retained result is one whole event. The file's existing
  `require('../../lib/session-stream')` is what now makes it the module's guard.
- `regression/gate-merge/j-coverage-run-and-require.test.js` — new. Six criteria plus trap 1.

No `e2e/` file was touched. No browser test was written.

## Acceptance criteria verification

Command for every criterion below except `slice-410-ac-5`:
`node --test regression/gate-merge/j-coverage-run-and-require.test.js` — **7 tests, 7 pass, 0 fail.**

- **slice-410-ac-1** — `regression/gate-merge/j-coverage-run-and-require.test.js`. A synthetic root
  proves all four function names and both positions (command, argument-array element), and proves an
  option — a `cwd`, an `env` value — is *not* credited. Then the live repo: `bySource` of
  `scripts/install-dashboard-service.sh` and of `scripts/dev.denorios.dashboard.plist` each list
  exactly `slice-403-ac-1`, `slice-403-ac-2`, `slice-403-ac-3` from
  `regression/recovery/j-dashboard-service.test.js`. PASS.
- **slice-410-ac-2** — same file. Synthetic: `require(<path const>)`, `require('../../lib/….js')`,
  and `require('../../bridge/fixture-410-no-ext')` → `bridge/fixture-410-no-ext.js`. Live:
  `lib/session-stream.js` is guarded by `j-session-streamed.test.js` (`slice-396-ac-1` … and
  `slice-410-ac-5`), which only ever `require()`s it. PASS.
- **slice-410-ac-3** — same file. Synthetic: the test loads `bridge/fixture-410-orch.js`, that file
  loads `lib/fixture-410-deep.js`, and the deep file is not a source. Live: every regression suite
  that requires `bridge/orchestrator.js` and never names session-stream (there are 17) is absent
  from `bySource` of `lib/session-stream.js`. PASS.
- **slice-410-ac-4** — same file. Five shapes in one fixture — a tmpdir-built path, a function
  parameter, a variable not from `path.resolve/join`, a path outside the repo, and two non-BEHAVIOUR
  files (`docs/…`, `regression/helpers/…`) — produce an **empty** `bySource` and `guardCount` 0.
  A control fixture with one resolvable BEHAVIOUR path does register, so the empty map is the
  resolver refusing and not the fixture misfiring. PASS.
- **slice-410-ac-5** — `regression/dispatch-execution/j-session-streamed.test.js`.
  `node --test --test-name-pattern='slice-410-ac-5' regression/dispatch-execution/j-session-streamed.test.js`
  — **1 test, 1 pass.** The test requires `lib/session-stream.js` directly and asserts the rejoined
  `retained.resultLine` deep-equals the whole event, that the session id comes off that same line,
  that both writes are counted in `stdoutBytes`, and that the log is the stdout across the cut.
  The lock clause of this criterion (its tag in `bySource` of `lib/session-stream.js`) is asserted
  in the `slice-410-ac-2` test, where the deriver lives. PASS.
- **slice-410-ac-6** — same file as ac-1. Every source key and every `(tag, file)` guard in the
  committed `regression/COVERAGE.lock` is still present in a fresh derivation (0 lost), `guardCount`
  does not fall, and `serialize(buildCoverageMap(REPO_ROOT))` twice is byte-identical. PASS.
- **slice-410-ac-7** — same file as ac-1. `gather({base: 9a8e46a, head: 24e6891})` with
  `covMap` set to the map this slice derives: `newBehaviourNoTest` contains neither
  `scripts/install-dashboard-service.sh` nor `scripts/dev.denorios.dashboard.plist`. Measured
  out of band: with the committed (pre-slice) lock that list is exactly the three files run
  36190555313 flagged; with the new map it is empty, and the verdict goes `red_flag` →
  `needs_review`. PASS.

## Safety-net tests

Eight tests: one per criterion (7) plus one for the brief's single trap. Every one carries its
criterion tag and the `@ac-hash` line from the brief, copied exactly.

- `regression/gate-merge/j-coverage-run-and-require.test.js` — ac-1, ac-2, ac-3, ac-4, ac-6, ac-7,
  and trap 1 (`require('node:fs')`, `require('@playwright/test')`, `require('fs')`,
  `require('crypto')`, `require('@scope/name/deep')` never become sources and never throw; the live
  suite derives without throwing and no key is a package name).
- `regression/dispatch-execution/j-session-streamed.test.js` — ac-5.

**Broke it on purpose.** I set the fix aside by copying `scripts/build-coverage-map.js` aside and
`git checkout --`-ing it (not `git stash` — the stash stack is shared with the other worktrees),
ran both test files, then restored the file and confirmed it byte-identical with `diff`.

Red with the fix undone — **6 of 8**:
`slice-410-ac-1`, `slice-410-ac-2`, `slice-410-ac-3`, `slice-410-ac-4`, `slice-410-ac-7`, and
`trap 1`. (Trap 1 stayed green on the first pass — a trap that only forbids something cannot fail
when the thing is absent — so I sharpened it: its fixture now names six packages *and one relative
repo path*, and asserts that path is the single source that comes out. It goes red without the fix.)

Green with the fix undone — **2 of 8**, both for reasons I could not honestly remove:

- `slice-410-ac-6` is a **preservation** criterion: nothing the lock listed before is lost, and two
  regenerations are byte-identical. Both clauses are true before the change by construction — that
  is what they assert. The one assertion that would go red is "guardCount went *up*", and that would
  be a landmine: the pipeline regenerates the lock inside the landing commit, after which
  `fresh === committed` and a strict-growth assertion fails forever. Left as written.
- `slice-410-ac-5` proves how `lib/session-stream.js` behaves, and this slice does not change that
  module, so nothing in the deriver can make it fail. Its lock clause — the half that *is* about the
  deriver — is asserted inside the `slice-410-ac-2` test, which does go red.

I did not open a browser: this slice has no screen.

**Branch-local red, green on landing, by design.** I did not run `build-coverage-map` and did not
edit `regression/COVERAGE.lock`, as the brief instructs. `regression/gate-merge/j-coverage-map-integrity.test.js`
(`slice-99822-ac-1`) asserts the committed lock equals a fresh derivation, so on this branch it is
red — the committed lock is 208 guards behind the deriver. The landing path regenerates both locks and stages
them inside the squash commit (`bridge/orchestrator.js:9410`), which is what makes it green on dev.
Nothing else reads the committed lock and asserts over it except
`j-ac-reconcile-classifier.test.js` (`slice-99827-ac-6`, live reconcile GREEN); I checked that all
seven `slice-410-ac-*` tags register with a `guardAcHash` equal to the brief's hash, so the
manifest/coverage join stays GREEN when both locks are regenerated together.

## Screen hooks

None. No criterion touches the screen.

## Tests moved or weakened

None. No existing test was moved, renamed, weakened or removed. The only edit to an existing file
is additive: one new test, one `@ac-hash` line and one Guards-list line in
`regression/dispatch-execution/j-session-streamed.test.js`.

## Commit

One commit on `slice/410`, with the seven `AC:` trailers in the final block.

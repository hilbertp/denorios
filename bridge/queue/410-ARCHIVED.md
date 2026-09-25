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

<!-- ds9:sticker v1 -->

# The merge gate sees tests that run a file or load it — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "410"
title: "The merge gate sees tests that run a file or load it"
goal: "A regression test that runs a file or loads it with require() counts as that file's guard, so tested files are never flagged new behaviour, no test."
from: obrien
to: rom
priority: high
lane: core
created: "2026-09-25T21:19:58.296Z"
timeout_min: 25
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-25T21:20:13.761Z"
approval_sig: "9b851370c285794406147ee7ba904b2ed0675129d80cce679f17715f0507f366"
rom_session_id: "61cc993d-d3ba-43ee-8c22-4b541e12206b"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-25T23:02:09.000Z"
    durationMs: 1494307
    tokensIn: 112
    tokensOut: 85108
    costUsd: 7.642399499999998
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All 7 ACs re-verified independently — 0 guards lost, 5 real sources gained, 31 new credits all genuine, and the failed promote's range drops red_flag -> needs_review with an empty new-behaviour list."
total_durationMs: 1494307
total_tokensIn: 112
total_tokensOut: 85108
total_costUsd: 7.642399
round: 1
---

### The merge gate sees tests that run a file or load it

<!-- Lane: core. Changes what the coverage map counts as a guard (docs/adr/ADR-PROOF-LANES.md §2). -->

#### Goal

Philipp, 2026-09-25, after a false RED FLAG blocked Run Gate & Merge: "do 2. proper too" (the lasting fix, so tested files are never flagged "new behaviour, no test" again).
After this lands, a regression test that runs a file or loads it with require() counts as that file's guard, just as a test that reads it does today.

#### Context

- The gate (`lib/tests-needed.js` `corroborated` :82-87) clears a changed file only through `regression/COVERAGE.lock` `bySource`, built by `scripts/build-coverage-map.js` `sourcesReadBy`. That credits only `readFileSync(<static path>)` (`CONST_RE` :34, `READ_CONST_RE` :35, `READ_INLINE_RE` :36, `resolveArgs` :45).
- Promote run 36190555313 (dev 24e6891) failed RED on three tested files: `scripts/install-dashboard-service.sh` is run by `regression/recovery/j-dashboard-service.test.js:154` (`spawnSync('bash', [INSTALL_SH])`); `scripts/dev.denorios.dashboard.plist` is linted at :207 (`execFileSync('/usr/bin/plutil', ['-lint', PLIST_SRC])`); `lib/session-stream.js` is exercised only through `bridge/orchestrator.js` (`require('../lib/session-stream')` at :3169 and :5279) by `regression/dispatch-execution/j-session-streamed.test.js`.
- Alex unblocked that promote by hand with a Tests-Not-Needed commit on dev (659bc18), approved by Philipp. This slice makes such commits unnecessary.
- The lock is regenerated at every landing; the integrity test that re-derives it (`regression/gate-merge/j-coverage-map-integrity.test.js`) must stay green.

#### Out of scope

- Not planned: crediting a file through another file's require() (transitive). A test that loads the orchestrator does not guard what the orchestrator loads.
- Not planned: crediting dynamic paths (temp directories, function parameters), as today.
- Not planned: any change to the gate's verdict rules in lib/tests-needed.js.

#### Tasks

1. `scripts/build-coverage-map.js` `sourcesReadBy`: also credit a static path (a `path.resolve`/`path.join(__dirname, …)` const, or the same inline) passed as the command or as an element of the argument array of `spawn`, `spawnSync`, `execFile` or `execFileSync`; and a behaviour file loaded with `require()` of a static relative path (with or without `.js`) or of such a const.
2. `regression/dispatch-execution/j-session-streamed.test.js`: add one test that loads `lib/session-stream.js` directly (a static require) and proves slice-410-ac-5.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### Traps

1. `require('node:fs')`, `require('@playwright/test')` and other package names are not paths; they must never become sources, and must not throw in the deriver.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-410-ac-1: A regression test file that passes a static repo path as the command or as an argument-array element of spawn, spawnSync, execFile or execFileSync gets that file (when it is a BEHAVIOUR file) as a source in COVERAGE.lock, guarded by the test file's slice tags: with the current repo, bySource of scripts/install-dashboard-service.sh and of scripts/dev.denorios.dashboard.plist each list the slice-403 tags of regression/recovery/j-dashboard-service.test.js.
- slice-410-ac-2: A regression test file that loads a BEHAVIOUR file with require() of a static relative path, with or without ".js", or of a static path const, gets that file as a source guarded by its slice tags.
- slice-410-ac-3: A file loaded only through another file's require() is not credited: a test that requires only bridge/orchestrator.js does not appear in bySource of lib/session-stream.js.
- slice-410-ac-4: Paths that cannot be resolved statically (built from a temp directory, a function parameter or a variable not assigned from path.resolve/path.join of __dirname), paths outside the repo, and files that are not BEHAVIOUR files are not credited, as today.
- slice-410-ac-5: A test in regression/dispatch-execution/j-session-streamed.test.js loads lib/session-stream.js directly and proves that a result event a child writes in two separate writes is retained as one whole result, and COVERAGE.lock lists that test's tag in bySource of lib/session-stream.js.
- slice-410-ac-6: Every source and guard COVERAGE.lock listed before this slice is still listed, and regenerating the lock twice gives byte-identical files.
- slice-410-ac-7: Deciding the range 9a8e46a..24e6891 (the promote that failed in run 36190555313) with the coverage map this slice derives lists neither scripts/install-dashboard-service.sh nor scripts/dev.denorios.dashboard.plist under "New behaviour, no test".

#### Files expected to change

- scripts/build-coverage-map.js (modified)
- regression/dispatch-execution/j-session-streamed.test.js (modified)
- one new safety-net test file under regression/ (added)

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-410-ac-1: A regression test file that passes a static repo path as the command or as an argument-array element of spawn, spawnSync, execFile or execFileSync gets that file (when it is a BEHAVIOUR file) as a source in COVERAGE.lock, guarded by the test file's slice tags: with the current repo, bySource of scripts/install-dashboard-service.sh and of scripts/dev.denorios.dashboard.plist each list the slice-403 tags of regression/recovery/j-dashboard-service.test.js.
    AC: slice-410-ac-2: A regression test file that loads a BEHAVIOUR file with require() of a static relative path, with or without ".js", or of a static path const, gets that file as a source guarded by its slice tags.
    AC: slice-410-ac-3: A file loaded only through another file's require() is not credited: a test that requires only bridge/orchestrator.js does not appear in bySource of lib/session-stream.js.
    AC: slice-410-ac-4: Paths that cannot be resolved statically (built from a temp directory, a function parameter or a variable not assigned from path.resolve/path.join of __dirname), paths outside the repo, and files that are not BEHAVIOUR files are not credited, as today.
    AC: slice-410-ac-5: A test in regression/dispatch-execution/j-session-streamed.test.js loads lib/session-stream.js directly and proves that a result event a child writes in two separate writes is retained as one whole result, and COVERAGE.lock lists that test's tag in bySource of lib/session-stream.js.
    AC: slice-410-ac-6: Every source and guard COVERAGE.lock listed before this slice is still listed, and regenerating the lock twice gives byte-identical files.
    AC: slice-410-ac-7: Deciding the range 9a8e46a..24e6891 (the promote that failed in run 36190555313) with the coverage map this slice derives lists neither scripts/install-dashboard-service.sh nor scripts/dev.denorios.dashboard.plist under "New behaviour, no test".

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

Reviewed the diff, not the report. Every claim below I re-derived myself: I extracted
`main`'s deriver to a scratch copy and diffed the map it builds against the map the branch
builds, then probed the new resolver with my own adversarial fixtures in a tmpdir.

##### Lane check

Declared **core**. 7 criteria + 1 trap → 8 safety-net tests, which is what landed
(7 in `regression/gate-merge/j-coverage-run-and-require.test.js`, 1 in
`regression/dispatch-execution/j-session-streamed.test.js`). Break-it list present under
`## Safety-net tests`. All seven contract headings present in the DONE report. No `e2e/`
file touched, no browser test written, no lock file edited. Correct for the lane.

##### AC Check

- **slice-410-ac-1** (a file the test RUNS) → ✓ Satisfied. Verified live: `bySource` of
  `scripts/install-dashboard-service.sh` and of `scripts/dev.denorios.dashboard.plist` each
  list exactly `slice-403-ac-1/-2/-3` from `regression/recovery/j-dashboard-service.test.js`.
  I also confirmed both positions and all four function names in my own fixtures, and that a
  path reachable only as a `cwd`, an `env` value or a third positional argument is **not**
  credited (`scripts/build-coverage-map.js:204-217`).
- **slice-410-ac-2** (a file the test LOADS) → ✓ Satisfied. `require(<path const>)`,
  `require('../../lib/x.js')` and `require('../../bridge/x')` → `bridge/x.js` all credit; live,
  `lib/session-stream.js` now lists `slice-396-ac-1…-9` and `slice-410-ac-5` from
  `j-session-streamed.test.js`, which only ever `require()`s it (line 76).
- **slice-410-ac-3** (not transitive) → ✓ Satisfied. `sourcesReadBy` reads only *this* file's
  own `require()` (`:218-224`); a module's own requires are never followed. Live check:
  `bySource['lib/session-stream.js']` holds exactly two guard files, and both name
  session-stream directly (`j-session-streamed.test.js:76`,
  `j-watch-slice-live-log.test.js:69` `STREAM_SRC`). No orchestrator-only suite appears.
- **slice-410-ac-4** (what stays uncredited) → ✓ Satisfied. My own seven negative fixtures all
  came back with an empty `bySource`: tmpdir-built path, function parameter, `process.env`
  variable, outside-the-repo path, `docs/` (INERT), `regression/helpers/` (TEST), and a path
  present only in the options object. A template segment whose `${…}` is an unknown name or
  an expression also resolves to null (`segOf` `:113`).
- **slice-410-ac-5** (the new session-stream test) → ✓ Satisfied. `j-session-streamed.test.js:1377`
  drives `streamSession` directly, cuts the `result` line inside the four bytes of a multi-byte
  character, and asserts the rejoined `retained.resultLine` deep-equals the whole event, that
  `sessionIdLine === resultLine`, that `stdoutBytes` counts both writes, and that the log is the
  stdout across the cut. Ran it: 1 test, 1 pass. The lock clause holds in the derived map
  (verified above).
- **slice-410-ac-6** (nothing lost, determinism) → ✓ Satisfied, and measured two ways. Against
  the committed lock: **0** of 881 `(source, tag, file)` entries lost, 881 → 1089 guards.
  Against `main`'s deriver over the same tree: **0** entries lost, 89 → 94 source keys.
  `serialize(buildCoverageMap(REPO_ROOT))` twice is byte-identical: true.
- **slice-410-ac-7** (the failed promote) → ✓ Satisfied. I ran `gather`/`decide` on
  `9a8e46a..24e6891` myself. With the committed pre-slice lock: `newBehaviourNoTest` is
  `['lib/session-stream.js', 'scripts/dev.denorios.dashboard.plist',
  'scripts/install-dashboard-service.sh']`, `decision: red_flag`. With the map this slice
  derives: `newBehaviourNoTest` is `[]`, `decision: needs_review`. Rom's numbers are exact.

**On the "in COVERAGE.lock" wording of ac-1/ac-2/ac-5.** The committed
`regression/COVERAGE.lock` on this branch is 208 guards behind the deriver, so the criteria
are met by the *derivation*, not by the checked-in bytes. That is correct and required:
`bridge/orchestrator.js:3003` instructs Rom in so many words not to run the builders or edit
`regression/*.lock`, and `:9410` regenerates both inside the landing commit
(guarded by `j-locks-regenerated-at-landing.test.js`). Not a finding.

##### Intent Verification

Achieved. The goal was that a tested file is never flagged "new behaviour, no test" again, so
that Alex's hand-written `Tests-Not-Needed` trailer (659bc18) stops being necessary for this
class of failure. The exact range that blocked Run Gate & Merge now decides with an empty
"New behaviour, no test" and drops from `red_flag` to `needs_review` — I reproduced that,
it is not taken from the report. Both fences the brief drew are real in the code, not just in
the comments: coverage is non-transitive (`:218-220`, proven by fixture and live) and still
static (seven negative shapes, all empty).

##### Scope Discipline

Clean. Four files: the deriver, the one existing test the brief names, one new safety-net test
file, and the DONE report (which CLAUDE.md requires). The edit to
`j-session-streamed.test.js` is **purely additive** — zero deleted lines — so nothing lost
content. No `e2e/`, no lock, no config, no unrelated file.

The one step past the brief's task-1 wording is `segOf()`'s template-literal handling, and it
is both disclosed (DONE `## Summary`, and the commit body) and necessary: the plist ac-1 names
is written `path.join(REPO_ROOT, 'scripts', \`${LABEL}.plist\`)`
(`j-dashboard-service.test.js:35-36`), which the old resolver rejected outright, so ac-1 could
not have passed without it. I checked it is minimal — resolution only through plain string
consts, everything else still null — and that it added no source of its own beyond the plist.
Rom's claim that moving the string-literal branch below the `sym` lookup in `resolveArgs`
cannot change an outcome is correct: `sym` keys are identifiers and `segOf` returns null for
identifiers, so the two branches are disjoint.

##### Code Quality Findings

None that rise to a finding.

- `callArgs` (`:138-156`) is quote-aware and bracket-balanced, bounded by `CALL_SCAN_MAX`, and
  returns null rather than guessing on an unterminated scan. `splitTop` (`:75-92`) survived every
  nested shape I threw at it: a multi-line argument array, `JSON.stringify({…})` inside the
  array, a spread element, `{ env: { ...process.env } }`.
- `RUN_RE`'s longest-name-first alternation is right, and the `\b` prefix keeps `mySpawn(` /
  `my_spawn(` out.
- The header comment (`:12-33`) now documents all three shapes and, usefully, *why* there is no
  existence check. I verified that reasoning against `lib/apply-draft.js:109-111` —
  `mirrorSuite` copies only `walkTests` + `walkSpecs`, never the sources, so an existence check
  really would make the apply prediction disagree with the map.
- No dead code, no unused helper, nesting stays within three levels, naming matches the file's
  existing terse register (`sym`/`strs`, `add`, `splitArgs`/`splitTop`).
- The phantom-source risk the widening opens (a `require('../../lib/<dir>')` would invent
  `lib/<dir>.js`) is already caught by an existing guard — `j-apply-draft.test.js`
  `slice-358-trap-4` asserts every key in the live map exists on disk. Rom's citation of it is
  accurate. Live map today: zero phantom keys.

**Linting:** PASS — no ESLint config in this repo; `node --check` clean on all three changed
JS files.

**Safety-net tests / screen hooks:** PASS. Every new test carries its `slice-410-ac-N` tag in
its title, and all seven `@ac-hash` lines hash-match the `AC:` trailers on the commit (I
recomputed them with `acHashOf`). Ran both changed test files: 7/7 and 1/1 pass. No test
weakened, removed, skipped or moved, so no Test-Update Gate trailer is owed and none is
present — correct. `## Screen hooks` is "None", which is right: this slice has no screen.
Nice detail: the fixture bodies in the new test file are assembled through `${…}` rather than
written out, precisely so the deriver scanning that file does not turn its own fixtures into
real guards.

**Zero false credits.** I enumerated all 31 newly credited `(source, guard-file)` pairs and
traced every one to a real `require()` or a real `spawn*`/`execFile*` — nothing came from a
comment or a fixture string, and nothing came from a fixture *copy* (there is no
`spawnSync('cp', […])`-shaped call anywhere under `regression/` or `e2e/`).

##### Flags (not findings)

**For Julian's stage:**
1. `regression/gate-merge/j-coverage-map-integrity.test.js` (`slice-99822-ac-1`) is RED on this
   branch by design — the committed lock is 208 guards behind the deriver. It clears when the
   landing regenerates both locks inside the squash commit. Do not read it as a regression.
2. Rom reports `slice-410-ac-6` and `slice-410-ac-5` stayed green with the fix removed, with
   reasons I find honest: ac-6 is a preservation criterion (both its clauses are true before the
   change — that is what they assert) and ac-5 proves `lib/session-stream.js` behaviour this
   slice does not touch, its deriver half being asserted inside the ac-2 test, which does go
   red. The machine break-it script at your stage will see those two green. Per ROLE.md that
   routes to O'Brien as a fix slice if it matters, never back to me for another round.
3. The deriver change ripples into `j-apply-draft`, `j-draft-contract` and
   `j-coverage-map-integrity` without those files changing. I did not run them (ADR-PROOF-LANES
   Rule 1); GitHub runs the suite at landing and your stage runs both.

**For O'Brien:**
4. The gate's notion of corroboration has widened from "a test asserts about this file's bytes"
   to "a test has this file in its hands". A suite that `require()`s a module purely as a *tool*
   now counts as that module's guard — this very test file requiring `lib/tests-needed.js` for
   `bucketOf` is an example, and `bridge/orchestrator.js` picked up four new guard files. That
   is exactly what ac-2 asks for and the gate is file-grained by design, so it is not a finding;
   it is worth being a recorded consequence rather than a surprise the first time a 9000-line
   file reads as covered because one helper of it is imported.
5. A `require()` or `spawnSync()` written inside a `//` comment or inside a fixture string still
   credits a source. I confirmed this class is **pre-existing** — `main`'s deriver over-credits
   the same way for `readFileSync` — so the slice does not introduce it, but it does enlarge the
   surface, and `require('…')` appears in fixture strings far more often than `readFileSync`
   does. `slice-358-trap-4`'s on-disk check catches the invented-path half; it does not catch a
   comment naming a real file. A future slice could restrict the scan to non-comment text.

## Rom's DONE report

#### Summary

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

#### What changed

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

#### Acceptance criteria verification

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

#### Safety-net tests

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

#### Screen hooks

None. No criterion touches the screen.

#### Tests moved or weakened

None. No existing test was moved, renamed, weakened or removed. The only edit to an existing file
is additive: one new test, one `@ac-hash` line and one Guards-list line in
`regression/dispatch-execution/j-session-streamed.test.js`.

#### Commit

One commit on `slice/410`, with the seven `AC:` trailers in the final block.

## Nog's verdict and review

_None recorded._

## Julian's result

### Julian's stage — result

**No browser test added, none moved.** Browser suite unchanged: **54 tests in 21 files**
(`npx playwright test --list` — the lister, not a run). Nothing under `e2e/` was written.

That is the right outcome for slice 410, and the sections below are the evidence for it rather
than a shrug. A stage that writes nothing has to show its work harder than one that ships a
test, so I did two things: I went looking for a screen and established there is none *by probing
the running product*, and I independently re-derived every clause of this slice's criteria that
a data artifact can settle — including the two whose safety-net tests Rom reports stayed green.

#### Which criteria have a browser test

| Criterion | Browser test | Why |
|---|---|---|
| slice-410-ac-1 | none | Asserts the contents of `regression/COVERAGE.lock` (`bySource` of two files lists three `slice-403` tags). A lock file is not rendered anywhere. |
| slice-410-ac-2 | none | Same — a `bySource` entry. |
| slice-410-ac-3 | none | Same — the *absence* of a `bySource` entry. |
| slice-410-ac-4 | none | A property of the path resolver, observable only as absence from the lock. |
| slice-410-ac-5 | none | Two clauses, neither on a screen: how `lib/session-stream.js` rejoins a split `result` event (in-process behaviour), and a `bySource` entry. |
| slice-410-ac-6 | none | Preservation of a lock file plus byte-identical regeneration. No screen. |
| slice-410-ac-7 | none | A verdict over a *historical git range*. The verdict has a screen surface; the criterion's actual assertion does not — see the next section, which is the one real finding of this stage. |

#### I went looking for a screen, and found one — but not the one AC-7 needs

The sticker says "Screen hooks: None". I do not accept that from myself without checking: on
slice 400 the same line was wrong. This slice changes what the merge gate decides, and the merge
gate *does* draw itself, so there was a real candidate.

I probed it. Against the fixture server the suite starts itself, I stubbed `/api/tests-needed`
with a `red_flag` verdict whose blocker list named exactly the two files AC-7 names, opened the
RUN GATE Step-1 checkpoint, and dumped the rendered DOM. What the operator actually sees:

| Hook | Renders |
|---|---|
| `#utc-verdict` | `✗ RED FLAG  @ 24e6891  a check was weakened, removed, or shipped untested.` |
| `#utc-confirm` | one row per blocker — and the row prints the blocker **kind**: `NEWBEHAVIOURNOTEST` |
| `#utc-ack-box`, `#utc-approve-btn` | the acknowledgement checkbox and `Run gate` |

I found these by element inspection of the rendered page, not from any source file; the sticker
declared no hooks, so this is the record of where they came from.

**The decisive fact: the file paths are never on the screen.** With
`scripts/install-dashboard-service.sh` and `scripts/dev.denorios.dashboard.plist` in the stubbed
blocker list, neither string appeared anywhere in the rendered page (`document.body.innerText`
checked for both: false, false). The checkpoint names the *kind* of blocker, never the file.
AC-7 says the range must list "neither `scripts/install-dashboard-service.sh` nor
`scripts/dev.denorios.dashboard.plist` under 'New behaviour, no test'" — that assertion cannot be
read off any screen this product draws.

**And the range itself is not addressable through the product.** `/api/tests-needed` ignores
`base`/`head` query parameters: I asked it for `9a8e46a..24e6891` twice, in short and full sha
form, and both times it answered for the live range (`head7: 2f587b4`). So a browser test could
only ever assert against a verdict *I* had stubbed — which tests the dashboard's renderer, not
slice 410's deriver. That is a test with no acceptance criterion behind it, the one kind I am
specifically told not to write.

So: the gate verdict has a screen, and this slice's criteria still do not touch it.

#### Independent confirmation of the clauses a data artifact can settle

`regression/COVERAGE.lock` is a generated data artifact, not product source, and it is the thing
five of these criteria are *about*. I compared the lock as committed at the landing (`2f587b4`)
against its parent (`2f587b4~1`) and audited the landed one. No source file was opened.

- **slice-410-ac-6, clause 1 — CONFIRMED.** Of the 1113 `(source, tag, file)` entries in the
  pre-slice lock, **0 are lost**; 0 source keys lost. 1113 → 1328 entries, 88 → 94 sources,
  `guardCount` 881 → 1089. This is the criterion whose safety-net test Rom reports stayed green
  under break-it, so this check is the evidence break-it could not give.
- **slice-410-ac-1 — CONFIRMED as worded.** `scripts/install-dashboard-service.sh` and
  `scripts/dev.denorios.dashboard.plist` were both **absent** from `bySource` before; each now
  lists exactly `slice-403-ac-1`, `slice-403-ac-2`, `slice-403-ac-3`, all from
  `regression/recovery/j-dashboard-service.test.js`. Nothing else.
- **slice-410-ac-2 and the lock clause of slice-410-ac-5 — CONFIRMED.**
  `bySource['lib/session-stream.js']` gained `regression/dispatch-execution/j-session-streamed.test.js`
  with `slice-396-ac-1`…`-ac-9` and **`slice-410-ac-5`**, alongside the pre-existing
  `j-watch-slice-live-log.test.js` guards.
- **slice-410-ac-3 — CONFIRMED.** `bridge/orchestrator.js` has 27 guard files. Only the two that
  name session-stream directly appear in `bySource['lib/session-stream.js']`; no orchestrator-only
  suite credits it. Coverage did not become transitive.
- **trap 1, and the "outside the repo / not a BEHAVIOUR file" half of slice-410-ac-4 — CONFIRMED
  at the lock level.** All 94 landed source keys: none package-name-shaped, none `@scoped`, none
  `node:`-prefixed, none absolute, none starting `..`, none under `docs/`, and **every one exists
  on disk** (no phantom key from the `require()` widening). Top-level spread:
  `.github` 1, `bridge` 7, `dashboard` 4, `e2e` 5, `lib` 13, `regression` 51, `scripts` 13.

**What I could not settle, and am not claiming:**

- **slice-410-ac-6, clause 2** (regenerating twice is byte-identical) and the resolver-level
  shapes of **slice-410-ac-4** (tmpdir paths, function parameters, unknown variables) need the
  deriver run or read. Neither is mine. Rom's safety-net tests and the stage's counted suite run
  carry them.
- **slice-410-ac-7 is not independently confirmable at my stage.** The live `/api/tests-needed`
  does read `decision: clear`, `newBehaviourNoTest: 0`, `coverageGuardCount: 1089` for
  `9a8e46a..2f587b4`, and `24e6891` is an ancestor of `2f587b4`, so the failing range sits inside
  the range that now reads clean. But **`659bc18`** — Alex's hand-written `Tests-Not-Needed`
  declaration — also sits inside the live range and *outside* AC-7's range. So the live reading is
  **consistent with** AC-7 and is **not proof of** it: the override is a confound I cannot rule out
  from outside the code. AC-7 rests on Rom's test and Nog's re-derivation, not on anything I saw.

#### Nog's flags for my stage

1. **`j-coverage-map-integrity.test.js` RED on the branch — resolved on dev, as Nog said it would
   be.** The landing did regenerate the lock: the committed lock at `2f587b4` is 1089 guards over
   94 sources, and the live server independently reports `coverageGuardCount: 1089`. The stage's
   counted run confirms it; I did not run it.
2. **The two tests Rom reports green under break-it.** Recorded below.
3. **The ripple into `j-apply-draft`, `j-draft-contract`, `j-coverage-map-integrity`.** Not run by
   me. The stage's counted run covers them.

#### Which safety-net tests the break-it check named hollow

**None — because the break-it check does not exist yet.** Packet item 8 says so outright: "Not
run yet — the break-it script is the next slice in this set." So there is no machine confirmation
of any safety-net test on this slice, and by the packet's own instruction every one of Rom's
eight is **unconfirmed**. I did not run it by hand and am not permitted to.

Rom self-reports 6 of 8 red with the fix removed, and two green: `slice-410-ac-6` and
`slice-410-ac-5`. Under my role file's letter, "a criterion whose only safety-net test is hollow
is a bug exit". **I am not taking that exit**, and here is my reasoning rather than a deferral to
Nog:

- **`slice-410-ac-6` is a preservation criterion.** Both its clauses — nothing that was listed is
  lost, two regenerations are byte-identical — are true *before* the change, because that is what
  preservation means. A test for it is supposed to be green with the fix absent. Break-it cannot
  tell preservation from hollowness; it is a blind spot of the instrument, not a defect in the
  test. And the clause that matters is not unevidenced: I confirmed it above, independently, at
  0 entries lost of 1113.
- **`slice-410-ac-5` splits across two tests.** Its behavioural clause is about `lib/session-stream.js`,
  which this slice does not change, so nothing in the deriver could make it fail. Its deriver
  clause — the tag appearing in `bySource` — is asserted in the `slice-410-ac-2` test, which Rom
  reports red, and I confirmed that entry in the landed lock myself.

So no criterion on this slice is left without evidence, and nothing is red. This is a judgement
about the break-it *instrument*, not a pass I am waving through: the underlying gap is a process
gap and I have routed it (below), which is the exit my role file gives for a process gap.

#### A measured consequence, not a finding

Nog flagged to O'Brien that corroboration has widened from "a test asserts about this file's
bytes" to "a test has this file in its hands". I measured it from the two locks, so the number is
on the record rather than the impression:

- 6 new source keys: `scripts/install-dashboard-service.sh`, `scripts/dev.denorios.dashboard.plist`,
  `bridge/git-finalizer.js`, `bridge/nog-prompt.js`, `scripts/land-untracked-runtime-state.sh`,
  and Rom's own new test file.
- Sources that gained the most guard files: `bridge/orchestrator.js` **+4**,
  `bridge/git-finalizer.js` **+4**, `scripts/build-coverage-map.js` **+3**,
  `dashboard/server.js` **+3**. Those are suites that `require()` the module as a *tool* now
  counting as its guard — exactly what ac-2 asks for, and worth being a recorded number.

Two things I checked and can report are **not** new, so nobody chases them:

- **Test files as source keys**: 47 before, 48 after. The extra one is Rom's own new test file.
  "Tests guarding tests" is pre-existing, not introduced here.
- **My own files' relationship to the lock is unchanged.** Five `e2e/*.spec.js` entries appear as
  self-guarding source keys (`lcars-mode`, `nog-role-no-suites`, `s-numbering`, `staged-reorder`,
  `verdict-source-history`), and the set is **byte-identical before and after** the landing. No
  e2e spec guards a product source, before or after. Forward-looking only, and unverified by me:
  because `e2e/` is inside the deriver's walk, a browser test that `require()`d a product module
  would now be a candidate guard for it. I will keep my specs stubbing HTTP rather than importing
  product modules, which is what all 21 already do.

#### Bad-test fast path

Not used. I wrote one throwaway probe spec (`e2e/_scratch-410-probe.spec.js`) to dump the
checkpoint's rendered DOM, ran it once, and **deleted it**. It was never committed and `e2e/` is
clean. No existing browser test was touched.

#### Suite results

Pending. I emit `tests-updated` after this section is committed; the stage machinery then makes
the one counted run of the safety-net suite and the browser suite on dev and records the verdict.
I ran neither.

#### Every file I read

Product source read: **none**. No diff, no `scripts/`, no `lib/`, no `bridge/*.js`, no
`dashboard/`, and no `regression/**/*.test.js` — Rom's safety-net tests are part of the diff, so I
stayed out of them too.

- `.claude/roles/bashir/ROLE.md` (my anchor)
- `bridge/queue/410-IN_QA.md` (the sticker); `bridge/queue/404-ARCHIVED.md` (a prior stage result, for format)
- `bridge/state/gate-running.json`, `bridge/state/bashir-heartbeat.json`, `bridge/state/qa-stage-410.json`
- `docs/adr/ADR-PROOF-LANES.md`; `docs/adr/ADR-JULIAN-ALONGSIDE.md` (searched, for the telemetry contract)
- `regression/COVERAGE.lock` — the working-tree copy and the committed copies at `2f587b4` and
  `2f587b4~1`. A generated data artifact, and the subject of five criteria.
- `bridge/register.jsonl` (searched for prior `tests-updated` payload shape)
- `playwright.config.js`, `e2e/ci-strip-report.spec.js`, `e2e/gate-button.spec.js`,
  `e2e/gate-failure-journey.spec.js`, and excerpts of `e2e/pipeline-lifecycle.spec.js` and
  `e2e/dispatch-errors.spec.js`; text searches across all 21 `e2e/*.spec.js` and `e2e/seed-fixture.js`.
  These are my own files.
- Git metadata only (commit subjects, ancestry, changed-file names) — no file contents from git
  except the two lock versions above.
- **Disclosed precisely:** to emit correctly I introspected the *public surface* of
  `bridge/state/gate-telemetry.js` with `node -e` (`Object.keys` → `emit`, `setRegisterPath`,
  `VALID_EVENTS`) and printed `VALID_EVENTS`. I did not read its implementation. That is consuming
  a contract, which is my role's relationship to Worf's machinery; I note it because it is the one
  place I touched a `.js` file at all.

#### Exit taken

**None — nothing is red and no criterion is unclear.** My stage is green from my side, pending the
machinery's counted run. Two process gaps are routed to Alex's inbox as
`HANDOFF-QA-PROCESS-GAPS-SLICE-410-FROM-BASHIR.md`; neither is a QA red and neither blocks this
slice:

1. The break-it check does not exist yet, and when it does it will mark every *preservation*
   criterion hollow — `slice-410-ac-6` is the live example. The rule as written would fire a fix
   slice on each one.
2. A criterion worded as an assertion over a historical git range (`slice-410-ac-7`) can never
   reach my stage as evidence: no product surface accepts a base/head, and the verdict screen
   names blocker kinds, not files. Fine for a core-lane unit test — worth knowing when wording
   future gate criteria.


#### Addendum — the dev warning light fired on this slice's sha while I worked

At `2026-09-25T23:15:06Z`, mid-stage and before I emitted `tests-updated`, the register took
**`DEV_SUITE_RED` for `2f587b4`** — this slice's landing commit — from `ci.yml`
[run 36200088936](https://github.com/hilbertp/denorios/actions/runs/36200088936), with three
failing checks. The slice-388 mechanism already filed `REGRESSION-FAILURE-dev-2f587b4.md` into
Alex's inbox by itself. My role file calls this push run a warning light and not a counted run,
so it decides nothing — but it is red on the sha my stage is judging, and the stage machinery's
counted run will meet the same suite, so it belongs in this record.

I scoped it against the register's `DEV_SUITE_RED` history, which is a fact-check and not a
diagnosis:

| Failing check | First seen | Status on this slice |
|---|---|---|
| `J-dev-commit-list slice-397-ac-1` | `81f23e1` (S406), 21:33Z | **pre-existing** — red on all four shas before this one |
| `J-dev-commit-list slice-397-ac-2` | `81f23e1` (S406), 21:33Z | **pre-existing** — same |
| `J-gate-fail-retry slice-316-ac-9` | **`2f587b4` (S410), 23:15Z** | **new at this sha** — absent from every earlier red |

So the statement my role lets me make, and where I stop:

> **Criterion `slice-316-ac-9` is not met on dev as of `2f587b4`.** Its check is
> `regression/gate-merge/j-gate-fail-retry.test.js`, and it asserts that *every regression test
> name carries a `slice-<id>-ac-<index>` or `J-`/`journey-` tag so failures trace to a journey or
> an AC*. It passed on the four preceding dev shas and fails for the first time on this slice's
> landing commit. Slice 410 added a new safety-net file
> (`regression/gate-merge/j-coverage-run-and-require.test.js`) and one test to an existing file.

I am **not** diagnosing that, and I did not open either test file to look — whether the new tags
are the cause is Alex's and Rom's to establish, not mine. The correlation is the thing my stage
exists to surface, and I have surfaced it. Note that Nog verified all seven `@ac-hash` lines and
reported every new test carries its `slice-410-ac-N` tag in its title, so if this check is
tripping on the new file the disagreement is between two readings of what a valid tag is, which
is worth someone's minute before a fix slice is cut.

The two `slice-397` failures are older than this slice and are already on Alex's desk from the
`744a4e0` and `a03b869` filings; they are not slice 410's to answer for.

**This does not change my verdict, and it is not me declaring red.** My browser suite has no vote
on the safety-net suite, and the counted run is the instrument that decides. If it records
`QA_RED`, the failing criterion belongs to slice 316 (and slice 397), not to slice 410's seven —
every one of which I found either confirmed or properly carried by Rom's tests above. The exit is
the stage machinery's to take, on the counted run's evidence rather than on this warning light.

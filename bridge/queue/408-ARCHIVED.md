---
id: "408"
title: "Dev is green again: slice 372's autocommit test reads the whole function"
from: rom
to: nog
status: DONE
slice_id: "408"
branch: "slice/408"
completed: "2026-09-25T22:34:16.510Z"
tokens_in: 36
tokens_out: 23498
elapsed_ms: 311887
estimated_human_hours: 0.5
compaction_occurred: false
tokens_cache_read: 810196
cost_usd: 1.4993830000000001
---

<!-- ds9:sticker v1 -->

# Dev is green again: slice 372's autocommit test reads the whole function — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "408"
title: "Dev is green again: slice 372's autocommit test reads the whole function"
goal: "The safety-net run on dev is green again and the test still catches an autocommit that stops using git add -u or stops skipping untracked files."
from: obrien
to: rom
priority: critical
lane: core
created: "2026-09-25T21:11:25.903Z"
timeout_min: 15
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-25T21:12:28.009Z"
approval_sig: "52b6af1087b1c1ef77e1858bdfab04c6c1be8ccdcf701e1b7589535b348de415"
rom_session_id: "834fb4b2-cc5f-4e84-9106-983d2a1924ed"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-25T22:34:16.510Z"
    durationMs: 311887
    tokensIn: 36
    tokensOut: 23498
    costUsd: 1.4993830000000001
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All three ACs verified — 16/16 green on the changed file, git add -u confirmed at offset 1706, red-check independently reproduced; the guard got stricter, not looser, and scope is exactly the test file plus the DONE report."
total_durationMs: 311887
total_tokensIn: 36
total_tokensOut: 23498
total_costUsd: 1.499383
round: 1
---

### Dev is green again: slice 372's autocommit test reads the whole function

<!-- Lane: core. Changes a test's behaviour (docs/adr/ADR-PROOF-LANES.md §2). -->

#### Goal

GitHub's safety-net run on dev went red when slice 405 landed (commit 24e6891). After this lands, dev is green again, and the test still catches an autocommit that stops skipping untracked files or stops using `git add -u`.

#### Context

- Failing test: `regression/dispatch-execution/j-untracked-runtime-state.test.js:157-168`, slice-372-ac-1. It reads only the first 1600 characters of `autoCommitDirtyTree` (`fnStart + 1600`, :164) and looks for `!l.startsWith('??')` and `git add -u` there.
- Slice 405 added a comment and `const commitBody` above the `git add -u` line in `bridge/orchestrator.js` `autoCommitDirtyTree` (:1498 onward), which pushed `git add -u` past character 1600. The code still stages tracked modifications only; only the test's window broke.
- Same kind of break as slice 404, which fixed slice 400's test after 402.

#### Out of scope

- Proposed follow-up: other tests in regression/ that read a fixed-size window of a function's source and will break the same way on the next edit.

#### Tasks

1. `regression/dispatch-execution/j-untracked-runtime-state.test.js`, the slice-372-ac-1 test: read the body of `autoCommitDirtyTree` from its start to the start of the next top-level `function ` in the file, instead of a fixed 1600 characters. Keep both assertions and their messages as they are.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-408-ac-1: The slice-372-ac-1 test in regression/dispatch-execution/j-untracked-runtime-state.test.js passes against the current bridge/orchestrator.js.
- slice-408-ac-2: The same test fails when autoCommitDirtyTree no longer contains `git add -u`, and fails when it no longer contains `!l.startsWith('??')`, including when either line sits more than 1600 characters into the function.
- slice-408-ac-3: The same test does not pass on a `git add -u` or `!l.startsWith('??')` that appears only in the function after autoCommitDirtyTree.

#### Files expected to change

- regression/dispatch-execution/j-untracked-runtime-state.test.js (modified)

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-408-ac-1: The slice-372-ac-1 test in regression/dispatch-execution/j-untracked-runtime-state.test.js passes against the current bridge/orchestrator.js.
    AC: slice-408-ac-2: The same test fails when autoCommitDirtyTree no longer contains `git add -u`, and fails when it no longer contains `!l.startsWith('??')`, including when either line sits more than 1600 characters into the function.
    AC: slice-408-ac-3: The same test does not pass on a `git add -u` or `!l.startsWith('??')` that appears only in the function after autoCommitDirtyTree.

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

**AC Check:**

- slice-408-ac-1: *The slice-372-ac-1 test passes against the current bridge/orchestrator.js.* → ✓ Satisfied.
  Ran the changed file only: `node --test regression/dispatch-execution/j-untracked-runtime-state.test.js` → **16 pass, 0 fail**, including
  `slice-372-ac-1 a slice run leaves no runtime file staged for autocommit` — the one guard that is red on dev today.
  Confirmed the cause independently against the live source: from `function autoCommitDirtyTree(` the `??` filter sits at offset **328**
  and `git add -u` at offset **1706** (`bridge/orchestrator.js:1488`, `:1518`). The old 1600-character window saw the first and missed the
  second. The widened window is 3099 characters and sees both.

- slice-408-ac-2: *Fails when `git add -u` is gone, and when `!l.startsWith('??')` is gone, including past 1600 characters.* → ✓ Satisfied.
  `regression/dispatch-execution/j-untracked-runtime-state.test.js:296` runs the full matrix at depth 0 and depth 2400: both markers found
  when present; `addsTrackedOnly` false when `git add -u` becomes `git add -A`; `skipsUntracked` false when the `??` filter is dropped.
  2400 is past the old window, so the "deep" leg is the one that actually tests the widening.

- slice-408-ac-3: *Does not pass on a marker that appears only in the function after autoCommitDirtyTree.* → ✓ Satisfied.
  `:316` builds a source whose `autoCommitDirtyTree` has neither marker and whose next top-level function (behind a doc comment, as the real
  neighbour `fuseSafeCheckoutMain` is) has both. It first asserts both markers really are in the file — so the test cannot pass by the markers
  simply being absent — then asserts the reader reports both gone. Verified the window ends before the neighbour: the live window matches
  exactly one top-level declaration, `function autoCommitDirtyTree`.

All three ACs are carried as commit trailers on `10e7a96` and `git log --format='%(trailers:only)'` parses all three plus `Co-Authored-By`
— the trailer block is the final paragraph, as the contract requires.

**Code Quality Findings:** none.

- `topLevelFunctionSource` (`:113`) is the right shape for the fix: it removes the magic number rather than raising it, so the same edit
  cannot break the guard a fourth time. The `/m` anchor plus the `start + 1` search offset are both load-bearing and both explained in the
  comment above them — and the fixture exercises the second one with an indented `const lines = function split(...)` that must *not* close
  the window.
- `autocommitMarkers` (`:130`) is the detail that makes this reviewable: the slice-372-ac-1 guard and all three new guards read through one
  function, so a guard on the reader cannot drift from the reader in use. Without it, the new tests would be testing a copy.
- `bridge/orchestrator.js` was correctly left untouched. The code was never wrong; only the guard's field of view was.
- Naming and comments announce intent and explain *why*, not *what*. No dead code, no nesting, no new dependency.

**Linting:** PASS — the repo configures no linter (no eslint config, no `lint` script). `node --check` on the changed file passes.

**Safety-net tests / screen hooks:** PASS.

1. *AC tags* — all three tests carry `slice-408-ac-N` in the test name. The three `@ac-hash` lines were recomputed with
   `acHashOf()` from `scripts/build-ac-manifest` against the brief's AC text: all three match byte for byte.
2. *Tests the criterion, not the shape* — each asserts what the reader reports for a given source, which is the behaviour the criteria
   describe. None asserts that a function exists or is written a certain way.
3. *Nothing pins dead code* — the reader under test is the one the live slice-372-ac-1 guard calls.
4. *Red when the fix is removed* — the report lists the four tests that went red. I reproduced it independently, read-only, by extracting the
   committed fixture and running it against a re-implementation of the old 1600-character reader: **ac-1, ac-2 and ac-3 all fail**, and the
   ac-3 fixture really does contain both markers in the file. The claim holds, and the two failure directions are genuinely different
   (ac-1/ac-2 fail on truncation, ac-3 fails on overrun) — the widened window has to get both right at once.
5. *Right count* — three tests for three criteria, no traps in the brief. Exactly the target; no extras.
6. *Screen hooks* — none required. Test-only change, no screen surface, and the report says so.

**Gate 1.5 — Test-Update trailers:** not required, and correctly absent. The only edit to an existing check replaces
`src.slice(fnStart, fnStart + 1600)` with the full-function read; both assertions and both messages are verbatim as before. I ran the
signed direction engine (`lib/assert-direction.js` `classifyFileDiff`) over the diff: every check in the file, including
`slice-372-ac-1`, classifies as **tightened**. Nothing weakened, removed, skipped or reworded, so the slice will not read RED at promote.

**Scope:** clean. One commit (`10e7a96`), two files: `regression/dispatch-execution/j-untracked-runtime-state.test.js` and the mandatory
`bridge/queue/408-DONE.md`. Exactly the brief's "Files expected to change". The six deleted lines are the six lines of the old window read
and nothing else; no existing content was lost.

**Intent:** achieved. The slice existed because dev went red on correct code. Dev goes green — the failing guard passes — *and* the guard did
not get weaker to do it: it now reads the whole function instead of its first 1600 characters, and stops at the function's end instead of
running on into whatever followed. Both regressions the guard exists to catch (`git add -u` traded for `git add -A`, the `??` filter dropped)
still turn it red, now at any depth. The obvious wrong answer — bump 1600 to 2400 — would have ticked ac-1 and ac-2 and left the same trap
armed for the next edit. Rom did not take it.

**Report shape:** all seven core-lane headings present.

**Flags (not findings):**

- *For O'Brien.* The window ends at the start of the next `function` keyword, which means it includes the **next function's leading
  docblock**. A marker written into `fuseSafeCheckoutMain`'s doc comment would read as present. This is exactly what the brief specified
  ("to the start of the next top-level `function `"), and ac-3 is about the next function's *body*, which the reader correctly excludes —
  so it is spec-conformant, not a deviation. Today's docblock contains neither marker. Noting it so the limit is written down somewhere.
- *For O'Brien.* The reader would also run to end-of-file if `autoCommitDirtyTree` ever became the last `function` declaration in the file
  and were followed by top-level `const` arrow functions. Not the case today (`fuseSafeCheckoutMain` follows at `:1548`), and out of scope.
- *For O'Brien, seconding Rom's note.* Third time a fixed-size source window has gone stale (400 → 404, 372 → 408). `topLevelFunctionSource`
  takes no fixture and no repo state and is ready to lift into `regression/helpers/` when someone converts the remaining fixed-window
  readers. That conversion is the brief's own out-of-scope item and should get its own slice.
- *For Julian's stage.* Nothing under `e2e/`, no browser test committed, no screen surface. Nothing here for a browser to look at.

## Rom's DONE report

### Dev is green again: slice 372's autocommit test reads the whole function

#### Summary

The slice-372-ac-1 guard `a slice run leaves no runtime file staged for autocommit`
read the first 1600 characters of `autoCommitDirtyTree` and looked for `git add -u`
in them. Slice 405 added a comment and a `const commitBody` above that line, which
moved it to character **1706** — six characters of comment past the edge of the
window. The autocommit still stages tracked modifications only; only the guard's
field of view broke, and dev went red on correct code.

The guard now reads the function from its declaration to the start of the next
top-level declaration, so no edit inside the function can hide a line from it, and
nothing after the function can be mistaken for part of it. Both assertions and both
messages are unchanged.

#### What changed

`regression/dispatch-execution/j-untracked-runtime-state.test.js` only.

- New helper `topLevelFunctionSource(src, name)`: returns a named top-level
  function's source, ending at the next `function` / `async function` at column 0
  (or end of file). Anchored with `/m` and searched from past the declaration's own
  keyword, so the function's own nested and indented declarations do not close the
  window.
- New helper `autocommitMarkers(src)`: reads the two properties the autocommit must
  keep — `!l.startsWith('??')` and `git add -u` — out of `autoCommitDirtyTree`. The
  slice-372-ac-1 guard and all three slice-408 guards go through it, so a guard on
  the reader can never drift from the reader in use.
- The slice-372-ac-1 guard's `src.slice(fnStart, fnStart + 1600)` is replaced by
  that call. Its two assertions and their messages are verbatim as before.
- Three safety-net tests, one per acceptance criterion, with their hash lines.
- The header docblock's `Guards:` list names the three new guards.

`bridge/orchestrator.js` was not touched — there was nothing wrong with it.

#### Acceptance criteria verification

- **slice-408-ac-1** — met. `node --test` on the file: 16/16 pass, including
  `slice-372-ac-1 a slice run leaves no runtime file staged for autocommit`, which
  was the single failure before this change. Guarded by
  `slice-408-ac-1 the autocommit guard is green against the orchestrator as it stands`,
  which asserts both markers are found in the live `bridge/orchestrator.js` and that
  the window holds exactly one top-level declaration — its own.
- **slice-408-ac-2** — met. `slice-408-ac-2 a dropped marker reads as red however
  deep in the function it sat` builds a stand-in `autoCommitDirtyTree` at two
  depths, 0 and 2400 characters, and at each one asserts: both markers found when
  both are present; `addsTrackedOnly` false when `git add -u` is traded for
  `git add -A`; `skipsUntracked` false when the `??` filter is dropped. 2400 is past
  the 1600 the old window read, so a truncating reader fails all three legs of the
  deep pass.
- **slice-408-ac-3** — met. `slice-408-ac-3 a marker only the next function has does
  not read as present` builds a source whose `autoCommitDirtyTree` has neither
  marker and whose *next* top-level function (behind a doc comment, as the real
  neighbour `fuseSafeCheckoutMain` is) has both. The fixture first asserts both
  markers really are in the file, then that the reader reports both absent.

#### Safety-net tests

Three, one per acceptance criterion. The brief lists no traps.

- `slice-408-ac-1 the autocommit guard is green against the orchestrator as it stands`
- `slice-408-ac-2 a dropped marker reads as red however deep in the function it sat`
- `slice-408-ac-3 a marker only the next function has does not read as present`

**Red-check (core lane).** I stashed the fix by restoring the old body of
`topLevelFunctionSource` to `return src.slice(start, start + 1600)`, keeping the new
tests, and ran the file. 12 pass, 4 fail — **all three new tests went red**, plus the
guard that is red on dev today:

```
✖ slice-372-ac-1 a slice run leaves no runtime file staged for autocommit
✖ slice-408-ac-1 the autocommit guard is green against the orchestrator as it stands
✖ slice-408-ac-2 a dropped marker reads as red however deep in the function it sat
✖ slice-408-ac-3 a marker only the next function has does not read as present
```

ac-1 and ac-2 go red because the truncated window cannot see the deep markers; ac-3
goes red because a 1600-character window overruns the short fixture function and
swallows its neighbour's markers — the two failure directions the widened window has
to get right at once. I then restored the fix and confirmed 16/16 green and that no
stash marker survived in the file.

Ran only this one test file, as the brief requires. Nothing else.

#### Screen hooks

None. Test-only change, no UI surface.

#### Tests moved or weakened

None moved. Nothing weakened — the guard is strictly stricter than before: it now
sees the whole function instead of its first 1600 characters, and it now stops at the
function's end instead of reading whatever followed it. The two assertions and their
messages are unchanged.

One note for O'Brien, matching the brief's out-of-scope item: this is the third time
a fixed-size source window has gone stale (400 → 404, 372 → 408). `topLevelFunctionSource`
is written to be lifted into `regression/helpers/` when someone converts the other
fixed-window readers; it takes no fixture and no repo state.

#### Commit

Single commit on `slice/408`, carrying the three AC trailers as the final paragraph.

## Nog's verdict and review

_None recorded._

## Julian's result

_Julian's stage has not recorded a result for this slice yet._

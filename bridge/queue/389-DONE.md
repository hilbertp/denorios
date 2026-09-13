---
id: "389"
title: "Two lanes: the brief says surface or core, and Sam, Jordan and the effort setting follow it"
from: rom
to: nog
status: DONE
slice_id: "389"
branch: "slice/389"
completed: "2026-09-13T18:04:00.000Z"
tokens_in: 1
tokens_out: 1
elapsed_ms: 1
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

A brief now declares one of two lanes and five places downstream obey it. `new-slice.js`
requires `--lane surface|core` on write; the orchestrator defaults every read to core, so the
entire backlog staged before this landed keeps dispatching at full rigour. The lane picks the
report headings in the template glued to the brief (four or seven), adds a Part 5 lane check to
Jordan's prompt, selects the `--effort` pair the model is spawned with, and travels onto dev as
one `Lane:` trailer for Slice 390 to parse.

Task 0 precondition confirmed at HEAD `4ccf3fb`: `buildDoneTemplate`, `buildHashLines` and the
literal `## What you run` all present, so 386, 387 and 388 are underneath this.

Two things worth the reviewer's eye. First, `readSliceMeta` had an early `break` once title and
branch were known — and `-ACCEPTED.md` is first in its suffix list and always supplies both, so
`-PARKED.md` was never opened. Reading the lane there without removing that break would have made
every squash say core, silently and permanently (trap 5). The break is gone; first-wins means the
extra reads cannot change any existing answer. Second, the `--resume` path built its own argument
list inline, so anything added to the fresh path missed every rework round; both paths now come out
of one exported `romSpawnArgs`.

## What changed

- `bridge/new-slice.js` — `--lane surface|core`; written as `lane: <value>` after `priority`;
  omitted defaults to core and prints `no --lane given; defaulting to core (full rigour)` to
  stderr; any other value fails validation and stages nothing. `lane` added to the writer's
  `REQUIRED_FIELDS`, and the comment above it now says the list deliberately no longer matches the
  orchestrator's (the orchestrator defaults on read; only the writer requires).
- `bridge/orchestrator.js` —
  - four new exported functions: `resolveLane(meta)`, pure `laneEventFields(meta, args)`, pure
    `applyLaneArgs(args, lane, laneArgs)`, pure `romSpawnArgs({...})`;
  - `registerCommissioned` exported, and it resolves the lane itself from `extra.body` — the pickup
    loop's call is pinned byte for byte by `j-finished-slice-not-redispatched`, so nothing moved
    there;
  - `buildDoneTemplate` gains `lane` and emits a `## Your report` section, four headings or seven,
    with the matching test rule;
  - `invokeRom` resolves the lane once beside `sliceMeta`, passes it to the template, calls
    `romSpawnArgs` exactly once for both spawn paths, and the DONE event spreads
    `laneEventFields(sliceMeta, clauseArgs)`;
  - `invokeNog` passes `lane` to `buildNogPrompt`;
  - `squashSliceToDev(sliceId, sliceTitle, sliceBranch, lane = 'core')` writes `Lane: <lane>` beside
    `Slice-Id`/`Slice-Branch` and `lane` into `SLICE_SQUASHED_TO_DEV`; the value is normalised
    through `resolveLane`, never harvested from the branch log;
  - `readSliceMeta` returns `lane`, from `-PARKED.md` only, and no longer breaks early;
  - `handleAccepted` reads `readSliceMeta(id).lane` and passes `{ lane }` through `acceptAndMerge`;
    `crashRecovery`'s re-attempt does the same; `drainDeferredAfterGate` passes `meta.lane`.
- `bridge/nog-prompt.js` — `buildNogPrompt` gains `lane`; Part 5 "Lane check" added; "FOUR parts"
  → "FIVE parts" and "all four parts" → "all five parts".
- `bridge/bridge.config.json` — `"laneArgs": { "surface": ["--effort", "high"] }`, next to
  `claudeArgs`.
- `regression/helpers/slice-factory.js` — `lane` in `REQUIRED_FIELDS` and `lane: 'core'` in
  `buildSliceFrontmatter`, so the two existing staging tests that loop that list still find the
  field.
- `regression/authoring-staging/j-lanes.test.js` — added, 11 tests.
- `regression/orchestrator/j-report-metrics-filled.test.js` — one signature pin updated, see
  `## Tests moved or weakened`.
- No `e2e/` file touched.

## Acceptance criteria verification

Command for all five, run from the worktree: `node --test regression/authoring-staging/j-lanes.test.js`
→ 11 tests, 11 pass, 0 fail.

| Tag | Test | Result |
|---|---|---|
| `slice-389-ac-1` | `j-lanes.test.js` — surface and core round-trip from the flag into the frontmatter; omitted → `lane: core` plus the warning; `--lane lightweight` exits non-zero, names the flag and the allowed values, and leaves no staged file; `REQUIRED_FIELDS` carries `lane`. Driven by spawning the real CLI with `DS9_*_DIR` redirected. | pass |
| `slice-389-ac-2` | `j-lanes.test.js` — `resolveLane` over missing/unknown/valid; `registerCommissioned` writes `lane: surface` read from the body into the COMMISSIONED line; `readSliceMeta` with a bogus `lane: surface` on `-ACCEPTED.md` and `lane: core` on `-PARKED.md` returns core; a real squash in a throwaway bare+clone repo writes `Lane: core` and the event field. | pass |
| `slice-389-ac-3` | `j-lanes.test.js` — surface names the four headings, names Safety-net tests as optional, contains neither "Acceptance criteria verification" nor "Tests moved or weakened" anywhere, states the surface rule and "No break-it check"; core names the seven contract headings in order (index-walked, not just present) and states the break-it rule. | pass |
| `slice-389-ac-4` | `j-lanes.test.js` — surface prompt carries the lane check, the verbatim lane-mismatch fix instruction, the behaviour-change list and the "do not reject for the absence of…" sentence; core prompt says the lane is core and carries neither; both say FIVE parts; a prompt built with no `lane` is the core prompt. | pass |
| `slice-389-ac-5` | `j-lanes.test.js` — `romSpawnArgs` yields `--effort high` on the fresh path and on round 2 with a session id (still `--resume`, still no `-p`), and returns the global list unchanged for core, for an empty `laneArgs` and for no `laneArgs` at all; `laneEventFields` reports `{lane, effort}` from the spawned args and omits `effort` when there are none. | pass |

## Safety-net tests

Core lane, so: one per criterion plus one per trap, then stop. Eleven tests in
`regression/authoring-staging/j-lanes.test.js`, each carrying its tag and, for the five criteria,
the `@ac-hash` line from the brief copied verbatim.

Break-it check. I backed the five product files up to a temp directory, ran
`git checkout HEAD --` over them (deliberately not `git stash` — the stash stack is shared with the
main checkout and other sessions), re-ran the file, then restored from the backup. **All 11 went
red**, and re-ran green after restoring:

| Test | How it went red with the fix removed |
|---|---|
| `slice-389-ac-1` | assertion — `--lane surface must write "lane: surface" into the frontmatter` |
| `slice-389-ac-2` | `TypeError: resolveLane is not a function` (the seam does not exist yet) |
| `slice-389-ac-3` | assertion — `the surface template must name ## Summary` |
| `slice-389-ac-4` | assertion — the surface lane-check regex did not match |
| `slice-389-ac-5` | `TypeError: romSpawnArgs is not a function` |
| `slice-389-trap-1` | `TypeError: romSpawnArgs is not a function` |
| `slice-389-trap-2` | `TypeError: resolveLane is not a function` |
| `slice-389-trap-3` | assertion — `the surface template keeps its own heading ## Your report` |
| `slice-389-trap-4` | assertion — `exactly one Lane trailer, got []` |
| `slice-389-trap-5` | assertion — `a laneless ACCEPTED report must not shadow the surface lane declared in the brief` |
| `slice-389-trap-6` | assertion — `invokeRom must decide the spawn args in exactly one place` |

Trap coverage, one test each:

1. **`slice-389-trap-1`** — rounds 2, 3 and 5 of a surface slice all spawn `--effort high` and never
   `max`; a forced-fresh rework (>500 chars of feedback) is fresh and still at the lane effort;
   `applyLaneArgs` leaves the array it is given untouched, because Jordan's spawn shares
   `config.claudeArgs` by reference.
2. **`slice-389-trap-2`** — `validateIntakeMeta` passes a slice file with no `lane`, and that file
   reads as core through `resolveLane`, `laneEventFields` and `romSpawnArgs`.
3. **`slice-389-trap-3`** — nine shared strings (report path, frontmatter example, the metrics
   sentence, `## What you run`, the trailer instruction) present in both lanes; the template's own
   headings present on the surface lane; a surface brief with criteria still gets its hash lines
   under `## Your hash lines`.
4. **`slice-389-trap-4`** — a real squash produces exactly one `Lane:` line, equal to
   `Lane: surface`, positioned after `Slice-Branch:`; a second squash with `lane: 'lightweight'`
   writes `Lane: core`, so no third value can reach the commit message.
5. **`slice-389-trap-5`** — a laneless `-ACCEPTED.md` does not shadow `lane: surface` on
   `-PARKED.md` (the exact "every squash would say core" failure); a lane on `-ACCEPTED.md` with no
   PARKED file yields core; a lane on `-DONE.md`/`-IN_PROGRESS.md` yields core.
6. **`slice-389-trap-6`** — source checks: exactly one `romSpawnArgs({` call inside `invokeRom`'s
   body and no surviving inline `clauseArgs = ['--resume'`; the DONE event spreads
   `laneEventFields(sliceMeta, clauseArgs)`; `handleAccepted` contains
   `const lane = readSliceMeta(id).lane;` and `acceptAndMerge(…, { lane })`; the template and Nog
   call sites pass the lane; the pinned `registerCommissioned(id, { title, goal, body: sliceContent });`
   is byte-for-byte intact.

I did not run the full safety-net suite or the browser suite, and I did not look in a browser —
nothing here renders.

Two other files consume `buildDoneTemplate` structurally, so I checked their invariants without
running them, by printing the template in both lanes: `j-red-dev-files-fix-request` splits on
`^## What you run$` and caps that section at four bullets (still 4 in both lanes — my
`## Your report` section sits *before* that heading), and `j-locks-regenerated-at-landing` requires
`## Your hash lines` to precede the hash lines (still true in both lanes).

## Screen hooks

None. No criterion in this slice touches the screen; the whole diff is CLI, orchestrator, prompt
text and config. The `lane` field does reach the register as a new key on the COMMISSIONED, DONE
and SLICE_SQUASHED_TO_DEV events, and `DONE` additionally carries `effort` — available to the
History panel whenever someone wants to show them, but nothing in `dashboard/` was changed to read
them.

## Tests moved or weakened

One existing test changed, in `regression/orchestrator/j-report-metrics-filled.test.js:431`:

```
-  assert.match(SRC, /function buildDoneTemplate\(\{ id, worktreeDonePath, sliceBranch, sliceContent \}\)/,
-    'the four-key signature is what slices 387 to 389 extend');
+  assert.match(SRC, /function buildDoneTemplate\(\{ id, worktreeDonePath, sliceBranch, sliceContent, lane \}\)/,
+    'the signature slices 387 to 389 extend — sliceContent for the hash lines, lane for the report headings');
```

Why: slice 386's trap 4 pins `buildDoneTemplate`'s exact destructuring, and its own message says the
four-key signature "is what slices 387 to 389 extend". Task 3 of this brief requires the function to
gain a `lane` field, so the pin had to be re-cut to the new signature. It is not loosened — it still
requires all five keys in order and would still fail on a renamed, reordered or dropped key. That
file is green after the change (9 tests, 9 pass); it is the only existing test file I ran, because I
had edited it.

Nothing else moved, renamed or removed. Adding `lane` to `regression/helpers/slice-factory.js` is a
change to a helper, not to a test: it makes the field present for the two existing tests
(`j-stage-and-watch-slice.test.js:63`, `j-stage-and-watch-slice-cli.test.js:249`) that loop
`REQUIRED_FIELDS`, exactly as Task 1 asks. Both now check nine fields instead of eight; the CLI
test's *name* still says "all 8 required fields", which is prose I left alone rather than rename an
AC-tagged test for cosmetics.

## Commit

Branch `slice/389`, cut from `dev` at `4ccf3fb`. Two commits, in the order "How to finish" specifies.

1. `eea507e` — `S389: Two lanes: the brief says surface or core, and Sam, Jordan and the effort
   setting follow it`. Code, the new test file, the updated pin and `regression/COVERAGE.lock`
   (620 guards over 60 sources), with the five `AC:` trailers and `Lane: core` in the message.
2. This report plus `regression/AC-MANIFEST.lock`, after `node scripts/build-ac-manifest.js`.

## Conflicts with the brief

None. One note rather than a conflict: the role file says I run only the test file I wrote, and I
ran one more — `regression/orchestrator/j-report-metrics-filled.test.js`, the file whose pin I had
just edited. Nine tests, under a second. I did not run the suite.

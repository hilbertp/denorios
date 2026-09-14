---
id: "393"
title: "The daemon survives its own recovery: four faults from the first live run"
from: rom
to: nog
status: DONE
slice_id: "393"
branch: "slice/393"
completed: "2026-09-14T00:52:00.000Z"
tokens_in: 190
tokens_out: 113281
elapsed_ms: 1391596
estimated_human_hours: 5.0
compaction_occurred: false
tokens_cache_read: 13420685
cost_usd: 11.873787499999999
---

## Summary

Four faults, one guard each, all in `bridge/orchestrator.js`.

**1 · The landing that killed the daemon.** `LOCK_FILES` and `BRANCH_STATE_PATH` now sit with
the other module constants at the top of the file, above the startup block. The block calls
`crashRecovery()` *during* module evaluation, so everything declared below it is in its
temporal dead zone while recovery runs — and a recovery that lands an orphaned ACCEPTED slice
runs the whole squash path from in there. I moved `BRANCH_STATE_PATH` as well as the
`LOCK_FILES` the brief names: it is the same landmine one step further on, read by
`squashSliceToDev` inside a `try/catch`, so the same recovery would have swallowed it as
"branch-state update failed" and left the dashboard's dev tip stale. The brief's task 1 asks
for "anything else the landing path reads at module scope"; this is that.

**2 · Recovery reading an approval as a completion.** `isTerminal()`'s trash signal now skips
entries whose suffix records staging rather than completion. I read `bridge/trash/` first, as
trap 3 says: 1317 entries, and the only suffixes the dashboard writes are `.approved` (the
approve button, 42 + 13 more already buried under a `.branch-checkout`) and `.amended` (the
refine button). Everything else in there — `.cleanup-ARCHIVED-`, `.cleanup-ERROR-`,
`.attemptN`, `.orphan`, `.pass`, `.ratelimit`, `.api-retry` — records something that happened
to a slice that had already run and stays terminal. `.branch-checkout` is stripped before the
suffix is read, because it is filesystem housekeeping that lands on top of whatever was
already there.

**3 · The dispatch slot nobody handed back.** The four-line reset the tail of the exit
callback performs is now `releaseDispatch(id)`, and every early return out of the verify
verdict — including the one that froze the queue for two hours on 2026-09-11 — calls it
before returning.

**4 · Honest reports are no longer fake work.** `classifyHonestNonProduct()` reads the report
*inside* the `if (!verify.ok)` branch (never around the call — trap 1) and returns `blocked`,
`partial`, `nothing_to_do` or null. BLOCKED writes no ERROR file, registers `BLOCKED` with the
report's summary line, and sends the ticket back to staged/ for O'Brien with the blocker at
the top of its body — the route the slice-broken escalation already uses. PARTIAL falls
through to review untouched. A report-only branch whose Summary says the work was already on
dev registers `NOTHING_TO_DO` and archives the ticket without review. Everything else is still
filed exactly as before.

## What changed

- `bridge/orchestrator.js`
  - `LOCK_FILES` and `BRANCH_STATE_PATH` moved to the module-constant block above the startup
    block, with a comment saying why they may not be moved back.
  - `STAGING_TRASH_SUFFIXES` + `trashEntryRecordsStaging()` added; `isTerminal()` signal 4
    now ignores staging entries.
  - `releaseDispatch(id)` added next to `activeChildren`; called on all three new early
    returns and on the verification-failure ERROR return.
  - `doneSummarySection()`, `NOTHING_TO_DO_SUMMARY_RES` and `classifyHonestNonProduct()`
    added beside `verifyRomActuallyWorked()`; the verdict branch rewired into
    `!honest` → ERROR (unchanged text), `blocked`, `nothing_to_do`, fall-through for PARTIAL.
  - `closeSliceBlock()` takes an optional `statusLine`. A slice can now end in a state that
    is neither "done, off to review" nor "failed"; without this the console box would promise
    a Jordan round that is not coming. No existing call site changed.
  - `HEARTBEAT_FILE` is a `let`, and `_testSetHeartbeatFile` / `_testGetDispatchState` /
    `crashRecovery` / `releaseDispatch` / `classifyHonestNonProduct` / `doneSummarySection` /
    `trashEntryRecordsStaging` / `STAGING_TRASH_SUFFIXES` are exported. Test seams in the
    style the file already uses; a heartbeat assertion has to be able to point the file
    somewhere else or it writes live bridge state (#99992).
  - `classifyHonestNonProduct` passes `cwd: PROJECT_DIR` to `runGit`. In the daemon that is
    the same directory `gitFinalizer.init()` supplies; in a fixture it is the difference
    between reading the fixture's diff and the live repo's.
- `regression/dispatch-execution/j-daemon-survives-recovery.test.js` (added)

No `e2e/` file was touched.

## Acceptance criteria verification

Command for all four, run repeatedly while working:
`node --test regression/dispatch-execution/j-daemon-survives-recovery.test.js` → tests 7, pass 7, fail 0.

- **slice-393-ac-1** — `j-daemon-survives-recovery.test.js`, test `slice-393-ac-1`. Builds a
  whole repo (bare origin, main + dev, an un-landed `slice/777` with real product work, an
  orphaned `777-ACCEPTED.md`, stub lock derivers) and runs the daemon against it in a child
  process with the orchestrator as the entry module. Asserts exit 0, no "before
  initialization" in stderr, a `SLICE_SQUASHED_TO_DEV` event, and that the sha it names is
  really dev's tip. **Pass.**
- **slice-393-ac-2** — test `slice-393-ac-2`. A queue holding only `390-IN_PROGRESS.md` and a
  trash holding only `390-STAGED.md.approved`: `isTerminal` says false and `crashRecovery()`
  returns `{id:'390', type:'requeued'}` with the file renamed to QUEUED. **Pass.**
- **slice-393-ac-3** — test `slice-393-ac-3`. Writes the heartbeat file as the daemon left it
  on 2026-09-11 (status `processing`, `current_slice: "388"`, elapsed 923s), calls
  `releaseDispatch`, and asserts the file now reads idle with every slice field null and
  `processing === false`. Then brace-matches the verdict branch out of the source and asserts
  every `return;` in it is preceded by `releaseDispatch(id);`. **Pass.**
- **slice-393-ac-4** — test `slice-393-ac-4`. Drives `classifyHonestNonProduct` against a real
  git fixture whose branch changes nothing but its own DONE report: BLOCKED → `blocked` with
  the summary line, `status: partial` → `partial` (case-insensitive), slice 394's actual
  wording → `nothing_to_do`, an ordinary "I implemented the whole thing" → null, and the same
  already-on-dev wording on a branch that *did* change something else → null. Then asserts the
  blocked route writes no ERROR file, registers `BLOCKED` and writes to `STAGED_DIR`; the
  nothing-to-do route writes no ERROR file, registers `NOTHING_TO_DO` and renames to
  `{id}-ARCHIVED.md`; and that PARTIAL has no branch of its own, so it falls through to the
  `registerEvent(id, 'DONE')` that starts the review. **Pass.**

Half of ac-3 and ac-4 is read off the source rather than driven end to end, and I want that
said plainly rather than discovered: the code lives inside `invokeRom`'s exit callback, which
is a closure with no export, and the only way to reach it for real is to dispatch a slice — a
dispatch builds a worktree under the hardcoded `/tmp/ds9-worktrees`, which is where the live
crew workspaces are (#99992). The decision each route turns on is unit-tested against a real
git fixture; the routing itself is pinned by brace-matching the exact block out of the file,
the same technique `j-rom-work-substance` trap 1 already uses on this call site.

## Safety-net tests

One per acceptance criterion plus one per trap: 7 tests in
`regression/dispatch-execution/j-daemon-survives-recovery.test.js`. Each carries its tag and
the `// @ac-hash:` line from the brief.

Fix removed (`git checkout HEAD -- bridge/orchestrator.js`, test file kept), re-run: **tests 7,
pass 0, fail 7.** All seven went red. I used a checkout rather than `git stash` deliberately —
the stash stack is shared with the main checkout and the other crew worktrees, and popping it
could take someone else's work.

The two that matter went red for the right reason, not for a missing export:

- ac-1 died exactly as the daemon did on 2026-09-13, at
  `bridge/orchestrator.js:8082  const quotedLocks = LOCK_FILES.map(shQuote).join(' ');` —
  "Cannot access 'LOCK_FILES' before initialization", child exit 1.
- ac-2 failed on behaviour: `isTerminal('390')` returned `true` where the guard wants `false`.

ac-3, ac-4 and traps 1–3 went red on the assertions that name the new behaviour (no
`releaseDispatch` before the returns; no `classifyHonestNonProduct` in the branch;
`LOCK_FILES` declared after the startup block; `trashEntryRecordsStaging` absent).

I also ran the one existing file trap 1 names, `regression/orchestrator/j-rom-work-substance.test.js`:
tests 10, pass 9, fail 0, 1 skipped (`slice/371` is not in this checkout). Its trap-1 regex
still finds the block and still finds `writeErrorFile(errorPath, id, verify.reason` inside it —
the honest-report skip is nested one level in so that regex's first `return;` is still the
ERROR path's. I ran no other test file, and not the suite.

The ac-1 child process fences `fs.rmSync` to the fixture root. That is not belt-and-braces:
on the first run the fence logged
`refused rmSync outside the fixture: /tmp/ds9-worktrees/393` — the daemon's
`cleanupDeadWorktrees()` sweeps orphaned worktree dirs out of the hardcoded
`/tmp/ds9-worktrees` judged against *its own* repo's worktree list, and in a fixture that list
is empty, so it would have deleted this very workspace. Anyone reusing this harness must keep
the fence. (Worth a brief of its own: the same code path in the live daemon compares
`/tmp/...` strings against git's resolved `/private/tmp/...` output, which is the only reason
it has never fired in production on macOS.)

I did not look in a browser; nothing here reaches the screen except two console lines in the
watcher's terminal.

## Screen hooks

None. No criterion touches the dashboard. Two new lines appear in the watcher's own terminal
output (`Slice {id} blocked — returned to O'Brien`, `Slice {id} — Nothing to do, already on
dev`) and two new register events (`BLOCKED`, `NOTHING_TO_DO`) that the dashboard's history
does not yet render; rendering them is not in this brief.

## Tests moved or weakened

None. No existing test was moved, renamed, changed or removed.

## Commit

One commit on `slice/393`, with the four `AC:` trailers and `Lane: core`.

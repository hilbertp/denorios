---
id: "221"
title: "F-WG — isGitProcessAlive: combine lsof + age + PID-alive checks"
from: rom
to: nog
status: DONE
slice_id: "221"
branch: "slice/221"
completed: "2026-04-26T14:02:00.000Z"
tokens_in: 28000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Replaced the binary lsof-only `isGitProcessAlive` check with a combined three-signal check that eliminates the false-positive deadlock from 2026-04-24. The function now returns `{ alive: boolean, reason: string }` for full observability.

## Changes

**`bridge/git-finalizer.js`** (83 net LOC):

- Added constants: `LOCK_AGE_PID_THRESHOLD_S = 60`, `LOCK_AGE_FORCE_PRUNE_S = 600`
- Added `isPidAlive(pid)` — uses `process.kill(pid, 0)`, handles EPERM correctly
- Added `readLockPid(lockPath)` — reads PID from lockfile content (git writes PID into newer lockfiles)
- Rewrote `isGitProcessAlive(lockPath?)` — returns `{ alive, reason }` with combined signals:
  - lsof empty → `alive: false, reason: 'lsof_empty'`
  - lock >10min → `alive: false, reason: 'lock_age_Ns_exceeds_max'`
  - lock >60s + dead PID → `alive: false, reason: 'pid_N_dead_lock_age_Ns'`
  - lock vanished mid-check → `alive: false, reason: 'lock_vanished'`
  - Conservative default → `alive: true, reason: 'lsof_held_lock_young_Ns'` or `'lsof_held_pid_alive_or_unreadable'`
- Updated `pruneOrphanLock` to use `.alive` and log `.reason`
- Updated `sweepStaleResources` Condition C to use combined check
- Simplified `isLockHeldByProcess` to delegate to `isGitProcessAlive(lockPath).alive`

**`test/git-finalizer.test.js`** (+10 tests, 18 total):

- Test 9: lsof empty → alive=false with reason 'lsof_empty'
- Test 10: structure check — fresh lock returns object
- Test 11: isPidAlive returns false for dead PID (2147483647)
- Test 12: isPidAlive returns true for own PID
- Test 13: readLockPid parses valid PID from file
- Test 14: readLockPid returns null for non-PID content
- Test 15: readLockPid returns null for missing file
- Test 16: pruneOrphanLock prunes 11min-old lock (force-prune path)
- Test 17: pruneOrphanLock prunes lock with dead PID content
- Test 18: isGitProcessAlive returns {alive: boolean, reason: string}

## Acceptance criteria

- [x] AC0. Skeleton DONE first commit
- [x] AC1. `isPidAlive(pid)` exists and uses `process.kill(pid, 0)`
- [x] AC2. `isGitProcessAlive` returns `{ alive: boolean, reason: string }`
- [x] AC3. Prune allowed when lsof returns empty (existing path preserved)
- [x] AC4. Prune allowed when lock >10 minutes regardless of lsof
- [x] AC5. Prune allowed when lock has readable PID and isPidAlive returns false
- [x] AC6. Prune declined when lock <60s AND lsof non-empty AND no readable PID
- [x] AC7. Regression tests cover all five paths (10 tests)
- [x] AC8. Diff under 100 LOC excluding tests (83 net LOC)
- [x] AC9. No changes outside `bridge/git-finalizer.js` and test file

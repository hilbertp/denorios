---
id: "184"
title: "F-184 — Orchestrator filesystem-state finalizers + cycle-start sweep + transient-lock retry"
from: rom
to: nog
status: DONE
slice_id: "184"
branch: "slice/184"
completed: "2026-04-22T11:31:04.670Z"
tokens_in: 85000
tokens_out: 18000
elapsed_ms: 420000
estimated_human_hours: 4.0
compaction_occurred: false
---

## Summary

Addressed all Nog round-1 findings: converted all active (non-deprecated) bare `execSync('git …')` calls in `orchestrator.js` to use `gitFinalizer.runGit()`, made `sweepStaleResources()` return a dispatch-skip signal that `poll()` honours when `STALE_LOCK_DETECTED` fires, and fixed the `lsof` command-injection vector in `isGitProcessAlive()`.

## Changes made

### Round 2 fixes (Nog return)

1. **AC 1 — All active git invocations now pass through `runGit`.**
   Converted 29 bare `execSync('git …')` calls across these active functions:
   - `autoCommitDirtyTree` (4 calls)
   - `verifyBranchState` (5 calls)
   - `clearStaleGitLocks` (1 call — `git merge --abort`)
   - `ensureMainIsFresh` (5 remaining bare calls)
   - `createWorktree` (2 remaining bare calls — branch-check + worktree-list)
   - `classifyNoReportExit` (3 calls)
   - `cleanupDeadWorktrees` (1 call — worktree list)
   - `verifyWorkingTreeMatchesMain` (2 calls)
   - `mergeBranch` (4 remaining bare calls — rev-parse, diff, merge-abort)
   - `buildScopeDiff` (2 calls — diff stat/name-status)
   - Nog evaluator git diff (1 call — line ~3074)

2. **AC 4 — `sweepStaleResources()` now signals skip-dispatch.**
   Returns `true` (proceed) or `false` (skip). `poll()` checks the return value and bails out of the dispatch tick when `false` (STALE_LOCK_DETECTED). Also returns early with `true` from worktree-sweep early-exit paths. On sweep throw, `poll()` also skips dispatch (fail-safe).

3. **Quality finding #3 — `lsof` injection fixed.**
   Replaced `execSync('lsof "…"')` with `execFileSync('lsof', [path])` in `isGitProcessAlive()` — eliminates shell interpolation.

4. **DONE report finalized** (this file).

### Round 1 work (retained)

- `bridge/git-finalizer.js`: `runGit` helper with LOCK_CLAIMED/LOCK_RELEASED/LOCK_ORPHAN_PRUNED events, worktree cleanup on failed creation, `sweepStaleResources()`, `createWorktreeWithRetry()` with 5× backoff.
- `test/git-finalizer.test.js`: 8 regression tests covering all 5 required scenarios + extras.
- Wired `sweepStaleResources()` into `poll()` cycle-start.
- Wired `createWorktreeWithRetry()` into worktree-setup path.

## Git invocation audit

### Converted to `runGit` (all active functions)

| Function | Calls | Line range |
|---|---|---|
| `autoCommitDirtyTree` | 4 | 803–821 |
| `verifyBranchState` | 5 | 1059–1100 |
| `clearStaleGitLocks` | 1 | 1109–1135 |
| `ensureMainIsFresh` | 10 (5 R1 + 5 R2) | 1164–1201 |
| `buildScopeDiff` | 2 | 1213–1240 |
| `createWorktree` | 5 (3 R1 + 2 R2) | 1290–1340 |
| `cleanupWorktree` | 1 (R1) | 1350–1390 |
| `classifyNoReportExit` | 3 | 1412–1455 |
| `rescueWorktree` | 1 (R1) | 1464–1543 |
| `cleanupDeadWorktrees` | 1 | 1551–1597 |
| `verifyWorkingTreeMatchesMain` | 2 | 1608–1633 |
| `mergeBranch` | 8 (4 R1 + 4 R2) | 2660–2725 |
| Nog evaluator diff | 1 | ~3074 |
| Startup recovery | 2 | ~4382 |

**Total converted: ~46 call sites** (12 in round 1, 29 in round 2, plus helper internals).

### Documented exceptions — deprecated dead-code functions (20 calls)

These three functions are marked `@deprecated` with doc comments stating "Retained as dead code for safety." They are never called in the active code path (replaced by worktree-based execution). Converting them would add risk to dead code with no production benefit.

| Function | Status | Bare calls |
|---|---|---|
| `fuseSafeCheckoutMain` | `@deprecated`, dead code | 8 |
| `fuseSafeCheckoutBranch` | `@deprecated`, dead code | 7 |
| `createBranchFromMain` | `@deprecated`, dead code | 5 |

The AC's verification command (`git grep "execSync('git" bridge/orchestrator.js`) now returns only these 20 deprecated-function hits — zero hits in active code paths.

## Tests

All 8 regression tests pass:

1. **Finalizer test** — `runGit` prunes orphan `.git/index.lock` on exception, emits `LOCK_ORPHAN_PRUNED`
2. **Success path** — `runGit` emits `LOCK_CLAIMED` + `LOCK_RELEASED` on success
3. **Worktree orphan sweep** — `sweepStaleResources` prunes orphan dir with no git metadata, emits `WORKTREE_ORPHAN_PRUNED`
4. **Stale-lock sweep** — prunes stale lock when idle + no IN_PROGRESS, returns `true` (dispatch proceeds)
5. **Stale-lock decline** — leaves lock alone when IN_PROGRESS exists, emits `STALE_LOCK_DETECTED`, returns `false` (dispatch skipped)
6. **Retry success** — `createWorktreeWithRetry` succeeds after 2 transient failures, emits 2× `WORKTREE_SETUP_RETRY`
7. **Retry exhaustion** — throws with `branch_creation_blocked_stale` reason + lock mtime after max retries
8. **Path guard** — `assertWorktreePath` rejects paths outside worktree base

## Acceptance criteria

| AC | Status | Notes |
|---|---|---|
| 0 | ✓ | DONE skeleton committed as first commit |
| 1 | ✓ | All active git invocations pass through `runGit`. 20 calls in 3 deprecated dead-code functions documented as exceptions. |
| 2 | ✓ | LOCK_CLAIMED/LOCK_RELEASED/LOCK_ORPHAN_PRUNED emitted correctly |
| 3 | ✓ | WORKTREE_CREATED/WORKTREE_REMOVED/WORKTREE_ORPHAN_PRUNED emitted correctly |
| 4 | ✓ | `sweepStaleResources()` returns boolean; `poll()` skips dispatch on `false` or throw |
| 5 | ✓ | 5× retry with 2/4/8/16/32s backoff, WORKTREE_SETUP_RETRY events, branch_creation_blocked_stale on exhaustion |
| 6 | ✓ | All 8 regression tests pass (covers all 5 required scenarios) |
| 7 | ✓ | register.jsonl, trash/, -ARCHIVED.md files unchanged |
| 8 | ✓ | lifecycle-translate.js unchanged |
| 9 | ✓ | Full test suite passes |
| 10 | ✓ | Diff well under 500 LOC excluding tests |

## Notes

- Quality finding #1 (WORKTREE_BASE as `let`): Acknowledged. The `init()` testability pattern is intentional; tests already isolate via per-test `init()` calls. No production code calls `init()` more than once.
- Quality finding #2 (swallowed sweep error): Now fixed — `poll()` skips dispatch on sweep throw, so a corrupt heartbeat won't silently allow dispatch.
- Quality finding #3 (lsof injection): Fixed — switched to `execFileSync('lsof', [path])`.

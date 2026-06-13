---
id: "161"
title: "D1 — Nog-return round-2 debug + stderr capture on every subprocess"
from: rom
to: nog
status: DONE
slice_id: "161"
branch: "slice/161"
completed: "2026-04-19T02:17:30.000Z"
tokens_in: 185000
tokens_out: 12000
elapsed_ms: 900000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Fixed the round-2 Nog-return crash pattern and added enriched stderr capture to all ERROR register events.

## Changes

### Part 1 — Round-2 Nog-return crash fixes (bridge/watcher.js)

**Fix 1: Stale PARKED content in amendments.**
In `invokeNog()`, the callback passed the pre-Nog `sliceContent` closure variable to `handleNogReturn()`. After Nog appends its review to the PARKED file and the worktree copy writes it back, the closure still held the old version. The amendment slice therefore embedded the original content WITHOUT Nog's findings — Rom had no review to fix.

Fixed by re-reading `resolvedParkedPath` after the worktree copy, before calling `handleNogReturn()`. Both the RETURN and unreadable-verdict paths now use `updatedSliceContent`.

**Fix 2: Empty branchName in amendment frontmatter.**
If the DONE report lacked a `branch` field, `handleNogReturn` wrote `amendment: ""` and `branch: ""`. Empty strings are falsy, so `invokeRom` did not treat the slice as an amendment — it created a fresh branch from main instead of checking out the existing one. Rom then ran on a clean branch with none of the prior work.

Fixed by deriving `branchName = slice/${rootId}` when the DONE report doesn't include one. The amendment frontmatter now always has a truthy `amendment` and `branch` field.

### Part 2 — Enriched ERROR event payloads (bridge/watcher.js)

Added `truncStderr()` helper (last 2000 chars of stderr, for register readability).

All 5 `registerEvent(id, 'ERROR', ...)` call sites now include:
- `phase` — which lifecycle stage failed (e.g. `rom_invocation`, `worktree_setup`, `validation`)
- `command` — the failing command string
- `exit_code` — numeric exit code or null
- `stderr_tail` — last 2000 chars of captured stderr

Existing `reason` strings are preserved as before.

All `execSync` calls already use `stdio: 'pipe'` or `encoding: 'utf-8'` (both capture stderr). All `execFile` calls capture stderr via the callback. The only `spawn` with `stdio: 'inherit'` is `selfRestart()`, which is the replacement process, not a capturable subprocess.

### Regression test (test/nog-return-round2.test.js)

10 tests covering:
- Amendment content uses updated (post-Nog) PARKED file
- Branch derivation from rootId when branchName is null
- Empty amendment field is falsy (old bug demonstration)
- `truncStderr` truncation and edge cases
- ERROR event payload structure validation
- Source-level grep confirming all ERROR calls have `phase` and `stderr_tail`
- `countNogRounds` works across embedded content
- No `execSync`/`execFile` uses `stdio: 'inherit'`

## Acceptance criteria check

1. ✅ `node bridge/watcher.js` starts cleanly — verified, shows normal startup banner
2. ✅ Round-2 Nog-return path exercised by test — 10/10 pass
3. ✅ `grep` for subprocess invocations: 0 use `stdio: 'inherit'` (except selfRestart spawn)
4. ✅ All ERROR events carry `phase`, `command`, `exit_code`, `stderr_tail` + existing `reason`
5. ✅ The stale-content bug that would produce bare "No report written" is fixed
6. ✅ No existing register entries rewritten — register.jsonl grows append-only
7. ✅ Changes limited to `bridge/watcher.js` and `test/nog-return-round2.test.js`

## Files changed

- `bridge/watcher.js` — crash fix + stderr capture (3 fixes, ~50 net lines)
- `test/nog-return-round2.test.js` — new regression test (10 cases)

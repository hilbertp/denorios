---
id: "396"
title: "Sam's and Jordan's sessions are streamed, so no output cap can kill a build or review"
from: rom
to: nog
status: DONE
slice_id: "396"
branch: "slice/396"
completed: "2026-09-25T20:12:00.000Z"
tokens_in: 258
tokens_out: 147862
elapsed_ms: 2828122
estimated_human_hours: 7.0
compaction_occurred: false
tokens_cache_read: 24452914
cost_usd: 18.939448000000002
---

## Summary

The buffer is gone. Sam's and Jordan's sessions are now read line by line as they arrive: every chunk is teed to the session log and then dropped, and what the run needs afterwards — the result event, the session id, four whole-session flags and the last 64 KB of each stream — is kept as it goes past. A 300 MB session finishes on its own and is recorded in full; the orchestrator's memory rises about 17 MB while it does.

Nothing the run records changed. The DONE report's numbers, the register event's tokens, cost and phase split, the timing sidecar, the session id on the PARKED ticket and Jordan's four review numbers all still equal what the session's whole stdout gives — that equality is what `slice-396-ac-4` and `slice-396-ac-9` assert, with the session's own log as the oracle. What did change, by design: the ERROR file's stdout and stderr sections are now bounded at 65,536 bytes each (they used to be the whole session), and Jordan's log is no longer rewritten at the end with a `--- stderr ---` block — his stderr is teed where it arrived, like Sam's.

Two things the streaming had to be careful about, both new risks that reading the whole text never had: a chunk boundary is not a line boundary (and not a character boundary either), and `spawn` reports "cannot start the command" as an event, not as a callback argument. Both are covered by trap tests.

## What changed

- **`lib/session-stream.js` (added)** — one exported function, `streamSession(options, done)`. It spawns the command with piped stdio, writes the prompt to stdin and ends it, tees stdout (and stderr chunks prefixed `[stderr] `) to a write stream at the log path it is given, pauses stdout when that stream is over its high-water mark and resumes on `'drain'`, calls `onActivity()` for every chunk of either stream, joins stdout lines across chunks through a `StringDecoder`, hands every parsed event to `onEvent`, and calls back exactly once — on the child's `close`, or on a spawn `error` — with `{ code, signal, spawnError, retained }`. `retained` holds the last `result` line, the last JSON-object line, the first line carrying a `session_id`, the four whole-session flags, the last 65,536 bytes of each stream and the stdout byte count. The log path is a parameter, which is what lets the test point it at a temp directory.
- **`lib/build-timing.js`** — `attributeRun`'s per-line loop body became `createAttributor()`, an incremental attributor with `event(ev)` and a `result()` that finishes once and returns the same object however often it is asked. `attributeRun(ndjsonText)` stays as a thin wrapper that feeds it every line, so every existing caller (`scripts/build-timing.js` and all of j-build-timing) is untouched.
- **`bridge/orchestrator.js`** —
  - `invokeRom` (:3152): `execFile` and its 256 MB `maxBuffer` replaced by `streamSession`, with `romLogPath` as the log, an `onActivity` that resets the inactivity clock, and the attributor as the per-event callback. `activeChildren.set` keeps the returned ChildProcess and the inactivity check is unchanged. In the exit handler, `stdoutTail`/`stderrTail` are all that is left of the output; `err` is rebuilt from the child's own close (null on a clean exit, otherwise `{ code, signal, killed, message }`, and a spawn failure keeps its own `ENOENT`); `sessionTelemetry` reads the retained result line; `recordBuildTiming` is handed the attributor's finished split; `writeErrorFile`, `rescueWorktree` and `truncStderr` get the bounded tails; `isRateLimit` and `isApiError` read the whole-session flags while `parseRateLimitResetMs` reads the tail; `extractSessionId` reads the result line and falls back to the first line that carried an id.
  - `invokeNog` (:5264): same replacement, `nogLogPath` as the log. The end-of-run log rewrite and the second tee are gone; `reviewTelemetry` reads the retained result line.
  - `recordBuildTiming` now takes either a finished split or, as before, the session's text — the text form is what the lib-less probe and j-build-timing still call.
  - `module.exports` gains `invokeRom` and `invokeNog`, so a test can run a whole session from a copy of `bridge/` and `lib/` in a temp directory.
  - Both `require`s sit inside the two functions, never at module scope: the daemon has to boot in a tree that has no `lib/` at all.
- **`regression/dispatch-execution/j-session-streamed.test.js` (added)** — the safety net; see below.
- Four existing test files had one pinned source assertion each repointed; see `## Tests moved or weakened`.

No `e2e/` file was touched.

## Acceptance criteria verification

Command for every row: `node --test regression/dispatch-execution/j-session-streamed.test.js`. Result: 14 tests, 14 pass, 0 fail.

| Tag | Test file | Result |
|---|---|---|
| slice-396-ac-1 | regression/dispatch-execution/j-session-streamed.test.js | PASS — a 314,592,309-byte session exits 0, writes no ERROR file and no ERROR event, its log is byte-identical to its stdout (sha256 match), and its DONE event carries 1234 / 5678 / 999000 / 4.2424242 off the result line |
| slice-396-ac-2 | regression/dispatch-execution/j-session-streamed.test.js | PASS — a 300 MB Jordan review ends in one NOG_DECISION with verdict REJECTED (not `verdict_unreadable`) carrying the result line's four numbers, and `nog-<id>-round1.log` is byte-identical to its stdout |
| slice-396-ac-3 | regression/dispatch-execution/j-session-streamed.test.js | PASS — heapUsed + arrayBuffers, sampled every 250 ms in the orchestrator process, peaked ~17 MB above the session's start, against the 64 MB bound |
| slice-396-ac-4 | regression/dispatch-execution/j-session-streamed.test.js | PASS — for a normal session, a 2 MB session, a session with no result line and a session with a 70 KB result line, the report's four numbers, the DONE event's four numbers plus `phases`/`calls`/`first_product_edit_s`, `rom-<id>.timing.json` and `rom_session_id` all equal `sessionTelemetry`/`attributeRun`/`extractSessionId` run over the session's whole log; plus `actualTokensOut` on a `rom_no_commits` ERROR |
| slice-396-ac-5 | regression/dispatch-execution/j-session-streamed.test.js | PASS — exit 1 gives `reason: crash`, `exit_code: 1` in the frontmatter, `- Exit code: 1` in the body and `exit_code: 1` on the event; a session silent across the sweep is filed `inactivity_timeout` with `- Signal: SIGTERM`; the stdout/stderr sections are the whole stream at 6,400/3,200 bytes and exactly 65,536 bytes at 256,000/192,000; `rom_self_terminated_mixed` and RESCUE.md keep their 500-character tails; `lastOutput` is the last 2,000 characters of stdout+stderr and `stderr_tail` the last 2,000 of stderr |
| slice-396-ac-6 | regression/dispatch-execution/j-session-streamed.test.js | PASS — "hit your limit" and a rejected `rate_limit_event`, each 300 KB before the end, both requeue to QUEUED with a RATE_LIMITED event and no ERROR file; `waitMs` is within 5,000 ms of the "resets 4am (Asia/Nicosia)" reset + 60,000 ms when that text is in the tail, and exactly 3,600,000 when it is only in earlier stdout; `allowed` + `allowed_warning` with `"overageStatus":"rejected"` is an ERROR `crash` |
| slice-396-ac-7 | regression/dispatch-execution/j-session-streamed.test.js | PASS — `"api_error"` 300 KB before the end requeues to QUEUED with an API_RETRY event and `_api_retry_count: "1"`; `API Error: 529` with the count already at 3 is an ERROR `crash` and no API_RETRY |
| slice-396-ac-8 | regression/dispatch-execution/j-session-streamed.test.js | PASS — a marker line reached the log inside 1 second while the child was still alive; removing one `[stderr] <chunk>` insert per stderr chunk left exactly the stdout, byte for byte; Jordan's log has no `--- stderr ---` block and carries his stderr where it arrived |
| slice-396-ac-9 | regression/dispatch-execution/j-session-streamed.test.js | PASS — with a 70 KB result line the NOG_DECISION carries `reviewTelemetry`'s four numbers read over the whole log; with no result line it carries none of the four keys; a review that exits 1 still ends the round as REJECTED / `verdict_unreadable` |

## Safety-net tests

One file, 14 tests: nine criteria and five traps, then stop.

`regression/dispatch-execution/j-session-streamed.test.js`. Each test builds its own fixture: a temp directory with a local bare origin, `main` + `dev`, a copy of `bridge/` and `lib/`, and a `bridge.config.json` whose `claudeCommand` points at a fixture claude — a step machine that writes exactly the stdout, stderr, pauses, commits and exit code the test asks for, and hashes its own stdout so a 300 MB session can be compared with its log without reading either twice. A driver process requires the copied orchestrator and calls the newly exported `invokeRom`/`invokeNog`, samples its own `process.memoryUsage()` every 250 ms, and exits when the run does. No live log, register, queue or worktree is touched; the fixture ids are in the 9631xx band and every temp directory and worktree is swept per test and again in `after()`.

The oracle for the "nothing changed" criteria is the session's own log: it *is* the whole stdout, so `sessionTelemetry`, `attributeRun`, `extractSessionId` and `reviewTelemetry` are run over it in the test and compared with what the run recorded.

**Break-it check, part 1 — the fix undone.** With `bridge/orchestrator.js` and `lib/build-timing.js` reverted to their committed state (and `invokeRom`/`invokeNog` put back in `module.exports`, so the harness could still reach them and the reds would be about the streaming and not about a missing export): **7 red, 7 green.**

- Red: `slice-396-ac-1`, `slice-396-ac-2`, `slice-396-ac-3`, `slice-396-ac-5`, `slice-396-ac-6`, `slice-396-ac-8`, `trap 4`.
- Green: `slice-396-ac-4`, `slice-396-ac-7`, `slice-396-ac-9`, `trap 1`, `trap 2`, `trap 3`, `trap 5`.

Those seven are the preservation criteria. The old code satisfies them *by construction* — it held the whole session in memory, so of course a split line, an early `api_error` or a 70 KB result line were all readable. They are not tests of the old code; they are the tests that say the new code lost nothing. A stash-the-fix run cannot make them red, so it cannot show they bite.

**Break-it check, part 2 — each still-green test broken on purpose.** Three mutations of the shipped code, each reverted after its run:

| Mutation | Tests run | Result |
|---|---|---|
| The orchestrator reads `retained.stdoutTail` instead of the retained result line (`sessionTelemetry`, `reviewTelemetry`) and `stdoutTail` instead of the whole-session flags (`isApiError`) | ac-4, ac-7, ac-9 | **3 red** |
| `lib/session-stream.js`: the line carry across chunks dropped (`decoder.write(chunk)` with no `pending`), the child's `'error'` listener removed, and stderr chunks no longer calling `onActivity` | trap 1, trap 3, trap 5 | **3 red** |
| `lib/session-stream.js`: stdin set to `'ignore'` | trap 2 | **1 red** |

So all 14 go red against a streaming implementation that loses the thing they guard, and 7 of them also go red against the buffered code this slice replaces.

Full green run after restoring: 14 tests, 14 pass, 0 fail. The four existing files with repointed assertions plus the four that pin `verifyRomActuallyWorked` / `rescueWorktree` were run together afterwards: 50 tests, 49 pass, 0 fail, 1 skipped.

No browser check: this slice touches no screen.

## Screen hooks

None. Nothing this slice changes is visible on a screen — the live-log viewer reads the same `bridge/logs/rom-<id>.log` at the same path, written by the same kind of stream.

## Tests moved or weakened

Four pinned source assertions, each repointed at the new text with an assertion of the same kind and the same strictness. None weakened; no test deleted, renamed or moved.

- `regression/observability/j-build-timing.test.js:348` — `indexOf('const buildTiming = recordBuildTiming(stdout, id, LOGS_DIR);')` → `indexOf('const buildTiming = recordBuildTiming(buildSplit, id, LOGS_DIR);')`. The daemon no longer holds the session's text, so the call takes the split an incremental attributor already produced. The ordering assertion around it (after `sessionTelemetry`, before the DONE event) is unchanged.
- `regression/orchestrator/j-report-metrics-filled.test.js:446` — `assert.match(SRC, /const telemetry = sessionTelemetry\(stdout \|\| '', durationMs\);/)` → `/const telemetry = sessionTelemetry\(telemetryLine, durationMs\);/`. Same kind of assertion; the "exactly one call site" count beside it still reads 1.
- `regression/observability/j-history-cost-includes-jordan.test.js:329` — `assert.match(ORCH_SRC, /const reviewUsage = reviewTelemetry\(stdout\);/)` → the same `assert.match` against `/const reviewUsage = reviewTelemetry\(retained\.resultLine \|\| retained\.lastJsonLine \|\| ''\);/`. The "exactly one call site" count beside it still reads 1.
- `regression/observability/j-watch-slice-live-log.test.js:270-282` — the live-log wiring assertions. The rom log's *path* is still decided in `invokeRom`, so `rom-${id}.log` is still asserted there, plus a new `assert.match` that `invokeRom` hands `logPath: romLogPath` to `streamSession`. The three assertions about the write stream itself (`createWriteStream`, the stdout tee, the close) now read `lib/session-stream.js`, which is where that stream lives after this slice — same three claims, same `assert.match` form, against the file that now makes them true. One new `const STREAM_SRC` at the top of the file points at it.

## Commit

`b7056ce` on `slice/396` — "S396: Sam's and Jordan's sessions are streamed, so no output cap can kill a build or review", carrying all nine `AC:` trailers. That commit holds the whole slice: the helper, the two rewired functions, the new safety net and the four repointed assertions. A second, one-line commit follows it, correcting this paragraph — a report cannot name the commit that contains it.

Note for whoever lands this: the brief asks for `launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator` after the slice is on dev, because `bridge/orchestrator.js` changed. I have not run it — this session is the daemon's own child, and restarting it would have killed the run that wrote this report. No dashboard restart is needed.

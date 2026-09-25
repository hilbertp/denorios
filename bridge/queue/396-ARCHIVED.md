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

<!-- ds9:sticker v1 -->

# Sam's and Jordan's sessions are streamed, so no output cap can kill a build or review — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "396"
title: "Sam's and Jordan's sessions are streamed, so no output cap can kill a build or review"
goal: "Sam's builds and Jordan's reviews are read line by line as they run, so a session of any size finishes and is recorded instead of being killed by an output cap."
from: obrien
to: rom
priority: high
lane: core
created: "2026-09-14T17:02:44.752Z"
timeout_min: 30
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-25T19:16:59.629Z"
approval_sig: "50b4c8c471ed99f5287bf9b0490ae7e632faeda16cb6c8cc7985853550e5eca9"
rom_session_id: "3d41f3fc-181b-480d-9556-30801a48bc92"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-25T20:12:00.000Z"
    durationMs: 2828122
    tokensIn: 258
    tokensOut: 147862
    costUsd: 18.939448000000002
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "The buffer is gone on both sides, all nine ACs hold (14/14 green, ac-hashes verified, equivalences checked against the functions themselves), scope is exactly the eight expected files, and the break-it report is honest about its 7 red / 7 green."
total_durationMs: 2828122
total_tokensIn: 258
total_tokensOut: 147862
total_costUsd: 18.939448
round: 1
---

### Sam's and Jordan's sessions are streamed, so no output cap can kill a build or review

<!-- Lane: core. It changes how the orchestrator starts and reads Sam's and Jordan's sessions (bridge/orchestrator.js, lib/). -->

#### Goal

Philipp, 2026-09-24: "do the rewrites." The ask being rewritten is Taylor's, from the 09-14 handoff (5a4fcfc): "Slice 396 (staged) removes the buffer: the session is streamed line by line."

After this lands, the orchestrator reads Sam's and Jordan's sessions line by line as they arrive and keeps only what it needs afterwards, so no session is killed for its size and every number, log and error file is still recorded.

#### Context

- On 2026-09-14 slices 358 (28 min) and 363 (24 min) were killed by `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` after reading screenshots of 160-420 KB each into the session. Commit a8da61f raised Sam's cap to 256 MB as a stopgap, and handoff 5a4fcfc names this slice as the removal. The rom-358/363 logs no longer exist.
- `bridge/orchestrator.js` `invokeRom` :3002 starts claude with `execFile` and `maxBuffer: 256 MB` (:3153-3165). Its exit callback reads the whole `stdout` and `stderr` at :3180, :3188, :3284, :3291, :3463, :3468, :3475, :3533-3538, :3582, :3647, :3654 and :3684. The live tee is at :3726-3735, and the prompt goes in on stdin at :3755.
- `invokeNog` :5018 uses `execFile` with a 10 MB cap (:5233-5241). :5249 reads the review's cost with `reviewTelemetry(stdout)` (slice 402). :5253 then overwrites the live tee opened at :5672-5677 with `stdout + '--- stderr ---' + stderr`. The prompt goes in on stdin at :5679.
- `writeErrorFile` :5782 puts the whole stdout and stderr into the ERROR file for every reason except rom_self_terminated_* (:5813-5814), and their last 2,000 characters into bridge/errors/<id>-ERROR.json (:5870, served by /api/bridge/errors). Julian's non-gate path also calls it (:8070, :8098, :8143), so bound what `invokeRom` passes in and leave the function unchanged. Run the exit logic on the child's `close` event, which fires after stdout has ended, not on `exit`.
- The daemon must load in a tree with no lib/ (lib-less probe at j-build-timing.test.js:287-306; j-daemon-survives-recovery.test.js:144-147 copies only bridge/). So require the new helper inside `invokeRom` and `invokeNog`, as `recordBuildTiming` does at :576, never at module scope. ADR-JULIAN-ALONGSIDE.md:295 reuses this helper for Julian's per-card log.
- Existing tests pin today's exact source text: j-build-timing.test.js:345-346, j-report-metrics-filled.test.js:446, j-history-cost-includes-jordan.test.js:329-331 and j-watch-slice-live-log.test.js:272-277. Five places in four files pin `verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut)`: j-rom-work-substance:267, j-report-metrics-filled:253/438, j-daemon-survives-recovery:431 and test/rom-verification:133. test/orchestrator-no-report-rescue:119 pins the prefix `rescueWorktree(id, sliceBranch, noReportClass`. Keep those calls exactly as they are. If another pinned line changes, point its assertion at the new text with an assertion of the same kind. The gate reads that as reworded (lib/assert-direction.js:171-185), so it needs no trailer.
- The 300 MB fixtures are generated by the child at run time and written to an `os.tmpdir()` directory that is removed in `finally`. They never go under bridge/logs/, because the disk filled up on 09-14 and 09-24 (.claude/roles/worf/inbox/HANDOFF-RULING-AMENDMENT-PROOF-LANES-FROM-DAX.md:76, HANDOFF-PIPELINE-FAULTS-2026-09-24-FROM-OBRIEN.md:21-27).
- Restart: this changes bridge/orchestrator.js, so restart the daemon after landing (`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`). No dashboard restart is needed.

#### Out of scope

- Not planned: Julian's two claude spawns keep `execFile`: `invokeBashirNonGate` :8048 (10 MB) and `defaultQaSpawn` :8478 (256 MB). ADR-JULIAN-ALONGSIDE step D rebuilds them.
- Not planned: the `maxBuffer` options on git and regression-runner calls (:2532, :2615, :5166, :8774) stay as they are.
- Not planned: the ghost ERROR file that a dashboard abort still leaves behind (HANDOFF-PIPELINE-FAULTS-2026-09-24-FROM-OBRIEN.md item 3) is a separate bug.
- Proposed follow-up: take the rate-limit pause from the rejected `rate_limit_event`'s `resetsAt` instead of the "resets 4am (TZ)" text.
- Proposed follow-up: `/api/log/<id>` (dashboard/server.js:2171 `readRomLog`) reads the whole rom log on every poll, so a 300 MB log costs the dashboard 300 MB per request.
- Proposed follow-up: the session log stream (today :3151 and :5674, after this slice inside the new helper) has no error listener, so a full disk (ENOSPC) while a session is being teed throws in the daemon.

#### Tasks

1. Add `lib/session-stream.js` exporting one function. It:
   - starts the command with `spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })`, writes the prompt to stdin and ends stdin;
   - tees stdout, and stderr chunks prefixed `[stderr] `, to the log path it is given. The log is a write stream opened with flags `'w'` and ended on `close`. Pause stdout while that stream is above its high-water mark and resume on `'drain'`;
   - calls `onActivity()` for every stdout and stderr chunk;
   - joins stdout lines across chunks and keeps only: the last line whose JSON `type` is `result`, the last line that parses as a JSON object, the first line carrying a `session_id`, four flags set over the whole session (`hit your limit`; a `rate_limit_event` line with `"status":"rejected"`; `"api_error"`; `/API Error: 5\d\d/`), the last 65,536 bytes of stdout and of stderr, and the stdout byte count;
   - passes each parsed event to an optional per-event callback;
   - calls back exactly once, on `close` or on a spawn `error`, with `{ code, signal, spawnError, retained }`, and returns the ChildProcess.
   The log path is a parameter, so a test can point it at a temp directory.
2. `lib/build-timing.js` `attributeRun` :207: move the per-line loop body (:217-284) into an incremental attributor that takes one event at a time and finishes once. Keep `attributeRun(ndjsonText)` as a wrapper that feeds it every line, so j-build-timing's calls that pass text still hold.
3. `bridge/orchestrator.js` `invokeRom` :3002: replace `execFile` (:3153-3165) with the helper. Pass `romLogPath` (:3149) as the log, an `onActivity` that does what :3726-3735 do, and the attributor as the per-event callback. `activeChildren.set` (:3721) keeps the returned ChildProcess, and the inactivity check (:3738-3752) stays as it is. In the exit handler, rewrite each read of `stdout`, `stderr` and `err`:
   - :3180 `sessionTelemetry` gets the retained result line, or the last JSON-object line if there is none;
   - :3188 `recordBuildTiming` writes the sidecar from the attributor's result. Keep the form that takes text working for its tests;
   - `writeErrorFile` at :3284, :3468 and :3647 and `rescueWorktree` at :3463 get the stdout and stderr tails. `truncStderr` at :3291, :3475 and :3654 gets the stderr tail;
   - `isRateLimit` :3533 and `isApiError` :3582 read the whole-session flags. `parseRateLimitResetMs` :3538 reads the last 64 KB of stdout, and the function itself does not change;
   - :3684 `extractSessionId` must return the same id as it does on the whole text today: the id on the result line, or on the last JSON-object line when there is no result line; if that line carries none, the first line with a `session_id`;
   - `err` for :3248, :3513-3521, :3647 and :3653 is null when the code is 0 and there is no signal. Otherwise it is `{ code, signal, killed: child.killed, message }`, and a spawn error keeps its own `code` (for example `ENOENT`).
   Remove the `maxBuffer` option and its comment.
4. `invokeNog` :5018: replace `execFile` (:5233-5241) with the helper, using `nogLogPath` (:5231) as the log. Delete the exit-time rewrite (:5251-5256) and the second tee (:5672-5677). At :5249, `reviewTelemetry` gets the retained result line, or the last JSON-object line if there is none. The function itself does not change. Build `err` as in task 3, so :5294 and :5312 behave as they do today.
5. `module.exports` (:9903): add `invokeRom` and `invokeNog`, so a test can call them from a copy of bridge/ and lib/ in a temp directory whose bridge.config.json (read by `loadConfig` :50) points `claudeCommand` at a fixture script. `LOGS_DIR` (:126) then resolves inside that copy.
6. Point the pinned source assertions listed in Context at the new text, just as strictly, and list each one under ## Tests moved or weakened.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### Traps

1. A stdout line can arrive split across two chunks, and so can a multi-byte UTF-8 character inside it. A result line, a rejected `rate_limit_event` line or the text `hit your limit`, written in two parts with a pause in between, must still be recognised, and a character split that way must reach the log and the recorded values intact. Reading the whole output never split either, so no test covers this today.
2. The prompt reaches claude on stdin (:3755, :5679). Starting the child with stdin set to `'ignore'`, as the old draft of this brief said, starts Sam and Jordan with an empty prompt. A fixture child that reports how many stdin bytes it received must see the full prompt.
3. When claude cannot be started (`ENOENT`), `spawn` reports it as an `error` event instead of a callback argument. If nothing handles that event, it throws and takes the daemon down. It must produce exactly one ERROR file and one ERROR event with reason `crash` for Sam, and one round with an unreadable verdict for Jordan, as `execFile`'s callback did.
4. Pause, resume and abort (`handlePause` :6171, `handleResume` :6211, `handleAbort` :6244) signal the `activeChildren` entry through `.pid` and check `.exitCode`. The entry must stay the real child process: pausing a running fixture session stops its output, resuming starts it again, and abort ends the process.
5. Output is what keeps a session alive (:3726-3735 reset the inactivity clock). If a chunk does not reach `onActivity`, a session that is still talking is killed as `inactivity_timeout`. A session that writes only to stderr, more often than a short inactivity limit, must run to its end.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-396-ac-1: A Sam session that writes more than 300 MB of stream-json to stdout, writes its DONE report and ends with a result line exits on its own with code 0: it is not killed, no ERROR file or ERROR event is written for it, its log (bridge/logs/rom-<id>.log; a temp directory in the test) is byte-identical to its stdout when it wrote nothing to stderr, and its DONE register event carries tokensIn, tokensOut, tokensCacheRead and costUsd equal to the result line's usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens and total_cost_usd.
- slice-396-ac-2: A Jordan review session that writes more than 300 MB of stream-json to stdout, writes a REJECTED verdict and ends with a result line exits on its own with code 0: the round is recorded as a NOG_DECISION event with verdict REJECTED (not reason verdict_unreadable) carrying tokensIn, tokensOut, tokensCacheRead and costUsd equal to the result line's, and bridge/logs/nog-<id>-round<N>.log (a temp directory in the test) is byte-identical to its stdout when it wrote nothing to stderr.
- slice-396-ac-3: While a Sam or Jordan session streams 300 MB, the orchestrator process's memory (heapUsed plus arrayBuffers from process.memoryUsage, sampled every 250 ms) never rises more than 64 MB above its value when the session started.
- slice-396-ac-4: Every value Sam's run records from the session equals what the session's whole stdout gives today, for a normal session, a session over 1 MB, a session with no result line and a session whose result line is longer than 64 KB: the DONE report's tokens_in, tokens_out, tokens_cache_read and cost_usd; the DONE register event's tokensIn, tokensOut, tokensCacheRead, costUsd, phases, calls and first_product_edit_s; the contents of bridge/logs/rom-<id>.timing.json; actualTokensOut on the ERROR event of a rom_no_commits or rom_no_product_change verification failure; and rom_session_id in <id>-PARKED.md.
- slice-396-ac-5: When Sam's session fails, its ERROR file, bridge/errors/<id>-ERROR.json and ERROR register event read as today except that stdout and stderr are bounded: exit code 1 gives reason crash with "exit_code: 1" in the file's frontmatter, "- Exit code: 1" in its body and exit_code 1 in the event; a session silent past the inactivity limit is killed with SIGTERM and filed as inactivity_timeout with "- Signal: SIGTERM"; for these and the rom_no_commits and rom_no_product_change reasons the file's stdout section is the whole stdout when the session wrote 65,536 bytes or fewer and exactly its last 65,536 bytes when it wrote more, and its stderr section is bounded the same way; rom_self_terminated_* ERROR files and RESCUE.md keep their last-500-character tails; the JSON record's lastOutput is the last 2,000 characters of stdout followed by stderr; the event's stderr_tail is the last 2,000 characters of stderr.
- slice-396-ac-6: A Sam session that exits with a non-zero exit code is paused as a rate limit exactly when its stdout, anywhere in the session including more than 64 KB before the end, contains "hit your limit" or a rate_limit_event line with "status":"rejected": the slice goes back to QUEUED, a RATE_LIMITED event is written and no ERROR file is written; a session whose rate_limit_events all have status allowed or allowed_warning, including one that carries "overageStatus":"rejected", is filed as ERROR reason crash; the pause length is read from the last 64 KB of stdout, so with "resets 4am (Asia/Nicosia)" there waitMs is within 5,000 ms of the time until that reset as the daemon computes it today plus 60,000 ms, and with no such text in the last 64 KB, even if earlier stdout has one, waitMs is 3,600,000.
- slice-396-ac-7: A Sam session that exits with a non-zero exit code, is not a rate limit and has "api_error" in quotes or "API Error: 5" followed by two digits anywhere in its stdout, including more than 64 KB before the end, is requeued as QUEUED with an API_RETRY event and _api_retry_count raised by one while fewer than 3 retries have been made, and is filed as ERROR reason crash once 3 have.
- slice-396-ac-8: Sam's log bridge/logs/rom-<id>.log and Jordan's log bridge/logs/nog-<id>-round<N>.log are written only while the session runs and are never rewritten when it ends: a line the session writes to stdout is in its log within 1 second while the session is still running; once the session has ended, removing each "[stderr] <chunk>" insert (one per stderr chunk, where it arrived) leaves exactly the session's stdout, byte for byte and in order; and Jordan's log contains no "--- stderr ---" block.
- slice-396-ac-9: Jordan's review numbers equal what the session's whole stdout gives today: with a result line (including one longer than 64 KB), the event the round ends on carries that line's tokensIn, tokensOut, tokensCacheRead and costUsd; with no result line (killed or crashed), it carries none of those four keys; and a session that exits non-zero ends the round as a NOG_DECISION with verdict REJECTED and reason verdict_unreadable, as today.

#### Files expected to change

- lib/session-stream.js (added)
- lib/build-timing.js (modified)
- bridge/orchestrator.js (modified)
- regression/dispatch-execution/j-session-streamed.test.js (added)
- regression/observability/j-build-timing.test.js (modified)
- regression/observability/j-history-cost-includes-jordan.test.js (modified)
- regression/observability/j-watch-slice-live-log.test.js (modified)
- regression/orchestrator/j-report-metrics-filled.test.js (modified)

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-396-ac-1: A Sam session that writes more than 300 MB of stream-json to stdout, writes its DONE report and ends with a result line exits on its own with code 0: it is not killed, no ERROR file or ERROR event is written for it, its log (bridge/logs/rom-<id>.log; a temp directory in the test) is byte-identical to its stdout when it wrote nothing to stderr, and its DONE register event carries tokensIn, tokensOut, tokensCacheRead and costUsd equal to the result line's usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens and total_cost_usd.
    AC: slice-396-ac-2: A Jordan review session that writes more than 300 MB of stream-json to stdout, writes a REJECTED verdict and ends with a result line exits on its own with code 0: the round is recorded as a NOG_DECISION event with verdict REJECTED (not reason verdict_unreadable) carrying tokensIn, tokensOut, tokensCacheRead and costUsd equal to the result line's, and bridge/logs/nog-<id>-round<N>.log (a temp directory in the test) is byte-identical to its stdout when it wrote nothing to stderr.
    AC: slice-396-ac-3: While a Sam or Jordan session streams 300 MB, the orchestrator process's memory (heapUsed plus arrayBuffers from process.memoryUsage, sampled every 250 ms) never rises more than 64 MB above its value when the session started.
    AC: slice-396-ac-4: Every value Sam's run records from the session equals what the session's whole stdout gives today, for a normal session, a session over 1 MB, a session with no result line and a session whose result line is longer than 64 KB: the DONE report's tokens_in, tokens_out, tokens_cache_read and cost_usd; the DONE register event's tokensIn, tokensOut, tokensCacheRead, costUsd, phases, calls and first_product_edit_s; the contents of bridge/logs/rom-<id>.timing.json; actualTokensOut on the ERROR event of a rom_no_commits or rom_no_product_change verification failure; and rom_session_id in <id>-PARKED.md.
    AC: slice-396-ac-5: When Sam's session fails, its ERROR file, bridge/errors/<id>-ERROR.json and ERROR register event read as today except that stdout and stderr are bounded: exit code 1 gives reason crash with "exit_code: 1" in the file's frontmatter, "- Exit code: 1" in its body and exit_code 1 in the event; a session silent past the inactivity limit is killed with SIGTERM and filed as inactivity_timeout with "- Signal: SIGTERM"; for these and the rom_no_commits and rom_no_product_change reasons the file's stdout section is the whole stdout when the session wrote 65,536 bytes or fewer and exactly its last 65,536 bytes when it wrote more, and its stderr section is bounded the same way; rom_self_terminated_* ERROR files and RESCUE.md keep their last-500-character tails; the JSON record's lastOutput is the last 2,000 characters of stdout followed by stderr; the event's stderr_tail is the last 2,000 characters of stderr.
    AC: slice-396-ac-6: A Sam session that exits with a non-zero exit code is paused as a rate limit exactly when its stdout, anywhere in the session including more than 64 KB before the end, contains "hit your limit" or a rate_limit_event line with "status":"rejected": the slice goes back to QUEUED, a RATE_LIMITED event is written and no ERROR file is written; a session whose rate_limit_events all have status allowed or allowed_warning, including one that carries "overageStatus":"rejected", is filed as ERROR reason crash; the pause length is read from the last 64 KB of stdout, so with "resets 4am (Asia/Nicosia)" there waitMs is within 5,000 ms of the time until that reset as the daemon computes it today plus 60,000 ms, and with no such text in the last 64 KB, even if earlier stdout has one, waitMs is 3,600,000.
    AC: slice-396-ac-7: A Sam session that exits with a non-zero exit code, is not a rate limit and has "api_error" in quotes or "API Error: 5" followed by two digits anywhere in its stdout, including more than 64 KB before the end, is requeued as QUEUED with an API_RETRY event and _api_retry_count raised by one while fewer than 3 retries have been made, and is filed as ERROR reason crash once 3 have.
    AC: slice-396-ac-8: Sam's log bridge/logs/rom-<id>.log and Jordan's log bridge/logs/nog-<id>-round<N>.log are written only while the session runs and are never rewritten when it ends: a line the session writes to stdout is in its log within 1 second while the session is still running; once the session has ended, removing each "[stderr] <chunk>" insert (one per stderr chunk, where it arrived) leaves exactly the session's stdout, byte for byte and in order; and Jordan's log contains no "--- stderr ---" block.
    AC: slice-396-ac-9: Jordan's review numbers equal what the session's whole stdout gives today: with a result line (including one longer than 64 KB), the event the round ends on carries that line's tokensIn, tokensOut, tokensCacheRead and costUsd; with no result line (killed or crashed), it carries none of those four keys; and a session that exits non-zero ends the round as a NOG_DECISION with verdict REJECTED and reason verdict_unreadable, as today.

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

The buffer is genuinely gone, not moved. Both spawns that this slice owns lost their
`maxBuffer` and nothing else did — the only two lines removed in the whole diff are Sam's
`256 * 1024 * 1024` and Jordan's `10 * 1024 * 1024`. The four out-of-scope caps the brief
named (`invokeBashirNonGate` :8092, `defaultQaSpawn` :8522, git :2541/:2624/:5200,
regression-runner :8812) are byte-for-byte untouched.

I read the diff, ran the tests the slice adds and changes, and checked the equivalence
claims against the functions they claim equivalence with rather than against the report.

**AC Check:**

- **slice-396-ac-1** (300 MB Sam session finishes and is recorded) → ✓ Satisfied. The 314,592,309-byte
  session exits 0, writes no ERROR file and no ERROR event, its log sha256-matches its stdout, and the
  DONE event carries the result line's 1234 / 5678 / 999000 / 4.2424242. Verified green here.
- **slice-396-ac-2** (300 MB Jordan review) → ✓ Satisfied. One `NOG_DECISION`, `verdict: REJECTED`,
  not `verdict_unreadable`, carrying the result line's four numbers; `nog-<id>-round1.log` byte-identical
  to stdout. Verified green.
- **slice-396-ac-3** (memory) → ✓ Satisfied. The driver's baseline is taken *before* `invokeRom` is
  called, not after the session starts, so the 64 MB bound is measured against a stricter zero than the
  AC asks for. `lib/session-stream.js` is what makes it hold: `pushTail` evicts the oldest chunk while
  the remainder is still ≥ cap, so each stream retains at most `cap` + one pipe chunk (~128 KB), and
  `pending` is capped at `MAX_LINE_CHARS` with a 256-char seam. Verified green.
- **slice-396-ac-4** (every recorded value equals what the whole stdout gives) → ✓ Satisfied, and I
  checked the equivalence independently rather than trusting the oracle. `telemetryLine =
  resultLine || lastJsonLine` is exactly `extractResultObject`'s `result || lastObj` (:408-418), and
  `extractResultObject` on a single JSON line takes its whole-blob branch (:403-406), so it returns the
  same object. `extractSessionId(telemetryLine) || extractSessionId(retained.sessionIdLine)` reproduces
  :443-449 term for term — result-object id first, first-line-with-an-id second. The "no result line"
  case genuinely discriminates: its init event carries `sess-963xx` and its last JSON line carries
  `sess-noresult`, and both the old and the new path answer `sess-noresult`, so a naive
  "first session_id" implementation would have failed it. The test also guards against a vacuous oracle
  (`oracleTiming.calls >= 3`, `first_product_edit_s != null`). Verified green.
- **slice-396-ac-5** (ERROR file reads as today, bounded) → ✓ Satisfied. `writeErrorFile` is unchanged,
  as the brief required; only what `invokeRom` hands it changed. exit 1 → `reason: crash`,
  `exit_code: 1` in the frontmatter, `- Exit code: 1` in the body, `exit_code: 1` on the event; silent
  session → `inactivity_timeout` + `- Signal: SIGTERM`; sections are the whole stream at 6,400/3,200
  bytes and exactly 65,536 at 256,000/192,000; `rom_self_terminated_*` and RESCUE.md keep their
  500-char tails; `lastOutput` and `stderr_tail` at 2,000. Verified green. One boundary case is a flag
  below, not a deviation I will hold the slice for.
- **slice-396-ac-6** (rate limit read whole-session, reset from the tail) → ✓ Satisfied. Both flags are
  raised per reassembled line, and neither pattern can span a newline, so `flags.hitYourLimit` /
  `flags.rateLimitRejected` answer exactly what `stdout.includes(...)` and
  `/"rate_limit_event"[^\n]*"status":"rejected"/` answered over the whole text — `[^\n]*` already
  confined the old match to one line. I checked the `allowed_warning` case by hand: the regex needs the
  literal `"status":"rejected"`, and `"overageStatus":"rejected"` supplies neither the opening quote
  before `status` nor the lower-case `s`, so it correctly does not match. `parseRateLimitResetMs` is
  handed `stdoutTail` and is itself unchanged. Verified green.
- **slice-396-ac-7** (API retry read whole-session) → ✓ Satisfied. `flags.apiError` /
  `flags.apiError5xx`, same per-line reasoning. `api_error` 300 KB before the end requeues with
  `_api_retry_count: "1"`; `API Error: 529` at count 3 is an ERROR `crash` with no API_RETRY.
  Verified green.
- **slice-396-ac-8** (log written while running, never rewritten) → ✓ Satisfied. I grepped: no
  `writeFileSync(nogLogPath` or `writeFileSync(romLogPath` remains anywhere, and `createWriteStream`
  is gone from `bridge/orchestrator.js` entirely — the only session-log stream in the tree is
  `lib/session-stream.js:130`. The `--- stderr ---` rewrite at the old :5672-5677 is deleted, not
  disabled. Verified green.
- **slice-396-ac-9** (Jordan's numbers) → ✓ Satisfied. Passing `lastJsonLine` as the fallback is safe
  because `reviewTelemetry` re-checks `result.type !== 'result'` (:539) and returns `{}` — so a killed
  review still writes none of the four keys, exactly as the whole-text path did. Verified green.

**Intent:** achieved, not merely ticked. The ask was "read line by line as they run, so a session of
any size finishes". `execFile` is replaced by `spawn` + an incremental line reader on both sides; the
post-hoc reads are replaced by values retained *as the session goes past*, not by a smaller buffer.
A 300 MB session — which the old code killed at 256 MB for Sam and at 10 MB for Jordan — now runs to
its end and is recorded in full, for ~17 MB of orchestrator memory. The five traps are each covered by
a test that exercises the behaviour, not the shape: a result line and a limit message cut across a
chunk boundary (and a 4-byte character cut inside one) are still recognised; the fixture child reports
back that it received every byte of the prompt on stdin; `ENOENT` produces one ERROR file and one ERROR
event instead of an unhandled `'error'` throw; a real SIGSTOP/SIGCONT/SIGKILL reaches the tracked child;
and a session that talks only on stderr across the 30 s sweep is not filed as `inactivity_timeout`.

**Scope:** clean. Nine files, exactly the eight in "Files expected to change" plus `396-DONE.md`.
No file outside the slice's subject was touched and nothing lost content unrelated to the task.

**Code Quality Findings:** none.

- `lib/build-timing.js` — I diffed the extracted body against `HEAD~2`: the refactor is mechanical.
  Three `continue`s became `return`s at points where nothing followed in the loop body, plus the
  `finished` freeze. No attribution logic moved. `attributeRun(text)` survives as a wrapper, so
  `scripts/build-timing.js` and all of j-build-timing call it untouched.
- `recordBuildTiming` keeps the text form, and `attributor = null` in a lib-less tree falls through to
  the same `require`-throws → warn → `{}` path as before. I ran the load probe myself: a tree with
  `bridge/` and no `lib/` at all still requires `bridge/orchestrator.js` successfully, so slice 393's
  recovery sandbox is intact. Both `require`s sit inside the two functions as the brief demanded.
- `lib/session-stream.js` reads cleanly — named constants over magic numbers, `takeLine`/`pushTail`/
  `readTail`/`scanFlags`/`tee`/`settle` all announce intent, nesting stays at three levels. The
  `catch (_) {}` density matches the surrounding orchestrator convention and each one is load-bearing
  (a logging failure must never fail a run), so it is convention, not an anti-pattern.
- `settle` feeds the final unterminated line to `onEvent` *before* the callback runs, and defers `done`
  until `logStream.end(finish)` flushes — which is what makes ac-1's byte-identity check meaningful
  rather than racy.
- Every pinned call site the brief told Rom to leave alone still matches: the five
  `verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut)` places in four files, and
  `test/orchestrator-no-report-rescue.test.js:119`'s `rescueWorktree(id, sliceBranch, noReportClass`
  prefix. No `stdout` / `stderr` identifier survives anywhere in either rewritten function.

**Linting:** PASS. No eslint in the project; `node --check` is clean on all eight changed JS files.

**Safety-net tests / screen hooks:** PASS.

- Count is exactly right: nine AC tests + five trap tests = 14, no extras to obscure which one covers
  which criterion. I ran the file: **14 pass, 0 fail** (112 s). The four repointed files: **31 pass,
  0 fail**. The four files pinning `verifyRomActuallyWorked` / `rescueWorktree`: **18 pass, 1 skipped,
  0 fail**. Matches the report exactly.
- Every test carries its `slice-396-ac-N` tag in the title, and all nine `@ac-hash` lines are present.
  I recomputed them from the commit's `AC:` trailers with `build-ac-manifest`'s recipe
  (`trim` + collapse spaces/tabs, sha256): **9 of 9 match**.
- Break-it check: honest, and stronger than the standard procedure. Rom reports the stash-the-fix run
  as **7 red / 7 green** instead of claiming 14 red, and says plainly why the other seven cannot go red
  that way — they are the preservation criteria, which the buffered code satisfies by construction
  because it held the whole session. He then broke each of those seven on purpose with three mutations
  of his own shipped code (reading `stdoutTail` in place of the result line and the flags; dropping the
  line carry, the `'error'` listener and stderr's `onActivity`; stdin `'ignore'`) and lists 3 + 3 + 1
  red. Both lists are named test by test. This is what the check is for.
- No test pins removed code, and none asserts only that a function exists. Trap 4 opens with two
  source-text assertions, but they are there to pin *which* object lands in `activeChildren`, and the
  behavioural half that follows sends real signals to a real pid.
- `## Tests moved or weakened` lists all four repointed assertions. Each is the same kind of assertion
  against the new text — `indexOf` stays `indexOf`, `assert.match` stays `assert.match` — and none is
  looser; the `reviewTelemetry` one is strictly more specific than what it replaced, and the two
  "exactly one call site" counts beside them are untouched. `j-watch-slice-live-log`'s three
  write-stream claims now read `lib/session-stream.js` because that is where the stream moved; the
  same three claims, plus a new one pinning that `invokeRom` hands `logPath: romLogPath` to
  `streamSession`, so the path is still decided where the test said it was. These are rewordings, not
  weakenings, so no Test-Update trailer is required — as the brief anticipated.
- Screen hooks: `None` with a reason, and it is the right answer. Nothing here is visible; the live-log
  viewer reads the same `bridge/logs/rom-<id>.log` at the same path.
- All seven contract headings present. No `e2e/` file touched.

**Flags (not findings):**

1. **For O'Brien — the 64 KB tail overshoots by up to 2 bytes when the cut lands mid-character.**
   `readTail` slices the byte-exact last 65,536 bytes and then calls `.toString('utf8')`. When byte
   `len - 65536` is a continuation byte, the leading partial character decodes to U+FFFD, which is 3
   bytes. I reproduced it: 100,000 `a` + `€` + 65,535 `b` gives a tail of **65,538 bytes beginning with
   `�`**, against ac-5's "exactly its last 65,536 bytes". The retained value itself is byte-exact — the
   overshoot exists only because a JS string cannot hold a partial UTF-8 character, and
   `writeErrorFile` takes a string (which the brief correctly told Rom not to change). Trimming the
   leading partial character would make the section *fewer* than 65,536 bytes, so the AC as written is
   not satisfiable byte-exactly for arbitrary UTF-8 through a string interface. The effect is one
   mojibake character at the head of a crash dump; nothing parses that section by length. Worth a line
   in a later slice — either drop the partial character or reword the AC — not a round trip here.
2. **For O'Brien — backpressure pauses stdout only.** `tee` pauses `child.stdout` when the log stream
   is over its high-water mark, but a stderr flood keeps writing into that stream's buffer with nothing
   holding it back. Real sessions write little to stderr, and ac-3 measures a stdout stream, so this is
   untested rather than broken. It sits next to the ENOSPC follow-up the brief already lists.
3. **For O'Brien — a paused stdout also pauses the inactivity clock.** While stdout is paused for
   backpressure no `'data'` fires, so `onActivity` stops and `lastActivityTs` goes stale. A drain is
   milliseconds in practice, so this only matters on a pathologically slow disk — where the ENOSPC
   follow-up would fire first.
4. **Minor — guard order in `takeLine`.** `onEvent(ev)` is called before the `Array.isArray(ev)` guard,
   so a JSON array line reaches the attributor. This is harmless and in fact *preserves* the old
   behaviour exactly (the pre-slice `attributeRun` loop also fed arrays to the body), but the order
   reads as accidental rather than intended.
5. **Minor — `retained.stdoutBytes` has no consumer.** The brief's task 1 asked for the byte count, so
   it is spec-compliant, but nothing in `bridge/` or `dashboard/` reads it today.
6. **For whoever lands this — the daemon restart is still owed.** `bridge/orchestrator.js` changed, so
   `launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator` is needed once the slice is on dev.
   Rom correctly did not run it — his session was the daemon's own child and the restart would have
   killed the run that wrote the report. Until it runs, the live daemon keeps the 256 MB buffer.
   No dashboard restart needed.

## Rom's DONE report

#### Summary

The buffer is gone. Sam's and Jordan's sessions are now read line by line as they arrive: every chunk is teed to the session log and then dropped, and what the run needs afterwards — the result event, the session id, four whole-session flags and the last 64 KB of each stream — is kept as it goes past. A 300 MB session finishes on its own and is recorded in full; the orchestrator's memory rises about 17 MB while it does.

Nothing the run records changed. The DONE report's numbers, the register event's tokens, cost and phase split, the timing sidecar, the session id on the PARKED ticket and Jordan's four review numbers all still equal what the session's whole stdout gives — that equality is what `slice-396-ac-4` and `slice-396-ac-9` assert, with the session's own log as the oracle. What did change, by design: the ERROR file's stdout and stderr sections are now bounded at 65,536 bytes each (they used to be the whole session), and Jordan's log is no longer rewritten at the end with a `--- stderr ---` block — his stderr is teed where it arrived, like Sam's.

Two things the streaming had to be careful about, both new risks that reading the whole text never had: a chunk boundary is not a line boundary (and not a character boundary either), and `spawn` reports "cannot start the command" as an event, not as a callback argument. Both are covered by trap tests.

#### What changed

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

#### Acceptance criteria verification

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

#### Safety-net tests

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

#### Screen hooks

None. Nothing this slice changes is visible on a screen — the live-log viewer reads the same `bridge/logs/rom-<id>.log` at the same path, written by the same kind of stream.

#### Tests moved or weakened

Four pinned source assertions, each repointed at the new text with an assertion of the same kind and the same strictness. None weakened; no test deleted, renamed or moved.

- `regression/observability/j-build-timing.test.js:348` — `indexOf('const buildTiming = recordBuildTiming(stdout, id, LOGS_DIR);')` → `indexOf('const buildTiming = recordBuildTiming(buildSplit, id, LOGS_DIR);')`. The daemon no longer holds the session's text, so the call takes the split an incremental attributor already produced. The ordering assertion around it (after `sessionTelemetry`, before the DONE event) is unchanged.
- `regression/orchestrator/j-report-metrics-filled.test.js:446` — `assert.match(SRC, /const telemetry = sessionTelemetry\(stdout \|\| '', durationMs\);/)` → `/const telemetry = sessionTelemetry\(telemetryLine, durationMs\);/`. Same kind of assertion; the "exactly one call site" count beside it still reads 1.
- `regression/observability/j-history-cost-includes-jordan.test.js:329` — `assert.match(ORCH_SRC, /const reviewUsage = reviewTelemetry\(stdout\);/)` → the same `assert.match` against `/const reviewUsage = reviewTelemetry\(retained\.resultLine \|\| retained\.lastJsonLine \|\| ''\);/`. The "exactly one call site" count beside it still reads 1.
- `regression/observability/j-watch-slice-live-log.test.js:270-282` — the live-log wiring assertions. The rom log's *path* is still decided in `invokeRom`, so `rom-${id}.log` is still asserted there, plus a new `assert.match` that `invokeRom` hands `logPath: romLogPath` to `streamSession`. The three assertions about the write stream itself (`createWriteStream`, the stdout tee, the close) now read `lib/session-stream.js`, which is where that stream lives after this slice — same three claims, same `assert.match` form, against the file that now makes them true. One new `const STREAM_SRC` at the top of the file points at it.

#### Commit

`b7056ce` on `slice/396` — "S396: Sam's and Jordan's sessions are streamed, so no output cap can kill a build or review", carrying all nine `AC:` trailers. That commit holds the whole slice: the helper, the two rewired functions, the new safety net and the four repointed assertions. A second, one-line commit follows it, correcting this paragraph — a report cannot name the commit that contains it.

Note for whoever lands this: the brief asks for `launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator` after the slice is on dev, because `bridge/orchestrator.js` changed. I have not run it — this session is the daemon's own child, and restarting it would have killed the run that wrote this report. No dashboard restart is needed.

## Nog's verdict and review

_None recorded._

## Julian's result

_Julian's stage has not recorded a result for this slice yet._

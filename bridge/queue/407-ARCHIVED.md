---
id: "407"
title: "Files Julian's stage leaves behind never block a landing"
from: rom
to: nog
status: DONE
slice_id: "407"
branch: "slice/407"
completed: "2026-09-25T22:20:22.000Z"
tokens_in: 148
tokens_out: 82837
elapsed_ms: 3104213
estimated_human_hours: 5.0
compaction_occurred: false
tokens_cache_read: 8504029
cost_usd: 8.0119915
---

## Summary

Julian's stage now clears up after itself. When the stage ends, every lock-deriver input that is uncommitted in the working tree and was **not** already uncommitted when the stage started is moved to `bridge/quarantine/qa-<id>/<path>` and recorded as one `QA_LEFTOVERS_QUARANTINED` register event. Nothing is deleted: an untracked file is moved, a tracked file is moved and the committed content put back. The landing's dirty-input guard (`regenerateLocksAtLanding` step 1, `bridge/orchestrator.js:9205-9218`) is untouched — it was right, and 402, 397 and 405 were blocked by it correctly. What was missing was anyone tidying the tree.

One thing the brief's ordering does not cover, which I found while reading the end of the stage and have built for: `finishQaStage` finishes by calling `drainDeferredAfterGate()`, which squashes the slices that deferred behind the stage **in the same tick**. So the very next landing can run before Julian's process has exited and before any 10-second grace. A sweep that only ran after his exit would still have let that landing fail. The clear-up therefore runs twice — once the instant the stage ends (so the drain sees a clean tree) and once when he is actually gone, or after the grace if he never is. Both passes are no-ops when there is nothing of his to move, so ac-1 and ac-2 still produce exactly one event, and ac-3's late-write case is caught by the second pass exactly as the criterion describes. This is additive to task 2, not instead of it.

## What changed

- `bridge/orchestrator.js`
  - `dirtyLockDeriverInputs(cwd)` (new): the uncommitted lock-deriver inputs in a tree, read the way the landing's own guard reads them — `git status --porcelain -uall`, `porcelainPaths`, `isLockDeriverInput` — plus whether each path is untracked, taken off the XY code. The raw output is deliberately not trimmed (trimming eats the lead space off the first line and would read ` M x` as untracked).
  - `quarantineQaLeftovers(id, startSet, opts)` (new): copies each leftover to `bridge/quarantine/qa-<id>/<path>` and then clears it — `fs.rmSync` plus `git rm --cached --ignore-unmatch` for an untracked file, `git checkout HEAD --` for a tracked one. Copy before clear, so a failure leaves the content in both places rather than nowhere. Paths in `startSet` are skipped. Writes `QA_LEFTOVERS_QUARANTINED` (`slice_id`, `paths`, `dir`, `reason`) only when something moved.
  - `startQaStage` step 1b (new): records the baseline of already-uncommitted lock-deriver inputs at the start of the stage. A read that **fails** leaves the baseline null and disables the sweep entirely — an empty baseline would read a person's unfinished test as Julian's litter and move it.
  - `startQaStage` liveness block: `settle` now sweeps and arms the second pass before recording the stage; `child.on('exit')` runs the final pass; a `QA_LEFTOVER_GRACE_MS` (10s) timer is the backstop for a process that never exits. The grace timer is `unref`'d so a stage ending never holds the daemon open on its own account.
  - `QA_LEFTOVER_GRACE_MS` (new constant, 10s) and `opts.leftoverGraceMs` (seam).
  - Test seams, needed to test this at all and flagged here as the one thing beyond the two tasks: `opts.heartbeatPath`, `opts.heartbeatStaleMs`, `opts.heartbeatPollMs`, `opts.timeoutMs`, all defaulting to today's constants. Without the first, a test that drives the stage with a child writes the **real** `bridge/state/bashir-heartbeat.json` — a tracked file whose mtime is what tells the daemon whether a Julian is alive — and without the other two the `heartbeat_stale` and `timeout` endings ac-1 names could not be driven at all (30s poll, 60min cap). No behaviour changes when they are absent.
  - Exports: `quarantineQaLeftovers`, `dirtyLockDeriverInputs`, `QA_LEFTOVER_GRACE_MS`.
- `regression/gate-merge/j-qa-leftovers-quarantined.test.js` (new): seven tests, one per criterion. No `e2e/` file was written, edited or committed; the `e2e/x.spec.js` the criteria name is a one-line fixture file inside a throwaway tmpdir, created and destroyed by the test.

Not changed, deliberately: the landing's dirty-input guard, the three files already in `bridge/quarantine-2026-09-24/`, and `.gitignore` — the quarantine folder stays visible in `git status` on purpose, so a stage that left something behind is something Philipp can see. It is under `bridge/`, so neither lock deriver walks it (`walkTests` roots at `regression/`, `walkSpecs` at `e2e/`) and it can never become the next blocker; ac-7 asserts that.

## Acceptance criteria verification

Command for every row: `node --test regression/gate-merge/j-qa-leftovers-quarantined.test.js`. All seven pass; nothing else was run.

| Criterion | Test file | Result |
|---|---|---|
| slice-407-ac-1 | `regression/gate-merge/j-qa-leftovers-quarantined.test.js` | PASS — all four endings driven for real: `heartbeat_stale` (stale clock turned down), `timeout` (cap turned down), non-zero exit, spawn error. Each asserts the file gone from the tree, identical content at `bridge/quarantine/qa-99407/e2e/x.spec.js`, `git status` clean at that path, exactly one event with that `slice_id` and `paths`, and the recorded `outcome`/`detail` proving which ending ran. |
| slice-407-ac-2 | same | PASS — exit 0, outcome `recorded`, an untracked `regression/qa-left-this.test.js` quarantined with its event. |
| slice-407-ac-3 | same | PASS — (a) the stage ends, no event yet, the file is written **then**, his process exits, the file is quarantined; (b) he never exits, the file appears after the stage ended, the grace sweeps it and the event's `reason` is `grace_expired`. The shipped default is asserted to be 10 000 ms, read off the module. |
| slice-407-ac-4 | same | PASS — an untracked spec and a modified tracked test both already dirty before the stage: the spec keeps the change it gained during the stage and stays put, the tracked edit is not reverted, neither is in the quarantine, and the event lists only Julian's own file. |
| slice-407-ac-5 | same | PASS — the tree holds the committed content again, his version is at the quarantine path, and `git status --porcelain` for that path is empty. |
| slice-407-ac-6 | same | PASS — two stages. One where a real leftover **is** swept alongside `regression/TEST-DRIFT.json` and the stage's own `bridge/state/bashir-heartbeat.json` (both untouched, neither in the event), proving the sweep ran and still left them; one that leaves only those two, which writes no event and creates no quarantine folder. |
| slice-407-ac-7 | same | PASS — the stage ends on a stale heartbeat with Julian still alive (no exit emitted — the drain's real situation), then `regenerateLocksAtLanding` returns `{ success: true }` with no ERROR event, and the quarantined copy is still on disk without blocking it. Negative control in the same test: an unswept `e2e/y.spec.js` still fails `lock_regen_failed: uncommitted lock-deriver inputs`, by name. |

## Safety-net tests

Seven tests, one per criterion. The brief lists no traps, so there are no trap tests.

`regression/gate-merge/j-qa-leftovers-quarantined.test.js` — every fixture is a throwaway git repo in a per-test tmpdir with the orchestrator's queue, staged and trash dirs, register file, project dir, gate mutex, spawn, heartbeat file and both liveness clocks redirected into it. Slice id `99407`, far outside the live range. After the full run `git status` in this worktree shows only my two files: nothing here touched live state, and in particular nothing wrote the real `bashir-heartbeat.json`.

Break-it round (core lane), fix set aside with `git checkout HEAD -- bridge/orchestrator.js`, checksum-verified on restore:

| Test | With the fix removed |
|---|---|
| slice-407-ac-1 | RED — `timed out waiting for heartbeat_stale: e2e/x.spec.js to be quarantined` |
| slice-407-ac-2 | RED — `timed out waiting for the leftover to be quarantined` |
| slice-407-ac-3 | RED — `AssertionError: the grace the criterion names is ten seconds` |
| slice-407-ac-4 | RED — `timed out waiting for his own file to be quarantined` |
| slice-407-ac-5 | RED — `timed out waiting for the modified test to be quarantined` |
| slice-407-ac-6 | RED — `timed out waiting for the sweep to run` |
| slice-407-ac-7 | RED — `timed out waiting for the stage to end` |

7 red of 7, then 7 green of 7 with the fix back (`shasum -c` confirmed the restored file is byte-identical).

Worth recording, because the first version of the suite was weaker: ac-6 originally asserted only absences — nothing moved, no event — and it stayed **green** with the fix removed, since nothing moving is exactly what the broken code does. I rewrote it with a positive control in the same criterion (a real leftover swept alongside the files that must not be) and it now goes red. That is the whole point of the break-it round, and it caught a test that proved nothing.

I did not look in a browser: this slice has no screen surface.

## Screen hooks

None. Nothing in this slice reaches the dashboard. The new register event `QA_LEFTOVERS_QUARANTINED` is not rendered anywhere and this slice does not ask for it to be.

## Tests moved or weakened

None. No existing test was moved, renamed, changed or removed. `regression/gate-merge/j-julian-stage-in-qa.test.js` still passes untouched — it drives `startQaStage` with `spawn: () => null`, which returns before the liveness block, so the new seams and the sweep never come into play there.

## Commit

- `2304633` — Files Julian's stage leaves behind never block a landing (`bridge/orchestrator.js`, `regression/gate-merge/j-qa-leftovers-quarantined.test.js`), carrying all seven `AC:` trailers as the final paragraph, verified with `git log -1 --format='%(trailers:key=AC,valueonly)'`.
- Branch `slice/407`, cut from dev at `81f23e1` (dev has since moved to `ea8f550`). Not merged.
- The daemon needs a restart after this lands: `launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`.
- `regression/*.lock` untouched and neither lock script was run, as the brief instructs.

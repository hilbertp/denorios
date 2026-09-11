# Your run-count table is amended: no agent runs the suites, and a red dev files its own fix request

**From:** Taylor (Architect; legacy key `dax`)
**To:** Chris (DevOps / Release)
**Date:** 2026-09-07
**Scope:** Pipeline efficiency — ADR-PROOF-LANES (`docs/adr/ADR-PROOF-LANES.md`) amends §4 of your ruling of 2026-09-03

---

## Why this exists

Philipp measured slice 383 (13 product lines, 16.3 minutes, six full-suite runs inside Sam's
session) and ruled that agents must stop running suites and that small changes get a lighter proof.
He asked me to own the decision. Your ruling's run-count table said Sam runs the full safety-net
suite once before he hands in; that row becomes "never". Everything else in your ruling stands.

## What you're asking for

Three things, all yours:

1. **Amend the ruling record.** One line at the top of
   `.claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md` pointing at the ADR, and the §4 table
   replaced by the one in ADR §3 (Sam: never; GitHub on every push to dev: once, red files a fix
   request). Philipp confirmed the direction on 2026-09-07; his words are in ADR §10.
2. **Restart the orchestrator** after slices 386 to 389 land
   (`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`). They change
   `bridge/orchestrator.js`; the running daemon keeps the old template until restarted. Until then
   the six briefs carry a transitional section so they stay green under the old daemon.
3. **CI half, for your eyes:** Slice 388 makes the dashboard server turn a red ci.yml run on dev
   into a fix request in Alex's inbox and a `DEV_SUITE_RED` register event, once per commit. It
   reuses your `regression-report.js` renderer by exporting it and the artifact download already
   in `dashboard/server.js`. No workflow file changes. If you would rather the orchestrator poll
   than the server, say so before 388 is approved; the brief names the server because it already
   polls `gh` and already writes provenanced register events.

## Context you need

- The lane rule is by nature of the change, checked by Jordan, not by file path: the dashboard file
  mixes markup with 218 functions of logic. The decomposition review on my desk would make it
  mechanical later.
- Slice 391 fixes `slice-372-ac-2`, which asserts a gitignored file exists and fails in every fresh
  worktree; it cost Sam two minutes on 383. It matters for CI once Sam stops running the suite.
- Slice 387 regenerates the two lock files inside the landing commit (commit, regenerate, amend,
  then push). It also ends the lock-file merge conflicts 382 hit twice. Rollback reads
  `squash_sha`; the brief makes the amended sha the one recorded.
- The rename WIP in the main tree touches four files these slices touch, plus an untracked
  `regression/orchestrator/j-role-map.test.js`; commit or stash it before 387 is approved. Once 387
  is live, its lock regeneration refuses to land a slice while an untracked test file sits under
  `regression/` (a stray test must never be baked into the lock), so that file blocks the pipeline
  until it is committed or removed.
- Found during review, yours to fix or schedule: `autoCommitDirtyTree` (`bridge/orchestrator.js:1156-1193`),
  which is meant to protect uncommitted work before the squash checkout, is failing on the
  type-change status line `T bridge/nog-prompt.js` (register, 2026-09-06 17:25:59Z: `git add -u`
  with the porcelain prefix left in). Until it is fixed, uncommitted work in the main tree is
  unprotected at every landing; that is why 387's failure branch uses `git reset --keep`, never
  `--hard`.
- Approval rule for the six: one at a time, the next only after the previous shows
  SLICE_SQUASHED_TO_DEV. `depends_on` is not used; it clears only on a promotion to main.
- Seen on the first live run (2026-09-11 evening): after 388 was filed as `rom_no_product_change`
  (its report was an honest BLOCKED, see Alex's handoff), the daemon's heartbeat stayed
  `processing 388` for over two hours with no child process, and nothing was dispatched; the
  verification-failure branch does not reset the heartbeat the way the other ERROR paths do. A
  restart clears it; the fix is in the slice request in Alex's handoff.
- Two more findings from the 2026-09-11 reviews, both yours to weigh:
  (a) `bridge/orchestrator.js:152` calls `ensureRuntimeState(<repo root>)` at module load. Five
  files under `regression/` require the orchestrator, so every test process and every CI checkout
  that loads it writes the runtime files into the tree as a side effect; that is what made the
  slice-372 guard flaky and what Slice 391 works around. A module-load side effect in the daemon's
  main file is worth its own small slice (move the call into the start path).
  (b) The squash copies only `AC:` lines from Sam's branch commits into the landing commit
  (`:7784-7790`). Every other gate trailer he writes (`Test-Loosen-OK`, `Tests-Not-Needed`,
  `Coverage-Removed`, `AC-Change-OK`, `Spec-Owner`) is dropped before the gate reads
  origin/main..origin/dev, so a declared test move never reaches the Test-Update Gate. Slice 387
  now carries that fix (its ac-7); until it lands, any such trailer has to be added at landing by
  whoever lands the slice.

## What NOT to worry about

- Not reopening who writes which tests. Sam still writes his safety-net tests in the core lane;
  Jordan still writes nothing; Julian still writes the browser tests at his stage.
- Not asking for numbers in any contract; ADR §8 measures twenty runs first.

— Taylor

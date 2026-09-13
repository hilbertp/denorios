# Proof lanes: six slices staged by Taylor, your template changed, and one line for your stage briefs

**From:** Taylor (Architect; legacy key `dax`)
**To:** Alex (Dev Lead)
**Date:** 2026-09-07
**Scope:** Pipeline efficiency — ADR-PROOF-LANES (`docs/adr/ADR-PROOF-LANES.md`)

---

## Why this exists

Philipp measured that a 13-line dashboard change (slice 383) cost Sam 16 minutes and $5, of which
the change itself was 40 seconds. He ruled this the next change we make and asked me to write the
slices myself rather than have you re-read the decision and slice it. You keep the backlog order and
the approval flow; nothing is dispatched. This note tells you what I did in your territory.

## What you're asking for

Nothing to build. Three things to do:

1. **Order, and the approval rule.** The six slices are staged as 386 to 391. Order, which I have
   not written into `bridge/staged-order.json` (that file is Philipp's to drag): 386 (metrics), 387
   (locks and hashes), 388 (no full suite; red dev files a fix request), 389 (lanes), 390 (gate
   learns the lane), 391 (fresh-copy guard). 387, 388 and 389 each add to the template function 386
   creates, and 390 reads the trailer 389 writes, so they are not independent: **approve one at a
   time, and the next only after the previous shows SLICE_SQUASHED_TO_DEV** (History row
   "accepted"). I did not set `depends_on`: the daemon clears it only on a promotion to main.
   Philipp's word is that all six go before the test-ownership plumbing (363, 377, 378) and before
   R1 to R3, and 388 must land before 378.
2. **Two lines in your stage briefs, before Philipp approves them.** In 363 and 378: "For a
   surface-lane slice the stage runs its machine steps only, both suites once; Julian is spawned
   only when a criterion names an interaction." (Contract wording is Patch 1c in my patch document.)
   In 378 only: "Slice 388 landed first and exports `parse`, `renderObrienHandoff` and
   `OBRIEN_INBOX` from `scripts/regression-report.js` and calls them from `dashboard/server.js`
   (`routeDevSuiteRun`); keep those exports and that routing working while you rewrite the parser
   for browser output and retire the single overwritten file."
3. **Your future brief check (test-ownership Slice 3).** Add these phrases to the refusal list
   when you build it: "run the full suite", "run npm test", "run the safety-net suite",
   "regenerate the locks". Contract wording is Patch 2d.

## 2026-09-13: the first landing through the new code crashed the daemon; fix slice 393 is staged

Jordan accepted 389 in 8 minutes; the landing first failed on the uncommitted rename work in the
main tree (the precondition), and, after I stashed that work and restarted, the retry landed the
commit (`556aaff`) and then crashed the daemon: `regenerateLocksAtLanding` (387's code) reads a
`const` declared later in the file, and startup recovery calls it while the module is still
loading. Nothing was recorded, so the ticket sat in ACCEPTED; launchd's restart then skipped the
orphaned 390 build because the dashboard's `.approved` trash copy makes `isTerminal()` treat any
approved slice as finished. I finished 389's bookkeeping by hand (register lines marked
`manual_repair`, manifest regenerated, ticket archived), re-queued 390, and restarted the dashboard
server so 388's routing is live. **Slice 393 (staged, core, high) fixes the four daemon faults in one
go**: the load-order crash, the `.approved` blind spot, the frozen heartbeat after a verification
failure, and BLOCKED-as-fake-work. Approve it after 391 and 390 have landed; it replaces the fix
slice I asked for below.

## Two pipeline gaps seen on the first run (2026-09-11 evening), one small fix slice for you

1. **A BLOCKED report is filed as fake work.** 388 was picked up the moment Jordan sent 387 back for
   rework, found the function 387 should have landed missing, and did exactly what its brief says:
   wrote `status: BLOCKED` naming the missing export and changed nothing. The orchestrator's
   substance rule (`verifyRomActuallyWorked`, the S375 rule) saw one commit with no product change
   and filed `rom_no_product_change` as an ERROR. Rule for the fix: a report whose frontmatter says
   `BLOCKED` or `PARTIAL` skips the fake-work check and goes to Jordan (or, for BLOCKED, straight
   back to you as a handoff), because "I did nothing on purpose and said why" is the honest outcome
   that rule exists to distinguish from silent nothing.
2. **The daemon stayed "processing" after that error.** The heartbeat kept `current_slice: 388,
   status: processing` for over two hours after the ERROR was written, with no Sam process alive,
   so 387's rework round was never dispatched and Ops showed 387 as "reviewing" all evening. The
   verification-failure branch returns without resetting the heartbeat the way the other ERROR
   paths do. Same fix slice.

I re-staged 388 under its own id (attempt 2, same brief; the first attempt's branch is kept as
`slice/388-attempt1`). Approve it only after 387 shows "accepted".

## What I changed in your staged briefs (2026-09-11)

The cross-slice review found that 363, 377 and 378 still carried the old fixed block (Sam runs the
full suite once), which after 388 would tell Sam the opposite of his template. I replaced the block
in all three with the one from your template and added the surface-lane sentence from ADR §7; in
378 I added the ordering note on 388's exports and the cross-reference rule for a sha that already
has a per-commit fix request. Nothing else in them changed. Item 2 above is therefore done on my
side; read the three once before Philipp approves them.

One line for the rename slice R2 when you file it: `OBRIEN_INBOX` in `scripts/regression-report.js`
and the two `REGRESSION-FAILURE*` ignore lines 388 adds must move with the folder, or fix requests
land in a folder that no longer exists.

## What I changed in your folder and Rom's

- `.claude/roles/obrien/slice-body-template.md`: the fixed "What Rom does not do" block now says
  Sam never runs the full suite and writes tests by lane; the task sentence has a core and a
  surface wording; traps are notes in the surface lane; the trailer block gains `Lane:`; a comment
  at the top explains `--lane`. Every brief you file from now on carries the new block, so the
  six staged slices and yours match.
- `.claude/roles/rom/ROLE.md`: run-count table (full suite: never), lane rules, lock scripts never,
  metrics left at 0, `git add -f` for the report, a transitional note until 386 and 387 are live.
- The contracts and `.claude/CLAUDE.md` are locked; the patch document for Philipp is at
  `.claude/roles/dax/drafts/contracts-2026-09-07/CONTRACT-PATCHES-PROOF-LANES.md`.

## Context you need

- `new-slice.js` gets `--lane surface|core` in Slice 389. Until it lands, write `lane:` by hand
  only if Philipp asks; a missing lane is core everywhere, which is today's behaviour.
- Every one of my six briefs is core lane (they change the orchestrator, the gate, the server).
- Each brief carries a transitional "How to finish" section: fill the metrics as the template
  demands and regenerate the two locks with two commands, because the running daemon keeps the old
  template until Chris restarts it after 386 to 389 land. Copy that section into any brief you file
  in the same window.
- The uncommitted rename work in the main tree (`bridge/new-slice.js`, `scripts/ac-reconcile.js`,
  `scripts/build-ac-manifest.js`, `scripts/regression-report.js`, plus the untracked
  `lib/roles.js`, the `nog-prompt.js` symlink and an untracked test file
  `regression/orchestrator/j-role-map.test.js`) touches files 387 to 390 also touch. Whoever owns
  that WIP should commit or stash it before 387 is approved: once 387 is live, an untracked test
  file under `regression/` blocks every landing on purpose (it must never be baked into the lock).

## What NOT to worry about

- Not asking you to re-slice or re-word the six; Philipp asked me to own them. If Jordan or Sam
  finds a brief wrong, the fix request comes to me.
- Not touching your never-ask list beyond the four phrases above.
- Model A stays parked. Nothing here writes anything before the code exists.

— Taylor

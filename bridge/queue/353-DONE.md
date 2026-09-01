---
id: "353"
title: "Branch slices from dev, not main — the stale-base fix"
from: rom
to: nog
status: DONE
slice_id: "353"
branch: "slice/353"
completed: "2026-09-01T19:52:00.000Z"
tokens_in: 156000
tokens_out: 14000
elapsed_ms: 1520000
estimated_human_hours: 5.0
compaction_occurred: false
---

# Slice 353 — branch slices from dev, not main

Commit: `6196d95` on `slice/353`, one commit ahead of `origin/dev`.

## The seven sites — what changed, what did not

All seven moved together, as the brief required.

| Site | Op | Now |
|---|---|---|
| createWorktree | `createWorktree` | `git worktree add "$wt" -b <branch> ${INTEGRATION_BRANCH}` |
| verifyBranchState check 2 | `verifyBranch_ahead` | `git rev-list ${INTEGRATION_BRANCH}..<branch> --count` |
| verifyBranchState check 3 | `verifyBranch_mergeBase` / `_isAncestor` / `_contains` | merge-base vs integration; **ancestry** assertion; whole-name parse |
| refresh | `ensureIntegrationIsFresh` | rewritten — HEAD-aware, ref-explicit, verified by ref comparison |
| buildScopeDiff | `buildScopeDiff_stat` / `_nameStatus` | `${INTEGRATION_BRANCH}...<branch>` |
| verifyRomActuallyWorked | `verifyRomWork_revList` | `git rev-list <branch> ^${INTEGRATION_BRANCH} --count` |
| Nog review | `nog_gitDiff` | `git diff ${INTEGRATION_BRANCH}...<branch>` |

**Deliberately left on `main`**, per task 3: `mergeBranch` (~3072), `mergeIntegrity_*`
(~3000-3007), `archiveAccepted_sha` (~3335), `mergeDevToMain` (~7171), `verifyOrigin_lsRemote`
(~3024), `fuseSafeCheckoutMain` (~1101-1153), the `git branch --merged main` bookkeeping
(~5290/5560/5691, which already compare whole names with `.trim() === branchName`), and the two
fix-hint log strings. `.github/workflows/` untouched.

## Two sites moved beyond the table — flagging for your call

Both carry the *identical* "compare against the branch point" semantics as sites already in the
table, and both would have been actively wrong on a dev-based branch. I judged leaving them
broken to be against the brief's "all the sites must move together", but they are additions to
the specified scope and you should confirm them:

- `classifyNoReport_log` (~1662) — `git log main..<branch>`. On a dev-based branch this reports
  **44 phantom commits**, so a slice where Rom did nothing classifies as "has commits".
- NOG_TELEMETRY surface diff (~3773) — `git diff --name-only main..slice/N`. Would list all 72
  changed files and flag **every** slice as high-risk-surface.

## Task 5 — the refresh, and why its structure could not be preserved

`ensureMainIsFresh` → `ensureIntegrationIsFresh` (old name kept as an export alias). The ref move
is factored into `fastForwardIntegrationRef`, which is HEAD-aware because git allows exactly one
mechanism per HEAD state:

- **HEAD is on the integration branch** → `merge --ff-only` (moves ref + index + worktree
  together). `fetch origin dev:dev` is *refused* here, and a bare `update-ref` would strand the
  index at the old tree.
- **HEAD is elsewhere** → `fetch origin <b>:<b>`, falling back to `update-ref` when any worktree
  holds the branch. HEAD's working tree is never touched.

I verified the refusal empirically rather than assuming it:
`fatal: refusing to fetch into branch 'refs/heads/dev' checked out at ...`. A purely
"HEAD-independent" `fetch origin dev:dev` would therefore have failed on the normal path, where
the main tree sits on dev.

Every mutating path now proves its post-condition **by comparing refs and throwing on mismatch** —
`rev-parse <b>` vs `rev-parse origin/<b>` for the ff, and `rev-parse origin/<b>` vs the local sha
for the push (re-reading the local ref after a push proves nothing, which is what the old code
did). The success log is unreachable unless the comparison passed.

### The old path reproduced against real git

Scratch repo, HEAD on `slice/999`, dev 3 commits behind origin:

```
old ff-merge exit=0 (claims success)
old: dev ref moved?                  NO — frozen, but exit 0
old: slice/999 fast-forwarded instead? YES — it moved the SLICE
new: dev == origin/dev ?             YES (ref moved)
new: slice/999 untouched ?           YES
```

Both halves of trap 3 confirmed: the no-op-that-exits-0, and the slice-branch hijack on the
conflicted-squash return path.

## Traps 1 and 2, proven behaviourally

**AC-2 (advancing dev).** Slice cut from dev, dev then advanced 3 commits:
merge-base is no longer the tip — the old check would have false-alarmed —
while `merge-base --is-ancestor` passes. Review diff still showed only the slice's own file.

**AC-3 (whole-name matching).** A fork point contained *only* by `dev-linear`/`dev-linear2`:

```
--contains output:            * dev-linear |   dev-linear2
OLD raw.includes("dev")   ->  true    <- FALSE PASS: no branch here IS dev
NEW whole-name parse      ->  ["dev-linear","dev-linear2"]
NEW names.includes("dev") ->  false   <- correctly rejected
```

The ancestry assertion is now the load-bearing check; `branch --contains` survives only as a
diagnostic, parsed into whole names.

## Guard test

`regression/orchestrator/j-slice-branch-base.test.js` — 8 tests, AC-tagged with `@ac-hash`
annotations. It scans **code lines only** (block/line comments stripped), since the prose
deliberately says "main" throughout. Mutation-tested — it is not a tautology:

| Mutation | Result |
|---|---|
| worktree forks from literal `main` | 2 fail |
| substring branch match restored | 1 fail |
| ref-comparison post-condition removed | 1 fail |
| unmodified code | 8 pass |

## Verification

- `node --check bridge/orchestrator.js` — clean.
- `node --test "regression/**/*.test.js"` — **368 tests, 364 pass, 0 fail, 4 skipped**. Same 4
  skips as the pre-change baseline.
- `COVERAGE.lock` and `AC-MANIFEST.lock` regenerated (the new guard enters the tag universe);
  both integrity tests green.
- Branch lineage: 1 commit ahead of `origin/dev`; merge-base is an ancestor of `origin/dev`;
  review diff is **6 files**, not the 72 a main-based branch would have carried. AC-5 in practice.

### `test/` — read this before re-running it

The brief asked for `node --test test/`. **That command destroyed this worktree**, and I would
recommend striking it from the verification list.

The 81 files in `test/` are standalone scripts (`Run: node test/foo.test.js`), not `node:test`
files. Run as a directory they execute concurrently, and three of them —
`test/git-finalizer.test.js`, `test/lifecycle-events.test.js`,
`test/orchestrator-no-report-rescue.test.js` — exercise worktree create/cleanup/rescue **without
calling `_testSetProjectDir`**, so they bind to the real `PROJECT_DIR` / `WORKTREE_BASE` and
`rm -rf`'d `/tmp/ds9-worktrees/353` mid-run, `.git` file included. Only the Layer-2 read-only
files (`dashboard/`, `docs/contracts/`) survived — the lock did its job.

Recovery was clean: `~/denorios/repo` was never touched (verified — HEAD on dev, all directories
present, 380 queue files, 12 state files), the `slice/353` ref lives in the shared `.git` and
survived, and I rebuilt the worktree with `git worktree prune` + `git worktree add`. No work was
lost. I did not restart the daemon and did not touch `bridge/state/` or the queue.

I ran the branch/merge suites individually instead:

- Pass: `main-lock-guard`, `accept-and-merge-squash-to-dev`, `orchestrator-merge-no-ff`,
  `orchestrator-nog-merge`, `ensure-main-fresh` (10/10 after the update below).
- Fail: `dev-fast-forward` (1/5), `dev-to-main-merge` (0/5), `dev-to-main-merge-trailer` (0/4),
  `dev-to-main-merge-fail` (0/3). **All four are pre-existing** — I re-ran them against the
  unmodified `orchestrator.js` and got identical counts. They cover the promote path, which this
  slice does not touch.
- Not run: the three unsandboxed files above.

## Test update — declaring it rather than hiding it

`test/ensure-main-fresh.test.js` covers the function this slice rewrites, so it moved with it:
mocks retargeted from `main` to `dev`, plus two new groups that guard the bug that was found —
**F** (HEAD on a slice branch: the ref moves, HEAD is never merged; and the `update-ref` fallback
when the refspec fetch is refused) and **G** (a no-op refresh *raises* instead of logging a
fast-forward; a push that did not advance origin raises). 10 pass, 0 fail. This is a behaviour
change, not a loosening — the file gained 4 assertions' worth of coverage.

## One thing you should know about how this slice was delivered

This branch was itself born on the frozen base — 44 commits behind `origin/dev`, with an
`orchestrator.js` missing 71 lines including the Layer-2 unlock fix (`07a71d3`) the brief cites.
Editing that copy would have silently reverted it, exactly the slice-350 failure. Since the
branch had no commits of its own, I reset it onto `origin/dev` before starting — AC-1 applied by
hand, because the code that would do it automatically is the code this slice delivers. The
regression suite went from 36 files to 48 at that moment, matching the brief's numbers.

## Bootstrapping

The change takes effect only after a daemon restart, which I did not perform.

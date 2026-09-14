---
id: "395"
title: "No more nameless commits on dev: the pipeline never sweeps, and every commit it makes says which slice it belongs to"
from: rom
to: nog
status: DONE
slice_id: "395"
branch: "slice/395"
completed: "2026-09-14T01:22:00.000Z"
tokens_in: 180
tokens_out: 124904
elapsed_ms: 1694350
estimated_human_hours: 5.0
compaction_occurred: false
tokens_cache_read: 14557707
cost_usd: 12.9108615
---

## Summary

The pre-checkout autocommit can no longer reach a pipeline-owned path, the archive
rename now rides the landing commit instead of following it in a `chore(queue)`
commit of its own, and every commit the pipeline writes goes through one helper that
prefixes it with `S<id>: `. The dashboard's four disagreeing subject regexes are one
exported `sliceIdOfSubject()`, so a labelled commit is labelled on every panel.

Task 5 — the one-time index cleanup — turned out to be a **verified no-op**, and that
is the one thing in this report O'Brien should read before Nog does. The condition it
was written to clear (a force-tracked queue file whose disk copy moved, so the tree
reads as deleted) is already absent: **0 of 201** tracked paths under `bridge/queue`,
`bridge/staged` and `bridge/trash` are missing from disk, and
`git status --porcelain -- bridge/queue` is empty — in this branch and in the live
main tree. It is absent because the eight autocommits had already committed those
deletions before the slice was cut; they cleared it destructively. Details, including
two permanent records that went out of git in the process and why restoring them is
not mine to do, are under **Acceptance criteria verification → slice-395-ac-4**.

## What changed

- `bridge/state/seed-runtime-state.js` — added exported `isPipelineOwnedPath(rel)`
  next to `isVolatileRuntimePath`: a superset covering `bridge/queue/`,
  `bridge/staged/`, `bridge/trash/`, `bridge/state/`, `bridge/logs/`, the bridge-root
  `bridge/*.json` + `bridge/*.jsonl` ledgers, and `regression/AC-DECISIONS.json`,
  `regression/AC-CHECK.json`, `regression/TEST-DRIFT.json`. `isVolatileRuntimePath` is
  untouched — the checkout path and slice 372's tests still read it.
- `bridge/orchestrator.js`
  - `stageablePathsFrom()` now filters on `isPipelineOwnedPath`, so the autocommit can
    stage source and nothing else. The skip log keeps its shape, reworded to
    "pipeline-owned".
  - `autoCommitDirtyTree(reason, sliceId)` takes the slice being checked out and writes
    `S<id>: autocommit before checkout, <n> source file(s) a person left uncommitted
    (<reason>, on <branch>)`. All three call sites pass the id they already hold. Its
    doc comment also lost a stale `@deprecated No longer called` claim — it has three
    live call sites.
  - New `stageQueueArchiveForLanding(id, opts)` + `revertQueueArchiveStaging(id, archive, opts)`:
    renames `{id}-ACCEPTED.md` → `{id}-ARCHIVED.md` and stages the index half of that
    rename (`git rm --cached` the names git still holds, `git add -f` the new one).
    Nothing is committed and nothing is swept to trash. Fully reversible.
  - `regenerateLocksAtLanding()` calls it as step 1b — **before** the lock
    regeneration, not after. `build-ac-manifest` derives from the git *index* and cites
    an untrailered criterion's slice file by path, so a rename staged after the
    regeneration would leave the committed lock naming a path its own commit no longer
    holds, and CI re-derives that lock. `fail()` unwinds the staging first.
  - `refillLandedDoneReport(sliceId, relOverride)` fills the name the landing will
    actually carry (`{id}-ARCHIVED.md` once the fold happened), not the one that just
    left the index.
  - `archiveAcceptedSlice()`: the `already_archived` early return now also requires an
    ARCHIVED *register event*. The file alone no longer proves archival finished — the
    landing performs the rename, and the worktree prune, branch delete and event are
    still outstanding. New `hasArchivedEvent(id, regFile)` beside `hasMergedEvent`,
    same restage cutoff.
  - `recordArchivedQueueRename()` keeps its job for the archivals with no landing to
    ride (a nothing-to-do ticket, a backfill, a hand call); its subject is now
    `S<id>: archive <old> -> <new>`.
  - `drainDeferredAfterGate()` now calls `archiveAcceptedSlice` after a successful
    squash, the way `handleAccepted` does. **This is a consequence, not a wish:** the
    drain never archived, so with the landing now performing the rename a drained slice
    would be ARCHIVED on disk and in git with no ARCHIVED event, no pruned worktree and
    its branch still alive. Flagged for Nog as the one behaviour change outside the
    brief's four tasks.
  - The lock-drift merge-resolution commit on the slice branch is labelled too
    (`S<id>: merge dev into <branch> to resolve lock drift`).
- `bridge/git-finalizer.js` — added exported `pipelineCommitSubject(id, text)`. It
  lives here rather than in the orchestrator because the orchestrator already requires
  git-finalizer and the reverse would be a cycle. Idempotent for the same id; an absent
  id returns the text unchanged rather than inventing a label.
- `dashboard/server.js` — added exported `sliceIdOfSubject(subject)`; the topology
  reader, the promote strip, `sliceAuthorsByCheck` and `_blameConflict` all call it.
  The four regexes it replaces disagreed, which is why the archive commits read
  labelled on one panel and nameless on another.
- `regression/dispatch-execution/j-no-nameless-commits.test.js` — added, 8 tests.
- `bridge/new-slice.js` — **not** changed. Its restage path moves terminal queue files
  to trash by rename, but it never records them in git, so there was nothing to make
  pipeline-owned; after this slice those moves read as dirty instead of being swept
  into a nameless commit. See **Conflicts with the brief**.

## Acceptance criteria verification

- **slice-395-ac-1** — the pre-checkout autocommit never stages a path under
  bridge/queue, bridge/staged, bridge/trash, bridge/state, bridge/logs or a bridge
  ledger, and still commits a person's uncommitted edit to a source file.
  - Test: `regression/dispatch-execution/j-no-nameless-commits.test.js`
    ("the autocommit stages no pipeline-owned path…", plus trap 1).
  - Command: `node --test regression/dispatch-execution/j-no-nameless-commits.test.js`
  - Result: **pass**. Ten pipeline-owned paths are force-tracked in a fixture, then
    dirtied the way a run dirties them (the `.md` ones deleted, i.e. renamed away);
    `stageablePathsFrom` returns exactly `['lib/engine.js']`, and the real
    `autoCommitDirtyTree` commits that one file and nothing else.

- **slice-395-ac-2** — a landing is one commit on dev: the squash, the regenerated
  locks, the re-filled report and the archive rename all in it, with no separate chore
  commit afterwards.
  - Test: same file ("a landing is one commit…", plus trap 2).
  - Command: as above.
  - Result: **pass**. A real `squashSliceToDev` against a bare-origin fixture adds
    exactly **one** commit to dev, subject `S9396: One landing is one commit`, carrying
    `lib/engine.js` and `bridge/queue/9396-ARCHIVED.md`. The `{id}-DONE.md` name never
    reaches dev at all — better than the brief's expected `R100` rename, because dev's
    parent holds neither name for a first landing. `archiveAcceptedSlice` afterwards
    still returns `archived: true` (worktree, branch, ARCHIVED event) and leaves the
    dev sha unchanged; no `chore(queue)` subject exists on the branch;
    `git status --porcelain -- bridge/queue` is empty.

- **slice-395-ac-3** — every commit subject the pipeline writes starts with `S<id>:`
  and `sliceIdOfSubject` labels it, so the topology, History and the promote strip
  agree.
  - Test: same file ("every commit subject the pipeline writes…", plus trap 3).
  - Command: as above.
  - Result: **pass**. The three subjects the pipeline still writes (squash, archive
    record, autocommit) all start `S<id>: ` and all resolve through
    `sliceIdOfSubject`; a person's subject still resolves to `null`, including one that
    mentions a slice id mid-sentence. A source scan over `bridge/orchestrator.js` and
    `bridge/git-finalizer.js` asserts every message-bearing `git commit` takes its
    message from the helper (or from `.squash-commit-msg`, which the helper wrote).
  - One honest gap: `git merge --no-ff dev` inside the squash still produces git's
    default merge subject. It is a `git merge`, not a `git commit`, it lives on the
    slice branch, and it is squashed away at landing, so it never reaches dev. The
    conflict-resolution `git commit` on the same branch *is* labelled.

- **slice-395-ac-4** — after the one-time index cleanup, git status shows nothing under
  bridge/queue and no report file on disk has moved.
  - Test: same file ("the index cleanup leaves nothing under bridge/queue…", plus
    trap 4).
  - Command: as above.
  - Result: **pass**, and the cleanup itself was a no-op. What I measured:
    - **Part A, the literal task** (force-tracked queue file whose disk copy moved):
      **0 paths**, in this worktree and in the live main tree. 201 tracked paths across
      `bridge/queue`, `bridge/staged`, `bridge/trash`; all present on disk;
      `git status --porcelain -- bridge/queue` empty. The postcondition holds and
      nothing was staged, so no report on disk moved. The test audits this against the
      real repository rather than a fixture, then pins the rule that keeps it true (the
      autocommit can never again record a queue path) and proves the recording path is
      index-only on a fixture that *does* have the condition.
    - **What I found and did not do.** The eight autocommits did not leave the
      condition — they consumed it, by committing the deletions. Two of them
      (`b508dcb`, `0873262`) took a tracked report out of git while leaving it on disk:
      `bridge/queue/367-ARCHIVED.md` and `bridge/queue/370-ARCHIVED.md` are on disk in
      the live tree, untracked, and byte-identical to the blob that was removed
      (verified with `shasum` against `<removal>^:bridge/queue/{id}-DONE.md`). Three
      more (354, 357, 382) lost theirs with nothing left on disk; their blobs remain
      reachable in history. **I did not restore 367 and 370.** Their nine criteria are
      currently `legacy: true, text: null, acHash: null` in `AC-MANIFEST.lock`
      *precisely because* their slice files left the index, and
      `scripts/build-ac-manifest.js` states the rule: grandfathered tags "stay
      legacy:true … never hash-ratcheted until a human backfills them from brief
      intent, Nog-reviewed — docs/contracts/ac-custody.md". Force-adding those two
      files would hash-ratchet nine grandfathered ACs as a side effect of a cleanup
      slice. That is a human's call; it wants its own brief. (192 further slices have an
      untracked `-ARCHIVED.md` on disk, but those were never force-added at all —
      recording them would be a mass import nobody asked for, and the brief says not to
      touch files that are tracked and present.)

## Safety-net tests

`regression/dispatch-execution/j-no-nameless-commits.test.js` — 8 tests: one per
acceptance criterion plus one per trap. Command run:
`node --test regression/dispatch-execution/j-no-nameless-commits.test.js` → **8 pass,
0 fail**.

Break-it-on-purpose (core lane). I set the fix aside with a WIP commit and
`git checkout e7a412b -- bridge/orchestrator.js bridge/git-finalizer.js
bridge/state/seed-runtime-state.js dashboard/server.js`, keeping the test file, then
restored it the same way. **All 8 went red:**

| test | red because |
|---|---|
| ac-1 the autocommit stages no pipeline-owned path… | `TypeError: isPipelineOwnedPath is not a function` |
| ac-2 a landing is one commit… | assertion: `the archived report must be in the landing commit: A bridge/queue/9396-DONE.md \| M lib/engine.js` |
| ac-3 every commit subject… | `TypeError: pipelineCommitSubject is not a function` |
| ac-4 the index cleanup… | assertion: `no sweep may ever again record a queue path on the pipeline's behalf: D bridge/queue/9395-DONE.md` |
| trap 1 one dirty lib/ file and one deleted queue file | `TypeError: autoCommitDirtyTree is not a function` |
| trap 2 a landing whose amend fails… | `TypeError: stageQueueArchiveForLanding is not a function` |
| trap 3 the prefix helper… | `TypeError: pipelineCommitSubject is not a function` |
| trap 4 folding the rename into a landing… | `TypeError: stageQueueArchiveForLanding is not a function` |

Two of them (ac-4 and trap 2) were green on the first break-it run and I replaced
them before committing: ac-4 was exercising `recordArchivedQueueRename`, which slice
381 already made clean, so it proved the invariant and not my change; trap 2 was
trivially true because without the fix nothing renames ACCEPTED→ARCHIVED at all. Both
now assert the thing this slice actually adds — the autocommit's refusal, and that
`stageQueueArchiveForLanding` → `revertQueueArchiveStaging` round-trips the index and
the disk back to where it found them.

I also ran the four existing suites that pin the code I edited, because a red landing
costs a fix-request round:
`node --test regression/dispatch-execution/j-untracked-runtime-state.test.js
regression/dispatch-execution/j-archive-rename-recorded.test.js
regression/gate-merge/j-s-numbering-squash-subject.test.js
regression/dispatch-execution/j-runtime-state-survives-landing.test.js` → **40 pass,
0 fail**. (`slice-372-ac-1` pins the first 1600 characters of `autoCommitDirtyTree`'s
body for `!l.startsWith('??')` and `git add -u`; my comments pushed `git add -u` past
that window, so I moved the rationale into the function's doc comment, which the
window does not cover.) I did not run the full safety-net suite or the browser suite.

I did not look in a browser: this session is headless and the live dashboard runs the
main tree's older code, which is not mine to restart. Instead I ran the shipped
`sliceIdOfSubject` over the real `origin/main..origin/dev` log to see what the panel
will render — `S393` for the squash, and no label for the `chore(queue)` archive commit
or the human handoff commit. That is the before-state the brief describes, and after
this slice the `chore(queue)` row does not exist at all.

## Screen hooks

The brief pre-named `.topo-*` under the branch graph and left the per-node label to me.
Hooks used, all already in the shipped page — no new test-id scheme:

- `#topo-panel` — the QA / Branches topology panel. Collapsed state is the class
  `topo-collapsed` on it (persisted as `localStorage['ops:topo-collapsed']`); the body
  `.topo-panel-body` is `display:none` while collapsed, so every hook below is visible
  only when the panel is expanded.
- `#topo-svg-wrap` — the container the branch graph SVG is rendered into. Visible
  whenever the panel is expanded.
- `#topo-svg-wrap svg text` whose text content is `S<id>` — **the per-node slice
  label**, one `<text>` drawn 18px beneath each dev commit node, emitted only when that
  commit's `slice_id` is non-null (i.e. when `sliceIdOfSubject` resolved its subject).
  This is the element that changes meaning in this slice: after it lands, every node
  the pipeline created has one.
- `#topo-svg-wrap svg circle title` — the per-node tooltip carrying the sha; one per
  dev commit node, the dev tip drawn at r=6.5 and the rest at r=4.5.
- `#topo-panel .topo-commits .topo-c-row` — the newest/base commit detail rows, with
  `.topo-c-k` (the "newest"/"base" key), `.topo-c-sha`, `.topo-c-subj` (the raw commit
  subject, so a pipeline commit reads `S<id>: …` here) and `.topo-c-age`. Present
  whenever there is at least one commit on dev ahead of main.

## Tests moved or weakened

None. No existing test was moved, renamed, changed or removed; the 40 tests in the four
suites that pin this code pass unchanged.

## Conflicts with the brief

Two, both reported rather than decided:

1. **Task 5 is a no-op.** Covered in full under slice-395-ac-4. The brief's evidence is
   right about the eight autocommits; what it did not account for is that those
   autocommits had already committed the deletions, so there is nothing left reading as
   deleted. I verified rather than assumed, in both trees, and delivered the audit plus
   the guard instead of an empty commit.
2. **`bridge/new-slice.js` — the restage path, and the ERROR cleanup.** The brief lists
   new-slice.js as "modified, if its restage path moves tracked files". It does move
   them (`archiveTerminalFiles` renames terminal queue files to `bridge/trash/` with
   `.attempt<N>` suffixes) but it never tells git, and the same is true of
   `archiveSiblingStateFiles(id, 'ERROR')` at the three ERROR sites. Before this slice
   those deletions were swept into the next nameless autocommit. After it, they will sit
   in `git status` until something records them. Task 2 names "a restage, an ERROR
   cleanup" as `recordArchivedQueueRename`'s remaining remit, but that function is
   ARCHIVED-specific (it looks for `{id}-ARCHIVED.md`), and wiring it at those sites
   means generalising it to any terminal suffix and adding three call sites in paths I
   have no test coverage for. I judged that a scope decision, not an implementation one,
   so I left it: dirty-but-honest beats a nameless commit, and no criterion here asserts
   it. If O'Brien wants it, it is a small amendment and I would generalise the
   recorder's terminal-file detection rather than add a second function.

## Commit

Single commit on `slice/395`, with the four `AC:` trailers and `Lane: core`. Files:
`bridge/orchestrator.js`, `bridge/git-finalizer.js`, `bridge/state/seed-runtime-state.js`,
`dashboard/server.js`, `regression/dispatch-execution/j-no-nameless-commits.test.js`,
`bridge/queue/395-DONE.md`. No lock file edited and neither deriver run — the pipeline
regenerates them at landing.

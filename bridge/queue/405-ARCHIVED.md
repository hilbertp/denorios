---
id: "405"
title: "Every dev commit says what kind it is, and the server reports it"
from: rom
to: nog
status: DONE
slice_id: "405"
branch: "slice/405"
completed: "2026-09-25T20:58:00.000Z"
tokens_in: 126
tokens_out: 69109
elapsed_ms: 1478865
estimated_human_hours: 3.5
compaction_occurred: false
tokens_cache_read: 6814495
cost_usd: 6.789642500000001
---

## Summary

Every commit the pipeline writes now declares what kind of thing it is in a `Kind:` trailer — `S` for a slice landing, `P` for its own bookkeeping — and GET /api/branch-state reports, for each commit on origin/dev that is not on origin/main, its `kind`, `slice_id`, `label` (`S402`, `P404`, `H`) and `inferred`.

Three writers gained the trailer: the landing squash (`Kind: S`), the archive-rename commit and the pre-checkout autocommit (both `Kind: P`). Every subject is byte-for-byte what it was — the kind rides the trailer block only, so `sliceIdOfSubject` and the `S<id>: ` label read exactly what they read before.

The reader takes the kind from git's own trailer reader (`%(trailers:key=Kind,valueonly)`) inside the single `git log` that already builds the ribbon — no second call, and no call per commit. Where no trailer counts (everything already on dev, and everything a person writes), the kind is inferred from the subject and `inferred: true` says so out loud. No page reads `kind` or `label` yet, so the screen is unchanged; that is slice 406.

## What changed

- `bridge/orchestrator.js`
  - `squashSliceToDev` (line ~9500): the message gains one `Kind: S` line at the head of the trailer block, before `Slice-Id:`. The pinned literal opening ``const commitMsg = `${gitFinalizer.pipelineCommitSubject(sliceId, sliceTitle)}`` is untouched, `Lane:` is still one line after `Slice-Branch:`, and `Kind` was **not** added to the harvest at lines 9406–9452 — the kind describes the commit being written, so a branch commit's own `Kind: P` stays on the branch.
  - `recordArchivedQueueRename` (line ~4732): a `commitBody` of `<subject>\n\nKind: P\n` replaces the bare subject on the `git commit --only -m` line. The comment moved above `const msg` so the commit stays inside the twelve-line labelling window `j-no-nameless-commits` scans.
  - `autoCommitDirtyTree` (line ~1513): the same `commitBody`. The `log('warn', …)` line above it still logs the bare subject — only git gets the trailer.
- `dashboard/server.js`
  - Three pure functions beside `sliceIdOfSubject` (line ~331): `commitKindOfTrailers` (first S/P/H value wins, case-tolerant, anything else skipped), `commitKindOfSubject` (case-**sensitive** `S<id>: ` → `archive `/`autocommit ` give P, anything else labelled gives S, everything else H) and `commitKindEntry` (kind + slice_id + label + inferred). All three exported.
  - `_getGitTips` (line ~542): the dev-ribbon `git log` format becomes `%x1e%H %ct %s%x1f%(trailers:key=Kind,valueonly)`; records split on %x1e, fields on %x1f, because the trailer block itself is newlines. `--max-count=60 --reverse` and the empty-range-gives-`[]` behaviour are unchanged; each entry keeps `sha`, `full_sha`, `slice_id`, `subject`, `age_s` and gains `kind`, `label`, `inferred`. The author is never read.
- `regression/dispatch-execution/j-commit-kind.test.js` (added) — 9 AC guards + 4 trap guards.

No `e2e/` fixture or helper needed changing.

## Acceptance criteria verification

Command for every row: `node --test regression/dispatch-execution/j-commit-kind.test.js` — 13 tests, 13 pass, 0 fail.

| Tag | Test file | Result |
|---|---|---|
| slice-405-ac-1 | regression/dispatch-execution/j-commit-kind.test.js | PASS — subject `S042: Test Feature` unchanged; `%(trailers:key=Kind)` is exactly `Kind: S`; `Slice-Id: 042`, `Slice-Branch: slice/042`, `Lane: core` and the harvested `AC:` line still read as trailers; the branch commit's own `Kind: P` stayed on `slice/042` |
| slice-405-ac-2 | same file | PASS — subject `S9395: archive 9395-DONE.md -> 9395-ARCHIVED.md` unchanged, one `Kind: P` |
| slice-405-ac-3 | same file | PASS — subject `S9402: autocommit before checkout, 1 source file(s) a person left uncommitted (pre-checkout-branch-slice/9402, on dev)` unchanged, one `Kind: P` |
| slice-405-ac-4 | same file | PASS — both `github.dev_commits` and `dev.commits`: `[]` on an empty range (the stale branch-state.json ribbon does not stand in), one oldest-first entry per commit, `sha`/`full_sha`/`age_s`/`subject` intact, `_ct` still stripped, `kind`/`label`/`inferred` added, identical entry for the same message under two different authors, and 60 of 63 commits at the ceiling |
| slice-405-ac-5 | same file | PASS — `S402: History cost includes Jordan: …` with Slice-Id/Slice-Branch/Lane/AC trailers and no Kind → `S`, `402`, `S402`, inferred true |
| slice-405-ac-6 | same file | PASS — the autocommit subject → `P`/`402`/`P402`; `S404: archive (nothing tracked) -> 404-ARCHIVED.md` → `P`/`404`/`P404`; both inferred |
| slice-405-ac-7 | same file | PASS — all five real subjects (incl. 77293b1 with its closing `Co-Authored-By:` trailer) → `H`, slice_id null, label `H`; `slice/42 legacy subject` → `H42`; `s402: fix by hand` → `H402` |
| slice-405-ac-8 | same file | PASS — `Kind: S` over an `archive ` subject → `S405`; `Kind: H` → `H406`; `kind: p` → `P407`; `Kind: X`/`Kind: P`/`Kind: S` → `P410`; all inferred false |
| slice-405-ac-9 | same file | PASS — `Kind: T` → `P408` inferred; `Kind: X` and valueless `Kind:` ignored; `Kind: P` inside an `AC:` trailer's text → `S409`; `Kind: P` opening a body that ends in prose → `S411`; all inferred true |

## Safety-net tests

`regression/dispatch-execution/j-commit-kind.test.js` — 9 AC guards and 4 trap guards, 13 tests:

- one per AC (`slice-405-ac-1` … `slice-405-ac-9`)
- `slice-405-ac-4 trap 1` — exactly one `git log origin/dev` builds the whole ribbon, no child process is spawned inside the per-commit map, `--max-count=60`/`--reverse` survive, and the kind comes from git's trailer reader rather than a regex over `%B`
- `slice-405-ac-4 trap 2` — a nine-line trailer block is still one entry and does not swallow the commit after it; no separator byte leaks into a subject or a sha
- `slice-405-ac-1 trap 3` — the pins other suites hold still hold: the literal `const commitMsg = ${gitFinalizer.pipelineCommitSubject(sliceId, sliceTitle)}` opening, `git log dev..${sliceBranch} --reverse`, every message-bearing pipeline commit within twelve lines of the labelling helper, one `Lane:` after `Slice-Branch:`, `Kind: S` inside the trailer block and never in the subject, and no `Kind` in the harvest code
- `slice-405-ac-4 trap 4` — `_getGitTips` asks git for no author format (`%an`, `%ae`, `%aN`, `%aE`, `%cn`, `%ce`, `%aL`, `%cL`) and mentions no author field at all; plus the three pure rules on their edges (trimming, case-folding, first-wins, `S1:no space` → H, `S1: archived by hand` → S not P, a declared kind with no slice → bare letter label)

**Break-it run (fix set aside, test file kept):** all 13 went red — 13 tests, 0 pass, 13 fail. With the fix restored: 13 pass, 0 fail. I did not use `git stash` (the stack is shared with other worktrees); I copied the two source files aside, ran `git checkout -- bridge/orchestrator.js dashboard/server.js`, ran the file, then copied them back and confirmed green.

Trap 3 was earning its keep before I committed anything: it caught my first archive-rename edit pushing that `git commit` line thirteen lines below `pipelineCommitSubject`, one line outside the window `j-no-nameless-commits` scans. Moving the comment above `const msg` fixed it.

**Looked, did not test:** I ran the shipped reader over the live ribbon (`origin/main..origin/dev`, six commits) and it printed `S403 inferred`, `P403 inferred`, `S368 inferred`, `P368 inferred`, `S396 inferred`, `P396 inferred` — three landings and three archive commits, every one honestly marked as inferred because they all landed before this slice existed. I did not open the dashboard in a browser: no page reads `kind` or `label` yet, so there is nothing on screen to look at.

## Screen hooks

None. No criterion touches the screen — the page reads neither `kind` nor `label`, and by design the display is slice 406. The payload names a browser test would read are `github.dev_commits[].kind|label|inferred` and `dev.commits[].kind|label|inferred` on GET /api/branch-state.

## Tests moved or weakened

None. No existing test was moved, renamed, changed or removed. `regression/dispatch-execution/j-commit-kind.test.js` is a new file, and the four pins the brief flagged (`j-no-nameless-commits`, `j-ac-amend-order`, `j-s-numbering-squash-subject`, `j-lanes`) are re-asserted unchanged in trap 3 rather than adjusted.

## Commit

Branch `slice/405`, one commit on top of `b98c627`, with the nine `AC:` trailers declared as the brief requires.
I deliberately left `Kind:` off my own branch commit: the kind letter is the pipeline's declaration about the commits it writes on dev, not something a builder gets to pre-seed, and it is not harvested either way.

- `bridge/orchestrator.js` (modified)
- `dashboard/server.js` (modified)
- `regression/dispatch-execution/j-commit-kind.test.js` (added)
- `bridge/queue/405-DONE.md` (added, `git add -f`)

I did not regenerate `regression/*.lock` and did not run `build-coverage-map` or `build-ac-manifest` — the brief says the pipeline regenerates them at landing.

**For whoever lands this:** until the daemon restarts, new pipeline commits carry no `Kind:` and read as inferred; until the dashboard restarts, the API serves the old entries. Both are launchd kickstarts — `dev.denorios.orchestrator` and `dev.denorios.dashboard`.

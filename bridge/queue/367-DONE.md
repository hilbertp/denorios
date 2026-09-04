---
id: "367"
title: "One classification, one range, one screen"
from: rom
to: nog
status: DONE
slice_id: "367"
branch: "slice/367"
completed: "2026-09-04T22:14:20.000Z"
tokens_in: 395000
tokens_out: 31000
elapsed_ms: 4034000
estimated_human_hours: 5.5
compaction_occurred: false
---

## Summary

The merge dialog now runs **one** classification. The verdict chip and the change
breakdown beneath it both project a single `getPinnedClassification()` result, so they
cannot cite different evidence. Renames get their own neutral group, every item leads
with a plain sentence naming the slice that made the change, and the raw check titles
are demoted behind the existing "show titles" toggle rather than deleted.

The verdict logic is untouched. This slice changed what is displayed and from where.

## What changed

| File | Why |
|---|---|
| `dashboard/server.js` | New `getPinnedClassification()` — one pinned range (`merge-base(origin/main, origin/dev)..origin/dev`), one bucket scope, cached on **both** ends. `getTestChanges()`, `getTestsNeeded()` and `getTestDrift()` all read it instead of resolving refs and classifying three separate times. New `sliceAuthorsByCheck()` (per-check slice attribution) and `plainChangeSentence()`. |
| `dashboard/lcars-dashboard.html` | One shared `_group()` renderer for all bands; new neutral **Renamed** group; plain sentence leads each item, raw title demoted behind the toggle; `.utc-renamed` stylesheet rule; `data-utc-group` hooks. |
| `lib/tests-needed.js` | Carries each check's `name` (its title as written) for **display only** — `decide()` never reads it. |
| `regression/gate-merge/j-merge-dialog-one-classification.test.js` | New — 4 AC guards + 4 trap guards. |
| `regression/COVERAGE.lock`, `regression/AC-MANIFEST.lock` | Regenerated for the 8 new guards. Both builders re-run clean with no drift. |

No `e2e/` file was touched.

The old breakdown ran a **three-dot** `origin/main...origin/dev` narrowed by a
hand-written `regression/ e2e/` pathspec and cached on the **dev tip alone** — so a main
that moved left the two halves of one screen reading different evidence. Which paths
count is now the engine's own `bucketOf()`, never a pathspec repeated at a call site.

## Acceptance criteria verification

Command for all four: `node --test regression/gate-merge/j-merge-dialog-one-classification.test.js`

| Tag | Test file | Result |
|---|---|---|
| slice-367-ac-1 | `regression/gate-merge/j-merge-dialog-one-classification.test.js` | **PASS** — breakdown and verdict report the same `base`/`head`; every classified check lands in exactly one group; the removal the chip flags is in the list beneath it. |
| slice-367-ac-2 | same file | **PASS** — a clean rename is its own group and never a removal; a rename that guts its assertions stays in "Weakened or skipped" with `direction: 'loosened'`. |
| slice-367-ac-3 | same file | **PASS** — every item carries a `plain` sentence; `Slice 901 removed the check "…" and put nothing in its place. Intended?` is attributed to the slice that made it, not the last to touch the file; raw titles still render behind the collapsed toggle. |
| slice-367-ac-4 | same file | **PASS** — undeclared removal still `red_flag`, RED still disables Approve behind the non-author second-ack, See diff and the added/changed/removed groups all still render. |

Full suite: `npm test` → **499 tests, 494 pass, 0 fail, 5 skipped**. The 5 skips are
pre-existing (4 STALE ROW tests + one conditional `slice/371` check), none mine.

## Safety-net tests

Eight tests, one per acceptance criterion plus one per trap, all in
`regression/gate-merge/j-merge-dialog-one-classification.test.js`. Each builds a real
git fixture (local bare origin, per-test tmpdir, no network) whose promoted range holds
a real removal by S901 and — in a **later** slice, in the **same file** — a clean rename,
a rename-that-guts, a reword and an addition.

**The stash-red check, and why I did not stop there.** With the fix reverted, all 8 go
red (0 pass / 8 fail). But 7 of them failed with `f.changes is not a function` — they
were red only because the pre-slice `server.js` does not *export* those functions. That
proves the export line changed, not that the guards bite. So I mutation-tested each
behaviour against the **shipped** code instead, with the exports in place:

| Mutation applied to the shipped code | Caught by |
|---|---|
| Breakdown cache keyed on the dev tip alone (**the exact drift bug**) | trap-endpoint-drift |
| Breakdown hides removals the verdict flags (**the reported bug**) | ac-1, ac-2, ac-3, ac-4, trap-endpoint-drift, trap-titles-demoted |
| Neutral group swallows a rename that gutted its assertions | ac-2, ac-3, trap-verdict-unmoved |
| Plain sentence replaced by the raw title | ac-3, trap-titles-demoted |
| Raw titles deleted from the group renderer | ac-3, trap-titles-demoted |
| File-level attribution instead of per-check ("Slice 902 removed…" when S901 did) | ac-3 |
| A rename excuses a loosened blocker (**verdict changed**) | trap-verdict-unmoved |
| `.utc-renamed` stylesheet rule absent | trap-no-new-inline-colours |

Every test is load-bearing for at least one mutation, and the two most dangerous
mutations — a gutted rename presented as neutral, and a rename excusing a blocker — are
each caught by a guard written for exactly that.

**What I saw in the browser.** I started the dashboard on port 4791 and hit both
endpoints: they report the same range (`f55fdc4..242442a`), and the live payload reads
`Slice 379 added the check "criterion text comes from the commit trailer, not from the
working file"`. The current dev range has no removals or renames, so I also rendered
`_renderTestChanges()` from the shipped page against a payload carrying all five groups
and screenshotted it in Chromium. The two warning bands (No longer checked, Weakened or
skipped) are red; **Renamed** is a quiet grey band with a ↔ glyph and no warning
colour, clearly distinct from the removals sitting directly above it; Changed is amber,
Added green. Every group carries its own "show titles" link and the titles are collapsed
by default. The removal line read exactly as the brief asked:
*"Slice 353 removed the check "a merge that does nothing is reported as success" and put
nothing in its place. Intended?"*

## Screen hooks

All names below exist in the shipped page. The brief did not pre-name them, so I declare
them here. Existing hooks I reused rather than renamed: `#update-tests-overlay`,
`#update-tests-body`, `#utc-verdict`, `#utc-approve-btn`, `#utc-ack-box`,
`#utc-secondack`, `.utc-group`, `.utc-head`, `.utc-item`, `.utc-add-toggle`,
`.utc-add-titles`, `.utc-add-file`.

| Hook | Starting state |
|---|---|
| `[data-utc-group="removed"]` | visible only when the range removes a check; red band |
| `[data-utc-group="weakened"]` | visible only when a check was loosened or skipped; red band |
| `[data-utc-group="renamed"]` | **new** — visible only when a check was renamed and not weakened; neutral grey band, no warning glyph |
| `[data-utc-group="changed"]` | visible only when a check was reworded or tightened; amber band |
| `[data-utc-group="added"]` | visible only when checks were added; green band |
| `.utc-item` (first in a group) | always visible when its group is — carries the plain sentence, never the raw title |
| `.utc-add-titles` | present in **every** group, `hidden` until "show titles" is clicked |
| `.utc-raw` / `.utc-raw-file` | inside `.utc-add-titles`; the verbatim check title and its file, hidden by default |
| `.utc-add-toggle` | visible in every group; text "show titles", `aria-expanded="false"` initially |
| `.utc-renamed` | class on the neutral band; themed by stylesheet, not inline styles |
| `a.rb-btn-cancel[href*="/compare/main...dev"]` | "See diff ↗", always visible — unchanged |

The verdict chip (`.utc-verdict-chip`) still carries **inline** colours. That is trap 3 —
I left the markup exactly as it was; fixing it is out of scope. The new Renamed band does
not repeat the mistake, and a guard asserts that.

## Tests moved or weakened

**None.** No existing test was moved, renamed, changed, weakened or removed. No second
signature is needed.

One thing worth your eye, though it required no edit:
`regression/direct-controls/j-direct-controls-regression-coverage.test.js:258` asserts
`server.includes('origin/main...origin/dev')` with the message *"changes are scoped to the
promotion window"*. That string was the breakdown's three-dot range — the bug this slice
removes. The assertion still passes, because the refactor-risk score at `server.js:400-411`
legitimately uses the same string. So the test is green but its message no longer describes
`getTestChanges()`. I did **not** touch it: it is not mine, it is not failing, and editing it
would be a weakening that needs your signature. Flagging it so the staleness is a decision
rather than an accident.

## Conflicts with the brief

None on scope. Two notes.

**1. I found the implementation already in the worktree, uncommitted.** Attempt 1 left
`dashboard/server.js`, `dashboard/lcars-dashboard.html` and `lib/tests-needed.js` modified
and the test file untracked, on a branch renamed to `slice/367-attempt1` at 21:07 UTC —
the same minute this brief was created. I reviewed all of it rather than trusting it, ran
it, mutation-tested it, and found and fixed one real defect in it (below). I committed on
a fresh `slice/367` cut from `origin/dev`, per the DONE template and the `slice/{n}`
convention the orchestrator resolves.

**2. The defect I found and fixed: a per-poll performance regression.** Attempt 1 removed
the cache from `getTestChanges()` and left only the pinned classification cached. But
`/api/branch-state` calls `getTestChanges()` on **every poll** for `tests_changed`, and the
new attribution pass shells git. I measured it on a realistic 60-commit window (42 changed
test files): **~300ms of `git log` + 29 `git show` calls, on every poll** — while the
comment at `server.js:3595` still promised "cached 30s in getTestChanges, so it's cheap on
every poll". I restored the memoisation, keyed on the **pinned classification object
itself** rather than on its SHAs. Object identity is the right key for two reasons:
`gather()` reads `regression/COVERAGE.lock` from the **working tree**, so the same range
can classify differently without either ref moving (which is why the pinned cache expires
on time, not on SHAs); and identity cannot reproduce this slice's own bug, which came from
a cache keyed on the dev tip alone that a moving main never busted. Cold 108ms → warm
~12ms, and `trap-endpoint-drift` still passes, which is the guard that would catch a
regression here.

## Commit

`cf13897` on branch `slice/367` (cut from `origin/dev` at `242442a`), carrying all four
`AC:` trailers.

    S367: one classification, one range, one screen

Files: `dashboard/server.js`, `dashboard/lcars-dashboard.html`, `lib/tests-needed.js`,
`regression/gate-merge/j-merge-dialog-one-classification.test.js`,
`regression/COVERAGE.lock`, `regression/AC-MANIFEST.lock`. Staged by explicit path.

Two notes for the merge path:

- **`AC-MANIFEST.lock` records the four criteria as `legacy-backfill` with null text**,
  even though the trailers are committed and `lib/ac-range-scan.js` reads them correctly
  (I verified: all four resolve with their full text). That is `build-ac-manifest.js`
  working as designed — a trailer only replaces a *legacy* tag's text when the slice is
  "orphaned" (a tracked slice file git cannot produce), and slice 367 has no queue file at
  all. Draining the legacy allowlist is explicitly a human, Nog-reviewed backfill, so I did
  not force it. The suite is green in this state.
- **The live dashboard must be restarted and the tab hard-reloaded** before any of this is
  visible. That is the recurring trap on this project — a stale server has silently served
  week-old gate code before.

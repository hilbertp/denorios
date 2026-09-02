---
id: "365"
title: "Stop policing what we never run"
from: rom
to: nog
status: DONE
slice_id: "365"
branch: "slice/365-attempt1"
completed: "2026-09-02T01:03:30.000Z"
tokens_in: 198000
tokens_out: 9200
elapsed_ms: 305000
estimated_human_hours: 3.5
compaction_occurred: false
---

# Slice 365 — stop policing what we never run

Commit `222d436` on **`slice/365-attempt1`**, one commit ahead of `dev` (`152a5a7`).

> **Branch note.** The brief's DONE template carries the placeholder `branch: "slice/365"`, but the
> orchestrator created this worktree on **`slice/365-attempt1`** and `verifyBranchState()` checks
> against that same derived name. No `slice/365` or `slice/365-attempt-1` branch exists. I stayed on
> the branch the orchestrator actually made rather than minting a divergent one; the frontmatter
> above reports the real branch, not the placeholder.

## What I found on arrival

Attempt 1's work was sitting **uncommitted** in this worktree (3 files). I verified it rather than
trusting it. The `bucketOf` change and the guard test were sound — all three `@ac-hash` values
recompute exactly against the brief's AC text via `acHashOf()`. Two things were missing and would
have gone RED on CI:

- **`regression/COVERAGE.lock` was stale.** The new guard test adds 12 guards and two new sources;
  `j-coverage-map-integrity.test.js` was failing (398 committed vs 410 fresh).
- **`regression/AC-MANIFEST.lock` was stale**, for this slice's own three AC tags.

Both are rebuilt and committed. I also slightly hardened one guard assertion (below).

## Tasks

**1. `test/` no longer classifies as test surface** — `lib/tests-needed.js:32`. The `^test/` arm is
removed from the TEST rule so the path falls through to `INERT`, with a comment recording *why* and
what re-adding it would require.

*Verified nothing downstream re-catches it:*

- `gather()` splits the changeset purely on `bucketOf`; `INERT` lands in **neither** `behaviourFiles`
  nor the diffed test files, so a `test/` path can neither raise a masking flag nor demand a guard.
- `scripts/build-coverage-map.js` — both walkers pinned to `regression/` and `e2e/`.
- `COVERAGE.lock` keys no source under `test/`.
- A repo-wide grep across `lib/`, `scripts/`, `bridge/`, `.github/workflows/` found **no other**
  `test/` path handling.
- Confirmed the premise independently: `npm test` = `node --test 'regression/**/*.test.js'`,
  `test:e2e` = playwright. `ci.yml` even carries a comment saying `test/` is intentionally excluded.

**2. Guard test** — `regression/gate-merge/j-unrun-test-dir.test.js`, 4 tests, all passing. It locks
the de-scope from both sides: behaviourally (`bucketOf` answers `INERT` for real `test/` paths) and
structurally (the bucket table has no `^test/` rule; no walker or lock key re-admits the directory).

I tightened one assertion: the walker check matched only the single-argument
`path.join(repoRoot, 'x')` form, so `path.join(repoRoot, 'test', 'unit')` would have slipped past the
very check whose comment promises to catch a third walker root. It now matches the first literal
segment of any `path.join(repoRoot, …)`.

**3. `regression/COVERAGE.md:146` rewritten** from a documented gap into an explicit open item. It
now leads with what *is* guarded, then states the gap under **`OPEN — UNGUARDED`**, naming each
uncovered case. The note is not deleted, and the two `test/` files stay named — the history it
supersedes is recorded, not erased.

I verified the note's claims instead of copying them: `j-s-numbering-squash-subject.test.js` exists,
carries the `slice-350-ac-3` tag, and really drives `squashSliceToDev` against a fixture git repo.
The "see the addendum below" cross-reference resolves to a real section.

## Trap 1 — the coverage gap, stated plainly

**This slice creates a real coverage gap. It is not papered over.**

The AC itself, `slice-350-ac-3` (squash subject `S{id}: {title}`), **is still guarded in CI** — that
guard is untouched. What is now formally unguarded is the wider surface those two `test/` files were
the only cover for, and **nothing runs it**:

1. The squash **conflict** path — `{ success: false, error: 'conflict' }`, no partial state.
2. The **atomic-write** requirement on `branch-state.json`.
3. The **accept-and-merge integration** — slice lands on dev, `main` untouched.

The honest framing: **the gap is pre-existing, not new.** That suite has never run in CI. Before this
slice the coverage was implied; now it is visible. What changed is the bookkeeping, not the risk.
Closing it means porting those three cases into `regression/` — a port, not a glob change. Owner
unassigned; this is a real routing decision for O'Brien.

Traps 2 and 3 respected: `regression/` and `e2e/` bucketing untouched; I never ran `test/`, so
`_test_timeout_suite` / `_test_pass_suite` were never regenerated (confirmed absent).

## Verification — the counterfactual, on the live range

I ran the **real classifier** over the live gate range `main..dev` twice: once with the shipped
engine, once with a scratch copy that restores the old `^test/` rule.

| | decision | checks from `test/` | `removedUndeclared` |
|---|---|---|---|
| **Before** (`test/` policed) | `red_flag` | 13 | **2** |
| **After** (this slice) | `needs_review` | **0** | **0** |

Both blockers were exactly where the brief said — `test/ensure-main-fresh.test.js`, checks B
("ahead only (3 commits)") and C ("behind only (2 commits)"). **The S353 flag is cleared, and no
detection logic was touched.** The residual `needs_review` on `main..dev` is advisory and belongs to
other slices already on dev (`dashboard/tokens.css`, `scripts/*.sh`, the plists) — nothing from here.

**This slice's own range, `dev..HEAD`, classifies `clear`:** 0 blockers, 0 unguarded source changes,
guard count **up** 398 → 410 (no anti-shrink trip), 0 AC mutated/retired.

- Full suite: **372 tests, 368 pass, 0 fail, 4 skipped.**
- `COVERAGE.lock` and `AC-MANIFEST.lock` both verify fresh under `--check`.

## Note on AC-MANIFEST.lock — no AC was edited

The manifest gains `slice-365-ac-1..3` and **nothing else**: 0 retired, 0 mutated. So no
`AC-Change-OK` / `Spec-Owner` trailers are needed and no human-gated AC edit is happening here. The
three land as `legacy-backfill` with `acHash: null`, sourced via `tagUniverse()` from the **committed**
`COVERAGE.lock` — so a clean CI checkout regenerates the identical manifest and the integrity gate
holds there too, not just locally.

## Flagged, not fixed (scope)

`COVERAGE.md:147` still says `slice-350-ac-4` has "**no guard anywhere**", but the addendum lower in
the same file records it as closed by `regression/gate-merge/j-s-numbering-legacy-resolve.test.js`.
That line contradicts itself and is stale. It is **outside this brief's task 3**, which names only the
`slice-350-ac-3` line, so I did not touch it — flagging it for O'Brien rather than expanding scope.

## Files

| File | Change |
|---|---|
| `lib/tests-needed.js` | `bucketOf`: `^test/` dropped from the TEST rule (+ rationale comment) |
| `regression/gate-merge/j-unrun-test-dir.test.js` | **new** — 4-test guard suite, all 3 ACs |
| `regression/COVERAGE.md` | `slice-350-ac-3` note → explicit `OPEN — UNGUARDED` item |
| `regression/COVERAGE.lock` | rebuilt — 410 guards / 35 sources |
| `regression/AC-MANIFEST.lock` | rebuilt — 190 tags (+3 slice-365, legacy-backfill) |

**81 files leave the gate's blast radius.**

## Metrics note

`tokens_in` / `tokens_out` are session estimates, not metered readings — no per-invocation usage
counter is exposed to me inside the worktree. `elapsed_ms` is wall-clock from pickup (~00:57:34Z) to
this report.

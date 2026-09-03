# ADDENDUM: the contracts are live, and five things your slices should carry

**From:** Worf (DevOps / release)
**To:** O'Brien (delivery coordinator)
**Date:** 2026-09-03 (evening)
**Scope:** Follows `HANDOFF-TEST-OWNERSHIP-RULING-AND-PLUMBING-SLICES-FROM-WORF.md` from this morning. Read that first; this only adds what changed since.

---

## 1. Everything I called a draft this morning is applied and committed

On Philipp's instruction I applied the whole set today. It is on dev and pushed:

- `b1f4b6a` — the six contracts in `docs/contracts/`, `.claude/roles/nog/ROLE.md`, `.claude/roles/bashir/ROLE.md`, `.claude/CLAUDE.md`, and the new `.claude/roles/rom/ROLE.md`.
- `e6a43ca` — the ruling record, the drafts folder (now the record of what was applied), the handoffs, the IDEAS entry.

The contracts folder is locked again. So: in your briefs, cite `docs/contracts/*` and `.claude/roles/rom/ROLE.md` as the source of truth, not the drafts folder. The morning handoff's sections "Where the other drafts are" and "What NOT to worry about" are superseded on that one point (nothing is waiting on Philipp any more). Nog's and Bashir's role files are applied too.

A verification pass after applying led me to fix about thirty sentences elsewhere in the same files that still described the old rule (the event log, Bashir's output contract, the slice-format example, and so on). Nothing in the ruling changed. The six slices and their order stand.

## 2. Add these to your criteria

**Before Slice 3, not in it.** Create `.claude/roles/obrien/slice-body-template.md` with the fixed "## What Rom does not do" block first; Slice 3's ac-9 compares against it and the file does not exist yet. Apply your own ROLE.md and MEMORY.md patch at the same time (I checked the quoted "current" lines against your live file: 75, 80 and 87 match).

**Slice 3, ac-4.** `.claude/roles/rom/ROLE.md` now exists and is committed; `invokeRom` reads it from the main checkout.

**Slice 4, ac-21.** Add `-QA_QUESTION.md` next to `-IN_QA.md` in `CANONICAL_LIVE_SUFFIXES` (orchestrator.js line 147) and in the Ops suffix-to-state map. `slice-pipeline.md` §2 now defines the question file as a sidecar for Philipp, not a state file; without the whitelist the startup legacy-file audit flags it.

**Slice 4, ac-14, who emits what.** Julian emits `tests-updated` as his "done writing" signal. The stage machinery emits `regression-pass` or `regression-fail` through gate-telemetry and, on red, `QA_RED` to the register. This is already how the safety-net half works today: on `tests-updated` the orchestrator runs the suite and emits the verdict itself (around lines 6543-6585). Slice 4 extends that same path to the browser suite. Bashir's ROLE.md output-contract table now says exactly this, so the brief and the role file agree.

**Slice 4, events.** Emit `IN_QA` when the stage starts. Both `IN_QA` and `QA_RED` are now in `slice-pipeline.md` §7.1, and `bridge/state/` is listed in §1 as the home of `breakit-{id}.json`.

**Context for you, not a criterion.** `ac-custody.md` now says a MISSING or STALE coverage entry in the CHECK overlay is a finding for *your* fix slice (Rom fills it), not something Julian writes. When you see one, it is a Rom slice.

Nothing extra for `bridge/nog-prompt.js` beyond ac-6: Nog's review template lives in his ROLE.md (two lines added there for test-honesty findings and non-finding flags) and his prompt does not embed it.

## 3. Repo state you should hear from me

**One safety-net test fails on the dev checkout, and it is queue state.** `regression/gate-merge/j-ac-manifest-integrity.test.js` reports legacyCount 194 against 199. Cause: `bridge/queue/366-DONE.md` is deleted in the working tree but not committed. The orchestrator moved it to trash at 16:13:58 on 2026-09-02 during the phantom re-dispatch (register: `STATE_FILES_ARCHIVED` then `ARCHIVED` "re-asserting terminal state"), and five of 366's criteria drop out of the regenerated manifest. CI runs on committed state, so it is green there; it bites anyone running the suite locally. Yours to settle: commit the deletion together with a regenerated `AC-MANIFEST.lock` and the trailer the gate wants, or restore the file. It is the same re-dispatch family as 370's four `COMMISSIONED` events in twenty seconds.

**Lock-scripts gap, mine.** `lock-main.sh` and `unlock-main.sh` guard a `CLAUDE.md` at the repo root that does not exist; the live `.claude/CLAUDE.md` is writable today. Logged in IDEAS.md; I fix it on my own surface, no slice needed. Until then treat `.claude/CLAUDE.md` as Philipp-only by convention.

— Worf

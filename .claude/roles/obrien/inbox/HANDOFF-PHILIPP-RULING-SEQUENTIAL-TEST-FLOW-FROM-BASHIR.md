# Philipp's ruling on the test-update flow — rework S356–S360 before he approves

**From:** Bashir (Julian, QA)
**To:** O'Brien (Delivery Coordinator)
**Date:** 2026-09-01
**Scope:** Test-update pipeline — supersedes parts of my earlier `HANDOFF-BRANCH-GATE-AND-CHECK-OVERLAY-FROM-BASHIR.md` (your slate S356–S360 staged against it)

---

## Why this exists

Philipp reviewed the whole test-update flow with me tonight (after the S350/351/352 merge) and made rulings that change the shape of the slate you staged. He explicitly asked me to hand these to you: **rework S356–S360 to match before he approves anything.**

## The rulings (Philipp, 2026-09-01)

1. **The flow is SEQUENTIAL and stays sequential.** Rom builds → the slice moves *visibly* through Nog to History and onto dev → *then* Julian sees the changes + ACs and updates the suite → the merge requires the fully updated suite green, or a red run warrants investigation. This is now the ratified standard; any deviation needs a good reason and his sign-off.
2. **Dax's Model A (parallel, spec-first authoring alongside Rom) is NOT approved.** Philipp doesn't recall ever agreeing to it and wants it talked through before anything proceeds. Treat it as parked — do not build toward it.
3. **Invisible work is a defect, not an optimization.** "Doing things in parallel and without the user seeing it in the GUI of Ops is a problem." Visibility is a requirement.

## What you're asking for — the rework

- **Park or re-scope S360 (branch gate).** It's premised on running the suite on the feature branch *before* dev — the parallel model Philipp just declined. If any part survives, it needs re-framing inside the sequential flow and his explicit OK.
- **Keep the overlay affirmative actions** (apply-draft / author-guard, S356–S359 territory) — they fit the sequential model: they're how Julian's step completes from the GUI instead of dead-ending at "No test needed".
- **Add three new work items** (Philipp's asks tonight, logged in IDEAS.md too):
  1. **Visualize Julian's step in Ops** — the user should *see* "Julian is updating the tests for slices X/Y" as a pipeline stage, with a clear success-or-failure prompt when it finishes.
  2. **Make the merge lock real.** Today "locked — pass Pipeline A to unlock" is display-only: `/api/promote/dispatch` (and rollback dispatch) happily fire while the check is unresolved — tonight's merge went through with the decision popup still open. The server must refuse, not just the button.
  3. **Post-merge display truth.** Right after a merge, the panel's stale cache showed the just-merged slices as still pending — Philipp read it as commits appearing on a new branch and called for an investigation (verdict: display artifact, nothing moved). Merged slices must flip to a merged state immediately; bust the cache on promote success.

## Context you need

- The classifier fix is live (my commit 8c3853f on dev): annotation-declared guards now register from both suites, so the false "No test guards this AC" cards are gone; the overlay's remaining job is the genuinely-unguarded case your S356–S359 address.
- Slices 350-ac-3 and 350-ac-4 now have real CI guards; all 13 ACs of the last batch resolved before the merge.
- Your S353 amendment (frozen-local-ref) is untouched by these rulings — your call as before.

## What NOT to worry about

- No changes to the AC hard rule (no editing ACs to go green; halt + escalate) or to the promote gate as the final backstop.
- Nothing here asks you to undo the merge or touch S350/351/352 — they're on main, green, and correctly so.
- Dax owns responding on Model A when Philipp opens that talk-through; you only need to not build on it.

— Bashir

---
**O'Brien 2026-09-01 (rulings applied):** S360 branch gate PARKED (register: SLICE_PARKED_BEFORE_APPROVAL, file in trash). S356-S359 re-framed inside the sequential flow with Model A marked parked. New: S361 merge lock (server refuses), S362 post-merge display truth, S363 Julian step visible. Slice number 360 retired, not reused.

# Design rollback for the GitHub-CI merge model

**From:** Bashir (QA)
**To:** Worf (DevOps / Release Engineering — owns rollout/rollback per `docs/FEATURES.md`)
**CC:** Dax (Architect — this needs an ADR)
**Date:** 2026-06-13
**Why:** Philipp asked for a rollback e2e test ("merge to main, then roll back immediately — does it work?"). There is **nothing to test yet** — rollback is not implemented in the live model. QA won't fake a green test for a feature that doesn't exist. This is the design ask that has to come first.

---

## What exists today (verified 2026-06-13)

- **No rollback anywhere in the live path:** no `/api/rollback` or revert endpoint in `dashboard/server.js`, no rollback control in `lcars-dashboard.html`, no rollback step in `.github/workflows/promote.yml` (it is fast-forward-only), no `scripts/` rollback.
- The only `git reset --hard` rollback ever written lives in the **retired** local-merge gate (`bridge/orchestrator.js:~6923`), explicitly "now unreachable, kept for history."
- `docs/adr/0001` mentions "Rollback = revert the merge commit on main" but predates the GitHub-CI model and is a concept, not an implementation.
- `docs/FEATURES.md` lists rollback as **Worf-owned, "nobody owns this holistically yet."**

## Why it's non-trivial here (the core constraint)

`main` is **fast-forward-only** from `dev` (`promote.yml` ff's `origin/main` to a tested `dev` SHA). Consequence:

> If you roll `main` back but leave `dev` ahead, the **next promote fast-forwards the bad commit straight back in.**

So any real rollback must keep `dev` and `main` consistent. That rules out the naive "reset `main` + force-push" — it rewrites history, breaks anyone synced, and trips the force-push detector in `bridge/state-doctor.js` (runbook F10).

## Recommended design (my QA-side proposal — yours to ratify)

**Rollback = a `git revert` commit on `dev`, promoted through the existing gate.**

1. Operator picks a merged slice to roll back (a gesture on Ops, like RUN GATE).
2. The system creates a `git revert` commit on `dev` (inverse of the slice's squashed change).
3. That revert goes through `promote.yml` like anything else: the regression suite re-runs on a clean runner, then `main` fast-forwards to the reverted state.

Why this fits: `main` stays ff-only; the gate stays in the loop (**even the rollback is tested before it reaches main**); fully auditable (a real commit, no history rewrite); no force-push; reuses machinery that already exists. Rollback may need **almost no new infrastructure** — mainly the "revert this slice" gesture + the revert-commit creation.

## Open design questions for the ADR (Dax)

- Revert-through-gate (above) vs revert/reset directly on `main` (breaks ff-only) — confirm the former.
- Who can trigger it, and is it time-boxed ("immediately after merge") or available for any past slice?
- Multi-slice rollback: revert a range, or one slice at a time? Conflict handling when later slices touched the same files.
- Does the rollback revert commit itself need Nog review, or does it bypass (it's mechanical)?
- UI: a "Roll back" affordance on a History row, or on the Branch Topology panel?

## What QA will do once it's built

I'll author the rollback e2e the same faithful way as `e2e/pipeline-lifecycle.spec.js`: drive the revert gesture in a real browser, simulate the revert-commit + re-promote per the agreed contract (no real force-push, no real merge), and assert `main` ends at the pre-slice state with the gate having run. I can also pre-write it as a **pending/red spec** the moment the contract is agreed, so it's ready and red until the feature lands — just say the word.

— Bashir

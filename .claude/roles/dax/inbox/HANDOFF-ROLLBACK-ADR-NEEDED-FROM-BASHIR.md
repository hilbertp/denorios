# Rollback needs an ADR (pointer)

**From:** Bashir (QA)
**To:** Dax (Architect)
**Date:** 2026-06-13

Philipp wants rollback for the GitHub-CI merge model ("merge to main, then roll back immediately"). It isn't built, and QA won't fake a test for a missing feature. The full ask + my proposed design is in **Worf's inbox**: `.claude/roles/worf/inbox/HANDOFF-DESIGN-ROLLBACK-FROM-BASHIR.md` (Worf owns rollout/rollback per `docs/FEATURES.md`).

**The architecture decision that needs you:** `main` is fast-forward-only from `dev`, so rolling back `main` alone is futile — the next promote ff's the bad commit back. My recommendation is **rollback = a `git revert` commit on `dev`, re-promoted through the existing gate** (main stays ff-only, the gate re-tests the revert before it lands, no force-push). Please confirm that vs reverting/resetting `main` directly, and rule on the open questions in the Worf handoff. Once the contract is set, I'll author the rollback e2e (or pre-write it as a pending/red spec).

— Bashir

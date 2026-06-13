# Consult — dev reconciliation strategy before gate-flow turn-on

**From:** Worf (DevOps)
**To:** Dax (Architect)
**Date:** 2026-05-21
**Re:** O'Brien's `HANDOFF-gate-flow-turnon-FROM-OBRIEN-TO-WORF.md` step 1 (you're named as sign-off)

---

## The ask (one decision)

O'Brien's turn-on handoff makes you sign-off on how I reconcile `dev` before flipping `DS9_USE_GATE_FLOW=1`. Confirm the strategy below or redirect.

## Verified git state (2026-05-21)

- `dev` is **61 commits behind main, 0 commits ahead**. Verified: `git rev-list --count main..dev` = 0.
- `dev` tip is `d7d2100` (slice 260, 2026-04-28). Everything on dev is already in main's history.
- `branch-state.json` dev section is stale (`tip_sha: null`, `commits_ahead_of_main: 0`).
- Gate has never run (`gate.status: IDLE`, `last_pass/last_failure: null`).

## Proposed strategy

`git branch -f dev main` (+ `git push origin dev`) — make `dev` exactly equal current main as the new gate-flow base. Then refresh `branch-state.json`'s dev section from git reality (via `reconcileBranchState` or orchestrator restart recovery scan).

Because dev has 0 unique commits, this force-update **loses nothing** — there is no work on dev that isn't already on main. The operation is also reversible (dev can be re-pointed).

## What I need from you

A yes/no on the force-update + base-reset strategy. If yes, I proceed with the full turn-on (reconcile → branch-state refresh → flag flip → smoke test). If you want a different reconciliation shape (e.g., a fresh `dev` branched explicitly, or a tag on the old dev tip first), name it.

## What I'm NOT asking

- Whether to turn on the gate flow at all — O'Brien's handoff treats that as Philipp-greenlit.
- The smoke-test sequence — that's operational (mine).
- The non-gate Nog→merge tail gap — separate item, my call on priority.

— Worf

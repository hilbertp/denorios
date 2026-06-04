# ADR — GitHub-CI Merge Model (dev → main via Actions, auto-merge on green)

**Status:** Accepted (2026-06-04). Ratified by Garak acting as Dax + Worf + O'Brien under
Philipp's full-authority grant.
**Supersedes:** the local Bashir gate / `mergeDevToMain` ceremony (`BRANCHING-FOR-BASHIR-GATE-ADR`).

---

## Context

The dev→main merge was a **hand-rolled local CI**: the orchestrator ran the regression
suite at merge-time on Philipp's FUSE-mounted box, then did its own `git checkout main` /
`merge` / `push`. Bringing it up (2026-06-04) showed why that shape is fragile — plain
`git checkout` is unreliable on the FUSE mount; the gate writes *tracked* runtime state
(`bashir-heartbeat.json`) that then blocks its own checkout; `dev` drifted between local
and GitHub. These are symptoms of reinventing CI locally. The fix is to use **real CI**.

## Decision

`dev` and `main` are both first-class GitHub branches. **GitHub Actions is the regression
gate.** Merge to `main` is automatic on green.

**Locked choices (Philipp, 2026-06-04):**
1. **CI platform:** GitHub Actions.
2. **Bashir authoring:** local (`claude -p`) → commits tests to `dev`. CI is a dumb
   test-runner — no LLM, no OAuth secret on runners.
3. **Merge trigger:** auto-merge on green (no human gate before main).

## Pipeline

```
Garak / Rom implement → Nog reviews → push to origin/dev
   → Bashir (local): regression-risk + author/extend tests → push to origin/dev
   → GitHub Actions runs the full suite (required check)
   → green → dev→main PR auto-merges → origin/main
```

Two gates: Nog = "is the code good?" (slice→dev); CI = "do all tests pass?" (dev→main).

## What changes

- **Retired:** `mergeDevToMain`, the local suite-at-gate-time, `startGate`'s FUSE checkout.
- **Kept:** Nog code review, Bashir as regression authority + RR, orchestrator dispatch.
- **Moved to CI:** test execution + the merge gate.
- **New orchestrator job:** push slices to `origin/dev`; invoke Bashir locally to author +
  push tests; open the standing `dev→main` PR; surface CI status. No local merging.

## Migration sequence (ordering matters)

1. Ratify (this doc). ✅
2. CI workflow (`.github/workflows/ci.yml`) — additive, harmless until required. ✅ (in progress)
3. **Suite-health pass** — make the full suite green on a clean runner. Precondition for arming.
4. Realign `origin/dev` → `main`.
5. **Orchestrator rework** — push-to-dev, retire `mergeDevToMain`, Bashir-author-then-push, Ops reads CI.
6. **Arm last:** branch-protect `main` (require the CI check) + auto-merge the standing `dev→main` PR.

**#6 only after #5** — arming protection while the orchestrator still local-merges would
make its `git push origin main` get rejected and break the flow.

## Consequences

Good: no FUSE checkout pain (Linux runners); standard, auditable, reversible merges; no
dev/main drift; the brittle merge machinery is deleted, not maintained. Trade-offs: the
full suite must be green before arming; the Ops dashboard must read GitHub checks instead
of local `branch-state.gate`; auto-merge removes the pre-main human gate (by choice).

## Open items

- Keep Nog as the slice→dev gate (recommended).
- Bashir trigger cadence: per dev-push vs batched (recommend: dev push → Bashir → push → CI).
- Cosmetic gate bugs (`slices undefined..undefined`, `bashir-heartbeat.json` tracking) die
  with the local merge path.

---
*Operational companion: `docs/runbooks/RUNBOOK-PUSH-AND-MERGE.md`.*

# ADR — Rollback Model (revert-forward through the gate)

**Status:** Accepted (ratified 2026-06-13 by Philipp's direct build order; implemented
by O'Brien the same day). Originally proposed by Dax / Architect.
**Decides:** the open questions in Bashir's `HANDOFF-DESIGN-ROLLBACK-FROM-BASHIR.md`.
**Builds on:** `ADR-GITHUB-CI-MERGE-MODEL.md` (dev = staging, main = prod, ff-only,
operator-gated promotion). This ADR adds the inverse operation; it changes nothing
about how things go *forward*.
**Owners:** O'Brien built it (Philipp assigned the build directly rather than to Worf
as originally proposed); Bashir authors the browser e2e; Dax owns this contract.

> **Implementation note (O'Brien, 2026-06-13).** Built and gated green. One correction
> to this ADR's wording: the slice→commit map is **not** the History row's
> `squash_sha` field (recent dev commits are prose, not `slice/N` subjects — there was
> no such field). The authoritative map is the register's `SLICE_SQUASHED_TO_DEV`
> event (`squash_sha`); the server now surfaces it onto history rows. Two other
> hardening choices beyond the rough scope: the revert is built in an **isolated,
> throwaway git worktree** (the live working tree is perpetually dirty with
> register/state churn, so requiring a clean tree was a non-starter), and a conflicted
> rollback writes a `rollback-conflict` register event for the operator but does **not**
> auto-create a queue brief (that would auto-dispatch Rom, which is operator-gated).
> See `dashboard/server.js` (`createRevertCommit`, `/api/rollback/dispatch`,
> `/api/rollback/preview`) and `regression/gate-merge/j-rollback-revert-forward.test.js`.

---

## Context

Philipp asked for rollback ("merge to main, then roll back immediately — does it
work?"). It does not exist today: no endpoint, no UI, no `promote.yml` path, no script.
The only `git reset --hard` ever written lives in the **retired, unreachable**
local-merge body (`bridge/orchestrator.js`, kept for history) — it is not a feature.

The hard constraint is the merge model itself:

> `main` is **fast-forward-only** from `dev`. `promote.yml` refuses any SHA that isn't a
> fast-forward of `origin/main` (`git merge-base --is-ancestor` check). `main` has branch
> protection: linear history, no force-push.

**The invariant the whole system rests on:** `main` is always an ancestor of `dev`
(dev is ahead-or-equal). Verified true today: dev is 5 commits ahead, main is an ancestor.
Every operation — including rollback — must preserve this.

## The decision

**Rollback is forward recovery: a `git revert` commit on `dev`, promoted through the
existing gate. We never reset, revert, or force-push `main` directly.**

The mental shift worth naming: in a fast-forward-only world you do not move backward —
you **move forward to a state that looks like the past.** "Roll back immediately" becomes
"add the inverse commit and re-promote," which is exactly how production-grade trunk
systems (revert-forward) handle it. The desktop "undo / reset to yesterday" instinct is
the one thing this model structurally forbids.

### Why reset-main-directly is not just inadvisable but incompatible

1. It requires a force-push — `main`'s branch protection (linear history, no force-push)
   rejects it, and `state-doctor.js`'s force-push detector trips (runbook F10).
2. It rewrites published history — breaks anyone synced to `main`.
3. It leaves `dev` ahead with the bad commit, so **the next promote fast-forwards the bad
   commit straight back in.** Resetting main alone is self-undoing.
4. It violates the invariant (main would no longer be an ancestor of dev), after which
   `promote.yml` refuses every future promotion until someone reconciles by hand.

### Why revert-forward fits

- `main` stays ff-only — the revert is a new forward commit; main fast-forwards to it.
- **The gate stays in the loop.** The regression suite runs against the reverted state
  *before* it reaches main. Rollback is not a safety bypass — it is tested like any
  promotion. This is the property that makes it trustworthy.
- Fully auditable — a real `revert` commit, no history rewrite; `git log` tells the story.
- Reuses the entire promote machinery. Net-new infra is small (see below).
- The invariant is preserved by construction (a revert only adds to dev).
- It is self-protecting: if a rollback ever produced a non-ff state, `promote.yml` would
  refuse and `main` would simply stay untouched. The gate cannot be tricked into a bad ff.

## Answers to Bashir's open questions

**Q1 — revert-through-gate vs reset/revert main directly?**
Ratify **revert-through-gate**. Reset-main-directly is rejected (reasons above).

**Q2 — Who triggers it; time-boxed or any past slice?**
Same authority as promotion: **operator-gated, Philipp, from Ops.** Never automatic —
auto-rollback would violate the "operator decides *when*" principle the merge model is
built on, and we have no post-merge monitoring to trigger it from anyway.
**Not time-boxed** to "immediately after merge." The real constraint is not time, it is
*conflict* — an old slice is rollback-able as long as it reverts cleanly. So: the gesture
is offered for any merged slice, and the conflict case (Q3) is what bounds it, not a clock.

**Q3 — Multi-slice; conflict handling?**
Unit of rollback = **one slice = one commit** (squash gives us exactly one commit per
slice — clean mapping; the History row already carries `squash_sha`). v1: one slice at a
time; undo several by doing several. Ranges (a sequence of revert commits, newest-first)
are a v2 nicety, not v1.
**Conflict handling is the crux and must be explicit.** If a later slice touched the same
lines, `git revert` conflicts. The system must **never auto-resolve or force it.** On
conflict: abort the revert cleanly, surface *"slice N can't be auto-rolled-back — slice M
changed the same code; needs a forward-fix,"* and route it as a normal brief to
O'Brien/Rom. The automated path owns the clean case; the messy case degrades to a normal
human-authored fix slice through the full pipeline. Automated rollback stays safe and
honest by refusing to be clever.

**Q4 — Does the revert commit need Nog review, or bypass?**
A **clean, machine-generated revert bypasses Nog but never bypasses the gate.** Nog asks
"is this code good?"; a pure inverse of an already-reviewed change adds little there. The
safety that matters for rollback is the **regression gate**, and that always runs (it *is*
`promote.yml`). Caveat: a **conflicted revert that a human resolved is no longer
mechanical** → it goes through the full pipeline (Nog + gate) like any slice. So:
clean revert → gate yes / Nog no; conflicted-and-resolved revert → Nog + gate.

**Q5 — UI: History row or Branch Topology panel?**
**Both surfaces, one action.** Trigger is a **"Roll back" affordance on the History row**
of the slice you're undoing — that's where you are when you decide it was bad, and the row
already holds the SHA. The **Branch Topology panel** (which already hosts RUN GATE & MERGE
TO MAIN + the RR score) is where the in-flight rollback *shows up* — because mechanically a
rollback **is** a promote dispatch, so the same CI strip, gate-running state, and
`gate_already_running` mutex apply. You cannot promote and roll back at once; the existing
409 guard covers it for free.

## The one real gotcha (flagged, not hidden)

Promotion always fast-forwards `main` to **dev HEAD**, not to a cherry-picked commit. So
if `main` is at slice X, and `dev` has since moved on with un-promoted slices Y and Z, then
"roll back X" = add revert-of-X on dev + promote = main fast-forwards past **revert-X *and*
Y and Z.** Rolling back X silently also ships Y and Z.

This is an honest consequence of the ff-only model, not a bug. The mitigations:
- The RR score and Branch Topology must show **exactly what will move to main** when the
  operator triggers a rollback (revert-X + any pending dev commits), so there is no
  surprise — the operator sees Y and Z in the diff before clicking.
- If the operator wants *only* X gone and Y/Z to stay back, that is a different request and
  out of v1 scope (it would need promotion-to-a-specific-SHA, which the model does not do).
- In the common "merge to main, then roll back immediately" case Philipp described, dev and
  main are level, so there is nothing pending and this gotcha does not arise.

## What gets built (rough scope, for Worf)

Almost no new infrastructure — the value is in reusing promote:
1. **Revert-commit creation** on dev: `git revert --no-edit <squash_sha>` (clean-only;
   on conflict → `git revert --abort` + route a forward-fix brief). Pushes `origin/dev`.
2. **A "Roll back" gesture** on the History row → new endpoint
   (`POST /api/rollback/dispatch` or fold into the slice action) that creates the revert
   commit, then dispatches `promote.yml` exactly like `/api/promote/dispatch` (same 409
   mutex, same CI strip).
3. **RR/Topology** to render "what will move" including the revert + pending commits.
No change to `promote.yml` itself — it already does the right thing.

## Consequences

Good: rollback is tested before it lands; auditable; no force-push; no history rewrite;
the invariant is preserved by construction; small surface area. Trade-offs: rollback ships
whatever else is pending on dev (the gotcha above); old-slice rollback can require a
human forward-fix when later slices conflict; a clean revert skips code review by design.

## Sequence after ratification

1. ~~Philipp ratifies (flip Status → Accepted).~~ ✅ 2026-06-13.
2. ~~Build the gesture + revert-commit creation + endpoint.~~ ✅ O'Brien, 2026-06-13.
   `createRevertCommit` (isolated-worktree revert), `POST /api/rollback/dispatch`,
   `GET /api/rollback/preview`, `squash_sha`/`onMain` on history rows, a "Roll back"
   affordance on the History row + confirm dialog showing "what moves," all wired into
   the existing promote CI strip. Backend pinned by `j-rollback-revert-forward.test.js`
   (6 ACs, gate-green). **Not yet exercised against the live repo — Philipp presses the
   gate; O'Brien did not promote.**
3. Bashir authors the e2e the faithful way (drive the gesture in a real browser, simulate
   revert-commit + re-promote per this contract, assert `main` ends at the pre-slice state
   with the gate having run). The contract is now stable + the backend live, so he can
   author it for real (not just red).

---
*Companion: `ADR-GITHUB-CI-MERGE-MODEL.md`, `docs/runbooks/RUNBOOK-PUSH-AND-MERGE.md`.*

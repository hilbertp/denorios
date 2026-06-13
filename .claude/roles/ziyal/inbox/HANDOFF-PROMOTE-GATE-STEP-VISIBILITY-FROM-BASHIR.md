# Surface the promote gate's step-level progress (regression → e2e → ff)

**From:** Bashir (QA)
**To:** Ziyal (UX) — dashboard owner
**CC:** O'Brien (sequencing), Rom (impl)
**Date:** 2026-06-13
**Trigger:** Philipp pressed RUN GATE & MERGE TO MAIN and said *"I did not see the regression test run before promotion!"* It DID run — this is a visibility gap, not a correctness bug.

---

## What's wrong (UX, not logic)

When the operator runs the gate, the dashboard shows:
- **REGRESSION row:** "passing · run #36 · 8m ago" — this is the SEPARATE per-push `ci.yml` run, NOT the regression step inside the promote gate. It's stale and unrelated to the promotion in flight.
- **PROMOTE row:** "gate running — full suite on a clean runner" — true, but it treats the promote job as one opaque blob.

So the gate's own regression pass runs **invisibly**, and the operator is staring at a stale run that looks like it already finished. It reads as "promotion happened without regression running," which understandably alarms.

## What's actually true (verified, the gate is correct)

The promote run for `bc162ac` ran these steps in order, all green, before main moved:
```
✓ Run regression gate (fast node:test suite)
✓ Run browser e2e gate (Playwright click-paths)
✓ Fast-forward main to the tested commit
```
`origin/main` is now `bc162ac`. promote.yml runs regression → e2e → ff in one job; the ff only runs on all-green (locked by regression test j-merge-button-pass ac-13).

## The ask

Surface the promote run's **step-level progress, live**, so the operator SEES the gate work:

> PROMOTE · `bc162ac` — regression ✓ → e2e ⟳ → fast-forward ⏳

The data is already available from GitHub — no new backend logic, just expose it:
```
gh run view <promote_run_id> --json jobs   # → .jobs[].steps[] { name, status, conclusion }
```
The dashboard already fetches the promote run (`gh.promote_run`); add the steps array to that payload and render the three gate phases (regression / e2e / fast-forward) as live ticks. While the gate runs, the REGRESSION row should reflect THIS gate's regression step — or be visually distinguished from the per-push `ci.yml` run so the two are never confused.

## Minor, while you're in there

The REGRESSION row reads "…· 8m ago **ago**" (double word) — small text bug in the relative-time render.

## What QA will do once it's built

I'll add the e2e coverage: a promote run with a stubbed `jobs.steps` payload, asserting the dashboard renders regression → e2e → ff phases and that the in-gate regression step is distinct from the per-push run. (Can't test it before it exists — same discipline as rollback.)

— Bashir

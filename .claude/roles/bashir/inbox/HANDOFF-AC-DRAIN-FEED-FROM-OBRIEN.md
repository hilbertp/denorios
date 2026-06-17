# The new-AC drain feed is live — it's yours to run

**From:** O'Brien (Tech Lead)
**To:** Bashir (Julian, QA Engineer)
**Date:** 2026-06-17
**Scope:** ADR-AC-RECONCILE — the AC → test-update triage loop (advisory v1, on dev @ `0fbfcdd`)

---

## Why this exists

ADR-AC-RECONCILE is built and on dev. The piece that's now *yours*: every acceptance criterion O'Brien commissions through a slice must reach you, and you decide which ones change the regression suite. I built the plumbing — capture, surface, drain. **You own the triage and the test decisions.** Philipp's framing: "O'Brien dumps the ACs; Julian drains and does the rest."

## What I'm asking for

Run the drain loop as the standing QA step whenever you run the regression / merge pipeline. Nothing to fix right now — the feed is empty (baseline drained). This is you taking ownership of the loop going forward.

## Context — the mechanism (start fresh)

**Where new ACs appear:** `.claude/roles/bashir/inbox/NEW-ACS.md`. Regenerated **every pipeline/gate run** by `scripts/ac-reconcile.js` (already wired into `promote.yml`). It lists only the ACs **commissioned or changed since your last drain**, each tagged `NEW`/`CHANGED` with its coverage status (`MISSING`/`STALE`/`COVERED`), the AC text, and the slice id. (Generated + gitignored — don't commit it.)

**How an AC gets there:** O'Brien authors it as a tagged `- slice-<id>-ac-<k>: <text>` line in a slice's `## Acceptance criteria` block → it flows into `regression/AC-MANIFEST.lock` (the integrity test forces the lock current at commit, so commissioned ACs are always captured) → the feed diffs the manifest against your drained ledger `regression/AC-DRAINED.json` (tracked).

**Your loop, every run:**
1. `node scripts/ac-reconcile.js` (or just run the pipeline — the gate runs it) → read `NEW-ACS.md`.
2. For each AC, decide:
   - **Deliberately changes existing behaviour?** → update/add the guard test and re-embed its `// @ac-hash: <tag> sha256:<hex>` annotation, then `node scripts/build-coverage-map.js`. That IS the test update — the Test-Update Gate audits it (an `acHash` change with no `AC-Change-OK` + `Spec-Owner` trailer is flagged).
   - **New behaviour, no guard (`MISSING`)?** → write the test.
   - **Doesn't change the suite?** → no test change; it just drains.
3. `node scripts/ac-reconcile.js --drain` → advances `AC-DRAINED.json` and clears the feed. **Commit the ledger.** An AC whose text later changes re-surfaces automatically (its hash changes).

**Current state:** baseline drained (139 tags, all grandfathered-legacy), **0 new ACs** right now. The machinery is ready; it lights up the next time O'Brien commissions a slice with tagged ACs. Verified end-to-end (a commissioned AC surfaced to this inbox, then drained clean). Contract: `docs/contracts/ac-custody.md`. Tests: `regression/gate-merge/j-ac-drain-feed.test.js` (slice-99830).

## What NOT to worry about

- **Never edit an AC to go green** (the hard ruling). If a test can't pass without contradicting its AC → HALT and escalate to Philipp. Reconcile updates a TEST from an AC, never the reverse.
- **Legacy (unhashed) tags never enter the feed** — they're the separate grandfathered backfill (hand-author AC text from brief *intent*, never DONE reports, Nog-reviewed). Not your day-to-day drain.
- **It's advisory** — nothing blocks a promote yet. Philipp flips `AC_CUSTODY_ENFORCE=1` to make undeclared AC mutations / unresolved MISSING-STALE RED-blocking. Until then, drain as the discipline, not the gate.
- You don't author ACs and you don't run the manifest deriver as a chore — O'Brien + the integrity test keep the manifest current. You consume the feed.

— O'Brien

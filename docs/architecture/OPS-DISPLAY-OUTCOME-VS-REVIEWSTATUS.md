# Decision: Ops Dashboard — `outcome` vs `reviewStatus` as Display Driver

**Date:** 2026-04-13  
**Decided by:** O'Brien (not escalated to Dax — Philipp gave the option, O'Brien owned it)  
**Context:** Philipp observed that many accepted briefs display as DONE in the Ops Center completed table. Investigation traced the root cause to a mismatch between where the fix was proposed and what the code was designed to do. Philipp challenged the initial primitive fix proposal; O'Brien reconsidered, wrote this record, and made a defensible architecture call.

---

## Background

The server.js `/api/status` endpoint computes two separate fields for each completed brief:

- **`outcome`** — O'Brien's execution result: `DONE` (succeeded) or `ERROR` (failed). Set from the register's DONE/ERROR event.
- **`reviewStatus`** — Evaluator/Philipp's verdict: `'accepted'`, `'amendment_required'`, or `'waiting_for_review'`. Derived from REVIEW_RECEIVED/REVIEWED and ACCEPTED events.

There is also **`finalOutcome`**, which currently upgrades `ERROR → ACCEPTED` when the brief is in the acceptedSet. Its comment reads:

> "ACCEPTED after an ERROR means Philipp overrode the watcher rejection"

This was designed specifically for the case where O'Brien failed but Philipp manually accepted the brief anyway. It is not a general display mechanism.

---

## The Bug

The dashboard pill is driven by `finalOutcome` (i.e., `outcome`). For normal-flow briefs (`DONE → evaluated → ACCEPTED`), `finalOutcome` stays `'DONE'` because the ERROR guard prevents the upgrade. These briefs show as DONE in the UI even though `reviewStatus` is correctly `'accepted'`.

---

## Option Considered and Rejected: Remove the `ERROR &&` Guard in server.js

Removing the guard so that `DONE → ACCEPTED` is also upgraded in `finalOutcome` would fix the display but at a cost:

1. **Loses semantic distinction.** `outcome` is the execution result — whether O'Brien succeeded or failed. This is distinct from the review verdict. Merging them at the data layer means a downstream consumer can no longer tell whether O'Brien actually succeeded. This matters for debugging, T&T analysis, and future tooling.
2. **Expands a narrow fix beyond its intent.** The ERROR guard was deliberate. The comment documents why. Widening it silently changes the contract of `finalOutcome` without updating the semantics.
3. **The data is already correct.** `reviewStatus` is computed correctly for all cases. The problem is purely in what the display reads.

---

## Decision: Fix in Dashboard HTML, Not server.js

The `reviewStatus` field already carries the right information. The pill in the completed table should be driven by `reviewStatus` when a verdict exists, falling back to `outcome` when no review has been issued yet.

**Rule:**
- `reviewStatus === 'accepted'` → show ACCEPTED pill (regardless of outcome)
- `reviewStatus === 'amendment_required'` → show AMENDMENT REQUIRED pill
- Otherwise → show `outcome` (DONE or ERROR)

This keeps server.js semantics clean (`outcome` = execution, `reviewStatus` = review), requires no server-side changes, and correctly handles all cases including the ERROR-then-accepted override path (which also has `reviewStatus === 'accepted'`).

---

## Consequences

- The `finalOutcome` ERROR→ACCEPTED logic in server.js is left unchanged. It is harmless and provides a redundant data signal but is no longer the display driver for the accepted case.
- If `reviewStatus` is ever extended with new verdicts, the dashboard pill logic is the single place to update.
- The brief for this fix targets `dashboard/lcars-dashboard.html` only. No server.js changes.

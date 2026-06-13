# ~~Spike S0~~ → Resolved — Evaluation Loop Architecture

**From:** Dax (Architect)
**To:** Sisko (Product Manager)
**Date:** 2026-04-08
**Scope:** Bet 2 — Contributor-facing relay & dashboard

---

## Status: RESOLVED — no spike needed

This was originally scoped as a feasibility spike. Through conversation with Sisko, all open questions were resolved architecturally:

### Evaluation mechanism
Evaluation runs via `claude -p` from the relay, same infrastructure as O'Brien. No Cowork cron job. No notifications to Philipp. Cold context per invocation (commission ACs + DONE report as input). Evaluation quality handled through iteration — if quality is off, enrich the prompt or tighten ACs.

### Amendment loop mitigation
Hard cap at 5 failed amendment cycles (`maxAmendments: 5` in `bridge.config.json`). After 5 failures, the evaluation service escalates: reassesses whether ACs still make sense in light of evidence from failed attempts, writes a STUCK event to the register with a reassessment note. Dashboard shows STUCK. Philipp intervenes.

### O'Brien in Cowork
Read-only on pipeline status. Reads `register.jsonl` on demand when Philipp asks. Does not run evaluation herself. Usability handled through review and iteration.

### Value risk
Resolved. The product's core value is workflow automation and transparency. Contributors advance the feature set. Not a risk — the reason the product exists.

---

## What happens next

No spikes. Straight to build slices. See architecture doc Section 10 for the four-slice plan.

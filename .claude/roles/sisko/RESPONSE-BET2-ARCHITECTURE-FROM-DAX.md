# Bet 2 Architecture — Dax's Recommendation

**From:** Dax (Architect)
**To:** Sisko (Product Manager)
**Date:** 2026-04-08
**Scope:** Bet 2 — Contributor-facing relay & dashboard

---

## Why this exists

Sisko placed two handoffs in Dax's inbox: `HANDOFF-RELAY-SERVICE.md` (architecture questions) and `HANDOFF-BET2-REQUIREMENTS.md` (product requirements). This is the response.

---

## The recommendation in one paragraph

Wrap the existing file-queue bridge in a Docker container. Don't replace it. One Node.js process runs both the watcher and a dashboard HTTP server. `docker compose up` starts everything. The dashboard is a single HTML file with five elements — enough for a stranger to see the pipeline working. The file queue remains the source of truth. O'Brien writes files, the watcher detects them, `claude -p` invokes O'Brien inside the container. No new protocols, no new languages, no build step.

---

## Full architecture document

`docs/architecture/BET2-RELAY-DASHBOARD-ARCHITECTURE.md`

Covers all five deliverables requested:
1. Relay service design (Sections 1-3)
2. Dashboard spec (Section 4)
3. Migration path (Section 6)
4. Repo topology (Section 5)
5. Risk assessment (Section 7)

Also includes preliminary answers to Ziyal's Bet 3 architecture questions (Section 9) and a commission slicing recommendation for O'Brien (Section 10).

---

## FINAL — Evaluation runs from the relay, no spikes, straight to build

**Evaluation model:** The relay invokes evaluation via `claude -p` — same pattern as O'Brien. Cold context, cheap, targeted. Result goes to `register.jsonl`. If amendment needed, a new PENDING commission is written automatically. O'Brien in Cowork reads the register on demand when Philipp asks. No Cowork cron job, no notifications, no context window bloat.

**Amendment loop:** Hard cap at 5 failed cycles. After 5, the evaluation service reassesses whether ACs still make sense given the evidence, writes STUCK to the register. Dashboard shows it. Philipp intervenes.

**No spikes.** Docker auth, evaluation quality, and amendment convergence are standard engineering problems. Handle during implementation. Iterate.

**Value risk resolved:** The product's core value is workflow automation and transparency. Contributors advance the feature set. Not a risk — the reason the product exists.

**Build order:** Four slices, start with B1 (unified relay server). See architecture doc Section 10.

---

**Confirmation keyword:** abra cadabra

---

## Decisions — resolved 2026-04-08

1. **Wrap vs. replace:** ✅ Wrap. File queue stays as source of truth.

2. **Single HTML file for Bet 2 dashboard:** ✅ Disposable prototype. React for Bet 3.

3. **Empty-state experience:** ✅ Demo commission with a snapshot of a completed pipeline example. See architecture doc Section 8.6.

4. **README:** ✅ Not a stakeholder decision. Implementing role writes it in Slice S4.

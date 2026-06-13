# Evaluator Implementation — Architecture Context for O'Brien

**From:** Dax (Architect)
**To:** O'Brien (Implementor)
**Date:** 2026-04-09
**Scope:** Bet 2 — B0: Relay-invoked commission evaluator

---

## Why this exists

The Cowork-based `obrien-commission-watch` scheduled task has been killed — it was creating a sandbox artifact every minute, polluting Philipp's workspace. You are building its replacement: an evaluator that runs inside `watcher.js` and handles the complete commission lifecycle autonomously.

This handoff gives you the architectural context you need to implement B0. O'Brien will write the commission with specific ACs — this document tells you WHY the design is what it is so you can make good judgment calls during implementation.

---

## What you're building

A second pass in the `watcher.js` poll loop that evaluates O'Brien's DONE reports against the original commission's acceptance criteria, then either accepts (triggering a merge) or amends (writing a new PENDING for O'Brien to fix).

**The complete autonomous cycle:**

```
O'Brien writes PENDING → you execute → DONE
  → evaluator reads COMMISSION.md (ACs) + DONE (report)
  → evaluator invokes claude -p with evaluation prompt
  → ACCEPTED? → write merge PENDING → you merge → done
  → AMENDMENT_NEEDED? → write amendment PENDING (same branch) → you fix → DONE → re-evaluate
  → cycle ≥ 5? → STUCK → surfaces to Philipp
```

---

## Architecture decisions you need to know

### 1. It runs inside `watcher.js`, not as a separate process

The evaluator uses the same `execFile`/`claude -p` pattern you already have for commission execution. It shares the `processing` flag — only one `claude -p` call at a time. PENDING commissions always take priority over DONE evaluations.

### 2. The COMMISSION archive file is your AC source

After you finish a commission, the watcher already renames IN_PROGRESS to `{id}-COMMISSION.md` (line 540 of current watcher.js). This archived file contains the full commission content including acceptance criteria. The evaluator reads this file — don't parse the register.

### 3. New queue states

```
Existing:  PENDING → IN_PROGRESS → DONE → COMMISSION (archive)
New:       DONE → EVALUATING → ACCEPTED  (happy path)
           DONE → EVALUATING → REVIEWED  (amendment queued)
           DONE → EVALUATING → STUCK     (cap hit, Philipp intervenes)
```

EVALUATING is a transient lock state — rename DONE to EVALUATING before invoking `claude -p`. This prevents double-evaluation if the watcher restarts mid-run.

### 4. Branch continuity is critical

Amendment commissions must tell you to continue on the **same branch**. The flow:

- Your DONE report frontmatter must include `branch: {name}` (this is a new convention — enforce it)
- The evaluator reads the branch name from the DONE report
- Amendment PENDING includes `branch: {name}` in frontmatter → you check out the existing branch, don't create a new one
- Merge PENDING includes `branch: {name}` → you merge that branch to main

If the branch name is lost, the cycle breaks. Always include it in DONE reports.

### 5. Merge commissions auto-accept

When the evaluator writes a merge PENDING and you complete it, the resulting DONE should NOT go through evaluation. Detect `type: merge` in the COMMISSION file's frontmatter and auto-accept (rename DONE → ACCEPTED, register event, no `claude -p` call).

### 6. Amendment cycle tracking

Each amendment PENDING includes `root_commission_id: {original_id}` in frontmatter. To count cycles, scan `register.jsonl` for REVIEWED events matching that root. If count ≥ 5, write STUCK instead of another amendment.

### 7. Crash recovery

Extend the existing `crashRecovery()` function to handle orphaned `-EVALUATING.md` files — rename them back to DONE so they get re-evaluated on the next poll.

### 8. CORS + HOST fix (also in B0)

In `dashboard/server.js`: add `Access-Control-Allow-Origin: *` headers to all responses, change HOST from `127.0.0.1` to `0.0.0.0` (or make it configurable via `DASHBOARD_HOST` env var). This unblocks the Lovable frontend which will call the API cross-origin.

---

## The evaluator prompt

```
You are O'Brien, Delivery Coordinator for Liberation of Bajor.

Your job: evaluate whether O'Brien's DONE report satisfies ALL acceptance criteria
in the original commission. Be specific. If even one AC is not met, the verdict
is AMENDMENT_NEEDED.

## ORIGINAL COMMISSION (contains the acceptance criteria):
{contents of {id}-COMMISSION.md}

## O'BRIEN'S DONE REPORT:
{contents of {id}-EVALUATING.md}

## AMENDMENT CYCLE: {n} of 5
## BRANCH: {branch name}

Respond with ONLY valid JSON, no other text:
{
  "verdict": "ACCEPTED" or "AMENDMENT_NEEDED",
  "reason": "One paragraph explaining your decision. Reference specific ACs.",
  "failed_criteria": ["list of specific ACs that were not met, empty if ACCEPTED"],
  "amendment_instructions": "If AMENDMENT_NEEDED: specific fix instructions per failed criterion. If ACCEPTED: empty string."
}
```

Feed this via stdin to `claude -p`, same as commission execution. Parse the JSON response. If parsing fails, treat as ERROR and re-evaluate.

---

## What NOT to worry about

- O'Brien's Cowork integration — that's separate (B4), not your problem
- Dashboard rendering of new states — that's B2, not B0
- Docker containerization — B0 ships into the existing `watcher.js` on Philipp's Mac, no Docker needed yet
- The evaluator prompt wording — start with the above, iterate if quality is poor. The amendment cap prevents runaway loops regardless

---

## Reference files

- Full ADR: `repo/.claude/roles/obrien/RESPONSE-EVALUATOR-ARCHITECTURE-FROM-DAX.md` (complete design with register event timeline example)
- Current watcher: `repo/bridge/watcher.js` (945 lines — read it, especially `invokeOBrien`, `poll`, `crashRecovery`, `registerEvent`)
- Current server: `repo/dashboard/server.js` (137 lines — the CORS fix target)
- Architecture doc: `repo/docs/architecture/BET2-RELAY-DASHBOARD-ARCHITECTURE.md` Section 10 (B0 detail)

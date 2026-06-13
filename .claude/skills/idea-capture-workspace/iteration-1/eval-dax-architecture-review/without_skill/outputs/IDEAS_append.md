# Plugin System for Evaluation Criteria — Bet 3

**Captured by:** Dax (Architect)  
**Date:** 2026-04-08  
**Phase:** Emerging idea from Bet 2 architecture review  
**Bet:** 3 (post-React migration)  
**Status:** Ready for Bet 3 roadmap consideration  

---

## Problem Statement

In Bet 2, O'Brien manually evaluates reports: she reads what O'Brien produced, checks it against success criteria (explicit in the commission), and decides to accept, amend, or reject.

By Bet 3 (post-React), we'll have a dashboard. This is an opportunity to **make evaluation extensible**: different teams have different bars (security wants policy compliance, infra wants deployment readiness), and we shouldn't hard-code all of them into the core platform. External contributors should be able to plug in their own evaluation criteria.

## Solution Sketch

A **plugin system where evaluation criteria are pluggable modules**. Each plugin:
- Implements a standard interface (takes a Report, returns EvaluationResult)
- Has a name, description, and scoring logic
- Runs in the dashboard (Bet 3, React)
- Can be discovered from a registry or local directory
- Aggregates into a recommendation for O'Brien (e.g., "4 out of 5 criteria passed")

Example plugin interface:

```typescript
export interface EvaluationPlugin {
  name: string;              // "code-quality-check"
  displayName: string;       // "Code Quality Criteria"
  description: string;       // Human-readable goal
  
  evaluate(report: Report): EvaluationResult;
}

export interface EvaluationResult {
  passed: boolean;           // Or 0.0–1.0 score
  feedback: string;          // Why it passed/failed
  details?: Record<string, unknown>;  // Breakdown (test coverage, linting, etc.)
}
```

Plugin discovery: `.bridge/plugins/` directory, or later an npm-style registry.

## Why This Matters

1. **Platform extensibility:** Teams can add domain-specific criteria without touching core.
2. **Composability:** Evaluation becomes modular — each plugin is independent, auditable.
3. **Audit trail:** Each report shows which plugins ran and what they decided.
4. **Eco-system potential:** Bet 3 can host a registry of community-contributed plugins.

## What Doesn't Change

- Commission format (YAML frontmatter + markdown)
- Report format
- Queue lifecycle (PENDING → IN_PROGRESS → DONE/ERROR)
- O'Brien's execution model
- O'Brien's final decision-making authority (plugins inform, human decides)

## Open Questions for Bet 3 Implementation

1. **Discovery mechanism:** NPM registry? Local directory? Both?
2. **Lifecycle:** Can plugins be reloaded without restarting the dashboard?
3. **Scoring:** Boolean (pass/fail) or numeric (aggregate scores)? Weighted scoring?
4. **Sandboxing:** Run in worker thread (safe, slower) or main React context (fast, risky)?
5. **API versioning:** How do we evolve the plugin interface without breaking existing plugins?

## Dependencies

- Bet 3: React dashboard (plugins run client-side in the UI)
- Bet 2 foundations: stable commission/report format (plugins parse reports in a fixed format)

## Non-Goals (Bet 2)

This is explicitly **not** a Bet 2 concern. Bet 2 is human evaluation only. Plugins are a Bet 3 feature for platforms scaling to multiple teams with different evaluation needs.

## Next Steps

1. Add to Bet 3 roadmap under "Evaluation & Extensibility"
2. Design the plugin interface spec once Bet 3 React dashboard exists
3. Implement 1–2 starter plugins as examples (code-quality, deployment-readiness)
4. Plan registry/discovery in parallel

---

**This idea emerged organically during Dax's Bet 2 architecture review and should be revisited in the Bet 3 planning phase.**


# Dax's Bet 2 Architecture Review — 2026-04-08

## Review Process

I reviewed the Bet 2 architecture as documented in `Architecture — Liberation of Bajor v1.md`. My approach was:

1. **Analyzed the capability map structure** — validated layer dependencies, confirmed that Layers 1–4 are sound.
2. **Examined component boundaries** — verified that O'Brien, Watcher, and O'Brien have clean responsibility domains with no bleed.
3. **Checked the design decisions** — YAML frontmatter, JSON logs, file-based state machine, async execution, all solid choices.
4. **Traced the queue lifecycle** — state transitions are atomic where required; crash recovery is well-specified.
5. **Evaluated cloud-readiness** — the contracts (commission format, report format, queue lifecycle) will survive a migration to cloud.

## Key Findings — Bet 2 Architecture

### Strengths

1. **Clean separation of concerns:** O'Brien writes, Watcher transports, O'Brien executes. Each component owns its domain with no overlap. The filesystem is the single source of truth. This is durable.

2. **Format decisions are right:** YAML frontmatter + markdown body gives us structured metadata that's parseable in 10 lines of code, while keeping files human-readable. No dependencies, no friction. Commission writers (O'Brien) aren't fighting JSON escaping or YAML nesting.

3. **State machine is correct:** Filename = state is an elegant design. `ls .bridge/queue/` tells you everything. No database, no separate state file. Atomic rename for PENDING → IN_PROGRESS, careful two-step for the terminal states. Crash recovery is thoughtful.

4. **Configuration and logging are operational-minded:** The watcher can be tuned from a config file. JSON lines logging is both human- and machine-readable. Heartbeat file gives O'Brien and Philipp a live health pulse. Good infrastructure thinking.

5. **Zero dependencies and async execution:** The watcher stays responsive during commission processing. No npm supply chain risk. This will scale locally and cloud migration is unblocked.

### Minor Clarifications (Not Issues)

1. **Amendment chain format (Q1):** The doc leaves this open for O'Brien. I'd recommend just the direct parent ID (`references: "003"`) in v1. Full ancestry is nice-to-have for traceability but adds parsing complexity. Keep it simple.

2. **Commission complexity ceiling (Q3):** If context gets large, commissions can reference files instead of inlining. The doc alludes to this but doesn't formalize it. Worth a quick note in the contracts layer.

## Architecture Review Conclusion

**The Bet 2 architecture is sound.** It's local-first but doesn't block cloud. It's simple but not naive. The layer dependencies flow correctly. The component boundaries are clean. There are no architectural risks I can identify.

---

## Emerging Idea — Plugin System for Bet 3

This is a thought that emerged during review. It's **not relevant to Bet 2 at all** and should be captured for platform roadmap consideration in Bet 3.

### The Idea: Pluggable Evaluation Criteria

**Context:** In Bet 2, O'Brien manually reads O'Brien's report and decides: accepted, amended, or rejected. This is right for v1 — human judgment.

In Bet 3, when we move to React, we could introduce a **plugin system where external contributors write their own evaluation criteria as pluggable modules**. Think of it like this:

```typescript
// Example: A contributor writes a plugin that auto-evaluates code quality
export default {
  name: "code-quality-evaluator",
  displayName: "Code Quality Criteria",
  description: "Checks for test coverage, linting, documentation",
  
  evaluate(report: Report): EvaluationResult {
    const testCoverage = parseReportField(report, "test-coverage");
    const lintingPassed = parseReportField(report, "linting");
    // ... custom logic
    
    return {
      passed: testCoverage >= 80 && lintingPassed,
      score: 0.85,
      feedback: "Good coverage, one linting issue in file X"
    };
  }
};
```

O'Brien's dashboard (React, Bet 3) would:
1. Discover plugins from a plugin registry or local directory
2. Run all registered plugins against each completed report
3. Aggregate their scores/feedback
4. Show O'Brien a recommendation ("3 out of 5 criteria passed")
5. Let O'Brien override if she disagrees

### Why This Matters

**For Bet 3 platform extensibility:**
- Different teams may have different evaluation bar (security team wants security checks, infra team wants deployment readiness, etc.)
- Contributors can add domain-specific criteria without touching Liberation's core
- Evaluation becomes composable and auditable (each plugin shows its reasoning)
- Plugin interface is stable — new criteria don't change the commission/report format

**What it enables:**
- Eco-system of evaluation plugins (a package registry like npm for criteria)
- Bet 3 dashboard shows plugin status: "5 evaluation modules loaded, 4 passed"
- O'Brien can selectively enable/disable plugins per project or globally
- Audit trail: each report shows which plugins ran and what they decided

**What it doesn't change about Bet 2:**
- Commission format (YAML frontmatter + markdown) stays the same
- Report format stays the same
- Queue lifecycle unchanged
- O'Brien's execution model unchanged
- O'Brien's role as final decision-maker unchanged

### Questions for Future Consideration (Bet 3)

1. Plugin discovery: where do plugins live? NPM registry? Local `.bridge/plugins/` directory? Both?
2. Plugin lifecycle: can O'Brien reload plugins without restarting the dashboard, or is it startup-only?
3. Scoring semantics: boolean pass/fail, or numeric scores that aggregate? Both?
4. Sandboxing: do plugins run in a worker thread, or in the main React context? Security implications?

### Why Capture This Now

This idea emerged because the architecture is clean and extensible. The format decisions (YAML + markdown) and component boundaries make it obvious where a plugin system would fit. Better to note it now than to discover it later in Bet 3 and have to retrofit it.

It's not a Bet 2 concern — Bet 2 is human judgment. But it's a good long-term direction for the platform to be open to community-contributed evaluation logic.

---

## Summary

**Bet 2 is architecturally sound and ready to build.**

The idea I'm capturing is a future extensibility point (plugin system for evaluation criteria in Bet 3) that came up organically during review. It's worth documenting now because it changes nothing about Bet 2 but opens a pathway for platform growth once we have a React dashboard.

### Recommendations

1. **Proceed with Bet 2 as designed.** No architectural changes needed.
2. **Document the amendment chain format (Q1)** and commission complexity ceiling (Q3) in the contracts layer before Slice 1 ships.
3. **Capture the plugin system idea** in the platform roadmap for Bet 3 evaluation phase. Low priority, high potential value.


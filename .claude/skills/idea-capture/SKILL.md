---
name: idea-capture
description: "Capture future feature ideas to a central backlog. Every DS9 role must use this skill. When anyone — Philipp, Sisko, O'Brien, Dax, O'Brien, Ziyal, Nog, Bashir, Quark, Leeta — mentions a feature idea, improvement, or capability that doesn't belong in the current bet, log it immediately to IDEAS.md. Triggers on: 'idea for the future', 'we should eventually', 'nice to have', 'for a later bet', 'Quark could', 'future feature', 'someday we should', 'parking lot', 'backlog idea', or any phrase that describes functionality not in the active bet scope. Also triggers when reviewing work and noticing a gap that isn't currently scoped. Use this skill proactively — don't wait for someone to say 'save this idea'. If it sounds like a future capability, capture it."
---

# Idea Capture — Future Feature Backlog

This is a global team standard. Every DS9 role uses this skill inline, the moment an idea surfaces.

## Why this exists

Good ideas appear in the middle of architecture reviews, delivery planning, code reviews, and casual conversation. If they aren't written down immediately, they're lost. This skill ensures every role captures future ideas to a single, central file so Sisko can triage them later. The ideas file is the team's collective memory for what the product could become beyond the current bet.

## When to capture

Capture an idea when **all three** of these are true:

1. Someone describes a feature, capability, improvement, or workflow that doesn't exist yet
2. It's **not** in scope for the current active bet (right now: Bet 2 — Contributor-facing relay & dashboard)
3. It has enough substance to be actionable later (not just "make it better")

Watch for signal phrases — these almost always mean an idea is surfacing:

- "we should eventually..."
- "for Bet 3 / a future bet..."
- "Quark could track..." / "Nog should..."
- "nice to have would be..."
- "that's out of scope but..."
- "parking lot this..."
- "future feature idea..."
- "what if we also..."

But don't rely only on keywords. The real trigger is your judgment: if someone is describing something the product doesn't do yet and it's not in the current bet, capture it.

## How to capture

Append to `IDEAS.md` in the repo root. One idea per entry. Use this exact format:

```markdown
### {Short descriptive title}

- **Source:** {role name} ({context — e.g. "during Bet 2 architecture review", "Sisko conversation about relay"})
- **Date:** {YYYY-MM-DD}
- **Idea:** {1-3 sentences describing the idea clearly enough that someone reading it 3 months from now understands what's being proposed}
- **Why it matters:** {1 sentence on the value or problem it solves}
```

### Example

```markdown
### Quark: Automated economics dashboard

- **Source:** Sisko (during Dax architecture session, discussing timesheet automation)
- **Date:** 2026-04-08
- **Idea:** A dedicated Quark role that watches the repo, tracks every role's time/cost, computes efficiency metrics, and summarizes activity to generate its own improvement ideas.
- **Why it matters:** Currently time tracking is manual and per-role. Quark would give the team automated visibility into where AI saves time and where it doesn't.
```

## Rules

1. **Append only.** Never edit or delete existing entries. Sisko triages ideas — you just collect them.
2. **No duplicates.** Skim the existing entries before adding. If the idea is already there, skip it or add a note under the existing entry: `> Also mentioned by {role} on {date}: {additional context}`.
3. **Don't editorialize priority.** No P0/P1 labels, no "this is critical." Sisko prioritizes. You capture.
4. **Inline, not batched.** Log the idea the moment it surfaces in conversation. Don't wait until end of session.
5. **Tell the person.** After capturing, briefly acknowledge it: "Logged that to IDEAS.md" or similar. One line. Don't break flow.

## What NOT to capture

- Bugs or issues with current functionality (those go to the relevant role or issue tracker)
- Refinements to the current bet's scope (those are O'Brien's domain — discuss in the active slice)
- Vague wishes with no substance ("make it faster" isn't an idea; "add a caching layer to the relay to avoid redundant evaluations" is)
- Ideas that are already in IDEAS.md

## Creating IDEAS.md

If `IDEAS.md` doesn't exist at the repo root yet, create it with this header:

```markdown
# Ideas Backlog

*Future feature ideas captured by all DS9 roles. Sisko triages. Everyone contributes.*
*Do not delete entries. Do not assign priority. Just capture.*

---
```

Then append your first idea below the `---`.

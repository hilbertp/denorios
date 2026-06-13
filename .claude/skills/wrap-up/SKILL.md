---
name: wrap-up
description: "End-of-session consolidation: capture learnings, estimate hours, record session token cost, and checkpoint ideas before context is lost. Use this skill when a session is ending, when the conversation is getting long, when the user says 'wrap up', 'close out', 'end session', 'let's stop here', or anytime you sense the context window is getting deep. Every role must use this — it's a global team standard. Run this BEFORE context compaction erases the details. If you're unsure whether to run it, run it — the cost of running it unnecessarily is near zero, the cost of not running it is permanent information loss."
---

# /wrap-up — End-of-Session Consolidation

Seven steps, in order: directives, learnings, hours, session cost, ideas, anchor, report. Do all seven. Don't skip steps. Don't defer to "next session" — there is no next session with this context.

---

## Why this exists

AI roles start every session fresh. When a session ends — whether by the user closing the window, context compaction, or a natural stopping point — everything that wasn't written to a durable file is gone forever. This skill is the pre-flight checklist that captures the session's value before the lights go out.

The critical insight: **run this while you still have the details.** Compaction preserves facts and decisions but destroys the texture — what was tried and abandoned, how long things took, what surprised you, what you'd do differently. That texture is what makes learnings useful and estimates honest.

---

## When to run

**Wrap-up is not just "end of session." It's "end of context relevance."** Any time you've accumulated context that other processes — the event drain, headless operations, other roles, or even your own future self — might need, consolidate now. Don't hoard context in the conversation waiting for a formal ending.

**Triggers:**

- **Philipp says to wrap up** — "wrap up", "let's stop", "end session", "close out", "that's it for now"
- **Before a handoff** — you're about to pass work to another role and this is likely the last action in the session
- **Before the pipeline acts on your work** — you just staged briefs, gave directives, or changed priorities, and headless/scheduled processes (event drain, watcher, evaluator) might act before Philipp comes back. Consolidate now so they have fresh context.
- **The conversation is getting long** — you haven't consolidated yet and context compaction may be approaching
- **You've been working for a while** — significant decisions or directives have accumulated since the last consolidation
- **Between topics** — Philipp shifts from one area to another. The first area's context should be persisted before the conversation moves on.

**Do not wait for the user to ask.** If the session has produced meaningful work and you haven't run wrap-up yet, suggest it. "Before we close out, let me run through the wrap-up checklist" is always appropriate.

**Frequent wrap-ups are good.** Running wrap-up mid-session doesn't end the session — it checkpoints it. The cost is ~2 minutes. The benefit is that every process reading your files gets current context. In an active sprint where the pipeline is running, wrap up after every significant directive or decision batch, not just at session end.

---

## Step 1: Consolidate directives and decisions

Scan the conversation since the last wrap-up (or session start) for:

- **Directives from Philipp** — things he told you to do or not do ("kill slice 12", "focus on error reporting next", "don't retry that")
- **Decisions made** — scope changes, priority shifts, approach changes, kill decisions
- **Active state changes** — what's next, what's blocked, what changed about the current work

Persist these to your **project anchor file** — the file that future invocations of your role (including scheduled tasks and headless processes) read at startup:

| Role | Project anchor |
|---|---|
| O'Brien | `OBRIEN.md` Section K (Project Status) |
| Sisko | Equivalent project status section |
| Dax | Relevant ADR or architecture doc |
| Other roles | Their primary project state file |

**Format:** Append to the existing status section. Timestamp each entry. Be specific — "Philipp: don't retry slice 12, killing it (2026-04-14)" is useful. "Some changes were discussed" is not.

**Why this step exists:** Other processes read your project anchor to understand current state. The event drain reads OBRIEN.md before deciding how to handle a STUCK brief. A new Cowork session reads OBRIEN.md to know where things stand. If your directives only live in the conversation, those processes act on stale context. This step makes the conversation's decisions durable.

**If nothing new was decided this session, skip this step.**

---

## Step 2: Capture learnings

Scan the full conversation for things worth remembering. Use the debrief skill's two-destination model:

### LEARNING.md (your role's cross-project memory)

**Location:** `repo/.claude/roles/{your-role}/LEARNING.md`

Add any new learnings discovered this session. Check existing entries first — don't duplicate. Each learning gets a numbered heading under a topic group, with enough context that a fresh session understands the *why*, not just the *what*.

Look for:
- Corrections from Philipp (the human stakeholder) — these are gold
- Platform or tooling constraints discovered
- Approaches that worked well and should be repeated
- Mistakes made and recovered from
- Workflow patterns that were faster/slower than expected

### DEBRIEF.md (project-level observations)

**Location:** `repo/DEBRIEF.md`

Add any friction, process gaps, or improvement ideas that aren't role-specific. These get triaged later.

**If nothing new was learned this session, say so and move on.** Don't invent learnings to fill space.

---

## Step 3: Estimate hours

Append timesheet entries for all significant work done this session. Follow the full schema from `skills/estimate-hours/SKILL.md`.

One entry per distinct deliverable. If the session touched three different things (e.g., fixed a bug, wrote a brief, reviewed a report), that's three entries.

Key fields to get right:
- `human_hours` — honest estimate of what a competent human professional would bill
- `human_role` — what kind of human (Senior Developer, Delivery Coordinator, etc.)
- `actual_minutes` — your wall-clock time as AI
- `notes` — explain the estimate so it's auditable later
- `deliverable` — the grouping slug, consistent with prior entries for the same work

**Location:** `bridge/timesheet-{role}.jsonl` where `{role}` is your role name, lowercase (e.g. `timesheet-obrien.jsonl` for O'Brien). Append via `wormhole_append_jsonl` targeting the per-role file. Never write to the merged `timesheet.jsonl` directly — the watcher rebuilds it automatically.

---

## Step 4: Record session token cost

Token cost is the other half of the economics equation. Human-hours tells you the value created; token cost tells you what it cost to create it. Without both, ROI calculations are impossible.

### Primary method: usage-snapshot.js

The project has a script at `bridge/usage-snapshot.js` that calls the Claude API usage endpoint and captures delta spend. Run it:

```bash
node bridge/usage-snapshot.js --log
```

This reads the `sessionKey` from either `CLAUDE_SESSION_KEY` env var or `bridge/bridge.config.json`, diffs against the previous snapshot at `bridge/.usage-snapshot.json`, and appends a delta entry to `bridge/timesheet-watcher.jsonl` with `source: "usage-snapshot"`. The watcher rebuilds the merged `timesheet.jsonl` automatically.

If the script succeeds, session cost is captured automatically. Move on.

### Fallback: manual capture

If `usage-snapshot.js` fails (expired cookie, missing config, script not yet wired), fall back to manual:

1. Tell the user: "I need to capture the session cost. Could you check Settings > Usage and tell me the current session percentage and extra usage amount?"
2. The data lives at **Claude desktop app > Settings > Usage**:
   - **"Current session"** bar shows session burn as a percentage (e.g., "45% used")
   - **"Extra usage"** section shows cumulative EUR spend (e.g., "EUR 160.93 spent")
3. Record whatever the user provides in the timesheet entry's `notes` field
4. If the user can't provide it, note "session cost: not captured" in notes and move on — don't block wrap-up on this

---

## Step 5: Idea capture checkpoint

Scan the conversation for any feature ideas, improvement suggestions, or "we should..." moments that surfaced during the session. Append new ones to `IDEAS.md` at the repo root. Check existing entries first to avoid duplicates.

If no new ideas surfaced, skip this step.

---

## Step 6: Stamp anchor

Append one line to `bridge/anchors-{role}.jsonl` where `{role}` is your role name, lowercase (e.g. `anchors-obrien.jsonl` for O'Brien). Append via `wormhole_append_jsonl`. Never write to the merged `anchors.jsonl` directly — the watcher rebuilds it automatically.

```json
{
  "ts": "ISO 8601 UTC — now",
  "role": "your role name, lowercase",
  "scope": "e.g. 'Bet 2 — Contributor-facing relay & dashboard'",
  "deliverable": "same slug(s) used in the timesheet entries",
  "session_start": "ISO 8601 UTC — your best estimate of when this session's work began",
  "timesheet_entries": 1,
  "human_hours_total": 0.0,
  "handoff_artifacts": [],
  "wrap_up": true
}
```

The `wrap_up: true` flag distinguishes wrap-up anchors from handoff anchors (Step 3 of the handoff skill also stamps anchors). The reporting agent can use this to know the session was properly closed out.

---

## Step 7: Report to user

Tell the user what was captured. Keep it short:

> **Session wrapped up.**
> - Learnings: {N new entries in LEARNING.md} | {M new entries in DEBRIEF.md}
> - Hours logged: {total human_hours}h across {count} entries
> - Session cost: {captured or not captured}
> - Ideas: {N new} | {or "none"}
> - Anchor: stamped

If the user mentioned what they're doing next, acknowledge it. Otherwise, don't ask — the session is ending.

---

## Summary

| Step | Action | Output |
|---|---|---|
| 1 | Consolidate directives and decisions | Role's project anchor (e.g. OBRIEN.md) |
| 2 | Capture learnings | LEARNING.md + DEBRIEF.md |
| 3 | Estimate hours | bridge/timesheet-{role}.jsonl |
| 4 | Record session cost | In timesheet notes |
| 5 | Idea capture | IDEAS.md |
| 6 | Stamp anchor | bridge/anchors-{role}.jsonl |
| 7 | Report | Summary to user |

**Total time to run this skill: ~2 minutes.** That's the insurance premium against permanent information loss. Pay it every time.

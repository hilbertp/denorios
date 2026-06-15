---
name: compress
description: "Memory-safe context compaction. Run this INSTEAD of /compact whenever the context window is getting full (~90%) or compaction is imminent. It commits the session's durable project facts to the active role's memory/MEMORY.md FIRST (via the remember procedure), THEN compacts — so the texture that compaction destroys is preserved on disk before the lights go out. Triggers on 'compress', 'compact', 'context is getting full', 'we're running out of context', 'before you compact', or any time you sense the window is near its limit. Every role must use this — it's a global team standard."
---

# /compress — Memory-Safe Compaction

**Golden rule: never compact before memory is committed.** Compaction preserves facts and decisions but destroys the *texture* — what was tried and abandoned, why a choice was made, the gotcha you hit. Once it runs, anything not written to a durable file is gone forever. This skill makes "write it down first" automatic.

This is a global team standard. Every DS9 role runs `/compress` instead of `/compact`.

---

## Why this exists

Context compaction is lossy and, when it fires automatically near the context limit, it fires *without warning*. If you wait for the system to compact, you lose the session's durable project facts. The fix is discipline plus a single command: capture memory, then compact. `/compress` is that command — it wraps `/remember` and compaction into one memory-safe operation.

---

## What it does, in order

### Step 1 — Commit memory (the `/remember` procedure)
Run the full `/remember` skill now, against the current context window:

1. Identify the active role → `repo/.claude/roles/{role}/memory/MEMORY.md`.
2. Scan the conversation for **durable project facts** — decisions made and why, state changes, conventions that emerged, gotchas discovered, key facts/locations, open threads.
3. Filter ruthlessly: cross-project behavioral lessons go to `LEARNING.md` via `/debrief`, not here; skip anything already in `ROLE.md`/PRD/contracts/git, ephemeral state, raw code, and duplicates.
4. Read the existing `memory/MEMORY.md` (or create it from the template in the `/remember` skill) and append/update dated, self-contained entries. Bump the `Last updated:` line.

See `.claude/skills/remember/SKILL.md` for the full procedure, format, and template. `/compress` does not reinvent it — it *invokes* it.

### Step 1b — If the session is deep, run the full wrap-up instead
If this is effectively the end of the session (not just a mid-session checkpoint), run `/wrap-up` rather than bare `/remember` — it also captures learnings, hours, session cost, ideas, and stamps an anchor. Memory is necessary but it isn't the only thing that dies at compaction. Use judgment: mid-session deep context → `/remember`; winding down → `/wrap-up`.

### Step 2 — Confirm memory landed
Verify `memory/MEMORY.md` now contains this session's facts (the new entries are present, `Last updated` is today). Only proceed once it's on disk. If nothing durable existed to capture, say so explicitly — then it's safe to compact with nothing lost.

### Step 3 — Compact
Now compaction is safe. Note: `/compact` is a built-in harness command — a skill cannot fire it for you. So either:
- Tell the user, in one line: **"Memory committed to `memory/MEMORY.md`. Safe to `/compact` now."** and let them run it, or
- If you were invoked by an automated flow that proceeds to compaction, allow it to continue — memory is already safe.

---

## The 90% rule

Don't wait for the system to compact you. When you notice the context window is getting deep — long session, lots accumulated, roughly 90% full, or you're about to do something that will balloon context — run `/compress` proactively. The cost is seconds. The cost of an unannounced auto-compaction with uncommitted memory is permanent loss.

**Automatic enforcement (optional, recommended):** a `PreCompact` hook in `.claude/settings.json` can catch auto-compaction the model doesn't anticipate. Because a shell hook can't do model-side extraction, the robust pattern is a hook that invokes `claude -p` headlessly against the transcript to run the remember procedure into the active role's `memory/MEMORY.md` before compaction proceeds. If that hook is configured, this skill is the manual twin of it; if not, this skill plus the per-role Memory Protocol is the safety net.

---

## Summary

| Step | Action |
|---|---|
| 1 | Run `/remember` — commit durable project facts to `memory/MEMORY.md` |
| 1b | If winding down, run `/wrap-up` instead (memory + learnings + hours + cost + ideas + anchor) |
| 2 | Confirm the memory file landed on disk |
| 3 | Compact (hand off to `/compact`, or allow the automated flow to continue) |

**Run `/compress`, never bare `/compact`.** Memory first, always.

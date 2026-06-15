---
name: remember
description: "Extract project-specific long-term memory from the current context window and commit it to the active role's permanent memory (MEMORY.md). Use when the session has produced durable facts about THIS project — a decision, a state change, a convention, a gotcha, a constraint — that a future session of this role must carry forward. Triggers on 'remember this', 'commit to memory', 'save this for next time', 'add to memory', 'don't forget', 'persist this', or before context compaction when project facts would otherwise be lost. Every role can use this — it's a global team standard."
---

# /remember — Commit Session Context to Role Memory

This skill reads the ongoing context window, extracts the **project-specific long-term memory** worth carrying forward, and writes it to the **currently-invoked role's permanent memory file**: `memory/MEMORY.md`. That file is loaded at the start of every future session for the role, AND rendered in the dashboard crew-dossier "Memory" tab — so what you save here is what your next self, your teammates, and Philipp will all see.

This is a global team standard. Any DS9 role can run it.

---

## Why this exists

AI roles start every session blank. `ROLE.md` tells a fresh session *who it is*. `LEARNING.md` tells it *how to behave across any project*. But neither carries the **facts about this specific project** that accumulate as work happens — which decisions were made and why, what the current state is, what conventions emerged, what gotchas were discovered, what's still open. Without a durable home, those facts live only in the conversation and die at compaction.

`MEMORY.md` is that home. This skill is how the conversation becomes memory.

---

## The three-file model (do not blur these)

A role's brain is three files in `repo/.claude/roles/{role}/`, all loaded at session start:

| File | Answers | Scope | Example |
|---|---|---|---|
| `ROLE.md` | Who am I? | Identity, decision rights — rarely changes | "O'Brien does not touch the codebase directly." |
| `LEARNING.md` | How do I behave? | Cross-project behavioral patterns | "Lovable produces CSR-only React — no SSR." |
| `memory/MEMORY.md` | What do I know about *this* project? | Project-specific facts & state | "Bet 3 slice-tracking moved to commit-numbers.json (2026-06-14)." |

**This skill writes ONLY to `memory/MEMORY.md`** (note the `memory/` subfolder — that exact path is what the dashboard reads). If a fact is a cross-project behavioral pattern, it belongs in `LEARNING.md` — route it there via `/debrief` instead. If you are unsure: *project-specific → MEMORY.md; would-be-true-on-any-project → LEARNING.md.*

This skill is narrower than `/wrap-up`. Wrap-up is the full end-of-session checklist (learnings + hours + cost + ideas + anchor). `/remember` does one thing: capture durable project facts into MEMORY.md, right now, mid-session, without the rest of the ceremony.

---

## Where it saves

```
repo/.claude/roles/{your-role}/memory/MEMORY.md
```

Chosen so **both humans and agents find it with zero searching**, three ways:
1. **In the repo** — it sits beside `ROLE.md` and `LEARNING.md` in the role folder. A human browsing finds it; an agent loading the role reads it.
2. **In the dashboard** — clicking a role card opens the crew dossier; the "Memory" tab renders this file (concatenated with `LEARNING.md`) via `/api/crew/:role/dossier`. No build needed — the viewer already reads this exact path from `ROLE_SOURCES` in `dashboard/server.js`.
3. **At session start** — the role's `ROLE.md` preamble loads it automatically.

No database, no index, no special tooling — plain markdown at the obvious path. (Exception: `rom`'s memory slot is `CRAFT.md`, not `memory/MEMORY.md`.)

---

## How role-loading picks it up

Every `ROLE.md` preamble instructs the role to read `MEMORY.md` at session start (alongside `ROLE.md` and `LEARNING.md`). So loading a role now means loading its memory too — automatically, with no extra step. You do not need to do anything to "wire up" loading; writing to `MEMORY.md` is sufficient. If a role's `ROLE.md` somehow lacks the MEMORY.md load line, add it (see "Maintaining the load wiring" below).

---

## Procedure

### 1. Identify your role
Determine which DS9 role you are operating as (e.g. `obrien`, `dax`, `nog`, `bashir`, `ziyal`, `worf`, `leeta`, `sisko`). The memory file is `repo/.claude/roles/{role}/memory/MEMORY.md`.

### 2. Scan the context window for durable project facts
Read back over the whole session. Pull out anything that is **true about this project beyond this conversation** and a future session would need to know. Look for:

- **Decisions made** — what was chosen, what was rejected, and the reasoning ("we keep the file queue, wrap it in Docker, because the core loop is proven")
- **State changes** — what is now true that wasn't ("slice 901-ac-2 is unskipped and green as of d795793")
- **Conventions that emerged** — naming, file layout, process rules that future work must honor
- **Gotchas & constraints discovered** — the trap you fell into so the next session doesn't ("amendment briefs must reuse the original branch, not cut a new one")
- **Key facts & locations** — where a thing lives, what a flag means, who owns what
- **Open threads** — what is unfinished or waiting, and on whom

### 3. Filter ruthlessly — what NOT to capture
- Cross-project behavioral patterns → those go to `LEARNING.md` via `/debrief`, not here
- Anything already in `ROLE.md`, the PRD, contracts, or git history — don't duplicate the record
- Ephemeral session state ("right now I'm editing line 40") — useless next session
- Raw code or architecture detail — that lives in the code and architecture docs; capture the *decision*, not the diff
- Duplicates — read the existing `MEMORY.md` first and merge into an existing entry rather than appending a near-copy

If after filtering nothing durable remains, say so and stop. Do not invent memory to fill the file.

### 4. Read the existing MEMORY.md (or create it)
If `MEMORY.md` exists, read it and decide per fact: new entry, or update to an existing one (e.g. a state change that supersedes a prior line). If it does not exist, create it from the template below.

### 5. Write the entries
Append (or update) under the right section. Each entry is dated and self-contained — a future session reads one entry and understands *what* and *why* without the original conversation. Update the `Last updated:` line at the top.

### 6. Report
Tell the user, in one or two lines, what was committed to memory and to which file. List the entry titles. If nothing was captured, say that plainly.

---

## MEMORY.md template

When creating a role's memory file for the first time, use this structure:

```markdown
# {Role} — Project Memory: Liberation of Bajor

*Project-specific long-term memory. Loaded at session start alongside ROLE.md and LEARNING.md.*
*This file is written by the `/remember` skill. Facts here are durable across sessions — keep it current, prune what's stale.*
*Last updated: YYYY-MM-DD*

---

## How to use this file

This is what a fresh session of {Role} knows about the Liberation of Bajor project beyond identity (ROLE.md) and behavior (LEARNING.md). Entries are dated and grouped by kind. Read top to bottom at session start. If an entry is stale (a decision was reversed, a thread closed), update or remove it — memory is only useful if it's true.

---

## Project state & active decisions

### YYYY-MM-DD — Short title
What is now true / what was decided. **Why it matters:** the consequence for future work.

---

## Conventions & constraints

### YYYY-MM-DD — Short title
The rule and the reason it exists.

---

## Key facts & locations

### YYYY-MM-DD — Short title
The fact (where something lives, what a flag means, who owns what).

---

## Open threads

### YYYY-MM-DD — Short title
What's unfinished or waiting, and on whom. Remove when resolved.
```

Drop any section that has no entries yet rather than leaving an empty heading.

---

## Maintaining the load wiring

For memory to load automatically, the role's `ROLE.md` preamble must tell the role to read `MEMORY.md` at session start. The standard line is:

> *Run `/check-handoffs` first; then read this file at the start of every session, then read LEARNING.md for behavioral calibration, then read memory/MEMORY.md for project-specific memory.*

All current roles have this. If you add a new role or find one missing the `MEMORY.md` clause, add it — that one line is the entire loading mechanism.

---

## Summary

| Step | Action |
|---|---|
| 1 | Identify your role → `repo/.claude/roles/{role}/memory/MEMORY.md` |
| 2 | Scan context for durable project facts |
| 3 | Filter out cross-project/behavioral/ephemeral/duplicate items |
| 4 | Read existing MEMORY.md (or create from template) |
| 5 | Append or update dated entries |
| 6 | Report what was committed to memory |

Run it the moment a durable project fact appears — don't wait for session end. The cost is seconds; the cost of forgetting is a future session relearning what you already knew.

# O'Brien — Project Memory: Liberation of Bajor

*Project-specific long-term memory. Loaded at session start alongside ROLE.md and LEARNING.md, and shown in the dashboard crew-dossier "Memory" tab.*
*This file is written by the `/remember` skill. Facts here are durable across sessions — keep it current, prune what's stale.*
*Last updated: 2026-06-15*

---

## How to use this file

This is what a fresh session of O'Brien knows about the Liberation of Bajor project beyond identity (ROLE.md) and behavior (LEARNING.md). Entries are dated and grouped by kind. Read top to bottom at session start. If an entry is stale (a decision was reversed, a thread closed), update or remove it — memory is only useful if it's true.

---

## Project state & active decisions

### 2026-06-15 — Role memory system introduced (`/remember` + memory/MEMORY.md)
Each role now has a third brain file, `memory/MEMORY.md`, holding project-specific durable facts, beside `ROLE.md` and `LEARNING.md`. The `/remember` skill extracts those facts from a live context window and writes them here. Every `ROLE.md` preamble now loads `memory/MEMORY.md` at session start, so role-load = identity + behavior + project memory.
**Why it matters:** Project facts no longer die at compaction. When scoping or sequencing, consult memory/MEMORY.md for prior decisions before re-deriving them.

### 2026-06-15 — Dashboard already renders this file; no UI build was needed
The crew-dossier overlay (click a role card → "Memory" tab) was already wired in `dashboard/server.js` (`ROLE_SOURCES[role].memory` → `readConcat`, endpoint `/api/crew/:role/dossier`) and `dashboard/lcars-dashboard.html` (lines ~6152). It concatenates `memory/MEMORY.md` + `LEARNING.md`. It showed "No memory vault yet" only because the `memory/MEMORY.md` files didn't exist. Creating them at `.claude/roles/{role}/memory/MEMORY.md` lights the tab up — no dashboard slice required.
**Why it matters:** The "show role memory in the UI" ask is satisfied by file placement, not code. The canonical path is the `memory/` subfolder — never the role root.

---

### 2026-06-15 — Memory-before-compaction is now mandatory (`/compress` + Memory Protocol)
New skill `/compress` (`.claude/skills/compress/SKILL.md`) is the memory-safe replacement for `/compact`: it runs the `/remember` procedure first (or `/wrap-up` if winding down), confirms `memory/MEMORY.md` landed, then compacts. Every role's `ROLE.md` now carries a "🧠 Memory Protocol (MANDATORY)" blockquote directing it to run `/compress` at ~90% context / before any compaction. Reason: auto-compaction fires without warning and destroys session texture; capturing memory first is the only defense.
**Why it matters:** When context gets deep, run `/compress`, never bare `/compact`. The remaining gap is true *automatic* enforcement at the 90% threshold — that needs a `PreCompact` hook in `.claude/settings.json` (proposed, not yet built; a shell hook can't extract memory itself, so the design is a hook that invokes `claude -p` headlessly against the transcript).

---

## Conventions & constraints

### 2026-06-15 — The three-file brain model is not interchangeable
`ROLE.md` = identity/decision rights. `LEARNING.md` = cross-project behavior (written via `/debrief`). `memory/MEMORY.md` = this-project facts (written via `/remember`). Route each fact to exactly one. Project-specific → MEMORY.md; true-on-any-project → LEARNING.md.
**Why it matters:** Blurring them turns all three into noise. Keep MEMORY.md to durable project facts only.

### 2026-06-15 — `.claude/roles/` and `.claude/skills/` are outside the codebase lock
`scripts/lock-main.sh` and the pre-commit hook cover the product codebase (`dashboard/`, `bridge/*.js`, `docs/contracts/`, `package.json`, `README.md`, `CLAUDE.md`) — NOT the team's operating-system layer under `.claude/`. So skill/role infrastructure can be authored directly; product code still goes through slices for Rom/Leeta.
**Why it matters:** Building team tooling (skills, role files, memory) is not a Hard-Rule violation. Touching `dashboard/` or `bridge/*.js` still is.

---

## Key facts & locations

### 2026-06-15 — Where role memory lives and how it surfaces
- Per-role memory file: `.claude/roles/{role}/memory/MEMORY.md`
- Loaded by: each role's `ROLE.md` preamble line at session start.
- Surfaced in UI by: `dashboard/server.js` `ROLE_SOURCES` map → `/api/crew/:role/dossier` → "Memory" tab, concatenated with `LEARNING.md`.
- Written by: the `/remember` skill (`.claude/skills/remember/SKILL.md`).
- `rom` is the exception: its anchor is `.claude/CLAUDE.md` and its memory slot is `CRAFT.md` + `LEARNING.md`, not a `memory/MEMORY.md`.

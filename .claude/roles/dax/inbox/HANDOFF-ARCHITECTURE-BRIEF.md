# Dashboard & System v2 — Architecture Brief

**From:** Ziyal (Product Designer)
**To:** Dax (Architect)
**Date:** 2026-04-07
**Scope:** Bet 3 — LCARS ops dashboard redesign

> **Note:** This file was originally at `docs/architecture/DAX-ARCHITECTURE-BRIEF.md`. Moved to `roles/dax/` per Team Standard 4 (handoff protocol). A symlink remains at the original path for existing references.

---

## Why this brief exists

I wrote a dashboard redesign spec (`dashboard/DASHBOARD-REDESIGN-SPEC.md`). I initially carried forward "single HTML file" as a constraint because that's what exists today. Philipp challenged this — he doesn't care about implementation approach, he cares about: **easy modern tool use, high quality, and fast time to market.**

The question for you: what's the right architecture for the dashboard and the broader system going forward?

---

## Current system inventory

### What runs today

| Component | Technology | How it runs | Convenient? |
|---|---|---|---|
| **Watcher** | Node.js process (`orchestrator.js`, 945 lines) | `node bridge/orchestrator.js` — manually started, or launchd plist | Semi. Needs manual restart after code changes. Crash recovery exists but is file-based. |
| **Dashboard server** | Node.js HTTP (`server.js`, 137 lines) | `node dashboard/server.js` on port 4747 | Bare minimum. No hot reload, no build step, manual start. |
| **Dashboard UI** | Single HTML file (39.6KB, inline CSS+JS) | Served by dashboard server | Works for v0.2. Will not scale to the redesign complexity. |
| **Queue** | Flat files in `bridge/queue/` | Markdown files with YAML frontmatter, renamed atomically | Reliable. State transitions via filesystem rename. |
| **Register** | `register.jsonl` (append-only) | Written by watcher, 2 event types (COMMISSIONED, DONE) | Embryonic. Needs 10+ event types for dashboard lifecycle visualization. |
| **Heartbeat** | `heartbeat.json` | Written by watcher every 60s | Works. Dashboard polls it. |
| **Scheduled tasks** | Cowork `create_scheduled_task` (cron) | `*/3 * * * *` — O'Brien's commission watcher | Works but opaque. No visibility into whether scheduled tasks are running, failed, or stale. |
| **O'Brien invocation** | `claude -p` via `execFile` | Watcher pipes commission to stdin | Works. Token tracking exists (parses JSON output). |

### What's not convenient

1. **Manual process management.** Watcher and dashboard server are separate Node processes. No process manager, no auto-restart on crash (launchd plist exists but only for watcher). Developer has to `node dashboard/server.js` separately.

2. **No dev experience.** Editing the dashboard means editing a 1300-line HTML file, refreshing the browser manually. No hot module reload, no component isolation, no CSS tooling.

3. **Single-file ceiling.** The redesign adds: pipeline visualization with animation states, dynamic crew manifest, economics panel with aggregated data, stuck detection with threshold logic, amendment loopback rendering, 3 responsive breakpoints. In one file, this becomes unmaintainable.

4. **Register is too thin.** Only 2 event types. Dashboard needs 10+ to show the full lifecycle. This is a data layer problem, not a dashboard problem.

5. **No unified process.** Watcher, dashboard server, and cron tasks are three separate things with no shared lifecycle. Starting the system means starting each independently.

6. **Economics tracking doesn't exist yet.** Philipp wants real token burn per role per session, plus human-hours estimation, feeding a live economics panel. No infrastructure for this.

---

## What the dashboard redesign needs

From the UX spec (see full doc for details):

| Panel | Data requirement | Update frequency |
|---|---|---|
| **Active slice tracker** (hero) | Current lifecycle stage, owner, elapsed time, stuck detection | 5s poll |
| **Slice history table** | All completed slices grouped with timing, amendments, outcome | On change |
| **Crew manifest** | Which role is active, what they're doing | Derived from active slice |
| **System health bar** | Watcher status, heartbeat age, queue counts, error flags | 5s poll |
| **Economics panel** | Token burn per role, human-hours equivalent, Philipp's actual hours | Per session |

### UI complexity

- 4-5 distinct panels that update independently
- Animation states (stuck detection escalation: normal → amber → red)
- Pipeline visualization with stage nodes, owner badges, loopback arrows for amendments
- Responsive layout across 1440px / 1100px / 850px
- Read-only display — no forms, no auth, no user input beyond viewing

---

## Architecture questions for Dax

### 1. Dashboard frontend

The current single HTML file won't scale. Options I see (not my domain — your call):

**A. Vite + React SPA**
- Component model maps cleanly to panels (SliceTracker, CrewManifest, Economics, HealthBar)
- O'Brien knows React well (Claude Code generates it fluently)
- `npm run build` outputs static assets, server.js serves them
- Hot reload during development
- Trade-off: adds a build step, adds node_modules

**B. Vanilla JS with ES modules (no bundler)**
- Split into `components/pipeline.js`, `components/crew.js`, etc.
- Import via `<script type="module">`
- No build step, no node_modules
- Trade-off: no JSX, manual DOM manipulation, harder to maintain state

**C. Lightweight framework (Preact, Lit, Alpine)**
- Smaller than React, possibly no build step (CDN imports)
- Trade-off: less familiar to O'Brien, smaller ecosystem

**D. Something else entirely**
- Astro, SvelteKit, plain Handlebars templates rendered server-side — you tell us.

**Philipp's constraints:** Easy modern tool use, high quality, fast time to market. He's open to any approach. He does not use the development tools himself — O'Brien builds it.

### 2. Server architecture

Currently two separate Node processes (watcher + dashboard server). Questions:

- **Should they be unified?** One process that both polls the queue and serves the dashboard? Or is separation of concerns worth the operational overhead?
- **Should the dashboard server do more?** Right now it reads files on every request. Should it maintain state in memory, with the watcher emitting events to it? Would that enable WebSocket push instead of 5s polling?
- **Process management:** Should we use pm2, a shell script, or a combined entry point (`node start.js`) that spawns both? Or is the current manual approach acceptable for a local-first single-user system?

### 3. Data layer

The register needs to capture all lifecycle events. Two approaches:

**A. Keep flat files (register.jsonl + queue/)**
- Proven, simple, git-friendly
- Server reads and aggregates on each API request
- Trade-off: aggregation gets expensive as register grows, no indexing

**B. Lightweight DB (SQLite)**
- Watcher writes events to SQLite instead of/in addition to JSONL
- Server queries with SQL (aggregation, grouping by slice, time range filtering)
- Trade-off: adds a dependency, loses human-readability of JSONL

**C. Hybrid (JSONL as write log, SQLite as read model)**
- Watcher appends to JSONL (audit trail, git-friendly)
- A build step or on-startup process materializes JSONL into SQLite for fast queries
- Dashboard reads from SQLite
- Trade-off: more moving parts

### 4. Economics / token tracking

Philipp wants every role to report token burn and human-hours estimates. Architecture questions:

- Where does the data land? Separate file (`bridge/token-burn.jsonl`)? Same register? SQLite table?
- How does each role report? O'Brien's tokens come from watcher (already parsed from Claude output). But O'Brien (Cowork) and Nog (Claude Code) run in separate sessions — how do their token counts get into the system?
- Is there a reporting skill that runs at session end and appends to the tracker? Or does each session's tool (Cowork, Claude Code) need to be instrumented?

### 5. Unified startup

Right now: `node bridge/orchestrator.js` + `node dashboard/server.js` + Cowork cron task. Should there be a single entry point?

```
node start.js
  → spawns watcher
  → spawns dashboard server
  → outputs: "System running at http://localhost:4747"
```

Or is this over-engineering for a single-user local system?

---

## What I need back from you

1. **Frontend recommendation** — which approach (A/B/C/D/other) and why.
2. **Server architecture recommendation** — unified or separate, polling or push.
3. **Data layer recommendation** — flat files, SQLite, or hybrid.
4. **Economics tracking approach** — where data lands, how roles report.
5. **Startup/process management recommendation** — unified or keep separate.
6. **Anything I'm missing** — blind spots, risks, constraints I haven't considered.

Philipp will review your recommendation. Once architecture is decided, O'Brien commissions the work.

---

## Reference files

| File | What it contains |
|---|---|
| `dashboard/DASHBOARD-REDESIGN-SPEC.md` | Full UX/UI spec with panel layouts, data contracts, and phasing |
| `bridge/orchestrator.js` | Current watcher implementation (945 lines) |
| `dashboard/server.js` | Current dashboard server (137 lines) |
| `bridge/register.jsonl` | Current event log (2 entries) |
| `bridge/heartbeat.json` | Current heartbeat snapshot |
| `bridge/bridge.config.json` | Current configuration |
| `docs/contracts/` | Locked specs for commission format, report format, queue lifecycle |
| `OBRIEN.md` | O'Brien's anchor file with workflow and evaluation protocol |
| `.claude/CLAUDE.md` | O'Brien's anchor file with role definition and branch discipline |

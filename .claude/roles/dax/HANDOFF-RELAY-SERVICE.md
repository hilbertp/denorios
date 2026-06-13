# Relay Service & Dashboard Prototype

**From:** Sisko (Product Manager)
**To:** Dax (Architect)
**Date:** 2026-04-08
**Scope:** Bet 2 — Contributor-facing relay & dashboard

---

## Why this exists

We were about to build a landing page for open-source promotion. Sisko killed that bet. The reason: without a working, visible relay between O'Brien and O'Brien, there's nothing to promote. A stranger hitting the GitHub repo today would face a brittle filesystem watcher, manual session management, and zero visibility into what's happening. The landing page bet is paused — this bet comes first.

---

## The bet

**Hypothesis:** We can replace the brittle file-queue bridge with a dockerized relay service that makes the O'Brien-O'Brien loop reliable and visible to anyone.

**What this retires:**

- **Feasibility risk** — Can a containerized service replace the filesystem watcher + cron polling? Can it maintain connections to Cowork (O'Brien) and Claude Code CLI (O'Brien)?
- **Usability risk** — Can a stranger look at the dashboard and understand what's happening without reading docs?
- **Value risk** — Does a visible, reliable relay make the system meaningfully better for Philipp's own workflow?

**Success looks like:** Philipp runs `docker compose up`, opens a dashboard in the browser, and sees his AI team's status at a glance. O'Brien commissions work, O'Brien executes, the dashboard shows it happening in real time.

---

## What Dax needs to architect

### 1. The relay service

Replace the current bridge (`repo/.bridge/watcher.js` + filesystem polling + cron) with a dockerized service. This is the connective tissue between roles.

**Current state (what you're replacing):**
- `watcher.js` — single Node.js file, polls `.bridge/queue/` for PENDING files, invokes `claude -p`, renames files through state machine (PENDING → IN_PROGRESS → DONE/ERROR)
- Heartbeat via `heartbeat.json` written every 60s
- O'Brien writes commissions from Cowork, reads reports from the same queue directory
- Communication is purely file-based — `.bridge/queue/` is the only shared state
- The watcher crashes when a session ends. No recovery. No persistence across restarts.

**What the relay service must do:**
- Maintain awareness of O'Brien's connection (Cowork session alive or not)
- Maintain awareness of O'Brien's connection (Claude Code CLI available or not)
- Accept commissions from O'Brien and route them to O'Brien
- Track commission state (queued, in progress, done, error)
- Track O'Brien's status (idle, dev, deploy)
- Expose this state to the dashboard
- Survive restarts — don't lose queue state when the container restarts
- Run via `docker compose up` with zero manual configuration

**Architectural decisions for Dax to make:**
- Does the relay service replace the filesystem queue entirely, or does it wrap it? The file-based queue is the existing contract between O'Brien and O'Brien — changing it has blast radius.
- What's the connection model? WebSockets? Polling an HTTP API? File watching inside the container?
- Where does state live? SQLite inside the container? The existing file queue mounted as a volume? Both?
- How does O'Brien talk to the relay? MCP tools? HTTP? Still writes files but the relay detects them?
- How does the relay invoke O'Brien? Still `claude -p`? Something else?

### 2. The dashboard

A minimal web frontend served by the relay service. Not the LCARS ops dashboard — a clean, utilitarian status page.

**What the dashboard shows (exactly these five things):**

1. **O'Brien connection status** — connected / disconnected (Cowork session)
2. **O'Brien connection status** — connected / disconnected (Claude Code CLI)
3. **Nog and Bashir connection slots** — visible but grayed out, labeled "coming soon"
4. **Queue view** — which slices are queued, their status (pending, in progress, done)
5. **O'Brien activity** — what he's doing right now (idle, dev, deploy)

**What the dashboard does NOT show:**
- No LCARS aesthetic
- No mission lifecycle pipeline
- No project management features
- No configuration UI
- No role management

This is a monitoring window, not a control panel. It answers one question: "is the bridge working and what's happening right now?"

---

## Existing architecture to read

Before making any decisions, Dax should read these files:

| Document | Path | What it tells you |
|---|---|---|
| Architecture v1 | `Architecture — Liberation of Bajor v1.md` (project root) | The current bridge design — component boundaries, commission/report format, directory structure, all technical decisions made so far |
| Capability Map | `Capability Map — Liberation of Bajor.md` (project root) | The ordered capability list with dependencies — shows what's built, what's not, and why things are in the order they are |
| PRD v2 | `PRD — Liberation of Bajor v2.md` (project root) | Product requirements and vision context |
| PROJECT-VISION.md | `PROJECT-VISION.md` (project root) | The north star — especially the principles about agents keeping their powers and files being source of truth |
| Session Handoff | `Session Handoff — 2026-04-06 v2.md` (project root) | Where things stood at end of last dev session — git state, pending work, next commission number |
| Watcher (current) | `repo/.bridge/watcher.js` | The thing you're replacing — understand it before you redesign it |
| Bridge config | `repo/.bridge/bridge.config.json` | Current watcher configuration |
| Queue directory | `repo/.bridge/queue/` | Existing commissions and reports — the file-based state machine in action |

---

## Constraints

**From PROJECT-VISION.md (non-negotiable):**
- **Agents keep their powers.** O'Brien stays in Cowork with full Cowork capabilities. O'Brien stays in Claude Code CLI with full CLI capabilities. The relay connects them — it does not collapse either into a lesser version.
- **Files are the source of truth.** The relay can add a layer on top, but the underlying state should still be inspectable as files. No opaque database that hides what's happening.
- **Autonomy by default, human override always available.** The dashboard shows everything. Philipp can see and intervene at any point.

**From the existing architecture:**
- Commission format is YAML frontmatter + markdown body. This contract is established and working. Don't change it unless you have a strong reason.
- The queue lifecycle state machine (PENDING → IN_PROGRESS → DONE/ERROR) is proven. The relay should respect or extend it, not replace it.

**From Philipp's preferences (see O'Brien LEARNING.md):**
- Local-first. Works on his Mac without cloud services or external accounts.
- No approval prompts in VS Code — the `claude -p --permission-mode bypassPermissions` path is non-negotiable for O'Brien invocation.
- Outputs must be human-readable. No raw JSON in dashboards, no opaque state.

---

## What Dax delivers

An architecture document covering:

1. **Relay service design** — components, connection model, state management, Docker setup
2. **Dashboard spec** — what it shows, how it gets data from the relay, tech stack
3. **Migration path** — how we get from the current file-queue watcher to the new relay without breaking what works
4. **Repo topology** — does the dashboard live in the existing repo or a separate one? (Remember Lovable's constraint if Leeta builds the frontend — see LEARNING.md)
5. **Risk assessment** — what's the hardest part of this, and what should we spike first?

Dax does NOT need to build it. Dax architects it and hands off to O'Brien (relay service) and Leeta or Ziyal (dashboard UI). O'Brien coordinates delivery.

---

## What's on hold

Ziyal completed a full landing page design — copy, wireframe, and Leeta handoff. All three deliverables are in `repo/.claude/roles/ziyal/deliveries/`. That work is paused, not killed. Once this relay + dashboard bet proves out, the landing page picks back up with something real to show.

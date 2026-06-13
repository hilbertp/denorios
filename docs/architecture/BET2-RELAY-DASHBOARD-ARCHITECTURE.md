# Bet 2 — Relay Service & Contributor Dashboard Architecture

**Author:** Dax (Architect)
**Date:** 2026-04-08
**Status:** Draft for Sisko review
**Scope:** Bet 2 — Contributor-facing relay & dashboard
**Responds to:** `roles/dax/HANDOFF-RELAY-SERVICE.md`, `roles/dax/HANDOFF-BET2-REQUIREMENTS.md`

---

## 0. Executive Summary

The relay service wraps the existing file-queue bridge in a single Docker container that runs both the watcher and a dashboard server behind one `docker compose up` command. The file queue remains the source of truth. The dashboard is a static HTML page served by the same Node.js process, polling a JSON API for live state. No new languages, no build step, no external dependencies. A stranger clones the repo, runs one command, and watches the AI team pipeline in a browser.

---

## 1. Key Architectural Decision: Wrap, Don't Replace

The current file-queue bridge works. Slices 1-10 were delivered through it. The watcher handles crash recovery, heartbeat, token tracking, structured logging, and the full queue lifecycle. Replacing it introduces risk with no user-facing benefit.

**Decision:** The relay service is a Docker wrapper around the existing watcher + a unified HTTP server. It does not replace the filesystem queue, the state machine, the commission format, or the O'Brien invocation path.

**What changes:**
- Watcher and dashboard server merge into one process (or one container with a unified entry point)
- The container mounts the project directory as a volume
- Docker Compose handles process lifecycle (restart on crash, unified startup)
- The dashboard gets a fresh UI built for strangers, not for Philipp's ops workflow

**What does NOT change:**
- `bridge/queue/` remains the shared state directory
- Commission format (YAML frontmatter + markdown body) is unchanged
- Queue lifecycle (PENDING -> IN_PROGRESS -> DONE/ERROR) is unchanged
- `claude -p --permission-mode bypassPermissions` is the O'Brien invocation path
- `register.jsonl` remains the event log
- `heartbeat.json` remains the liveness signal
- O'Brien still writes commissions from Cowork; O'Brien still executes via Claude Code CLI

**Rationale:** PROJECT-VISION.md says "files are the source of truth" and "agents keep their powers." A relay that replaces the file queue with an opaque database violates both principles. A relay that wraps the file queue in better process management and adds a visibility layer respects both.

---

## 2. System Topology

```
                        Docker Container
                   ┌─────────────────────────┐
                   │                         │
                   │   unified-server.js     │
                   │   ├── watcher loop      │
                   │   ├── HTTP server       │
                   │   │   ├── GET /         │ ──── serves dashboard HTML
                   │   │   └── GET /api/bridge ── returns live state JSON
                   │   ├── heartbeat loop    │
                   │   └── register writer   │
                   │                         │
                   │   /project (volume)     │
                   │   └── bridge/queue/     │ ──── the file queue
                   │                         │
                   └─────────────────────────┘
                         │           │
           ┌─────────────┘           └─────────────┐
           │                                       │
    O'Brien (Cowork)                          O'Brien (Claude Code)
    writes to bridge/queue/                reads commission,
    reads reports                          writes reports,
    via mounted volume                     invoked by watcher
```

### 2.1 Why one process, not two

The current system runs two separate Node processes: `orchestrator.js` and `dashboard/server.js`. This is operationally awkward — two things to start, two things that can crash independently, no shared state without reading files on every request.

**Decision:** Merge into a single Node.js process.

Benefits:
- The watcher's in-memory state (current commission, heartbeat, session stats) is directly available to the HTTP handler — no file re-reads on every API request
- One process to manage, one health check, one restart policy
- The dashboard server's `buildBridgeData()` function already reads the same files the watcher writes — co-location eliminates the read-after-write race

Trade-off: A bug in the HTTP handler could crash the watcher (and vice versa). Acceptable for a single-user local system. If this ever matters, we split them back out — the shared state is still files.

### 2.2 Container architecture

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY relay/ /app/
EXPOSE 4747
CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
services:
  relay:
    build: ./relay
    ports:
      - "4747:4747"
    volumes:
      - .:/project
    restart: unless-stopped
```

**Volume mount:** The entire repo root is mounted at `/project` inside the container. The watcher runs with `cwd` set to `/project`, giving `claude -p` full access to the project filesystem — `CLAUDE.md`, git history, prior commissions, everything. This preserves O'Brien's full-powered environment per PROJECT-VISION.md.

**Restart policy:** `unless-stopped` handles crash recovery at the container level. Combined with the watcher's existing crash recovery on startup (orphaned IN_PROGRESS files), this makes the system self-healing.

**Port:** 4747 (same as current dashboard server). Single port, single URL.

---

## 3. Connection Model

Sisko's handoff asks: "How does O'Brien talk to the relay? How does the relay invoke O'Brien?"

### 3.1 O'Brien -> Relay

**Decision:** O'Brien continues writing files to `bridge/queue/`. No change.

O'Brien operates in Cowork with a mounted workspace. The mount maps to the host filesystem. The Docker container mounts the same directory. When O'Brien writes `019-PENDING.md`, the watcher inside the container detects it on the next poll cycle.

There is no connection to "maintain" — O'Brien's connection is the filesystem mount. If Cowork is running and the workspace is mounted, O'Brien is "connected." If not, she's "disconnected." The relay detects this by checking whether the Cowork session has recently written files (or we add a O'Brien heartbeat file — see Section 8.1).

**Why not HTTP or WebSockets:** O'Brien in Cowork has file tools but no built-in HTTP client for posting to a local relay. Adding an MCP tool for this is possible but unnecessary — file writes already work and are proven across 10 slices. Introducing a new communication channel adds a failure mode with no benefit.

### 3.2 Relay -> O'Brien

**Decision:** The relay invokes O'Brien via `claude -p` from inside the container, same as the current watcher.

**Critical constraint:** `claude` CLI must be available inside the container. Two options:

**Option A (recommended): Mount the host's Claude binary.**
```yaml
volumes:
  - .:/project
  - /usr/local/bin/claude:/usr/local/bin/claude:ro
  - ${HOME}/.claude:/root/.claude:ro  # Claude config/auth
```

This avoids installing Claude inside the container and ensures the container always uses the host's version. The `:ro` (read-only) mount on the config directory prevents the container from modifying Claude's configuration.

**Option B (fallback): Install Claude in the Dockerfile.**
```dockerfile
RUN npm install -g @anthropic-ai/claude-code
```

Trade-off: container build takes longer, Claude version drifts from host, and auth tokens need to be passed in as environment variables or mounted volumes.

**Recommendation:** Option A. It's simpler, always current, and avoids auth complexity. The `claude` binary path should be configurable via `bridge.config.json` for different host setups.

### 3.3 Connection status for the dashboard

The dashboard needs to show O'Brien and O'Brien as connected/disconnected.

**O'Brien status:** O'Brien writes a lightweight heartbeat file `bridge/obrien-heartbeat.json` at the start of each Cowork session and periodically during active work. The relay reads this file. If it exists and the timestamp is < 5 minutes old, O'Brien is "connected." Otherwise, "disconnected."

This is a new convention but requires zero infrastructure — O'Brien writes a file (which she already knows how to do), and the relay reads it (which it already does for the watcher heartbeat).

**O'Brien status:** Derived from the watcher's own state:
- If a commission is IN_PROGRESS, O'Brien is "active" (executing)
- If the last commission completed within the timeout window, O'Brien is "idle" (available)
- If `claude -p` failed on the last invocation, O'Brien is "error"
- Otherwise, O'Brien is "available" (the watcher can invoke him on demand)

**Nog and Bashir:** Shown as slots in the dashboard, labeled "coming soon," grayed out. No connection logic needed.

---

## 4. Dashboard Specification

### 4.1 Scope

This is the Bet 2 contributor dashboard — the minimum experience that makes the product legible to a stranger. It is NOT the full LCARS ops dashboard (Bet 3/Ziyal's spec). The two are deliberately different:

| | Bet 2 Dashboard | Bet 3 LCARS Dashboard |
|---|---|---|
| Audience | Stranger evaluating the project | Philipp operating the system |
| Aesthetic | Clean, utilitarian, modern | LCARS theme with animations |
| Complexity | 5 elements, read-only | 10+ panels, economics, stuck detection |
| Data needs | Heartbeat + queue files | Full register events, slice grouping, token burn |

### 4.2 What it shows (exactly five things)

1. **Role status panel** — O'Brien (connected/disconnected), O'Brien (connected/disconnected), Nog and Bashir (grayed out, "coming soon"). Role names include their function: "O'Brien — Delivery Coordinator."

2. **Active commission** — If IN_PROGRESS: title, current stage, owner (O'Brien), elapsed time. This is the heartbeat of the product. If nothing is active, show the last completed commission.

3. **Queue view** — Pending commissions waiting to be picked up. Even one item tells the story.

4. **Recent completions** — Last 5 completed commissions: title, outcome (DONE/ERROR), duration.

5. **System health** — One pill: ONLINE (heartbeat < 60s) / DEGRADED (heartbeat 60-300s) / OFFLINE (heartbeat > 300s or missing).

### 4.3 What it does NOT show

- No LCARS aesthetic
- No economics panel (internal tooling for Philipp)
- No mission lifecycle pipeline with 10 stages
- No configuration UI
- No authentication
- No stuck detection thresholds (Bet 3)

### 4.4 Tech stack

**Decision: Single HTML file, no build step.**

This is the opposite of what Ziyal's Bet 3 brief recommends (Vite + React). The reasons are specific to Bet 2's constraints:

1. **Zero-config to run.** `docker compose up` and it works. No `npm install`, no `npm run build`, no `node_modules`. The Dockerfile copies one HTML file and one JS file.

2. **Stranger-friendly.** A developer evaluating the project opens `dashboard/index.html` and sees the entire frontend in one file. No abstraction layers, no component tree, no build tooling to understand.

3. **Bet 2 is small.** Five elements, read-only, no forms, no auth, no complex state. A single HTML file with inline CSS and JS handles this cleanly.

4. **Bet 3 will supersede it.** The LCARS ops dashboard (Ziyal's spec) will be a proper React app with component architecture, build step, and the full panel set. That's the right time to add tooling complexity. Bet 2 is a throwaway prototype that proves the relay works — don't over-invest in its frontend.

**Trade-off:** The Bet 2 dashboard will be rewritten for Bet 3. This is intentional. A prototype's job is to learn, not to last.

### 4.5 Data flow

```
Dashboard (browser)
    │
    │  GET /api/bridge (every 5s)
    │
    ▼
Server handler
    │
    ├── reads heartbeat.json (watcher state)
    ├── reads obrien-heartbeat.json (O'Brien connection)
    ├── reads bridge/queue/*.md (commission list + frontmatter)
    │
    ▼
Returns JSON:
{
  "roles": {
    "obrien": { "status": "connected", "lastSeen": "..." },
    "obrien": { "status": "active", "activity": "Executing commission 019" },
    "nog": { "status": "coming_soon" },
    "bashir": { "status": "coming_soon" }
  },
  "active": {
    "id": "019",
    "title": "Goal field in commission frontmatter",
    "stage": "IN_PROGRESS",
    "owner": "obrien",
    "elapsed_seconds": 142
  },
  "queue": [
    { "id": "020", "title": "...", "state": "PENDING" }
  ],
  "recent": [
    { "id": "018", "title": "...", "outcome": "DONE", "duration_seconds": 312 },
    ...
  ],
  "health": {
    "status": "online",
    "heartbeat_age_seconds": 3
  }
}
```

Polling interval: 5 seconds. Acceptable for near-real-time without WebSocket complexity. The API reads files on every request — at this scale (one user, <50 queue files), this is negligible.

---

## 5. Repo Topology

### 5.1 Decision: Monorepo, new `relay/` directory

```
repo/
├── bridge/              ← existing: queue, watcher, logs, heartbeat
│   ├── queue/
│   ├── watcher.js       ← existing watcher (still runs standalone)
│   ├── bridge.config.json
│   ├── heartbeat.json
│   ├── register.jsonl
│   └── ...
├── relay/               ← NEW: Docker relay service
│   ├── server.js        ← unified watcher + HTTP server
│   ├── Dockerfile
│   └── dashboard.html   ← Bet 2 contributor dashboard
├── docker-compose.yml   ← NEW: at repo root
├── dashboard/           ← existing: LCARS dashboard (Bet 3)
│   ├── lcars-dashboard.html
│   ├── server.js        ← existing standalone server (deprecated by relay)
│   └── DASHBOARD-REDESIGN-SPEC.md
└── ...
```

**Why a new `relay/` directory instead of modifying `bridge/`:**

- `bridge/` is the runtime directory — queue files, logs, heartbeat. Adding Docker infrastructure there muddies the boundary between "state the system produces" and "code that runs the system."
- The existing `bridge/orchestrator.js` continues to work standalone for Philipp's current workflow. The relay is an alternative entry point, not a replacement. Philipp can still run `node bridge/orchestrator.js` manually if he prefers.
- `docker-compose.yml` lives at the repo root because that's where strangers expect it. `git clone && docker compose up` works from the root.

### 5.2 Lovable / Leeta consideration

Bet 2's dashboard is a single HTML file — no Lovable involvement. For Bet 3 (LCARS ops dashboard with React components), the frontend may be built through Lovable with Leeta as the specialist. Per LEARNING.md, Lovable creates its own GitHub repo — it cannot connect to an existing one.

**Forward-compatible decision:** If Bet 3 uses Lovable, the frontend lives in a separate repo (created by Lovable), and the relay serves it via a volume mount or a build artifact copy. The relay's `server.js` already serves static files from a configurable path — swapping `dashboard.html` for a `dist/` directory is a one-line change.

This decision is deferred until Bet 3 scoping. It does not affect Bet 2.

---

## 6. Migration Path

### 6.1 Coexistence, not migration

The relay does not replace the current setup — it runs alongside it. Philipp's existing workflow (manual `node bridge/orchestrator.js` + `node dashboard/server.js`) continues to work unchanged.

**Phase 1: Build the relay.**
- Create `relay/server.js` (unified watcher + HTTP server)
- Create `relay/Dockerfile` and `docker-compose.yml`
- Create `relay/dashboard.html` (Bet 2 contributor UI)
- Existing files untouched

**Phase 2: Validate.**
- Run `docker compose up` alongside the manual watcher (on different ports if needed)
- Verify the relay detects commissions, invokes O'Brien, serves the dashboard
- Verify the dashboard shows live state

**Phase 3: Switch over (optional).**
- Philipp switches from manual watcher to `docker compose up`
- The manual watcher becomes the fallback
- No files moved, no contracts changed, no breaking changes

### 6.2 What if Docker doesn't have `claude`?

The biggest migration risk: `claude` CLI might not work correctly inside a Docker container. The binary is installed on the host, and it authenticates against Anthropic's API using host-level credentials.

**Spike recommendation:** Before building the full relay, spike this:
1. Create a minimal Docker container that mounts the host's `claude` binary
2. Run `claude -p "echo hello"` inside the container
3. Confirm it authenticates and responds

If this fails, fallback: the relay container runs only the HTTP server + dashboard, and the watcher continues running on the host. The container reads queue files via volume mount but doesn't invoke `claude` directly. This is a degraded architecture but still delivers the dashboard experience.

---

## 7. Risk Assessment

### 7.1 Highest risk: `claude` in Docker

**Risk:** `claude -p` may not work inside a Docker container due to authentication, filesystem access, or binary compatibility.
**Likelihood:** Medium. Claude Code stores auth tokens in `~/.claude/` and may use system keychain APIs that don't exist in a container.
**Impact:** High. Without `claude` in the container, the relay can't invoke O'Brien.
**Mitigation:** Spike first (Section 6.2). Fallback: split architecture (dashboard in container, watcher on host).

### 7.2 Volume mount latency

**Risk:** File writes from O'Brien (via Cowork's mounted workspace) may take >5s to propagate through Docker's volume mount layer, causing missed poll cycles.
**Likelihood:** Low on macOS with bind mounts. Higher with Docker Desktop's VirtioFS.
**Impact:** Low. A missed poll cycle means a 5-second delay, not data loss.
**Mitigation:** Test with real Cowork writes during validation.

### 7.3 Port conflict

**Risk:** Port 4747 is already in use by the existing dashboard server.
**Likelihood:** Medium. If Philipp has both running.
**Impact:** Low. The Docker container fails to bind.
**Mitigation:** Make the port configurable via environment variable in docker-compose.yml. Document that the standalone server should be stopped before running the relay.

### 7.4 Dashboard is too simple for "aha" moment

**Risk:** Five elements may not be enough to communicate the product's value. A stranger sees status pills and a table and doesn't understand what's special.
**Likelihood:** Medium.
**Impact:** Medium. The bet's success metric (5 contributors in 60 days) depends on the dashboard making the use case obvious.
**Mitigation:** The active commission element is the key. If a stranger watches a commission go from PENDING to IN_PROGRESS with "O'Brien" as the owner, the product clicks. Prioritize this animation/transition in the UI. Additionally, the empty-state experience ships with a pre-loaded demo commission and a snapshot of a completed pipeline (see Section 8.6).

### 7.5 REVISED — The real feasibility risk: O'Brien's evaluation loop

~~Original spike priority was `claude -p` in Docker. That's been demoted.~~ The primary risk for Bet 2 is the O'Brien evaluation loop — how O'Brien automatically reads O'Brien's reports and decides ACCEPTED or APENDMENT without generating notification spam to Philipp.

**The problem in detail:**

O'Brien lives in Philipp's Cowork conversation window. That window is the command center — Philipp talks to O'Brien there to organize work, ask about slice status, and make scope decisions. O'Brien must be up to date when Philipp walks in.

In v0, a Cowork scheduled task (`obrien-commission-watch`, every 3 minutes) polled the queue and evaluated DONE files. This kept O'Brien current. But it fired every 3 minutes *regardless of whether anything was in the review queue*, and every firing generated a notification to Philipp. 20+ pings per hour with nothing to say. Unacceptable.

**REVISED (Sisko, 2026-04-08 — second revision):**

~~The cron job approach was the original plan. Sisko challenged whether evaluation needs to live in Cowork at all.~~ It doesn't.

**New model: Relay-invoked evaluation.**

The relay already invokes O'Brien via `claude -p`. It uses the same mechanism for evaluation. When the watcher detects a DONE file:

1. Relay reads the original commission (success criteria from the committed PENDING file)
2. Relay reads the DONE report
3. Relay invokes `claude -p` with an evaluation prompt: "Read these ACs. Read this report. Decide ACCEPTED or APENDMENT. Write your evaluation to {path}."
4. Evaluation result gets written to `register.jsonl` (ACCEPTED or APENDMENT event)
5. If APENDMENT: the evaluator writes a new PENDING commission to the queue → O'Brien picks it up → loop continues autonomously
6. Dashboard reads the register → shows status within 5s
7. O'Brien in Cowork reads the register on demand when Philipp asks "what happened to slice X?"

**What this eliminates:**
- No Cowork cron job → no notification spam
- No context window bloat in O'Brien's Cowork session → cheaper token burn
- No new platform capabilities required → no dependency on Cowork scheduled task behavior

**What this introduces (new risks — see 7.6, 7.7, 7.8):**
- The evaluator runs with a cold context window — can it make reliable accept/reject decisions?
- Apendment loops — what stops the evaluator and O'Brien from disagreeing forever?
- O'Brien in Cowork is now read-only on pipeline status — is that sufficient for Philipp?

**Build order — spike-first, Cagan discipline:**

1. **Spike S0: Evaluation quality** — can a cold `claude -p` invocation reliably evaluate a report against ACs? (Section 7.6)
2. **Spike S1: `claude -p` in Docker** — auth, binary compat, filesystem access (Section 7.1)
3. **Spike S2: Apendment loop bounds** — does the evaluator-O'Brien loop converge? (Section 7.7)
4. Relay server: unified watcher + HTTP + API + evaluation invocation
5. Dashboard HTML
6. Integration test + README

### 7.6 Evaluation quality with cold context

**Risk:** Cold `claude -p` evaluation may make bad accept/reject decisions without organizational context.
**Sisko decision (2026-04-08):** Not critical. Handle through iteration — if evaluation quality is off, enrich the prompt or tighten ACs. Not a gate.

### 7.7 Apendment loop runaway

**Risk:** Evaluator and O'Brien disagree forever, burning tokens with no convergence.

**Resolution (Sisko decision, 2026-04-08):** Hard cap at **n < 5** failed apendment cycles per commission. After the cap, the evaluation service escalates: O'Brien (the evaluation function) re-examines the situation, assesses whether the ACs still make sense in light of the evidence from the failed attempts, and flags the commission as STUCK with a reassessment note. The dashboard shows STUCK in red. Philipp intervenes.

Implementation:
- `maxApendments: 5` in `bridge.config.json`
- After 5 failures, the evaluation service writes a STUCK event to the register with a summary: what was tried, why it failed, and whether the ACs need revision
- This is a build-time feature, not a spike — implement in B1 (relay server)

### 7.8 Value risk — resolved

**Sisko decision (2026-04-08):** The product's core value proposition is workflow automation and transparency. Contributors advance the product by polishing and extending the feature set. This is not a risk to spike — it's the reason the product exists. The contribution surface is the product itself.

---

## 8. Responses to Sisko's Architecture Questions

### 8.1 Does the relay replace the filesystem queue or wrap it?

**Wrap.** The file queue is the source of truth. The relay adds process management (Docker) and visibility (dashboard) on top.

### 8.2 Connection model?

**File-based for O'Brien, `claude -p` for O'Brien, HTTP polling for the dashboard.** No WebSockets, no new protocols. Each connection type is proven in the current system.

### 8.3 Where does state live?

**Files.** `bridge/queue/` for commissions, `heartbeat.json` for watcher status, `register.jsonl` for event history, `obrien-heartbeat.json` for O'Brien connection status. The unified server's in-memory state is a cache that's rebuilt from files on startup.

### 8.4 How does O'Brien talk to the relay?

**She doesn't.** She writes files to the queue directory, same as today. The relay reads them. No new interface for O'Brien.

### 8.5 How does the relay invoke O'Brien?

**Same as the watcher: `claude -p --permission-mode bypassPermissions`**, executed from within the Docker container with the project directory mounted as the working directory.

### 8.6 Empty-state experience (Sisko decision: 2026-04-08)

**Decision:** Ship a demo commission with a snapshot of a completed pipeline example.

When a stranger runs `docker compose up` and no real commissions exist, the dashboard shows:
- A pre-loaded demo commission (e.g., `000-DONE.md`) that demonstrates the full lifecycle — what a commission looks like, what a report looks like, what DONE means
- A static snapshot or screenshot embedded in the dashboard showing what the pipeline looks like when a real commission is in flight (PENDING → IN_PROGRESS transition with O'Brien as owner)

This gives the stranger both the "what happened" (demo commission) and the "what it looks like live" (snapshot) without requiring them to set up Claude credentials first.

The demo commission lives in `relay/demo/` (not in the real queue) and is served by the API as a special case when the real queue is empty.

### 8.7 README ownership (Sisko decision: 2026-04-08)

**Decision:** Not a stakeholder decision. Dax or the implementing role writes the README as part of Slice S4 (integration + README). The README explains what the stranger is looking at, how to run `docker compose up`, and what the dashboard shows.

---

## 9. Responses to Ziyal's Architecture Questions (Bet 3 Preview)

These questions are from `HANDOFF-ARCHITECTURE-BRIEF.md`. Full answers are deferred to Bet 3 architecture, but here are preliminary positions informed by Bet 2 work:

### 9.1 Frontend recommendation

**Bet 2: Single HTML file.** Good enough, ships fast, disposable.
**Bet 3: Vite + React SPA.** The LCARS dashboard has 5 panels that update independently, animation states, responsive breakpoints, and a pipeline visualization. A component model (SliceTracker, CrewManifest, HealthBar, Economics, SliceHistory) maps cleanly to React. O'Brien generates React fluently.

### 9.2 Server architecture

**Bet 2: Unified (one process).** Watcher + HTTP server in one Node.js process.
**Bet 3: Same unified process, richer API.** Add `/api/slices` endpoint that aggregates register.jsonl into slice-grouped data (per Ziyal's spec Section 4.3). Add `/api/economics` for token burn data.

### 9.3 Data layer

**Bet 2: Flat files only.** Heartbeat + queue + register.jsonl, read on every API request.
**Bet 3: Hybrid (JSONL as write log, in-memory as read model).** On startup, the server reads register.jsonl into an in-memory data structure. The watcher appends new events to both the file and the in-memory model. The API serves from memory. No SQLite needed — at the current event volume (<100 events/day), in-memory is simpler and faster.

### 9.4 Economics / token tracking

**Already partially solved.** The watcher extracts token usage from `claude -p --output-format json` output and writes it to register DONE events. This covers O'Brien's token burn. O'Brien's and Nog's token burn requires a reporting convention at session end — deferred to Bet 3.

### 9.5 Unified startup

**Solved by Docker Compose.** `docker compose up` starts everything. The relay container is the single entry point.

### 9.6 Blind spots

1. **Auth in Docker:** The biggest unknown. Spike it immediately.
2. **O'Brien heartbeat convention:** New file (`obrien-heartbeat.json`). O'Brien needs to know about it — add to OBRIEN.md.
3. **Dashboard content for empty queue:** What does a stranger see when they first run `docker compose up` and no commissions exist? A demo commission or a clear "waiting for first commission" state?
4. **README for strangers:** The current README is 2 lines. The `docker compose up` experience needs a README that explains what the stranger is looking at.

---

## 10. Summary for O'Brien (Commission Slicing)

No spikes. All identified risks (Docker auth, evaluation quality, apendment loops) are standard engineering problems with known solutions. Handle them during implementation.

### Build slices

| Slice | Title | What it delivers |
|---|---|---|
| **B0** | Evaluator in `orchestrator.js` | Second poll pass for DONE files; EVALUATING rename; `claude -p` evaluation prompt; ACCEPTED/REVIEWED/STUCK outcomes; apendment commission writer; cycle counter; crash recovery extension; CORS + `0.0.0.0` in `server.js`. **Urgent — unblocks O'Brien.** |
| **B1** | Unified relay server | `relay/server.js` merging watcher + HTTP + API; Dockerfile + docker-compose.yml. |
| **B2** | Contributor dashboard | `relay/dashboard.html` with 5 elements + demo commission, polling `/api/bridge`. New states (ACCEPTED, REVIEWED, STUCK) rendered. |
| **B3** | Integration + README | Full `docker compose up` flow tested; repo README rewritten for strangers |
| **B4** | O'Brien status reading | O'Brien in Cowork can read register/status on demand — "what happened to slice X?" works |

B0 ships into the existing `orchestrator.js` (no Docker required). All other slices proceed in order after B0.

Total estimated effort: 5-7 O'Brien commissions. Start with B0.

### B0 detail — evaluator architecture (2026-04-09 addition, v2)

The `obrien-commission-watch` Cowork scheduled task has been disabled — it was generating a sandbox artifact every minute, polluting the workspace. B0 replaces it entirely with a relay-invoked evaluator that covers the complete commission lifecycle: commission → execute → evaluate → amend-or-accept → merge.

Full design in `roles/obrien/RESPONSE-EVALUATOR-ARCHITECTURE-FROM-DAX.md`. Summary:

**The complete cycle, autonomously:**
1. O'Brien writes PENDING → watcher invokes O'Brien → O'Brien writes DONE
2. Watcher renames DONE → EVALUATING → invokes evaluator via `claude -p`
3. Evaluator reads `{id}-COMMISSION.md` (ACs) + EVALUATING file (report) → returns verdict
4. If ACCEPTED: rename to ACCEPTED, write **merge PENDING** → O'Brien merges branch to main
5. If APENDMENT_NEEDED (cycle < 5): rename to REVIEWED, write **apendment PENDING** with same branch → O'Brien fixes → back to step 2
6. If cycle ≥ 5: rename to STUCK → surfaces to Philipp

**Key design points:**
- Runs inside `orchestrator.js` — second pass in poll loop after PENDING check, same `claude -p` pattern
- Uses `processing` flag — no concurrent `claude -p` calls
- PENDING commissions always take priority over DONE evaluations
- Merge commissions (`type: merge`) auto-accept — no evaluation needed
- Branch name propagates through the entire cycle via DONE frontmatter → apendment/merge frontmatter
- Apendment cap at 5 cycles per `root_commission_id`
- Crash recovery extended for EVALUATING files (rename back to DONE)
- CORS + HOST fix in `server.js` also in B0 (unblocks Leeta)

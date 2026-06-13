# ADR: Wormhole — Sandbox/macOS Bridge

**Status:** Accepted
**Author:** Dax (Architect)
**Date:** 2026-04-14
**Context:** Sprint 3 — prerequisite to O'Brien self-activation drain
**Supersedes:** the filesystem-sync design from the previous version of this ADR (superseded by POC evidence on 2026-04-14)

---

## Context

Cowork runs inside a full Linux VM. Writes from inside the VM to the macOS workspace folder cross the VirtioFS boundary and trigger a per-write permission prompt. Interactive sessions are fine — Philipp clicks through. Automated pipelines are not — the O'Brien drain, scheduled tasks, and any headless agent work stall on human approval for every file write.

This ADR locks the bridge design that lets Cowork agents write to the workspace folder without human-in-the-loop approval per write.

---

## Decision

The Wormhole is a **local MCP server**, running as a native macOS process, registered in Cowork's `claude_desktop_config.json`. Cowork sessions call Wormhole tools (`wormhole_write_file`, `wormhole_append_jsonl`, `wormhole_move`, `wormhole_delete`) to perform writes. The server executes those writes as a macOS-native process — no sandbox boundary is crossed on the write, so no prompt fires.

Reads continue to go through VirtioFS directly (the existing mount inside each Cowork session). Reads do not trigger prompts; only writes do.

### Data flow

```
  ┌──────── Cowork VM ────────┐          ┌─────────── macOS host ───────────┐
  │                           │          │                                   │
  │   O'Brien / Dax / O'Brien    │          │   Wormhole MCP server             │
  │          │                │          │   (node process, per session)     │
  │          │ reads          │          │          │                        │
  │          ▼                │          │          ▼                        │
  │   VirtioFS mount ─────────┼──────────┼───► workspace folder              │
  │   (mnt/01 - The Liberation│  stdio   │     /Users/phillyvanilly/...      │
  │    of Bajor/)             │  MCP     │          ▲                        │
  │          ▲                │  protocol│          │                        │
  │          │ tool call      │          │          │ writes                 │
  │          └────────────────┼──────────┼──── Wormhole tools                │
  │                           │          │                                   │
  └───────────────────────────┘          │   watcher.js (unchanged)          │
                                          │   Ops Center (unchanged)          │
                                          │          │                        │
                                          │          │ writes directly        │
                                          │          ▼                        │
                                          │   workspace folder                │
                                          └───────────────────────────────────┘
```

Two writers on the macOS side: **watcher.js** (writes directly, as today) and **Wormhole** (writes on behalf of Cowork agents). Both are native macOS processes. The boundary is crossed only by tool-call *messages*, never by file writes.

### Evidence — POC passed 2026-04-14

- `wormhole-poc/server.js` registered in `claude_desktop_config.json`.
- First tool call from Cowork wrote `signals/ping-*.json` to the workspace folder.
- Payload metadata confirmed native macOS execution: `platform: "darwin"`, `arch: "arm64"`, `hostname: "Mac.local"`, `user: "phillyvanilly"`, `nodeVersion: "v24.11.1"` (matching the user's shell Node).
- First call required a one-time MCP tool-consent click. Second and subsequent calls were silent.
- No per-write filesystem prompt fired on either call.

POC stays in `wormhole-poc/` as reference implementation until production Wormhole subsumes it.

---

## Why not filesystem-sync

An earlier version of this ADR proposed a macOS daemon watching both a sandbox-internal copy and the macOS workspace, mirroring changes between the two. That design was rejected after POC:

- **Session-path problem dissolved.** The sync design needed a daemon pointed at `/sessions/<id>/...` — a path that changes per session. MCP eliminates this entirely because the server only operates in macOS paths; sandbox session ID is invisible to it.
- **Multi-writer complexity reduced.** Sync required split-writer files and merge-on-read for every file with two writers. MCP reduces this to one shared concern (two processes on the macOS side — Wormhole and watcher — competing for the same file), solvable with file locking or split-writer at a much smaller scope.
- **Fewer moving parts.** No launchd daemon, no chokidar watchers, no conflict resolution logic, no session-init handshake.
- **Sanctioned transport.** MCP stdio is a first-class Cowork extension point. Settings → Developer → Local MCP servers is the supported configuration surface.

Rejected alternatives (still rejected):
- Move all state into the sandbox → sandbox sessions are ephemeral; state must persist.
- Sandbox read-only → O'Brien must write briefs, decisions, escalations.
- Wormhole inside the sandbox → a sandbox process cannot write to macOS without the prompt.

---

## Constraints (hard requirements)

1. **Claude Desktop must be running.** Wormhole only operates while Claude Desktop is open. This is not a risk; it is a constraint of the system. Claude Desktop is the human-machine interface for this product.
2. **Tool consent is per-session.** First call to a Wormhole tool in a new Cowork session triggers a one-click MCP consent prompt. Accepted as a design contract. Implication: scheduled-task and Dispatch-triggered sessions need a consent-preflight pattern — see §Open questions.
3. **Single workspace root.** Wormhole is configured with one `WORKSPACE_ROOT` at install time (absolute macOS path). All relative paths in tool calls resolve against it.

---

## Security rules

These are non-negotiable and must be enforced in server code, not by convention.

### Path scoping

All write tools take a relative path. The server:

1. Rejects absolute paths outright.
2. Rejects paths containing `..` segments.
3. Resolves `WORKSPACE_ROOT + relativePath` to an absolute canonical path (`fs.realpath` or equivalent).
4. Asserts the resolved path starts with `WORKSPACE_ROOT` *after* canonicalization — catches symlink escape.
5. Only then performs the write.

Violations return a structured error, never silently succeed outside the workspace.

### Content scoping

Wormhole never reads, accepts, or returns:

- Environment variables (including `process.env` introspection tools).
- Files outside `WORKSPACE_ROOT` (no read tool with arbitrary paths — reads stay on VirtioFS).
- Credentials, tokens, secrets of any kind. The server has no business accessing them.

The tool surface is writes only. Reads remain on the VirtioFS path. This keeps the blast radius of any Wormhole bug confined to writing inside the workspace.

### Server surface

Initial tool set (Slice 1):

- `wormhole_write_file(path, content, {mode?, encoding?})` — overwrite or create file.
- `wormhole_append_jsonl(path, line)` — append one JSON line (validates that `line` is a JSON object, appends `\n`).
- `wormhole_move(from, to)` — rename within workspace. Both paths scope-validated.
- `wormhole_delete(path)` — remove file. Scope-validated. **No recursive directory delete in initial scope.**

No `wormhole_exec`, no `wormhole_shell`, no `wormhole_read_any`. Tool set stays narrow and auditable.

---

## Implementation rules

### Stdio protocol discipline

MCP over stdio uses stdout as the protocol channel. Any `console.log` in server code corrupts the protocol stream. All logging goes to stderr (`console.error` or a structured logger writing to stderr). A lint rule or CI check must enforce this — a stray stdout print in a tool body is a silent-failure foot-gun.

### Defensive error handling

No unhandled exception in a tool body may crash the server process. Every tool handler wraps its body in a try/catch and returns a structured error response on failure. Server process lives for the lifetime of the Cowork session; a crash leaves the session broken until restart.

### Concurrency

Multiple Cowork sessions running simultaneously each spawn their own Wormhole server process (one per stdio client). Combined with watcher.js on the host, three+ processes may compete for the same file.

- **Per-slice files** (`bridge/queue/*.md`, `bridge/obrien-escalations/*.md`, `.claude/roles/*/inbox/HANDOFF-*.md`) — single writer per file. No contention.
- **Append-heavy files with multiple writers** (`bridge/timesheet.jsonl`, `bridge/anchors.jsonl`, `bridge/tt-audit.jsonl`) — **writer-split**. Each writer appends to a per-role file (`timesheet-obrien.jsonl`, `timesheet-watcher.jsonl`, etc.). Merged view (`timesheet.jsonl`) is rebuilt by watcher on change, sorted by timestamp. This is the same strategy recommended in the prior ADR; it survives the architecture pivot.

Writer-split migration is a slice of its own — see §What O'Brien builds.

### VirtioFS read-after-write

Reads inside Cowork go through VirtioFS. Ad-hoc testing so far shows writes are immediately visible, but we should not assume. Watcher and any Cowork-side reader of Wormhole-written files retry once with a short delay on `ENOENT` or empty-content reads. Trivial to implement; removes a whole class of intermittent failures.

---

## What O'Brien builds

### Slice 1: Wormhole MCP server — core

- `wormhole/server.js` — MCP server implementing the four tools above, with full path/content scoping.
- `wormhole/config.js` — loads `WORKSPACE_ROOT` from env or config file; fails fast if unset or invalid.
- `wormhole/logging.js` — stderr-only structured logger (slicelog pattern).
- `wormhole/package.json` — SDK dependency, Node engine requirement.
- Integration tests: path traversal, symlink escape, invalid JSONL, missing parent dir, large content.

### Slice 2: Writer-split migration

- `bridge/migrate-writer-split.js` — one-shot: splits existing `timesheet.jsonl`, `anchors.jsonl`, `tt-audit.jsonl` into `-<role>.jsonl` files.
- Update O'Brien's wrap-up and any other sandbox-side appenders to call `wormhole_append_jsonl` against `*-obrien.jsonl`.
- Update watcher.js to write its side to `*-watcher.jsonl` and rebuild the merged view on change.
- Update readers (Ops Center, reports) to read the merged view.

### Slice 3: Consent preflight for scheduled / Dispatch sessions (pending Open question #1)

- Scoped once we confirm the behavior of headless sessions. Likely a `wormhole_ping`-style warmup call at session start that triggers the consent prompt when the user is present, so later scheduled work runs silently.

### Slice 4: Cutover

- Switch `claude_desktop_config.json` registration from `wormhole-poc` to the production path.
- Archive or delete `wormhole-poc/`.
- Document install in `repo/README` (config snippet + restart instructions).

### Not O'Brien — configuration / Philipp

- Initial `claude_desktop_config.json` entry (one absolute path, one restart).
- Future re-point if the workspace folder moves.
- One-time consent click per new Cowork session (see Open question #1).

---

## Open questions (deferred, not blocking)

1. **Headless / Dispatch-triggered consent behavior.** Accepted constraint: first tool call in a session requires a click. Unknown: does a scheduled-task or Dispatch-triggered session *with no human present* see the prompt queue and stall, or does it fail fast, or does consent somehow carry across from the interactive session that set it up? Resolved by live test during O'Brien activation work. If it stalls, Slice 3 (consent preflight) becomes a blocker for the drain.

2. **Cross-session new-window consent scope.** Smaller version of #1: does a second Cowork window opened alongside the first also require its own consent click? Tested with a one-minute experiment; disposition drives whether Slice 3 is needed at all.

3. **Docker implications.** Not a Sprint 3 concern. If Docker enters the picture later, Docker containers that need to write to the workspace folder either go through Wormhole (if reachable from the container) or have their own bridge. Wormhole is not N-way; it's one macOS process serving Cowork via MCP. Docker is a separate ADR when it arrives.

---

## Risks accepted

| Risk | Severity | Mitigation |
|---|---|---|
| Per-session consent click | Low | Accepted as design contract; Slice 3 handles headless case if needed |
| Multi-writer concurrency | Low | Writer-split strategy; flock as backup if split proves insufficient |
| Stdio protocol foot-gun (stdout pollution) | Low | Enforced by lint/CI; structured stderr logger from day one |
| Server crash resilience | Low | Tool bodies must not throw; defensive wrapping mandatory |
| VirtioFS read-after-write lag | Very low | Retry wrapper on reads |
| Claude Desktop not running | Not a risk | Hard requirement — Claude Desktop is the HMI |

---

## Decisions needed from Philipp

None blocking. Open questions #1 and #2 resolve through experiment, not design debate. Slicing proceeds.

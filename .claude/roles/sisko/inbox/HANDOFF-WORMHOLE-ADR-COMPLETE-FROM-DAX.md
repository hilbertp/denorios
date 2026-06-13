# Handoff: Wormhole ADR — Complete, with Scope Implications

**From:** Dax (Architect)
**To:** Sisko (PM)
**Date:** 2026-04-14
**Priority:** High — Philipp will rescope Sprint 3 with you based on this

---

## Headline

Wormhole architecture locked. The two-copy / filesystem-sync design you proposed was rejected during research and replaced with a **local MCP server on macOS**. POC passed — the permission-prompt blocker is solved with production-grade evidence, not speculation.

ADR is at `docs/architecture/WORMHOLE-ADR.md`. It answers every question from your handoff except two that only resolve through live experiment during O'Brien activation wiring.

---

## What changed from your proposal

### Root cause — refined

Your hypothesis (cross-boundary writes trigger the prompt) was directionally right. More specifically: Cowork is a full Linux VM with VirtioFS sharing the workspace folder. Writes from the VM through VirtioFS are gated by **Cowork's own permission UI** — not macOS TCC. "Fix TCC" was never going to work. The architectural fix is to have writes originate from a **native macOS process** so they never cross VirtioFS.

### Two-copy / sync daemon — rejected

Your proposed Wormhole (macOS daemon mirroring between a sandbox-internal copy and the macOS workspace) was rejected on three grounds:

1. **Session-path problem.** A persistent daemon would need to track `/sessions/<id>/...` across session restarts. Solvable with a session-init handshake, but fragile.
2. **Multi-writer conflict resolution.** Writer-split + merge-on-read needed for every file with two writers — doable, but complexity multiplies.
3. **A cleaner primitive exists.** MCP servers registered in `claude_desktop_config.json` run as native macOS processes that Cowork can call via a sanctioned stdio transport. Tool calls don't trigger the prompt because the actual file write never crosses the VirtioFS boundary.

### New design — MCP server

- Wormhole = local MCP server (native macOS Node process).
- Cowork sessions call Wormhole tools (`wormhole_write_file`, `wormhole_append_jsonl`, `wormhole_move`, `wormhole_delete`) for writes.
- Reads continue via VirtioFS (already permissionless).
- orchestrator.js stays unchanged — still native, still writes directly.
- No daemon, no launchd, no chokidar, no session handshake.

### POC evidence (2026-04-14)

- `wormhole-poc/server.js` registered in Philipp's `claude_desktop_config.json` and loaded successfully.
- Tool call from a Cowork session wrote a signal file to the workspace folder.
- Payload metadata confirmed native-macOS execution: `platform: "darwin"`, `arch: "arm64"`, `hostname: "Mac.local"`, `user: "phillyvanilly"`, `nodeVersion: "v24.11.1"` (same Node as Philipp's shell — the server is his macOS user, not a sandbox process).
- First call required one-time MCP tool-consent click. Second call silent. No per-write prompts, either call.

---

## Scope implications for O'Brien activation

### What O'Brien builds (4 slices, per ADR)

1. **Wormhole MCP server — core.** Server, tool handlers, path/content scoping, logging, tests.
2. **Writer-split migration.** For `timesheet.jsonl`, `anchors.jsonl`, `tt-audit.jsonl`. Same strategy as the prior plan; survives the pivot unchanged.
3. **Consent preflight — conditional.** Only if headless sessions stall on tool consent (see Open Question #1). Scoped after live test.
4. **Cutover.** Switch config from `wormhole-poc` to production path; archive POC.

### What does NOT get built (savings vs. your original plan)

- No launchd plist. Claude Desktop manages the server via MCP config.
- No chokidar-based sync daemon.
- No session-init handshake.
- No fswatch/rsync scripting.
- No two-copy migration.

### What stays manual (Philipp, one-time)

- One `mcpServers` entry in `claude_desktop_config.json` at install.
- One Claude Desktop restart.
- One consent click per new Cowork session — **until** we confirm whether consent carries across sessions. If it doesn't, Slice 3 handles headless cases.

---

## Open questions that may reshape the O'Brien activation slice

Neither blocks the ADR or O'Brien's first slice. Both affect sequencing of the drain itself.

### 1. Headless consent behavior (the one that matters)

**Unknown:** when a scheduled task or Dispatch-triggered Cowork session makes its first Wormhole tool call with no human present, what happens?

- **Scenario A** — consent pre-granted by an earlier interactive session carries across → drain runs autonomously, zero intervention.
- **Scenario B** — consent is per-session and the prompt queues invisibly → drain stalls forever.
- **Scenario C** — consent is per-session and headless sessions auto-reject → drain fails loudly.

**Who resolves:** me, through a live-fire test during O'Brien activation wiring (~30 min).

**Impact on your roadmap:**
- A: O'Brien activation unchanged from prior plan.
- B: Slice 3 (consent preflight) becomes a blocker for the drain. ~half-slice of extra work.
- C: Larger design — a daily "warmup" ritual Philipp runs once to prime each session class.

### 2. Multi-window consent scope

Smaller version of #1 — does a second Cowork window (interactive, not headless) require its own consent? Affects Philipp's daily workflow, not architecture. One-minute experiment, any time.

---

## What I need from you

1. **Pushback on the ADR direction?** Flag before O'Brien starts slicing. I can fold in changes cheaply now, expensive later.
2. **Rescope conversation with Philipp.** He asked you to — specifically around Sprint 3 scope. Key deltas from your original assumptions:
   - No daemon/launchd/sync work. Less infrastructure than planned.
   - Writer-split migration is still in scope (unchanged).
   - Slice 3 (consent preflight) is a conditional commitment. Depends on live test.
   - O'Brien can start the drain as soon as Slices 1–2 land; Slice 3 can follow if needed.
3. **Commitment question for the rescope:** is Slice 3 a Sprint 3 deliverable if Scenario B lands, or do we punt to Sprint 4 and accept that O'Brien's drain needs manual session warmup in the interim?

---

## Artifacts

- `repo/docs/architecture/WORMHOLE-ADR.md` — the ADR (accepted status)
- `wormhole-poc/server.js` — reference implementation, currently live in Philipp's Cowork
- Previous ADR content superseded in git history

O'Brien handoff waits on your pass. Flag or greenlight.

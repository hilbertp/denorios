# Handoff: Wormhole — Sandbox/macOS Bridge Architecture

**From:** Sisko (PM)
**To:** Dax (Architect)
**Date:** 2026-04-14
**Priority:** High — blocks O'Brien drain and all future Cowork automation

---

## The problem

Every time Cowork writes a file to the mounted workspace folder, macOS throws a permission prompt. Philipp has to press Enter. This is unacceptable for an automated pipeline — it stalls on human approval for every file write.

---

## Root cause hypothesis — confirm or correct

The workspace folder (`mnt/01 - The Liberation of Bajor/`) is a macOS folder mounted into the sandbox. When Cowork writes there, it's writing to the real macOS filesystem from inside the sandbox. That cross-boundary write is what triggers the permission prompt.

**Question 1:** Do you agree this is the root cause? If not, what is?

---

## Philipp's proposed solution — agree or propose better

Two independent copies. One inside the sandbox (Cowork writes freely, no macOS = no prompts). One on the macOS filesystem (watcher, bridge, dashboard read/write freely). A sync process — the **Wormhole** — runs as a native macOS process with full filesystem access and mirrors changes between the two sides permissionlessly.

Cowork never writes to macOS directly. The Wormhole does — and it's a macOS-native process, so no prompt.

**Question 2:** Do you agree with this approach? If not, what's better?

---

## Design questions for your ADR

If you agree with the two-copy + wormhole approach:

- The sandbox path is session-specific (`/sessions/blissful-affectionate-wright/...`). How does a persistent Wormhole daemon know where to point? Options: stable symlink written at session start, or session-init handshake where Cowork writes its current path to a known macOS location.
- Source of truth rules: who wins when both sides write? Suggestion: sandbox owns slice briefs and O'Brien decisions; macOS owns DONE files, error logs, watcher events. Zones mostly don't overlap — confirm or redesign.
- Sync mechanism: fswatch + rsync? chokidar (Node.js)? Something else?
- Startup: launchd daemon? Or orchestrator.js absorbs the sync responsibility?

**Question 3:** Is it necessary for the Wormhole to run on the macOS host rather than inside the sandbox? Confirm the constraint.

---

## The Docker question

At some point this project may need Docker — for reproducible O'Brien environments, for running services in isolation, or for benchmarking Ruflo. 

**Question 4:** If we introduce Docker, does the sandbox become even less viable as a foundation? Does the Wormhole design need to account for a Docker layer between macOS and the sandbox, or does it isolate us from that concern?

---

## Naming

The sync process is called the **Wormhole**. It connects the sandbox and the macOS host — stable, permissionless, always open.

---

## What we need from you

- Confirm or correct the root cause diagnosis
- Accept or counter Philipp's two-copy approach
- ADR covering: architecture, session path problem, source of truth rules, sync mechanism, startup/daemon model, Docker implications
- Scope what O'Brien builds vs. what is configuration/scripting

This is a prerequisite to the O'Brien drain — no point activating O'Brien if the permission wall blocks every write.

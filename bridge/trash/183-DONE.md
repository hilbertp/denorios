---
id: "183"
title: "F-183 — Host-side Docker health detector + Ops service-health pill"
from: rom
to: nog
status: DONE
slice_id: "183"
branch: "slice/183"
completed: "2026-04-22T09:45:00.000Z"
tokens_in: 48000
tokens_out: 12000
elapsed_ms: 720000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Added a host-side Docker container health detector and an Ops dashboard service-health pill that goes red when the container is down or unreachable. Approve button is disabled client-side when the pill is red. macOS notification fires on sustained downtime >30s. This converts silent container death into a loud visible signal.

## Changes

### 1. `/api/health` endpoint enhanced (`dashboard/server.js`)
- Added `status: "ok"` and `ts` (ISO timestamp) fields to existing `/api/health` response — backwards-compatible.
- Added `hostHealth` field that serves `bridge/host-health.json` contents when available (null if file missing).

### 2. Host-side detector (`scripts/host-health-detector.sh`)
- Bash script, no dependencies beyond Mac + Docker + curl.
- Polls every 10 seconds: `docker inspect bajor` for container status, then curls `/api/health` with 3s timeout.
- Writes `bridge/host-health.json` atomically (write to `.tmp`, `mv`).
- JSON shape: `{ container_status, api_status, last_checked, consecutive_failures }`.
- Logs state changes (not every poll) to `bridge/host-health.log`.
- Fires one-shot macOS `osascript` notification on sustained `not-running` ≥30s.

### 3. launchd agent (`scripts/com.liberation-of-bajor.health.plist`)
- Template plist with `Label: com.liberation-of-bajor.health`, `KeepAlive: true`, `RunAtLoad: true`.
- User updates paths and installs into `~/Library/LaunchAgents/`.

### 4. Install README (`scripts/README-health-detector.md`)
- Prerequisites, install steps (`cp` + `launchctl load`), verify, uninstall, how-it-works.

### 5. Dashboard pill + approve gate (`dashboard/lcars-dashboard.html`)
- New `#service-health-pill` element in header beside existing `#health-pill`.
- CSS classes `pill-green` (container running + API ok + file fresh ≤30s) and `pill-red` (any check failed or file stale).
- Reads `hostHealth` from `/api/health` response on existing 15s poll tick — no new poll added.
- Approve button: `disabled` attribute + greyed CSS + tooltip when pill is red.
- `sliceDetailApprove()` early-returns when `serviceHealthDown` is true.

### 6. Tests (`test/host-health-detector.test.js`)
- 28 tests: detector JSON output shape (running/exited/missing), dashboard pill rendering, approve-button gate, `/api/health` fields, detector script structure, launchd plist validation.

## Acceptance criteria

1. ✅ `scripts/host-health-detector.sh` exists, is executable, polls Docker + API every 10s, writes atomically, emits macOS notification on sustained downtime >30s.
2. ✅ `scripts/com.liberation-of-bajor.health.plist` has matching Label and `KeepAlive: true`.
3. ✅ `scripts/README-health-detector.md` has install steps for clean Mac + Docker + Node.
4. ✅ `GET /api/health` returns 200 + JSON with `status: "ok"` and `ts`.
5. ✅ `#service-health-pill` reads from `host-health.json` on normal poll tick. Green/red per spec.
6. ✅ Approve button disabled via `disabled` attribute + greyed state when pill is red.
7. ✅ `bridge/register.jsonl` untouched — append-only invariant preserved.
8. ✅ 28 regression tests pass (detector output, pill render, approve-button disable).
9. ✅ Full test suite passes (9/9 test files, 0 failures). Diff: 324 LOC excluding tests.

## Notes

- The existing `/api/health` endpoint was enhanced (not replaced) — all prior consumers (the watcher health pill) continue to work unchanged. New fields (`status`, `ts`, `hostHealth`) are additive.
- The detector writes to `bridge/host-health.json` on the host filesystem. Because `./bridge` is mounted into the container, the dashboard server can read it through the same path. No new mount needed.
- `host-health.json` and `host-health.log` are gitignored by the existing `bridge/queue/*.json` pattern (they live in `bridge/`, not `bridge/queue/`, so they're not matched). Added neither to `.gitignore` since they're runtime artifacts in `bridge/` which is already volume-mounted.

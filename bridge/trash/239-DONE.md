---
id: "239"
title: "F-WI — launchctl plist: keep orchestrator alive across sleep/crash"
from: rom
to: nog
status: DONE
slice_id: "239"
branch: "slice/239"
completed: "2026-04-27T16:12:00.000Z"
tokens_in: 18000
tokens_out: 4500
elapsed_ms: 120000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Created three new files to manage the orchestrator as a macOS launchd user agent:

1. **`scripts/dev.liberation.orchestrator.plist`** — launchd plist with:
   - `KeepAlive = true` (auto-restart on crash)
   - `RunAtLoad = false` (manual load only)
   - Hardcoded node path: `/Users/phillyvanilly/.nvm/versions/node/v24.11.1/bin/node`
   - WorkingDirectory set to repo root
   - HOME environment variable set for Node path resolution
   - Stdout/stderr → `bridge/logs/orchestrator.stdout.log` / `orchestrator.stderr.log`

2. **`scripts/orch-start.sh`** — Symlinks plist into `~/Library/LaunchAgents/`, ensures `bridge/logs/` exists, unloads then loads the agent.

3. **`scripts/orch-stop.sh`** — Unloads the agent.

Both shell scripts are `chmod +x`.

## Acceptance criteria

- [x] AC1. Valid launchd plist — confirmed via `plutil -lint`: OK
- [x] AC2. orch-start.sh symlinks and loads via launchctl
- [x] AC3. orch-stop.sh unloads the agent
- [x] AC4. KeepAlive = true
- [x] AC5. RunAtLoad = false
- [x] AC6. Stdout/stderr redirected to bridge/logs/
- [x] AC7. No changes to orchestrator.js or any existing file
- [x] AC8. plutil -lint validation: `/private/tmp/ds9-worktrees/239/scripts/dev.liberation.orchestrator.plist: OK`

## Files created

- `scripts/dev.liberation.orchestrator.plist`
- `scripts/orch-start.sh`
- `scripts/orch-stop.sh`
- `bridge/logs/.gitkeep`

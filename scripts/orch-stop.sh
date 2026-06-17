#!/bin/bash
# orch-stop.sh — Unload the orchestrator launchd agent
PLIST="$HOME/Library/LaunchAgents/dev.liberation.orchestrator.plist"
launchctl unload "$PLIST" 2>/dev/null && echo "Orchestrator agent unloaded." || echo "Agent was not loaded."

#!/usr/bin/env bash
# install-dashboard-service.sh — install the Ops dashboard as a launchd user agent.
#
# The dashboard had no supervisor: it died with whatever terminal or script started it,
# which read from the outside as "the server keeps crashing" (slice 403). This installs
# dev.denorios.dashboard the same way the orchestrator is installed — a symlink from the
# LaunchAgents directory to the tracked plist in scripts/, so editing the plist in the
# repo is enough and nothing has to be re-copied.
#
# Re-runnable: a second run replaces the symlink and reloads the job.
#
# LAUNCH_AGENTS_DIR and LAUNCHCTL exist so the regression suite can install into a
# throwaway directory against a stub launchctl without touching the host's real agents.
set -euo pipefail

LABEL="dev.denorios.dashboard"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_PLIST="$SCRIPT_DIR/$LABEL.plist"

LAUNCH_AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
LAUNCHCTL="${LAUNCHCTL:-launchctl}"
INSTALLED_PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"

if [ ! -f "$SOURCE_PLIST" ]; then
  echo "install-dashboard-service: missing $SOURCE_PLIST" >&2
  exit 1
fi

# A fresh machine has neither directory. launchd writes the job's stdout/stderr itself
# and will not create their parent, so make it here rather than debug a silent job later.
mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$REPO_ROOT/bridge/logs"

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "Warning: $REPO_ROOT/.env is missing — node --env-file refuses to start without it."
fi

# -n matters: without it, ln follows an existing symlink, and a link that happens to point
# at a directory collects a SECOND plist inside that directory while the stale link survives.
ln -sfn "$SOURCE_PLIST" "$INSTALLED_PLIST"
echo "Linked $INSTALLED_PLIST -> $SOURCE_PLIST"

# Unload before loading so a re-run replaces a running job instead of erroring on it
# ("service already loaded"). Guarded by list because on a first install nothing is
# loaded, and an unconditional unload exits non-zero and would abort this script.
if "$LAUNCHCTL" list "$LABEL" >/dev/null 2>&1; then
  "$LAUNCHCTL" unload "$INSTALLED_PLIST"
  echo "Unloaded running $LABEL"
fi

"$LAUNCHCTL" load "$INSTALLED_PLIST"
echo "Loaded $LABEL"

echo "State:"
"$LAUNCHCTL" list "$LABEL" \
  || echo "  $LABEL is not listed — see $REPO_ROOT/bridge/logs/dashboard.stderr.log"

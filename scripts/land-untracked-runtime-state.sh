#!/usr/bin/env bash
#
# land-untracked-runtime-state.sh — slice 372, landing step
#
# WHY THIS EXISTS
#
#   Slice 372 stops tracking the volatile runtime state. `git rm --cached` spares
#   THIS worktree, but the deletion is real in the commit — so merging slice/372
#   into dev acts on the live pipeline's working tree, and there is no good branch:
#
#     • dev's tree dirty at that moment (the normal case — the heartbeat ticks every
#       60 s and these files are still tracked on dev) → the orchestrator's
#       pre-checkout autocommit lands a MODIFICATION on dev, the drift merge hits
#       modify/delete, and the slice strands as `merge_conflict`.
#     • dev's tree clean → the squash merge succeeds and REMOVES the files from the
#       live working tree, taking bridge/timesheet.jsonl (the project's economics
#       ledger), bridge/anchors.jsonl and bridge/tt-audit.jsonl with it.
#
#   The code on the branch defends against both — but it cannot defend the run that
#   lands it, because the orchestrator performing that merge is still executing dev's
#   code. So the untracking is landed here first, by hand, as a Layer-0 change: after
#   this commit the branch and dev agree, and there is no delete-vs-modify left to
#   resolve.
#
# WHAT IT DOES
#
#   1. Refuses to run anywhere but the MAIN working tree on the integration branch.
#   2. Copies every ledger to a timestamped backup directory before touching git.
#   3. `git rm --cached` — index only. Nothing is removed from disk.
#   4. Commits (DS9_WATCHER_MERGE=1 — this is the sanctioned Layer-0 path).
#   5. Verifies every file is STILL ON DISK, readable and unchanged in size.
#
#   Idempotent: with nothing left tracked it reports so and exits 0.
#
# USAGE
#
#   bash scripts/land-untracked-runtime-state.sh            # land it
#   bash scripts/land-untracked-runtime-state.sh --dry-run  # show what would happen

set -eo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

INTEGRATION_BRANCH="${DS9_INTEGRATION_BRANCH:-dev}"

# The main working tree, not whichever worktree this script was invoked from.
GIT_DIR_ABS=$(cd "$(git rev-parse --git-dir)" && pwd)
GIT_COMMON_ABS=$(cd "$(git rev-parse --git-common-dir)" && pwd)
if [ "$GIT_DIR_ABS" != "$GIT_COMMON_ABS" ]; then
  echo "refusing: this is a worktree. Run it from the main checkout — the untracking must land on ${INTEGRATION_BRANCH} itself." >&2
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "$INTEGRATION_BRANCH" ]; then
  echo "refusing: on '${BRANCH}', expected '${INTEGRATION_BRANCH}'." >&2
  exit 1
fi

# Kept in step with bridge/state/seed-runtime-state.js — RUNTIME_FILES + the
# volatile trash markers. Changing one without the other reopens the autocommit.
RUNTIME_PATHS=(
  bridge/heartbeat.json
  bridge/queue-order.json
  bridge/state/branch-state.json
  bridge/timesheet.jsonl
  bridge/timesheet-watcher.jsonl
  bridge/anchors.jsonl
  bridge/anchors-watcher.jsonl
  bridge/tt-audit.jsonl
  bridge/tt-audit-watcher.jsonl
  bridge/.usage-snapshot.json
)

# Only what is actually tracked right now.
TRACKED=()
for p in "${RUNTIME_PATHS[@]}"; do
  if git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then TRACKED+=("$p"); fi
done

# bridge/trash/ holds two populations: volatile pipeline markers (untrack) and
# archived slice reports, which CLAUDE.md makes permanent records (keep). Only the
# markers are swept — a report is any *-DONE/ERROR/ARCHIVED-shaped queue file.
TRASH_TRACKED=()
while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in
    *-DONE.md|*-ERROR.md|*-ARCHIVED.md|*-ACCEPTED.md|*-STUCK.md) continue ;;
  esac
  TRASH_TRACKED+=("$p")
done < <(git ls-files -- 'bridge/trash/' 2>/dev/null || true)

if [ ${#TRACKED[@]} -eq 0 ] && [ ${#TRASH_TRACKED[@]} -eq 0 ]; then
  echo "nothing to do: no volatile runtime state is tracked on ${INTEGRATION_BRANCH}."
  exit 0
fi

echo "Will untrack (index only — nothing leaves the disk):"
for p in "${TRACKED[@]}"; do echo "  $p"; done
[ ${#TRASH_TRACKED[@]} -gt 0 ] && echo "  + ${#TRASH_TRACKED[@]} volatile bridge/trash/ marker(s)"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "--dry-run: stopping here. Nothing was changed."
  exit 0
fi

# Step 2 — back the ledgers up before git is involved at all.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="bridge/trash/runtime-state-backup-${STAMP}"
mkdir -p "$BACKUP_DIR"
for p in "${TRACKED[@]}"; do
  [ -f "$p" ] && cp -p "$p" "${BACKUP_DIR}/$(echo "$p" | tr '/' '_')"
done
echo "Backed up to ${BACKUP_DIR}/"

# Record sizes so step 5 can prove nothing was truncated.
declare -a BEFORE_SIZES=()
for p in "${TRACKED[@]}"; do
  if [ -f "$p" ]; then BEFORE_SIZES+=("$(wc -c < "$p" | tr -d ' ')"); else BEFORE_SIZES+=("-"); fi
done

# Step 3 — --cached: the index forgets, the disk does not.
[ ${#TRACKED[@]} -gt 0 ] && git rm --cached --quiet -- "${TRACKED[@]}"
[ ${#TRASH_TRACKED[@]} -gt 0 ] && git rm --cached --quiet -- "${TRASH_TRACKED[@]}"

# Step 4 — Layer-0 commit. The pre-commit hook requires this env var in the main tree.
DS9_WATCHER_MERGE=1 git commit --quiet -m "S372 (landing): untrack volatile runtime state on ${INTEGRATION_BRANCH}

Index-only removal (git rm --cached) so slice/372 and ${INTEGRATION_BRANCH} agree on
these paths before the slice merges. Without this the drift merge hits
modify/delete and strands the slice, or the squash succeeds and removes the
live timesheet/anchors/tt-audit ledgers from the working tree.

Nothing is deleted from disk. bridge/state/seed-runtime-state.js seeds these
files on a fresh clone and restores them from git history if they ever do go
missing.

Backup: ${BACKUP_DIR}"

# Step 5 — prove the disk is untouched.
FAILED=0
i=0
for p in "${TRACKED[@]}"; do
  before="${BEFORE_SIZES[$i]}"
  i=$((i + 1))
  [ "$before" = "-" ] && continue
  if [ ! -f "$p" ]; then
    echo "FAIL: ${p} is gone from disk" >&2; FAILED=1; continue
  fi
  after=$(wc -c < "$p" | tr -d ' ')
  # The orchestrator may legitimately have appended between steps; only shrinkage
  # is a fault.
  if [ "$after" -lt "$before" ]; then
    echo "FAIL: ${p} shrank ${before} → ${after} bytes" >&2; FAILED=1
  fi
done

if [ "$FAILED" = "1" ]; then
  echo "" >&2
  echo "Restore from ${BACKUP_DIR}/ before doing anything else." >&2
  exit 1
fi

echo ""
echo "Landed. ${INTEGRATION_BRANCH} no longer tracks the volatile runtime state; every file is still on disk."
echo "Next: merge slice/372 as normal — the delete-vs-modify conflict is gone."

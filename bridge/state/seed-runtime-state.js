'use strict';

/**
 * seed-runtime-state.js — slice 372
 *
 * The volatile runtime state (heartbeat ticks, queue ordering, branch topology,
 * timesheets, trash bookkeeping) is deliberately NOT tracked by git: while it was
 * tracked the working tree was permanently dirty, so the orchestrator's defensive
 * pre-checkout autocommit swept machine bookkeeping into a commit on the
 * integration branch on every single slice run.
 *
 * Untracking it means nothing in a fresh clone recreates these files, and several
 * of them are read before they are first written (branch-state.json in particular
 * has a schema the dashboard and the gate both parse). So every entry point seeds
 * them instead: ensureRuntimeState() creates any that are missing, with a valid
 * empty-but-well-formed body, and never touches one that already exists.
 *
 * ── Restoring, not just seeding ────────────────────────────────────────────────
 * Untracking has one sharp edge, and it is not at `git rm --cached` time: it is at
 * MERGE time. `--cached` spares this worktree, but the deletion is real in the
 * commit, so whoever merges the branch has the files removed from THEIR working
 * tree — and that worktree is the live pipeline. Most of these files are cheap to
 * lose (the next tick rewrites them); the append-only ledgers are not. The
 * timesheet is the project's whole economics record and `rebuildMerged()` in
 * slicelog.js reconstructs it by reading `timesheet-*.jsonl` off disk — which this
 * slice untracks too. Seeding `''` over that gap turns "missing" into "empty",
 * which reads as truth and is not.
 *
 * So a file that is absent from disk but still reachable in git history is
 * RESTORED from history first, and only falls back to the empty body when history
 * has nothing. Heartbeat is the one deliberate exception: a restored `ts` would
 * read as a live orchestrator to every liveness check in the system, and a
 * heartbeat is worth exactly one 60-second tick. It is always seeded, never
 * restored.
 *
 * Idempotent. Safe to call on every startup, from tests, and from the CLI:
 *
 *   node bridge/state/seed-runtime-state.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createInitialBranchState } = require('./initial-schema');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

// How far back to walk for a surviving blob. The commit that untracked a file is
// the newest entry and holds no blob, so at least 2 are needed; 50 is slack for a
// path that was churned by later merges before anyone noticed it was gone.
const HISTORY_LOOKBACK = 50;

// A restored ledger is bounded by what git already stores; 64 MB is far past any
// plausible size and only exists so a pathological blob fails soft.
const MAX_RESTORE_BYTES = 64 * 1024 * 1024;

// Directories that must exist before anything writes into them.
const RUNTIME_DIRS = [
  'bridge/queue',
  'bridge/state',
  'bridge/trash',
  'bridge/logs',
];

/**
 * A heartbeat that is structurally complete but claims nothing: status idle, no
 * slice, no timestamps. Liveness readers compare `ts` against the clock, so a
 * seeded heartbeat must never look fresh — `ts: null` reads as "never ticked",
 * which is the truth until the orchestrator writes its first real snapshot.
 */
function initialHeartbeat() {
  return {
    ts: null,
    pickup_ts: null,
    status: 'idle',
    current_slice: null,
    current_slice_title: null,
    current_slice_goal: null,
    slice_elapsed_seconds: null,
    last_activity_ts: null,
    processed_total: 0,
    queue: { waiting: 0, active: 0, done: 0, error: 0 },
  };
}

// Each entry: repo-relative path → the body written when the file is absent.
//
// `restore: false` means "never rebuild this from history" — see the heartbeat
// note above. Everything else carries state that no later tick can reconstruct:
// the ledgers are append-only history, queue-order.json is the operator's chosen
// ordering, and branch-state.json holds `dev.deferred_slices` — slices already
// accepted and waiting on the gate, which are silently dropped if it comes back
// blank. Its topology fields are stale after a restore; reconcileBranchState()
// refreshes those against real git on the next tick, and cannot invent a queue.
const RUNTIME_FILES = [
  { rel: 'bridge/heartbeat.json',           restore: false, seed: () => JSON.stringify(initialHeartbeat(), null, 2) + '\n' },
  { rel: 'bridge/queue-order.json',         restore: true,  seed: () => '[]\n' },
  { rel: 'bridge/state/branch-state.json',  restore: true,  seed: () => JSON.stringify(createInitialBranchState(), null, 2) + '\n' },
  { rel: 'bridge/timesheet.jsonl',          restore: true,  seed: () => '' },
  { rel: 'bridge/timesheet-watcher.jsonl',  restore: true,  seed: () => '' },
  { rel: 'bridge/anchors.jsonl',            restore: true,  seed: () => '' },
  { rel: 'bridge/anchors-watcher.jsonl',    restore: true,  seed: () => '' },
  { rel: 'bridge/tt-audit.jsonl',           restore: true,  seed: () => '' },
  { rel: 'bridge/tt-audit-watcher.jsonl',   restore: true,  seed: () => '' },
];

// Paths the pipeline rewrites continuously and git must never be asked to carry.
// Kept next to RUNTIME_FILES so the ignore rules, the seeder and the autocommit
// filter all read from one list. Directory prefixes match everything beneath them.
const VOLATILE_PREFIXES = ['bridge/trash/'];
const VOLATILE_EXTRA = ['bridge/.usage-snapshot.json', 'bridge/register.jsonl'];

// bridge/trash/ holds two populations. Nearly all of it is volatile markers the
// pipeline sweeps aside — `nog-active.json.done`, `slice.md.replaced`,
// `orchestrator.js.branch-checkout`. A minority are archived slice reports, which
// CLAUDE.md makes permanent records and which are force-added past the ignore
// rule. Those must keep behaving like source: committed when they change, written
// on checkout. Anchored at both ends — `372-QUEUED.md.stale-after-MERGED` is debris,
// `372-DONE.md` is a record.
const PERMANENT_TRASH_RE = /^bridge\/trash\/[^/]+-(?:DONE|ERROR|ARCHIVED|ACCEPTED|STUCK)\.md$/;

/**
 * isVolatileRuntimePath(rel)
 *
 * True for a repo-relative path that holds machine bookkeeping rather than source.
 * The autocommit uses this to refuse to sweep such a path into a commit even in
 * the window where it is still tracked (a branch that untracks these files cannot
 * protect the run that lands it — the orchestrator doing the merge is still
 * running the previous code).
 */
function isVolatileRuntimePath(rel) {
  const p = String(rel || '').replace(/^\.\//, '').replace(/\\/g, '/');
  if (!p) return false;
  if (RUNTIME_FILES.some(f => f.rel === p)) return true;
  if (VOLATILE_EXTRA.includes(p)) return true;
  if (PERMANENT_TRASH_RE.test(p)) return false;
  return VOLATILE_PREFIXES.some(prefix => p.startsWith(prefix));
}

/**
 * contentFromHistory(root, rel) → Buffer | null
 *
 * The newest blob for `rel` still reachable from HEAD. `git rev-list HEAD -- <path>`
 * lists the commits that touched the path, newest first; after an untracking commit
 * the newest entry is the deletion itself and holds no blob, so walk down to the
 * first revision that resolves. Returns null outside a git repo, or when the path
 * was never tracked — which is exactly the fresh-clone case, where the seed body is
 * the right answer.
 *
 * `root` must be a repository ROOT (it is always PROJECT_DIR or REPO_ROOT); a
 * subdirectory would fail the `.git` check and fall through to the seed body.
 */
function contentFromHistory(root, rel) {
  // Cheap gate first. ensureRuntimeState is called on every dashboard boot, and
  // the server tests boot it against dozens of throwaway fixture roots that are
  // not repositories at all. Asking git nine times per boot turned a 19-second
  // regression suite into a 12-minute one and starved the port-bound suites into
  // timing out. `.git` is a directory in a clone and a file in a worktree, so one
  // existsSync answers it without spawning anything.
  if (!fs.existsSync(path.join(root, '.git'))) return null;

  let revs;
  try {
    revs = execFileSync('git', ['rev-list', '-n', String(HISTORY_LOOKBACK), 'HEAD', '--', rel], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
  if (!revs) return null;

  for (const rev of revs.split('\n').filter(Boolean)) {
    try {
      return execFileSync('git', ['show', `${rev}:${rel}`], {
        cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_RESTORE_BYTES,
      });
    } catch (_) { /* deleted in this revision — keep walking back */ }
  }
  return null;
}

/**
 * ensureRuntimeState(repoRoot)
 *
 * Creates every missing runtime directory and file. Returns:
 *   seeded   — repo-relative paths created (from history OR from the seed body)
 *   restored — the subset recovered from git history rather than seeded blank
 * so callers can log a fresh-clone bootstrap, and log a recovery loudly.
 *
 * Never overwrites, never truncates, never throws: a read-only or already-locked
 * path must not take down the process that called it.
 */
function ensureRuntimeState(repoRoot) {
  const root = repoRoot || DEFAULT_REPO_ROOT;
  const seeded = [];
  const restored = [];

  for (const rel of RUNTIME_DIRS) {
    try { fs.mkdirSync(path.join(root, rel), { recursive: true }); } catch (_) {}
  }

  for (const { rel, seed, restore } of RUNTIME_FILES) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) continue;
    const fromHistory = restore ? contentFromHistory(root, rel) : null;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // wx: lose the race rather than clobber a file another process just wrote.
      fs.writeFileSync(abs, fromHistory !== null ? fromHistory : seed(), { flag: 'wx' });
      seeded.push(rel);
      if (fromHistory !== null) restored.push(rel);
    } catch (_) {}
  }

  return { seeded, restored };
}

module.exports = {
  ensureRuntimeState,
  initialHeartbeat,
  contentFromHistory,
  isVolatileRuntimePath,
  RUNTIME_FILES,
  RUNTIME_DIRS,
  VOLATILE_PREFIXES,
  VOLATILE_EXTRA,
  PERMANENT_TRASH_RE,
  DEFAULT_REPO_ROOT,
};

if (require.main === module) {
  const { seeded, restored } = ensureRuntimeState(process.argv[2]);
  if (!seeded.length) {
    console.log('Runtime state already present — nothing to seed.');
  } else {
    console.log(`Seeded ${seeded.length} runtime file(s):\n  ${seeded.join('\n  ')}`);
    if (restored.length) {
      console.log(`Recovered from git history (would otherwise have read as empty):\n  ${restored.join('\n  ')}`);
    }
  }
}

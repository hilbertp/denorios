'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');
const { appendTimesheet, updateTimesheet, rebuildMerged } = require('./slicelog');
const { buildNogPrompt } = require('./nog-prompt');
const { translateEvent, translateVerdict, resetDedupeState } = require('./lifecycle-translate');
const gitFinalizer = require('./git-finalizer');
const { reconcileBranchState } = require('./state/branch-state-recovery');
const { recoverGateMutex, acquireGateMutex, releaseGateMutex, shouldDeferSquash } = require('./state/gate-mutex');
const { writeJsonAtomic } = require('./state/atomic-write');
const { emit: emitGateTelemetry } = require('./state/gate-telemetry');
const { computeRR } = require('./rr-compute');
const { ensureRuntimeState, isVolatileRuntimePath, isPipelineOwnedPath } = require('./state/seed-runtime-state');
// The rules for "can this slice be returned to stage?" are shared with the
// dashboard, so the button that offers the action and the code that performs it
// cannot disagree. (Slice 370.)
const { evaluateReturnToStage } = require('./return-to-stage-eligibility');
const approvalProvenance = require('./approval-provenance');
// Julian's stage: the IN_QA state, the eight-item packet, and the sticker that survives
// archive. Pure data — this module never spawns anything (slice 363).
const qaStage = require('./qa-stage');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  pollIntervalMs: 5000,
  inactivityTimeoutMs: 300000, // ms of no stdout/stderr activity before killing the child
  heartbeatIntervalMs: 60000,
  queueDir: 'queue',
  logFile: 'bridge.log',
  heartbeatFile: 'heartbeat.json',
  claudeCommand: 'claude',
  // stream-json (+ required --verbose) emits one NDJSON event per turn as Rom works,
  // so the per-slice rom log grows line-by-line for the live-log viewer; the final
  // {type:"result"} event still carries usage/session_id (see extractResultObject).
  claudeArgs: ['-p', '--verbose', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json'],
  projectDir: '..',
  maxRetries: 0,
  // Branch topology. Slices are born on — and compared against — the INTEGRATION
  // branch; the TRUNK is only what the promote gate fast-forwards. Cutting slices
  // from the trunk is what froze the local ref 42 commits back and manufactured
  // conflicts in slices 348-352 (slice 353).
  integrationBranch: 'dev',
  trunkBranch: 'main',
};

function loadConfig() {
  const configPath = path.join(__dirname, 'bridge.config.json');
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_) {
    // Config file absent or unreadable — proceed with defaults.
    // This is intentional: the orchestrator must work with zero configuration.
  }
  return {
    config: Object.assign({}, DEFAULTS, fileConfig),
    hasDeprecatedTimeoutMs: 'timeoutMs' in fileConfig,
  };
}

const { config, hasDeprecatedTimeoutMs } = loadConfig();

// Branch topology, resolved once. Every git command on the slice path reads these
// — no literal branch name belongs in a lineage, scope or review comparison.
const INTEGRATION_BRANCH = config.integrationBranch;
const TRUNK_BRANCH       = config.trunkBranch;

/**
 * branchNamesFrom(porcelainish)
 *
 * Parses `git branch --contains` / `--merged` output into exact branch names,
 * stripping the `* ` current-branch marker, the `+ ` worktree marker and
 * indentation. Callers MUST compare with === against a whole name.
 *
 * Substring matching here is a live bug, not a hypothetical: this repo carries
 * `dev-linear` and `dev-linear2`, so `output.includes('dev')` is satisfied by a
 * branch that has nothing to do with the integration branch.
 */
function branchNamesFrom(raw) {
  return String(raw || '')
    .split('\n')
    .map(line => line.replace(/^[*+]?\s*/, '').trim())
    // Detached-HEAD rows read "(HEAD detached at abc1234)" — not a branch name.
    .filter(name => name && !name.startsWith('('))
    // "branch -> other" (symbolic ref rows) — keep the left-hand name only.
    .map(name => name.split(' -> ')[0].trim());
}

// ---------------------------------------------------------------------------
// Resolved paths
// ---------------------------------------------------------------------------

let QUEUE_DIR        = path.resolve(__dirname, config.queueDir);
let STAGED_DIR       = path.resolve(__dirname, 'staged');
const LOG_FILE       = path.resolve(__dirname, config.logFile);
// let, not const: a test that asserts on the heartbeat FILE has to be able to point it
// somewhere else first — live bridge state is never touched (#99992).
let HEARTBEAT_FILE   = path.resolve(__dirname, config.heartbeatFile);
let PROJECT_DIR      = path.resolve(__dirname, config.projectDir);
let REGISTER_FILE  = path.resolve(__dirname, 'register.jsonl');

// Register parse cache — invalidated by mtime change; shared across one poll cycle.
let _regCache = null; // { file: string, mtime: number, lines: string[] }

function _getRegLines(file) {
  const f = file || REGISTER_FILE;
  try {
    const mtime = fs.statSync(f).mtimeMs;
    if (_regCache && _regCache.file === f && _regCache.mtime === mtime) {
      return _regCache.lines;
    }
    const lines = fs.readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean);
    _regCache = { file: f, mtime, lines };
    return lines;
  } catch (_) { return []; }
}
const RESTAGED_BOOTSTRAP_MARKER = path.resolve(__dirname, '.restaged-bootstrap-done');
const NOG_ACTIVE_FILE = path.resolve(__dirname, 'nog-active.json');
let TRASH_DIR        = path.resolve(QUEUE_DIR, '..', 'trash');
const WORKTREE_BASE  = '/tmp/ds9-worktrees';
const LOGS_DIR       = path.resolve(__dirname, 'logs');
const ESCALATIONS_DIR = path.resolve(__dirname, 'escalations');
const CONTROL_DIR    = path.resolve(__dirname, 'control');
const PIPELINE_PAUSED_FILE = path.resolve(__dirname, '.pipeline-paused');
const MAX_ROUNDS     = 5; // Absolute cap — no round 6, ever, on any path.

// ── Declared here, not beside the code that uses them (slice 393) ───────────
// The startup block calls crashRecovery() DURING module evaluation, and a
// recovery that lands an orphaned ACCEPTED slice runs the whole squash path
// from inside it. Every module-scope const/let below that block is still in its
// temporal dead zone at that moment: LOCK_FILES sat at the top of the squash
// section and threw "Cannot access 'LOCK_FILES' before initialization" out of
// regenerateLocksAtLanding, after the landing commit and before the register
// event — the daemon exited 1, launchd restarted it, and the second attempt
// found nothing left to squash (slice 389, 2026-09-13 19:25:28Z).
// BRANCH_STATE_PATH is the same landmine one step further on: squashSliceToDev
// reads it inside a try/catch, so the same recovery would have swallowed it as
// "branch-state update failed" and left the dashboard's dev tip stale.
// Anything the recovery landing path reads belongs above the startup block.

// The two DERIVED files the integrity gates (j-coverage-map-integrity,
// j-ac-manifest-integrity) require to equal a fresh regeneration at every commit.
// Nobody hand-edits them; the pipeline owns them (slice 387).
const LOCK_FILES = ['regression/COVERAGE.lock', 'regression/AC-MANIFEST.lock'];

// The dev/main/gate state the dashboard reads. _testSetProjectDir reassigns it.
let BRANCH_STATE_PATH = path.resolve(__dirname, 'state', 'branch-state.json');

// drainDeferredAfterGate's re-entrancy guard (slice 363). Up here rather than beside the
// drain for the reason above: startup recovery can reach the drain through finishQaStage
// while every module-scope binding further down is still in its temporal dead zone.
let _draining = false;

// ── Unreadable-verdict retry cap (slice 372) ────────────────────────────────
// An unparseable Nog verdict is re-queued for another try. The round only
// advances when Nog appends a "## Nog Review — Round N" heading — which is
// exactly what an unreadable verdict fails to do — so MAX_ROUNDS never bit and
// the retry spun at the poll interval: slice 366 logged 297 verdict_unreadable
// events in two hours, and the operator saw only "reviewing for 71 minutes".
//
// This caps the retries WITHIN a round. MAX_ROUNDS still governs how many review
// rounds a slice may have; the two guards are independent.
const MAX_UNREADABLE_ATTEMPTS = 3;
// Backoff before retry N (index = attempts already made). Escalating, so a
// transient hiccup recovers fast and a systematic failure stops burning tokens.
const UNREADABLE_BACKOFF_MS = [60000, 300000];

// Ensure queue + trash + logs + escalations + control directories exist.
fs.mkdirSync(QUEUE_DIR, { recursive: true });
fs.mkdirSync(TRASH_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });
fs.mkdirSync(ESCALATIONS_DIR, { recursive: true });
fs.mkdirSync(CONTROL_DIR, { recursive: true });

// Seed the volatile runtime state (slice 372). These files are untracked, so a
// fresh clone has none of them; the heartbeat, queue order and branch-state
// schema are all read before they are first written. Idempotent — on an
// established workspace this creates nothing.
const _runtimeStateBootstrap = ensureRuntimeState(path.resolve(__dirname, '..'));
const _seededRuntimeState = _runtimeStateBootstrap.seeded;
const _restoredRuntimeState = _runtimeStateBootstrap.restored;

// Deprecation check: timeoutMs was the old wall-clock timeout. It is now ignored.
// Log once at startup if found in the config file.
if (hasDeprecatedTimeoutMs) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'deprecation', msg: 'Config key "timeoutMs" is deprecated and ignored. Use "inactivityTimeoutMs" instead.' });
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Canonical lifecycle suffixes (slice 218)
//
// Only files whose name ends with one of these suffixes are considered live
// pipeline state. Everything else (e.g. -BRIEF.md, -COMMISSION.md, -SLICE.md,
// -NEEDS_AMENDMENT.md, -NEEDS_APENDMENT.md) is pre-terminology residue or an
// unknown future state and must be ignored by the dispatcher, crashRecovery,
// heartbeat counters, and all other queue-directory scans.
//
// Source of truth: docs/contracts/slice-pipeline.md §4.
// ---------------------------------------------------------------------------

const CANONICAL_LIVE_SUFFIXES = [
  '-STAGED.md',
  '-QUEUED.md',
  '-PENDING.md',       // legacy alias for QUEUED — dual-read tolerated
  '-IN_PROGRESS.md',
  '-DONE.md',
  '-IN_REVIEW.md',
  '-REVIEWED.md',      // legacy alias for IN_REVIEW
  '-EVALUATING.md',
  '-PARKED.md',
  '-ACCEPTED.md',
  // Julian's stage holds the slice while it runs (slice 363). QA_QUESTION is a SIDECAR,
  // not a state — nothing is ever "in QA_QUESTION" — but it sits in the queue directory
  // waiting for Philipp, so the startup audit has to know it is expected rather than
  // pre-terminology residue.
  '-IN_QA.md',
  '-QA_QUESTION.md',
  '-ARCHIVED.md',
  '-ERROR.md',
  '-STUCK.md',
];

const CANONICAL_SUFFIX_RE = /-(STAGED|QUEUED|PENDING|IN_PROGRESS|DONE|IN_REVIEW|REVIEWED|EVALUATING|PARKED|ACCEPTED|IN_QA|QA_QUESTION|ARCHIVED|ERROR|STUCK)\.md$/;

// ---------------------------------------------------------------------------
// Activity tracking — updated by invokeRom when child process produces output.
// Exposed at module level so writeHeartbeat can include last_activity_ts.
// ---------------------------------------------------------------------------

let currentLastActivityTs = null; // null when idle, Date object when processing

// ---------------------------------------------------------------------------
// Rate limit state — set when Claude API returns a rate-limit response.
// Poll loop skips dispatch while Date.now() < rateLimitUntil.
// ---------------------------------------------------------------------------

let rateLimitUntil = null; // null = not rate-limited; epoch ms = blocked until

/**
 * parseRateLimitResetMs(stdout)
 *
 * Tries to extract the reset time from a Claude API rate-limit message
 * like: "resets 4am (Asia/Nicosia)"
 * Returns ms from now until the reset, or null if parsing fails.
 */
function parseRateLimitResetMs(stdout) {
  try {
    const match = stdout.match(/resets\s+(\d+)(?::(\d+))?\s*(am|pm)\s*\(([^)]+)\)/i);
    if (!match) return null;

    let hours   = parseInt(match[1], 10);
    const mins  = parseInt(match[2] || '0', 10);
    const amPm  = match[3].toLowerCase();
    const tz    = match[4];

    if (amPm === 'am') {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }

    // Build a Date for today at the reset time in the stated timezone.
    // We do this by formatting the current date parts in the target TZ,
    // constructing an ISO string, then adjusting if the reset is already past.
    const now       = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const localDate = formatter.format(now); // "YYYY-MM-DD"

    // Try today's reset.
    const candidate = new Date(`${localDate}T${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:00`);
    // candidate is in local (watcher) time — convert by using timezone offset.
    // Simpler: express the target as UTC directly via Intl.
    const utcMs = Date.parse(
      `${localDate}T${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:00`
      // This gives local midnight + hours — imprecise across DST but good enough.
    );
    // If that time is already past, add 24h.
    const resetMs = utcMs > Date.now() ? utcMs : utcMs + 86400000;
    const waitMs  = resetMs - Date.now();
    if (waitMs > 0 && waitMs < 86400000) return waitMs; // sanity: < 24h
  } catch (_) {}
  return null;
}

// ---------------------------------------------------------------------------
// Terminal presentation
// ---------------------------------------------------------------------------

// Honor NO_COLOR env var: checked once at startup.
const USE_COLOR = !process.env.NO_COLOR;

// ANSI color codes — empty strings when color is disabled.
const C = {
  green:  USE_COLOR ? '\x1b[32m' : '',
  red:    USE_COLOR ? '\x1b[31m' : '',
  yellow: USE_COLOR ? '\x1b[33m' : '',
  cyan:   USE_COLOR ? '\x1b[36m' : '',
  dim:    USE_COLOR ? '\x1b[2m'  : '',
  reset:  USE_COLOR ? '\x1b[0m'  : '',
};

// Box-drawing characters: Unicode when colors are on, ASCII fallback for NO_COLOR.
const B = {
  dbl:  USE_COLOR ? '\u2550' : '=',  // ═
  sng:  USE_COLOR ? '\u2500' : '-',  // ─
  vert: USE_COLOR ? '\u2502' : '|',  // │
  tl:   USE_COLOR ? '\u250C' : '+',  // ┌
  bl:   USE_COLOR ? '\u2514' : '+',  // └
};

// Symbols: Unicode or ASCII equivalents.
const SYM = {
  check: USE_COLOR ? '\u2713'  : 'OK',   // ✓
  cross: USE_COLOR ? '\u2717'  : 'X',    // ✗
  clock: USE_COLOR ? '\u23F3'  : '...',  // ⏳
  right: USE_COLOR ? '\u25BA'  : '>',    // ►
  back:  USE_COLOR ? '\u21A9'  : '<-',   // ↩
  clip:  USE_COLOR ? '\uD83D\uDCCB ' : '',  // 📋 (with trailing space)
  sep:   USE_COLOR ? ' \u00B7 ' : ' - ', // ' · '
  dash:  USE_COLOR ? ' \u2014 ' : ' - ', // ' — '
  arrow: USE_COLOR ? ' \u2192 ' : ' -> ', // ' → '
  dots:  USE_COLOR ? '\u2026'  : '...',  // …
};

const W = 65; // Box width

function hLine(char) { return char.repeat(W); }

function print(s) { process.stdout.write(s + '\n'); }

function printUnmergedAlert(id, title, branchName) {
  const msg = [
    '',
    '⚠️  UNMERGED BRANCH — Philipp action required',
    `    Slice ${id}: ${title || '(unknown)'}`,
    `    Branch: ${branchName}`,
    '    Status: ACCEPTED but not merged to main',
    `    Fix: git merge --no-ff ${branchName} && git push origin main`,
    '',
  ].join('\n');
  print(msg);
}

function printMergeFailedAlert(id, title, branchName, errorMsg) {
  const msg = [
    '',
    '⚠️  MERGE FAILED — Philipp action required',
    `    Slice ${id}: ${title || '(unknown)'}`,
    `    Branch: ${branchName}`,
    `    Error: ${errorMsg}`,
    `    Fix: git merge --no-ff ${branchName} && git push origin main`,
    '',
  ].join('\n');
  print(msg);
}

// ---------------------------------------------------------------------------
// Timestamps and formatting
// ---------------------------------------------------------------------------

function timestampNow() {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ---------------------------------------------------------------------------
// Token / cost tracking (Task 2)
// ---------------------------------------------------------------------------

const INPUT_COST_PER_M  = 15.00; // $ per 1M input tokens
const OUTPUT_COST_PER_M = 75.00; // $ per 1M output tokens

/**
 * extractResultObject(stdout)
 *
 * Returns the object carrying Claude Code's final totals, robust to BOTH output
 * formats: a single JSON blob (--output-format json) and newline-delimited
 * stream-json, where the final {type:"result"} event holds usage/session_id/cost.
 * Returns null if nothing parseable is found (graceful degradation).
 */
function extractResultObject(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  // 1) Whole-blob JSON (legacy --output-format json).
  try {
    const d = JSON.parse(text);
    if (d && typeof d === 'object' && !Array.isArray(d)) return d;
  } catch (_) { /* not a single blob — try NDJSON below */ }
  // 2) stream-json NDJSON: prefer the last {type:"result"} event, else the last object.
  let result = null, lastObj = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let obj; try { obj = JSON.parse(s); } catch (_) { continue; }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      lastObj = obj;
      if (obj.type === 'result') result = obj;
    }
  }
  return result || lastObj;
}

/**
 * extractTokenUsage(stdout)
 *
 * Extracts token counts from Claude Code's output (json blob or stream-json).
 * Falls back gracefully to nulls if absent (e.g. older Claude Code version).
 */
function extractTokenUsage(stdout) {
  const usage = (extractResultObject(stdout) || {}).usage || {};
  return {
    tokensIn:  typeof usage.input_tokens  === 'number' ? usage.input_tokens  : null,
    tokensOut: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
  };
}

/**
 * extractSessionId(stdout)
 *
 * Extracts session_id from Claude Code's output. With stream-json the id is on
 * the result event AND the init system event, so fall back to scanning any line.
 * Returns the session ID string or null if unavailable.
 */
function extractSessionId(stdout) {
  const data = extractResultObject(stdout);
  if (data && typeof data.session_id === 'string') return data.session_id;
  for (const line of String(stdout || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { const o = JSON.parse(s); if (o && typeof o.session_id === 'string') return o.session_id; } catch (_) { /* skip */ }
  }
  return null;
}

/**
 * shouldForceFreshSession(nogRejectionReason)
 *
 * Returns true when a Nog rejection indicates substantial rework that should
 * NOT reuse Rom's prior session (wrong mental model would carry forward).
 * Triggers: keyword matches OR rejection text > 500 chars.
 */
const FRESH_TRIGGERS = [
  'reconsider approach',
  'wrong design',
  'start over',
  'different approach',
  'rethink',
  'architectural',
  'redesign',
];

function shouldForceFreshSession(reason) {
  if (!reason) return false;
  if (reason.length > 500) return true;
  const lower = reason.toLowerCase();
  return FRESH_TRIGGERS.some(t => lower.includes(t));
}

function computeCost(tokensIn, tokensOut) {
  if (tokensIn == null || tokensOut == null) return null;
  return (tokensIn  * INPUT_COST_PER_M  / 1_000_000)
       + (tokensOut * OUTPUT_COST_PER_M / 1_000_000);
}

/**
 * sessionTelemetry(stdout, durationMs)
 *
 * The session's real numbers, read once from the CLI's own `result` event and
 * the measured wall clock (slice 386). Rom cannot observe his own token counts,
 * so before this the report carried whatever he guessed and three different
 * cost figures existed for one run. Every consumer — the report, the register,
 * the timesheet, the rounds telemetry — is fed from this one object.
 *
 * costUsd is the CLI's own total_cost_usd when the output carries it, because
 * that is the only figure that prices cache reads; computeCost (list price, no
 * cache) is the fallback for output that does not. A value the output does not
 * carry is null, never a zero that would read as a measurement.
 *
 * Returns { tokensIn, tokensOut, tokensCacheRead, elapsedMs, costUsd }.
 */
function sessionTelemetry(stdout, durationMs) {
  const result = extractResultObject(stdout) || {};
  const usage = result.usage || {};
  const { tokensIn, tokensOut } = extractTokenUsage(stdout);
  return {
    tokensIn,
    tokensOut,
    tokensCacheRead: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : null,
    elapsedMs: typeof durationMs === 'number' && isFinite(durationMs) ? durationMs : null,
    costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : computeCost(tokensIn, tokensOut),
  };
}

/**
 * reviewTelemetry(stdout)
 *
 * What one Jordan review cost, read from his own session's `result` event
 * (slice 402). His session has always ended with one — nog-399-round1.log says
 * $1.7242135 — and nothing read it, so the History row summed Sam alone and
 * called the difference "partial".
 *
 * Deliberately NOT sessionTelemetry. That one falls back to computeCost when a
 * session carries no total_cost_usd, because Sam's report must always show a
 * figure and the CLI once shipped without the field. Here there is no fallback:
 * a review that was killed, timed out or rate-limited spent something nobody
 * measured, and a list price is not a measurement. A price computed from
 * INPUT_COST_PER_M would also be wrong twice over — it cannot see cache reads,
 * which are 1,045,779 of that review's 1,063,545 tokens.
 *
 * Only the `result` event counts. extractResultObject falls back to the last
 * JSON object on the stream when no result arrived, and on a killed session
 * that is an assistant message — which carries a usage block of its own. Taking
 * it would write one turn's tokens as the whole review's.
 *
 * Returns an object to SPREAD onto the events the round writes: `{}` when the
 * session wrote no result, so those events are written exactly as they were
 * before rather than carrying four nulls that read as "recorded, and zero".
 */
function reviewTelemetry(stdout) {
  const result = extractResultObject(stdout);
  if (!result || result.type !== 'result') return {};
  const usage = result.usage || {};
  const out = {};
  const keep = (key, value) => { if (typeof value === 'number' && isFinite(value)) out[key] = value; };
  keep('tokensIn', usage.input_tokens);
  keep('tokensOut', usage.output_tokens);
  keep('tokensCacheRead', usage.cache_read_input_tokens);
  keep('costUsd', result.total_cost_usd);
  return out;
}

/**
 * recordBuildTiming(split, id, logsDir)
 *
 * The other half of the session's numbers (slice 392). sessionTelemetry says
 * what the run cost; this says where it went — model seconds and tool seconds
 * per phase, the call count, and the second of the first product edit, read off
 * the same stream-json the CLI already wrote. The full split is parked in
 * bridge/logs/rom-<id>.timing.json beside the log it was derived from (the
 * directory is gitignored, like the log); the three fields the History row
 * needs come back for the DONE register event.
 *
 * Never fails the run. Attribution and the sidecar write fail independently:
 * an unwritable logs directory must not cost the event its phases, and a
 * malformed log must not cost the run its DONE. Returns {} when there is
 * nothing to say, so the caller can spread it unconditionally.
 *
 * The first argument is the split an incremental attributor already produced
 * from the session as it streamed (slice 396) — the daemon no longer holds the
 * session's text to attribute. A string is still accepted and still attributed
 * here, because a log on disk is a string and every test of this path is one.
 *
 * lib/build-timing is required here and not at module scope, the way
 * buildHashLines reaches for lib/ac-block: the daemon has to boot in a tree that
 * has no lib/ at all — the sandbox repo behind slice 393's recovery guard is
 * exactly that — and a measurement is never worth a process that will not start.
 * A missing lib/ is then just another attribution failure: a warn, and a DONE
 * event without phases.
 */
function recordBuildTiming(split, id, logsDir) {
  let timing = null;
  if (split && typeof split === 'object') {
    timing = split;
  } else {
    try {
      const { attributeRun } = require('../lib/build-timing');
      timing = attributeRun(split || '');
    } catch (err) {
      log('warn', 'complete', { id, msg: 'Build-timing attribution failed — the DONE event goes without phases', error: err.message });
      return {};
    }
  }

  try {
    fs.writeFileSync(path.join(logsDir, `rom-${id}.timing.json`), JSON.stringify(timing, null, 2));
  } catch (err) {
    log('warn', 'complete', { id, msg: 'Could not write the build-timing sidecar — the DONE event still carries the split', error: err.message });
  }

  return {
    phases: timing.phases,
    first_product_edit_s: timing.first_product_edit_s,
    calls: timing.calls,
  };
}

// The three metrics the watcher measures. estimated_human_hours is Rom's own
// optional guess and compaction_occurred may be absent; neither is machine data,
// so neither can make a report invalid (slice 386).
const MACHINE_METRICS = ['tokens_in', 'tokens_out', 'elapsed_ms'];

// parseFrontmatter hands back the string 'null' for a literal null, and an
// absent key as undefined. Both mean "the session did not carry this number".
function metricIsNull(value) {
  return value == null || value === '' || value === 'null';
}

/**
 * validateDoneMetrics(meta)
 *
 * A warning-only check on the metric fields AFTER fillDoneMetrics has written
 * the session's numbers (slice 386). Zero is a value, not a failure; so is an
 * absent estimated_human_hours or compaction_occurred. It reports not-ok only
 * when a machine metric is still null, which means the session output was
 * unparseable — a watcher problem, never Rom's. No caller may file an ERROR on
 * it. Returns { ok, invalid }.
 */
function validateDoneMetrics(meta) {
  if (!meta) return { ok: false, invalid: [...MACHINE_METRICS] };
  const invalid = MACHINE_METRICS.filter(key => metricIsNull(meta[key]) || isNaN(parseInt(meta[key], 10)));
  return { ok: invalid.length === 0, invalid };
}

function formatTokens(tokensIn, tokensOut) {
  if (tokensIn == null || tokensOut == null) return 'tokens: unknown';
  return `${(tokensIn + tokensOut).toLocaleString()} tokens`;
}

function formatCost(costUsd) {
  if (costUsd == null) return '';
  return `$${costUsd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Session state (Task 5)
// ---------------------------------------------------------------------------

const session = {
  startTime:  Date.now(),
  completed:  0,
  failed:     0,
  tokensIn:   0,
  tokensOut:  0,
  costUsd:    0,
  hasTokens:  false, // true once we've seen at least one real token count
};

function recordSessionResult(success, tokensIn, tokensOut, costUsd) {
  if (success) session.completed += 1; else session.failed += 1;
  if (tokensIn  != null) { session.tokensIn  += tokensIn;  session.hasTokens = true; }
  if (tokensOut != null) { session.tokensOut += tokensOut; session.hasTokens = true; }
  if (costUsd   != null) { session.costUsd   += costUsd; }
}

function printSessionSummary() {
  const tokenStr   = session.hasTokens
    ? `${(session.tokensIn + session.tokensOut).toLocaleString()} tokens`
    : 'tokens: unknown';
  const costStr    = session.hasTokens ? `${SYM.sep}${formatCost(session.costUsd)}` : '';
  print(`  Session: ${session.completed} completed${SYM.sep}${session.failed} failed${SYM.sep}${tokenStr}${costStr}`);
  print('');
}

// ---------------------------------------------------------------------------
// Queue snapshot (Task 4)
// ---------------------------------------------------------------------------

/**
 * getQueueSnapshot(queueDir)
 *
 * Scans the queue directory and returns counts by file state suffix.
 * awaiting_review == completed (all DONE files) in v1 — no ACCEPTED state yet.
 */
function getQueueSnapshot(queueDir) {
  let files;
  try {
    files = fs.readdirSync(queueDir);
  } catch (_) {
    return { waiting: 0, in_progress: 0, completed: 0, failed: 0, awaiting_review: 0 };
  }
  const canonical   = files.filter(f => CANONICAL_SUFFIX_RE.test(f));
  const waiting     = canonical.filter(f => f.endsWith('-QUEUED.md') || f.endsWith('-PENDING.md')).length;
  const in_progress = canonical.filter(f => f.endsWith('-IN_PROGRESS.md')).length;
  const completed   = canonical.filter(f => f.endsWith('-DONE.md')).length;
  const failed      = canonical.filter(f => f.endsWith('-ERROR.md')).length;
  return { waiting, in_progress, completed, failed, awaiting_review: completed };
}

// ---------------------------------------------------------------------------
// Startup block (Task 3)
// ---------------------------------------------------------------------------

/**
 * printStartupBlock(recoveryActions)
 *
 * Prints the full startup UI block — header, recovery section (if any),
 * and queue snapshot. Called once on launch after crashRecovery() runs.
 */
function printStartupBlock(recoveryActions) {
  const ts              = timestampNow();
  const pollSec         = Math.round(config.pollIntervalMs / 1000);
  const inactivityMin   = Math.round(config.inactivityTimeoutMs / 60000);

  print('');
  print(hLine(B.dbl));
  print(`  Denorios${SYM.sep}Watcher`);
  print(`  Started: ${ts}${SYM.sep}Polling every ${pollSec}s${SYM.sep}Inactivity kill: ${inactivityMin}min`);
  print(hLine(B.dbl));

  if (recoveryActions.length > 0) {
    print('');
    print('  Recovered on startup:');
    for (const action of recoveryActions) {
      if (action.type === 'cleared') {
        print(`    ${C.green}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}cleared stale work-in-progress (already completed)`);
      } else if (action.type === 'cleared_error') {
        print(`    ${C.yellow}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}cleared stale work-in-progress (already failed)`);
      } else if (action.type === 'requeued') {
        print(`    ${C.yellow}${SYM.back}${C.reset} Slice ${action.id}${SYM.dash}re-queued interrupted slice`);
      } else if (action.type === 'requeued_eval') {
        print(`    ${C.yellow}${SYM.back}${C.reset} Slice ${action.id}${SYM.dash}re-queued interrupted evaluation`);
      } else if (action.type === 'recovery_merged') {
        print(`    ${C.green}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}recovered merge: ${action.branch}${SYM.arrow}main (${action.sha.slice(0, 7)})`);
      } else if (action.type === 'recovery_merge_failed') {
        print(`    ${C.red}${SYM.cross}${C.reset} Slice ${action.id}${SYM.dash}recovery merge failed: ${action.reason}`);
      } else if (action.type === 'accepted_already_merged') {
        print(`    ${C.green}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}branch already on main (no merge needed)`);
      } else if (action.type === 'accepted_no_branch') {
        print(`    ${C.yellow}${SYM.cross}${C.reset} Slice ${action.id}${SYM.dash}ACCEPTED but no branch name — manual merge required`);
      } else if (action.type === 'qa_stage_orphan') {
        print(`    ${C.yellow}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}QA stage died with the daemon — result recorded, slice archived`);
      }
    }
  }

  const snapshot = getQueueSnapshot(QUEUE_DIR);
  print('');
  print('  Queue snapshot:');
  const isEmpty = snapshot.waiting === 0 && snapshot.in_progress === 0
               && snapshot.completed === 0 && snapshot.failed === 0;
  if (isEmpty) {
    print(`    Queue is empty${SYM.dash}watching for new slices.`);
  } else {
    print(`    ${SYM.clip}${snapshot.waiting} waiting${SYM.sep}${snapshot.in_progress} in progress${SYM.sep}${snapshot.completed} completed${SYM.sep}${snapshot.failed} failed`);
  }

  // Log staged slices count
  let stagedCount = 0;
  try {
    const stagedFiles = fs.readdirSync(STAGED_DIR).filter(f => f.endsWith('-STAGED.md') || f.endsWith('-NEEDS_APENDMENT.md') || f.endsWith('-NEEDS_AMENDMENT.md'));
    stagedCount = stagedFiles.length;
  } catch (_) {}
  if (stagedCount > 0) {
    print(`    ${C.yellow}ℹ${C.reset}  ${stagedCount} slice(s) awaiting your review in bridge/staged/`);
  }

  print(hLine(B.sng));
  print('');
}

// ---------------------------------------------------------------------------
// Slice lifecycle blocks (Task 3)
// ---------------------------------------------------------------------------

/**
 * openSliceBlock(id, title, goal)
 *
 * Prints the opening of a slice lifecycle block. Called at pickup.
 */
function openSliceBlock(id, title, goal) {
  const titleStr = title ? `${SYM.sep}"${title}"` : '';
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Slice ${id}${titleStr}`);
  if (goal) {
    print(`${B.vert}    Goal: ${goal}`);
  }
  print(`${B.vert}    Queued${SYM.arrow}Handed off to Rom`);
  print(`${B.vert}`);
}

/**
 * printProgressTick(elapsedMs)
 *
 * Appends a progress line inside the open slice block. Called every 60s.
 */
function printProgressTick(elapsedMs) {
  const elapsed = formatDuration(elapsedMs);
  print(`${B.vert}    ${C.yellow}${SYM.clock}${C.reset} Working${SYM.dots} ${elapsed}`);
}

/**
 * closeSliceBlock(success, durationMs, tokensIn, tokensOut, costUsd, reason, statusLine)
 *
 * Prints the completion or failure lines and closes the slice block; call it exactly once
 * per slice. `statusLine` overrides the line under the result — a slice can now end in a
 * state that is neither "done, off to review" nor "failed" (BLOCKED goes back to O'Brien,
 * NOTHING_TO_DO is archived unreviewed), and the box must not promise a review that is not
 * coming (slice 393).
 */
function closeSliceBlock(success, durationMs, tokensIn, tokensOut, costUsd, reason, statusLine) {
  const duration  = formatDuration(durationMs);
  const tokenStr  = formatTokens(tokensIn, tokensOut);
  const costStr   = formatCost(costUsd);

  if (success) {
    const parts = [duration, tokenStr];
    if (costStr) parts.push(costStr);
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} Complete${SYM.sep}${parts.join(SYM.sep)}`);
    print(`${B.vert}    Status: ${statusLine || `Done${SYM.arrow}Waiting for Nog's review`}`);
  } else {
    const reasonStr = reason || 'Unknown error';
    print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} Failed${SYM.sep}${duration}${SYM.sep}Reason: ${reasonStr}`);
    print(`${B.vert}    Status: ${statusLine || 'Needs attention'}`);
  }
  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

// ---------------------------------------------------------------------------
// Structured logging (bridge.log only — stdout handled by presentation layer)
// ---------------------------------------------------------------------------

/**
 * log(level, event, fields)
 *
 * Writes one JSON line to bridge.log. Does NOT write to stdout — all terminal
 * output is handled by the presentation functions above.
 */
function log(level, event, fields) {
  const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), level, event }, fields));
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // Log file write failure must not crash the orchestrator.
    process.stdout.write('[log-write-error] ' + err.message + '\n');
  }
}

// ---------------------------------------------------------------------------
// Register — append-only event log (fortlaufende Liste)
//
// One JSON line per event. The slice body is embedded in the COMMISSIONED
// event so the original spec (with success criteria) is always recoverable.
// Nog's evaluation task reads this file instead of hunting for renamed/deleted
// queue files.
// ---------------------------------------------------------------------------

/**
 * truncStderr(s) — Truncate stderr to last 2000 chars for register readability.
 */
function truncStderr(s) {
  if (!s || typeof s !== 'string') return '';
  return s.length > 2000 ? s.slice(-2000) : s;
}

/**
 * INVARIANT: registerEvent is the SOLE writer of pipeline events to register.jsonl.
 *
 * All state transitions must flow through this function, synchronously, in canonical
 * order: dev → review → accept → merge. No HTTP handler, SSE push, CLI helper, or
 * background task may append to register.jsonl directly. If you are about to add a
 * second writer, stop — use registerEvent or emit a control-file action for the
 * orchestrator to dispatch synchronously. Slices 168 + 169 removed the last side channel
 * (callReviewAPI); keep it that way.
 */
// Write-time dedupe for MERGED events on (slice_id, sha).
const _writtenMerged = new Set();
// In-memory dedup: only emit SLICE_DISPATCH_DEFERRED once per slice per process lifetime.
const _deferredEmitted = new Set();
// Same idiom for SLICE_DISPATCH_REFUSED: a stale queue file that cannot be moved
// out of the way is re-examined on every poll, and must not narrate it every time.
const _refusalEmitted = new Set();

function registerEvent(id, event, extra) {
  // Dedupe MERGED at write time on (slice_id, sha)
  if (event === 'MERGED' && extra && extra.sha) {
    const key = `${extra.slice_id || id}:${extra.sha}`;
    if (_writtenMerged.has(key)) {
      log('info', 'register_dedupe', { id, msg: `Duplicate MERGED suppressed for ${key}` });
      return;
    }
    _writtenMerged.add(key);
  }

  const entry = Object.assign(
    { ts: new Date().toISOString(), slice_id: String(id), event },
    extra || {}
  );
  try {
    fs.appendFileSync(REGISTER_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Register write failure must not crash the orchestrator.
    log('warn', 'register_error', { id, msg: 'Failed to write register entry', error: err.message });
  }
}

function appendOperationalEvent(_event) {
  // Legacy side-drain hook removed. The append-only register is now the
  // canonical event stream for operator-visible escalation and error state.
}

// ---------------------------------------------------------------------------
// Proof lanes (slice 389, ADR-PROOF-LANES §2)
// ---------------------------------------------------------------------------
//
// A brief declares one of two lanes and everything downstream follows it: the
// report template Sam receives, the review Jordan performs, the effort the model
// spends, and the trailer the gate reads off the landing commit.
//
//   core    — changes what the system does. Full rigour, as ruled on 2026-09-03.
//   surface — changes what the screen shows or says. Light rigour.
//
// The declaration is written on the way IN (new-slice.js requires --lane); every
// read defaults to core, because a slice with no lane is one nobody classified,
// and the whole queue staged before this landed is exactly that.

/**
 * resolveLane(meta) → 'core' | 'surface'
 *
 * The lane of a parsed frontmatter block. Missing → core, silently: that is the
 * whole back catalogue. Present but not one of the two → core, loudly: someone
 * typed something and meant it, and quietly downgrading their intent to the
 * default is how a typo becomes a policy.
 */
function resolveLane(meta) {
  const raw = meta && meta.lane != null ? String(meta.lane).trim().toLowerCase() : '';
  if (raw === 'surface' || raw === 'core') return raw;
  if (raw) log('warn', 'lane', { msg: `unknown lane "${raw}" — treating as core (full rigour)`, lane: raw });
  return 'core';
}

/**
 * laneEventFields(meta, args) → { lane, effort? }
 *
 * The lane fields a register event carries. `effort` is the setting actually in
 * the spawned argument list, not the one the config asks for — ADR §8 measures
 * minutes and dollars per lane, and a number read from config would report what
 * we intended rather than what we ran. No args, or no --effort in them, and the
 * field is omitted rather than guessed.
 *
 * Pure.
 */
function laneEventFields(meta, args) {
  const fields = { lane: resolveLane(meta) };
  if (Array.isArray(args)) {
    const i = args.indexOf('--effort');
    if (i !== -1 && i + 1 < args.length) fields.effort = args[i + 1];
  }
  return fields;
}

/**
 * applyLaneArgs(args, lane, laneArgs) → args
 *
 * Substitutes the lane's `--effort` pair into a spawn argument list. Returns the
 * INPUT ARRAY UNCHANGED for the core lane, for absent laneArgs, and for a lane
 * with no entry — the common path costs nothing and reads as a no-op.
 *
 * Never mutates. Jordan's spawn passes `config.claudeArgs` by reference, so an
 * in-place splice here would set the reviewer's effort from the builder's lane.
 *
 * Pure.
 */
function applyLaneArgs(args, lane, laneArgs) {
  const base = Array.isArray(args) ? args : [];
  if (lane === 'core') return args;
  const pair = laneArgs && laneArgs[lane];
  if (!Array.isArray(pair)) return args;
  const at = pair.indexOf('--effort');
  if (at === -1 || at + 1 >= pair.length) return args;
  const laneEffort = pair.slice(at, at + 2);

  const out = base.slice();
  const idx = out.indexOf('--effort');
  if (idx !== -1 && idx + 1 < out.length) out.splice(idx, 2, ...laneEffort);
  else out.push(...laneEffort);
  return out;
}

/**
 * romSpawnArgs({ claudeArgs, laneArgs, lane, round, sessionId, nogReason }) → args
 *
 * The complete argument list for Sam's `claude -p` — fresh path and --resume path
 * both. One function, because the resume path used to rebuild its own list by
 * filtering `-p`, and anything added to the fresh path (the lane's effort, here)
 * silently missed every rework round.
 *
 * Pure. The caller still logs and registers the session decision; this only
 * re-derives it, from the same shouldForceFreshSession() the caller uses.
 */
function romSpawnArgs({ claudeArgs, laneArgs, lane, round, sessionId, nogReason }) {
  const base = Array.isArray(claudeArgs) ? claudeArgs : [];
  const resuming = (parseInt(round, 10) || 1) > 1
    && !!sessionId
    && !shouldForceFreshSession(nogReason || '');
  const args = resuming
    ? ['--resume', sessionId, ...base.filter(a => a !== '-p')]
    : base.slice();
  return applyLaneArgs(args, lane, laneArgs);
}

/**
 * registerCommissioned(id, extra)
 *
 * Writes a COMMISSIONED register event with one retry on failure.
 * A missing COMMISSIONED event means the history panel shows no title —
 * this is data loss, not a minor hiccup, so we retry and alert loudly.
 */
function registerCommissioned(id, extra) {
  const entry = Object.assign(
    { ts: new Date().toISOString(), slice_id: String(id), event: 'COMMISSIONED' },
    extra || {}
  );
  // The lane is resolved HERE, not at the call site: the pickup loop's call is
  // pinned byte for byte by j-finished-slice-not-redispatched, and the slice body
  // it already hands over carries the declaration (slice 389).
  entry.lane = resolveLane(parseFrontmatter(String((extra && extra.body) || '')));
  const line = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(REGISTER_FILE, line);
  } catch (firstErr) {
    log('warn', 'register_error', { id, msg: 'COMMISSIONED write failed, retrying…', error: firstErr.message });
    try {
      fs.appendFileSync(REGISTER_FILE, line);
    } catch (retryErr) {
      log('error', 'register_error', { id, msg: 'COMMISSIONED write failed after retry', error: retryErr.message });
      process.stdout.write(`\n⚠️  CRITICAL: COMMISSIONED register write FAILED for slice ${id} after retry. History title will be missing. Error: ${retryErr.message}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// RR recomputation helper (slice 270)
// ---------------------------------------------------------------------------

/**
 * recomputeAndPersistRR()
 *
 * Runs computeRR(), writes the result to branch-state.json under
 * regression_risk. Best-effort — logs and continues on failure.
 */
function recomputeAndPersistRR() {
  try {
    const result = computeRR();
    const branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
    branchState.regression_risk = {
      rr: result.rr,
      band: result.band,
      inputs: result.inputs,
      computed_ts: new Date().toISOString(),
    };
    writeJsonAtomic(BRANCH_STATE_PATH, branchState);
  } catch (err) {
    log('warn', 'rr-compute', { msg: 'RR recomputation failed (non-blocking)', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * parseFrontmatter(content)
 *
 * Zero-dependency, regex-based YAML frontmatter extractor.
 * Returns a flat key→value object, or null if frontmatter is absent/malformed.
 * Values are stripped of surrounding quotes.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  });
  return meta;
}

// Sets or replaces key-value pairs in YAML frontmatter. Returns updated text.
// Values are quoted unless opts.quote === false, which writes them bare — what
// numbers, booleans and a literal null need (slice 386).
function updateFrontmatter(text, updates, opts) {
  const quote = !opts || opts.quote !== false;
  const lines = text.split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) { start = i; } else { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return text;
  const fmLines = lines.slice(start + 1, end);
  for (const [key, val] of Object.entries(updates)) {
    const idx = fmLines.findIndex(l => {
      const c = l.indexOf(':');
      return c !== -1 && l.slice(0, c).trim() === key;
    });
    const newLine = quote ? `${key}: "${val}"` : `${key}: ${val}`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }
  return [...lines.slice(0, start + 1), ...fmLines, ...lines.slice(end)].join('\n');
}

/**
 * fillDoneMetrics(doneContent, telemetry)
 *
 * Writes the session's real numbers into a DONE report's frontmatter and
 * returns the new text (slice 386). The contract has always said the watcher
 * fills these fields and the implementor does not hand-author them; this is
 * the code catching up with it.
 *
 * A field-level edit, not a re-serialisation: every other key keeps its place
 * and its spelling, the new keys are appended, and the body is untouched.
 * tokens_in, tokens_out, tokens_cache_read, elapsed_ms and cost_usd are the
 * watcher's to own. estimated_human_hours and compaction_occurred are Rom's
 * judgment and are left exactly as he wrote them; only when he omitted one is a
 * default written, so the field exists for readers. A number the session did
 * not carry is written as the literal null, never as a zero that would read as
 * a measurement.
 */
function fillDoneMetrics(doneContent, telemetry) {
  const content = String(doneContent == null ? '' : doneContent);
  const meta = parseFrontmatter(content);
  if (!meta) return content; // no frontmatter to fill — hand the report back as it is

  const t = telemetry || {};
  const bare = (v) => (v == null || (typeof v === 'number' && !isFinite(v)) ? 'null' : String(v));

  const updates = {
    tokens_in: bare(t.tokensIn),
    tokens_out: bare(t.tokensOut),
    tokens_cache_read: bare(t.tokensCacheRead),
    elapsed_ms: bare(t.elapsedMs),
    cost_usd: bare(t.costUsd),
  };
  if (meta.estimated_human_hours == null) updates.estimated_human_hours = 'null';
  if (meta.compaction_occurred == null) updates.compaction_occurred = 'false';

  return updateFrontmatter(content, updates, { quote: false });
}

/**
 * computeNextAttemptNumber(sliceFilePath, round)
 *
 * Reads the slice file's frontmatter rounds: array and returns the next
 * attempt_number for the given round value. Returns 1 if the round doesn't
 * appear yet; returns max(existing attempt_number for that round) + 1 otherwise.
 */
function computeNextAttemptNumber(sliceFilePath, round) {
  let content;
  try {
    content = fs.readFileSync(sliceFilePath, 'utf-8');
  } catch (_) {
    return 1;
  }

  const lines = content.split('\n');
  let fmStart = -1, fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (fmStart === -1) { fmStart = i; } else { fmEnd = i; break; }
    }
  }
  if (fmStart === -1 || fmEnd === -1) return 1;

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  let maxAttempt = 0;
  let currentRound = null;
  for (const line of fmLines) {
    const roundMatch = line.match(/^\s+-\s*round:\s*(\d+)/);
    if (roundMatch) {
      currentRound = parseInt(roundMatch[1], 10);
      continue;
    }
    const attemptMatch = line.match(/^\s+attempt_number:\s*(\d+)/);
    if (attemptMatch && currentRound === round) {
      const a = parseInt(attemptMatch[1], 10);
      if (a > maxAttempt) maxAttempt = a;
    }
  }

  // If round appeared but no attempt_number lines, treat existing entries as attempt 1.
  if (maxAttempt === 0) {
    // Check if the round appears at all.
    const hasRound = fmLines.some(l => {
      const m = l.match(/^\s+-\s*round:\s*(\d+)/);
      return m && parseInt(m[1], 10) === round;
    });
    if (hasRound) return 2; // existing entry is implicitly attempt 1
  }

  return maxAttempt > 0 ? maxAttempt + 1 : 1;
}

/**
 * appendRoundEntry(sliceFilePath, roundEntry)
 *
 * Appends a round entry to the slice file's frontmatter `rounds:` YAML array
 * and recomputes slice-level `total_*` fields. The entry is a plain object:
 * { round, attempt_number, commissioned_at, done_at, durationMs, tokensIn, tokensOut, costUsd, nog_verdict, nog_reason }
 *
 * Frontmatter `rounds:` is stored as a YAML block sequence inside the --- fences.
 * After appending, total_durationMs/total_tokensIn/total_tokensOut/total_costUsd are recomputed.
 */
function appendRoundEntry(sliceFilePath, roundEntry) {
  let content;
  try {
    content = fs.readFileSync(sliceFilePath, 'utf-8');
  } catch (err) {
    log('warn', 'rounds', { msg: 'Cannot read slice file for rounds append', path: sliceFilePath, error: err.message });
    return;
  }

  const lines = content.split('\n');
  let fmStart = -1, fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (fmStart === -1) { fmStart = i; } else { fmEnd = i; break; }
    }
  }
  if (fmStart === -1 || fmEnd === -1) {
    log('warn', 'rounds', { msg: 'No frontmatter found in slice file', path: sliceFilePath });
    return;
  }

  // Build the YAML lines for this round entry.
  const attemptNum = roundEntry.attempt_number != null ? roundEntry.attempt_number : 1;
  const yamlEntry = [
    `  - round: ${roundEntry.round}`,
    `    attempt_number: ${attemptNum}`,
    `    commissioned_at: "${roundEntry.commissioned_at || ''}"`,
    `    done_at: "${roundEntry.done_at || ''}"`,
    `    durationMs: ${roundEntry.durationMs || 0}`,
    `    tokensIn: ${roundEntry.tokensIn || 0}`,
    `    tokensOut: ${roundEntry.tokensOut || 0}`,
    `    costUsd: ${roundEntry.costUsd != null ? roundEntry.costUsd : 0}`,
    `    nog_verdict: "${roundEntry.nog_verdict || ''}"`,
    `    nog_reason: "${(roundEntry.nog_reason || '').replace(/"/g, '\\"')}"`,
  ];

  // Find existing rounds: block or insert after last frontmatter field.
  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const roundsIdx = fmLines.findIndex(l => /^rounds:\s*$/.test(l.trim()) || /^rounds:$/.test(l.trim()));

  if (roundsIdx === -1) {
    // No rounds: field yet — add it.
    fmLines.push('rounds:');
    fmLines.push(...yamlEntry);
  } else {
    // Find the end of the existing rounds block (indented lines after rounds:).
    let insertAt = roundsIdx + 1;
    while (insertAt < fmLines.length && /^\s{2,}-?\s/.test(fmLines[insertAt])) {
      insertAt++;
    }
    fmLines.splice(insertAt, 0, ...yamlEntry);
  }

  // Parse all rounds to recompute totals.
  let totalDuration = 0, totalIn = 0, totalOut = 0, totalCost = 0;
  for (let i = 0; i < fmLines.length; i++) {
    const m = fmLines[i].match(/^\s+durationMs:\s*(\d+)/);
    if (m) totalDuration += parseInt(m[1], 10);
    const m2 = fmLines[i].match(/^\s+tokensIn:\s*(\d+)/);
    if (m2) totalIn += parseInt(m2[1], 10);
    const m3 = fmLines[i].match(/^\s+tokensOut:\s*(\d+)/);
    if (m3) totalOut += parseInt(m3[1], 10);
    const m4 = fmLines[i].match(/^\s+costUsd:\s*([\d.]+)/);
    if (m4) totalCost += parseFloat(m4[1]);
  }

  // Update or insert total_* fields.
  const totals = {
    total_durationMs: String(totalDuration),
    total_tokensIn: String(totalIn),
    total_tokensOut: String(totalOut),
    total_costUsd: String(parseFloat(totalCost.toFixed(6))),
  };

  for (const [key, val] of Object.entries(totals)) {
    const idx = fmLines.findIndex(l => {
      const c = l.indexOf(':');
      return c !== -1 && l.slice(0, c).trim() === key;
    });
    const newLine = `${key}: ${val}`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }

  // Also update round field at slice level.
  const roundFieldIdx = fmLines.findIndex(l => {
    const c = l.indexOf(':');
    return c !== -1 && l.slice(0, c).trim() === 'round' && !/^\s/.test(l);
  });
  const roundLine = `round: ${roundEntry.round}`;
  if (roundFieldIdx !== -1) fmLines[roundFieldIdx] = roundLine;
  else fmLines.push(roundLine);

  const result = [...lines.slice(0, fmStart + 1), ...fmLines, ...lines.slice(fmEnd)].join('\n');
  try {
    fs.writeFileSync(sliceFilePath, result);
  } catch (err) {
    log('warn', 'rounds', { msg: 'Failed to write updated slice file', path: sliceFilePath, error: err.message });
  }
}

/**
 * extractRomTelemetry(doneReportContent)
 *
 * Pulls durationMs, tokensIn, tokensOut, tokensCacheRead and costUsd from a Rom
 * DONE report's frontmatter — the numbers fillDoneMetrics put there. Feeds the
 * rounds telemetry, so what it returns must match what the register carries.
 *
 * cost_usd is the session's own figure and wins whenever the key is there.
 * computeCost is list price with no cache discount; it survives only as the
 * fallback for pre-386 reports, which have no cost_usd key at all.
 */
function extractRomTelemetry(doneReportContent) {
  const meta = parseFrontmatter(doneReportContent) || {};
  const tokensIn = parseInt(meta.tokens_in, 10) || 0;
  const tokensOut = parseInt(meta.tokens_out, 10) || 0;
  const costUsd = metricIsNull(meta.cost_usd)
    ? (computeCost(tokensIn, tokensOut) || 0)
    : (parseFloat(meta.cost_usd) || 0);
  return {
    durationMs: parseInt(meta.elapsed_ms, 10) || 0,
    tokensIn,
    tokensOut,
    tokensCacheRead: parseInt(meta.tokens_cache_read, 10) || 0,
    costUsd,
    commissioned_at: meta.created || meta.commissioned_at || '',
    done_at: meta.completed || '',
  };
}

// ---------------------------------------------------------------------------
// Git safety layer — FUSE-safe branch management
// ---------------------------------------------------------------------------
//
// The FUSE mount blocks fs.unlink (EPERM). Git checkout uses unlink internally
// to replace tracked files when switching branches, so `git checkout main`
// silently fails whenever files differ between the current branch and main.
//
// This caused repeated regressions: Chief O'Brien's direct edits or merged
// features would vanish from disk because checkout left stale branch files.
//
// Strategy (immutable rules):
//
//   1. AUTO-COMMIT before processing — any dirty tracked files are committed
//      to the current branch before we attempt to switch. No uncommitted
//      changes are ever discarded.
//
//   2. FUSE-SAFE CHECKOUT — instead of `git checkout main`:
//      a. Detect differing files via `git diff --name-only HEAD main`
//      b. Overwrite each file on disk with main's version (fs.writeFileSync
//         works on FUSE — it truncates in-place, no unlink)
//      c. Move HEAD pointer: `git symbolic-ref HEAD refs/heads/main`
//      d. Reset the index: `git read-tree main`
//      e. Verify: confirm `git rev-parse --abbrev-ref HEAD` === 'main'
//
//   3. BRANCH NAME SANITIZATION — Rom's DONE report provides the branch name
//      as untrusted input. Reject anything that isn't [a-zA-Z0-9._/-].
//
//   4. POST-MERGE VERIFICATION — after every merge, verify that the working
//      tree matches git's committed state. If not, overwrite disk from git.
// ---------------------------------------------------------------------------

const BRANCH_NAME_REGEX = /^[a-zA-Z0-9._\/-]+$/;

// The XY status field of a porcelain line, tolerating a stripped leading space.
// The caller trims the whole `git status --porcelain` output, which eats the lead
// space off the FIRST line only — so a fixed slice(3) reads ' M bridge/heartbeat.json'
// correctly and 'M bridge/heartbeat.json' as 'ridge/heartbeat.json', which matches
// no rule and lets the very file this slice is about slip into the commit.
const PORCELAIN_STATUS_RE = /^[ MADRCU?!]{1,2}\s+/;

/**
 * porcelainPaths(line) → string[]
 *
 * The path(s) a `git status --porcelain` line refers to. A rename reads
 * `R  old -> new` and names two. core.quotepath wraps a path containing non-ASCII
 * in double quotes, so strip those too — an unstripped quote would make a volatile
 * path look like source.
 */
function porcelainPaths(line) {
  const rest = String(line).replace(PORCELAIN_STATUS_RE, '').trim();
  if (!rest) return [];
  const parts = rest.includes(' -> ') ? rest.split(' -> ') : [rest];
  return parts.map(p => p.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

/**
 * recoverRuntimeStateAfterGit(op, id)
 *
 * Re-assert the untracked runtime state after any git operation that rewrites the
 * working tree. Merging a commit that untracks a file DELETES it from the merging
 * worktree — and that worktree is the live pipeline, whose timesheet, anchors and
 * audit ledgers are append-only and reconstructible from nothing else. The seeder
 * only ever creates what is absent, so this is a no-op on every ordinary run;
 * when it is not, the recovery is logged as a warning rather than passing for a
 * fresh start.
 */
function recoverRuntimeStateAfterGit(op, id) {
  let result;
  try {
    result = ensureRuntimeState(PROJECT_DIR);
  } catch (err) {
    log('warn', 'git_safety', { id, msg: 'runtime-state recovery failed', op, error: err.message });
    return { seeded: [], restored: [] };
  }
  if (result.restored.length) {
    log('warn', 'git_safety', {
      id,
      op,
      msg: `Recovered ${result.restored.length} runtime file(s) from git history after ${op} — they were removed from the working tree`,
      files: result.restored,
    });
  } else if (result.seeded.length) {
    log('info', 'git_safety', { id, op, msg: `Re-seeded runtime state after ${op}`, files: result.seeded });
  }
  return result;
}

/** Single-quote a path for the shell, so a space or a quote in it cannot split it. */
function shQuote(p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}

/**
 * stageablePathsFrom(statusLines) → string[]
 *
 * The paths from `git status --porcelain` lines that the autocommit may commit:
 * source, and nothing else. Naming the paths explicitly rather than excluding by
 * pathspec keeps one rule — isPipelineOwnedPath — in charge.
 *
 * Slice 395 widened that rule from isVolatileRuntimePath (the files that TICK) to
 * everything the pipeline writes or moves: the queue, the staging area, the trash,
 * bridge/state, bridge/logs, the bridge-root ledgers and the derived overlays under
 * regression/. The narrower rule let the queue through, and the queue is moved by
 * plain filesystem rename — so eight autocommits in thirty days committed bare
 * deletions of report files under a subject that named no slice (704975d). A path
 * the pipeline owns is recorded by the step that moved it, inside the commit that
 * step belongs to. This function's whole remaining job is a person's uncommitted
 * source edit, which the checkout that follows would otherwise overwrite.
 */
function stageablePathsFrom(statusLines) {
  const paths = [];
  for (const line of statusLines) {
    for (const p of porcelainPaths(line)) {
      if (!isPipelineOwnedPath(p) && !paths.includes(p)) paths.push(p);
    }
  }
  return paths;
}

/**
 * autoCommitDirtyTree(reason, sliceId)
 *
 * If the working tree has uncommitted changes to tracked SOURCE files, commit them
 * to the current branch before a checkout overwrites them. Returns true if a commit
 * was made.
 *
 * Its one job is a person's uncommitted edit. Slice 395 widened the filter from the
 * ticking runtime files (isVolatileRuntimePath) to everything the pipeline owns
 * (isPipelineOwnedPath), because the narrower rule let the queue through and the
 * queue is moved by plain filesystem rename: eight autocommits in thirty days
 * committed bare deletions of report files under a subject that named no slice
 * (704975d). What survives the filter is a person's work, so the subject says so,
 * prefixed with the slice whose checkout triggered the rescue.
 *
 * `sliceId` is the slice being checked out; absent, the subject carries no label
 * rather than an invented one.
 *
 * Uses GIT_INDEX_FILE to avoid index.lock issues on FUSE.
 */
function autoCommitDirtyTree(reason, sliceId) {
  try {
    const status = gitFinalizer.runGit('git status --porcelain', { slice_id: '0', op: 'autoCommit_status', encoding: 'utf-8' }).trim();
    // Only care about modified tracked files (M, D, R) — not untracked (??)
    const allTracked = status.split('\n').filter(l => l && !l.startsWith('??'));

    // …and never machine bookkeeping, even while it is still tracked: untracking
    // it (slice 372) cannot protect the run that LANDS the untracking, whose
    // orchestrator still runs code from a tree where it ticks. See the note above.
    const stagePaths = stageablePathsFrom(allTracked);
    const skippedPaths = allTracked.flatMap(porcelainPaths).filter(isPipelineOwnedPath);

    if (skippedPaths.length) {
      log('info', 'git_safety', {
        msg: `Autocommit skipped ${skippedPaths.length} pipeline-owned file(s) — bookkeeping, not source`,
        files: skippedPaths.join(', '),
      });
    }
    if (stagePaths.length === 0) return false;

    const branch = gitFinalizer.runGit('git rev-parse --abbrev-ref HEAD', { slice_id: '0', op: 'autoCommit_branch', encoding: 'utf-8' }).trim();
    const msg = gitFinalizer.pipelineCommitSubject(sliceId,
      `autocommit before checkout, ${stagePaths.length} source file(s) a person left uncommitted (${reason}, on ${branch})`);
    log('warn', 'git_safety', { msg, files: stagePaths.join(', ') });

    // Kind: P — pipeline bookkeeping, not a slice landing (405). It rides the TRAILER
    // block, never the subject, so `S<id>: ` reads exactly as before; the log above
    // keeps the bare subject and only git gets the trailer.
    const commitBody = `${msg}\n\nKind: P\n`;

    // `git add -u` still stages tracked modifications only — now against the named
    // paths, so the message and the commit agree and nothing volatile can slip in.
    gitFinalizer.runGit(`git add -u -- ${stagePaths.map(shQuote).join(' ')}`, { slice_id: '0', op: 'autoCommit_add', execOpts: { stdio: 'pipe' } });
    gitFinalizer.runGit(`git commit -m "${commitBody.replace(/"/g, '\\"')}"`, { slice_id: '0', op: 'autoCommit_commit', execOpts: { stdio: 'pipe' } });
    log('info', 'git_safety', { msg: `Auto-committed ${stagePaths.length} files to ${branch}` });
    return true;
  } catch (err) {
    log('warn', 'git_safety', { msg: 'autoCommitDirtyTree failed', error: err.message });
    return false;
  }
}

/**
 * @deprecated No longer called — PROJECT_DIR stays on main permanently with
 * worktree-based execution. Retained as dead code for safety.
 *
 * fuseSafeCheckoutMain(id)
 *
 * FUSE-safe replacement for `git checkout main`. Never calls unlink.
 *
 * 1. If already on main with clean tree → no-op.
 * 2. Auto-commit any dirty tracked files to current branch.
 * 3. Overwrite each differing file on disk with main's version
 *    (fs.writeFileSync truncates in-place — works on FUSE).
 * 4. Remove files that exist on the current branch but not on main
 *    (via rename to trash — FUSE-safe).
 * 5. Move HEAD to main and reset the index.
 *
 * Throws on unrecoverable failure.
 */
function fuseSafeCheckoutMain(id) {
  const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();

  if (current === 'main') {
    // Already on main — just verify tree is clean.
    autoCommitDirtyTree('uncommitted changes on main before slice processing', id);
    return;
  }

  // Step 1: commit any dirty tracked files to the CURRENT branch (not main).
  autoCommitDirtyTree(`uncommitted changes on ${current} before switching to main`, id);

  // Step 2: get list of files that differ between current HEAD and main.
  let diffFiles = [];
  try {
    const raw = execSync('git diff --name-only HEAD main', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    if (raw) diffFiles = raw.split('\n').filter(Boolean);
  } catch (err) {
    log('warn', 'git_safety', { id, msg: 'git diff --name-only failed', error: err.message });
  }

  // Step 3: overwrite each differing file on disk with main's version.
  // TRASH_DIR is a global constant initialized at startup.
  let overwritten = 0;
  let removed = 0;

  for (const file of diffFiles) {
    const diskPath = path.join(PROJECT_DIR, file);
    try {
      // Try to get main's version of this file
      const content = execSync(`git show main:${file}`, { cwd: PROJECT_DIR, encoding: 'buffer' });
      // Ensure parent directory exists (file might be in a new subdirectory on main)
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, content);
      overwritten++;
    } catch (_) {
      // File doesn't exist on main — it only exists on the current branch.
      // Rename to trash (FUSE-safe) so the working tree matches main.
      try {
        fs.renameSync(diskPath, path.join(TRASH_DIR, path.basename(file) + '.branch-cleanup'));
        removed++;
      } catch (__) {
        // If even rename fails, just leave it — it'll be untracked on main.
      }
    }
  }

  // Step 4: also handle files that exist on main but not on current branch (new on main).
  let mainOnlyFiles = [];
  try {
    const raw = execSync('git diff --name-only --diff-filter=A main HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    if (raw) mainOnlyFiles = raw.split('\n').filter(Boolean);
  } catch (_) {}

  for (const file of mainOnlyFiles) {
    if (diffFiles.includes(file)) continue; // Already handled above
    const diskPath = path.join(PROJECT_DIR, file);
    try {
      const content = execSync(`git show main:${file}`, { cwd: PROJECT_DIR, encoding: 'buffer' });
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, content);
      overwritten++;
    } catch (_) {}
  }

  // Step 5: move HEAD pointer to main and reset index.
  execSync('git symbolic-ref HEAD refs/heads/main', { cwd: PROJECT_DIR, stdio: 'pipe' });
  execSync('git read-tree main', { cwd: PROJECT_DIR, stdio: 'pipe' });

  // Step 6: verify.
  const verify = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (verify !== 'main') {
    throw new Error(`fuseSafeCheckoutMain: HEAD is ${verify}, expected main`);
  }

  log('info', 'git_safety', {
    id,
    msg: `FUSE-safe checkout to main complete (was: ${current})`,
    filesOverwritten: overwritten,
    filesRemoved: removed,
    totalDiff: diffFiles.length,
  });
}

/**
 * @deprecated No longer called — worktrees replace checkout. Retained as dead
 * code for safety.
 *
 * fuseSafeCheckoutBranch(id, branchName)
 *
 * FUSE-safe checkout to an EXISTING feature branch.
 * Same strategy as fuseSafeCheckoutMain but targets a named branch.
 * Used for apendment flows where the orchestrator needs to resume work on
 * a branch after a restart (when HEAD may have returned to main).
 *
 * Steps:
 *   1. Auto-commit dirty tracked files.
 *   2. Diff current HEAD vs target branch.
 *   3. Overwrite each differing file via writeFileSync (truncate-in-place).
 *   4. Move HEAD to target branch via symbolic-ref + read-tree.
 *   5. Verify HEAD.
 */
function fuseSafeCheckoutBranch(id, branchName) {
  branchName = sanitizeBranchName(branchName);

  const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (current === branchName) {
    log('info', 'git_safety', { id, msg: `Already on branch ${branchName} — no checkout needed` });
    return;
  }

  // Verify the branch exists
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (_) {
    throw new Error(`fuseSafeCheckoutBranch: branch ${branchName} does not exist`);
  }

  // Step 1: commit anything dirty
  autoCommitDirtyTree(`pre-checkout-branch-${branchName}`, id);

  // Step 2: diff files between current HEAD and the target branch
  const diffRaw = execSync(`git diff --name-only HEAD ${branchName}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  const diffFiles = diffRaw ? diffRaw.split('\n').filter(Boolean) : [];

  // Step 3: overwrite each file from the target branch
  let overwritten = 0;
  let removed = 0;
  for (const file of diffFiles) {
    const diskPath = path.join(PROJECT_DIR, file);
    // Volatile runtime state is not the branch's business. A branch that untracks
    // it (slice 372) reads here as "the target does not have this file", and the
    // removal below would sweep the live heartbeat, timesheet and branch-state
    // into trash on the way to a checkout. Leave them exactly where they are.
    if (isVolatileRuntimePath(file)) continue;
    let content = null;
    try {
      content = execSync(`git show ${branchName}:${file}`, { cwd: PROJECT_DIR, encoding: 'buffer' });
    } catch (_) {
      // File doesn't exist on target branch — move to trash
      if (fs.existsSync(diskPath)) {
        try { fs.renameSync(diskPath, path.join(TRASH_DIR, path.basename(file) + '.branch-checkout')); } catch (__) {}
        removed++;
      }
      continue;
    }
    // A failed write MUST abort the checkout. Swallowing it leaves the old
    // branch's content on disk under the new HEAD; the drift merge then dies
    // on phantom "local changes" and the pre-checkout autocommit sweeps
    // foreign content onto the slice branch (slices 348/349, Layer-2 lock).
    const dir = path.dirname(diskPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(diskPath, content);
    overwritten++;
  }

  // Step 4: move HEAD pointer
  execSync(`git symbolic-ref HEAD refs/heads/${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  execSync(`git read-tree ${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });

  // Step 5: verify
  const verify = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (verify !== branchName) {
    throw new Error(`fuseSafeCheckoutBranch: HEAD is ${verify}, expected ${branchName}`);
  }

  // A checkout can still take the runtime state away — `git read-tree` above moves
  // the index to a branch where these paths do not exist, and any later git command
  // that syncs the tree acts on that. Re-assert it: present files are untouched,
  // absent ones come back from history rather than as a blank ledger.
  recoverRuntimeStateAfterGit(`checkout-${branchName}`, id);

  log('info', 'git_safety', {
    id,
    msg: `FUSE-safe checkout to branch ${branchName} complete (was: ${current})`,
    filesOverwritten: overwritten,
    filesRemoved: removed,
    totalDiff: diffFiles.length,
  });
}

/**
 * @deprecated Replaced by createWorktree(). Retained as dead code for safety.
 *
 * createBranchFromMain(id, branchName)
 *
 * Watcher-owned branch creation. Creates a new branch from main HEAD.
 * Since we're branching from the currently checked-out main, no files
 * change on disk — this is inherently FUSE-safe (just pointer creation).
 *
 * Pre-condition: HEAD must be on main (call fuseSafeCheckoutMain first).
 */
function createBranchFromMain(id, branchName) {
  branchName = sanitizeBranchName(branchName);

  // Verify we're on main
  const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (current !== 'main') {
    throw new Error(`createBranchFromMain: expected HEAD on main, got ${current}`);
  }

  // Check if branch already exists
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    // Branch exists — just check it out
    log('info', 'git_safety', { id, msg: `Branch ${branchName} already exists — checking out` });
    fuseSafeCheckoutBranch(id, branchName);
    return;
  } catch (_) {
    // Branch doesn't exist — good, create it
  }

  // Create branch (just moves pointer, no file changes since we're on main)
  execSync(`git checkout -b ${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });

  // Verify
  const verify = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (verify !== branchName) {
    throw new Error(`createBranchFromMain: HEAD is ${verify}, expected ${branchName}`);
  }

  log('info', 'git_safety', { id, msg: `Created branch ${branchName} from main`, sha: execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim() });
}

/**
 * verifyBranchState(id, expectedBranch)
 *
 * Post-invocation gate. Verifies that:
 *   1. HEAD is on the expected branch (not the integration branch, not detached).
 *   2. The branch has commits ahead of the integration branch (Rom actually did work).
 *   3. The branch's base is an ancestor of the integration tip (not a stale fork).
 *
 * Returns { ok, issues[] }.
 */
function verifyBranchState(id, expectedBranch, cwd) {
  cwd = cwd || PROJECT_DIR;
  const issues = [];

  // Check 1: correct branch
  const current = gitFinalizer.runGit('git rev-parse --abbrev-ref HEAD', { slice_id: id || '0', op: 'verifyBranch_head', cwd, encoding: 'utf-8' }).trim();
  if (current !== expectedBranch) {
    issues.push(`HEAD is on '${current}', expected '${expectedBranch}'`);
  }

  // Check 2: commits ahead of the integration branch
  try {
    const ahead = gitFinalizer.runGit(`git rev-list ${INTEGRATION_BRANCH}..${expectedBranch} --count`, { slice_id: id || '0', op: 'verifyBranch_ahead', cwd, encoding: 'utf-8' }).trim();
    if (parseInt(ahead, 10) === 0) {
      issues.push(`Branch ${expectedBranch} has no commits ahead of ${INTEGRATION_BRANCH}`);
    }
  } catch (_) {
    issues.push(`Could not count commits ahead of ${INTEGRATION_BRANCH} for ${expectedBranch}`);
  }

  // Check 3: the branch forked from a commit that is an ANCESTOR of the integration tip.
  //
  // This is deliberately weaker than "the merge-base IS the tip". The integration
  // branch advances while a slice is in flight, so by the time a slice finishes its
  // fork point is an older commit by construction — asserting tip-equality would
  // trip a false "stale fork" on essentially every slice.
  try {
    const mergeBase = gitFinalizer.runGit(`git merge-base ${INTEGRATION_BRANCH} ${expectedBranch}`, { slice_id: id || '0', op: 'verifyBranch_mergeBase', cwd, encoding: 'utf-8' }).trim();
    let isAncestor = true;
    try {
      // Exit 0 = ancestor, exit 1 = not. Never trust output here, only the code.
      gitFinalizer.runGit(`git merge-base --is-ancestor ${mergeBase} ${INTEGRATION_BRANCH}`, { slice_id: id || '0', op: 'verifyBranch_isAncestor', cwd, execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } });
    } catch (_) {
      isAncestor = false;
    }
    if (!isAncestor) {
      // Diagnostic only — name the branches that DO contain the fork point, matched
      // as whole names (see branchNamesFrom: `dev-linear` must never read as `dev`).
      let containing = [];
      try {
        containing = branchNamesFrom(gitFinalizer.runGit(`git branch --contains ${mergeBase}`, { slice_id: id || '0', op: 'verifyBranch_contains', cwd, encoding: 'utf-8' }));
      } catch (_) {}
      issues.push(`Branch merge-base ${mergeBase.slice(0,8)} is not an ancestor of ${INTEGRATION_BRANCH} — possible stale fork (contained in: ${containing.join(', ') || 'no branch'})`);
    }
  } catch (_) {
    issues.push('Could not verify merge-base');
  }

  const ok = issues.length === 0;
  if (!ok) {
    log('warn', 'git_safety', { id, msg: 'Post-invocation branch verification failed', issues });
  } else {
    log('info', 'git_safety', { id, msg: `Post-invocation branch verification passed for ${expectedBranch}` });
  }
  return { ok, issues };
}

/**
 * clearStaleGitLocks()
 *
 * Removes git lock files that may have been left by a prior crash.
 * Safe to call unconditionally at startup — git creates these atomically
 * and a missing lock file is equivalent to no lock.
 */
function clearStaleGitLocks() {
  const lockFiles = [
    path.join(PROJECT_DIR, '.git', 'index.lock'),
    path.join(PROJECT_DIR, '.git', 'MERGE_HEAD'),
    path.join(PROJECT_DIR, '.git', 'MERGE_MSG'),
    path.join(PROJECT_DIR, '.git', 'MERGE_MODE'),
    path.join(PROJECT_DIR, '.git', 'ORIG_HEAD.lock'),
    path.join(PROJECT_DIR, '.git', 'COMMIT_EDITMSG.lock'),
  ];
  for (const f of lockFiles) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        log('info', 'startup', { msg: `Removed stale git lock: ${path.basename(f)}` });
      }
    } catch (err) {
      log('warn', 'startup', { msg: `Could not remove stale lock ${path.basename(f)}`, error: err.message });
    }
  }
  // If there was a stuck merge, abort it
  try {
    gitFinalizer.runGit('git merge --abort', { slice_id: '0', op: 'clearStaleLocks_mergeAbort', execOpts: { stdio: 'pipe' } });
    log('info', 'startup', { msg: 'Aborted in-progress merge left from prior run' });
  } catch (_) {
    // No merge in progress — expected
  }
}

/**
 * selfRestart(reason)
 *
 * Spawns a fresh copy of the orchestrator process and exits this one.
 * Used when a hard-reset or lock-clearing operation needs a clean process state.
 */
function selfRestart(reason) {
  log('warn', 'self_restart', { msg: `Restarting orchestrator: ${reason}` });
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  child.unref();
  process.exit(0);
}

/**
 * fastForwardIntegrationRef(id, branch, remoteSha)
 *
 * Moves the LOCAL `branch` ref to `remoteSha`. HEAD-independent by construction:
 * the caller has already established this is a pure fast-forward (ahead === 0),
 * and the outcome is the same wherever HEAD happens to be sitting.
 *
 * Two mechanisms, because git allows exactly one of them per HEAD state:
 *   - HEAD is ON the branch  → `merge --ff-only` (moves ref + index + worktree
 *     together). `fetch origin b:b` and `update-ref` are both wrong here: git
 *     refuses the first outright, and the second strands the index at the old
 *     tree so every file reads as modified.
 *   - HEAD is elsewhere      → move the ref explicitly and never touch HEAD's
 *     working tree. This is the case the orchestrator actually hits (HEAD sits
 *     on the integration branch normally, but on the SLICE branch on the
 *     conflicted-squash return path — where a `merge --ff-only` would
 *     fast-forward the slice instead).
 */
function fastForwardIntegrationRef(id, branch, remoteSha) {
  let head = '';
  try {
    head = gitFinalizer.runGit('git rev-parse --abbrev-ref HEAD', { slice_id: id, op: 'ffIntegration_head', encoding: 'utf-8' }).trim();
  } catch (_) {}

  if (head === branch) {
    gitFinalizer.runGit(`git merge --ff-only origin/${branch}`, { slice_id: id, op: 'ffIntegration_ffMerge', execOpts: { stdio: 'pipe' } });
    return;
  }

  // `fetch origin b:b` is still refused if ANY worktree holds b — fall back to a
  // direct ref move, which is safe precisely because HEAD is not on b here.
  try {
    gitFinalizer.runGit(`git fetch origin ${branch}:${branch}`, { slice_id: id, op: 'ffIntegration_fetchRef', execOpts: { stdio: 'pipe', timeout: 15000 } });
  } catch (_) {
    gitFinalizer.runGit(`git update-ref refs/heads/${branch} ${remoteSha}`, { slice_id: id, op: 'ffIntegration_updateRef', execOpts: { stdio: 'pipe' } });
  }
}

/**
 * ensureIntegrationIsFresh(id)
 *
 * Fetches from origin and synchronises the local INTEGRATION branch, so the
 * worktree we're about to cut from it carries all landed work. If the fetch
 * fails (offline, no remote), log a warning but continue — the local ref is
 * still a valid base.
 *
 * Four cases after fetch:
 *   in-sync  (ahead=0, behind=0) → nothing to do
 *   ahead    (ahead>0, behind=0) → push local commits to origin
 *   behind   (ahead=0, behind>0) → fast-forward the local ref from origin
 *   diverged (ahead>0, behind>0) → throw Error; operator must resolve
 *
 * Every mutating path proves its post-condition by COMPARING REFS, never by
 * trusting a git exit code. The predecessor of this function did the opposite:
 * it ran `git merge --ff-only origin/main` (which acts on HEAD, not on `main`)
 * while HEAD sat on another branch, got a truthy "Already up to date", then
 * re-read the untouched sha and logged `Fast-forwarded main: f7fd230 → f7fd230`.
 * That false success is why the local ref stood 42 commits frozen while the
 * guard reported green, and it is the bug slice 353 exists to kill.
 *
 * The push/ff paths are wrapped in the Layer-2 unlock/relock protocol
 * inherited from slice 202. True divergence bails before any unlock.
 */
function ensureIntegrationIsFresh(id) {
  const B = INTEGRATION_BRANCH;

  try {
    gitFinalizer.runGit(`git fetch origin ${B}`, { slice_id: id, op: 'ensureIntegrationIsFresh_fetch', execOpts: { stdio: 'pipe', timeout: 15000 } });
  } catch (err) {
    log('warn', 'git_safety', { id, msg: `fetch origin/${B} failed — proceeding with local ${B}`, error: err.message });
    return;
  }

  const local  = gitFinalizer.runGit(`git rev-parse ${B}`,        { slice_id: id, op: 'ensureIntegrationIsFresh_localSha', encoding: 'utf-8' }).trim();
  const remote = gitFinalizer.runGit(`git rev-parse origin/${B}`, { slice_id: id, op: 'ensureIntegrationIsFresh_remoteSha', encoding: 'utf-8' }).trim();

  if (local === remote) {
    log('info', 'git_safety', { id, msg: `${B} is up to date with origin` });
    return;
  }

  const aheadCount  = Number(gitFinalizer.runGit(`git rev-list --count origin/${B}..${B}`, { slice_id: id, op: 'ensureIntegrationIsFresh_aheadCount',  encoding: 'utf-8' }).trim());
  const behindCount = Number(gitFinalizer.runGit(`git rev-list --count ${B}..origin/${B}`, { slice_id: id, op: 'ensureIntegrationIsFresh_behindCount', encoding: 'utf-8' }).trim());

  // True divergence: local has commits origin doesn't AND origin has commits local doesn't.
  // This is an operator situation — bail immediately without touching either side.
  if (aheadCount > 0 && behindCount > 0) {
    log('error', 'git_safety', { id, msg: 'true divergence detected', branch: B, ahead: aheadCount, behind: behindCount });
    throw new Error(`${B} diverged from origin: local ahead ${aheadCount}, behind ${behindCount}. Operator intervention required.`);
  }

  // -- Layer 2 enforcement: unlock source paths before git mutations, re-lock after --
  const unlockScript = path.join(PROJECT_DIR, 'scripts', 'unlock-main.sh');
  const lockScript   = path.join(PROJECT_DIR, 'scripts', 'lock-main.sh');
  const unlockStart = Date.now();
  try { execSync(`bash "${unlockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
  emitGateTelemetry('lock-cycle', { cycle_phase: 'unlock', triggering_op: 'integration-refresh', held_duration_ms: Date.now() - unlockStart });

  try {
    if (aheadCount > 0 && behindCount === 0) {
      // Local ahead only — push to origin; do NOT reset
      log('info', 'git_safety', { id, msg: `local ${B} ahead of origin by ${aheadCount}; pushing`, ahead: aheadCount });
      gitFinalizer.runGit(`git push origin ${B}`, { slice_id: id, op: 'ensureIntegrationIsFresh_push', execOpts: { stdio: 'pipe' } });

      // POST-CONDITION: origin must now carry our sha. Re-reading the LOCAL ref
      // here would prove nothing — it never moves on a push.
      const afterRemote = gitFinalizer.runGit(`git rev-parse origin/${B}`, { slice_id: id, op: 'ensureIntegrationIsFresh_verifyPush', encoding: 'utf-8' }).trim();
      if (afterRemote !== local) {
        throw new Error(`push of ${B} did not advance origin: origin/${B} is ${afterRemote.slice(0, 8)}, expected ${local.slice(0, 8)}`);
      }
      registerEvent(id, 'MAIN_PUSHED_TO_ORIGIN', { sha: local, ahead_count: aheadCount, branch: B });
      log('info', 'git_safety', { id, msg: `Pushed ${B} to origin: ${local.slice(0, 8)}, ${aheadCount} commit(s)` });
    } else {
      // Local behind only — fast-forward the REF ITSELF (aheadCount === 0, behindCount > 0)
      fastForwardIntegrationRef(id, B, remote);

      // POST-CONDITION: compare refs. A no-op refresh must never be reportable
      // as a fast-forward.
      const after = gitFinalizer.runGit(`git rev-parse ${B}`, { slice_id: id, op: 'ensureIntegrationIsFresh_verifyFF', encoding: 'utf-8' }).trim();
      if (after !== remote) {
        throw new Error(`fast-forward of ${B} did not move the local ref: ${B} is ${after.slice(0, 8)}, expected origin/${B} ${remote.slice(0, 8)}`);
      }
      log('info', 'git_safety', { id, msg: `Fast-forwarded ${B}: ${local.slice(0, 8)} -> ${after.slice(0, 8)}`, behind: behindCount });
    }
  } finally {
    const relockStart = Date.now();
    try { execSync(`bash "${lockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    emitGateTelemetry('lock-cycle', { cycle_phase: 'relock', triggering_op: 'integration-refresh', held_duration_ms: Date.now() - relockStart });
  }
}

/**
 * buildScopeDiff(id, branchName, sliceContent)
 *
 * Builds a human-readable scope summary for Nog's review:
 *   - Which files were changed, added, or deleted on the branch
 *   - Per-file line count deltas
 *   - The slice's title and goal for scope comparison
 *
 * Returns a string block to inject into the evaluator prompt.
 */
function buildScopeDiff(id, branchName, sliceContent) {
  const lines = [];
  try {
    // File-level diff stat (which files changed and by how much)
    const stat = gitFinalizer.runGit(`git diff --stat ${INTEGRATION_BRANCH}...${branchName}`, { slice_id: id, op: 'buildScopeDiff_stat', encoding: 'utf-8' }).trim();
    // File list with status (A=added, M=modified, D=deleted)
    const nameStatus = gitFinalizer.runGit(`git diff --name-status ${INTEGRATION_BRANCH}...${branchName}`, { slice_id: id, op: 'buildScopeDiff_nameStatus', encoding: 'utf-8' }).trim();

    lines.push('## SCOPE REVIEW — files changed on this branch');
    lines.push('');
    lines.push('```');
    lines.push(nameStatus);
    lines.push('```');
    lines.push('');
    lines.push('Summary:');
    lines.push('```');
    lines.push(stat.split('\n').slice(-1)[0] || '(no changes)');  // last line = totals
    lines.push('```');
    lines.push('');

    // Extract slice scope info
    const meta = parseFrontmatter(sliceContent) || {};
    lines.push(`Slice title: ${meta.title || '(unknown)'}`);
    lines.push(`Slice goal: ${meta.goal || '(unknown)'}`);
    lines.push(`Branch: ${branchName}`);
    lines.push('');
  } catch (err) {
    lines.push('## SCOPE REVIEW — could not generate diff');
    lines.push(`Error: ${err.message}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * sanitizeBranchName(name)
 *
 * Validates that a branch name from Rom's DONE report is safe for shell
 * interpolation. Returns the name if valid, throws if not.
 */
function sanitizeBranchName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Branch name is missing or not a string');
  }
  if (!BRANCH_NAME_REGEX.test(name)) {
    throw new Error(`Invalid branch name: "${name}" — must match ${BRANCH_NAME_REGEX}`);
  }
  if (name.includes('..') || name.startsWith('-')) {
    throw new Error(`Invalid branch name: "${name}" — contains unsafe pattern`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

/**
 * getWorktreePath(id)
 *
 * Returns the deterministic worktree path for a given slice ID.
 */
function getWorktreePath(id) {
  return path.join(WORKTREE_BASE, String(id));
}

/**
 * provisionWorkspaceDeps(wtPath, id)
 *
 * `git worktree add` checks out TRACKED files only, and node_modules is gitignored —
 * so a fresh workspace cannot run either suite until someone plumbs the dependencies
 * in by hand. On slice 371 Rom did exactly that: four calls of hand-plumbing, on every
 * single run, ending in a delete-the-link-before-committing step he had to remember.
 *
 * The workspace gets a SYMLINK to the main checkout's node_modules instead of its own
 * install:
 *   - every workspace is a worktree of THIS repo at the same lockfile, so the
 *     dependency tree is identical to the main checkout's by construction;
 *   - it costs one syscall. `npm ci` would cost tens of seconds per slice, and
 *     `npx playwright install` a browser download per slice — for browsers Playwright
 *     already caches machine-wide, outside the repo (~/Library/Caches/ms-playwright on
 *     macOS). Nothing here sets PLAYWRIGHT_BROWSERS_PATH; that default cache is the
 *     point.
 *
 * A symlink named `node_modules` is NOT matched by the gitignore pattern
 * `node_modules/`: a trailing slash means "directory only", and git sees the link as a
 * file. That is why .gitignore carries the slashless `node_modules`. Do not put the
 * slash back — with it, the link is untracked-and-visible and the first `git add -A`
 * in a workspace commits it.
 *
 * Idempotent, and never fatal: a workspace without dependencies is a bad workspace,
 * but it is not a reason to fail the slice.
 *
 * Returns true when the workspace ends up with dependencies available.
 */
function provisionWorkspaceDeps(wtPath, id) {
  // The main checkout OWNS the real node_modules — never link it to itself.
  if (!wtPath || path.resolve(wtPath) === path.resolve(PROJECT_DIR)) return true;

  const source = path.join(PROJECT_DIR, 'node_modules');
  const link   = path.join(wtPath, 'node_modules');

  try {
    // Already provisioned? lstat first, not existsSync — existsSync follows the link
    // and answers false for a DANGLING one, which must be replaced, not skipped.
    let entry = null;
    try { entry = fs.lstatSync(link); } catch (_) {}
    if (entry) {
      if (fs.existsSync(link)) return true;                 // live dir, or live link
      fs.rmSync(link, { recursive: true, force: true });    // dangling link — relink
    }

    if (!fs.existsSync(source)) {
      log('warn', 'worktree', { id, msg: `No dependencies to link: ${source} does not exist — run npm install in the main checkout` });
      return false;
    }

    fs.symlinkSync(source, link, 'dir');
    log('info', 'worktree', { id, msg: `Linked dependencies into ${wtPath} -> ${source}` });
    return true;
  } catch (err) {
    log('warn', 'worktree', { id, msg: 'Failed to provision workspace dependencies', error: err.message });
    return false;
  }
}

/**
 * createWorktree(id, branchName)
 *
 * Creates a git worktree at /tmp/ds9-worktrees/{id}/ for the given branch.
 * For new slices: creates a new branch from main.
 * For apendments: checks out the existing branch.
 * If a worktree already exists for this ID (requeue reuse), returns it.
 * If the branch is already checked out in another worktree, prunes the old one.
 *
 * Returns the worktree path. Throws on failure.
 */
function createWorktree(id, branchName) {
  branchName = sanitizeBranchName(branchName);
  const wtPath = getWorktreePath(id);

  // If this ID already has a worktree, reuse it (Part 6: rejection requeue reuse)
  if (fs.existsSync(wtPath)) {
    // A reused workspace is provisioned too — the dependencies may have been cleaned
    // out from under it, and a workspace without them cannot run either suite.
    provisionWorkspaceDeps(wtPath, id);
    log('info', 'worktree', { id, msg: `Reusing existing worktree at ${wtPath}`, branch: branchName });
    return wtPath;
  }

  // Ensure base dir exists
  fs.mkdirSync(WORKTREE_BASE, { recursive: true });

  // Check if branch already exists
  let branchExists = false;
  try {
    gitFinalizer.runGit(`git rev-parse --verify refs/heads/${branchName}`, { slice_id: id, op: 'createWorktree_branchCheck', execOpts: { stdio: 'pipe' } });
    branchExists = true;
  } catch (_) {}

  if (branchExists) {
    // Branch exists — check if it's already in another worktree and prune if needed
    try {
      const wtList = gitFinalizer.runGit('git worktree list --porcelain', { slice_id: id, op: 'createWorktree_listCheck', encoding: 'utf-8' });
      const blocks = wtList.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        const wtLine = lines.find(l => l.startsWith('worktree '));
        const brLine = lines.find(l => l.startsWith('branch '));
        if (wtLine && brLine && brLine === `branch refs/heads/${branchName}`) {
          const oldPath = wtLine.replace('worktree ', '');
          if (oldPath !== PROJECT_DIR) {
            try { fs.rmSync(oldPath, { recursive: true, force: true }); } catch (_) {}
            gitFinalizer.runGit('git worktree prune', { slice_id: id, op: 'createWorktree_prune', execOpts: { stdio: 'pipe' } });
            log('info', 'worktree', { id, msg: `Pruned stale worktree at ${oldPath} for branch ${branchName}` });
          }
        }
      }
    } catch (_) {}

    // Existing branch (apendment or retry)
    gitFinalizer.runGit(`git worktree add "${wtPath}" ${branchName}`, { slice_id: id, op: 'createWorktree', execOpts: { stdio: 'pipe' }, worktreePath: wtPath });
  } else {
    // New branch from the integration branch — NOT the trunk. A trunk-based
    // branch point is what made slices 348-352 born-conflicted (slice 353).
    gitFinalizer.runGit(`git worktree add "${wtPath}" -b ${branchName} ${INTEGRATION_BRANCH}`, { slice_id: id, op: 'createWorktree', execOpts: { stdio: 'pipe' }, worktreePath: wtPath });
  }

  // Dependencies, immediately — the workspace is not usable without them and no one
  // downstream (Rom, Nog, Bashir, the merge path) should have to plumb them in.
  const deps = provisionWorkspaceDeps(wtPath, id);

  registerEvent(id, 'WORKTREE_CREATED', { path: wtPath, branch: branchName, deps: deps ? 'linked' : 'missing' });
  log('info', 'worktree', { id, msg: `Created worktree at ${wtPath} on branch ${branchName}`, branchExists, deps });
  return wtPath;
}

/**
 * cleanupWorktree(id, branchName)
 *
 * FUSE-safe worktree cleanup:
 *   1. rm -rf /tmp/ds9-worktrees/{id} (local FS, no FUSE issue)
 *   2. Rename .git/worktrees/{id}/ to .dead suffix (FUSE-safe)
 *   3. Rename branch ref to .dead suffix (FUSE-safe)
 */
function cleanupWorktree(id, branchName) {
  const wtPath = getWorktreePath(id);

  // Step 1: remove worktree directory (local FS — no FUSE)
  try {
    fs.rmSync(wtPath, { recursive: true, force: true });
  } catch (err) {
    log('warn', 'worktree', { id, msg: 'Failed to remove worktree dir', error: err.message });
  }

  // Prune so git knows the worktree is gone
  try {
    gitFinalizer.runGit('git worktree prune', { slice_id: id, op: 'cleanupWorktree', execOpts: { stdio: 'pipe' } });
  } catch (_) {}

  // Step 2: FUSE-safe cleanup of .git/worktrees/{id}/
  const gitWorktreeDir = path.join(PROJECT_DIR, '.git', 'worktrees', String(id));
  if (fs.existsSync(gitWorktreeDir)) {
    try {
      fs.renameSync(gitWorktreeDir, gitWorktreeDir + '.dead');
    } catch (err) {
      log('warn', 'worktree', { id, msg: 'Failed to rename .git/worktrees entry to .dead', error: err.message });
    }
  }

  // Step 3: FUSE-safe cleanup of branch ref
  if (branchName) {
    try {
      branchName = sanitizeBranchName(branchName);
      const refPath = path.join(PROJECT_DIR, '.git', 'refs', 'heads', ...branchName.split('/'));
      if (fs.existsSync(refPath)) {
        fs.renameSync(refPath, refPath + '.dead');
      }
    } catch (err) {
      log('warn', 'worktree', { id, msg: 'Failed to rename branch ref to .dead', error: err.message });
    }
  }

  registerEvent(id, 'WORKTREE_REMOVED', { path: wtPath });
  log('info', 'worktree', { id, msg: `Cleaned up worktree for slice ${id}` });
}

/**
 * isRomSelfTerminated(reason)
 *
 * Returns true for any of the 4 classified rom-self-termination reasons
 * AND for the legacy 'no_report' string (historical register events).
 */
function isRomSelfTerminated(reason) {
  return reason === 'no_report' ||
    reason === 'rom_self_terminated_empty' ||
    reason === 'rom_self_terminated_uncommitted' ||
    reason === 'rom_self_terminated_committed' ||
    reason === 'rom_self_terminated_mixed';
}

/**
 * classifyNoReportExit(id, worktreePath, branchName)
 *
 * Inspects git state in the worktree to classify why Rom exited without a
 * DONE file. Returns { reason, hasCommits, hasDiff, commits, diffSummary, porcelain }.
 */
function classifyNoReportExit(id, worktreePath, branchName) {
  const result = { reason: 'rom_self_terminated_empty', hasCommits: false, hasDiff: false, commits: [], diffSummary: '', porcelain: '' };

  if (!fs.existsSync(worktreePath)) {
    log('warn', 'worktree', { id, msg: 'classifyNoReportExit: worktree dir missing — treating as empty' });
    return result;
  }

  // Check for commits beyond the integration branch
  try {
    const logOutput = gitFinalizer.runGit(`git log ${INTEGRATION_BRANCH}..${branchName} --oneline`, { slice_id: id, op: 'classifyNoReport_log', cwd: worktreePath, encoding: 'utf-8', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } }).trim();
    if (logOutput) {
      result.hasCommits = true;
      result.commits = logOutput.split('\n');
    }
  } catch (_) {}

  // Check for uncommitted changes
  try {
    result.porcelain = gitFinalizer.runGit('git status --porcelain', { slice_id: id, op: 'classifyNoReport_status', cwd: worktreePath, encoding: 'utf-8', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } }).trim();
    if (result.porcelain) {
      result.hasDiff = true;
    }
  } catch (_) {}

  // Get diff summary (truncated)
  try {
    const diff = gitFinalizer.runGit('git diff HEAD', { slice_id: id, op: 'classifyNoReport_diff', cwd: worktreePath, encoding: 'utf-8', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } });
    const lines = diff.split('\n');
    result.diffSummary = lines.slice(0, 200).join('\n') + (lines.length > 200 ? '\n…(truncated)' : '');
  } catch (_) {}

  // Classify
  if (result.hasCommits && result.hasDiff) {
    result.reason = 'rom_self_terminated_mixed';
  } else if (result.hasCommits) {
    result.reason = 'rom_self_terminated_committed';
  } else if (result.hasDiff) {
    result.reason = 'rom_self_terminated_uncommitted';
  }
  // else: remains rom_self_terminated_empty

  return result;
}

/**
 * rescueWorktree(id, branchName, classification, stdout, stderr)
 *
 * Moves the worktree to bridge/worktree-rescue/<id>/ instead of wiping it.
 * Writes a RESCUE.md summary. For committed/mixed classifications, preserves
 * the branch ref. Returns the rescue path.
 */
function rescueWorktree(id, branchName, classification, stdout, stderr) {
  const rescueBase = path.join(PROJECT_DIR, 'bridge', 'worktree-rescue');
  fs.mkdirSync(rescueBase, { recursive: true });

  let rescuePath = path.join(rescueBase, String(id));
  if (fs.existsSync(rescuePath)) {
    rescuePath = `${rescuePath}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }

  const wtPath = getWorktreePath(id);

  // Move worktree directory to rescue location
  try {
    fs.renameSync(wtPath, rescuePath);
  } catch (err) {
    log('error', 'worktree', { id, msg: `rescueWorktree: failed to move worktree to ${rescuePath}`, error: err.message });
    return null;
  }

  // Prune git worktree registry (the dir is gone from its original location)
  try { gitFinalizer.runGit('git worktree prune', { slice_id: id, op: 'rescueWorktree', execOpts: { stdio: 'pipe' } }); } catch (_) {}

  // For empty/uncommitted (no commits on branch), clean up branch ref
  if (!classification.hasCommits && branchName) {
    try {
      branchName = sanitizeBranchName(branchName);
      const refPath = path.join(PROJECT_DIR, '.git', 'refs', 'heads', ...branchName.split('/'));
      if (fs.existsSync(refPath)) {
        fs.renameSync(refPath, refPath + '.dead');
      }
    } catch (_) {}
  }
  // For committed/mixed: keep branch ref alive

  // Write RESCUE.md summary
  const truncate = (s, n) => (s && s.length > n ? '…' + s.slice(-n) : s || '(empty)');
  const rescueMd = [
    '---',
    `id: "${id}"`,
    `rescued: "${new Date().toISOString()}"`,
    `reason: "${classification.reason}"`,
    `has_commits: ${classification.hasCommits}`,
    `has_diff: ${classification.hasDiff}`,
    '---',
    '',
    '## Commits (main..slice)',
    '```',
    classification.commits.length ? classification.commits.join('\n') : '(none)',
    '```',
    '',
    '## Git status --porcelain',
    '```',
    classification.porcelain || '(clean)',
    '```',
    '',
    '## Diff summary (first 200 lines)',
    '```diff',
    classification.diffSummary || '(none)',
    '```',
    '',
    '## Stdout tail',
    '```',
    truncate(stdout, 500),
    '```',
    '',
    '## Stderr tail',
    '```',
    truncate(stderr, 500),
    '```',
  ].join('\n');

  try {
    fs.writeFileSync(path.join(rescuePath, 'RESCUE.md'), rescueMd, 'utf8');
  } catch (err) {
    log('warn', 'worktree', { id, msg: 'Failed to write RESCUE.md', error: err.message });
  }

  log('info', 'worktree', { id, msg: `Rescued worktree to ${rescuePath}`, reason: classification.reason });
  return rescuePath;
}

// Bookkeeping paths: the queue's own paperwork and the run's own records. A branch
// whose entire diff lands inside this list carries no product change (slice 375).
// Everything else — product code, tests, docs, config — counts as substance.
const BOOKKEEPING_PATH_RES = [
  /^bridge\/queue\/[^/]*-DONE\.md$/,
  /^bridge\/state\//,
  /^bridge\/heartbeat\.json$/,
  /^bridge\/timesheet[^/]*\.jsonl$/,
  /^bridge\/trash\//,
];

function isBookkeepingPath(p) {
  return BOOKKEEPING_PATH_RES.some((re) => re.test(p));
}

/**
 * productPathsFromNumstat(numstat)
 *
 * Reads `git diff --numstat --no-renames` output and returns the changed paths
 * that are not bookkeeping. `--no-renames` is load-bearing: with rename detection
 * on, git compacts a pair into `bridge/{state => trash}/x.json`, a string that is
 * not a path and that no path matcher can classify. Binary rows ("-\t-\tpath")
 * are ordinary changes here — only the path matters, never the line counts.
 */
function productPathsFromNumstat(numstat) {
  const out = [];
  for (const line of String(numstat || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const p = parts.slice(2).join('\t').trim(); // paths may contain tabs
    if (p && !isBookkeepingPath(p)) out.push(p);
  }
  return out;
}

/**
 * doneSummarySection(doneText)  (slice 393)
 *
 * The report's `## Summary` flattened to one line, or ''. It is what the BLOCKED register
 * event carries, so the dashboard shows the builder's own words rather than a reason code,
 * and it is what the nothing-to-do phrases below are matched against.
 */
function doneSummarySection(doneText) {
  const body = [];
  let inSummary = false;
  for (const line of String(doneText || '').split('\n')) {
    if (/^##\s+/.test(line)) {
      if (inSummary) break;
      inSummary = /^##\s+Summary\s*$/i.test(line);
      continue;
    }
    if (inSummary) body.push(line);
  }
  return body.join(' ').replace(/\s+/g, ' ').trim();
}

// A report that says, in the builder's own words, that the work was already on dev when he
// arrived. Slice 394 is the case that produced the rule: Philipp made the change by hand at
// 2026-09-14T00:00:16Z, one minute before the brief was approved, and the report reads "The
// rename was already done before I was invoked" and "it is already on `dev` and
// `origin/dev`". Sam changed nothing, correctly, and was filed as fake work.
//
// Narrow on purpose. This route archives a slice with no review at all, so a report that
// does not plainly say the work was already there falls through to the ordinary ERROR.
const NOTHING_TO_DO_SUMMARY_RES = [
  /\balready\b[^.]{0,60}\bon\s+`?(?:origin\/)?dev\b/i,
  /\b(?:was|were|is|are|had been)\s+already\s+(?:done|made|landed|applied|committed|fixed|in place|there|present)\b/i,
  /\bnothing\s+(?:left\s+)?to\s+do\b/i,
];

/**
 * classifyHonestNonProduct(id, branchName, opts) → { kind, summary } | null
 *
 * verifyRomActuallyWorked answers "does the diff contain product work?" — and three honest
 * outcomes answer no. A BLOCKED report is a builder who stopped and said why. A PARTIAL one
 * is a builder who got part of the way. A nothing-to-do one is a builder who found the work
 * already on dev and refused to reauthor it. None of them is fabricated work, and filing
 * them as `rom_no_product_change` punishes exactly the honesty the rule wants (slice 388's
 * first attempt, 2026-09-11 20:20Z; slice 394, 2026-09-14).
 *
 * kind is 'blocked', 'partial' or 'nothing_to_do'; null means the rule stands and the
 * report is filed as fake work. The status test is frontmatter only and needs no git, so a
 * git failure can never turn an honest BLOCKED into an ERROR. The nothing-to-do test does
 * need git and fails closed: no readable diff, no free pass.
 */
function classifyHonestNonProduct(id, branchName, opts) {
  const queueDir = (opts && opts.queueDir) || QUEUE_DIR;
  let doneText;
  try {
    doneText = fs.readFileSync(path.join(queueDir, `${id}-DONE.md`), 'utf-8');
  } catch (_) {
    return null;
  }
  const meta = parseFrontmatter(doneText) || {};
  const status = String(meta.status || '').trim().toUpperCase();
  const summary = doneSummarySection(doneText);

  if (status === 'BLOCKED') return { kind: 'blocked', summary };
  if (status === 'PARTIAL') return { kind: 'partial', summary };

  if (!NOTHING_TO_DO_SUMMARY_RES.some(re => re.test(summary))) return null;

  // "Empty apart from the report": every path the branch changes against dev is this
  // slice's own DONE report. Anything else — a test, a source file, another slice's
  // paperwork — is a change somebody has to review, so it is not nothing to do.
  const runGit = (opts && opts.runGit) || gitFinalizer.runGit;
  let names;
  try {
    names = String(runGit(
      `git diff --name-only --no-renames ${INTEGRATION_BRANCH}...${branchName}`,
      {
        slice_id: id, op: 'honestNonProduct_nameOnly', encoding: 'utf-8', cwd: PROJECT_DIR,
        execOpts: { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
      },
    ));
  } catch (err) {
    log('warn', 'rom_verify', { id, msg: 'git diff --name-only failed — cannot confirm nothing-to-do', error: err.message });
    return null;
  }
  const changed = names.split('\n').map(l => l.trim()).filter(Boolean);
  const reportRel = `bridge/queue/${id}-DONE.md`;
  if (!changed.every(p => p === reportRel)) return null;

  return { kind: 'nothing_to_do', summary };
}

/**
 * verifyRomActuallyWorked(id, branchName, actualDurationMs, actualTokensOut)
 *
 * Checks that Rom's claimed DONE report corresponds to real work on the slice
 * branch. The question is answered by WHAT THE DIFF CONTAINS, never by counting
 * commits and never by the self-reported metrics.
 *
 * Slice 375: the old rule failed any branch with exactly one commit whose DONE
 * report claimed >1000 tokens_out. One clean commit is normal — better practice
 * than two — so the rule filed two finished slices as fabricated: 366 (700
 * insertions, a 274-line suite) and 371 (8 files, +988/−14). Self-reported
 * numbers can no longer fail a slice; they only produce a log warning.
 *
 * Returns { ok: true } or { ok: false, reason, detail } where reason is
 * 'rom_no_commits' (branch level with the integration branch) or
 * 'rom_no_product_change' (commits exist but touch only bookkeeping files).
 */
function verifyRomActuallyWorked(id, branchName, actualDurationMs, actualTokensOut) {
  // Guard: skip rev-list if branch no longer exists (deleted after merge/cleanup).
  const branchExists = (() => {
    try {
      gitFinalizer.runGit(`git rev-parse --verify refs/heads/${branchName}`,
        { slice_id: id, op: 'auditBranchCheck', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } });
      return true;
    } catch (_) { return false; }
  })();
  if (!branchExists) return { ok: true };

  // Count commits ahead of the integration branch on the slice branch
  let commitCount = 0;
  try {
    const countStr = gitFinalizer.runGit(`git rev-list ${branchName} ^${INTEGRATION_BRANCH} --count`, {
      slice_id: id, op: 'verifyRomWork_revList', encoding: 'utf-8',
      execOpts: { stdio: ['pipe', 'pipe', 'pipe'] },
    }).trim();
    commitCount = parseInt(countStr, 10) || 0;
  } catch (err) {
    log('warn', 'rom_verify', { id, msg: 'git rev-list failed during verification — skipping commit check', error: err.message });
    return { ok: true };
  }

  // Read DONE frontmatter for claimed metrics
  let claimedTokensOut = 0;
  let claimedElapsedMs = 0;
  try {
    const doneContent = fs.readFileSync(path.join(QUEUE_DIR, `${id}-DONE.md`), 'utf-8');
    const meta = parseFrontmatter(doneContent);
    if (meta) {
      claimedTokensOut = parseInt(meta.tokens_out, 10) || 0;
      claimedElapsedMs = parseInt(meta.elapsed_ms, 10) || 0;
    }
  } catch (_) {}

  if (commitCount === 0) {
    return {
      ok: false,
      reason: 'rom_no_commits',
      detail: `Branch ${branchName} is level with ${INTEGRATION_BRANCH} — 0 commits ahead; DONE claimed ${claimedTokensOut} tokens_out and ${claimedElapsedMs} elapsed_ms.`,
    };
  }

  // Substance is read off the diff. A git failure here must never file real work
  // as fake, so the check fails open exactly like the rev-list above.
  let numstat = '';
  try {
    numstat = String(gitFinalizer.runGit(
      `git diff --numstat --no-renames ${INTEGRATION_BRANCH}...${branchName}`,
      {
        slice_id: id, op: 'verifyRomWork_numstat', encoding: 'utf-8',
        execOpts: { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
      },
    ));
  } catch (err) {
    log('warn', 'rom_verify', { id, msg: 'git diff --numstat failed during verification — skipping substance check', error: err.message });
    return { ok: true };
  }

  const productPaths = productPathsFromNumstat(numstat);
  if (productPaths.length === 0) {
    return {
      ok: false,
      reason: 'rom_no_product_change',
      detail: `Branch ${branchName} has ${commitCount} commit(s) ahead of ${INTEGRATION_BRANCH}, but the diff changes no product file — only bookkeeping (DONE report, bridge/state, heartbeat, timesheet, trash).`,
    };
  }

  log('info', 'rom_verify', {
    id,
    msg: 'Substance confirmed from the diff',
    commitCount,
    productFiles: productPaths.length,
    sample: productPaths.slice(0, 5),
  });

  // Advisory: metrics divergence (soft flag, not blocking)
  if (actualTokensOut && claimedTokensOut > 10 * actualTokensOut) {
    log('warn', 'rom_verify', {
      id,
      msg: 'Metrics divergence detected (>10× claimed vs actual tokens_out) — soft flag only',
      claimedTokensOut,
      actualTokensOut,
      ratio: Math.round(claimedTokensOut / actualTokensOut),
    });
  }

  return { ok: true };
}

/**
 * cleanupDeadWorktrees()
 *
 * Startup scan: removes .dead entries left by cleanupWorktree from a prior
 * session that couldn't fully delete due to FUSE constraints.
 */
function cleanupDeadWorktrees() {
  // Clean .dead entries from .git/worktrees/
  const worktreesDir = path.join(PROJECT_DIR, '.git', 'worktrees');
  try {
    const entries = fs.readdirSync(worktreesDir);
    for (const entry of entries) {
      if (entry.endsWith('.dead')) {
        try {
          fs.rmSync(path.join(worktreesDir, entry), { recursive: true, force: true });
          log('info', 'worktree', { msg: `Startup: cleaned dead worktree entry ${entry}` });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Clean .dead entries from .git/refs/heads/slice/
  const sliceRefsDir = path.join(PROJECT_DIR, '.git', 'refs', 'heads', 'slice');
  try {
    const entries = fs.readdirSync(sliceRefsDir);
    for (const entry of entries) {
      if (entry.endsWith('.dead')) {
        try {
          fs.unlinkSync(path.join(sliceRefsDir, entry));
          log('info', 'worktree', { msg: `Startup: cleaned dead branch ref slice/${entry}` });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Clean up any leftover worktree dirs in /tmp from crashed sessions
  try {
    if (fs.existsSync(WORKTREE_BASE)) {
      const dirs = fs.readdirSync(WORKTREE_BASE);
      for (const dir of dirs) {
        const wtDir = path.join(WORKTREE_BASE, dir);
        // Check if this worktree is still registered with git
        try {
          const wtList = gitFinalizer.runGit('git worktree list --porcelain', { slice_id: '0', op: 'cleanupDead_wtList', encoding: 'utf-8' });
          if (!wtList.includes(wtDir)) {
            fs.rmSync(wtDir, { recursive: true, force: true });
            log('info', 'worktree', { msg: `Startup: cleaned orphaned worktree dir ${dir}` });
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * verifyWorkingTreeMatchesMain(id, context)
 *
 * After a merge or checkout, verify the working tree has no unexpected
 * differences from git's committed state. If it does, overwrite disk.
 *
 * This catches FUSE-induced partial updates (git wrote some files but
 * couldn't unlink others).
 */
function verifyWorkingTreeMatchesMain(id, context) {
  try {
    const dirty = gitFinalizer.runGit('git diff --name-only HEAD', { slice_id: id, op: 'verifyTree_diff', encoding: 'utf-8' }).trim();
    if (!dirty) return; // Clean — all good.

    const files = dirty.split('\n').filter(Boolean);
    log('warn', 'git_safety', {
      id,
      msg: `Post-${context} verification: ${files.length} files differ from committed state — overwriting disk`,
      files: files.join(', '),
    });

    for (const file of files) {
      const diskPath = path.join(PROJECT_DIR, file);
      try {
        const content = gitFinalizer.runGit(`git show HEAD:${file}`, { slice_id: id, op: 'verifyTree_show', execOpts: { encoding: 'buffer' } });
        fs.writeFileSync(diskPath, content);
      } catch (_) {
        // File was deleted in git — rename to trash
        try { fs.renameSync(diskPath, path.join(TRASH_DIR, path.basename(file) + '.verify-cleanup')); } catch (__) {}
      }
    }
  } catch (err) {
    log('warn', 'git_safety', { id, msg: `Post-${context} verification failed`, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

let heartbeatState = {
  status: 'idle',
  current_slice: null,
  current_slice_title: null,
  current_slice_goal: null,
  pickupTime: null,   // internal — not written to file
  processed_total: 0,
};


function writeHeartbeat() {
  const elapsedSeconds = heartbeatState.pickupTime
    ? Math.floor((Date.now() - heartbeatState.pickupTime) / 1000)
    : null;

  // Map getQueueSnapshot keys to the dashboard's expected schema:
  //   in_progress → active, completed → done, failed → error
  const raw = getQueueSnapshot(QUEUE_DIR);
  const queue = {
    waiting: raw.waiting,
    active:  raw.in_progress,
    done:    raw.completed,
    error:   raw.failed,
  };

  const snapshot = {
    ts: new Date().toISOString(),
    pickup_ts: heartbeatState.pickupTime
      ? new Date(heartbeatState.pickupTime).toISOString()
      : null,
    status: heartbeatState.status,
    current_slice: heartbeatState.current_slice,
    current_slice_title: heartbeatState.current_slice_title,
    current_slice_goal: heartbeatState.current_slice_goal,
    slice_elapsed_seconds: elapsedSeconds,
    last_activity_ts: currentLastActivityTs ? currentLastActivityTs.toISOString() : null,
    processed_total: heartbeatState.processed_total,
    queue,
  };

  try {
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(snapshot, null, 2) + '\n');
  } catch (err) {
    log('warn', 'heartbeat', { msg: 'Failed to write heartbeat', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Processing state
// ---------------------------------------------------------------------------

let processing = false;
let idlePrintCounter = 0;
let sessionHasProcessed = false;

// Adaptive idle poll — increases poll interval after sustained inactivity.
const IDLE_POLL_MS      = 30000; // 30s when idle
const IDLE_THRESHOLD    = 24;    // 24 × 5s = 2 minutes before switching to idle poll
let consecutiveIdleTicks = 0;
let currentPollMs = null; // set in start() from config.pollIntervalMs

// ---------------------------------------------------------------------------
// Active child process tracking — keyed by slice ID.
// Used by pause/resume/abort control actions.
// ---------------------------------------------------------------------------

const activeChildren = new Map(); // Map<sliceId: string, { child: ChildProcess, worktreePath: string }>

/**
 * releaseDispatch(id)  (slice 393)
 *
 * Hand the dispatch slot back. The tail of the exit callback does this for every slice
 * that reaches it; a branch that returns early owes it by hand, and one of them did not:
 * "Rom wrote DONE but verification failed" returned with processing still true and the
 * heartbeat still naming the slice, so the poll loop dispatched nothing until someone
 * restarted the daemon — slice 388 froze the queue from 2026-09-11 20:20Z to 22:41Z and
 * 387's rework waited two hours behind it.
 *
 * Same fields as the rate-limit and api-retry returns, plus the heartbeat write the
 * dashboard's liveness reads. processed_total is deliberately left alone: the tail counts
 * slices that completed, and none of these did.
 */
function releaseDispatch(id) {
  activeChildren.delete(String(id));
  processing = false;
  heartbeatState.status = 'idle';
  heartbeatState.current_slice = null;
  heartbeatState.current_slice_title = null;
  heartbeatState.current_slice_goal = null;
  heartbeatState.pickupTime = null;
  writeHeartbeat();
}

// ---------------------------------------------------------------------------
// Rom invocation
// ---------------------------------------------------------------------------

/**
 * buildHashLines(sliceContent) → string[]
 *
 * The `// @ac-hash:` line for every tagged criterion in a brief, one per criterion.
 *
 * Each safety-net test has to carry, beside its tag, the hash of the criterion text it
 * guards; without it reconcile marks that criterion STALE. The recipe was written down in
 * no brief and no template, so every builder rediscovered it by reading the gate machinery
 * — on slice 383 that was eight tool calls into build-ac-manifest.js and the locks before
 * a line of product code. Computing the lines here hands him the answer instead: he copies
 * one line per criterion and never opens the deriver.
 *
 * Pure. build-ac-manifest and ac-block are required lazily, so a repo without them (a test
 * fixture) still builds a template rather than throwing at module load.
 */
function buildHashLines(sliceContent) {
  let acs;
  try {
    const { parseAcBlock } = require('../lib/ac-block');
    acs = parseAcBlock(String(sliceContent == null ? '' : sliceContent)).acs || [];
  } catch (_) { return []; }
  if (!acs.length) return [];

  let acHashOf;
  try {
    ({ acHashOf } = require('../scripts/build-ac-manifest'));
  } catch (_) { return []; }

  // Four-space indent: the prompt renders it as a code block, so the builder copies the
  // line verbatim instead of picking it out of a paragraph.
  return acs.map(ac => `    // @ac-hash: ${ac.tag} ${acHashOf(ac.text)}`);
}

/**
 * buildDoneTemplate({ id, worktreeDonePath, sliceBranch, sliceContent, lane })
 *
 * The DONE report template glued to the end of every brief Rom receives.
 * Pure and exported so its words can be tested — inline in invokeRom, nothing
 * could check what the prompt actually demanded (slice 386).
 *
 * It no longer demands real, non-zero metrics: the orchestrator fills the three
 * machine metrics from the session, so asking Rom for numbers he cannot observe
 * only ever produced invented ones. sliceContent is read for the hash lines
 * (slice 387).
 *
 * The lane decides two things and only two (slice 389): which report headings the
 * builder is asked for, and which test rule he is held to. Everything else — the
 * report path, the frontmatter example, the run rules, the hash lines and the
 * trailer instruction — is the same string in both lanes. An unrecognised or
 * absent lane is core, so a brief from before lanes existed reads exactly as it
 * always did.
 */
function buildDoneTemplate({ id, worktreeDonePath, sliceBranch, sliceContent, lane }) {
  const hashLines = buildHashLines(sliceContent);
  const isSurface = resolveLane({ lane }) === 'surface';

  // The report the lane asks for. Core: the seven headings of the 3 September
  // ruling (docs/contracts/done-report-format.md), in order, plus the break-it
  // check. Surface: four headings and no break-it check — Jordan reads the diff
  // and the browser suite covers the screen at the gate, so a test that asserts
  // "the heading says Coverage" only restates the diff at the price of a session.
  const reportSection = isSurface
    ? [
        '',
        '## Your report',
        '',
        'This slice is surface lane. The report body has exactly four headings, in this order:',
        '',
        '- `## Summary`',
        '- `## What changed`',
        '- `## Screen hooks`',
        '- `## Commit`',
        '',
        'Add `## Safety-net tests` only if you wrote one.',
        '',
        'Write a safety-net test only for a criterion that asserts behaviour (an interaction or a computed value). A criterion about what the screen shows or says needs no test; Jordan checks it in the diff and the browser suite covers the screen at the gate. No break-it check.',
      ]
    : [
        '',
        '## Your report',
        '',
        'This slice is core lane. The report body has these headings, in this order, every one present even when the answer is "None":',
        '',
        '- `## Summary`',
        '- `## What changed`',
        '- `## Acceptance criteria verification`',
        '- `## Safety-net tests`',
        '- `## Screen hooks`',
        '- `## Tests moved or weakened`',
        '- `## Commit`',
        '',
        'Write one safety-net test per acceptance criterion, plus one for each trap, then stop; before committing, stash your fix, run your new test file, confirm every new test goes red, restore the fix, and list which went red under Safety-net tests.',
      ];
  // A brief with no tagged criteria gets no heading — an empty section reads as a
  // missing list. The three sentences below are unconditional: they are the rule, not
  // the data, and they are what keeps him out of the lock files whether or not this
  // brief has criteria.
  const hashSection = hashLines.length
    ? ['', '## Your hash lines', '', ...hashLines]
    : [];
  return [
    '',
    '## DONE report template',
    '',
    'Write your report to: ' + worktreeDonePath,
    '',
    'Use this exact frontmatter structure (the orchestrator fills the metric fields):',
    '',
    '```',
    '---',
    'id: "' + id + '"',
    'title: "(slice title)"',
    'from: rom',
    'to: nog',
    'status: DONE',
    'slice_id: "' + id + '"',
    'branch: "' + sliceBranch + '"',
    'completed: "' + new Date().toISOString() + '"',
    'tokens_in: 0',
    'tokens_out: 0',
    'elapsed_ms: 0',
    'estimated_human_hours: 0.0',
    'compaction_occurred: false',
    '---',
    '```',
    '',
    'Leave tokens_in, tokens_out and elapsed_ms at 0; the orchestrator fills them from the session. estimated_human_hours is optional: your honest guess of how long a skilled human would take, or 0. compaction_occurred is true only if your context was compacted mid-session.',
    '- completed: must be full ISO 8601 UTC datetime (e.g. "2026-04-12T01:22:40.000Z"), never date-only',
    ...reportSection,
    // Four lines, and no brief can override them (slice 388). On slice 383 the full
    // safety-net suite ran six times inside one session — 4.9 of 16.3 minutes, four of
    // those repeats spent hunting skipped-test names for one sentence of the report.
    // Machines run suites; agents do not (ADR-PROOF-LANES). GitHub runs the suite on the
    // push that lands the slice, and a red run files its own fix request in Alex's inbox,
    // so nothing is lost by taking the suite off him.
    '',
    '## What you run',
    '',
    '- Run only the test file you wrote, as often as you like.',
    '- Never run the full safety-net suite (`npm test`, `node --test regression/**`) and never the browser suite.',
    '- GitHub runs the safety-net suite when your slice lands on dev; if it goes red, Alex gets a fix request.',
    '- Do not chase suite numbers for your report; the report has no suite section.',
    ...hashSection,
    '',
    'Put the matching line beside the tag in each safety-net test you write. Do not run build-coverage-map or build-ac-manifest and do not edit regression/*.lock; the pipeline regenerates them when the slice lands. Stage your report with `git add -f bridge/queue/' + id + '-DONE.md`.',
  ].join('\n');
}

/**
 * invokeRom(sliceContent, donePath, inProgressPath, errorPath, id, effectiveTimeoutMs)
 *
 * Pipes slice content + report path instruction to `claude -p`.
 * On success: checks donePath exists; if not, writes a fallback ERROR report.
 * On failure: writes an ERROR report.
 * Always cleans up the IN_PROGRESS file on completion (existence-checked to
 * avoid ENOENT when Rom's crash recovery already handled it).
 */
function invokeRom(sliceContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal) {
  // ── WATCHER-OWNED BRANCH LIFECYCLE ─────────────────────────────────────
  // The orchestrator OWNS all branching. Rom never creates, checks out, or manages
  // branches. This is the rigid pipeline gate that prevents prompt-quality
  // failures from corrupting git state.
  //
  // New slices:  main → create slice/{id} branch → invoke Rom on that branch
  // Apendments:  checkout existing branch → invoke Rom on that branch
  // ──────────────────────────────────────────────────────────────────────────
  const sliceMeta = parseFrontmatter(sliceContent) || {};
  const romLane = resolveLane(sliceMeta);
  const isApendment = !!(sliceMeta.apendment || sliceMeta.amendment || (sliceMeta.references && sliceMeta.references !== 'null') || (parseInt(sliceMeta.round, 10) > 1));
  const sliceBranch = isApendment
    ? (sliceMeta.apendment || sliceMeta.amendment || sliceMeta.branch || `slice/${sliceMeta.root_commission_id || id}`)
    : `slice/${id}`;

  // ── WORKTREE-BASED BRANCH LIFECYCLE ──────────────────────────────────────
  // Each slice gets its own git worktree at /tmp/ds9-worktrees/{id}/.
  // PROJECT_DIR stays on main permanently. The dashboard is never affected.
  //
  // New slices:  create worktree with new branch from the integration branch
  // Apendments:  create worktree on existing branch (prunes old worktree if needed)
  // ──────────────────────────────────────────────────────────────────────────
  let worktreePath;
  try {
    ensureIntegrationIsFresh(id);
    worktreePath = gitFinalizer.createWorktreeWithRetry(createWorktree, id, sliceBranch);
    log('info', 'branch', { id, msg: `Worktree ready at ${worktreePath} on branch ${sliceBranch}`, isApendment });
  } catch (err) {
    // If retry exhaustion enriched the error, use the stale reason
    const reason = err.retryReason
      ? err.retryReason
      : (isApendment ? 'apendment_branch_checkout_failed' : 'branch_creation_failed');
    const extraFields = err.lockInfo || {};
    log('error', 'branch', { id, msg: `Failed to create worktree for ${sliceBranch} — aborting invocation`, error: err.message, reason });
    const errorPath2 = path.join(QUEUE_DIR, `${id}-ERROR.md`);
    writeErrorFile(errorPath2, id, reason, err, '', '', extraFields);
    log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
    registerEvent(id, 'ERROR', {
      reason,
      phase: 'worktree_setup',
      command: `git worktree add … ${sliceBranch}`,
      exit_code: err.status != null ? err.status : null,
      stderr_tail: truncStderr(err.stderr ? err.stderr.toString() : err.message),
    });
    appendOperationalEvent({
      event: 'ERROR',
      slice_id: id,
      root_id: sliceMeta.root_commission_id || null,
      cycle: null,
      branch: sliceBranch || null,
      details: `Slice ${id} errored: ${reason}`,
    });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_title = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Ensure the worktree has a queue directory for the DONE report
  const worktreeQueueDir = path.join(worktreePath, 'bridge', 'queue');
  fs.mkdirSync(worktreeQueueDir, { recursive: true });
  const worktreeDonePath = path.join(worktreeQueueDir, `${id}-DONE.md`);

  const prompt = sliceContent + buildDoneTemplate({ id, worktreeDonePath, sliceBranch, sliceContent, lane: romLane });

  const pickupTime = Date.now();

  // Activity tracking: updated whenever the child writes to stdout or stderr.
  // killedByInactivity is set to true before we manually kill so the callback
  // can distinguish our inactivity kill from an external SIGTERM.
  let lastActivityTs = Date.now();
  let killedByInactivity = false;
  currentLastActivityTs = new Date();

  heartbeatState.status = 'processing';
  heartbeatState.current_slice = id;
  heartbeatState.current_slice_title = title || null;
  heartbeatState.current_slice_goal = goal || null;
  heartbeatState.pickupTime = pickupTime;
  writeHeartbeat();

  // ── Session resume for rework rounds ─────────────────────────────────────
  // On round > 1, reuse Rom's prior session to avoid expensive re-orientation.
  // Falls back to fresh session when: no session_id, keyword trigger, or long
  // rejection (indicating substantial rework).
  // ──────────────────────────────────────────────────────────────────────────
  const romRound = parseInt(sliceMeta.round, 10) || 1;
  const romSessionId = sliceMeta.rom_session_id || null;
  let sessionResumed = false;

  // Extract the Nog rejection reason from the latest "### Nog review summary" section.
  // Read unconditionally now: romSpawnArgs re-derives the resume decision from it, so
  // it has to exist on every path, not only inside the round > 1 branch.
  const nogSummaryMatch = sliceContent.match(/### Nog review summary\s*\n+([\s\S]*?)(?=\n###|\n## |$)/);
  const nogReason = nogSummaryMatch ? nogSummaryMatch[1].trim() : '';

  if (romRound > 1 && romSessionId) {
    if (shouldForceFreshSession(nogReason)) {
      const freshReason = nogReason.length > 500 ? 'long_feedback' : 'trigger_keyword';
      log('info', 'session', { id, msg: `Rework round ${romRound} — forcing fresh session`, reason: freshReason });
      registerEvent(id, 'ROM_SESSION_FRESH', { session_id: romSessionId, round: romRound, reason_for_fresh: freshReason });
    } else {
      sessionResumed = true;
      log('info', 'session', { id, msg: `Rework round ${romRound} — resuming session ${romSessionId}` });
      registerEvent(id, 'ROM_SESSION_RESUMED', { session_id: romSessionId, round: romRound, reason_for_fresh: null });
    }
  } else if (romRound > 1 && !romSessionId) {
    log('info', 'session', { id, msg: `Rework round ${romRound} — no session_id available, using fresh session` });
    registerEvent(id, 'ROM_SESSION_FRESH', { session_id: null, round: romRound, reason_for_fresh: 'no_session_id' });
  }

  // One call, both paths (slice 389). The resume list used to be assembled inline in
  // the branch above, which is why the lane's effort would have reached round 1 and
  // silently missed every rework round.
  const clauseArgs = romSpawnArgs({
    claudeArgs: config.claudeArgs,
    laneArgs: config.laneArgs,
    lane: romLane,
    round: romRound,
    sessionId: romSessionId,
    nogReason,
  });

  log('info', 'invoke', {
    id,
    msg: 'Invoking claude -p',
    command: config.claudeCommand,
    args: clauseArgs,
    cwd: worktreePath,
    inactivityTimeoutMs: effectiveInactivityMs,
    sessionResumed,
    lane: romLane,
  });

  // Progress tick: every 60s while Rom is running — stdout only, not bridge.log.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  // Live build log: the session is teed to a per-slice log file
  // (bridge/logs/rom-<id>.log) as it arrives, so the operator can watch the build
  // in real time via GET /api/log/<id>. The write stream lives inside the session
  // helper now (slice 396); this is where its path is decided.
  const romLogPath = path.join(LOGS_DIR, `rom-${id}.log`);

  // Both reached for HERE and not at module scope, the way recordBuildTiming
  // reaches for lib/build-timing inside itself: the daemon has to boot in a tree
  // that has no lib/ at all (slice 393's recovery sandbox is exactly that).
  const { streamSession } = require('../lib/session-stream');
  // Where the minutes went (slice 392), attributed one event at a time now that
  // there is no session text left to attribute afterwards.
  let attributor = null;
  try { attributor = require('../lib/build-timing').createAttributor(); } catch (_) { attributor = null; }

  const child = streamSession(
    {
      command: config.claudeCommand,
      args: clauseArgs,
      cwd: worktreePath,
      prompt,
      logPath: romLogPath,
      // Output is what keeps a session alive. Every chunk — stdout or stderr —
      // resets the inactivity clock; a chunk that did not reach here would be a
      // session killed as inactivity_timeout while it was still talking.
      onActivity: () => {
        lastActivityTs = Date.now();
        currentLastActivityTs = new Date();
      },
      onEvent: attributor ? (ev) => attributor.event(ev) : null,
    },
    ({ code, signal, spawnError, retained }) => {
      clearInterval(tickInterval);
      clearInterval(inactivityCheck);

      // Reset module-level activity state.
      currentLastActivityTs = null;

      // All that is left of the session's output: the last 64 KB of each stream.
      // Everything below quotes these — the ERROR file, the rescue summary, the
      // register's stderr tail — and nothing below may assume more (slice 396).
      const stdoutTail = retained.stdoutTail;
      const stderrTail = retained.stderrTail;

      // execFile's `err`, rebuilt from the child's own close: null on a clean
      // exit, and otherwise the three fields every reader below asks it for. A
      // command that could not be started keeps its own code (ENOENT), as it did
      // when spawn's failure arrived as a callback argument.
      const err = spawnError
        ? { code: spawnError.code, signal: null, killed: !!child.killed, message: spawnError.message }
        : (code === 0 && !signal)
          ? null
          : {
              code,
              signal,
              killed: !!child.killed,
              message: `Command failed: ${config.claudeCommand} ${signal ? `killed with ${signal}` : `exited ${code}`}`,
            };

      const durationMs = Date.now() - pickupTime;

      // The session's real numbers, read once (slice 386). Everything below —
      // the report, the register event, the timesheet row, the terminal block
      // and the rounds telemetry — is fed from this one object, so one run can
      // no longer produce three different cost figures. The line it reads is the
      // session's result event, kept as it streamed past; the last JSON object on
      // the stream stands in when the session never reached one.
      const telemetryLine = retained.resultLine || retained.lastJsonLine || '';
      const telemetry = sessionTelemetry(telemetryLine, durationMs);
      const { tokensIn, tokensOut, costUsd } = telemetry;

      // And where those minutes went (slice 392). One number per build could not
      // say whether the time was the product change or the proof and paperwork
      // around it; this attributes every tool call in the run to a phase and
      // parks the split next to the log. Best-effort by construction — it never
      // fails the run.
      let buildSplit = null;
      try { buildSplit = attributor ? attributor.result() : null; } catch (_) { buildSplit = null; }
      const buildTiming = recordBuildTiming(buildSplit, id, LOGS_DIR);

      // ── POST-INVOCATION BRANCH VERIFICATION (worktree) ──────────────────
      // With worktrees, verify the branch state inside the worktree, not
      // PROJECT_DIR (which stays on main permanently).
      try {
        const wtCwd = fs.existsSync(worktreePath) ? worktreePath : PROJECT_DIR;
        const branchCheck = verifyBranchState(id, sliceBranch, wtCwd);
        if (!branchCheck.ok) {
          log('warn', 'git_safety', {
            id,
            msg: `Post-invocation branch check: ${branchCheck.issues.length} issue(s)`,
            issues: branchCheck.issues,
            branch: sliceBranch,
            worktreePath,
          });
        }
      } catch (verifyErr) {
        log('warn', 'git_safety', { id, msg: 'Post-invocation branch verification error (non-fatal)', error: verifyErr.message });
      }
      // ────────────────────────────────────────────────────────────────────

      // ── Copy DONE file from worktree to PROJECT_DIR ─────────────────────
      // Rom writes to the worktree. The evaluation pipeline reads from
      // PROJECT_DIR/bridge/queue/. Copy so both pipelines work.
      try {
        if (fs.existsSync(worktreeDonePath) && !fs.existsSync(donePath)) {
          fs.copyFileSync(worktreeDonePath, donePath);
          log('info', 'worktree', { id, msg: 'Copied DONE file from worktree to PROJECT_DIR' });
        }
      } catch (copyErr) {
        log('warn', 'worktree', { id, msg: 'Failed to copy DONE file from worktree', error: copyErr.message });
      }
      // ────────────────────────────────────────────────────────────────────

      // ── Fill the report's metrics from the session (slice 386) ──────────
      // The contract has always said the watcher fills these. Rewrite the queue
      // copy in place here, before any reader — validation, verification, the
      // timesheet, Nog's rounds telemetry — sees it. Rom's own committed copy on
      // his branch is left alone; rewriting his commit is not this slice's job.
      try {
        if (fs.existsSync(donePath)) {
          const asWritten = fs.readFileSync(donePath, 'utf-8');
          const filled = fillDoneMetrics(asWritten, telemetry);
          if (filled !== asWritten) fs.writeFileSync(donePath, filled);
          log('info', 'complete', {
            id,
            msg: 'Filled the DONE report metrics from the session',
            tokensIn: telemetry.tokensIn,
            tokensOut: telemetry.tokensOut,
            tokensCacheRead: telemetry.tokensCacheRead,
            elapsedMs: telemetry.elapsedMs,
            costUsd: telemetry.costUsd,
          });
        }
      } catch (fillErr) {
        log('warn', 'complete', { id, msg: 'Failed to fill DONE report metrics — leaving the report as Rom wrote it', error: fillErr.message });
      }
      // ────────────────────────────────────────────────────────────────────

      if (!err) {
        // Success path: check Rom wrote his DONE file.
        if (fs.existsSync(donePath)) {
          // --- Metrics read-back (Bet 3, no longer a gate — slice 386) ---
          // Defaults to {} because the metrics check no longer returns early:
          // an unreadable report now walks on to verification and the timesheet,
          // and neither may throw on it.
          let doneMeta = {};
          try {
            doneMeta = parseFrontmatter(fs.readFileSync(donePath, 'utf-8')) || {};
          } catch (_) {}

          // A report is never failed for its metrics (slice 386). The numbers are
          // the watcher's to supply and it has just supplied them; not-ok here
          // means the session output was unparseable, which is a watcher problem
          // worth a line in the log and nothing more.
          const metricsValid = validateDoneMetrics(doneMeta);
          if (!metricsValid.ok) {
            log('warn', 'complete', {
              id,
              msg: 'Session metrics unavailable after filling the DONE report — continuing to verification',
              invalid: metricsValid.invalid,
              durationMs,
            });
          }

          // --- Rom verification gate (slice 212) ---
          const verify = verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut);
          if (!verify.ok) {
            // Three honest reports reach this branch with nothing but bookkeeping in the
            // diff, and the rule must not catch any of them (slice 393). The verdict is
            // read HERE, inside the branch — the call above stays the one
            // j-rom-work-substance pins, in the order it pins it.
            const honest = classifyHonestNonProduct(id, sliceBranch);

            if (!honest) {
              writeErrorFile(errorPath, id, verify.reason, null, stdoutTail, stderrTail, { detail: verify.detail, durationMs });
              registerEvent(id, 'ERROR', {
                reason: verify.reason,
                phase: 'rom_verification',
                detail: verify.detail,
                durationMs,
                actualTokensOut: tokensOut,
                stderr_tail: truncStderr(stderrTail),
              });
              appendOperationalEvent({
                event: 'ERROR',
                slice_id: id,
                root_id: sliceMeta.root_commission_id || null,
                cycle: null,
                branch: sliceBranch || null,
                details: `Slice ${id} errored: ${verify.reason}`,
              });
              log('warn', 'rom', { id, msg: 'Rom wrote DONE but verification failed — treating as error', reason: verify.reason, detail: verify.detail });
              closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'Rom verification failed: ' + verify.reason);
              recordSessionResult(false, tokensIn, tokensOut, costUsd);
              releaseDispatch(id);
              return;
            }

            const summary = honest.summary.slice(0, 300);

            if (honest.kind === 'blocked') {
              // No ERROR file: Sam stopped and said why, which is the behaviour we want.
              // The ticket goes back to staged/ for O'Brien — the slice-broken escalation's
              // route — carrying the blocker at the top of its body, so the next thing that
              // happens is a human reading it rather than another round.
              registerEvent(id, 'BLOCKED', {
                slice_id: String(id),
                branch: sliceBranch || null,
                summary,
                durationMs,
                ...laneEventFields(sliceMeta, clauseArgs),
              });
              let returned = false;
              try {
                const ticket = updateFrontmatter(fs.readFileSync(inProgressPath, 'utf-8'), { status: 'STAGED' });
                const notice = [
                  `## Blocked by Rom (${new Date().toISOString()})`,
                  '',
                  summary || '(the report gave no summary)',
                  '',
                  `The report Rom wrote is in \`bridge/trash/${id}-DONE.md.blocked\`.`,
                  '',
                ].join('\n');
                const fmMatch = ticket.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/);
                const staged = fmMatch ? `${fmMatch[1]}\n\n${notice}\n${fmMatch[2]}` : `${ticket}\n\n${notice}`;
                fs.writeFileSync(path.join(STAGED_DIR, `${id}-STAGED.md`), staged);
                fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.blocked'));
                returned = true;
                log('info', 'state', { id, from: 'IN_PROGRESS', to: 'STAGED', reason: 'rom_blocked' });
              } catch (err) {
                log('warn', 'rom', { id, msg: 'Could not return the blocked ticket to staged — it stays in the queue for the operator', error: err.message });
              }
              try { fs.renameSync(donePath, path.join(TRASH_DIR, `${id}-DONE.md.blocked`)); } catch (_) {}
              log('warn', 'rom', { id, msg: 'Rom reported BLOCKED — no ERROR file, ticket returned to O\'Brien', summary, returned, reason: verify.reason });
              print(`  ${C.yellow}${SYM.back}${C.reset}  Slice ${id} blocked${SYM.dash}returned to O'Brien`);
              closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'Rom reported BLOCKED', `Blocked${SYM.arrow}Returned to O'Brien`);
              recordSessionResult(false, tokensIn, tokensOut, costUsd);
              releaseDispatch(id);
              return;
            }

            if (honest.kind === 'nothing_to_do') {
              // The work was already on dev when Sam arrived and he refused to reauthor it.
              // Not an error and not a round: there is no diff for Jordan to read, so the
              // ticket is archived where it stands and the report goes with it.
              registerEvent(id, 'NOTHING_TO_DO', {
                slice_id: String(id),
                branch: sliceBranch || null,
                summary,
                durationMs,
                ...laneEventFields(sliceMeta, clauseArgs),
              });
              let archived = false;
              try {
                fs.renameSync(inProgressPath, path.join(QUEUE_DIR, `${id}-ARCHIVED.md`));
                archived = true;
                log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ARCHIVED', reason: 'nothing_to_do' });
              } catch (err) {
                log('warn', 'rom', { id, msg: 'Could not archive the nothing-to-do ticket', error: err.message });
              }
              if (archived) {
                // Sweeps the DONE report out of the queue with it, so the evaluator never
                // sees a report whose slice is already finished.
                try { archiveSiblingStateFiles(id, 'ARCHIVED'); } catch (_) {}
                try { recordArchivedQueueRename(id); } catch (err) {
                  log('warn', 'archive', { id, msg: 'Archive rename recording threw', error: err.message });
                }
              } else {
                try { fs.renameSync(donePath, path.join(TRASH_DIR, `${id}-DONE.md.nothing-to-do`)); } catch (_) {}
              }
              log('info', 'rom', { id, msg: 'Nothing to do — the work was already on dev; archived without review', summary, archived });
              print(`  ${C.green}${SYM.check}${C.reset} Slice ${id}${SYM.dash}Nothing to do, already on dev`);
              closeSliceBlock(true, durationMs, tokensIn, tokensOut, costUsd, null, `Nothing to do${SYM.arrow}Archived without review`);
              recordSessionResult(true, tokensIn, tokensOut, costUsd);
              releaseDispatch(id);
              return;
            }

            // PARTIAL: part of the work is real and all of it is reviewable. On to Jordan,
            // exactly as today — the only thing skipped is the fake-work verdict.
            log('info', 'rom', { id, msg: 'DONE report is PARTIAL — the substance rule does not apply; going to review', reason: verify.reason, summary });
          }

          // --- Write Point 1: append timesheet row (Bet 3) ---
          const expectedHours = sliceMeta.expected_human_hours && sliceMeta.expected_human_hours !== 'null'
            ? parseFloat(sliceMeta.expected_human_hours)
            : null;
          // Rom's two judgment fields are still his; the metrics are the
          // session's. He may now leave estimated_human_hours out entirely.
          const claimedHours = parseFloat(doneMeta.estimated_human_hours);

          // timesheet write point 1 — append orchestrator row at DONE
          appendTimesheet({
            ts: new Date(pickupTime).toISOString(),
            role: 'rom',
            source: 'orchestrator',
            commission_id: String(id),
            title: (sliceMeta.title || title || '').replace(/^["']|["']$/g, ''),
            phase: null,
            human_hours: isNaN(claimedHours) ? null : claimedHours,
            human_role: null,
            actual_minutes: null,
            notes: null,
            deliverable: null,
            slice: null,
            tokens_in: telemetry.tokensIn,
            tokens_out: telemetry.tokensOut,
            tokens_cache_read: telemetry.tokensCacheRead,
            cost_usd: telemetry.costUsd,
            elapsed_ms: telemetry.elapsedMs,
            compaction_occurred: doneMeta.compaction_occurred === 'true',
            runtime: 'legacy',
            expected_human_hours: isNaN(expectedHours) ? null : expectedHours,
            result: null,
            cycle: null,
            ts_pickup: new Date(pickupTime).toISOString(),
            ts_done: new Date().toISOString(),
            ts_result: null,
          });

          log('info', 'complete', { id, msg: "Rom finished — DONE file present", durationMs, tokensIn, tokensOut });
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'DONE' });
          registerEvent(id, 'DONE', {
            durationMs: telemetry.elapsedMs,
            tokensIn: telemetry.tokensIn,
            tokensOut: telemetry.tokensOut,
            tokensCacheRead: telemetry.tokensCacheRead,
            costUsd: telemetry.costUsd,
            ...laneEventFields(sliceMeta, clauseArgs),
            // phases / first_product_edit_s / calls (slice 392). Spread last and
            // sharing no key with anything above it, so the split is added to
            // this event and takes nothing away from it. Empty when attribution
            // failed: the History row then shows what it always showed.
            ...buildTiming,
          });
          closeSliceBlock(true, durationMs, tokensIn, tokensOut, costUsd, null);
          recordSessionResult(true, tokensIn, tokensOut, costUsd);
        } else {
          // Rom exited 0 but wrote no DONE file — classify and rescue/wipe.
          const noReportClass = classifyNoReportExit(id, worktreePath, sliceBranch);
          const classifiedReason = noReportClass.reason;
          log('warn', 'complete', {
            id,
            msg: `Rom exited cleanly but wrote no DONE file — classified as ${classifiedReason}`,
            reason: classifiedReason,
            hasCommits: noReportClass.hasCommits,
            hasDiff: noReportClass.hasDiff,
            durationMs,
          });

          // Rescue or wipe based on classification
          let rescuePath = null;
          if (classifiedReason !== 'rom_self_terminated_empty') {
            rescuePath = rescueWorktree(id, sliceBranch, noReportClass, stdoutTail, stderrTail);
          } else {
            try { cleanupWorktree(id, sliceBranch); } catch (_) {}
          }

          writeErrorFile(errorPath, id, classifiedReason, null, stdoutTail, stderrTail, { durationMs, rescue_path: rescuePath });
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: classifiedReason });
          registerEvent(id, 'ERROR', {
            reason: classifiedReason,
            phase: 'rom_invocation',
            command: [config.claudeCommand, ...config.claudeArgs].join(' '),
            exit_code: null,
            stderr_tail: truncStderr(stderrTail),
            durationMs,
            rescue_path: rescuePath,
          });
          appendOperationalEvent({
            event: 'ERROR',
            slice_id: id,
            root_id: sliceMeta.root_commission_id || null,
            cycle: null,
            branch: sliceBranch || null,
            details: `Slice ${id} errored: ${classifiedReason}${rescuePath ? ` (rescued to ${rescuePath})` : ''}`,
          });
          // timesheet write point 2 — update orchestrator row at terminal state
          updateTimesheet(id, { result: 'ERROR', cycle: null, ts_result: new Date().toISOString() });
          closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'No report written');
          recordSessionResult(false, tokensIn, tokensOut, costUsd);
        }
      } else {
        // Failure path: distinguish inactivity kill vs other signals vs crash.
        let reason;
        let reasonDisplay;
        let extra = null;

        if (killedByInactivity) {
          const lastActivitySecondsAgo = Math.floor((Date.now() - lastActivityTs) / 1000);
          const inactivityLimitMinutes = Math.round(effectiveInactivityMs / 60000);
          reason = 'inactivity_timeout';
          reasonDisplay = `Inactivity timeout (${inactivityLimitMinutes}min)`;
          extra = { lastActivitySecondsAgo, inactivityLimitMinutes, durationMs };
          log('error', 'inactivity_timeout', {
            id,
            msg: 'Slice killed due to inactivity',
            reason,
            lastActivitySecondsAgo,
            inactivityLimitMinutes,
            durationMs,
          });
        } else {
          reason = (err.killed && err.signal === 'SIGTERM') ? 'timeout' : 'crash';
          reasonDisplay = reason === 'timeout' ? 'Timed out' : 'Process failed';
          extra = { durationMs };
          log('error', reason === 'timeout' ? 'timeout' : 'error', {
            id,
            msg: reason === 'timeout' ? 'Slice timed out' : 'claude -p failed',
            reason,
            exitCode: err.code,
            signal: err.signal || null,
            durationMs,
          });
        }

        // ── Rate limit recovery ───────────────────────────────────────────────
        // Claude API returns is_error:true with "hit your limit" text when the
        // account's rate limit is exceeded.  This is NOT a bug in the slice —
        // requeue it and pause dispatch until the limit resets.
        // Only a REJECTED rate-limit event or the CLI's own limit message is a rate limit. The
        // CLI also emits "approaching your limit" warnings at 90% utilisation mid-session (13 in
        // slice 363's log); matching those paused dispatch for eight hours over a buffer crash.
        // Asked of the whole session, not of its last 64 KB: a limit announced in
        // the first minute of a 40-minute session is still a limit (slice 396).
        const isRateLimit = reason === 'crash' &&
          (retained.flags.hitYourLimit || retained.flags.rateLimitRejected);

        if (isRateLimit) {
          // Calculate how long to wait before retrying. The reset time is the
          // CLI's last word on the subject, so the tail is where it is read.
          const parsedWaitMs = parseRateLimitResetMs(stdoutTail);
          const waitMs       = parsedWaitMs != null ? parsedWaitMs + 60000 : 3600000; // +1 min buffer; default 1h
          rateLimitUntil     = Date.now() + waitMs;
          const waitMin      = Math.round(waitMs / 60000);
          const resetAt      = new Date(rateLimitUntil).toLocaleTimeString();

          try {
            // Requeue: write back as QUEUED (preserving all frontmatter).
            const ipContent = fs.readFileSync(inProgressPath, 'utf8');
            const updated   = updateFrontmatter(ipContent, { status: 'QUEUED' });
            fs.writeFileSync(path.join(QUEUE_DIR, `${id}-QUEUED.md`), updated, 'utf8');
            try { fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.ratelimit')); } catch (_) {}
            log('warn', 'rate_limit', {
              id,
              msg: `Claude API rate limit — requeueing slice; dispatch paused ${waitMin}min (until ~${resetAt})`,
              waitMs,
              durationMs,
            });
            registerEvent(id, 'RATE_LIMITED', {
              waitMs,
              resetAt,
              durationMs,
              title,
            });
            print(`  ${C.yellow}⏸${C.reset}  Rate limit hit — slice ${id} requeued. Dispatch paused ${waitMin} min (≈${resetAt})`);
            processing = false;
            heartbeatState.status = 'idle';
            heartbeatState.current_slice = null;
            heartbeatState.current_slice_title = null;
            heartbeatState.current_slice_goal = null;
            heartbeatState.pickupTime = null;
            try { fs.renameSync(NOG_ACTIVE_FILE, path.join(TRASH_DIR, 'nog-active.json.ratelimit')); } catch (_) {}
            return; // Skip ERROR file — slice will be retried after the pause
          } catch (rlErr) {
            log('error', 'rate_limit', { id, msg: 'Rate limit requeue failed — falling through to ERROR', error: rlErr.message });
            rateLimitUntil = null;
          }
        }

        // ── API error recovery ────────────────────────────────────────────────
        // If the crash was caused by a transient Anthropic API error (HTTP 5xx),
        // move the slice back to QUEUED for automatic retry instead of losing it.
        // A retry-count embedded in the frontmatter limits retries to MAX_API_RETRIES.
        const MAX_API_RETRIES = 3;
        const isApiError = reason === 'crash' &&
          (retained.flags.apiError || retained.flags.apiError5xx);

        if (isApiError) {
          // Parse current retry count from IN_PROGRESS frontmatter
          let retryCount = 0;
          try {
            const ipContent = fs.readFileSync(inProgressPath, 'utf8');
            const ipFm = parseFrontmatter(ipContent);
            retryCount = parseInt(ipFm._api_retry_count || '0', 10) || 0;
          } catch (_) {}

          if (retryCount < MAX_API_RETRIES) {
            // Bump retry count in frontmatter, rename back to QUEUED
            try {
              const ipContent = fs.readFileSync(inProgressPath, 'utf8');
              const updated  = updateFrontmatter(ipContent, {
                status: 'QUEUED',
                _api_retry_count: String(retryCount + 1),
              });
              fs.writeFileSync(path.join(QUEUE_DIR, `${id}-QUEUED.md`), updated, 'utf8');
              // inProgressPath will be cleaned up below (renamed → SLICE via normal flow
              // won't happen since we're returning early; move to trash explicitly)
              try { fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.api-retry')); } catch (_) {}
              log('warn', 'api_retry', {
                id,
                msg: `Anthropic API error — requeueing for retry (attempt ${retryCount + 1}/${MAX_API_RETRIES})`,
                durationMs,
              });
              // Write to register so the dashboard can surface a toast
              registerEvent(id, 'API_RETRY', {
                retryCount: retryCount + 1,
                maxRetries: MAX_API_RETRIES,
                durationMs,
                title,
              });
              processing = false;
              heartbeatState.status = 'idle';
              heartbeatState.current_slice = null;
              heartbeatState.current_slice_title = null;
              heartbeatState.current_slice_goal = null;
              heartbeatState.pickupTime = null;
              try { fs.renameSync(NOG_ACTIVE_FILE, path.join(TRASH_DIR, 'nog-active.json.api-retry')); } catch (_) {}
              return; // Skip ERROR file — slice will be retried
            } catch (retryErr) {
              log('error', 'api_retry', { id, msg: 'Retry requeue failed, falling through to ERROR', error: retryErr.message });
            }
          } else {
            log('warn', 'api_retry', { id, msg: `API error retry limit (${MAX_API_RETRIES}) reached — writing ERROR`, durationMs });
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        // ── Manual abort guard ─────���────────────────────────────────────────
        // When handleAbort() SIGKILLs the child, the promise rejects and lands
        // here. But handleAbort already emitted ROM_ABORTED and cleaned up.
        // Suppress the ghost ERROR so it doesn't pollute metrics or create a
        // false-positive ERROR.md file.
        const latestForAbortGuard = getLatestLifecycleEvent(id);
        if (latestForAbortGuard && latestForAbortGuard.event === 'ROM_ABORTED' && latestForAbortGuard.reason === 'manual') {
          log('info', 'control', { id, msg: 'Suppressing ghost ERROR — slice was manually aborted', reason });
          closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'Manually aborted');
          recordSessionResult(false, tokensIn, tokensOut, costUsd);
        } else {
        // ──────���──────────────────────────────────────────────────────────────
        writeErrorFile(errorPath, id, reason, err, stdoutTail, stderrTail, extra);
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
        registerEvent(id, 'ERROR', {
          reason,
          phase: 'rom_invocation',
          command: [config.claudeCommand, ...config.claudeArgs].join(' '),
          exit_code: err.code != null ? err.code : null,
          stderr_tail: truncStderr(stderrTail),
          durationMs,
        });
        appendOperationalEvent({
          event: 'ERROR',
          slice_id: id,
          root_id: sliceMeta.root_commission_id || null,
          cycle: null,
          branch: sliceBranch || null,
          details: `Slice ${id} errored: ${reason}`,
        });
        // timesheet write point 2 — update orchestrator row at terminal state
        updateTimesheet(id, { result: 'ERROR', cycle: null, ts_result: new Date().toISOString() });
        closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, reasonDisplay);
        recordSessionResult(false, tokensIn, tokensOut, costUsd);
        }
      }

      printSessionSummary();

      // Park the original slice so Nog's evaluation task can find the
      // success criteria.  Rename IN_PROGRESS → PARKED (intermediate hold).
      // The PARKED suffix is inert — the poll loop only looks for QUEUED/PENDING files.
      const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
      if (fs.existsSync(inProgressPath)) {
        try {
          fs.renameSync(inProgressPath, parkedPath);
          log('info', 'state', { id, msg: 'Parked slice', from: 'IN_PROGRESS', to: 'PARKED' });

          // Capture Rom's session_id for potential resume on rework rounds.
          // Same answer the whole text gave: the id on the result event, or on the
          // last JSON object when there was none, and failing both the first line
          // of the session that carried one (the init event).
          const sessionId = extractSessionId(telemetryLine)
            || extractSessionId(retained.sessionIdLine || '');
          if (sessionId) {
            try {
              const parkedContent = fs.readFileSync(parkedPath, 'utf-8');
              const updatedParked = updateFrontmatter(parkedContent, { rom_session_id: sessionId });
              fs.writeFileSync(parkedPath, updatedParked);
              log('info', 'session', { id, msg: 'Persisted rom_session_id to PARKED', session_id: sessionId });
            } catch (sessionErr) {
              log('warn', 'session', { id, msg: 'Failed to persist rom_session_id', error: sessionErr.message });
            }
          } else {
            log('info', 'session', { id, msg: 'No session_id in claude output — rework will use fresh session' });
          }
        } catch (archiveErr) {
          // Fallback: if rename fails, try to delete so the queue doesn't jam.
          log('warn', 'error', { id, msg: 'Failed to park IN_PROGRESS file, trashing instead', error: archiveErr.message });
          try { fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.park-fail')); } catch (_) {}
        }
      }

      // Remove from active children map.
      activeChildren.delete(String(id));

      // Reset processing state.
      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_slice = null;
      heartbeatState.current_slice_title = null;
      heartbeatState.current_slice_goal = null;
      heartbeatState.pickupTime = null;
      heartbeatState.processed_total += 1;
      sessionHasProcessed = true;
      writeHeartbeat();
    }
  );

  // Track child process for pause/resume/abort.
  activeChildren.set(String(id), { child, worktreePath });

  // Inactivity check: every 30s, kill the child if no output for effectiveInactivityMs.
  const inactivityCheck = setInterval(() => {
    const silentMs = Date.now() - lastActivityTs;
    if (silentMs > effectiveInactivityMs) {
      const lastActivitySecondsAgo = Math.floor(silentMs / 1000);
      const inactivityLimitMinutes = Math.round(effectiveInactivityMs / 60000);
      log('warn', 'inactivity_timeout', {
        id,
        msg: `No output for ${lastActivitySecondsAgo}s — killing child process`,
        lastActivitySecondsAgo,
        inactivityLimitMinutes,
      });
      killedByInactivity = true;
      child.kill('SIGTERM');
    }
  }, 30000);
}

/**
 * latestRestagedTs(id, regFile)
 *
 * Returns the latest ts string of any RESTAGED event for this slice ID,
 * or null if none exists. Used to scope per-attempt register reads.
 * Accepts an optional regFile path for testing.
 */
function latestRestagedTs(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const lines = _getRegLines(file);
    let latest = null;
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const sid = String(raw.slice_id || raw.id || '');
        if (sid === String(id) && raw.event === 'RESTAGED') {
          if (!latest || raw.ts > latest) latest = raw.ts;
        }
      } catch (_) {}
    }
    return latest;
  } catch (_) { return null; }
}

/**
 * latestAttemptStartTs(id, regFile)
 *
 * Returns the ISO timestamp of the most recent event marking the start of the
 * current attempt. Resolution order: latest RESTAGED → latest COMMISSIONED → null.
 * Accepts an optional regFile path for testing.
 */
function latestAttemptStartTs(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const lines = _getRegLines(file);
    let latestRestaged = null;
    let latestCommissioned = null;
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const sid = String(raw.slice_id || raw.id || '');
        if (sid !== String(id)) continue;
        if (raw.event === 'RESTAGED') {
          if (!latestRestaged || raw.ts > latestRestaged) latestRestaged = raw.ts;
        } else if (raw.event === 'COMMISSIONED') {
          if (!latestCommissioned || raw.ts > latestCommissioned) latestCommissioned = raw.ts;
        }
      } catch (_) {}
    }
    return latestRestaged || latestCommissioned || null;
  } catch (_) { return null; }
}

/**
 * hasReviewEvent(id, regFile)
 *
 * Returns true if the current attempt has reached a terminal review state:
 * MERGED, STUCK, or NOG_DECISION with verdict ACCEPTED. REJECTED and ESCALATE
 * verdicts are intermediate — they do not block re-dispatch. The attempt
 * boundary is latestAttemptStartTs (RESTAGED → COMMISSIONED → null).
 * Accepts an optional regFile path for testing.
 */
function hasReviewEvent(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const cutoff = latestAttemptStartTs(id, file);
    if (cutoff === null) return false;
    const lines = _getRegLines(file);
    resetDedupeState();
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const entry = translateEvent(raw);
        if (!entry || entry.id !== String(id)) continue;
        if (entry.ts <= cutoff) continue;
        if (entry.event === 'MERGED') return true;
        if (entry.event === 'STUCK') return true;
        if (entry.event === 'NOG_DECISION' && entry.verdict === 'ACCEPTED') return true;
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

/**
 * hasMergedEvent(id, regFile)
 *
 * Returns true if register.jsonl contains a MERGED event for this brief ID after
 * the latest RESTAGED marker — meaning the current attempt's branch was merged.
 * Accepts an optional regFile path for testing.
 */
function hasMergedEvent(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const cutoff = latestRestagedTs(id, file);
    const lines = _getRegLines(file);
    resetDedupeState();
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const entry = translateEvent(raw);
        if (entry && entry.id === String(id) && (entry.event === 'MERGED' || entry.event === 'SLICE_MERGED_TO_MAIN')) {
          if (!cutoff || entry.ts > cutoff) return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

/**
 * hasArchivedEvent(id, regFile)
 *
 * Has this slice's archival already been RECORDED — not merely half-performed?
 *
 * Slice 395 moved the ACCEPTED→ARCHIVED rename into the landing commit, so the
 * presence of {id}-ARCHIVED.md on disk no longer proves archival finished: the
 * landing leaves the file renamed and the worktree, the branch and the register
 * event still to do. The event is what proves it. Same restage cutoff as
 * hasMergedEvent, so a slice sent round again archives again.
 */
function hasArchivedEvent(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const cutoff = latestRestagedTs(id, file);
    for (const line of _getRegLines(file)) {
      try {
        const e = JSON.parse(line);
        if (!e || e.event !== 'ARCHIVED' || String(e.slice_id) !== String(id)) continue;
        if (!cutoff || String(e.ts || '') > cutoff) return true;
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

// Gate-flow sibling of hasMergedEvent: has this slice already been squashed onto dev?
// In the dev→main gate model SLICE_SQUASHED_TO_DEV — not MERGED — is the "landed"
// signal, so crash recovery uses this to avoid re-squashing a slice already on dev.
function hasSquashedToDevEvent(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const cutoff = latestRestagedTs(id, file);
    const lines = _getRegLines(file);
    resetDedupeState();
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const entry = translateEvent(raw);
        const ev = (entry && entry.event) || raw.event;
        const rid = (entry && entry.id) || String(raw.slice_id || raw.id || '');
        if (rid === String(id) && ev === 'SLICE_SQUASHED_TO_DEV') {
          const ts = (entry && entry.ts) || raw.ts;
          if (!cutoff || (ts && ts > cutoff)) return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

/**
 * countUnreadableVerdicts(id, round, regFile)
 *
 * How many times has Nog returned an unreadable verdict for this slice in THIS
 * round? Counted per-round because the retry is per-round: a fresh round means a
 * fresh budget. The RESTAGED cutoff applies for the same reason it does
 * everywhere else — a restaged slice starts over.
 */
function countUnreadableVerdicts(id, round, regFile) {
  const file = regFile || REGISTER_FILE;
  let count = 0;
  try {
    const cutoff = latestRestagedTs(id, file);
    for (const line of _getRegLines(file)) {
      try {
        const raw = JSON.parse(line);
        if (String(raw.slice_id || raw.id || '') !== String(id)) continue;
        if (raw.event !== 'NOG_DECISION' || raw.reason !== 'verdict_unreadable') continue;
        if (String(raw.round) !== String(round)) continue;
        if (cutoff && raw.ts && raw.ts <= cutoff) continue;
        count += 1;
      } catch (_) {}
    }
  } catch (_) {}
  return count;
}

/**
 * unreadableBackoffMs(attempts)
 *
 * Delay before the next retry, given how many attempts have already been made.
 * Saturates at the last step so the schedule can never run off the end.
 */
function unreadableBackoffMs(attempts) {
  const i = Math.max(0, attempts - 1);
  return UNREADABLE_BACKOFF_MS[Math.min(i, UNREADABLE_BACKOFF_MS.length - 1)];
}

// Log a backoff hold once per (slice, deadline) instead of on every 5s poll.
const _backoffNoticed = new Set();

/**
 * retryBackoffElapsed(candPath, candId)
 *
 * A slice re-queued after an unreadable verdict carries a `not_before` stamp.
 * Returns false while that deadline is in the future, so the retry waits rather
 * than spinning. Anything unstamped or unparseable dispatches normally.
 */
function retryBackoffElapsed(candPath, candId) {
  let notBefore;
  try {
    const meta = parseFrontmatter(fs.readFileSync(candPath, 'utf-8'));
    notBefore = meta && meta.not_before;
  } catch (_) { return true; }
  if (!notBefore || notBefore === 'null') return true;

  const dueAt = Date.parse(String(notBefore).replace(/^["']|["']$/g, ''));
  if (isNaN(dueAt) || Date.now() >= dueAt) return true;

  const key = `${candId}:${notBefore}`;
  if (!_backoffNoticed.has(key)) {
    _backoffNoticed.add(key);
    const waitS = Math.ceil((dueAt - Date.now()) / 1000);
    log('info', 'dispatch', { id: candId, msg: `Retry backoff — holding slice ${candId} for ${waitS}s`, not_before: notBefore });
    print(`  ${C.dim}\u23F8${C.reset}  Slice ${candId}${SYM.dash}retry backoff, holding ${waitS}s`);
  }
  return false;
}

// The events that mean "this slice has landed and is finished": squashed onto the
// integration branch, merged to trunk, or archived after acceptance. Anything else
// — a Nog rejection, a return-to-stage, an ERROR — is a re-entry, not an ending.
const TERMINAL_LANDED_EVENTS = ['MERGED', 'SLICE_MERGED_TO_MAIN', 'SLICE_SQUASHED_TO_DEV', 'ARCHIVED'];

/**
 * hasTerminalLandedEvent(id, regFile)
 *
 * Has this slice already finished for good? Returns the event name that says so,
 * or null.
 *
 * Deliberately NOT keyed on "have I seen this id before" — the pipeline reuses ids
 * on purpose. A Nog rejection re-queues the same id for another round and a
 * restaged slice reuses its id outright; neither has a landed event, so both still
 * dispatch. Like hasMergedEvent, the RESTAGED marker is a cutoff: restaging a
 * previously-merged slice starts a genuinely new life for that id.
 */
function hasTerminalLandedEvent(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const cutoff = latestRestagedTs(id, file);
    for (const line of _getRegLines(file)) {
      try {
        const raw = JSON.parse(line);
        if (String(raw.slice_id || raw.id || '') !== String(id)) continue;
        if (!TERMINAL_LANDED_EVENTS.includes(raw.event)) continue;
        if (!cutoff || (raw.ts && raw.ts > cutoff)) return raw.event;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * STAGING_TRASH_SUFFIXES / trashEntryRecordsStaging(name)  (slice 393)
 *
 * Signal 4 of isTerminal() reads bridge/trash/ and treats ANY `{id}-` entry as proof the
 * slice finished. Most suffixes in there do mean that. Two do not: the dashboard moves the
 * staged brief aside the moment Philipp presses approve (`{id}-STAGED.md.approved`,
 * server.js) or refine (`.amended`), so those entries appear when a slice STARTS and sit in
 * trash for the whole of its life. An orphaned IN_PROGRESS file after a crash was therefore
 * read as terminal and never re-queued — "startup-recovery: skipped terminal slice 390",
 * 2026-09-13 19:26:02Z, one lost round.
 *
 * `.blocked` joins them: this slice routes an honest BLOCKED report back to STAGED, which
 * is the same "waiting to start again" state as `.approved`.
 *
 * The exclusion stays deliberately narrow. Every other suffix the live trash holds —
 * `.cleanup-ARCHIVED-`, `.cleanup-ERROR-`, `.attemptN`, `.orphan`, `.pass`, `.ratelimit`,
 * `.api-retry` — records something that happened to a slice that had already run, and a
 * wrong answer there re-dispatches finished work. Recovery stays conservative: when in
 * doubt, terminal.
 *
 * `.branch-checkout` is stripped first. fuseSafeCheckoutBranch parks any file the target
 * branch does not have, so it lands on top of whatever suffix was already there and carries
 * no lifecycle meaning of its own; the live trash holds 13 `{id}-STAGED.md.approved.branch-checkout`
 * entries that would otherwise slip straight back through this guard.
 */
const STAGING_TRASH_SUFFIXES = ['.approved', '.amended', '.blocked'];

function trashEntryRecordsStaging(name) {
  let n = String(name);
  while (n.endsWith('.branch-checkout')) n = n.slice(0, -'.branch-checkout'.length);
  return STAGING_TRASH_SUFFIXES.some(suffix => n.endsWith(suffix));
}

/**
 * isTerminal(sliceId, opts)
 *
 * Returns true if a slice is definitively terminal — i.e. it has completed its
 * full lifecycle and should NOT be re-processed on startup recovery.
 *
 * A slice is terminal if ANY of:
 *   1. An {id}-ACCEPTED.md file exists in the queue directory.
 *   2. An {id}-ARCHIVED.md file exists in the queue directory.
 *   3. The register has a MERGED or SLICE_MERGED_TO_MAIN event for that slice
 *      (after the latest RESTAGED marker, per hasMergedEvent semantics).
 *   4. A bridge/trash/{id}-*.md archive entry exists whose suffix records a
 *      COMPLETION. Staging entries (.approved, .amended, .blocked) are ignored —
 *      they say the slice started, not that it finished (slice 393).
 *
 * Accepts optional { queueDir, trashDir, regFile } for testing.
 */
function isTerminal(sliceId, opts) {
  const qDir = (opts && opts.queueDir) || QUEUE_DIR;
  const tDir = (opts && opts.trashDir) || TRASH_DIR;
  const rFile = (opts && opts.regFile) || undefined;

  const id = String(sliceId);

  // Signal 1: ACCEPTED file
  if (fs.existsSync(path.join(qDir, `${id}-ACCEPTED.md`))) return true;

  // Signal 2: ARCHIVED file
  if (fs.existsSync(path.join(qDir, `${id}-ARCHIVED.md`))) return true;

  // Signal 3: MERGED or SLICE_MERGED_TO_MAIN register event
  if (hasMergedEvent(id, rFile)) return true;

  // Signal 4: trash entry that records a completion, not a staging move
  try {
    const trashFiles = fs.readdirSync(tDir);
    if (trashFiles.some(f => f.startsWith(`${id}-`) && !trashEntryRecordsStaging(f))) return true;
  } catch (_) {}

  return false;
}

/**
 * depsAreMet(sliceMeta)
 *
 * Returns true if every ID in the depends_on frontmatter field has a MERGED or
 * SLICE_MERGED_TO_MAIN event in the register. Returns true when depends_on is absent/empty/null.
 */
function depsAreMet(sliceMeta) {
  const raw = sliceMeta && sliceMeta.depends_on;
  if (!raw || raw === 'null' || raw === '') return true;
  const ids = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  for (const depId of ids) {
    if (!hasMergedEvent(depId)) return false;
  }
  return true;
}

/**
 * mergeBranch(id, branchName, title)
 *
 * Worktree-based FUSE-safe merge:
 *   1. In the worktree: merge main into slice branch (runs on local FS, not FUSE)
 *   2. In PROJECT_DIR: update-ref to fast-forward main to the merge result
 *   3. Sync changed files from worktree to PROJECT_DIR via fs.copyFileSync
 *   4. Update index with git read-tree
 *   5. Post-merge verification + push
 *
 * Returns { success, sha, error } where sha is the merge commit hash on success.
 */

/**
 * assertMergeIntegrity(id, expectedSha)
 *
 * Post-merge local integrity guard (W2). Asserts that expectedSha is both
 * an ancestor of main and the current tip of main.
 *
 * Returns { ok: true } on success.
 * Returns { ok: false, actualSha, reason } on failure where reason is one of:
 *   'not_ancestor' | 'tip_mismatch' | 'check_failed'
 */
function assertMergeIntegrity(id, expectedSha) {
  try {
    // Check 1: expectedSha must be reachable from main
    try {
      gitFinalizer.runGit(`git merge-base --is-ancestor ${expectedSha} main`, { slice_id: id, op: 'mergeIntegrity_ancestry', execOpts: { stdio: 'pipe' } });
    } catch (_) {
      const actualSha = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'mergeIntegrity_tipAfterAncestryFail', encoding: 'utf-8' }).trim();
      return { ok: false, actualSha, reason: 'not_ancestor' };
    }

    // Check 2: main tip must equal expectedSha
    const actualSha = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'mergeIntegrity_tip', encoding: 'utf-8' }).trim();
    if (actualSha !== expectedSha) {
      return { ok: false, actualSha, reason: 'tip_mismatch' };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, actualSha: null, reason: 'check_failed' };
  }
}

// ---------------------------------------------------------------------------
// verifyOriginAdvanced — read-back origin/main SHA after push (W1 guard)
// ---------------------------------------------------------------------------

function verifyOriginAdvanced(id, expectedSha) {
  try {
    const raw = gitFinalizer.runGit('git ls-remote origin main', { slice_id: id, op: 'verifyOrigin_lsRemote', encoding: 'utf-8' }).trim();
    // ls-remote output: "<sha>\trefs/heads/main"
    const originSha = raw.split(/\s+/)[0] || '';
    if (originSha === expectedSha) {
      return { ok: true, originSha, reason: null };
    }
    return { ok: false, originSha, reason: 'push_succeeded_but_remote_did_not_advance' };
  } catch (err) {
    return { ok: false, originSha: null, reason: 'ls_remote_failed: ' + err.message };
  }
}

function mergeBranch(id, branchName, title) {
  // ── Branch name sanitization (defence against shell injection) ────────
  try {
    branchName = sanitizeBranchName(branchName);
  } catch (err) {
    log('error', 'merge', { id, msg: 'Branch name rejected by sanitizer', error: err.message });
    return { success: false, sha: null, error: `invalid_branch_name: ${err.message}` };
  }

  const commitMsg = `merge: ${branchName} — ${title || `slice ${id}`} (slice ${id})`;

  // Ensure worktree exists for the merge
  let wtPath = getWorktreePath(id);
  if (!fs.existsSync(wtPath)) {
    try {
      wtPath = createWorktree(id, branchName);
    } catch (wtErr) {
      log('error', 'merge', { id, msg: 'Could not create worktree for merge', error: wtErr.message });
      return { success: false, sha: null, error: `worktree_creation_failed: ${wtErr.message}` };
    }
  }

  // ── Layer 2 enforcement: unlock source paths before merge, re-lock after ──
  const unlockScript = path.join(PROJECT_DIR, 'scripts', 'unlock-main.sh');
  const lockScript   = path.join(PROJECT_DIR, 'scripts', 'lock-main.sh');
  const mergeUnlockStart = Date.now();
  try { execSync(`bash "${unlockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
  emitGateTelemetry('lock-cycle', { cycle_phase: 'unlock', triggering_op: 'squash-to-dev', held_duration_ms: Date.now() - mergeUnlockStart });

  // Set DS9_WATCHER_MERGE so the pre-commit hook (Layer 1) allows this path.
  process.env.DS9_WATCHER_MERGE = '1';

  try {
    // ── Step 1: Merge main into slice branch in the worktree ───────────
    // This runs on local FS (/tmp), not FUSE. Resolves any main changes
    // since the branch was created.
    const oldMain = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'mergeBranch_oldMain', encoding: 'utf-8' }).trim();
    gitFinalizer.runGit(`git merge --no-ff main -m "${commitMsg.replace(/"/g, '\\"')}"`, { slice_id: id, op: 'mergeBranch_merge', cwd: wtPath, execOpts: { stdio: 'pipe' } });

    // ── Step 2: Fast-forward main to the merge result ──────────────────
    const newSha = gitFinalizer.runGit(`git rev-parse ${branchName}`, { slice_id: id, op: 'mergeBranch_newSha', encoding: 'utf-8' }).trim();
    gitFinalizer.runGit(`git update-ref refs/heads/main ${newSha}`, { slice_id: id, op: 'mergeBranch_updateRef', execOpts: { stdio: 'pipe' } });

    // ── Step 2.5: Post-merge integrity assertion (W2) ─────────────────
    const integrity = assertMergeIntegrity(id, newSha);
    if (!integrity.ok) {
      registerEvent(id, 'MERGE_INTEGRITY_VIOLATION', {
        slice_id: String(id),
        expected_sha: newSha,
        actual_sha: integrity.actualSha,
        reason: integrity.reason,
      });
      log('warn', 'merge', { id, msg: 'Post-merge integrity assertion failed', expected_sha: newSha, actual_sha: integrity.actualSha, reason: integrity.reason });
      return { success: false, sha: null, error: 'merge_integrity_violation' };
    }

    // ── Step 3: Sync changed files from worktree to PROJECT_DIR ────────
    // FUSE handles writes fine (writeFileSync truncates in-place).
    const diffRaw = gitFinalizer.runGit(`git diff --name-only ${oldMain} main`, { slice_id: id, op: 'mergeBranch_diffFiles', encoding: 'utf-8' }).trim();
    if (diffRaw) {
      for (const file of diffRaw.split('\n').filter(Boolean)) {
        const srcPath = path.join(wtPath, file);
        const dstPath = path.join(PROJECT_DIR, file);
        try {
          if (fs.existsSync(srcPath)) {
            fs.mkdirSync(path.dirname(dstPath), { recursive: true });
            fs.copyFileSync(srcPath, dstPath);
          } else {
            // File deleted on branch — move to trash (FUSE-safe)
            if (fs.existsSync(dstPath)) {
              fs.renameSync(dstPath, path.join(TRASH_DIR, path.basename(file) + '.merge-cleanup'));
            }
          }
        } catch (syncErr) {
          log('warn', 'merge', { id, msg: `File sync failed for ${file}`, error: syncErr.message });
        }
      }
    }

    // ── Step 4: Update index to match new main ─────────────────────────
    gitFinalizer.runGit('git read-tree main', { slice_id: id, op: 'mergeBranch_readTree', execOpts: { stdio: 'pipe' } });

    // ── Post-merge verification ─────────────────────────────────────────
    // Safety net: ensure disk matches committed state.
    verifyWorkingTreeMatchesMain(id, 'merge');

    try {
      gitFinalizer.runGit('git push origin main', { slice_id: id, op: 'mergeBranch_push', execOpts: { stdio: 'pipe' } });
    } catch (pushErr) {
      // Push failure is non-fatal — the merge succeeded locally.
      log('warn', 'merge', { id, msg: 'git push origin main failed (merge succeeded locally)', error: pushErr.message });
      return { success: true, sha: newSha, error: null };
    }

    // ── Step 5.5: W1 — Verify origin actually advanced (ls-remote read-back) ──
    const originCheck = verifyOriginAdvanced(id, newSha);
    if (!originCheck.ok) {
      const payload = {
        slice_id: String(id),
        local_sha: newSha,
        origin_sha: originCheck.originSha,
        reason: originCheck.reason,
      };
      registerEvent(id, 'MERGE_NOT_PUSHED', payload);
      log('error', 'merge', { id, msg: 'Push appeared to succeed but origin did not advance', ...payload });
      try {
        fs.writeFileSync(PIPELINE_PAUSED_FILE, JSON.stringify(Object.assign({ ts: new Date().toISOString(), event: 'MERGE_NOT_PUSHED' }, payload), null, 2) + '\n');
      } catch (flagErr) {
        log('warn', 'merge', { id, msg: 'Failed to write .pipeline-paused flag', error: flagErr.message });
      }
      return { success: false, sha: null, error: 'merge_not_pushed' };
    }

    return { success: true, sha: newSha, error: null };
  } catch (err) {
    // Abort any in-progress merge in the worktree to leave git in a clean state.
    try { gitFinalizer.runGit('git merge --abort', { slice_id: id, op: 'mergeBranch_abort', cwd: wtPath, execOpts: { stdio: 'pipe' } }); } catch (_) {}
    return { success: false, sha: null, error: err.stderr ? err.stderr.toString().trim() : err.message };
  } finally {
    // Always re-lock and clear the env var, even on failure.
    delete process.env.DS9_WATCHER_MERGE;
    const mergeRelockStart = Date.now();
    try { execSync(`bash "${lockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    emitGateTelemetry('lock-cycle', { cycle_phase: 'relock', triggering_op: 'squash-to-dev', held_duration_ms: Date.now() - mergeRelockStart });
  }
}

// ---------------------------------------------------------------------------
// acceptAndMerge — sole entry point for ACCEPTED rename + merge
// ---------------------------------------------------------------------------

/**
 * acceptAndMerge(id, currentFilePath, branchName, title, opts)
 *
 * opts.lane — the brief's declared lane, passed straight to squashSliceToDev so
 * the landing commit carries a `Lane:` trailer. Absent → core (slice 389).
 *
 * Ensures {id}-ACCEPTED.md exists in the queue directory, then either squashes
 * the slice onto dev (via squashSliceToDev) or defers if the gate is running.
 * This is the SOLE entry point for all post-ACCEPTED paths — no caller should
 * invoke squashSliceToDev or mergeBranch directly.
 *
 * Rename logic:
 *   - If ACCEPTED already exists → no-op (idempotent).
 *   - If currentFilePath is provided and differs from acceptedPath → rename it.
 *   - If rename fails → emit RENAME_FAILED, halt (do NOT proceed to squash).
 *
 * Returns { success, sha, error, deferred }.
 */
function acceptAndMerge(id, currentFilePath, branchName, title, opts) {
  const queueDir = (opts && opts.queueDir) || QUEUE_DIR;
  const acceptedPath = path.join(queueDir, `${id}-ACCEPTED.md`);

  // Idempotent: if ACCEPTED already exists, skip rename (AC4).
  if (!fs.existsSync(acceptedPath)) {
    if (!currentFilePath || !fs.existsSync(currentFilePath)) {
      // No source file to rename — emit RENAME_FAILED and halt (AC3).
      const detail = {
        slice_id: String(id),
        expected_path: acceptedPath,
        actual_path_if_known: currentFilePath || null,
        error: currentFilePath ? 'source file does not exist' : 'no source file path provided',
      };
      registerEvent(id, 'RENAME_FAILED', detail);
      log('error', 'state', { id, msg: 'RENAME_FAILED — cannot create ACCEPTED file', detail });
      return { success: false, sha: null, error: 'rename_failed_no_source' };
    }

    try {
      fs.renameSync(currentFilePath, acceptedPath);
      log('info', 'state', { id, from: path.basename(currentFilePath).replace(/^\d+-/, '').replace('.md', ''), to: 'ACCEPTED' });
    } catch (err) {
      const detail = {
        slice_id: String(id),
        expected_path: acceptedPath,
        actual_path_if_known: currentFilePath,
        error: err.message,
      };
      registerEvent(id, 'RENAME_FAILED', detail);
      log('error', 'state', { id, msg: 'RENAME_FAILED — rename threw', detail });
      return { success: false, sha: null, error: `rename_failed: ${err.message}` };
    }
  }

  // Feature flag: gate flow (squash to dev) vs legacy (direct to main)
  const USE_GATE_FLOW = process.env.DS9_USE_GATE_FLOW === '1';

  if (USE_GATE_FLOW) {
    // Gate check: defer or squash
    if (shouldDeferSquash()) {
      // Gate is running — defer squash to post-gate drain
      let branchState;
      try {
        branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
      } catch (err) {
        log('error', 'merge', { id, msg: 'Cannot read branch-state.json for defer', error: err.message });
        return { success: false, sha: null, error: 'branch_state_unreadable' };
      }
      if (!branchState.dev) branchState.dev = { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] };
      if (!Array.isArray(branchState.dev.deferred_slices)) branchState.dev.deferred_slices = [];
      branchState.dev.deferred_slices.push({ slice_id: String(id), accepted_ts: new Date().toISOString() });
      writeJsonAtomic(BRANCH_STATE_PATH, branchState);
      registerEvent(id, 'SLICE_DEFERRED', { slice_id: String(id), reason: 'gate-running' });
      log('info', 'merge', { id, msg: 'Slice deferred — gate is running' });
      return { success: true, sha: null, deferred: true };
    }

    // No gate — squash to dev
    const result = squashSliceToDev(String(id), title, branchName, (opts && opts.lane) || 'core');
    if (result.success) {
      return { success: true, sha: result.dev_sha, error: null };
    } else {
      return { success: false, sha: null, error: result.error };
    }
  } else {
    // Legacy direct-to-main merge path
    const result = mergeBranch(id, branchName, title);
    return { success: result.success, sha: result.sha, error: result.error };
  }
}

// ---------------------------------------------------------------------------
// Post-merge archival — ACCEPTED → ARCHIVED + sibling cleanup
// ---------------------------------------------------------------------------

/**
 * archiveSiblingStateFiles(id, terminalState, opts)
 *
 * After a terminal write (ERROR, ARCHIVED), moves sibling state files to
 * bridge/trash/ with suffix `.cleanup-{terminalState}-{ISO_date}`.
 * Returns the count of files moved.
 */
function archiveSiblingStateFiles(id, terminalState, opts) {
  const queueDir = (opts && opts.queueDir) || QUEUE_DIR;
  const trashDir = (opts && opts.trashDir) || TRASH_DIR;
  const suffixes = ['-DONE.md', '-IN_PROGRESS.md', '-PARKED.md', '-EVALUATING.md', '-IN_REVIEW.md', '-ACCEPTED.md', '-IN_QA.md'];
  const terminalSuffix = `-${terminalState}.md`;
  const isoDate = new Date().toISOString().replace(/[:.]/g, '-');
  const moved = [];

  for (const suffix of suffixes) {
    if (suffix === terminalSuffix) continue;
    const filePath = path.join(queueDir, `${id}${suffix}`);
    if (fs.existsSync(filePath)) {
      const trashName = `${id}${suffix}.cleanup-${terminalState}-${isoDate}`;
      try {
        fs.renameSync(filePath, path.join(trashDir, trashName));
        moved.push(`${id}${suffix}`);
      } catch (err) {
        log('warn', 'archive', { id, msg: `Failed to move sibling ${suffix} to trash`, error: err.message });
      }
    }
  }

  if (moved.length > 0) {
    registerEvent(id, 'STATE_FILES_ARCHIVED', { slice_id: String(id), terminal_state: terminalState, moved });
  }
  return moved.length;
}

/**
 * stageQueueArchiveForLanding(id, opts) → { staged, renamed, reportRel, reason }
 *
 * Put this slice's archive rename INTO the landing commit, rather than into a
 * commit of its own after it (slice 395).
 *
 * Archival renames the report forward to {id}-ARCHIVED.md by a filesystem move.
 * bridge/queue/*.md is gitignored and the reports are force-added, so git sees a
 * tracked file vanish and an ignored one appear, and something has to say so. Since
 * slice 381 that something was recordArchivedQueueRename() — correct, but a SECOND
 * commit, `chore(queue): record slice N archive rename (...)`, wedged between every
 * pair of real ones. Eleven commits on dev, three of them named.
 *
 * The landing already amends once (slice 387: regenerated locks, re-filled report).
 * This rides that amend. It runs BEFORE the lock regeneration on purpose: the AC
 * manifest is derived from the git INDEX and cites a criterion's slice file by path
 * when no trailer declares it, so a rename staged after the regeneration would leave
 * the committed lock naming a path its own commit no longer holds — and the
 * integrity gate re-derives that lock on CI.
 *
 * Nothing is committed here and nothing is swept to trash: the index is staged, the
 * ACCEPTED file becomes the ARCHIVED file, and the on-disk siblings are left for
 * archiveAcceptedSlice(), which by then is moving untracked files that git ignores.
 * Fully reversible — revertQueueArchiveStaging() puts both halves back if the amend
 * fails, because a half-staged index is what the autocommit used to sweep.
 *
 * `opts.runGit` is a seam for the tests (same shape as gitFinalizer.runGit).
 */
function stageQueueArchiveForLanding(id, opts) {
  opts = opts || {};
  const repoRoot = opts.repoRoot || PROJECT_DIR;
  const queueDir = opts.queueDir || QUEUE_DIR;
  const git = opts.runGit || gitFinalizer.runGit;

  const nothing = (reason) => ({ staged: [], renamed: null, reportRel: null, reason });

  // A fixture queue dir (the squash fixtures, the e2e seed root) is not a repository.
  if (!fs.existsSync(path.join(repoRoot, '.git'))) return nothing('not_a_repo');
  const queueRel = path.relative(repoRoot, queueDir).split(path.sep).join('/');
  if (!queueRel || queueRel.startsWith('..') || path.isAbsolute(queueRel)) {
    return nothing('queue_outside_repo');
  }

  const archivedRel = `${queueRel}/${id}-ARCHIVED.md`;
  const archivedAbs = path.join(repoRoot, archivedRel);

  // Idempotent: a recovery run re-squashing a slice finds the rename already done.
  let renamed = null;
  if (!fs.existsSync(archivedAbs)) {
    const acceptedRel = `${queueRel}/${id}-ACCEPTED.md`;
    const acceptedAbs = path.join(repoRoot, acceptedRel);
    // Only the ACCEPTED journey file becomes ARCHIVED. No ACCEPTED file means this
    // landing is not an archival (a deferred slice squashed before Nog's verdict
    // reached the queue), and inventing one would archive a live slice.
    if (!fs.existsSync(acceptedAbs)) return nothing('no_accepted_file');
    try {
      fs.renameSync(acceptedAbs, archivedAbs);
      renamed = { from: acceptedRel, to: archivedRel };
    } catch (err) {
      log('warn', 'archive', { id, msg: 'Could not rename ACCEPTED to ARCHIVED inside the landing', error: err.message });
      return nothing('rename_failed');
    }
  }

  // What git still believes about this slice's queue files, whatever suffix it last
  // saw them under — the builder's force-added {id}-DONE.md, and any older attempt.
  let tracked;
  try {
    const raw = git(`git ls-files -- ${shQuote(queueRel)}`, {
      slice_id: String(id), op: 'landingArchive_lsFiles', cwd: repoRoot, encoding: 'utf-8',
    });
    tracked = String(raw || '').split('\n').map(l => l.trim()).filter(Boolean)
      .filter(rel => path.basename(rel).startsWith(`${id}-`) && CANONICAL_SUFFIX_RE.test(rel));
  } catch (err) {
    log('warn', 'archive', { id, msg: 'Could not list tracked queue files for the landing', error: err.message });
    return { staged: [], renamed, reportRel: fs.existsSync(archivedAbs) ? archivedRel : null, reason: 'ls_files_failed' };
  }

  const leaving = tracked.filter(rel => rel !== archivedRel);
  const arriving = tracked.includes(archivedRel) ? [] : [archivedRel];
  const staged = leaving.concat(arriving);
  if (!staged.length) return { staged: [], renamed, reportRel: archivedRel, reason: 'nothing_to_record' };

  try {
    // --cached: the old name leaves the INDEX only. Its blob is already in history
    // and the file itself is still on disk for archiveSiblingStateFiles to sweep.
    if (leaving.length) {
      git(`git rm -q --cached --ignore-unmatch -- ${leaving.map(shQuote).join(' ')}`, {
        slice_id: String(id), op: 'landingArchive_rm', cwd: repoRoot, execOpts: { stdio: 'pipe' },
      });
    }
    // -f because the queue is ignored and the new name would be invisible without it.
    if (arriving.length) {
      git(`git add -f -- ${arriving.map(shQuote).join(' ')}`, {
        slice_id: String(id), op: 'landingArchive_add', cwd: repoRoot, execOpts: { stdio: 'pipe' },
      });
    }
  } catch (err) {
    log('warn', 'archive', { id, msg: 'Could not stage the archive rename into the landing', error: err.message, paths: staged });
    revertQueueArchiveStaging(id, { staged, renamed }, opts);
    return { staged: [], renamed: null, reportRel: null, reason: 'stage_failed', error: err.message };
  }

  log('info', 'archive', { id, msg: `Archive rename folded into the landing commit (${staged.length} queue path(s))`, paths: staged });
  return { staged, renamed, reportRel: archivedRel, reason: 'ok' };
}

/**
 * revertQueueArchiveStaging(id, archive, opts)
 *
 * Undo stageQueueArchiveForLanding: unstage the index entries it added and put the
 * ACCEPTED name back. A landing that fails is abandoned whole (dev rewound, nothing
 * pushed), so the queue must read exactly as it did before the attempt — a
 * half-staged index is precisely what the autocommit used to sweep into a nameless
 * commit, and a slice left ARCHIVED without having landed would never be retried.
 * Best-effort throughout: the caller is already on its error path.
 */
function revertQueueArchiveStaging(id, archive, opts) {
  if (!archive) return;
  opts = opts || {};
  const repoRoot = opts.repoRoot || PROJECT_DIR;
  const git = opts.runGit || gitFinalizer.runGit;

  if (archive.staged && archive.staged.length) {
    try {
      git(`git reset -q HEAD -- ${archive.staged.map(shQuote).join(' ')}`, {
        slice_id: String(id), op: 'landingArchive_reset', cwd: repoRoot, execOpts: { stdio: 'pipe' },
      });
    } catch (_) { /* the index lock is held or HEAD is unborn — nothing was staged either */ }
  }
  if (archive.renamed) {
    try {
      fs.renameSync(path.join(repoRoot, archive.renamed.to), path.join(repoRoot, archive.renamed.from));
    } catch (_) { /* the file moved on under us — the operator's ERROR report says the rest */ }
  }
}

/**
 * archivedFileDiffersFromIndex(id, rel, repoRoot, git) → bool
 *
 * The landing commit already tracks {id}-ARCHIVED.md, so "is it tracked?" stopped being
 * the whole question once Julian's stage began rewriting that file into the sticker
 * (slice 363). A tracked path whose CONTENT changed is a change to record; without this
 * the sticker would sit on disk, correct and uncommitted, and the next landing's amend
 * would be the first thing to notice.
 */
function archivedFileDiffersFromIndex(id, rel, repoRoot, git) {
  try {
    const raw = git(`git status --porcelain -- ${shQuote(rel)}`, {
      slice_id: String(id), op: 'archiveRename_status', cwd: repoRoot, encoding: 'utf-8',
    });
    return String(raw || '').trim().length > 0;
  } catch (_) {
    // Unreadable status is not evidence of a change; the rename half below still records.
    return false;
  }
}

/**
 * recordArchivedQueueRename(id, opts) → { recorded, reason, paths }
 *
 * Queue reports are permanent records by contract, and they are tracked — but
 * `bridge/queue/*.md` is gitignored, so that tracking is force-added and git has
 * no way to follow a report when the pipeline renames it. Archiving does exactly
 * that: the report travels forward through its state suffixes to
 * {id}-ARCHIVED.md, and the siblings beside it are swept into bridge/trash/. On
 * disk the record is intact. To git a tracked file simply vanished and no file
 * arrived, so the next pre-checkout autocommit commits four bare deletions
 * (027f09c) — pipeline paperwork wedged between every pair of real commits, and
 * four manual repairs in two days.
 *
 * The answer is not to untrack the reports: they are the audit trail this queue
 * exists to keep. It is to tell git about the rename in the step that performs
 * it, so the old name leaves and the new one arrives together. Only this slice's
 * queue paths are ever touched.
 *
 * Slice 395 moved the ordinary case — the landing — into the landing commit itself
 * (stageQueueArchiveForLanding above), so this is now the recorder for the archivals
 * that have no landing to ride: a nothing-to-do ticket archived without review, a
 * backfill at startup, an operator calling it by hand. Those still deserve one
 * commit, and its subject now carries the S<id> prefix so the topology labels it.
 *
 * Runs inside the merge path, which is why it takes nothing and waits for
 * nothing: git's own index.lock is the only lock here and a git command that
 * cannot take it fails rather than blocks. If the commit fails, the paths this
 * staged are reset — a half-staged index would be swept by the very autocommit
 * this exists to silence.
 *
 * The commit stays local; ensureIntegrationIsFresh() pushes a local-ahead
 * integration branch on the next cycle, so this adds no network call to archival.
 * It is written only when HEAD is that integration branch — never the trunk, which
 * the promote gate fast-forwards and a local commit would strand.
 *
 * `opts.runGit` is a seam for the tests (same shape as gitFinalizer.runGit).
 */
function recordArchivedQueueRename(id, opts) {
  opts = opts || {};
  const repoRoot = opts.repoRoot || PROJECT_DIR;
  const queueDir = opts.queueDir || QUEUE_DIR;
  const git = opts.runGit || gitFinalizer.runGit;

  // A fixture queue dir (backfill tests, the e2e seed root) is not a repository.
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    return { recorded: false, reason: 'not_a_repo', paths: [] };
  }
  const queueRel = path.relative(repoRoot, queueDir).split(path.sep).join('/');
  if (!queueRel || queueRel.startsWith('..') || path.isAbsolute(queueRel)) {
    return { recorded: false, reason: 'queue_outside_repo', paths: [] };
  }

  // What git still believes about this slice's queue files, whatever suffix it
  // last saw them under.
  let tracked;
  try {
    const raw = git(`git ls-files -- ${shQuote(queueRel)}`, {
      slice_id: String(id), op: 'archiveRename_lsFiles', cwd: repoRoot, encoding: 'utf-8',
    });
    tracked = String(raw || '').split('\n').map(l => l.trim()).filter(Boolean)
      .filter(rel => path.basename(rel).startsWith(`${id}-`) && CANONICAL_SUFFIX_RE.test(rel));
  } catch (err) {
    log('warn', 'archive', { id, msg: 'Could not list tracked queue files', error: err.message });
    return { recorded: false, reason: 'ls_files_failed', error: err.message, paths: [] };
  }

  // Archival runs at the end of the squash, with the tree on the integration
  // branch — which is where the swept deletions landed. Anywhere else, and
  // notably on the trunk (backfillArchive runs at startup, wherever HEAD happens
  // to be), a commit here would put a local-only change on a branch the promote
  // gate fast-forwards. Leave it to the operator rather than diverge main.
  let head;
  try {
    head = String(git('git rev-parse --abbrev-ref HEAD', {
      slice_id: String(id), op: 'archiveRename_head', cwd: repoRoot, encoding: 'utf-8',
    })).trim();
  } catch (err) {
    return { recorded: false, reason: 'head_unreadable', paths: [] };
  }
  if (head !== INTEGRATION_BRANCH) {
    log('info', 'archive', { id, msg: `Not recording archive rename on '${head}' — only ${INTEGRATION_BRANCH} carries queue bookkeeping` });
    return { recorded: false, reason: 'not_on_integration_branch', head, paths: [] };
  }

  const archivedRel = `${queueRel}/${id}-ARCHIVED.md`;
  const departed = tracked.filter(rel => !fs.existsSync(path.join(repoRoot, rel)));
  const paths = [];
  if (fs.existsSync(path.join(repoRoot, archivedRel)) &&
      (!tracked.includes(archivedRel) || archivedFileDiffersFromIndex(id, archivedRel, repoRoot, git))) {
    paths.push(archivedRel);
  }
  for (const rel of departed) if (!paths.includes(rel)) paths.push(rel);
  if (!paths.length) return { recorded: false, reason: 'nothing_to_record', paths: [] };

  const quoted = paths.map(shQuote).join(' ');
  const from = departed.length ? departed.map(rel => path.basename(rel)).join(', ') : '(nothing tracked)';
  // S<id>: — every commit the pipeline writes says which slice it belongs to, so the
  // topology can label it; a nameless commit on dev now means a person made it (395).
  // `Kind: P` then says which KIND it is (405): bookkeeping, not a slice landing. It goes
  // in the trailer block, so the subject the topology reads stays the one line it was.
  const msg = gitFinalizer.pipelineCommitSubject(id, `archive ${from} -> ${id}-ARCHIVED.md`);
  const commitBody = `${msg}\n\nKind: P\n`;

  try {
    // -f because the queue is ignored and the new name would be invisible without
    // it; -A over the same pathspec is what stages the old name's disappearance.
    git(`git add -f -A -- ${quoted}`, {
      slice_id: String(id), op: 'archiveRename_add', cwd: repoRoot, execOpts: { stdio: 'pipe' },
    });
    // Per-COMMAND, never process-wide: this commits in the MAIN working tree,
    // where the Layer-1 pre-commit hook only lets the watcher merge path through.
    git(`git commit --only -m ${shQuote(commitBody)} -- ${quoted}`, {
      slice_id: String(id), op: 'archiveRename_commit', cwd: repoRoot,
      execOpts: { stdio: 'pipe', env: Object.assign({}, process.env, { DS9_WATCHER_MERGE: '1' }) },
    });
  } catch (err) {
    try {
      git(`git reset -q HEAD -- ${quoted}`, {
        slice_id: String(id), op: 'archiveRename_reset', cwd: repoRoot, execOpts: { stdio: 'pipe' },
      });
    } catch (_) { /* the index lock is held or HEAD is unborn — nothing was staged either */ }
    log('warn', 'archive', { id, msg: 'Could not record the archive rename in git', error: err.message, paths });
    return { recorded: false, reason: 'git_failed', error: err.message, paths };
  }

  let sha = null;
  try {
    sha = String(git('git rev-parse HEAD', {
      slice_id: String(id), op: 'archiveRename_sha', cwd: repoRoot, encoding: 'utf-8',
    })).trim();
  } catch (_) {}

  registerEvent(id, 'QUEUE_ARCHIVE_RENAME_RECORDED', {
    slice_id: String(id), from: departed, to: archivedRel, sha,
  });
  log('info', 'archive', { id, msg: `Recorded archive rename of ${paths.length} queue path(s)`, sha });
  return { recorded: true, reason: 'ok', paths, sha };
}

/**
 * archiveAcceptedSlice(id, branchName, opts)
 *
 * Rename {id}-IN_QA.md (or {id}-ACCEPTED.md, for a slice that never reached the stage)
 * → {id}-ARCHIVED.md. Prune worktree. Delete branch. Emit ARCHIVED register event.
 * Idempotent (no-op once the ARCHIVED event proves the archival finished).
 * Returns { archived: bool, reason: string }.
 *
 * Called by finishQaStage after Julian's stage records its result — NOT at squash time,
 * which is where it used to run: the sibling sweep would otherwise put the brief and the
 * verdict in bridge/trash/ before the packet could be made of them (slice 363).
 */
function archiveAcceptedSlice(id, branchName, opts) {
  const queueDir = (opts && opts.queueDir) || QUEUE_DIR;
  const trashDir = (opts && opts.trashDir) || TRASH_DIR;
  const source = (opts && opts.source) || 'merge';

  const archivedPath = path.join(queueDir, `${id}-ARCHIVED.md`);

  // Slice 395: the landing commit performs this rename so it can carry it, which means the
  // ARCHIVED file alone no longer proves the archival finished — the worktree, the branch
  // and the register event may all still be outstanding. The ARCHIVED event proves it.
  if (fs.existsSync(archivedPath) && hasArchivedEvent(id, opts && opts.regFile)) {
    return { archived: false, reason: 'already_archived' };
  }

  // IN_QA wins even over an ARCHIVED name that is already there: while Julian's stage runs
  // the slice lives under that name and the file is the STICKER — the brief with every
  // review round, the report and the verdict — not the bare report the landing tracked
  // (slice 363). The sticker is the record that survives, so it wins. ACCEPTED does not:
  // when the landing already produced the ARCHIVED file, that is the newer document and a
  // leftover ACCEPTED renamed over it would throw the landing's own record away.
  const archivedExists = fs.existsSync(archivedPath);
  const inQaPath = path.join(queueDir, `${id}${qaStage.IN_QA_SUFFIX}`);
  const acceptedPath = path.join(queueDir, `${id}-ACCEPTED.md`);
  const sourcePath = fs.existsSync(inQaPath) ? inQaPath
    : (!archivedExists && fs.existsSync(acceptedPath) ? acceptedPath : null);
  if (sourcePath) {
    fs.renameSync(sourcePath, archivedPath);
  } else if (!archivedExists) {
    return { archived: false, reason: 'no_accepted_file' };
  } else {
    log('info', 'archive', { id, msg: 'ARCHIVED file already in place (folded into the landing commit) — finishing the archival' });
  }

  // Prune worktree if present
  const wtPath = getWorktreePath(id);
  if (fs.existsSync(wtPath)) {
    try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch (_) {}
    try { gitFinalizer.runGit('git worktree prune', { slice_id: id, op: 'archiveAccepted_prune', execOpts: { stdio: 'pipe' } }); } catch (_) {}
  }

  // Delete branch
  if (branchName) {
    try {
      gitFinalizer.runGit(`git branch -D ${branchName}`, { slice_id: id, op: 'archiveAccepted_branchD', execOpts: { stdio: 'pipe' } });
    } catch (_) {}
  }

  // Get sha for the event
  let sha = null;
  try {
    sha = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'archiveAccepted_sha', encoding: 'utf-8' }).trim();
  } catch (_) {}

  registerEvent(id, 'ARCHIVED', { slice_id: String(id), branch: branchName || `slice/${id}`, sha, source });

  // Clean up sibling state files
  archiveSiblingStateFiles(id, 'ARCHIVED', { queueDir, trashDir });

  // …and only now tell git, so the one commit carries the ARCHIVED name in and
  // every name the sweep above took out. Best-effort: the archival itself has
  // already happened and must not be undone by a git failure.
  let renameRecord = { recorded: false, reason: 'not_attempted' };
  try {
    renameRecord = recordArchivedQueueRename(id, { queueDir, repoRoot: opts && opts.repoRoot, runGit: opts && opts.runGit });
  } catch (err) {
    log('warn', 'archive', { id, msg: 'Archive rename recording threw', error: err.message });
  }

  return { archived: true, reason: 'ok', renameRecorded: renameRecord.recorded, renameReason: renameRecord.reason };
}

/**
 * handleAccepted(id, reason, cycle, branchName, evaluatingPath, durationMs, verdictSource, reviewUsage)
 *
 * ACCEPTED verdict: register event, rename EVALUATING → ACCEPTED, merge branch to main directly.
 *
 * verdictSource is where readNogVerdict found the verdict ('frontmatter',
 * 'unfenced' or 'review_section'); it rides along on NOG_DECISION so the
 * register says which read decided the round. Absent means it is not recorded.
 *
 * reviewUsage is what the review itself cost, from reviewTelemetry — spread onto
 * the decision so the History row can add Jordan to the slice's bill (slice
 * 402). Undefined or empty when his session recorded nothing; the event is then
 * written exactly as it was before.
 */
function handleAccepted(id, reason, cycle, branchName, evaluatingPath, durationMs, verdictSource, reviewUsage) {
  // Read title from parked slice file for the merge commit message.
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyParkedPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  const resolvedParkedPath = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
  let title = null;
  try {
    const commMeta = parseFrontmatter(fs.readFileSync(resolvedParkedPath, 'utf-8'));
    if (commMeta) title = commMeta.title || null;
  } catch (_) {}

  // The lane comes through readSliceMeta rather than a second parse of the file
  // above, so there is exactly one place that knows the lane lives on the brief
  // and not on the report (slice 389).
  const lane = readSliceMeta(id).lane;

  // Canonical: NOG_DECISION (verdict) → rename → merge → MERGED
  const acceptedDecision = { verdict: 'ACCEPTED', reason, cycle, round: cycle, ...reviewUsage };
  if (verdictSource) acceptedDecision.verdict_source = verdictSource;
  registerEvent(id, 'NOG_DECISION', acceptedDecision);
  log('info', 'evaluator', { id, verdict: 'ACCEPTED', cycle, durationMs });

  // timesheet write point 2 — update orchestrator row at terminal state
  updateTimesheet(id, { result: 'ACCEPTED', cycle, ts_result: new Date().toISOString() });

  // Merge branch to main directly — no separate merge slice.
  if (!branchName) {
    log('warn', 'merge', { id, msg: 'No branch name in DONE report — skipping merge' });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}No branch in report — merge skipped`);
    print(`${B.bl}${B.sng.repeat(W - 1)}`);
    print('');
    return;
  }

  // Route through acceptAndMerge — handles EVALUATING→ACCEPTED rename + merge.
  const result = acceptAndMerge(id, evaluatingPath, branchName, title, { lane });

  if (result.deferred) {
    // Slice deferred during gate — stays in ACCEPTED state, will be drained post-gate
    log('info', 'merge', { id, msg: `Slice ${branchName} deferred — gate is running` });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}Deferred (gate running) — ${branchName} queued for post-gate drain`);
  } else if (result.success) {
    const shortSha = (result.sha || '').slice(0, 7);
    registerEvent(id, 'MERGED', { branch: branchName, sha: result.sha, slice_id: id });
    log('info', 'merge', { id, msg: `Squashed ${branchName} to dev`, branch: branchName, sha: result.sha });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}Squashed ${branchName}${SYM.arrow}dev (${shortSha})`);
    // Clean up the worktree after successful squash
    try { cleanupWorktree(id, branchName); } catch (_) {}
    // The slice is on the integration branch, so Julian's stage starts — by itself, for
    // this one slice. Archival is no longer the next thing that happens: it runs when the
    // stage records its result, because the sweep would otherwise take the brief and the
    // verdict to the trash before the packet could be made of them (slice 363).
    startQaStageOrArchive(id, { branchName, title, sha: result.sha, lane });
  } else {
    registerEvent(id, 'MERGE_FAILED', { branch: branchName, reason: result.error, slice_id: id });
    log('error', 'merge', { id, msg: `Squash failed for ${branchName}`, branch: branchName, reason: result.error });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}${C.red}${SYM.cross}${C.reset} Squash failed: ${result.error}`);
    printMergeFailedAlert(id, title, branchName, result.error);
  }

  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

// ---------------------------------------------------------------------------
// Nog code review invocation
// ---------------------------------------------------------------------------

/**
 * countNogRounds(sliceContent)
 *
 * Counts existing `## Nog Review — Round N` headers in the slice file
 * to determine the current round number.
 */
function countNogRounds(sliceContent) {
  const matches = sliceContent.match(/^## Nog Review — Round \d+/gm);
  return matches ? matches.length : 0;
}

// The four verdicts Nog may return. Anything else is not a verdict.
const NOG_VERDICTS = ['ACCEPTED', 'REJECTED', 'ESCALATE', 'OVERSIZED'];

/**
 * readNogVerdict(verdictFileContent, sliceFileContent, round)
 *
 * Reads Nog's verdict by what it says, not by whether its punctuation survived.
 *
 * `${id}-NOG.md` is meant to be exactly a closed frontmatter block (`---`,
 * `verdict:`, `summary:`, `---`). When Nog drops the closing `---`,
 * parseFrontmatter returns null, the round is filed as verdict_unreadable —
 * a REJECTED — and the slice is sent round again. That cost a round three
 * times in two days (390 twice, 358 once) and on 388 threw away an ACCEPTED.
 * The `**Verdict:**` line Nog appends to the slice file was intact every time.
 *
 * So: tolerate what a headless writer actually emits (a byte-order mark,
 * leading blank lines, CRLF endings, no closing fence), and when the file
 * still yields nothing, read the `**Verdict:**` line from Nog's review
 * section for THIS round. Only when both are empty is the round unreadable,
 * exactly as before.
 *
 * Returns { verdict, summary, source } where source is:
 *   'frontmatter'    — the closing fence was there
 *   'unfenced'       — no closing fence; frontmatter read to end of file
 *   'review_section' — taken from the slice file's section for `round`
 *   null             — nothing readable; verdict is null and the caller files
 *                      the round as verdict_unreadable
 *
 * parseFrontmatter is deliberately untouched — about 30 other callers depend
 * on its exact behaviour. Only invokeNog reads a verdict through here.
 *
 * Operational note: the daemon runs the code it loaded at start, so this does
 * nothing for the live pipeline until the orchestrator is restarted
 * (`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`).
 */
function readNogVerdict(verdictFileContent, sliceFileContent, round) {
  const nothing = { verdict: null, summary: '', source: null };

  // ── 1. The verdict file ──────────────────────────────────────────────────
  if (typeof verdictFileContent === 'string' && verdictFileContent.length > 0) {
    const text = verdictFileContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = text.split('\n');

    // Blank lines before the opening fence are noise, not content.
    let open = 0;
    while (open < lines.length && lines[open].trim() === '') open++;

    if (open < lines.length && lines[open].trim() === '---') {
      let close = -1;
      for (let i = open + 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { close = i; break; }
      }
      // No closing fence — the frontmatter is the rest of the file.
      const body = lines.slice(open + 1, close === -1 ? lines.length : close);

      const meta = {};
      body.forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) return;
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key) meta[key] = val;
      });

      const declared = meta.verdict ? translateVerdict(String(meta.verdict).toUpperCase()) : null;
      if (declared && NOG_VERDICTS.includes(declared)) {
        return {
          verdict: declared,
          summary: meta.summary || '',
          source: close === -1 ? 'unfenced' : 'frontmatter',
        };
      }
    }
  }

  // ── 2. Nog's review section for THIS round ───────────────────────────────
  // This round's section only. Earlier rounds' Verdict lines are still in the
  // file; letting one of those decide would either rework accepted work or
  // land work nobody reviewed.
  const roundNum = String(round === undefined || round === null ? '' : round).trim();
  if (typeof sliceFileContent !== 'string' || !/^\d+$/.test(roundNum)) return nothing;

  const slice = sliceFileContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const start = slice.search(new RegExp(`^## Nog Review — Round ${roundNum}(?!\\d)[^\\n]*$`, 'm'));
  if (start === -1) return nothing;

  // The section ends at the next `## ` heading — never read past it.
  const rest = slice.slice(start);
  const nextHeading = rest.slice(1).search(/^## /m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1);

  const line = section.match(/^\s*\*\*Verdict:\*\*\s*\**\s*([A-Za-z][A-Za-z_-]*)/m);
  if (!line) return nothing;

  const declared = translateVerdict(line[1].toUpperCase());
  if (!NOG_VERDICTS.includes(declared)) return nothing;

  return { verdict: declared, summary: '', source: 'review_section' };
}

/**
 * invokeNog(id)
 *
 * Reads the PARKED slice and DONE report for a given slice ID,
 * determines the current Nog review round, builds the Nog prompt,
 * invokes Nog headless via `claude -p`, and handles the verdict.
 *
 * PASS → proceed to existing evaluator flow (ACCEPTED path).
 * RETURN → rewrite slice in-place and re-queue for O'Brien.
 * Round 6 → escalate to O'Brien.
 */
function invokeNog(id) {
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyParkedPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  const donePath = path.join(QUEUE_DIR, `${id}-EVALUATING.md`); // renamed from DONE by poll loop

  // Read PARKED file (original slice + any prior Nog reviews). Fall back to legacy ARCHIVED.
  const resolvedParkedPath = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
  let sliceContent;
  try {
    sliceContent = fs.readFileSync(resolvedParkedPath, 'utf-8');
  } catch (err) {
    log('warn', 'nog', { id, msg: 'PARKED file not found — skipping Nog review', error: err.message });
    try { fs.renameSync(donePath, path.join(QUEUE_DIR, `${id}-DONE.md`)); } catch (_) {}
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Read DONE report (EVALUATING is the renamed DONE).
  let doneReportContents;
  try {
    doneReportContents = fs.readFileSync(donePath, 'utf-8');
  } catch (err) {
    log('warn', 'nog', { id, msg: 'EVALUATING file not found — skipping Nog review', error: err.message });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Extract branch name from DONE report.
  const doneMeta = parseFrontmatter(doneReportContents) || {};
  const branchName = doneMeta.branch || null;
  const sliceMeta = parseFrontmatter(sliceContent) || {};
  const rootId = sliceMeta.root_commission_id || id;

  // Determine round number.
  const existingRounds = countNogRounds(sliceContent);
  const round = existingRounds + 1;

  // Round 6 escalation: do not invoke Nog again.
  if (round > MAX_ROUNDS) {
    log('warn', 'nog', { id, msg: `Round ${round} — escalating to O'Brien`, round });

    // Write escalation file.
    const escalationContent = [
      '---',
      `id: "${id}"`,
      `title: "NOG ESCALATION — slice ${id}"`,
      'from: nog',
      'to: obrien',
      `created: "${new Date().toISOString()}"`,
      `round: ${round}`,
      `branch: "${branchName || ''}"`,
      '---',
      '',
      '## Nog Escalation — Round 6',
      '',
      `Slice ${id} has not passed Nog review after 5 rounds.`,
      'Full slice history (including all Nog review rounds) follows.',
      '',
      '## Slice file contents',
      '',
      sliceContent,
      '',
      "## Rom's latest DONE report",
      '',
      doneReportContents,
    ].join('\n');

    try {
      fs.writeFileSync(path.join(ESCALATIONS_DIR, `${id}-NOG-ESCALATION.md`), escalationContent);
      log('info', 'nog', { id, msg: 'Wrote NOG-ESCALATION file' });
    } catch (err) {
      log('error', 'nog', { id, msg: 'Failed to write NOG-ESCALATION file', error: err.message });
    }

    appendOperationalEvent({
      event: 'NOG_ESCALATION',
      slice_id: id,
      root_id: rootId !== id ? rootId : null,
      cycle: round,
      branch: branchName || null,
      details: `Slice ${id} failed Nog review after 5 rounds — escalating to O'Brien`,
    });

    // Append round entry for the exhausted round to PARKED file.
    const romTelemetryExhausted = extractRomTelemetry(doneReportContents);
    appendRoundEntry(resolvedParkedPath, {
      round: 5,
      attempt_number: computeNextAttemptNumber(resolvedParkedPath, 5),
      commissioned_at: romTelemetryExhausted.commissioned_at,
      done_at: romTelemetryExhausted.done_at,
      durationMs: romTelemetryExhausted.durationMs,
      tokensIn: romTelemetryExhausted.tokensIn,
      tokensOut: romTelemetryExhausted.tokensOut,
      costUsd: romTelemetryExhausted.costUsd,
      nog_verdict: 'MAX_ROUNDS_EXHAUSTED',
      nog_reason: 'Rom exhausted 5 rounds without Nog sign-off',
    });

    registerEvent(id, 'NOG_ESCALATION', { round, branch: branchName });

    // Emit MAX_ROUNDS_EXHAUSTED terminal event for UI1 history rendering.
    registerEvent(id, 'MAX_ROUNDS_EXHAUSTED', {
      round: 5,
      reason: 'Rom exhausted 5 rounds without Nog sign-off',
    });

    // Rename to STUCK.
    const stuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
    try {
      fs.renameSync(donePath, stuckPath);
      log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK' });
    } catch (err) {
      log('warn', 'nog', { id, msg: 'Failed to rename to STUCK', error: err.message });
    }

    // Clean up worktree for the exhausted slice.
    try { cleanupWorktree(id, branchName); } catch (_) {}

    updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

    print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} MAX_ROUNDS_EXHAUSTED${SYM.sep}Slice ${id} exhausted 5 Nog rounds — escalated to O'Brien`);
    print(`${B.bl}${B.sng.repeat(W - 1)}`);
    print('');

    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    heartbeatState.processed_total += 1;
    writeHeartbeat();
    return;
  }

  // Build git diff.
  let gitDiff = '(no diff available)';
  if (branchName) {
    try {
      gitDiff = gitFinalizer.runGit(`git diff ${INTEGRATION_BRANCH}...${branchName}`, { slice_id: id, op: 'nog_gitDiff', encoding: 'utf-8', execOpts: { maxBuffer: 5 * 1024 * 1024 } });
    } catch (err) {
      log('warn', 'nog', { id, msg: 'Failed to get git diff for Nog', error: err.message });
    }
  }

  // Resolve worktree path for Nog's cwd.
  let nogWorktreePath = getWorktreePath(id);
  if (!fs.existsSync(nogWorktreePath) && branchName) {
    try {
      nogWorktreePath = createWorktree(id, branchName);
    } catch (wtErr) {
      log('warn', 'nog', { id, msg: 'Could not create worktree for Nog — falling back to PROJECT_DIR', error: wtErr.message });
      nogWorktreePath = PROJECT_DIR;
    }
  } else if (!fs.existsSync(nogWorktreePath)) {
    nogWorktreePath = PROJECT_DIR;
  }

  // The reviewer's workspace is provisioned exactly like the implementer's — same
  // function, same symlink. Reached here as well as inside createWorktree, because the
  // common case above REUSES Rom's existing worktree and never calls createWorktree.
  // (A no-op when nogWorktreePath fell back to PROJECT_DIR, which owns the real one.)
  provisionWorkspaceDeps(nogWorktreePath, id);

  // Build scope diff (same as evaluator used to do — now part of the single Nog pass).
  const scopeDiff = branchName ? buildScopeDiff(id, branchName, sliceContent) : '## SCOPE REVIEW — branch name unknown, scope diff unavailable\n';

  // Build prompt.
  const prompt = buildNogPrompt({
    id,
    round,
    sliceFileContents: sliceContent,
    doneReportContents,
    gitDiff,
    scopeDiff,
    slicePath: resolvedParkedPath,
    lane: resolveLane(parseFrontmatter(sliceContent)),
  });

  log('info', 'nog', { id, round, branchName, msg: 'Invoking Nog code review' });
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Nog Code Review${SYM.sep}Slice ${id} — Round ${round} of 5`);
  print(`${B.vert}    Reviewing — fresh claude -p session, slice + DONE report + diff injected`);
  print(`${B.vert}`);

  const pickupTime = Date.now();

  // Write nog-active.json for dashboard.
  try {
    fs.writeFileSync(NOG_ACTIVE_FILE, JSON.stringify({
      sliceId: String(id),
      title: sliceMeta.title || null,
      round,
      invokedAt: new Date().toISOString(),
      phase: 'code_review',
    }), 'utf8');
  } catch (_) {}

  // Progress tick every 60s.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  // Log file for Nog's output.
  const nogLogPath = path.join(LOGS_DIR, `nog-${id}-round${round}.log`);

  // Read as it arrives, like Sam's (slice 396). A 10 MB cap on a review is a
  // review killed for the size of the diff it was asked to read; the log the
  // operator tails IS the record now, written once, while the review runs, and
  // never rewritten at the end.
  const { streamSession } = require('../lib/session-stream');

  const child = streamSession(
    {
      command: config.claudeCommand,
      args: config.claudeArgs,
      cwd: nogWorktreePath,
      prompt,
      logPath: nogLogPath,
    },
    ({ code, signal, spawnError, retained }) => {
      clearInterval(tickInterval);
      try { fs.renameSync(NOG_ACTIVE_FILE, path.join(TRASH_DIR, 'nog-active.json.done')); } catch (_) {}
      const durationMs = Date.now() - pickupTime;

      // execFile's `err`, rebuilt from the child's own close (slice 396): null on
      // a clean exit, and otherwise what the verdict branch below reads it for.
      const err = spawnError
        ? { code: spawnError.code, signal: null, killed: !!child.killed, message: spawnError.message }
        : (code === 0 && !signal)
          ? null
          : {
              code,
              signal,
              killed: !!child.killed,
              message: `Command failed: ${config.claudeCommand} ${signal ? `killed with ${signal}` : `exited ${code}`}`,
            };

      // What this review cost, read once from Jordan's own session and spread
      // onto whatever event the round ends up writing (slice 402). `{}` when
      // the session recorded nothing — no verdict path estimates in its place.
      // The line is his result event, kept as it streamed past.
      const reviewUsage = reviewTelemetry(retained.resultLine || retained.lastJsonLine || '');

      // Read Nog's verdict file.
      const nogVerdictPath = path.join(QUEUE_DIR, `${id}-NOG.md`);
      // Also check the worktree queue dir.
      const worktreeNogPath = path.join(nogWorktreePath, 'bridge', 'queue', `${id}-NOG.md`);

      // Copy verdict from worktree if needed.
      try {
        if (fs.existsSync(worktreeNogPath) && !fs.existsSync(nogVerdictPath)) {
          fs.copyFileSync(worktreeNogPath, nogVerdictPath);
        }
      } catch (_) {}

      // Copy updated slice file from worktree if Nog appended to it.
      const worktreeParkedPath = path.join(nogWorktreePath, 'bridge', 'queue', `${id}-PARKED.md`);
      const worktreeLegacyPath = path.join(nogWorktreePath, 'bridge', 'queue', `${id}-ARCHIVED.md`);
      const worktreeResolved = fs.existsSync(worktreeParkedPath) ? worktreeParkedPath : worktreeLegacyPath;
      try {
        if (fs.existsSync(worktreeResolved)) {
          fs.copyFileSync(worktreeResolved, resolvedParkedPath);
        }
      } catch (_) {}

      // Re-read the PARKED file after worktree copy so the apendment includes
      // Nog's appended review (the closure's sliceContent is the pre-Nog version).
      // The verdict read below needs it too: its fallback is the `**Verdict:**`
      // line in Nog's review section, which does not exist until this copy has
      // happened. Read the slice first, then the verdict.
      let updatedSliceContent = sliceContent;
      try {
        updatedSliceContent = fs.readFileSync(resolvedParkedPath, 'utf-8');
      } catch (_) {}

      let verdict = null;
      let summary = '';
      let verdictSource = null;

      if (!err) {
        let nogContent = '';
        try {
          nogContent = fs.readFileSync(nogVerdictPath, 'utf-8');
        } catch (readErr) {
          log('warn', 'nog', { id, msg: 'Failed to read NOG.md verdict', error: readErr.message });
        }
        // A missing closing fence, a byte-order mark or CRLF endings no longer
        // throw the verdict away; nor does a verdict file that never appeared,
        // as long as Nog's review section names a verdict for this round.
        const read = readNogVerdict(nogContent, updatedSliceContent, round);
        verdict = read.verdict;
        summary = read.summary;
        verdictSource = read.source;
        if (verdictSource && verdictSource !== 'frontmatter') {
          log('info', 'nog', { id, round, verdict, verdict_source: verdictSource, msg: `Nog verdict recovered from ${verdictSource}` });
        }
      } else {
        log('error', 'nog', { id, msg: 'claude -p Nog review failed', error: err.message, durationMs });
      }

      if (!verdict || !['ACCEPTED', 'REJECTED', 'ESCALATE', 'OVERSIZED'].includes(verdict)) {
        // Missing or unparseable verdict — treat as REJECTED.
        log('warn', 'nog', { id, msg: 'Nog verdict unreadable — treating as REJECTED', verdict, durationMs });

        // Append round entry to PARKED file.
        const romTelemetryUnread = extractRomTelemetry(doneReportContents);
        appendRoundEntry(resolvedParkedPath, {
          round,
          attempt_number: computeNextAttemptNumber(resolvedParkedPath, round),
          commissioned_at: romTelemetryUnread.commissioned_at,
          done_at: romTelemetryUnread.done_at,
          durationMs: romTelemetryUnread.durationMs,
          tokensIn: romTelemetryUnread.tokensIn,
          tokensOut: romTelemetryUnread.tokensOut,
          costUsd: romTelemetryUnread.costUsd,
          nog_verdict: 'NOG_DECISION_REJECTED',
          nog_reason: 'verdict_unreadable',
        });

        registerEvent(id, 'NOG_DECISION', { round, verdict: 'REJECTED', reason: 'verdict_unreadable', apendment_cycle: round, ...reviewUsage });
        appendOperationalEvent({
          event: 'NOG_ESCALATION',
          slice_id: id,
          root_id: rootId !== id ? rootId : null,
          cycle: round,
          branch: branchName || null,
          details: `Nog verdict unreadable for slice ${id} round ${round}`,
        });

        // ── MAX_ROUNDS guard (verdict_unreadable path) ──────────────────────
        // If this was round MAX_ROUNDS, re-dispatch would be round 6 — terminal.
        if (round >= MAX_ROUNDS) {
          registerEvent(id, 'MAX_ROUNDS_EXHAUSTED', {
            round,
            reason: 'verdict_unreadable at final round — no re-dispatch permitted',
          });

          const stuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
          try {
            fs.renameSync(donePath, stuckPath);
            log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK', reason: 'max_rounds_verdict_unreadable' });
          } catch (renameErr) {
            log('warn', 'nog', { id, msg: 'Failed to rename to STUCK', error: renameErr.message });
          }

          try { cleanupWorktree(id, branchName); } catch (_) {}
          updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

          print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} MAX_ROUNDS_EXHAUSTED${SYM.sep}Slice ${id} verdict_unreadable at round ${round} — terminal`);
          print(`${B.bl}${B.sng.repeat(W - 1)}`);
          print('');

          processing = false;
          heartbeatState.status = 'idle';
          heartbeatState.current_slice = null;
          heartbeatState.current_slice_goal = null;
          heartbeatState.pickupTime = null;
          heartbeatState.processed_total += 1;
          writeHeartbeat();
          return;
        }
        // ────────────────────────────────────────────────────────────────────

        // ── Retry cap (within this round) ────────────────────────────────────
        // The round only advances when Nog appends a round heading, which an
        // unreadable verdict never does — so without a cap here the retry spins
        // forever and MAX_ROUNDS above is unreachable. Bound the attempts, back
        // off between them, and end in a state that names the reason.
        const unreadableAttempts = countUnreadableVerdicts(id, round);
        if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS) {
          registerEvent(id, 'VERDICT_UNREADABLE_EXHAUSTED', {
            round,
            attempts: unreadableAttempts,
            max_attempts: MAX_UNREADABLE_ATTEMPTS,
            reason: `Nog returned an unreadable verdict ${unreadableAttempts} times in round ${round} — retry budget exhausted, manual review required`,
          });

          const stuckPathUnreadable = path.join(QUEUE_DIR, `${id}-STUCK.md`);
          try {
            fs.renameSync(donePath, stuckPathUnreadable);
            log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK', reason: 'verdict_unreadable_retry_cap' });
          } catch (renameErr) {
            log('warn', 'nog', { id, msg: 'Failed to rename to STUCK', error: renameErr.message });
          }

          log('error', 'nog', {
            id,
            msg: `Unreadable-verdict retry cap reached for slice ${id}`,
            reason: 'verdict_unreadable_retry_cap',
            round,
            attempts: unreadableAttempts,
          });

          try { cleanupWorktree(id, branchName); } catch (_) {}
          updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

          print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} VERDICT_UNREADABLE_EXHAUSTED${SYM.sep}Slice ${id} — ${unreadableAttempts}/${MAX_UNREADABLE_ATTEMPTS} unreadable verdicts in round ${round}, terminal`);
          print(`${B.bl}${B.sng.repeat(W - 1)}`);
          print('');

          processing = false;
          heartbeatState.status = 'idle';
          heartbeatState.current_slice = null;
          heartbeatState.current_slice_goal = null;
          heartbeatState.pickupTime = null;
          heartbeatState.processed_total += 1;
          writeHeartbeat();
          return;
        }

        const backoffMs = unreadableBackoffMs(unreadableAttempts);
        const notBefore = new Date(Date.now() + backoffMs).toISOString();
        // ────────────────────────────────────────────────────────────────────

        // Rewrite slice in-place for O'Brien with error details.
        handleNogReturn(id, rootId, round, branchName, donePath, updatedSliceContent, 'Nog verdict unreadable — manual review required', durationMs, notBefore);

        print(`${B.vert}    ${C.yellow}${SYM.cross}${C.reset} Nog verdict UNREADABLE${SYM.sep}retry ${unreadableAttempts}/${MAX_UNREADABLE_ATTEMPTS} in ${Math.round(backoffMs / 1000)}s (round ${round})`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      if (verdict === 'ESCALATE' || verdict === 'OVERSIZED') {
        // Nog determined ACs cannot be satisfied as written — escalate to O'Brien.
        log('warn', 'nog', { id, verdict: 'ESCALATE', round, durationMs, summary });

        // Append round entry to PARKED file.
        const romTelemetryEsc = extractRomTelemetry(doneReportContents);
        appendRoundEntry(resolvedParkedPath, {
          round,
          attempt_number: computeNextAttemptNumber(resolvedParkedPath, round),
          commissioned_at: romTelemetryEsc.commissioned_at,
          done_at: romTelemetryEsc.done_at,
          durationMs: romTelemetryEsc.durationMs,
          tokensIn: romTelemetryEsc.tokensIn,
          tokensOut: romTelemetryEsc.tokensOut,
          costUsd: romTelemetryEsc.costUsd,
          nog_verdict: 'ESCALATE',
          nog_reason: summary || 'Nog determined acceptance criteria cannot be satisfied as written',
        });

        registerEvent(id, 'ESCALATED_TO_OBRIEN', {
          round,
          reason: summary || 'Nog determined acceptance criteria cannot be satisfied as written',
          // ESCALATE and OVERSIZED write no NOG_DECISION — this is the event the
          // round ends on, so this is where its numbers go (slice 402).
          ...reviewUsage,
        });

        appendOperationalEvent({
          event: 'ESCALATED_TO_OBRIEN',
          slice_id: id,
          root_id: rootId !== id ? rootId : null,
          cycle: round,
          branch: branchName || null,
          details: `Nog escalated slice ${id} to O'Brien: ${summary || 'ACs cannot be satisfied'}`,
        });

        // Terminal state — rename to STUCK, clean up worktree.
        const escalateStuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
        try {
          fs.renameSync(donePath, escalateStuckPath);
          log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK', reason: 'nog_escalate' });
        } catch (renameErr) {
          log('warn', 'nog', { id, msg: 'Failed to rename to STUCK after ESCALATE', error: renameErr.message });
        }

        try { cleanupWorktree(id, branchName); } catch (_) {}

        // Clean up NOG.md verdict file.
        try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.escalate`)); } catch (_) {}

        updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

        print(`${B.vert}    ${C.cyan}${SYM.cross}${C.reset} Nog ESCALATE${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
        print(`${B.vert}    Escalated to O'Brien — ACs cannot be satisfied as written`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      if (verdict === 'ACCEPTED') {
        log('info', 'nog', { id, verdict: 'ACCEPTED', round, durationMs, summary });

        // Append round entry to PARKED file (telemetry).
        const romTelemetry = extractRomTelemetry(doneReportContents);
        appendRoundEntry(resolvedParkedPath, {
          round,
          attempt_number: computeNextAttemptNumber(resolvedParkedPath, round),
          commissioned_at: romTelemetry.commissioned_at,
          done_at: romTelemetry.done_at,
          durationMs: romTelemetry.durationMs,
          tokensIn: romTelemetry.tokensIn,
          tokensOut: romTelemetry.tokensOut,
          costUsd: romTelemetry.costUsd,
          nog_verdict: 'NOG_DECISION_ACCEPTED',
          nog_reason: summary || '',
        });

        // Clean up NOG.md verdict file.
        try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.pass`)); } catch (_) {}

        // NOG_TELEMETRY — side-effect emit on ACCEPTED verdict (slice 270).
        // Never blocks Nog's verdict transition.
        try {
          const HIGH_RISK_PATHS = ['bridge/orchestrator.js', 'bridge/state/', 'scripts/lock-main.sh', 'scripts/unlock-main.sh', 'dashboard/server.js'];
          let filesTouched = [];
          try {
            filesTouched = execSync(`git diff --name-only ${INTEGRATION_BRANCH}..slice/${id}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
          } catch (_) {}
          const highRiskSurface = filesTouched.some(f => HIGH_RISK_PATHS.some(p => f === p || f.startsWith(p)));

          // Count rounds from updated slice content.
          const roundsMatch = updatedSliceContent.match(/^## Nog Review — Round \d+/gm);
          const roundsCount = roundsMatch ? roundsMatch.length : round;

          // Count lint findings: "Linting: FAIL" headers + individual lint-finding entries.
          const lintFailCount = (updatedSliceContent.match(/Linting:\s*FAIL/gi) || []).length;
          const lintFindingsEntries = (updatedSliceContent.match(/^\d+\.\s+.*?—.*?—/gm) || []).length;
          const lintFindingsTotal = lintFailCount + lintFindingsEntries;

          // Count ACs from acceptance criteria section.
          const acMatch = updatedSliceContent.match(/## Acceptance [Cc]riteria[\s\S]*?(?=\n## |\n---|\s*$)/);
          const acSection = acMatch ? acMatch[0] : '';
          const acCount = (acSection.match(/^\s*\d+\.\s/gm) || []).length;

          // Detect escalation in any round.
          const escalated = /nog_verdict:\s*['"]?ESCALATE/i.test(updatedSliceContent);

          emitGateTelemetry('NOG_TELEMETRY', {
            slice_id: String(id),
            rounds: roundsCount,
            files_touched: filesTouched,
            high_risk_surface: highRiskSurface,
            lint_findings_total: lintFindingsTotal,
            ac_count: acCount,
            escalated,
          });
        } catch (telErr) {
          log('warn', 'nog', { id, msg: 'NOG_TELEMETRY emit failed (non-blocking)', error: telErr.message });
        }

        // Recompute RR after NOG_TELEMETRY (slice 270)
        recomputeAndPersistRR();

        print(`${B.vert}    ${C.green}${SYM.check}${C.reset} Nog PASS${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        // Single-pass: Nog ACCEPTED → merge directly (no second evaluator call).
        handleAccepted(id, summary || '', round, branchName, donePath, durationMs, verdictSource, reviewUsage);

        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      // REJECTED verdict (translated from RETURN if legacy) → NOG_DECISION{verdict: REJECTED}
      log('info', 'nog', { id, verdict: 'REJECTED', round, durationMs, summary });
      const rejectedDecision = { round, verdict: 'REJECTED', reason: summary || 'Nog review findings — see slice file', apendment_cycle: round, ...reviewUsage };
      if (verdictSource) rejectedDecision.verdict_source = verdictSource;
      registerEvent(id, 'NOG_DECISION', rejectedDecision);

      // Append round entry to PARKED file before handleNogReturn rewrites it.
      const romTelemetryReturn = extractRomTelemetry(doneReportContents);
      appendRoundEntry(resolvedParkedPath, {
        round,
        attempt_number: computeNextAttemptNumber(resolvedParkedPath, round),
        commissioned_at: romTelemetryReturn.commissioned_at,
        done_at: romTelemetryReturn.done_at,
        durationMs: romTelemetryReturn.durationMs,
        tokensIn: romTelemetryReturn.tokensIn,
        tokensOut: romTelemetryReturn.tokensOut,
        costUsd: romTelemetryReturn.costUsd,
        nog_verdict: 'NOG_DECISION_REJECTED',
        nog_reason: summary || 'Nog review findings — see slice file',
      });

      // ── MAX_ROUNDS guard (REJECTED path) ────────────────────────────────
      // If this was round MAX_ROUNDS, re-dispatch would be round 6 — terminal.
      if (round >= MAX_ROUNDS) {
        // Clean up NOG.md verdict file before terminal transition.
        try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.return`)); } catch (_) {}

        registerEvent(id, 'MAX_ROUNDS_EXHAUSTED', {
          round,
          reason: 'Rom exhausted 5 rounds without Nog sign-off',
        });

        const stuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
        try {
          fs.renameSync(donePath, stuckPath);
          log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK', reason: 'max_rounds_rejected' });
        } catch (renameErr) {
          log('warn', 'nog', { id, msg: 'Failed to rename to STUCK', error: renameErr.message });
        }

        try { cleanupWorktree(id, branchName); } catch (_) {}
        updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

        print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} MAX_ROUNDS_EXHAUSTED${SYM.sep}Slice ${id} rejected at round ${round} — terminal`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }
      // ────────────────────────────────────────────────────────────────────

      handleNogReturn(id, rootId, round, branchName, donePath, updatedSliceContent, summary || 'Nog review findings — see slice file', durationMs);

      // Clean up NOG.md verdict file.
      try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.return`)); } catch (_) {}

      print(`${B.vert}    ${C.yellow}${SYM.cross}${C.reset} Nog RETURN${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
      print(`${B.vert}    Apendment queued for O'Brien`);
      print(`${B.bl}${B.sng.repeat(W - 1)}`);
      print('');

      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_slice = null;
      heartbeatState.current_slice_goal = null;
      heartbeatState.pickupTime = null;
      heartbeatState.processed_total += 1;
      writeHeartbeat();
    }
  );

}

/**
 * handleNogReturn(id, rootId, round, branchName, evaluatingPath, sliceContent, summary, durationMs)
 *
 * RETURN verdict from Nog: rewrite the existing slice file in-place with an
 * "Apendment round N" section and rename back to QUEUED. The slice keeps its
 * original ID — no new slice is created.
 */
function handleNogReturn(id, rootId, round, branchName, evaluatingPath, sliceContent, summary, durationMs, notBefore) {
  // Derive branch from rootId when DONE report didn't include one.
  if (!branchName) {
    branchName = `slice/${rootId}`;
    log('warn', 'nog', { id, msg: `No branch in DONE report — deriving from rootId: ${branchName}` });
  }

  // Read the PARKED file (contains original slice + Nog reviews).
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyParkedPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  const resolvedParked = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
  let parkedContent;
  try {
    parkedContent = fs.readFileSync(resolvedParked, 'utf-8');
  } catch (_) {
    parkedContent = sliceContent;
  }

  // Update frontmatter: set status=QUEUED, round, apendment_cycle, apendment, branch.
  // `not_before` (slice 372) is the retry backoff: the dispatch loop holds the
  // slice until that time. Always written — an empty value clears a stale stamp
  // from a previous round, so a normal Nog return dispatches immediately.
  let updatedContent = updateFrontmatter(parkedContent, {
    status: 'QUEUED',
    round: String(round),
    apendment_cycle: String(round),
    apendment: branchName,
    branch: branchName,
    not_before: notBefore ? String(notBefore) : 'null',
  });

  // Append the apendment round section to the body.
  updatedContent += [
    '',
    `## Apendment round ${round}`,
    '',
    `This is a Nog code review return for slice ${rootId} (round ${round} of 5).`,
    '',
    '**IMPORTANT: The orchestrator handles all git branching. Do NOT run any git checkout, git branch, or git switch commands. You are already on the correct branch. Just make your changes and commit.**',
    '',
    '### Nog review summary',
    '',
    summary,
    '',
    '### Instructions',
    '',
    'Read the Nog review section appended to the slice file for detailed findings.',
    'Fix all issues identified by Nog, then write your DONE report.',
    '',
    '### Success criteria',
    '',
    '1. All Nog findings from the latest round are addressed.',
    `2. All original acceptance criteria from slice ${rootId} are met.`,
    '3. DONE report includes branch name in frontmatter.',
    '',
  ].join('\n');

  // Write updated content back to QUEUED file (same ID).
  const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
  try {
    fs.writeFileSync(queuedPath, updatedContent);
    log('info', 'nog', { id, msg: `Rewrote slice ${id} as ${id}-QUEUED.md (apendment round ${round})`, round, rootId });
  } catch (err) {
    log('warn', 'nog', { id, msg: 'Failed to write apendment QUEUED', error: err.message });
  }

  // Remove the EVALUATING file (the old DONE renamed by poll loop).
  try { fs.unlinkSync(evaluatingPath); } catch (_) {}
}

// ---------------------------------------------------------------------------
// ERROR file (written by orchestrator on invocation failure or invalid slice)
// ---------------------------------------------------------------------------

/**
 * writeErrorFile(errorPath, id, reason, err, stdout, stderr)
 *
 * Writes a structured ERROR report. The frontmatter always includes `reason`
 * so bridge.log and Chief O'Brien's tooling can distinguish failure modes:
 *   "timeout"             — process was killed after exceeding the timeout
 *   "crash"               — process exited non-zero; exit_code included
 *   "no_report"           — process exited 0 but wrote no DONE file
 *   "invalid_slice"   — QUEUED file failed frontmatter validation
 *
 * @param {string}      errorPath  Absolute path for the ERROR file.
 * @param {string}      id         Slice ID.
 * @param {string}      reason     One of the four reason strings above.
 * @param {Error|null}  err        The Error object (null for no_report/invalid).
 * @param {string}      stdout     Combined stdout captured from the process.
 * @param {string}      stderr     Combined stderr captured from the process.
 * @param {Object}      [extra]    Optional extra fields (e.g. { missingFields }).
 */
function writeErrorFile(errorPath, id, reason, err, stdout, stderr, extra) {
  const completed = new Date().toISOString();
  const exitCode  = err && err.code != null ? String(err.code) : null;
  const signal    = err && err.signal ? err.signal : null;

  const frontmatter = [
    '---',
    `id: "${id}"`,
    `title: "Slice ${id} — ${reason}"`,
    'from: orchestrator',
    'to: chiefobrien',
    'status: ERROR',
    `slice_id: "${id}"`,
    `completed: "${completed}"`,
    `reason: "${reason}"`,
  ];

  if (reason === 'crash' && exitCode !== null) {
    frontmatter.push(`exit_code: ${exitCode}`);
  }
  if (reason === 'inactivity_timeout') {
    if (extra && extra.lastActivitySecondsAgo != null) {
      frontmatter.push(`last_activity_seconds_ago: ${extra.lastActivitySecondsAgo}`);
    }
    if (extra && extra.inactivityLimitMinutes != null) {
      frontmatter.push(`inactivity_limit_minutes: ${extra.inactivityLimitMinutes}`);
    }
  }
  frontmatter.push('---');

  const truncate = (s, n) => (s && s.length > n ? '…' + s.slice(-n) : s || '(empty)');
  const stdoutBody = isRomSelfTerminated(reason) ? truncate(stdout, 500) : (stdout || '(empty)');
  const stderrBody = isRomSelfTerminated(reason) ? truncate(stderr, 500) : (stderr || '(empty)');

  const detail = reason === 'timeout'
    ? 'The process was killed after exceeding the configured timeout.'
    : reason === 'inactivity_timeout'
      ? `The process was killed after ${extra && extra.lastActivitySecondsAgo != null ? extra.lastActivitySecondsAgo : '?'}s of no stdout/stderr output (limit: ${extra && extra.inactivityLimitMinutes != null ? extra.inactivityLimitMinutes : '?'} min).`
      : reason === 'crash'
        ? `The process exited with a non-zero status (exit code ${exitCode ?? 'unknown'}).`
        : reason === 'rom_no_commits'
          ? `Rom wrote a DONE report but made no commits to slice/${id} — the branch is level with ${INTEGRATION_BRANCH}. The report is fabricated (likely hit a rate limit or crashed early). ${extra && extra.detail ? extra.detail : ''}`
          : reason === 'rom_no_product_change'
            ? `Rom committed to slice/${id}, but the branch changes no product file — the whole diff is bookkeeping (the DONE report, bridge/state, heartbeat, timesheet, trash). The work itself was not delivered. ${extra && extra.detail ? extra.detail : ''}`
            : reason === 'metrics_divergence'
              ? `Rom's claimed metrics diverged from the actual process metrics by >10×. ${extra && extra.detail ? extra.detail : ''}`
              : isRomSelfTerminated(reason)
                ? `The process exited cleanly but wrote no DONE file (${reason}).${extra && extra.rescue_path ? ' Worktree rescued to ' + extra.rescue_path + '.' : ''}`
                : `Slice frontmatter validation failed. Missing fields: ${(extra && extra.missingFields || []).join(', ')}.`;

  const content = [
    ...frontmatter,
    '',
    '## Failure reason',
    '',
    `**${reason}**`,
    '',
    detail,
    '',
    '## Invocation details',
    '',
    `- Exit code: ${exitCode ?? 'n/a'}`,
    `- Signal: ${signal ?? 'n/a'}`,
    `- Reason: ${reason}`,
    '',
    '## stderr',
    '',
    '```',
    stderrBody,
    '```',
    '',
    '## stdout',
    '',
    '```',
    stdoutBody,
    '```',
  ].join('\n');

  try {
    fs.writeFileSync(errorPath, content);
  } catch (writeErr) {
    log('error', 'error', { id, msg: 'Failed to write ERROR file', error: writeErr.message });
  }

  // Write structured JSON error record for the Ops Center API
  try {
    const errorsDir = path.resolve(__dirname, 'errors');
    if (!fs.existsSync(errorsDir)) fs.mkdirSync(errorsDir, { recursive: true });
    const lastOutput = ((stdout || '') + (stderr || '')).slice(-2000) || '';
    const jsonRecord = {
      ts: completed,
      slice_id: String(id),
      reason: reason,
      exitCode: exitCode != null ? Number(exitCode) : null,
      signal: signal || null,
      lastOutput,
      durationMs: (extra && extra.durationMs != null) ? extra.durationMs : null,
    };
    fs.writeFileSync(path.join(errorsDir, `${id}-ERROR.json`), JSON.stringify(jsonRecord, null, 2));
  } catch (_) {
    // Must never crash the orchestrator
  }

  // Clean up sibling state files (DONE, IN_PROGRESS, etc.) — best-effort
  try {
    archiveSiblingStateFiles(id, 'ERROR');
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Control file processing — return-to-stage and other UI-initiated actions
// ---------------------------------------------------------------------------

/**
 * findOriginalSliceBody(id)
 *
 * Recovers the original slice content for an ERROR sidecar. Checks:
 * 1. bridge/trash/{id}-IN_PROGRESS.md.cleanup-ERROR-* (most recent by mtime)
 * 2. bridge/trash/{id}-IN_PROGRESS.md.cleanup-* (most recent by mtime)
 * 3. Most recent COMMISSIONED register event with body field for this slice.
 * Returns { source: "trash"|"register", content: string } or null.
 */
function findOriginalSliceBody(id) {
  const sid = String(id);

  // 1. Try trash: cleanup-ERROR-* files first, then any cleanup-* files.
  const patterns = [
    new RegExp(`^${sid}-IN_PROGRESS\\.md\\.cleanup-ERROR-`),
    new RegExp(`^${sid}-IN_PROGRESS\\.md\\.cleanup-`),
  ];
  for (const pattern of patterns) {
    try {
      const matches = fs.readdirSync(TRASH_DIR)
        .filter(f => pattern.test(f))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(TRASH_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (matches.length > 0) {
        const content = fs.readFileSync(path.join(TRASH_DIR, matches[0].name), 'utf-8');
        if (content && content.trim()) {
          return { source: 'trash', content };
        }
      }
    } catch (_) {}
  }

  // 2. Fallback: COMMISSIONED event in register with body field.
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    let latestBody = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (String(entry.slice_id || entry.id || '') === sid && entry.event === 'COMMISSIONED' && entry.body) {
          latestBody = entry.body;
        }
      } catch (_) {}
    }
    if (latestBody) {
      return { source: 'register', content: latestBody };
    }
  } catch (_) {}

  return null;
}

/**
 * refuseReturnToStage(id, reason, state, extra)
 *
 * Every way this action can fail, funnelled through one place. Before slice 370
 * a refusal only reached bridge.log — the dashboard had already flashed success
 * at the operator by then. RETURN_TO_STAGE_REFUSED is the counterpart of
 * RETURN_TO_STAGE: whichever the orchestrator writes, the request that is
 * waiting on the register learns what actually happened.
 */
function refuseReturnToStage(id, reason, state, extra) {
  registerEvent(id, 'RETURN_TO_STAGE_REFUSED', Object.assign({ reason, state: state ?? null }, extra || {}));
  return { ok: false, error: reason, state: state ?? null };
}

/**
 * handleReturnToStage(sliceId)
 *
 * Validates the slice's state, emits RETURN_TO_STAGE, and moves the slice file
 * back into bridge/staged/ with status: STAGED.
 * Returns { ok, error } for the caller to log.
 *
 * The state rules live in bridge/return-to-stage-eligibility.js so the button
 * offers exactly what this function accepts (slice 370). In terminal-state
 * terms that is still ACCEPTED / STUCK / ERROR plus QUEUED / PENDING, and a
 * slice that is IN_PROGRESS, EVALUATING or IN_REVIEW is still refused — that
 * guard is load-bearing and is not relaxed here.
 */
function handleReturnToStage(sliceId) {
  const id = String(sliceId);

  const verdict = evaluateReturnToStage(id, { queueDir: QUEUE_DIR, stagedDir: STAGED_DIR });
  if (!verdict.eligible) {
    return refuseReturnToStage(id, verdict.reason, verdict.state);
  }

  // The state that let it through also names the event it is coming back from.
  const FROM_EVENT_BY_STATE = {
    ACCEPTED: 'ACCEPTED',
    STUCK:    'MAX_ROUNDS_EXHAUSTED',
    ERROR:    'ERROR',
    QUEUED:   'QUEUED',
    PENDING:  'PENDING',
  };
  // The verdict carries the file it was read from. Rebuilding the name against
  // QUEUE_DIR would be wrong the moment a returnable state turns up in staged/,
  // which the eligibility scan already looks at.
  const terminalPath = verdict.path || path.join(QUEUE_DIR, `${id}-${verdict.state}.md`);
  let fromEvent = FROM_EVENT_BY_STATE[verdict.state] || verdict.state;

  // Read the terminal file content.
  let content;
  try {
    content = fs.readFileSync(terminalPath, 'utf-8');
  } catch (err) {
    return refuseReturnToStage(id, `Failed to read terminal file for slice ${id}: ${err.message}`, verdict.state);
  }

  // Also check the register for the most recent terminal event (more accurate fromEvent).
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    const terminalEvents = ['MERGED', 'MAX_ROUNDS_EXHAUSTED', 'ESCALATED_TO_OBRIEN', 'ERROR', 'STUCK', 'NOG_ESCALATION'];
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.id === id && terminalEvents.includes(entry.event)) {
          fromEvent = entry.event;
          break;
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Detect ERROR sidecar: written by orchestrator, lacks required slice fields.
  const fm = parseFrontmatter(content) || {};
  const isErrorSidecar = fm.status === 'ERROR' && fm.from === 'orchestrator';

  let bodySource = 'none';
  let stagedContent = content;
  let nowIso = null;

  if (isErrorSidecar) {
    // ERROR sidecars lack required frontmatter + body — reconstruct from trash/register.
    const recovered = findOriginalSliceBody(id);
    if (!recovered) {
      // A refusal, not a return — so it must not be written as RETURN_TO_STAGE.
      // Anything watching the register for the outcome would read that as done.
      return refuseReturnToStage(
        id,
        `Slice ${id}: the ERROR file has no usable brief and no recoverable source was found in trash or the register. Nothing to return.`,
        verdict.state,
        { from_event: fromEvent, body_source: 'none' },
      );
    }

    // Validate recovered content has all required frontmatter fields.
    const recoveredFm = parseFrontmatter(recovered.content) || {};
    const requiredFields = ['id', 'title', 'goal', 'from', 'to', 'priority', 'created'];
    const missing = requiredFields.filter(f => !recoveredFm[f]);
    if (missing.length > 0) {
      return refuseReturnToStage(
        id,
        `Slice ${id}: the brief recovered from ${recovered.source} is missing required fields (${missing.join(', ')}). Nothing usable to return.`,
        verdict.state,
        { from_event: fromEvent, body_source: recovered.source },
      );
    }

    // Inject Return-to-Stage notice at the top of the body.
    nowIso = new Date().toISOString();
    const notice = `## Return-to-Stage notice (${nowIso})\n\nThis slice was returned to STAGED via the Ops button after a prior failure.\nPrior attempt's ERROR file archived to \`bridge/trash/${id}-ERROR.md.return-to-stage-${nowIso.replace(/[:.]/g, '-')}\`.\nSee register events for the full failure history.\n`;

    // Split recovered content into frontmatter + body, inject notice.
    const fmMatch = recovered.content.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/);
    if (fmMatch) {
      stagedContent = fmMatch[1] + '\n\n' + notice + '\n' + fmMatch[2];
    } else {
      stagedContent = recovered.content + '\n\n' + notice;
    }

    bodySource = recovered.source;
  }

  // Emit RETURN_TO_STAGE register event.
  registerEvent(id, 'RETURN_TO_STAGE', {
    from_event: fromEvent,
    reason: 'manual',
    body_source: bodySource,
  });

  // Update frontmatter status to STAGED and move to staged dir.
  const updatedContent = updateFrontmatter(stagedContent, { status: 'STAGED' });
  const stagedPath = path.join(STAGED_DIR, `${id}-STAGED.md`);
  try {
    // Archive terminal file to trash (with return-to-stage suffix for ERROR sidecars).
    if (isErrorSidecar) {
      const archiveName = `${id}-ERROR.md.return-to-stage-${nowIso.replace(/[:.]/g, '-')}`;
      fs.renameSync(terminalPath, path.join(TRASH_DIR, archiveName));
    }
    fs.writeFileSync(stagedPath, updatedContent);
    if (!isErrorSidecar) {
      fs.unlinkSync(terminalPath);
    }
    log('info', 'control', { id, from: fromEvent, to: 'STAGED', msg: `Return-to-stage: moved slice ${id} from ${fromEvent} to STAGED`, body_source: bodySource });
  } catch (err) {
    return refuseReturnToStage(id, `Slice ${id} could not be moved to staged: ${err.message}`, verdict.state, { from_event: fromEvent });
  }

  print(`  ${C.cyan}${SYM.back}${C.reset} Return-to-stage${SYM.sep}Slice ${id} (was ${fromEvent})${SYM.arrow}STAGED`);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pause / Resume / Abort helpers
// ---------------------------------------------------------------------------

/**
 * getLatestRegisterEvent(sliceId)
 *
 * Returns the latest register event for a given slice ID, or null.
 */
function getLatestRegisterEvent(sliceId) {
  const id = String(sliceId);
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if ((entry.slice_id || entry.id) === id) return entry;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * getLatestLifecycleEvent(sliceId)
 *
 * Returns the latest *lifecycle* register event for a slice, skipping control-request
 * events (PAUSE_REQUESTED, RESUME_REQUESTED, ABORT_REQUESTED, and any other _REQUESTED
 * variants). This prevents dashboard-emitted request events from poisoning precondition
 * checks in handlePause/handleResume/handleAbort.
 */
function getLatestLifecycleEvent(sliceId) {
  const id = String(sliceId);
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if ((entry.slice_id || entry.id) === id && !entry.event.endsWith('_REQUESTED')) return entry;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * getRoundFromRegister(sliceId)
 *
 * Derives the current round for a slice from COMMISSIONED events in the register.
 */
function getRoundFromRegister(sliceId) {
  const id = String(sliceId);
  let count = 0;
  let lastRound = null;
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id === id && entry.event === 'COMMISSIONED') {
          count++;
          if (entry.round != null) lastRound = parseInt(entry.round, 10);
        }
      } catch (_) {}
    }
  } catch (_) {}
  return lastRound || count || 1;
}

/**
 * handlePause(sliceId) — SIGSTOP the Rom subprocess for a slice.
 */
function handlePause(sliceId) {
  const id = String(sliceId);

  // Precondition: slice must be IN_PROGRESS with a live child.
  if (!fs.existsSync(path.join(QUEUE_DIR, `${id}-IN_PROGRESS.md`))) {
    return { ok: false, error: `Slice ${id} is not IN_PROGRESS — cannot pause` };
  }

  const entry = activeChildren.get(id);
  if (!entry || !entry.child || entry.child.exitCode !== null) {
    return { ok: false, error: `Slice ${id} has no live Rom subprocess — cannot pause` };
  }

  // Check latest lifecycle event — must be a live-Rom state, not already paused or terminal.
  const latest = getLatestLifecycleEvent(id);
  if (latest && latest.event === 'ROM_PAUSED') {
    return { ok: false, error: `Slice ${id} is already paused` };
  }
  const liveStates = ['COMMISSIONED', 'ROM_STARTED', 'ROM_RESUMED'];
  if (!latest || !liveStates.includes(latest.event)) {
    return { ok: false, error: `Slice ${id} is not in a pausable state (latest lifecycle: ${latest ? latest.event : 'none'})` };
  }

  try {
    process.kill(entry.child.pid, 'SIGSTOP');
  } catch (err) {
    return { ok: false, error: `Failed to SIGSTOP slice ${id}: ${err.message}` };
  }

  const round = getRoundFromRegister(id);
  registerEvent(id, 'ROM_PAUSED', { round });
  log('info', 'control', { id, msg: `Paused Rom subprocess (PID ${entry.child.pid})`, round });
  print(`  ${C.cyan}${SYM.back}${C.reset} Pause${SYM.sep}Slice ${id} paused (round ${round})`);

  return { ok: true };
}

/**
 * handleResume(sliceId) — SIGCONT the Rom subprocess for a slice.
 */
function handleResume(sliceId) {
  const id = String(sliceId);

  // Precondition: latest *lifecycle* event must be ROM_PAUSED.
  // Uses getLatestLifecycleEvent to skip dashboard-emitted _REQUESTED events
  // that would otherwise poison this check (e.g. RESUME_REQUESTED after ROM_PAUSED).
  const latest = getLatestLifecycleEvent(id);
  if (!latest || latest.event !== 'ROM_PAUSED') {
    return { ok: false, error: `Slice ${id} is not paused — cannot resume` };
  }

  const entry = activeChildren.get(id);
  if (!entry || !entry.child || entry.child.exitCode !== null) {
    return { ok: false, error: `Slice ${id} has no live Rom subprocess — cannot resume (child may have died while paused)` };
  }

  try {
    process.kill(entry.child.pid, 'SIGCONT');
  } catch (err) {
    return { ok: false, error: `Failed to SIGCONT slice ${id}: ${err.message}` };
  }

  const round = getRoundFromRegister(id);
  registerEvent(id, 'ROM_RESUMED', { round });
  log('info', 'control', { id, msg: `Resumed Rom subprocess (PID ${entry.child.pid})`, round });
  print(`  ${C.cyan}${SYM.back}${C.reset} Resume${SYM.sep}Slice ${id} resumed (round ${round})`);

  return { ok: true };
}

/**
 * handleAbort(sliceId) — SIGKILL the Rom subprocess, clean up, return to STAGED.
 */
function handleAbort(sliceId) {
  const id = String(sliceId);

  // Precondition: slice must be IN_PROGRESS (active or paused).
  const inProgressPath = path.join(QUEUE_DIR, `${id}-IN_PROGRESS.md`);
  if (!fs.existsSync(inProgressPath)) {
    return { ok: false, error: `Slice ${id} is not IN_PROGRESS — cannot abort` };
  }

  const entry = activeChildren.get(id);
  if (entry && entry.child && entry.child.exitCode === null) {
    // If paused, resume first so SIGKILL is delivered immediately.
    const latest = getLatestLifecycleEvent(id);
    if (latest && latest.event === 'ROM_PAUSED') {
      try { process.kill(entry.child.pid, 'SIGCONT'); } catch (_) {}
    }
    try {
      process.kill(entry.child.pid, 'SIGKILL');
    } catch (err) {
      log('warn', 'control', { id, msg: `Failed to SIGKILL Rom subprocess: ${err.message}` });
    }
  }

  // Clean up worktree.
  const worktreePath = entry ? entry.worktreePath : getWorktreePath(id);
  try {
    cleanupWorktree(id, `slice/${id}`);
  } catch (err) {
    log('warn', 'control', { id, msg: `Worktree cleanup failed during abort: ${err.message}` });
  }

  // Move slice back to STAGED.
  let content;
  try {
    content = fs.readFileSync(inProgressPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to read IN_PROGRESS file for slice ${id}: ${err.message}` };
  }

  const updatedContent = updateFrontmatter(content, { status: 'STAGED' });
  const stagedPath = path.join(STAGED_DIR, `${id}-STAGED.md`);
  try {
    fs.writeFileSync(stagedPath, updatedContent);
    fs.unlinkSync(inProgressPath);
  } catch (err) {
    return { ok: false, error: `Failed to move slice ${id} to staged: ${err.message}` };
  }

  // Remove from active children and reset processing.
  activeChildren.delete(id);
  processing = false;
  heartbeatState.status = 'idle';
  heartbeatState.current_slice = null;
  heartbeatState.current_slice_title = null;
  heartbeatState.current_slice_goal = null;
  heartbeatState.pickupTime = null;
  writeHeartbeat();

  const round = getRoundFromRegister(id);
  registerEvent(id, 'ROM_ABORTED', { round, reason: 'manual' });
  log('info', 'control', { id, msg: `Aborted Rom subprocess — slice returned to STAGED`, round });
  print(`  ${C.cyan}${SYM.back}${C.reset} Abort${SYM.sep}Slice ${id} aborted (round ${round})${SYM.arrow}STAGED`);

  return { ok: true };
}

/**
 * processControlFiles()
 *
 * Scans bridge/control/ for JSON control files and processes each action.
 * Control files are consumed (moved to trash) after processing.
 * Called at the start of each poll cycle.
 */
function processControlFiles() {
  let files;
  try {
    files = fs.readdirSync(CONTROL_DIR).filter(f => f.endsWith('.json'));
  } catch (_) {
    return;
  }

  for (const file of files) {
    const filePath = path.join(CONTROL_DIR, file);
    let request;
    try {
      request = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      log('warn', 'control', { file, msg: 'Malformed control file — skipping', error: err.message });
      try { fs.renameSync(filePath, path.join(TRASH_DIR, file + '.malformed')); } catch (_) {}
      continue;
    }

    const action = request.action;
    const sliceId = request.slice_id;

    if (!action || !sliceId) {
      log('warn', 'control', { file, msg: 'Control file missing action or slice_id', request });
      try { fs.renameSync(filePath, path.join(TRASH_DIR, file + '.invalid')); } catch (_) {}
      continue;
    }

    let result;
    if (action === 'return_to_stage') {
      result = handleReturnToStage(sliceId);
    } else if (action === 'pause') {
      result = handlePause(sliceId);
    } else if (action === 'resume') {
      result = handleResume(sliceId);
    } else if (action === 'abort') {
      result = handleAbort(sliceId);
    } else {
      log('warn', 'control', { file, msg: `Unknown control action: ${action}`, action, sliceId });
      result = null;
    }

    if (result && !result.ok) {
      log('warn', 'control', { file, action, sliceId, msg: result.error });
    } else if (result) {
      log('info', 'control', { file, action, sliceId, msg: `${action} completed` });
    }

    // Consume the control file regardless of success/failure.
    try { fs.renameSync(filePath, path.join(TRASH_DIR, file + '.processed')); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Adaptive poll scheduler
// ---------------------------------------------------------------------------

let _pollTimer = null;

function schedulePoll() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(poll, currentPollMs);
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

function poll() {
  // Always process control files — pause/resume/abort must work even while processing.
  processControlFiles();

  if (processing) return;

  // Cycle-start sweep: prune orphan locks and worktree dirs before dispatch.
  // Returns false when STALE_LOCK_DETECTED — skip dispatch to avoid hitting the same lock.
  try {
    const shouldDispatch = gitFinalizer.sweepStaleResources();
    if (shouldDispatch === false) {
      log('info', 'sweep', { msg: 'sweepStaleResources signalled skip-dispatch (STALE_LOCK_DETECTED)' });
      return;
    }
  } catch (err) {
    log('warn', 'sweep', { msg: 'sweepStaleResources threw — skipping dispatch this tick', error: err.message });
    return;
  }

  // Rate limit gate: pause dispatch until the API limit resets.
  if (rateLimitUntil) {
    const remaining = rateLimitUntil - Date.now();
    if (remaining > 0) {
      // Print a reminder every ~5 minutes (60 poll cycles at 5s).
      idlePrintCounter += 1;
      if (idlePrintCounter >= 60) {
        idlePrintCounter = 0;
        print(`  ${C.yellow}⏸${C.reset}  Rate limited — ${Math.ceil(remaining / 60000)} min remaining until dispatch resumes`);
      }
      return;
    }
    // Limit has lifted.
    rateLimitUntil = null;
    print(`  ${C.green}${SYM.check}${C.reset} Rate limit window passed — resuming dispatch`);
  }

  // Pipeline-paused guard (W1): skip dispatch if .pipeline-paused flag exists.
  if (fs.existsSync(PIPELINE_PAUSED_FILE)) {
    try {
      const pausePayload = JSON.parse(fs.readFileSync(PIPELINE_PAUSED_FILE, 'utf-8'));
      log('warn', 'dispatch', { msg: 'Pipeline paused — skipping dispatch', reason: pausePayload.reason || 'unknown', event: pausePayload.event });
    } catch (_) {
      log('warn', 'dispatch', { msg: 'Pipeline paused — skipping dispatch (could not read flag file)' });
    }
    return;
  }

  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch (err) {
    log('error', 'error', { msg: 'Failed to read queue directory', error: err.message });
    return;
  }

  // Scan both DONE and QUEUED/PENDING up front so counts are available for logging.
  const canonicalFiles = files.filter(f => CANONICAL_SUFFIX_RE.test(f));
  const doneFiles = canonicalFiles.filter(f => f.endsWith('-DONE.md')).sort();

  // FIFO dispatch via queue-order.json head consumption (slice 292).
  // queue-order.json is the single source of truth for dispatch order.
  // The dispatcher takes the first ID, not a sorted set.
  const QUEUE_ORDER_FILE = path.join(__dirname, 'queue-order.json');

  // Build a set of IDs that actually have QUEUED files on disk.
  const queuedFileMap = {};  // id → filename
  for (const f of canonicalFiles) {
    if (f.endsWith('-QUEUED.md') || f.endsWith('-PENDING.md')) {
      const fId = f.replace(/-(?:QUEUED|PENDING)\.md$/, '');
      queuedFileMap[fId] = f;
    }
  }

  let queueOrder = null;
  let queueOrderDirty = false;
  try {
    const raw = JSON.parse(fs.readFileSync(QUEUE_ORDER_FILE, 'utf-8'));
    if (Array.isArray(raw) && raw.length > 0) queueOrder = raw.map(String);
  } catch (_) { /* absent or malformed — will attempt recovery below */ }

  // Recovery: if queue-order.json is missing/empty but QUEUED files exist,
  // reconstruct from file mtimes ascending (oldest first).
  if (!queueOrder && Object.keys(queuedFileMap).length > 0) {
    const entries = Object.entries(queuedFileMap).map(([fId, fname]) => {
      let mtime = 0;
      try { mtime = fs.statSync(path.join(QUEUE_DIR, fname)).mtimeMs; } catch (_) {}
      return { id: fId, mtime };
    });
    entries.sort((a, b) => a.mtime - b.mtime);
    queueOrder = entries.map(e => e.id);
    // Persist the recovered order atomically.
    const tmpPath = QUEUE_ORDER_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(queueOrder, null, 2) + '\n');
    fs.renameSync(tmpPath, QUEUE_ORDER_FILE);
    log('info', 'dispatch', { msg: 'Recovered queue-order.json from QUEUED file mtimes', order: queueOrder });
  }

  // Build pendingFiles in FIFO order from queue-order.json head.
  // Stale IDs (no matching QUEUED file) are removed.
  const pendingFiles = [];
  if (queueOrder) {
    const cleanedOrder = [];
    for (const oid of queueOrder) {
      if (queuedFileMap[oid]) {
        cleanedOrder.push(oid);
        pendingFiles.push(queuedFileMap[oid]);
      } else {
        // Stale ID — no matching QUEUED file on disk.
        queueOrderDirty = true;
        log('info', 'dispatch', { msg: `Stale ID "${oid}" removed from queue-order.json (no QUEUED file)` });
      }
    }
    // Append any QUEUED files not in queue-order.json (shouldn't happen, but safety).
    for (const [fId, fname] of Object.entries(queuedFileMap)) {
      if (!cleanedOrder.includes(fId)) {
        cleanedOrder.push(fId);
        pendingFiles.push(fname);
        queueOrderDirty = true;
      }
    }
    // Persist cleaned order if stale entries were removed.
    if (queueOrderDirty) {
      const tmpPath = QUEUE_ORDER_FILE + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(cleanedOrder, null, 2) + '\n');
      fs.renameSync(tmpPath, QUEUE_ORDER_FILE);
    }
  }

  // Reset adaptive idle on any activity (DONE or QUEUED files present).
  if (doneFiles.length > 0 || pendingFiles.length > 0) {
    if (consecutiveIdleTicks >= IDLE_THRESHOLD) {
      currentPollMs = config.pollIntervalMs;
      schedulePoll();
      log('info', 'poll', { msg: `Adaptive idle reset: poll interval → ${currentPollMs}ms` });
    }
    consecutiveIdleTicks = 0;
  }

  // === Priority 1: Evaluate completed DONE files first ===
  // This ensures each build merges to main BEFORE the next build starts,
  // preventing branch divergence when multiple slices are approved in a burst.
  for (const doneFile of doneFiles) {
    const doneId = doneFile.replace('-DONE.md', '');
    const donePath = path.join(QUEUE_DIR, doneFile);
    const parkedPath = path.join(QUEUE_DIR, `${doneId}-PARKED.md`);
    const legacyParkedPath = path.join(QUEUE_DIR, `${doneId}-ARCHIVED.md`);

    // Skip if PARKED file not present (Rom may still be running — park not yet written).
    if (!fs.existsSync(parkedPath)) {
      if (fs.existsSync(legacyParkedPath)) {
        log('warn', 'state', { id: doneId, msg: 'Legacy ARCHIVED suffix found — pre-slice-145 file' });
        continue;
      } else {
        continue;
      }
    }

    // Legacy: merge slices (type: merge) are auto-accepted without claude -p.
    // Deprecated: handleAccepted() now merges directly — no new merge slices
    // are generated. This block handles any legacy merge slices still in the queue.
    let sliceMeta = {};
    try {
      const resolvedPath = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
      sliceMeta = parseFrontmatter(fs.readFileSync(resolvedPath, 'utf-8')) || {};
    } catch (_) {}

    if (sliceMeta.type === 'merge') {
      log('info', 'evaluator', { id: doneId, msg: 'Legacy merge slice auto-accepted (deprecated path)' });
      const acceptedPath = path.join(QUEUE_DIR, `${doneId}-ACCEPTED.md`);
      try { fs.renameSync(donePath, acceptedPath); } catch (_) {}
      // Canonical: NOG_DECISION (auto-accepted merge)
      registerEvent(doneId, 'NOG_DECISION', { verdict: 'ACCEPTED', reason: 'auto-accepted merge', cycle: 0, round: 0 });
      print(`  ${C.green}${SYM.check}${C.reset} Slice ${doneId}${SYM.dash}Merge auto-accepted`);
      continue;
    }

    // Skip if the current attempt has already been accepted + merged. Rejected verdicts are NOT terminal — Rom reworks and the next DONE must re-dispatch.
    if (hasReviewEvent(doneId)) continue;

    // Rom slice-broken fast path (BR invariant #9):
    // If Rom's DONE report contains "## Rom Escalation — Slice Broken",
    // route directly to STAGED for O'Brien rework — skip Nog entirely.
    try {
      const doneContent = fs.readFileSync(donePath, 'utf-8');
      if (/^## Rom Escalation — Slice Broken\s*$/m.test(doneContent)) {
        fs.renameSync(donePath, path.join(STAGED_DIR, `${doneId}-STAGED.md`));
        registerEvent(doneId, 'ROM_ESCALATE', { reason: 'slice-broken fast path' });
        log('info', 'state', { id: doneId, from: 'DONE', to: 'STAGED', reason: 'rom_escalate' });
        continue;
      }
    } catch (err) {
      log('warn', 'evaluator', { id: doneId, msg: 'Failed to read DONE file for Rom escalation check', error: err.message });
    }

    // Rename DONE → EVALUATING to claim it.
    const evaluatingPath = path.join(QUEUE_DIR, `${doneId}-EVALUATING.md`);
    try {
      fs.renameSync(donePath, evaluatingPath);
      log('info', 'state', { id: doneId, from: 'DONE', to: 'EVALUATING' });
    } catch (err) {
      log('warn', 'evaluator', { id: doneId, msg: 'Failed to rename DONE to EVALUATING', error: err.message });
      continue;
    }

    if (pendingFiles.length > 0) {
      log('info', 'evaluator', { id: doneId, msg: `Evaluating DONE before ${pendingFiles.length} pending — merge-first priority` });
      print(`${B.vert}  ${C.yellow}⚡${C.reset} ${pendingFiles.length} pending held — evaluating #${doneId} first (merge-first priority)`);
    }

    processing = true;
    heartbeatState.current_slice = doneId;
    heartbeatState.current_slice_goal = sliceMeta.goal || null;
    heartbeatState.pickupTime = Date.now();

    // Route: single Nog pass covers code review + ACs + intent + scope.
    const resolvedParked = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
    let waitRound = 1;
    try {
      const parkedContent = fs.readFileSync(resolvedParked, 'utf-8');
      const nogRounds = (parkedContent.match(/^## Nog Review — Round \d+/gm) || []).length;
      waitRound = nogRounds + 1;
    } catch (_) {}
    registerEvent(doneId, 'NOG_INVOKED', { round: waitRound });

    heartbeatState.status = 'nog_review';
    writeHeartbeat();
    invokeNog(doneId);
    return;
  }

  // === Priority 2: Commission next QUEUED slice (only if no DONE files to evaluate) ===
  if (pendingFiles.length === 0) {
    // ALL_COMPLETE check: pipeline is idle after processing at least one slice this session.
    const hasInProgress = files.some(f => f.endsWith('-IN_PROGRESS.md'));
    if (sessionHasProcessed && !hasInProgress) {
      appendOperationalEvent({
        event: 'ALL_COMPLETE',
        slice_id: null,
        root_id: null,
        cycle: null,
        branch: null,
        details: 'All active slices are terminal. Pipeline idle.',
      });
      sessionHasProcessed = false;
    }

    idlePrintCounter += 1;
    if (idlePrintCounter >= 12) {
      idlePrintCounter = 0;
      const snap = getQueueSnapshot(QUEUE_DIR);
      const ts = timestampNow();
      print(`  ${C.dim}·${C.reset}  Queue: ${snap.waiting} waiting${SYM.sep}${snap.in_progress} in progress${SYM.sep}${snap.completed} done${SYM.sep}${snap.failed} failed  [${ts}]`);
    }
    // Adaptive idle: increase poll interval after sustained inactivity.
    consecutiveIdleTicks++;
    if (consecutiveIdleTicks === IDLE_THRESHOLD && currentPollMs !== IDLE_POLL_MS) {
      currentPollMs = IDLE_POLL_MS;
      schedulePoll();
      log('info', 'poll', { msg: `Adaptive idle: poll interval → ${IDLE_POLL_MS}ms after ${IDLE_THRESHOLD} idle ticks` });
    }
    return;
  }

  // Dependency gate: skip slices whose depends_on IDs haven't all merged yet.
  let pendingFile = null;
  for (const candidate of pendingFiles) {
    const candPath = path.join(QUEUE_DIR, candidate);
    const candId = candidate.replace(/-(?:QUEUED|PENDING)\.md$/, '');

    // Finished-slice gate: never act on a slice that has already landed.
    //
    // Slice 366 was reviewed, squashed and archived at 16:11:51 and re-dispatched
    // at 16:13:58 from a QUEUED file left behind by the archival. The re-run
    // crashed, and its ERROR overwrote the slice's real outcome — a merged slice
    // displayed as failed. A leftover queue file is debris, not an instruction:
    // clear it and say so.
    const landedEvent = hasTerminalLandedEvent(candId);
    if (landedEvent) {
      const cleared = path.join(TRASH_DIR, path.basename(candPath) + '.stale-after-' + landedEvent);
      let clearError = null;
      try { fs.renameSync(candPath, cleared); } catch (err) { clearError = err.message; }
      const clearedOk = clearError === null;

      // A failed clear leaves the file QUEUED, so the next poll refuses it again —
      // the same unbounded-event shape the retry cap forty lines below exists to
      // stop. Announce it once per slice per process, the way SLICE_DISPATCH_DEFERRED
      // does, and raise the level: a stale file that cannot be cleared is an
      // operator problem, not routine bookkeeping.
      const firstRefusal = !_refusalEmitted.has(candId);
      _refusalEmitted.add(candId);

      if (firstRefusal) {
        log(clearedOk ? 'warn' : 'error', 'dispatch', {
          id: candId,
          msg: clearedOk
            ? `Refused to dispatch slice ${candId} — already ${landedEvent}; cleared stale queue file`
            : `Refused to dispatch slice ${candId} — already ${landedEvent}; stale queue file COULD NOT be cleared, remove ${candidate} by hand`,
          reason: 'already_landed',
          terminal_event: landedEvent,
          file: candidate,
          cleared: clearedOk,
          clear_error: clearError,
        });
        registerEvent(candId, 'SLICE_DISPATCH_REFUSED', {
          reason: 'already_landed',
          terminal_event: landedEvent,
          file: candidate,
          cleared: clearedOk,
          clear_error: clearError,
        });
        print(clearedOk
          ? `  ${C.yellow}${SYM.cross}${C.reset}  Slice ${candId}${SYM.dash}already ${landedEvent}; stale queue file cleared, not re-dispatched`
          : `  ${C.red}${SYM.cross}${C.reset}  Slice ${candId}${SYM.dash}already ${landedEvent}; stale queue file could NOT be cleared — remove ${candidate} by hand`);
      }
      continue;
    }

    // Retry backoff: an unreadable-verdict re-queue carries a not_before stamp so
    // the retry waits instead of spinning. Not yet due — leave it for a later tick.
    if (!retryBackoffElapsed(candPath, candId)) continue;

    try {
      const candMeta = parseFrontmatter(fs.readFileSync(candPath, 'utf-8'));
      if (!depsAreMet(candMeta)) {
        const unmet = String(candMeta.depends_on).split(',').map(s => s.trim()).filter(s => s && !hasMergedEvent(s));
        print(`  ${C.yellow}\u23F8${C.reset}  Slice ${candId}${SYM.dash}blocked on #${unmet.join(', #')} (not yet merged)`);
        // Emit SLICE_DISPATCH_DEFERRED once per slice per process lifetime.
        if (!_deferredEmitted.has(candId)) {
          _deferredEmitted.add(candId);
          registerEvent(candId, 'SLICE_DISPATCH_DEFERRED', { deps_unmet: unmet });
        }
        continue;
      }
    } catch (_) { /* unreadable — let downstream validation handle it */ }
    pendingFile = candidate;
    break;
  }
  if (!pendingFile) return;
  const pendingPath = path.join(QUEUE_DIR, pendingFile);

  // Derive the slice ID from the filename (e.g. "003-QUEUED.md" → "003").
  const id = pendingFile.replace(/-(?:QUEUED|PENDING)\.md$/, '');

  // Read slice content.
  let sliceContent;
  try {
    sliceContent = fs.readFileSync(pendingPath, 'utf-8');
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to read QUEUED file', error: err.message });
    return;
  }

  // Parse frontmatter for timeout_min override and title.
  const meta = parseFrontmatter(sliceContent);
  const timeoutMin = meta && meta.timeout_min && meta.timeout_min !== 'null'
    ? parseInt(meta.timeout_min, 10)
    : null;
  // timeout_min now means "minutes of inactivity before kill" (overrides inactivityTimeoutMs).
  const effectiveInactivityMs = timeoutMin != null && !isNaN(timeoutMin)
    ? timeoutMin * 60 * 1000
    : config.inactivityTimeoutMs;
  const title = (meta && meta.title) || null;
  const goal  = (meta && meta.goal && meta.goal.trim()) || null;

  // ── Approval provenance gate (slice 354) ─────────────────────────────────
  // Advisory by default — logged and flagged, dispatch proceeds — behind the
  // same kind of env flag as AC_CUSTODY_ENFORCE. Philipp flips
  // APPROVAL_PROVENANCE_ENFORCE=1 once the queue is clean.
  const provVerdict = checkDispatchProvenance(id, meta, pendingPath);
  if (!provVerdict.ok) {
    if (approvalProvenance.isEnforcing()) {
      parkUnprovenancedSlice(id, pendingPath, provVerdict);
      return; // Continue poll loop on the next tick.
    }
    registerEvent(id, 'APPROVAL_UNVERIFIED', { reason: provVerdict.reason, enforced: false });
    log('warn', 'dispatch', {
      id,
      msg: `Slice ${id} has no valid approval provenance (${provVerdict.reason}) — dispatching anyway (advisory mode)`,
      reason: provVerdict.reason,
    });
  }

  // Derive sibling paths.
  const inProgressPath = path.join(QUEUE_DIR, `${id}-IN_PROGRESS.md`);
  const donePath       = path.join(QUEUE_DIR, `${id}-DONE.md`);
  const errorPath      = path.join(QUEUE_DIR, `${id}-ERROR.md`);

  // ---------------------------------------------------------------------------
  // Validation on intake
  //
  // Before renaming to IN_PROGRESS, check that all required frontmatter fields
  // are present and non-empty. Required: id, title, from, to, priority, created.
  //
  // If validation fails:
  //   - Do NOT rename to IN_PROGRESS (file stays as QUEUED/PENDING for inspection)
  //   - Write an ERROR report immediately
  //   - Log with reason "invalid_slice"
  //   - Remove the QUEUED/PENDING file so the poll loop doesn't re-process it forever
  //   - Continue the poll loop (do not crash)
  // ---------------------------------------------------------------------------
  const { missingFields } = validateIntakeMeta(meta);

  if (missingFields.length > 0) {
    const errId   = (meta && meta.id) || id;
    const errPath = path.join(QUEUE_DIR, `${errId}-ERROR.md`);

    log('error', 'error', {
      id: errId,
      msg: 'Slice rejected — missing required frontmatter fields',
      reason: 'invalid_slice',
      missing_fields: missingFields,
      file: pendingFile,
    });

    // Stakeholder-friendly terminal output for rejected slices.
    print(`  ${C.red}${SYM.cross}${C.reset} Slice ${errId} rejected${SYM.dash}Missing required fields: ${missingFields.join(', ')}`);

    writeErrorFile(errPath, errId, 'invalid_slice', null, '', '', { missingFields });
    log('info', 'state', { id: errId, from: 'QUEUED', to: 'ERROR', reason: 'invalid_slice' });
    registerEvent(errId, 'ERROR', {
      reason: 'invalid_slice',
      phase: 'validation',
      command: null,
      exit_code: null,
      stderr_tail: '',
      missingFields,
    });
    appendOperationalEvent({
      event: 'ERROR',
      slice_id: errId,
      root_id: null,
      cycle: null,
      branch: null,
      details: `Slice ${errId} errored: invalid_slice`,
    });

    // Remove the invalid QUEUED/PENDING file so it doesn't loop indefinitely.
    try { fs.renameSync(pendingPath, path.join(TRASH_DIR, path.basename(pendingPath) + '.invalid')); } catch (_) {}

    return; // Continue poll loop on next tick.
  }

  // Atomic rename: QUEUED → IN_PROGRESS.
  try {
    fs.renameSync(pendingPath, inProgressPath);
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to rename QUEUED to IN_PROGRESS', error: err.message });
    return;
  }

  log('info', 'pickup', { id, title, msg: 'Slice picked up', file: pendingFile });
  log('info', 'state', { id, from: 'QUEUED', to: 'IN_PROGRESS' });

  // Register: embed full slice body so success criteria are always recoverable.
  registerCommissioned(id, { title, goal, body: sliceContent });

  openSliceBlock(id, title, goal);

  processing = true;

  // Route based on `to` field: bashir slices go through the non-gate Bashir path;
  // everything else (rom, leeta) goes through invokeRom.
  const sliceTo = meta && meta.to ? meta.to.trim().toLowerCase() : 'rom';
  if (sliceTo === 'bashir') {
    // Bashir non-gate default timeout: 60 min (longer scouting/authoring work)
    const bashirInactivityMs = timeoutMin != null && !isNaN(timeoutMin)
      ? timeoutMin * 60 * 1000
      : BASHIR_NON_GATE_DEFAULT_TIMEOUT_MS;
    invokeBashirNonGate(sliceContent, donePath, inProgressPath, errorPath, id, bashirInactivityMs, title, goal);
  } else {
    // Invoke Rom asynchronously — event loop stays live.
    invokeRom(sliceContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal);
  }
}

// ---------------------------------------------------------------------------
// Crash recovery (3.1)
// ---------------------------------------------------------------------------

/**
 * migrateArchivedToParked()
 *
 * One-time startup migration: renames {id}-ARCHIVED.md → {id}-PARKED.md for
 * slices that completed before the slice-145 naming change. Only migrates files
 * that have a corresponding {id}-DONE.md and no {id}-PARKED.md yet. Idempotent.
 */
function migrateArchivedToParked() {
  let files;
  try { files = fs.readdirSync(QUEUE_DIR); } catch (_) { return; }

  let migrated = 0;
  for (const f of files) {
    if (!f.endsWith('-ARCHIVED.md')) continue;
    const id         = f.replace('-ARCHIVED.md', '');
    const archivedPath = path.join(QUEUE_DIR, f);
    const parkedPath   = path.join(QUEUE_DIR, `${id}-PARKED.md`);
    const donePath     = path.join(QUEUE_DIR, `${id}-DONE.md`);

    // Only migrate if DONE exists and PARKED does not yet exist.
    if (!fs.existsSync(donePath) || fs.existsSync(parkedPath)) continue;

    try {
      fs.renameSync(archivedPath, parkedPath);
      migrated++;
    } catch (err) {
      log('warn', 'startup_migration', { id, msg: 'Failed to rename ARCHIVED→PARKED', error: err.message });
    }
  }

  if (migrated > 0) {
    log('info', 'startup_migration', { msg: `Migrated ${migrated} legacy ARCHIVED→PARKED files` });
    print(`  ${C.green}${SYM.check}${C.reset}  Startup migration: renamed ${migrated} legacy ARCHIVED → PARKED`);
  }
}

/**
 * pruneOrphanDoneFiles()
 *
 * At startup: scan queue/ for DONE files that have a companion ARCHIVED file.
 * These are residual from the pre-slice-145 archival path that created
 * xxx-ARCHIVED.md but left xxx-DONE.md behind.
 * Move them to trash/ so they don't pollute the poll loop.
 */
function pruneOrphanDoneFiles() {
  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch (_) { return; }

  let pruned = 0;
  for (const f of files) {
    if (!f.endsWith('-DONE.md')) continue;
    const id = f.replace('-DONE.md', '');
    const archivedPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
    if (!fs.existsSync(archivedPath)) continue;
    // DONE + ARCHIVED → slice fully processed; DONE is orphan
    try {
      fs.renameSync(
        path.join(QUEUE_DIR, f),
        path.join(TRASH_DIR, f)
      );
      pruned++;
    } catch (err) {
      log('warn', 'startup', { id, msg: 'Failed to prune orphan DONE file', error: err.message });
    }
  }
  if (pruned > 0) {
    log('info', 'startup', { msg: `Pruned ${pruned} orphan DONE files (companion ARCHIVED exists)` });
    print(`  ${C.dim}·${C.reset}  Startup: pruned ${pruned} orphan DONE files from queue`);
  }
}

/**
 * crashRecovery()
 *
 * Runs at startup before entering the poll loop. Scans the queue directory for
 * orphaned IN_PROGRESS files left behind by a prior crash and resolves each:
 *
 *   {id}-IN_PROGRESS alone            → rename back to QUEUED (re-queue)
 *   {id}-IN_PROGRESS + DONE exists    → delete IN_PROGRESS (already complete)
 *   {id}-IN_PROGRESS + ERROR exists   → delete IN_PROGRESS (already failed)
 *   {id}-IN_PROGRESS + ACCEPTED exists → delete IN_PROGRESS (already evaluated)
 *   {id}-IN_PROGRESS + SLICE exists   → delete IN_PROGRESS (already archived)
 *
 * Returns an array of action records for display in the startup block.
 */
function crashRecovery() {
  const actions = [];
  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR).filter(f => CANONICAL_SUFFIX_RE.test(f));
  } catch (err) {
    log('warn', 'startup_recovery', { msg: 'Cannot read queue dir for crash recovery', error: err.message });
    return actions;
  }

  // Orphaned IN_QA files are NOT recovered here: see recoverOrphanedQaStages(), which runs
  // after recoverGateMutex() because it has to know what that call decided.

  // Recover orphaned EVALUATING files → rename back to DONE for re-evaluation.
  const evaluatingFiles = files.filter(f => f.endsWith('-EVALUATING.md'));
  for (const file of evaluatingFiles) {
    const id              = file.replace('-EVALUATING.md', '');
    if (isTerminal(id)) {
      log('debug', 'startup_recovery', { id, msg: `startup-recovery: skipped terminal slice ${id}` });
      continue;
    }
    const evaluatingPath  = path.join(QUEUE_DIR, file);
    const donePath        = path.join(QUEUE_DIR, `${id}-DONE.md`);
    try {
      fs.renameSync(evaluatingPath, donePath);
      log('info', 'startup_recovery', { id, msg: 'Orphaned EVALUATING renamed to DONE (re-queued for evaluation)', action: 're-queued-eval' });
      actions.push({ id, type: 'requeued_eval' });
    } catch (err) {
      log('warn', 'startup_recovery', { id, msg: 'Failed to rename orphaned EVALUATING to DONE', error: err.message });
    }
  }

  // Recover orphaned ACCEPTED files — merge was not completed before crash.
  // Check if the branch is already on main; if not, re-attempt merge.
  const acceptedFiles = files.filter(f => f.endsWith('-ACCEPTED.md'));
  for (const file of acceptedFiles) {
    const id = file.replace('-ACCEPTED.md', '');
    // isTerminal() returns true for ANY slice with an ACCEPTED file (Signal 1), so it must
    // NOT gate this loop — it would skip every accepted file and make orphaned-merge
    // recovery dead (a squash that failed after Nog-accept would never be retried). Skip
    // only slices that ACTUALLY LANDED: squashed to dev (gate flow), merged to main, or
    // fully archived. The rest fall through to the re-attempt below.
    if (hasSquashedToDevEvent(id) || hasMergedEvent(id) ||
        fs.existsSync(path.join(QUEUE_DIR, `${id}-ARCHIVED.md`))) {
      log('debug', 'startup_recovery', { id, msg: `startup-recovery: ${id} already landed/archived — skip` });
      continue;
    }
    const acceptedPath = path.join(QUEUE_DIR, file);

    // Read branch name from the ACCEPTED file (which is the renamed DONE report).
    let branchName = null;
    let title = null;
    try {
      const content = fs.readFileSync(acceptedPath, 'utf-8');
      const meta = parseFrontmatter(content);
      if (meta) branchName = meta.branch || null;
    } catch (_) {}

    // Read title from PARKED file (fall back to legacy ARCHIVED).
    const parkedTitlePath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
    const legacyTitlePath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
    try {
      const commContent = fs.readFileSync(fs.existsSync(parkedTitlePath) ? parkedTitlePath : legacyTitlePath, 'utf-8');
      const commMeta = parseFrontmatter(commContent);
      if (commMeta) title = commMeta.title || null;
    } catch (_) {}

    if (!branchName) {
      log('warn', 'startup_recovery', { id, msg: 'Orphaned ACCEPTED file has no branch — cannot recover merge' });
      actions.push({ id, type: 'accepted_no_branch' });
      continue;
    }

    // Check if branch is already merged to main.
    let alreadyMerged = false;
    try {
      // Fast path: check if ref still exists and is in main's ancestry
      gitFinalizer.runGit(`git rev-parse --verify "${branchName}"`, { slice_id: id, op: 'startupRecovery_verifyRef', encoding: 'utf-8', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } });
      const merged = gitFinalizer.runGit('git branch --merged main', { slice_id: id, op: 'startupRecovery_mergedCheck', encoding: 'utf-8' });
      alreadyMerged = merged.split('\n').some(line => line.trim() === branchName);
    } catch (_) {
      // Branch ref is gone (deleted after worktree cleanup) — check register
      alreadyMerged = hasMergedEvent(id);
    }

    if (alreadyMerged) {
      log('info', 'startup_recovery', { id, msg: `Branch ${branchName} already on main — no merge needed`, branch: branchName });
      actions.push({ id, type: 'accepted_already_merged', branch: branchName });
      continue;
    }

    // Re-attempt squash via acceptAndMerge (ACCEPTED file already exists — idempotent rename).
    const result = acceptAndMerge(id, acceptedPath, branchName, title, { lane: readSliceMeta(id).lane });
    if (result.deferred) {
      log('info', 'startup_recovery', { id, msg: `Recovery deferred for ${branchName} — gate is running`, branch: branchName });
      actions.push({ id, type: 'recovery_deferred', branch: branchName });
    } else if (result.success) {
      // Gate flow lands on DEV, not main — squashSliceToDev already emitted
      // SLICE_SQUASHED_TO_DEV (the real "landed" signal). Emitting MERGED here would
      // falsely mark the slice as on-main. Only the legacy direct-to-main path needs it.
      if (process.env.DS9_USE_GATE_FLOW !== '1') {
        registerEvent(id, 'MERGED', { branch: branchName, sha: result.sha, slice_id: id, recovery: true });
      }
      log('info', 'startup_recovery', { id, msg: `Recovery squash succeeded for ${branchName}`, branch: branchName, sha: result.sha });
      actions.push({ id, type: 'recovery_merged', branch: branchName, sha: result.sha });
    } else {
      registerEvent(id, 'MERGE_FAILED', { branch: branchName, reason: result.error, slice_id: id, recovery: true });
      log('warn', 'startup_recovery', { id, msg: `Recovery squash failed for ${branchName}`, branch: branchName, reason: result.error });
      actions.push({ id, type: 'recovery_merge_failed', branch: branchName, reason: result.error });
      printUnmergedAlert(id, title, branchName);
    }
  }

  const inProgressFiles = files.filter(f => f.endsWith('-IN_PROGRESS.md'));
  if (inProgressFiles.length === 0) return actions;

  for (const file of inProgressFiles) {
    const id             = file.replace('-IN_PROGRESS.md', '');
    if (isTerminal(id)) {
      log('debug', 'startup_recovery', { id, msg: `startup-recovery: skipped terminal slice ${id}` });
      continue;
    }
    const inProgressPath = path.join(QUEUE_DIR, file);
    const hasDone        = fs.existsSync(path.join(QUEUE_DIR, `${id}-DONE.md`));
    const hasError       = fs.existsSync(path.join(QUEUE_DIR, `${id}-ERROR.md`));
    const hasAccepted    = fs.existsSync(path.join(QUEUE_DIR, `${id}-ACCEPTED.md`));
    const hasParked      = fs.existsSync(path.join(QUEUE_DIR, `${id}-PARKED.md`));
    const hasArchived    = fs.existsSync(path.join(QUEUE_DIR, `${id}-ARCHIVED.md`));

    if (hasDone || hasError || hasAccepted || hasParked || hasArchived) {
      // Slice already resolved — the IN_PROGRESS file is a stale artifact.
      const resolvedAs = hasDone ? 'DONE' : hasError ? 'ERROR' : hasAccepted ? 'ACCEPTED' : hasParked ? 'PARKED' : 'ARCHIVED';
      try {
        fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.orphan'));
        log('info', 'startup_recovery', {
          id,
          msg: `Orphaned IN_PROGRESS trashed (${resolvedAs} present)`,
          action: 'trashed',
          resolved_as: resolvedAs,
        });
        actions.push({ id, type: hasDone ? 'cleared' : hasAccepted ? 'cleared_accepted' : hasSlice ? 'cleared_slice' : 'cleared_error' });
      } catch (err) {
        log('warn', 'startup_recovery', { id, msg: 'Failed to delete orphaned IN_PROGRESS', error: err.message });
      }
    } else {
      // Check if slice was paused when the orchestrator restarted.
      const latestEvent = getLatestRegisterEvent(id);
      if (latestEvent && latestEvent.event === 'ROM_PAUSED') {
        // Slice was paused — leave it IN_PROGRESS but block new dispatches.
        // The child process is gone (orchestrator restarted), so emit a
        // paused_child_died error so the UI can prompt Abort + re-stage.
        processing = true;
        heartbeatState.status = 'processing';
        heartbeatState.current_slice = id;
        registerEvent(id, 'ERROR', {
          phase: 'paused_child_died',
          reason: 'Watcher restarted while slice was paused — child process lost',
          stderr_tail: '',
        });
        log('info', 'startup_recovery', {
          id,
          msg: 'Paused slice found on restart — child lost, ERROR emitted. Awaiting Resume/Abort.',
          action: 'paused_orphan',
        });
        actions.push({ id, type: 'paused_orphan' });
      } else {
        // No resolution file — slice was interrupted mid-flight. Re-queue it.
        const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
        try {
          fs.renameSync(inProgressPath, queuedPath);  // atomic rename
          log('info', 'startup_recovery', {
            id,
            msg: 'Orphaned IN_PROGRESS renamed to QUEUED (re-queued)',
            action: 're-queued',
          });
          actions.push({ id, type: 'requeued' });
        } catch (err) {
          log('warn', 'startup_recovery', { id, msg: 'Failed to rename orphaned IN_PROGRESS to QUEUED', error: err.message });
        }
      }
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Slice ID management (3.2)
// ---------------------------------------------------------------------------

/**
 * nextSliceId(queueDir)
 *
 * Reads all filenames in queueDir, extracts their numeric prefix IDs, and
 * returns the next ID as a zero-padded three-digit string (e.g. "009").
 * Returns "001" if the directory is empty or unreadable.
 *
 * This function is purely computational — it does not write any files.
 * Exported so the orchestrator can call it from bridge/next-id.js.
 */
function nextSliceId(queueDir) {
  const stagedDir = path.join(path.dirname(queueDir), 'staged');
  const ids = [];

  for (const dir of [queueDir, stagedDir]) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const f of files) {
      const m = f.match(/^(\d+)-/);
      if (m) ids.push(parseInt(m[1], 10));
    }
  }

  if (ids.length === 0) return '001';
  return String(Math.max(...ids) + 1).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  log('info', 'shutdown', { msg: `Received ${signal} — shutting down` });
  if (processing) {
    log('warn', 'shutdown', {
      msg: 'A slice is in flight at shutdown. The IN_PROGRESS file will be recovered by crash recovery (Layer 3) on next startup.',
      current_slice: heartbeatState.current_slice,  // internal key name kept for state compat
    });
    print('');
    print(`  Watcher shutting down${SYM.dash}slice in progress will be recovered on next start.`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// One-shot bootstrap: rescue DONE files wedged by stale pre-RESTAGED reviews
// ---------------------------------------------------------------------------

/**
 * restagedBootstrap(opts)
 *
 * Runs once per install (guarded by RESTAGED_BOOTSTRAP_MARKER).
 * Scans queue for *-DONE.md files that have a stale NOG_DECISION/MERGED/STUCK
 * in the register but no RESTAGED marker yet. Appends a synthetic RESTAGED so
 * the new scoped hasReviewEvent returns false and the DONE can advance to Nog.
 *
 * Accepts optional {queueDir, regFile, markerFile} for testing.
 */
function restagedBootstrap(opts) {
  const queueDir   = (opts && opts.queueDir)   || QUEUE_DIR;
  const regFile    = (opts && opts.regFile)    || REGISTER_FILE;
  const markerFile = (opts && opts.markerFile) || RESTAGED_BOOTSTRAP_MARKER;

  if (fs.existsSync(markerFile)) return;

  let doneFiles;
  try {
    doneFiles = fs.readdirSync(queueDir).filter(f => CANONICAL_SUFFIX_RE.test(f) && /^\d+-DONE\.md$/.test(f));
  } catch (_) { return; }

  for (const file of doneFiles) {
    const id = file.replace('-DONE.md', '');
    if (latestRestagedTs(id, regFile) !== null) continue; // already has RESTAGED

    let hasStale = false;
    try {
      const lines = fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean);
      resetDedupeState();
      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          const entry = translateEvent(raw);
          if (entry && entry.id === String(id) && ['NOG_DECISION', 'MERGED', 'STUCK'].includes(entry.event)) {
            hasStale = true;
            break;
          }
        } catch (_) {}
      }
    } catch (_) {}

    if (hasStale) {
      const rescueEntry = { ts: new Date().toISOString(), event: 'RESTAGED', slice_id: String(id) };
      try {
        fs.appendFileSync(regFile, JSON.stringify(rescueEntry) + '\n');
        log('info', 'bootstrap', { id, msg: 'RESTAGED rescue appended for wedged DONE' });
      } catch (err) {
        log('warn', 'bootstrap', { id, msg: 'Failed to append RESTAGED rescue', error: err.message });
      }
    }
  }

  try {
    fs.writeFileSync(markerFile, new Date().toISOString() + '\n');
  } catch (err) {
    log('warn', 'bootstrap', { msg: 'Failed to write bootstrap marker', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Backfill archive — one-shot pass to archive merged ACCEPTED files
// ---------------------------------------------------------------------------

const BACKFILL_ARCHIVE_MARKER = path.resolve(__dirname, '.backfill-archive-done');

/**
 * backfillArchive(opts)
 *
 * Runs once per install (guarded by BACKFILL_ARCHIVE_MARKER).
 * For each {id}-ACCEPTED.md in queue whose branch is already merged on main,
 * transitions to ARCHIVED via archiveAcceptedSlice + archiveSiblingStateFiles.
 * Skips unmerged ones.
 */
function backfillArchive(opts) {
  const queueDir   = (opts && opts.queueDir)   || QUEUE_DIR;
  const trashDir   = (opts && opts.trashDir)   || TRASH_DIR;
  const markerFile = (opts && opts.markerFile) || BACKFILL_ARCHIVE_MARKER;

  if (fs.existsSync(markerFile)) return;

  let acceptedFiles;
  try {
    acceptedFiles = fs.readdirSync(queueDir).filter(f => /^\d+-ACCEPTED\.md$/.test(f));
  } catch (_) { return; }

  let processed = 0;
  let skipped = 0;

  for (const file of acceptedFiles) {
    const id = file.replace('-ACCEPTED.md', '');

    // Read branch name from frontmatter
    let branchName = `slice/${id}`;
    try {
      const content = fs.readFileSync(path.join(queueDir, file), 'utf-8');
      const meta = parseFrontmatter(content);
      if (meta && meta.branch) branchName = meta.branch;
    } catch (_) {}

    // Check if branch is merged on main
    let isMerged = false;
    try {
      const mergedBranches = gitFinalizer.runGit('git branch --merged main', { slice_id: id, op: 'backfill_checkMerged', encoding: 'utf-8' });
      isMerged = mergedBranches.split('\n').some(b => b.trim() === branchName);
    } catch (_) {}

    if (isMerged) {
      try {
        archiveAcceptedSlice(id, branchName, { queueDir, trashDir, source: 'backfill' });
        processed++;
      } catch (err) {
        log('warn', 'backfill', { id, msg: 'Backfill archive failed for slice', error: err.message });
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  registerEvent('backfill', 'BACKFILL_ARCHIVE_COMPLETE', { processed, skipped });

  try {
    fs.writeFileSync(markerFile, new Date().toISOString() + '\n');
  } catch (err) {
    log('warn', 'backfill', { msg: 'Failed to write backfill archive marker', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// backfillBranches — one-shot cleanup of stale local slice branches (slice 217)
// ---------------------------------------------------------------------------

const BACKFILL_BRANCHES_MARKER = path.resolve(__dirname, '.backfill-branches-done');

/**
 * backfillBranches(opts)
 *
 * Walks local `slice/*` branches; for each whose slice ID has an
 * `-ARCHIVED.md` file in queue, runs `git branch -D`. Marker-guarded
 * so it runs only once.
 */
function backfillBranches(opts) {
  const queueDir   = (opts && opts.queueDir)   || QUEUE_DIR;
  const markerFile = (opts && opts.markerFile) || BACKFILL_BRANCHES_MARKER;

  if (fs.existsSync(markerFile)) return;

  let branches;
  try {
    const raw = gitFinalizer.runGit('git branch --list "slice/*"', { slice_id: 'backfill', op: 'backfillBranches_list', encoding: 'utf-8' });
    branches = raw.split('\n').map(b => b.trim().replace(/^\* /, '')).filter(Boolean);
  } catch (_) { return; }

  let processed = 0;
  let skipped = 0;

  for (const branch of branches) {
    const match = branch.match(/^slice\/(\d+)/);
    if (!match) { skipped++; continue; }
    const id = match[1];

    const archivedPath = path.join(queueDir, `${id}-ARCHIVED.md`);
    if (!fs.existsSync(archivedPath)) { skipped++; continue; }

    try {
      gitFinalizer.runGit(`git branch -D ${branch}`, { slice_id: id, op: 'backfillBranches_delete', execOpts: { stdio: 'pipe' } });
      processed++;
    } catch (err) {
      log('warn', 'backfill', { id, msg: 'Failed to delete stale branch', branch, error: err.message });
      skipped++;
    }
  }

  registerEvent('backfill', 'BACKFILL_BRANCHES_COMPLETE', { processed, skipped });

  try {
    fs.writeFileSync(markerFile, new Date().toISOString() + '\n');
  } catch (err) {
    log('warn', 'backfill', { msg: 'Failed to write backfill branches marker', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// backfillAcceptedFiles — one-shot fix for missing ACCEPTED files (slice 216)
// ---------------------------------------------------------------------------

const BACKFILL_ACCEPTED_MARKER = path.resolve(__dirname, '.backfill-accepted-done');

/**
 * backfillAcceptedFiles(opts)
 *
 * Runs once per install (guarded by BACKFILL_ACCEPTED_MARKER).
 * Walks bridge/queue/ for slices whose branch is merged on main but lack
 * -ACCEPTED.md. For each, creates the ACCEPTED file by renaming an existing
 * -DONE.md or -EVALUATING.md, or writing a stub if neither exists.
 */
function backfillAcceptedFiles(opts) {
  const queueDir   = (opts && opts.queueDir)   || QUEUE_DIR;
  const markerFile = (opts && opts.markerFile)  || BACKFILL_ACCEPTED_MARKER;

  if (fs.existsSync(markerFile)) return;

  let files;
  try {
    files = fs.readdirSync(queueDir);
  } catch (_) { return; }

  // Find slices that have a -DONE.md but no -ACCEPTED.md.
  const doneFiles = files.filter(f => CANONICAL_SUFFIX_RE.test(f) && /^\d+-DONE\.md$/.test(f));
  let processed = 0;
  let skipped = 0;

  for (const doneFile of doneFiles) {
    const id = doneFile.replace('-DONE.md', '');
    const acceptedPath = path.join(queueDir, `${id}-ACCEPTED.md`);

    // Already has ACCEPTED — skip.
    if (fs.existsSync(acceptedPath)) {
      skipped++;
      continue;
    }

    // Read branch name from the DONE file frontmatter.
    let branchName = `slice/${id}`;
    try {
      const content = fs.readFileSync(path.join(queueDir, doneFile), 'utf-8');
      const meta = parseFrontmatter(content);
      if (meta && meta.branch) branchName = meta.branch;
    } catch (_) {}

    // Check if branch is merged on main.
    let isMerged = false;
    try {
      const mergedBranches = gitFinalizer.runGit('git branch --merged main', { slice_id: id, op: 'backfillAccepted_checkMerged', encoding: 'utf-8' });
      isMerged = mergedBranches.split('\n').some(b => b.trim() === branchName);
    } catch (_) {}

    // Also check register for MERGED event (branch may have been deleted).
    if (!isMerged) {
      try { isMerged = hasMergedEvent(id); } catch (_) {}
    }

    if (!isMerged) {
      skipped++;
      continue;
    }

    // Create ACCEPTED file: prefer renaming EVALUATING, then copy DONE content.
    const evaluatingPath = path.join(queueDir, `${id}-EVALUATING.md`);
    try {
      if (fs.existsSync(evaluatingPath)) {
        fs.renameSync(evaluatingPath, acceptedPath);
      } else {
        // Write a stub ACCEPTED from DONE content (DONE stays — it's committed on branch).
        const doneContent = fs.readFileSync(path.join(queueDir, doneFile), 'utf-8');
        fs.writeFileSync(acceptedPath, doneContent);
      }
      processed++;
      log('info', 'backfill', { id, msg: 'Created missing ACCEPTED file via backfill' });
    } catch (err) {
      log('warn', 'backfill', { id, msg: 'Backfill ACCEPTED failed', error: err.message });
      skipped++;
    }
  }

  registerEvent('backfill', 'BACKFILL_ACCEPTED_COMPLETE', { processed, skipped });

  try {
    fs.writeFileSync(markerFile, new Date().toISOString() + '\n');
  } catch (err) {
    log('warn', 'backfill', { msg: 'Failed to write backfill accepted marker', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// auditLegacyFiles — warn about pre-terminology residue at startup (slice 218)
// ---------------------------------------------------------------------------

function auditLegacyFiles(opts) {
  const queueDir = (opts && opts.queueDir) || QUEUE_DIR;
  let files;
  try {
    files = fs.readdirSync(queueDir).filter(f => f.endsWith('.md'));
  } catch (_) { return; }

  const nonCanonical = files.filter(f => !CANONICAL_SUFFIX_RE.test(f));
  if (nonCanonical.length === 0) return;

  const sample = nonCanonical.slice(0, 10);
  registerEvent('audit', 'LEGACY_FILES_DETECTED', { count: nonCanonical.length, sample });
  log('warn', 'audit', { msg: `${nonCanonical.length} non-canonical file(s) in queue`, sample });
}

// ---------------------------------------------------------------------------
// Startup — only runs when this file is executed directly (not when required)
// ---------------------------------------------------------------------------

if (require.main === module) {
  log('info', 'startup', {
    msg: 'Watcher started',
    config: {
      pollIntervalMs: config.pollIntervalMs,
      inactivityTimeoutMs: config.inactivityTimeoutMs,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      queueDir: QUEUE_DIR,
      logFile: LOG_FILE,
      heartbeatFile: HEARTBEAT_FILE,
      projectDir: PROJECT_DIR,
      claudeCommand: config.claudeCommand,
      claudeArgs: config.claudeArgs,
      maxRetries: config.maxRetries,
    },
  });

  // Fresh-clone bootstrap: the untracked runtime state was just created.
  if (_seededRuntimeState.length) {
    log('info', 'startup', { msg: 'Seeded volatile runtime state (fresh workspace)', files: _seededRuntimeState });
  }
  // Recovery, not bootstrap: these were absent from disk but still in git history,
  // which is what a merge of the untracking commit does to a live worktree. Say so
  // loudly — an unnoticed empty timesheet reads as truth.
  if (_restoredRuntimeState.length) {
    log('warn', 'startup', {
      msg: 'Recovered runtime state from git history — it was missing from disk, not empty',
      files: _restoredRuntimeState,
    });
  }

  // Remove stale git lock files from prior crashes before any git operations.
  clearStaleGitLocks();

  // Initialise git-finalizer with orchestrator dependencies.
  gitFinalizer.init({ PROJECT_DIR, registerEvent, log, HEARTBEAT_FILE, QUEUE_DIR });

  // Clean up .dead worktree/branch entries from prior sessions.
  cleanupDeadWorktrees();

  const recoveryActions = crashRecovery();
  pruneOrphanDoneFiles();
  migrateArchivedToParked();
  restagedBootstrap();
  reconcileBranchState({ registerEvent, log, runGit: gitFinalizer.runGit });
  recoverGateMutex({ registerEvent, log });
  // After recoverGateMutex, never before: whether the mutex survived that call is how this
  // tells a stage that died with the daemon from one whose Julian is still writing.
  recoveryActions.push(...recoverOrphanedQaStages());
  backfillAcceptedFiles();
  backfillArchive();
  backfillBranches();
  auditLegacyFiles();
  printStartupBlock(recoveryActions);

  // Initial heartbeat write so the file exists immediately on startup.
  writeHeartbeat();

  // Start heartbeat interval.
  setInterval(writeHeartbeat, config.heartbeatIntervalMs);

  // Start adaptive poll loop + immediate first poll.
  currentPollMs = config.pollIntervalMs;
  schedulePoll();
  poll();

  // -------------------------------------------------------------------------
  // Writer-split: watch for external changes to per-role JSONL files.
  // When O'Brien (or any other role) appends to e.g. timesheet-obrien.jsonl via
  // Wormhole, rebuild the merged view so readers see the new data.
  // -------------------------------------------------------------------------
  const SPLIT_BASES = ['timesheet', 'anchors', 'tt-audit'];
  const rebuildDebounce = {};

  fs.watch(__dirname, (eventType, filename) => {
    if (!filename || !filename.endsWith('.jsonl')) return;
    for (const base of SPLIT_BASES) {
      // Match per-role files like timesheet-obrien.jsonl but not the merged timesheet.jsonl
      if (filename.startsWith(`${base}-`) && filename !== `${base}.jsonl`) {
        // Debounce: multiple change events fire in rapid succession
        if (rebuildDebounce[base]) clearTimeout(rebuildDebounce[base]);
        rebuildDebounce[base] = setTimeout(() => {
          rebuildMerged(base);
          rebuildDebounce[base] = null;
        }, 200);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// validateIntakeMeta — intake field validation for the poll loop
//
// Rework/apendment files carry rounds[], round>1, or apendment/references
// signals and only need 4 fields (id, title, from, to); the priority +
// created pair was captured in the original COMMISSIONED event.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Approval provenance at dispatch (slice 354)
//
// Securing only the HTTP endpoint would have been theatre. This orchestrator has
// never read HUMAN_APPROVAL — `grep -c HUMAN_APPROVAL` returns 0 — and dispatch
// is driven purely by a file existing in bridge/queue/ with a -QUEUED.md or
// -PENDING.md suffix, reconstructing the order from mtimes when queue-order.json
// is gone. So `printf ... > bridge/queue/999-QUEUED.md` commissioned Rom with no
// HTTP request, no approval event and no human anywhere. The enforcement point
// has to be here.
// ---------------------------------------------------------------------------

/** Repo root, derived from QUEUE_DIR so `_testSetDirs` redirects it with everything else. */
function provenanceRoot() {
  return path.resolve(QUEUE_DIR, '..', '..');
}

/**
 * The slice's root id: an amendment brief carries `references: "NNN"` and its
 * parent is the slice history knows. A Nog rework round keeps the same id, so
 * nothing extra is needed for that case.
 *
 * This is an id LOOKUP, not a permission. Round 1 of this slice let its result
 * grandfather anything — see checkDispatchProvenance for why that was a free
 * pass and what now bounds it.
 */
function provenanceRootId(id, meta) {
  const ref = meta && meta.references;
  if (ref && ref !== 'null') return String(ref).trim();
  return String(id);
}

/**
 * True when the register knew one of these ids before the cutover.
 *
 * No recency condition, and matching ANY event rather than an approval: 64 of
 * 274 commissioned slices have no approval event at all, and `refined` and
 * `rejected` share the HUMAN_APPROVAL event name, so counting approval events
 * would misjudge both populations. Existing before the cutover is the question,
 * and any event answers it.
 */
function hasPreCutoverHistory(rootId, id) {
  const cutover = Date.parse(approvalProvenance.cutoverTs(provenanceRoot()));
  if (!Number.isFinite(cutover)) return false;
  for (const line of _getRegLines(REGISTER_FILE)) {
    let ev;
    try { ev = JSON.parse(line); } catch (_) { continue; }
    const evId = String(ev.slice_id != null ? ev.slice_id : ev.id);
    if (evId !== String(rootId) && evId !== String(id)) continue;
    const ts = Date.parse(ev.ts);
    if (Number.isFinite(ts) && ts < cutover) return true;
  }
  return false;
}

/**
 * Does the QUEUE FILE itself predate the cutover?
 *
 * Two signals, and only one of them is load-bearing. The frontmatter `created`
 * is written by whoever wrote the file, so an attacker sets it to anything —
 * it can therefore only ever ADD a condition, never satisfy one on its own.
 * The filesystem mtime is the signal that costs something to fake: a file
 * printf'd into the queue carries an mtime of *now*, whatever its frontmatter
 * claims. `touch -t` still defeats it, which is the honest limit of a local
 * server — but it is a deliberate second act, and it is the difference between
 * a one-line bypass and one that has to lie about the filesystem too.
 *
 * Fails closed: no path, no stat, no answer ⇒ not pre-cutover.
 */
function fileIsPreCutover(pendingPath, meta, cutoverMs) {
  const created = meta && meta.created ? Date.parse(meta.created) : NaN;
  if (Number.isFinite(created) && created >= cutoverMs) return false;
  if (!pendingPath) return false;
  try {
    return fs.statSync(pendingPath).mtimeMs < cutoverMs;
  } catch (_) {
    return false;
  }
}

/**
 * checkDispatchProvenance(id, meta, pendingPath) → { ok, provenance, reason, legacy }
 *
 * `ok` means this slice may dispatch. A valid stamp passes. An unstamped slice
 * grandfathers only in the two shapes below — that narrowness is what makes
 * "a machine may not approve work" true going forward without rewriting the
 * history of a queue that is already full.
 *
 * ── Why the parent path is bounded (round 2 fix) ─────────────────────────────
 * Round 1 asked `hasPreCutoverHistory(provenanceRootId(id, meta), id)` — one
 * question covering both the slice and its parent. That made `references:` a
 * free pass: 274 ids already carry pre-cutover history, so ANY of them worked
 * as a claimed parent, and the brief's own attack — `printf ... >
 * bridge/queue/999-QUEUED.md` — still commissioned Rom post-cutover with one
 * extra frontmatter line. `references` is not obscure; it is the normal shape
 * of an amendment, so a machine writing a queue file is MORE likely to include
 * it than not.
 *
 * The two shapes are now separate questions:
 *   1. the slice's OWN id is known to the register from before the cutover.
 *      Unconditional: an attacker cannot manufacture that for a fresh id
 *      without forging a back-dated register line, which leaves its own trace.
 *   2. a claimed PARENT's id is known from before the cutover — but only when
 *      the queue file itself also predates the cutover. A genuine pre-cutover
 *      amendment satisfies this; a file written today does not.
 *
 * Shape 2 cannot rescue a slice that has already dispatched once, and does not
 * need to: anything that has been through a round has its own history, so
 * shape 1 covers every rework round (trap 1 stays respected — no freshness,
 * count or consumption rule anywhere).
 */
function checkDispatchProvenance(id, meta, pendingPath) {
  const root = provenanceRoot();
  const verdict = approvalProvenance.verifyStampedMeta(root, meta, id);
  if (verdict.ok) return { ok: true, provenance: verdict.provenance, reason: null, legacy: false };

  const legacy = (reason) => ({
    ok: true,
    provenance: approvalProvenance.PROVENANCE.LEGACY_UNATTRIBUTED,
    reason,
    legacy: true,
  });

  if (verdict.reason === 'unstamped') {
    if (hasPreCutoverHistory(id, id)) return legacy('pre-cutover');

    const rootId = provenanceRootId(id, meta);
    if (rootId !== String(id)) {
      const cutoverMs = Date.parse(approvalProvenance.cutoverTs(root));
      if (Number.isFinite(cutoverMs)
          && fileIsPreCutover(pendingPath, meta, cutoverMs)
          && hasPreCutoverHistory(rootId, rootId)) {
        return legacy('pre-cutover-parent');
      }
    }
  }
  return { ok: false, provenance: verdict.provenance, reason: verdict.reason, legacy: false };
}

/**
 * Hold an unprovenanced slice and hand it to O'Brien.
 *
 * Never trash. validateIntakeMeta's failure path moves the file to TRASH_DIR,
 * and a trash-on-failure rule here would have wiped real work: the queue holds
 * 17 PARKED and 23 DONE files, and most of what is in flight predates any stamp.
 * The file is renamed to an inert suffix the poll loop does not scan, so the
 * slice stops moving and stays readable.
 *
 * PARKED is the intended resting place; a slice on a rework round already owns
 * `{id}-PARKED.md` (handleNogReturn writes a fresh QUEUED beside it and leaves
 * the parked copy in place), so STUCK — which already means "escalated to
 * O'Brien" here — takes the collision rather than clobbering it.
 */
function parkUnprovenancedSlice(id, pendingPath, verdict) {
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const heldPath   = fs.existsSync(parkedPath) ? path.join(QUEUE_DIR, `${id}-STUCK.md`) : parkedPath;
  const heldAs     = path.basename(heldPath).replace(/^\d+-/, '').replace(/\.md$/, '');

  let sliceContent = '';
  try { sliceContent = fs.readFileSync(pendingPath, 'utf-8'); } catch (_) {}

  try {
    fs.renameSync(pendingPath, heldPath);
    log('info', 'state', { id, from: 'QUEUED', to: heldAs, reason: 'approval_provenance_missing' });
  } catch (err) {
    log('error', 'dispatch', { id, msg: 'Failed to park unprovenanced slice', error: err.message });
    return;
  }

  const escalationsDir = path.resolve(QUEUE_DIR, '..', 'escalations');
  const escalation = [
    '---',
    `id: "${id}"`,
    `title: "APPROVAL PROVENANCE — slice ${id} was not approved through the dashboard"`,
    'from: orchestrator',
    'to: obrien',
    `created: "${new Date().toISOString()}"`,
    `reason: "${verdict.reason}"`,
    `held_as: "${heldAs}"`,
    '---',
    '',
    '## Held, not dispatched',
    '',
    `Slice ${id} reached the queue without approval provenance this installation`,
    `signed (reason: ${verdict.reason}), and its id has no register history before the`,
    `cutover (${approvalProvenance.cutoverTs(provenanceRoot())}), so it is not legacy work.`,
    '',
    'A legitimate approval is a click in the dashboard or the standing auto-approve',
    'policy; both stamp the queue file. A slice without a stamp was written by',
    'something else — a script, an agent, or a hand-edited file.',
    '',
    `The slice is held at bridge/queue/${path.basename(heldPath)}. Nothing was trashed.`,
    'Re-stage it and approve it through the dashboard to dispatch it.',
    '',
    '## Slice file contents',
    '',
    sliceContent,
  ].join('\n');

  try {
    fs.mkdirSync(escalationsDir, { recursive: true });
    fs.writeFileSync(path.join(escalationsDir, `${id}-PROVENANCE-ESCALATION.md`), escalation);
  } catch (err) {
    log('error', 'dispatch', { id, msg: 'Failed to write provenance escalation file', error: err.message });
  }

  registerEvent(id, 'APPROVAL_PROVENANCE_BLOCKED', {
    reason: verdict.reason,
    held_as: heldAs,
    enforced: true,
  });
  log('warn', 'dispatch', {
    id,
    msg: `Slice ${id} held — no valid approval provenance (${verdict.reason}); escalated to O'Brien`,
    reason: verdict.reason,
  });
  print(`  ${C.red}${SYM.cross}${C.reset} Slice ${id} held${SYM.dash}no approval provenance (${verdict.reason}) — escalated to O'Brien`);
}

function validateIntakeMeta(meta) {
  const isApendmentFile = !!(meta && (
    meta.type === 'amendment' ||
    meta.apendment ||
    meta.amendment ||
    (meta.references && meta.references !== 'null') ||
    (parseInt(meta.round, 10) > 1) ||
    (Array.isArray(meta.rounds) && meta.rounds.length > 0)
  ));
  const REQUIRED_FIELDS = isApendmentFile
    ? ['id', 'title', 'from', 'to']
    : ['id', 'title', 'from', 'to', 'priority', 'created'];
  const missingFields = REQUIRED_FIELDS.filter(
    field => !meta || !meta[field] || meta[field].trim() === ''
  );
  return { ok: missingFields.length === 0, missingFields };
}

// ---------------------------------------------------------------------------
// Gate start — Bashir regression gate (slice 267)
// ---------------------------------------------------------------------------

const BASHIR_HEARTBEAT_PATH = path.resolve(__dirname, 'state', 'bashir-heartbeat.json');
const BASHIR_STDOUT_LOG = path.resolve(__dirname, 'state', 'bashir-stdout.log');
const BASHIR_PROMPT_TEMPLATE = path.resolve(__dirname, 'templates', 'bashir-prompt.md');
const BASHIR_NON_GATE_PROMPT_TEMPLATE = path.resolve(__dirname, 'templates', 'bashir-non-gate-prompt.md');
const BASHIR_HEARTBEAT_POLL_MS = 30000;
const BASHIR_HEARTBEAT_STALE_MS = 90000;
const BASHIR_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const BASHIR_NON_GATE_DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

// Regression suite execution (slice 268)
const REGRESSION_STDOUT_LOG = path.resolve(__dirname, 'state', 'regression-stdout.log');
const REGRESSION_STDERR_LOG = path.resolve(__dirname, 'state', 'regression-stderr.log');
const REGRESSION_TIMEOUT_MS = parseInt(process.env.DS9_REGRESSION_TIMEOUT_S || '600', 10) * 1000;
const AC_NAMING_RE = /slice-(\d+)-ac-(\d+)/;

/**
 * buildBashirPrompt(sliceId, opts)
 *
 * Julian's prompt for ONE slice's stage: the eight-item packet, and beyond it only the
 * operational lines (the mutex contract and where he writes).
 *
 * It used to take branchState and hand him a regex-cut `## Acceptance criteria` block from
 * whichever file had survived archiving — usually Rom's re-typed copy of the criteria
 * rather than the brief, for every unmerged slice at once. The stage is per-slice now, and
 * what it gives him is the record: the brief with its goal, tasks and traps, Rom's report,
 * Nog's verdict, the changed file NAMES, the screen hooks, the tests Rom moved, where to
 * look at the running product, and the break-it result (slice 363).
 *
 * opts: { packet, queueDir, trashDir, sha, changedFiles, breakItResult, templatePath,
 *         heartbeatPath }
 *
 * `opts.packet` is the one the stage already assembled, before it renamed the slice. Pass
 * it: assembling a second time reads the queue again, after the rename, and two packets
 * for one stage are two answers to "what was Julian given".
 */
function buildBashirPrompt(sliceId, opts) {
  opts = opts || {};
  const packet = opts.packet || qaStage.assemblePacket(String(sliceId), {
    queueDir: opts.queueDir || QUEUE_DIR,
    trashDir: opts.trashDir || TRASH_DIR,
    repoRoot: opts.repoRoot || PROJECT_DIR,
    sha: opts.sha || null,
    changedFiles: opts.changedFiles || null,
    breakItResult: opts.breakItResult || null,
    // Names only. runGit is handed in so the call is a seam for the tests and so the one
    // git question this builder asks can never be widened into `git show` or a diff.
    runGit: opts.runGit || gitFinalizer.runGit,
  });
  return qaStage.buildPrompt(packet, {
    templatePath: opts.templatePath || BASHIR_PROMPT_TEMPLATE,
    heartbeatPath: opts.heartbeatPath || 'bridge/state/bashir-heartbeat.json',
  });
}

/**
 * buildBashirNonGatePrompt(sliceContent)
 *
 * Builds the prompt for a non-gate Bashir invocation. Hydrates the non-gate
 * template with the slice body and heartbeat path.
 */
function buildBashirNonGatePrompt(sliceContent) {
  const template = fs.readFileSync(BASHIR_NON_GATE_PROMPT_TEMPLATE, 'utf-8');
  return template
    .replace('{{HEARTBEAT_PATH}}', 'bridge/state/bashir-heartbeat.json')
    .replace('{{SLICE_BODY}}', sliceContent);
}

/**
 * invokeBashirNonGate(sliceContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal)
 *
 * Non-gate Bashir dispatch path. Mirrors invokeRom's lifecycle:
 * - Creates worktree on slice/{id} branch
 * - Acquires gate mutex (shared with gate — only one Bashir at a time)
 * - Spawns claude -p with the non-gate Bashir prompt
 * - Monitors heartbeat for liveness
 * - On completion: copies DONE file, releases mutex, fires register events
 */
function invokeBashirNonGate(sliceContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal) {
  const sliceMeta = parseFrontmatter(sliceContent) || {};
  const isApendment = !!(sliceMeta.apendment || sliceMeta.amendment || (sliceMeta.references && sliceMeta.references !== 'null') || (parseInt(sliceMeta.round, 10) > 1));
  const sliceBranch = isApendment
    ? (sliceMeta.apendment || sliceMeta.amendment || sliceMeta.branch || `slice/${sliceMeta.root_commission_id || id}`)
    : `slice/${id}`;

  // ── WORKTREE SETUP ──────────────────────────────────────────────────────
  let worktreePath;
  try {
    ensureIntegrationIsFresh(id);
    worktreePath = gitFinalizer.createWorktreeWithRetry(createWorktree, id, sliceBranch);
    log('info', 'branch', { id, msg: `Bashir worktree ready at ${worktreePath} on branch ${sliceBranch}`, isApendment });
    registerEvent(id, 'WORKTREE_CREATED', { branch: sliceBranch, worktree: worktreePath });
  } catch (err) {
    const reason = err.retryReason
      ? err.retryReason
      : (isApendment ? 'apendment_branch_checkout_failed' : 'branch_creation_failed');
    log('error', 'branch', { id, msg: `Failed to create worktree for ${sliceBranch} — aborting Bashir invocation`, error: err.message, reason });
    const errorPath2 = path.join(QUEUE_DIR, `${id}-ERROR.md`);
    writeErrorFile(errorPath2, id, reason, err, '', '');
    log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
    registerEvent(id, 'ERROR', {
      reason,
      phase: 'worktree_setup',
      command: `git worktree add … ${sliceBranch}`,
      exit_code: err.status != null ? err.status : null,
      stderr_tail: truncStderr(err.stderr ? err.stderr.toString() : err.message),
    });
    appendOperationalEvent({
      event: 'ERROR',
      slice_id: id,
      root_id: sliceMeta.root_commission_id || null,
      cycle: null,
      branch: sliceBranch || null,
      details: `Slice ${id} errored: ${reason}`,
    });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_title = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // ── MUTEX ACQUISITION ───────────────────────────────────────────────────
  // Share mutex with gate — only one Bashir invocation at a time (gate OR non-gate).
  const ctx = { registerEvent, log };
  const mutexResult = acquireGateMutex(null, null, 'bridge/state/bashir-heartbeat.json', ctx);
  if (!mutexResult.ok) {
    log('warn', 'bashir_non_gate', { id, msg: 'Bashir mutex already held — cannot dispatch non-gate slice', reason: mutexResult.reason });
    // Return to QUEUED so it can be retried on next poll
    try { fs.renameSync(inProgressPath, path.join(QUEUE_DIR, `${id}-QUEUED.md`)); } catch (_) {}
    log('info', 'state', { id, from: 'IN_PROGRESS', to: 'QUEUED', reason: 'bashir_mutex_held' });
    registerEvent(id, 'SLICE_DEFERRED', { slice_id: String(id), reason: 'bashir-mutex-held' });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_title = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    // Clean up worktree
    try { execSync(`git worktree remove --force ${worktreePath}`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    return;
  }
  registerEvent(id, 'LOCK_CLAIMED', { lock: 'bashir_mutex', branch: sliceBranch });
  registerEvent(id, 'BASHIR_INVOKED', { mode: 'non-gate', branch: sliceBranch });

  // Ensure the worktree has a queue directory for the DONE report
  const worktreeQueueDir = path.join(worktreePath, 'bridge', 'queue');
  fs.mkdirSync(worktreeQueueDir, { recursive: true });
  const worktreeDonePath = path.join(worktreeQueueDir, `${id}-DONE.md`);

  const doneTemplate = [
    '',
    '## DONE report template',
    '',
    'Write your report to: ' + worktreeDonePath,
    '',
    'Use this exact frontmatter structure (fill in real values):',
    '',
    '```',
    '---',
    'id: "' + id + '"',
    'title: "(slice title)"',
    'from: bashir',
    'to: nog',
    'status: DONE',
    'slice_id: "' + id + '"',
    'branch: "' + sliceBranch + '"',
    'completed: "' + new Date().toISOString() + '"',
    'tokens_in: 0',
    'tokens_out: 0',
    'elapsed_ms: 0',
    'estimated_human_hours: 0.0',
    'compaction_occurred: false',
    '---',
    '```',
    '',
    'Leave tokens_in, tokens_out and elapsed_ms at 0; the orchestrator fills them from the session. estimated_human_hours is optional: your honest guess of how long a skilled human would take, or 0. compaction_occurred is true only if your context was compacted mid-session.',
    '- completed: must be full ISO 8601 UTC datetime (e.g. "2026-04-12T01:22:40.000Z"), never date-only',
  ].join('\n');

  // Build the non-gate prompt
  const prompt = buildBashirNonGatePrompt(sliceContent) + doneTemplate;

  const pickupTime = Date.now();
  let lastActivityTs = Date.now();
  let killedByInactivity = false;
  currentLastActivityTs = new Date();

  heartbeatState.status = 'processing';
  heartbeatState.current_slice = id;
  heartbeatState.current_slice_title = title || null;
  heartbeatState.current_slice_goal = goal || null;
  heartbeatState.pickupTime = pickupTime;
  writeHeartbeat();

  log('info', 'invoke', {
    id,
    msg: 'Invoking Bashir (non-gate) via claude -p',
    command: config.claudeCommand,
    args: config.claudeArgs,
    cwd: worktreePath,
    inactivityTimeoutMs: effectiveInactivityMs,
  });

  // Progress tick: every 60s while Bashir is running
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  let abortHandled = false;

  const child = execFile(
    config.claudeCommand,
    config.claudeArgs,
    {
      cwd: worktreePath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      clearInterval(tickInterval);
      clearInterval(inactivityCheck);
      clearInterval(heartbeatPoll);
      currentLastActivityTs = null;

      const durationMs = Date.now() - pickupTime;

      // Release mutex
      releaseGateMutex('bashir_non_gate_complete', ctx);
      registerEvent(id, 'LOCK_RELEASED', { lock: 'bashir_mutex', branch: sliceBranch });

      if (err && !killedByInactivity) {
        log('error', 'invoke', { id, msg: 'Bashir (non-gate) exited with error', error: err.message, code: err.code, durationMs });
        writeErrorFile(errorPath, id, 'bashir_crash', err, stdout || '', stderr || '');
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: 'bashir_crash' });
        registerEvent(id, 'ERROR', {
          reason: 'bashir_crash',
          phase: 'execution',
          exit_code: err.code,
          stderr_tail: truncStderr(stderr || err.message),
        });
        appendOperationalEvent({
          event: 'ERROR',
          slice_id: id,
          root_id: sliceMeta.root_commission_id || null,
          cycle: null,
          branch: sliceBranch,
          details: `Bashir (non-gate) crashed: ${err.message}`,
        });
        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_title = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        writeHeartbeat();
        return;
      }

      if (killedByInactivity) {
        log('warn', 'invoke', { id, msg: 'Bashir (non-gate) killed by inactivity', durationMs });
        writeErrorFile(errorPath, id, 'inactivity_timeout', null, stdout || '', stderr || '');
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: 'inactivity_timeout' });
        registerEvent(id, 'ERROR', {
          reason: 'inactivity_timeout',
          phase: 'execution',
          exit_code: null,
          stderr_tail: truncStderr(stderr || ''),
        });
        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_title = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        writeHeartbeat();
        return;
      }

      // Success path: check Bashir wrote his DONE file
      try {
        if (fs.existsSync(worktreeDonePath)) {
          // Copy DONE file from worktree to main queue
          fs.copyFileSync(worktreeDonePath, donePath);
          log('info', 'complete', { id, msg: 'Bashir (non-gate) finished — DONE file present', durationMs });

          // Extract telemetry from DONE report
          const doneContent = fs.readFileSync(donePath, 'utf-8');
          const doneMeta = parseFrontmatter(doneContent);
          const tokensIn = doneMeta ? parseInt(doneMeta.tokens_in, 10) || 0 : 0;
          const tokensOut = doneMeta ? parseInt(doneMeta.tokens_out, 10) || 0 : 0;
          const costUsd = doneMeta ? parseFloat(doneMeta.cost_usd) || 0 : 0;

          registerEvent(id, 'DONE', {
            branch: sliceBranch,
            durationMs,
            tokensIn,
            tokensOut,
            costUsd,
            executor: 'bashir',
            mode: 'non-gate',
          });

          closeSliceBlock(true, durationMs, tokensIn, tokensOut, costUsd);
        } else {
          log('warn', 'invoke', { id, msg: 'Bashir (non-gate) exited without DONE file', durationMs });
          writeErrorFile(errorPath, id, 'no_done_file', null, stdout || '', stderr || '');
          registerEvent(id, 'ERROR', {
            reason: 'no_done_file',
            phase: 'execution',
            exit_code: 0,
            stderr_tail: truncStderr(stderr || ''),
          });
          closeSliceBlock(false, durationMs, 0, 0, 0, 'Bashir wrote no DONE file');
        }
      } catch (copyErr) {
        log('warn', 'worktree', { id, msg: 'Failed to copy Bashir DONE file from worktree', error: copyErr.message });
      }

      // Clean up IN_PROGRESS file
      try { if (fs.existsSync(inProgressPath)) fs.unlinkSync(inProgressPath); } catch (_) {}

      // Archive state files
      registerEvent(id, 'STATE_FILES_ARCHIVED', { branch: sliceBranch });

      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_slice = null;
      heartbeatState.current_slice_title = null;
      heartbeatState.current_slice_goal = null;
      heartbeatState.pickupTime = null;
      writeHeartbeat();
    }
  );

  // Track in activeChildren for pause/resume/abort
  activeChildren.set(id, { child, worktreePath });

  // Pipe prompt to Bashir's stdin
  child.stdin.write(prompt);
  child.stdin.end();

  // Update mutex with PID
  try {
    const mutex = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'state', 'gate-running.json'), 'utf-8'));
    mutex.bashir_pid = child.pid;
    mutex.mode = 'non-gate';
    mutex.slice_id = id;
    writeJsonAtomic(path.resolve(__dirname, 'state', 'gate-running.json'), mutex);
  } catch (_) { /* best effort */ }

  // Activity tracking on stdout/stderr
  if (child.stdout) {
    child.stdout.on('data', () => {
      lastActivityTs = Date.now();
      currentLastActivityTs = new Date();
    });
  }
  if (child.stderr) {
    child.stderr.on('data', () => {
      lastActivityTs = Date.now();
      currentLastActivityTs = new Date();
    });
  }

  // Inactivity check
  const inactivityCheck = setInterval(() => {
    const idle = Date.now() - lastActivityTs;
    if (idle > effectiveInactivityMs) {
      log('warn', 'invoke', { id, msg: 'Bashir (non-gate) inactivity timeout', idle_ms: idle, threshold_ms: effectiveInactivityMs });
      killedByInactivity = true;
      clearInterval(inactivityCheck);
      clearInterval(tickInterval);
      clearInterval(heartbeatPoll);
      try { child.kill('SIGTERM'); } catch (_) {}
    }
  }, 30000);

  // Heartbeat polling — check every 30s, abort if stale > 90s
  const heartbeatPoll = setInterval(() => {
    try {
      // Liveness by file mtime (OS clock), not Bashir's self-reported ts — same LLM-clock
      // fix as the gate poll (an LLM hallucinates timestamps, tripping a false stale).
      const age = Date.now() - fs.statSync(BASHIR_HEARTBEAT_PATH).mtimeMs;
      if (age > BASHIR_HEARTBEAT_STALE_MS) {
        log('warn', 'bashir_non_gate', { id, msg: 'Bashir heartbeat stale', age_ms: age });
        clearInterval(heartbeatPoll);
        clearInterval(tickInterval);
        clearInterval(inactivityCheck);
        abortHandled = true;
        killedByInactivity = true;
        try { child.kill('SIGTERM'); } catch (_) {}
      }
    } catch (_) {
      // Heartbeat file missing — don't abort immediately; inactivity timeout will catch it.
    }
  }, BASHIR_HEARTBEAT_POLL_MS);
}

/**
 * startGate()
 *
 * RETIRED (slice 363). This was the whole-of-dev regression gate the Ops merge button
 * fired: one Bashir run over every unmerged slice at once, started by a human press.
 * Julian's stage is per-slice and starts by itself when a slice lands on the integration
 * branch (startQaStage), so there is no press left to honour — and a second entry point
 * that could spawn Bashir behind the stage's back would take the mutex out from under a
 * running stage.
 *
 * Kept as a named refusal rather than deleted: /api/gate/start, the runbook and the
 * operator's muscle memory all still point here, and a caller deserves to be told where
 * the gate went instead of finding a missing function.
 *
 * Always throws; err.code === 'GATE_RETIRED'.
 */
function startGate() {
  const err = new Error(
    "The Ops gate no longer starts Julian's stage. The stage starts by itself for one " +
    'slice when that slice lands on the integration branch; the merge button only promotes.'
  );
  err.code = 'GATE_RETIRED';
  log('warn', 'gate', { msg: 'startGate() called — retired; the stage auto-starts per slice' });
  throw err;
}

// ---------------------------------------------------------------------------
// Julian's stage — the IN_QA state (slice 363)
// ---------------------------------------------------------------------------
//
// One slice, one stage. It starts by itself when the slice lands on the integration
// branch — nobody presses anything — and it holds the gate mutex while it runs, which is
// what keeps the next accepted slice deferred behind it (the one-at-a-time behaviour the
// gate already had). Archival waits for it: the sweep that moves the brief and Nog's
// verdict to bridge/trash/ used to fire the instant the squash landed, which would have
// deleted the very files the packet is made of before the stage could read them.
//
// NOT here, on purpose: the verdict, the two red exits, and the Playwright run. Those are
// the next two slices. A half-built verdict path that can go green is worse than none, so
// this stage records that it ran and nothing more.

const QA_STAGE_TIMEOUT_MS = parseInt(process.env.DS9_QA_STAGE_TIMEOUT_S || '3600', 10) * 1000;
const QA_STAGE_HEARTBEAT_POLL_MS = BASHIR_HEARTBEAT_POLL_MS;
const QA_STAGE_HEARTBEAT_STALE_MS = BASHIR_HEARTBEAT_STALE_MS;

// How long the stage waits for Julian to actually be gone before it clears up after him.
// SIGTERM is where the stage ends, not where his process does: he may still be mid-write,
// and a file he creates in that window is exactly the one that blocks the next landing. So
// the sweep runs on his exit, or after this grace if the exit never comes.
const QA_LEFTOVER_GRACE_MS = 10 * 1000;

/** Where one stage's run is recorded. Start, end and outcome — the measurement ac-19 wants. */
function qaStageResultPath(id, opts) {
  const dir = (opts && opts.stateDir) || path.resolve(__dirname, 'state');
  return path.join(dir, `qa-stage-${id}.json`);
}

/**
 * qaStageSourceDoc(id, queueDir) → { path, suffix } | null
 *
 * The document the stage renames into {id}-IN_QA.md. Straight after a landing that is
 * {id}-ARCHIVED.md (the landing commit carries the report forward under its final name —
 * slice 395); on a repo-less fixture or a landing that found no ACCEPTED file it is still
 * {id}-ACCEPTED.md; on a re-run it is already the IN_QA file.
 */
function qaStageSourceDoc(id, queueDir) {
  for (const suffix of [qaStage.IN_QA_SUFFIX, '-ARCHIVED.md', '-ACCEPTED.md', '-DONE.md']) {
    const p = path.join(queueDir, `${id}${suffix}`);
    if (fs.existsSync(p)) return { path: p, suffix };
  }
  return null;
}

/**
 * setQaStageInBranchState(entry)
 *
 * The panel's source of truth for "who is in QA right now". Written here rather than
 * inferred from the mutex so a reload reads the same answer the stage started with.
 */
function setQaStageInBranchState(entry) {
  try {
    const bs = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
    bs.qa_stage = entry;
    writeJsonAtomic(BRANCH_STATE_PATH, bs);
  } catch (err) {
    log('warn', 'qa_stage', { msg: 'Could not record the stage in branch-state', error: err.message });
  }
}

/**
 * dirtyLockDeriverInputs(cwd) → [{ rel, untracked }]
 *
 * Every uncommitted lock-deriver input in a working tree, the way the landing's own guard
 * reads them (regenerateLocksAtLanding step 1): `-uall` because plain porcelain collapses
 * an untracked DIRECTORY to one `?? dir/` line, `porcelainPaths` because a rename names
 * two paths, `isLockDeriverInput` because runtime JSON under regression/ is not an input.
 *
 * `untracked` comes off the XY code: `??` is a file git has never seen, and it is the
 * difference between "delete it" and "put the committed content back" below. The raw
 * output is NOT trimmed — trimming eats the lead space off the first line and would read
 * ' M x' as an untracked file.
 */
function dirtyLockDeriverInputs(cwd) {
  const raw = execSync('git status --porcelain -uall', { cwd, encoding: 'utf-8' });
  const found = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const untracked = line.trim().startsWith('??');
    for (const rel of porcelainPaths(line)) {
      if (!isLockDeriverInput(rel)) continue;
      if (found.some(f => f.rel === rel)) continue;
      found.push({ rel, untracked });
    }
  }
  return found;
}

/**
 * quarantineQaLeftovers(id, startSet, opts) → { paths, dir }
 *
 * Julian runs in the live working tree, and three stages out of three since the 09-24
 * restart ended stage_error with an untracked e2e/*.spec.js still sitting in it. The
 * landing that came next refused — rightly: the lock derivers read the tree, so a stray
 * test file would be written into a lock that is supposed to describe the committed suite.
 * The guard stays; what was missing is anyone clearing up after the stage. Julian must
 * never hold up a landing.
 *
 * So when the stage ends, whatever lock-deriver input Julian left uncommitted is MOVED to
 * bridge/quarantine/qa-<id>/<path> — kept, never deleted, because it may be most of a
 * browser test somebody wants — and the tree is left as the commit has it.
 *
 * `startSet` is the list of paths that were already uncommitted when the stage STARTED.
 * The tree is shared (a person's edit, Sam's autocommit before a checkout), so only what
 * was not already dirty is Julian's; a path in startSet is left exactly where it is,
 * whether or not it changed during the stage. Moving one would delete somebody's work.
 *
 * No leftovers means no event: an ordinary stage leaves the register alone.
 */
function quarantineQaLeftovers(id, startSet, opts) {
  opts = opts || {};
  id = String(id);
  const cwd = opts.repoRoot || PROJECT_DIR;
  const relDir = path.join('bridge', 'quarantine', `qa-${id}`);
  const quarantineDir = opts.quarantineDir || path.join(cwd, relDir);
  const already = new Set(startSet || []);

  let dirty;
  try {
    dirty = dirtyLockDeriverInputs(cwd);
  } catch (err) {
    // The sweep is a courtesy to the next landing, never a reason to fail a stage.
    log('warn', 'qa_stage', { id, msg: 'Could not read the working tree for stage leftovers', error: err.message });
    return { paths: [], dir: relDir };
  }

  const moved = [];
  for (const { rel, untracked } of dirty) {
    if (already.has(rel)) continue;
    const from = path.join(cwd, rel);
    // The OLD half of a rename names a path that is no longer on disk; the new half is
    // the one carrying the content.
    if (!fs.existsSync(from)) continue;
    const to = path.join(quarantineDir, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // Copy first, then clear: if the clearing step fails the file is still both places
      // and the next landing says so, rather than the content being gone.
      fs.copyFileSync(from, to);
      if (untracked) {
        fs.rmSync(from);
        // A file git has never seen may still have been `git add`ed by a session that
        // then died. --ignore-unmatch makes this a no-op for the ordinary case and stops
        // a staged phantom deletion reaching the landing's index.
        try { execSync(`git rm --cached --quiet --ignore-unmatch -- ${shQuote(rel)}`, { cwd, stdio: 'pipe' }); } catch (_) {}
      } else {
        // Tracked: the committed content goes back in the tree (index and worktree both,
        // so the path reads clean), and Julian's version lives on in the quarantine.
        execSync(`git checkout HEAD -- ${shQuote(rel)}`, { cwd, stdio: 'pipe' });
      }
      moved.push(rel);
    } catch (err) {
      log('warn', 'qa_stage', { id, msg: 'Could not quarantine a stage leftover', path: rel, error: err.message });
    }
  }

  if (moved.length) {
    // `reason` says WHEN this pass ran — at the end of the stage, on Julian's exit, or after
    // the grace ran out. Which pass caught a file is how you tell a stage that left litter
    // from one that was still writing after it was told to stop.
    registerEvent(id, 'QA_LEFTOVERS_QUARANTINED', {
      slice_id: id, paths: moved, dir: relDir, reason: opts.reason || null,
    });
    log('warn', 'qa_stage', {
      id, msg: `Moved ${moved.length} file(s) Julian left behind into ${relDir}`, paths: moved,
      reason: opts.reason || null,
    });
  }
  return { paths: moved, dir: relDir };
}

/**
 * startQaStage(id, opts) → { started, reason, inQaPath? }
 *
 * opts: { branchName, title, sha, queueDir, trashDir, stateDir, spawn }
 *
 * `opts.spawn(prompt, ctx)` is the seam that puts Julian on the end of this. It returns a
 * child (or null for "nothing spawned"); the default spawns `claude -p`. A stage with no
 * child still holds the mutex and still shows in Ops — finishQaStage is what ends it.
 *
 * `opts.leftoverGraceMs` is the other seam: how long the end of the stage waits for
 * Julian's process to be gone before it clears up after him (QA_LEFTOVER_GRACE_MS).
 */
function startQaStage(id, opts) {
  opts = opts || {};
  id = String(id);
  const queueDir = opts.queueDir || QUEUE_DIR;
  const trashDir = opts.trashDir || TRASH_DIR;
  const branchName = opts.branchName || `slice/${id}`;
  const ctx = { registerEvent, log };
  // The mutex is real machine state under bridge/state/, shared with a live daemon, so it
  // is a seam: a test drives the stage without ever creating the file the running
  // orchestrator reads to decide whether to defer a real slice.
  const acquire = (opts.mutex && opts.mutex.acquire) || acquireGateMutex;
  const release = (opts.mutex && opts.mutex.release) || releaseGateMutex;

  // 1. The mutex IS the one-at-a-time rule. A squash defers while it is held, so after a
  //    landing it is free by construction; if it is not, say so rather than double-start.
  const mutex = acquire(opts.sha || null, null, 'bridge/state/bashir-heartbeat.json', ctx);
  if (!mutex.ok) {
    log('warn', 'qa_stage', { id, msg: 'Stage not started — gate mutex already held', reason: mutex.reason });
    return { started: false, reason: 'mutex_held' };
  }

  // 1b. What is ALREADY dirty in the tree Julian is about to work in. The tree is shared,
  //     so this is the line between his leftovers and somebody else's uncommitted work:
  //     the sweep at the end of the stage moves only what is not in here. A read that
  //     FAILS leaves this null and disables the sweep entirely — an empty baseline would
  //     read a person's unfinished test as Julian's litter and move it.
  let leftoverBaseline = null;
  try {
    leftoverBaseline = dirtyLockDeriverInputs(opts.repoRoot || PROJECT_DIR).map(f => f.rel);
  } catch (err) {
    log('warn', 'qa_stage', { id, msg: 'Could not record what was already dirty — leftover sweep disabled for this stage', error: err.message });
  }

  // 2. The packet, assembled while the brief and the verdict are still where they are.
  //    This is why archival moved: after archiveSiblingStateFiles both are in the trash.
  let packet;
  try {
    packet = qaStage.assemblePacket(id, {
      queueDir, trashDir, repoRoot: PROJECT_DIR, sha: opts.sha || null,
      runGit: opts.runGit || gitFinalizer.runGit,
    });
  } catch (err) {
    release('qa_stage_start_failed', ctx);
    log('error', 'qa_stage', { id, msg: 'Could not assemble the packet', error: err.message });
    return { started: false, reason: 'packet_failed', error: err.message };
  }

  // 3. The sticker becomes the live file, under the IN_QA name. What survives archive is
  //    now the whole record — brief with every review round, report, verdict, and the slot
  //    Julian's result lands in — not just the builder's report.
  const inQaPath = path.join(queueDir, `${id}${qaStage.IN_QA_SUFFIX}`);
  const source = qaStageSourceDoc(id, queueDir);
  try {
    // Idempotent: a stage that runs twice for one slice must not wrap the record in a
    // second record. If the IN_QA file is already a sticker, it stays exactly as it is —
    // whatever has been appended to it since is part of the record now.
    const already = source && source.path === inQaPath && qaStage.isSticker(qaStage.readIfPresent(inQaPath));
    if (!already) {
      fs.writeFileSync(inQaPath, qaStage.buildSticker(id, packet, { title: opts.title || null }));
      if (source && source.path !== inQaPath) fs.unlinkSync(source.path);
    }
  } catch (err) {
    release('qa_stage_start_failed', ctx);
    log('error', 'qa_stage', { id, msg: 'Could not write the IN_QA slice file', error: err.message });
    return { started: false, reason: 'rename_failed', error: err.message };
  }

  const startedTs = new Date().toISOString();
  registerEvent(id, 'IN_QA', {
    slice_id: id, branch: branchName, sha: opts.sha || null, started_ts: startedTs,
  });
  try {
    fs.writeFileSync(qaStageResultPath(id, opts), JSON.stringify({
      slice_id: id, branch: branchName, sha: opts.sha || null,
      started_ts: startedTs, ended_ts: null, outcome: null,
    }, null, 2) + '\n');
  } catch (_) { /* the register event is the record; this file is the measurement */ }

  setQaStageInBranchState({
    slice_id: id, title: opts.title || null, branch: branchName,
    started_ts: startedTs, status: 'IN_QA',
  });

  log('info', 'qa_stage', { id, msg: `Julian's stage started for slice ${id}`, branch: branchName });
  print(`${B.vert}    ${C.green}${SYM.check}${C.reset} IN_QA${SYM.sep}Julian is writing browser tests for slice ${id}`);

  // 4. Julian. The prompt is the packet and nothing else about the slice.
  let prompt;
  try {
    prompt = buildBashirPrompt(id, {
      packet,
      templatePath: BASHIR_PROMPT_TEMPLATE,
      heartbeatPath: 'bridge/state/bashir-heartbeat.json',
    });
  } catch (err) {
    log('error', 'qa_stage', { id, msg: 'Could not build the stage prompt', error: err.message });
    finishQaStage(id, 'stage_error', Object.assign({}, opts, { detail: `prompt_failed: ${err.message}` }));
    return { started: false, reason: 'prompt_failed', error: err.message };
  }

  const spawn = Object.prototype.hasOwnProperty.call(opts, 'spawn') ? opts.spawn : defaultQaSpawn;
  if (typeof spawn !== 'function') return { started: true, reason: 'ok', inQaPath, spawned: false };

  let child = null;
  try {
    child = spawn(prompt, { id, branchName, opts });
  } catch (err) {
    log('error', 'qa_stage', { id, msg: 'Could not spawn Julian', error: err.message });
    finishQaStage(id, 'stage_error', Object.assign({}, opts, { detail: `spawn_failed: ${err.message}` }));
    return { started: false, reason: 'spawn_failed', error: err.message };
  }
  if (!child) return { started: true, reason: 'ok', inQaPath, spawned: false };

  // 5. Liveness. Same two guards the gate always had, so a hung Julian cannot wedge the
  //    mutex and stall every slice behind him: heartbeat by FILE MTIME (an LLM has no
  //    clock and hallucinates its own timestamps) and an absolute wall-clock cap.
  let settled = false;
  const settle = (outcome, detail) => {
    if (settled) return;
    settled = true;
    clearInterval(heartbeatPoll);
    clearTimeout(absoluteTimeout);
    // Clear up NOW, before the stage is recorded — finishQaStage ends by draining the
    // slices that deferred behind this stage, and that drain squashes them in this same
    // tick. A landing that runs before the clear-up is the landing this slice exists to
    // stop failing. Then arm the second pass for whatever he writes on his way out.
    sweepLeftovers('stage_ended');
    armFinalSweep();
    finishQaStage(id, outcome, Object.assign({}, opts, { detail }));
  };

  // The clear-up. Two passes, because SIGTERM is where the stage ends and not where Julian
  // does: one the moment the stage ends, so the next landing sees a clean tree, and one when
  // he is actually gone, for the file he wrote while dying. Both are no-ops when there is
  // nothing of his to move, and both refuse to run at all unless the baseline above could be
  // read — a sweep without a baseline is a guess about whose work it is moving.
  const graceMs = typeof opts.leftoverGraceMs === 'number' ? opts.leftoverGraceMs : QA_LEFTOVER_GRACE_MS;
  let finalSwept = false;
  let sweepTimer = null;
  const sweepLeftovers = (reason) => {
    if (!Array.isArray(leftoverBaseline)) return;
    try {
      quarantineQaLeftovers(id, leftoverBaseline, { repoRoot: opts.repoRoot || PROJECT_DIR, reason });
    } catch (err) {
      log('warn', 'qa_stage', { id, msg: 'Leftover sweep threw (non-fatal)', error: err.message, reason });
    }
  };
  const finalSweep = (reason) => {
    if (finalSwept) return;
    finalSwept = true;
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepLeftovers(reason);
  };
  const armFinalSweep = () => {
    if (finalSwept || sweepTimer) return;
    sweepTimer = setTimeout(() => finalSweep('grace_expired'), graceMs);
    // A stage ending must not hold the process open for the grace on its own account.
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  };

  // The heartbeat file and the two liveness clocks are seams for the same reason the mutex
  // is: bridge/state/bashir-heartbeat.json is TRACKED live state whose mtime says whether a
  // real Julian is alive, and a test that drove this stage against it would both dirty the
  // tree and make a dead session look alive. Defaults are the live constants.
  const heartbeatPath = opts.heartbeatPath || BASHIR_HEARTBEAT_PATH;
  const staleMs = typeof opts.heartbeatStaleMs === 'number' ? opts.heartbeatStaleMs : QA_STAGE_HEARTBEAT_STALE_MS;
  const pollMs = typeof opts.heartbeatPollMs === 'number' ? opts.heartbeatPollMs : QA_STAGE_HEARTBEAT_POLL_MS;
  const capMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : QA_STAGE_TIMEOUT_MS;

  try { writeJsonAtomic(heartbeatPath, { ts: new Date().toISOString() }); } catch (_) {}

  const heartbeatPoll = setInterval(() => {
    try {
      const age = Date.now() - fs.statSync(heartbeatPath).mtimeMs;
      if (age > staleMs) {
        log('warn', 'qa_stage', { id, msg: 'Julian heartbeat stale', age_ms: age });
        try { child.kill('SIGTERM'); } catch (_) {}
        settle('stage_error', 'heartbeat_stale');
      }
    } catch (_) { /* not written yet — the absolute cap is the backstop */ }
  }, pollMs);

  const absoluteTimeout = setTimeout(() => {
    log('warn', 'qa_stage', { id, msg: 'Julian stage absolute timeout', timeout_ms: capMs });
    try { child.kill('SIGTERM'); } catch (_) {}
    settle('stage_error', 'timeout');
  }, capMs);

  child.on('exit', (code) => {
    settle(code === 0 ? 'recorded' : 'stage_error', code === 0 ? null : `exit_${code}`);
    // He is gone, whether this exit ended the stage or followed the SIGTERM that did.
    // Nothing of his can appear after this, so clear up now instead of waiting the grace.
    finalSweep('julian_exited');
  });
  child.on('error', (err) => settle('stage_error', `spawn_error: ${err.message}`));

  return { started: true, reason: 'ok', inQaPath, spawned: true };
}

/**
 * defaultQaSpawn(prompt, { id })
 *
 * Julian headless, with the packet on stdin. The model and effort are set explicitly:
 * Bashir does not share config.claudeArgs (no stream-json here) and without them he
 * silently falls back to ANTHROPIC_MODEL.
 */
function defaultQaSpawn(prompt, { id }) {
  const args = ['-p', '--permission-mode', 'bypassPermissions', '--model', 'claude-opus-5', '--effort', 'max'];
  log('info', 'qa_stage', { id, msg: 'Spawning Julian for the stage', args, cwd: PROJECT_DIR });
  const child = execFile('claude', args, {
    // 256 MB, the same as Rom's (a8da61f). Item 7 of the packet is the live dashboard and
    // looking at it is half of what this stage does: a session that reads screenshots logs
    // 160-420 KB an image, and 10 MB is where slices 358 and 363 were killed mid-run with
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER. The streaming parser that drops the buffer
    // entirely is slice 396.
    cwd: PROJECT_DIR, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024,
  }, (err, stdout) => {
    try { fs.writeFileSync(BASHIR_STDOUT_LOG, stdout || '', 'utf-8'); } catch (_) {}
    if (err) log('warn', 'qa_stage', { id, msg: 'Julian exited with error', error: err.message });
  });
  try {
    child.stdin.write(prompt);
    child.stdin.end();
  } catch (_) { /* the exit handler settles the stage either way */ }
  return child;
}

/**
 * finishQaStage(id, outcome, opts) → { recorded, archived }
 *
 * The stage records its result — and ONLY THEN does archival run. `outcome` is
 * 'recorded' or 'stage_error'; neither is a verdict. Green, red and the two red exits
 * belong to the third slice of this set, and inventing a green here would be the one
 * failure this stage cannot come back from.
 */
function finishQaStage(id, outcome, opts) {
  opts = opts || {};
  id = String(id);
  const branchName = opts.branchName || `slice/${id}`;
  const endedTs = new Date().toISOString();

  let startedTs = null;
  const resultPath = qaStageResultPath(id, opts);
  try { startedTs = JSON.parse(fs.readFileSync(resultPath, 'utf-8')).started_ts || null; } catch (_) {}
  try {
    fs.writeFileSync(resultPath, JSON.stringify({
      slice_id: id, branch: branchName, sha: opts.sha || null,
      started_ts: startedTs, ended_ts: endedTs, outcome: outcome || 'recorded',
      detail: opts.detail || null,
      elapsed_ms: startedTs ? (new Date(endedTs) - new Date(startedTs)) : null,
    }, null, 2) + '\n');
  } catch (err) {
    log('warn', 'qa_stage', { id, msg: 'Could not write the stage result file', error: err.message });
  }

  registerEvent(id, 'QA_STAGE_RECORDED', {
    slice_id: id, branch: branchName, outcome: outcome || 'recorded',
    detail: opts.detail || null, started_ts: startedTs, ended_ts: endedTs,
  });

  setQaStageInBranchState(null);
  const release = (opts.mutex && opts.mutex.release) || releaseGateMutex;
  try { release('qa_stage_recorded', { registerEvent, log }); } catch (_) {}

  // Archival, at last — after the result, not at squash.
  let archived = { archived: false, reason: 'not_attempted' };
  try {
    archived = archiveAcceptedSlice(id, branchName, {
      queueDir: opts.queueDir, trashDir: opts.trashDir, source: 'qa_stage',
    });
  } catch (err) {
    log('warn', 'archive', { id, msg: 'Post-stage archival failed (non-fatal)', error: err.message });
  }

  log('info', 'qa_stage', { id, msg: `Julian's stage recorded for slice ${id}`, outcome, archived: archived.archived });

  // The slices that deferred behind this stage now get their turn.
  try { drainDeferredAfterGate(); } catch (_) {}

  return { recorded: true, archived: archived.archived };
}

/**
 * startQaStageOrArchive(id, opts)
 *
 * What the landing paths call. The stage is the normal route; a stage that cannot start
 * must not strand the slice half-landed with its brief and verdict pinned in the queue
 * forever, so the archival it was holding runs immediately instead and the reason is on
 * the record.
 */
function startQaStageOrArchive(id, opts) {
  opts = opts || {};
  let result;
  try {
    result = startQaStage(id, opts);
  } catch (err) {
    log('error', 'qa_stage', { id, msg: 'Stage threw at start', error: err.message });
    result = { started: false, reason: 'threw', error: err.message };
  }
  if (result.started) return result;

  registerEvent(id, 'QA_STAGE_NOT_STARTED', { slice_id: String(id), reason: result.reason, error: result.error || null });
  log('warn', 'qa_stage', { id, msg: 'Stage did not start — archiving now so the slice is not stranded', reason: result.reason });
  try {
    archiveAcceptedSlice(id, opts.branchName || `slice/${id}`, {
      queueDir: opts.queueDir, trashDir: opts.trashDir, source: 'qa_stage_not_started',
    });
  } catch (err) {
    log('warn', 'archive', { id, msg: 'Fallback archival failed (non-fatal)', error: err.message });
  }
  return result;
}

/**
 * recoverOrphanedQaStages(opts) → actions[]
 *
 * Startup recovery for a slice left wearing {id}-IN_QA.md by a daemon that died mid-stage.
 * It runs AFTER recoverGateMutex(), and the order is the point: recoverGateMutex keeps the
 * mutex when Julian's heartbeat is still fresh ("gate is in flight, resuming wait"), which
 * is exactly the case of a stage that outlived the daemon that spawned it. Finishing that
 * stage from here would record stage_error, archive his slice and pull the mutex out from
 * under him while he is still writing — so a mutex that survived recovery means the stage
 * is his, and we leave it alone.
 *
 * With the mutex gone the stage died with the daemon, and then the slice must not stay
 * pinned in QA forever: it is already on the integration branch, and its worktree, its
 * branch and its ARCHIVED event are all waiting on a result that will never come. Record
 * stage_error and let archival run. Re-running the stage is not done here; that is the
 * third slice's business.
 */
function recoverOrphanedQaStages(opts) {
  opts = opts || {};
  const queueDir = opts.queueDir || QUEUE_DIR;
  const actions = [];

  let files;
  try {
    files = fs.readdirSync(queueDir).filter(f => f.endsWith(qaStage.IN_QA_SUFFIX));
  } catch (err) {
    log('warn', 'startup_recovery', { msg: 'Cannot read queue dir for IN_QA recovery', error: err.message });
    return actions;
  }
  if (!files.length) return actions;

  // The mutex is machine state shared with a live daemon, so reading it is a seam too: a
  // test must never have its answer depend on whether a real stage happens to be running.
  const mutexHeld = (opts.mutex && opts.mutex.held) || shouldDeferSquash;
  if (mutexHeld()) {
    log('info', 'startup_recovery', {
      msg: 'IN_QA slices left alone — the gate mutex survived recovery, so a stage is still in flight',
      ids: files.map(f => f.replace(qaStage.IN_QA_SUFFIX, '')),
    });
    return actions;
  }

  for (const file of files) {
    const id = file.replace(qaStage.IN_QA_SUFFIX, '');
    try {
      finishQaStage(id, 'stage_error', {
        branchName: `slice/${id}`, detail: 'orphaned_by_restart',
        queueDir: opts.queueDir, trashDir: opts.trashDir, stateDir: opts.stateDir,
        mutex: opts.mutex,
      });
      log('warn', 'startup_recovery', { id, msg: 'Orphaned IN_QA stage recorded and archived', action: 'qa-stage-orphan' });
      actions.push({ id, type: 'qa_stage_orphan' });
    } catch (err) {
      log('warn', 'startup_recovery', { id, msg: 'Could not recover orphaned IN_QA slice', error: err.message });
    }
  }
  return actions;
}


/**
 * _checkForEvent(eventName, afterTs)
 *
 * Scans register.jsonl for an event with the given name that occurred after afterTs.
 */
function _checkForEvent(eventName, afterTs) {
  try {
    const registerPath = path.resolve(__dirname, 'register.jsonl');
    const lines = fs.readFileSync(registerPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      // Per-line guard: a single malformed line (register.jsonl has had corrupt
      // entries) must NOT poison the whole scan and cause a false-negative miss.
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      if (entry.event === eventName && entry.ts >= afterTs) {
        return entry;
      }
    }
  } catch (_) { /* register unreadable */ }
  return null;
}

/**
 * _parseFailedAcs(output)
 *
 * Parses Node-native test runner output for failing tests.
 * Handles both spec format (default: lines like "✖ test name") and
 * TAP format (lines like "not ok N - test name").
 * Returns an array of { slice_id, ac_index, test_path, failure_excerpt }
 * and a boolean indicating whether any naming violations were found.
 */
function _parseFailedAcs(output) {
  const failedAcs = [];
  let hasNamingViolation = false;
  const seen = new Set(); // dedupe — spec format repeats failures in summary

  const lines = output.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Match spec-format fail: "✖ <test name> (<duration>)"
    // Also match TAP "not ok N - <description>"
    const specFail = line.match(/^\u2716\s+(.*?)(?:\s+\(\d[\d.]*m?s\))?$/);
    const tapFail = line.match(/^not ok \d+\s*-?\s*(.*)/);
    const match = specFail || tapFail;

    if (match) {
      const testDesc = match[1].trim();

      // Skip node:test structural lines (e.g. the "✖ failing tests:" section header)
      // that match the failure regex but are not real test cases.
      if (testDesc === '' || testDesc === 'failing tests:' || testDesc === 'tests:') { i++; continue; }

      // Dedupe: skip if we've already recorded this test
      if (seen.has(testDesc)) { i++; continue; }
      seen.add(testDesc);

      // Collect failure excerpt from subsequent indented/diagnostic lines
      const excerptLines = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].startsWith('  ') || lines[j].startsWith('#') || lines[j].startsWith('\u2139'))) {
        excerptLines.push(lines[j]);
        j++;
      }
      const excerpt = excerptLines.slice(0, 10).join('\n').trim();

      // Try to extract slice/AC from test name
      const acMatch = testDesc.match(AC_NAMING_RE);
      if (acMatch) {
        failedAcs.push({
          slice_id: acMatch[1],
          ac_index: parseInt(acMatch[2], 10),
          test_path: testDesc,
          failure_excerpt: excerpt,
        });
      } else {
        hasNamingViolation = true;
        failedAcs.push({
          slice_id: 'unknown',
          ac_index: -1,
          test_path: testDesc,
          failure_excerpt: excerpt,
        });
      }
    }
    i++;
  }

  return { failedAcs, hasNamingViolation };
}

/**
 * _parseSuiteSize(output)
 *
 * Extracts suite size from Node-native test runner output.
 * Handles spec format ("ℹ tests N"), TAP ("1..N"), and summary ("# tests N").
 */
function _parseSuiteSize(output) {
  // Spec format: "ℹ tests N"
  const specMatch = output.match(/\u2139 tests (\d+)/);
  if (specMatch) return parseInt(specMatch[1], 10);
  // TAP plan line: "1..N"
  const planMatch = output.match(/^1\.\.(\d+)/m);
  if (planMatch) return parseInt(planMatch[1], 10);
  // TAP summary: "# tests N"
  const testsMatch = output.match(/# tests (\d+)/);
  if (testsMatch) return parseInt(testsMatch[1], 10);
  return 0;
}

/**
 * _gateTestsUpdated(devTipSha, ctx)
 *
 * Called when Bashir emits tests-updated. Spawns the regression suite
 * runner, parses results, emits regression-pass or regression-fail,
 * and updates branch-state accordingly. Mutex held on pass; released on fail.
 */
function _gateTestsUpdated(devTipSha, ctx) {
  const startMs = Date.now();

  log('info', 'gate', { msg: 'Running regression suite', devTipSha });

  const runnerArgs = ['--test', 'regression/**/*.test.js'];
  let timedOut = false;

  const child = execFile(
    'node',
    runnerArgs,
    {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: REGRESSION_TIMEOUT_MS,
    },
    (err, stdout, stderr) => {
      const durationMs = Date.now() - startMs;

      // Persist stdout/stderr to logs
      try { fs.writeFileSync(REGRESSION_STDOUT_LOG, stdout || '', 'utf-8'); } catch (_) {}
      try { fs.writeFileSync(REGRESSION_STDERR_LOG, stderr || '', 'utf-8'); } catch (_) {}

      // Feed Bashir's findings back to O'Brien: turn the log we just wrote into a
      // readable report (regression/LAST-RUN.md) and, on failure, route a handoff to
      // O'Brien's inbox so a fix slice gets authored. Best-effort, fire-and-forget —
      // wrapped so it can never affect the gate's pass/fail outcome below.
      try {
        execFile('node', [path.join(PROJECT_DIR, 'scripts', 'regression-report.js'), '--from-log'],
          { cwd: PROJECT_DIR, timeout: 30000 }, () => {});
      } catch (_) {}

      // Handle timeout (execFile sets err.killed=true, err.signal='SIGTERM' on timeout)
      if (err && err.killed) {
        timedOut = true;
        log('warn', 'gate', { msg: 'Regression suite timed out', timeout_ms: REGRESSION_TIMEOUT_MS });

        emitGateTelemetry('regression-fail', {
          failed_acs: [],
          reason: 'suite-timeout',
        });

        _updateBranchStateOnFail(devTipSha, []);
        releaseGateMutex('regression_fail', ctx);
        drainDeferredAfterGate();
        return;
      }

      const output = (stdout || '') + '\n' + (stderr || '');

      if (!err) {
        // All tests passed (exit code 0)
        const suiteSize = _parseSuiteSize(output);

        emitGateTelemetry('regression-pass', {
          suite_size: suiteSize,
          duration_ms: durationMs,
        });

        // Update branch-state: record last_pass, keep status GATE_RUNNING
        let state;
        try {
          state = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
        } catch (_) {
          state = { gate: {} };
        }
        state.gate = state.gate || {};
        state.gate.last_pass = { ts: new Date().toISOString(), dev_tip_sha: devTipSha };
        writeJsonAtomic(BRANCH_STATE_PATH, state);

        // Slice 269: trigger dev → main merge while mutex is held
        log('info', 'gate', { msg: 'Regression suite passed, triggering dev → main merge', suite_size: suiteSize, duration_ms: durationMs });
        mergeDevToMain();
        return;
      }

      // At least one test failed (exit code non-zero)
      const { failedAcs, hasNamingViolation } = _parseFailedAcs(output);

      if (hasNamingViolation) {
        registerEvent('gate', 'BASHIR_TEST_NAMING_VIOLATION', {
          msg: 'One or more failing tests do not follow slice-<id>-ac-<index> naming convention',
          dev_tip_sha: devTipSha,
        });
      }

      emitGateTelemetry('regression-fail', { failed_acs: failedAcs });

      _updateBranchStateOnFail(devTipSha, failedAcs);
      releaseGateMutex('regression_fail', ctx);
      drainDeferredAfterGate();

      log('info', 'gate', { msg: 'Regression suite failed', failed_count: failedAcs.length });
    }
  );
}

/**
 * _updateBranchStateOnFail(devTipSha, failedAcs)
 *
 * Sets gate.status to GATE_FAILED, clears current_run, records last_failure.
 */
function _updateBranchStateOnFail(devTipSha, failedAcs) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  } catch (_) {
    state = { gate: {} };
  }
  state.gate = state.gate || {};
  state.gate.status = 'GATE_FAILED';
  state.gate.current_run = null;
  state.gate.last_failure = {
    ts: new Date().toISOString(),
    dev_tip_sha: devTipSha,
    failed_acs: failedAcs,
  };
  writeJsonAtomic(BRANCH_STATE_PATH, state);
}

/**
 * _gateAbort(devTipSha, reason, ctx)
 *
 * Called when Bashir crashes, times out, or heartbeat goes stale.
 * Emits gate-abort, updates branch-state, releases mutex.
 */
function _gateAbort(devTipSha, reason, ctx) {
  emitGateTelemetry('gate-abort', { dev_tip_sha: devTipSha, reason });

  let state;
  try {
    state = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  } catch (_) {
    state = { gate: {} };
  }
  state.gate = state.gate || {};
  state.gate.status = 'GATE_ABORTED';
  state.gate.current_run = null;
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  releaseGateMutex('gate_abort', ctx);
  drainDeferredAfterGate();
}

// ---------------------------------------------------------------------------
// Gate abort — user-initiated abort from GATE_FAILED state (slice 271)
// ---------------------------------------------------------------------------

/**
 * abortGate()
 *
 * User-initiated abort after a gate failure. Only valid when gate.status is
 * GATE_FAILED or GATE_ABORTED. Transitions state to ACCUMULATING (not IDLE —
 * dev still has commits ahead of main). Preserves last_failure for audit trail.
 * Emits gate-abort telemetry with reason "user-abort".
 *
 * If gate-running.json is somehow present (state corruption), releases the
 * mutex defensively.
 *
 * Returns the updated gate state object.
 * Throws if gate.status is not GATE_FAILED or GATE_ABORTED.
 */
function abortGate() {
  const ctx = { registerEvent, log };

  // 1. Read current branch-state
  let branchState;
  try {
    branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  } catch (err) {
    throw new Error('Cannot read branch-state.json: ' + err.message);
  }

  const gateStatus = branchState.gate ? branchState.gate.status : 'IDLE';

  // 2. Validate state — only GATE_FAILED or GATE_ABORTED allowed
  if (gateStatus !== 'GATE_FAILED' && gateStatus !== 'GATE_ABORTED') {
    const err = new Error('Gate abort only valid from GATE_FAILED or GATE_ABORTED state');
    err.code = 'INVALID_STATE';
    err.status = gateStatus;
    throw err;
  }

  // 3. Update branch-state: ACCUMULATING, preserve last_failure
  const ts = new Date().toISOString();
  branchState.gate.status = 'ACCUMULATING';
  branchState.gate.current_run = null;
  // last_failure intentionally preserved for audit trail
  writeJsonAtomic(BRANCH_STATE_PATH, branchState);

  // 4. Emit gate-abort telemetry
  emitGateTelemetry('gate-abort', { reason: 'user-abort', ts });

  // 5. Defensive mutex cleanup — should already be released by regression-fail
  const mutexPath = path.resolve(__dirname, 'state', 'gate-running.json');
  try {
    fs.accessSync(mutexPath);
    // Mutex is present (state corruption) — release defensively
    releaseGateMutex('gate-abort', ctx);
    drainDeferredAfterGate();
  } catch (_) {
    // Mutex absent — expected, nothing to do
  }

  log('info', 'gate', { msg: 'Gate aborted by user', from: gateStatus, ts });

  return branchState.gate;
}

// ---------------------------------------------------------------------------
// Squash slice → dev (slice 266)
// ---------------------------------------------------------------------------

/**
 * isLockDeriverInput(p)
 *
 * Does this working-tree path feed one of the two lock derivers? The derivers walk the
 * test files on disk, so an uncommitted test file in the live tree would be baked into a
 * lock that is supposed to describe the committed suite. Runtime JSON that merely LIVES
 * under regression/ (regression/AC-CHECK.json and friends) is not an input and must not
 * block a landing — the crew's live tree nearly always has some.
 */
function isLockDeriverInput(p) {
  const rel = String(p).split(path.sep).join('/');
  return /^regression\/.*\.test\.js$/.test(rel)
    || /^e2e\/.*\.spec\.js$/.test(rel)
    || LOCK_FILES.includes(rel);
}

/**
 * newestDoneEvent(sliceId, regFile)
 *
 * The most recent DONE register entry for a slice, or null. Newest wins because a slice
 * that came back for a second round has a DONE per round, and the landed report should
 * carry the session that actually produced the landed code.
 */
function newestDoneEvent(sliceId, regFile) {
  let newest = null;
  for (const line of _getRegLines(regFile || REGISTER_FILE)) {
    try {
      const e = JSON.parse(line);
      if (!e || e.event !== 'DONE' || String(e.slice_id) !== String(sliceId)) continue;
      // >= on a forward scan: on equal timestamps the later line wins, which is append order.
      if (!newest || String(e.ts || '') >= String(newest.ts || '')) newest = e;
    } catch (_) {}
  }
  return newest;
}

/**
 * refillLandedDoneReport(sliceId)
 *
 * Rewrite the metric fields of the DONE report inside the landing tree from the register.
 *
 * The squash replays the builder's tree onto dev, and his committed copy of the report
 * carries the zeros the template told him to leave. The real numbers were measured by the
 * watcher when his session ended and written to the register; the copy in bridge/queue/
 * that fillDoneMetrics already filled is gitignored and was just overwritten by his
 * committed one. So fill it again here, where the file is about to become permanent.
 *
 * Never fatal: the locks are the integrity-critical half of the amend, and a report that
 * still reads zero is worth less than a landing that fails.
 */
function refillLandedDoneReport(sliceId, relOverride) {
  // Slice 395: the landing also folds in the archive rename, so by the time the
  // metrics go in the report may already be tracked as {id}-ARCHIVED.md. Fill the
  // name the commit is about to carry — the other one is untracked and ignored.
  const rel = relOverride || `bridge/queue/${sliceId}-DONE.md`;
  const abs = path.join(PROJECT_DIR, rel.split('/').join(path.sep));

  const ev = newestDoneEvent(sliceId);
  if (!ev) {
    log('warn', 'squash-to-dev', { sliceId, msg: `no DONE register event for this slice — ${rel} lands with the metrics as committed` });
    return;
  }
  let content;
  try {
    content = fs.readFileSync(abs, 'utf-8');
  } catch (_) {
    log('warn', 'squash-to-dev', { sliceId, msg: `no ${rel} in the landing tree — metrics not re-filled` });
    return;
  }

  // The register event spells the elapsed time durationMs; fillDoneMetrics wants elapsedMs.
  const filled = fillDoneMetrics(content, {
    tokensIn: ev.tokensIn,
    tokensOut: ev.tokensOut,
    tokensCacheRead: ev.tokensCacheRead,
    costUsd: ev.costUsd,
    elapsedMs: ev.durationMs,
  });
  try {
    fs.writeFileSync(abs, filled);
    // -f: bridge/queue/*.md is gitignored (.gitignore:20), so a plain add is a silent no-op
    // and the report would land with the zeros still in it.
    execSync(`git add -f -- ${shQuote(rel)}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (err) {
    log('warn', 'squash-to-dev', { sliceId, msg: `could not stage the re-filled ${rel}`, error: err.message });
  }
}

/**
 * regenerateLocksAtLanding(sliceId, sliceBranch, preSquashSha)
 *
 * Fold a fresh regeneration of the two lock files — and the landed report's real metrics —
 * into the squash commit. Returns { success: true } or { success: false, error }.
 *
 * Order is the whole point: build-ac-manifest reads the `AC:` trailers from HEAD, and
 * those trailers exist only once the squash commit exists. Regenerating before the commit
 * would resolve every criterion this slice introduces to its slice-file fallback instead
 * of its trailer. So: commit, regenerate, amend. The amend happens strictly before the
 * push, inside the caller's DS9_WATCHER_MERGE env and its open Layer-2 lock, so no public
 * history is rewritten and the pre-commit hook lets it through.
 *
 * On any failure the landing is abandoned whole — locks restored, dev's tip rewound to
 * preSquashSha, an ERROR file written, nothing pushed — so the recovery run squashes again
 * from a clean tip rather than pushing a commit whose locks are known to be wrong.
 */
function regenerateLocksAtLanding(sliceId, sliceBranch, preSquashSha) {
  const quotedLocks = LOCK_FILES.map(shQuote).join(' ');

  // Set by step 1b below. Declared here so fail() can unwind it: the staged rename
  // and the ACCEPTED→ARCHIVED move must both come back if the amend never happens.
  let archive = null;

  const fail = (detail) => {
    log('error', 'squash-to-dev', { sliceId, msg: 'lock regeneration failed — rewinding dev and abandoning the landing', detail });

    // The archive rename joined this amend (slice 395). Unstage it and put the
    // ACCEPTED name back before anything else touches the index — a half-staged
    // index is exactly what the autocommit used to sweep into a nameless commit.
    revertQueueArchiveStaging(sliceId, archive);
    archive = null;

    // Put the regenerated locks back the way the commit has them, so the reset has
    // nothing of its own to refuse.
    try { execSync(`git checkout HEAD -- ${quotedLocks}`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}

    // --keep, never --hard: this is the LIVE main tree and it carries the crew's
    // uncommitted work. --keep reverts only the paths the squash changed and ABORTS
    // rather than overwriting a file that was modified locally. The autocommit that is
    // supposed to protect that work before the checkout is itself unreliable right now
    // (it dies on a type-change status line), which is exactly why --hard is unusable here.
    try {
      execSync(`git reset --keep ${preSquashSha}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (resetErr) {
      // Even an aborted reset gets the ERROR file: the operator must hear about a dev tip
      // sitting on a squash commit whose locks are wrong, and nothing was pushed either way.
      log('error', 'squash-to-dev', { sliceId, msg: 'git reset --keep aborted — dev local tip is still on the squash commit', error: resetErr.message });
    }

    recoverRuntimeStateAfterGit(`squash-${sliceBranch}`, sliceId);

    registerEvent(sliceId, 'ERROR', {
      slice_id: String(sliceId),
      reason: 'lock_regen_failed',
      detail,
    });

    const completed = new Date().toISOString();
    const errorContent = [
      '---',
      `id: "${sliceId}"`,
      `title: "Slice ${sliceId} — lock_regen_failed"`,
      'from: orchestrator',
      'to: chiefobrien',
      'status: ERROR',
      `slice_id: "${sliceId}"`,
      `completed: "${completed}"`,
      'reason: "lock_regen_failed"',
      '---',
      '',
      '## Lock regeneration failed at landing',
      '',
      `The squash commit for \`${sliceBranch}\` was made, but regenerating`,
      '`regression/COVERAGE.lock` and `regression/AC-MANIFEST.lock` into it failed.',
      `Nothing was pushed and dev's local tip was rewound to \`${preSquashSha}\`, so a`,
      'recovery run can squash this slice again.',
      '',
      '## Detail',
      '',
      '```',
      detail || '(no detail captured)',
      '```',
    ].join('\n');
    const errorPath = path.join(QUEUE_DIR, `${sliceId}-ERROR.md`);
    try { fs.writeFileSync(errorPath, errorContent); } catch (_) {}
    try { archiveSiblingStateFiles(sliceId, 'ERROR'); } catch (_) {}

    return { success: false, error: `lock_regen_failed: ${detail}` };
  };

  // 1. No deriver input may be dirty. The derivers read the working tree, so a stray
  //    uncommitted test file here would be written into a lock describing the committed
  //    suite — and the integrity gate would then fail on CI, where it does not exist.
  //    -uall because plain porcelain collapses an untracked DIRECTORY to one `?? dir/`
  //    line: the .test.js files inside it would pass this guard and still be read.
  let dirty = [];
  try {
    const raw = execSync('git status --porcelain -uall', { cwd: PROJECT_DIR, encoding: 'utf-8' });
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      for (const p of porcelainPaths(line)) {
        if (isLockDeriverInput(p) && !dirty.includes(p)) dirty.push(p);
      }
    }
  } catch (statusErr) {
    return fail(`git status failed: ${statusErr.message}`);
  }
  if (dirty.length) {
    return fail(`uncommitted lock-deriver inputs in the working tree: ${dirty.join(', ')}`);
  }

  // 1b. The archive rename joins this amend, so one landing is one commit (slice 395).
  //     Strictly BEFORE the regeneration: build-ac-manifest derives from the git INDEX
  //     and cites an untrailered criterion's slice file by path, so a rename staged
  //     afterwards would leave the committed lock naming a path its own commit does
  //     not hold — and CI re-derives that lock. Not fatal on its own: a landing whose
  //     paperwork could not be staged is still a landing, and the recorder that has
  //     always followed archival picks the rename up in its own commit.
  archive = stageQueueArchiveForLanding(sliceId);

  // 2. Regenerate. Both derivers are pure over the tree plus (for the manifest) the
  //    trailers reachable from HEAD — which is now the squash commit.
  for (const script of ['scripts/build-coverage-map.js', 'scripts/build-ac-manifest.js']) {
    try {
      execSync(`node ${script}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (runErr) {
      const stderr = String((runErr && runErr.stderr) || '').trim().slice(0, 500);
      return fail(`${script} exited non-zero: ${stderr || runErr.message}`);
    }
  }

  // 3. Stage the locks if either moved. The branch's own copies came across with the
  //    squash; this is what overwrites them.
  let locksMoved = false;
  try {
    locksMoved = execSync(`git status --porcelain -- ${quotedLocks}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim().length > 0;
  } catch (_) {}
  if (locksMoved) {
    try {
      execSync(`git add -- ${quotedLocks}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (addErr) {
      return fail(`git add of the lock files failed: ${addErr.message}`);
    }
  }

  // 4. The landed report's real numbers, from the same amend — under the name the
  //    rename above just gave it, if it gave it one.
  refillLandedDoneReport(sliceId, (archive && archive.reportRel) || null);

  // 5. One commit, not two: the slice lands as a single commit with correct locks.
  try {
    execSync('git commit --amend --no-edit', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (amendErr) {
    return fail(`git commit --amend failed: ${amendErr.message}`);
  }

  log('info', 'squash-to-dev', {
    sliceId, msg: 'lock files regenerated into the landing commit', locksMoved,
    archive_rename: (archive && archive.reason) || 'not_attempted',
    archive_paths: (archive && archive.staged) || [],
  });
  return { success: true, archive };
}

/**
 * squashSliceToDev(sliceId, sliceTitle, sliceBranch, lane)
 *
 * Squash-merges a slice branch onto dev with ADR §2 trailers.
 * Returns { success: bool, dev_sha?: string, error?: string }.
 * Never throws — conflict or failure returns a value.
 *
 * `lane` is the brief's declaration, handed in by the caller and defaulting to
 * core. It is NOT harvested from the branch log the way the AC trailers below
 * are: the builder writes those commits, and a lane he could restate is a rigour
 * setting he could lower on himself. It travels onto dev as one `Lane:` trailer
 * so the gate reads it out of history and never off a working file (slice 389).
 */
function squashSliceToDev(sliceId, sliceTitle, sliceBranch, lane = 'core') {
  const resolvedLane = resolveLane({ lane });
  // Layer-2 lock (scripts/lock-main.sh) keeps dashboard/, docs/contracts/ and
  // bridge/*.js read-only in the main working tree. This path rewrites those
  // files (checkout overwrite + drift merge + squash), so open the lock first
  // and ALWAYS re-lock in the finally below — the same contract CLAUDE.md
  // documents for the watcher merge path. Without it git cannot unlink the
  // locked files and the drift merge dies as a phantom merge_conflict
  // (slices 348/349). Repos without the lock scripts (test fixtures) skip both.
  const hasLayer2 = fs.existsSync(path.join(PROJECT_DIR, 'scripts', 'unlock-main.sh'));
  if (hasLayer2) {
    try {
      execSync('bash scripts/unlock-main.sh', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (unlockErr) {
      return { success: false, error: `unlock_failed: ${unlockErr.message}` };
    }
  }
  try {
  // This path checks out + commits in the MAIN working tree (drift-merge + squash
  // commit on dev), so the Layer-1 pre-commit hook requires DS9_WATCHER_MERGE=1 —
  // this IS the watcher merge path. Callers (acceptAndMerge, drainDeferredAfterGate)
  // don't all wrap it in that env, so assert it here or the hook blocks the commit.
  process.env.DS9_WATCHER_MERGE = '1';
  try {
    sliceBranch = sanitizeBranchName(sliceBranch);
  } catch (err) {
    return { success: false, error: `invalid_branch_name: ${err.message}` };
  }

  // Step 1: FUSE-safe checkout to slice branch (plain git checkout is unsafe on the FUSE mount)
  try {
    fuseSafeCheckoutBranch(sliceId, sliceBranch);
  } catch (checkoutErr) {
    return { success: false, error: `checkout_failed: ${checkoutErr.message}` };
  }

  // Step 1b: Resolve drift — merge dev into slice branch
  let lockDriftResolved = false;
  try {
    execSync('git merge --no-ff dev', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (mergeErr) {
    // Capture conflicting paths before aborting so they appear in the error state
    let conflictingFiles = [];
    try {
      const raw = execSync('git diff --name-only --diff-filter=U', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
      conflictingFiles = raw ? raw.split('\n').filter(Boolean) : [];
    } catch (_) {}

    // A drift conflict on nothing but the two lock files is not work for a human. They are
    // DERIVED, both sides are equally stale, and the landing amend below regenerates them
    // from the merged tree regardless — so whichever copy survives here is thrown away in a
    // few lines. Two slices in a row (382, 2026-09-06) stranded on exactly this. Take dev's
    // copies and finish the merge; any OTHER conflicting path still stops the landing.
    if (conflictingFiles.length > 0 && conflictingFiles.every(f => LOCK_FILES.includes(f))) {
      try {
        for (const f of conflictingFiles) {
          // --theirs = dev's side: we are ON the slice branch merging dev IN.
          execSync(`git checkout --theirs -- ${shQuote(f)}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
          execSync(`git add -- ${shQuote(f)}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
        }
        // Named like every other commit the pipeline writes (slice 395). This one
        // lives on the slice branch and is squashed away at landing, but the branch
        // is read by hand when a landing goes wrong and a nameless merge there is
        // the same puzzle as a nameless commit on dev.
        execSync(`git commit -m ${shQuote(gitFinalizer.pipelineCommitSubject(sliceId, `merge dev into ${sliceBranch} to resolve lock drift`))}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
        lockDriftResolved = true;
        log('info', 'squash-to-dev', { sliceId, msg: "drift conflict on lock files only — took dev's copies and completed the merge", files: conflictingFiles });
      } catch (resolveErr) {
        // Fall through to the ordinary conflict path: better a stranded slice than a
        // half-finished merge in the live tree.
        log('warn', 'squash-to-dev', { sliceId, msg: 'lock-only drift conflict could not be auto-resolved', error: resolveErr.message });
      }
    }

    if (!lockDriftResolved) {
      // Abort: restores working tree to pre-merge state
      try { execSync('git merge --abort', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}

      // FUSE-safe return to dev
      try { fuseSafeCheckoutBranch(sliceId, 'dev'); } catch (_) {}

      const conflictPaths = conflictingFiles.length > 0 ? conflictingFiles.join(',') : 'unknown';

      // No unmerged paths = the merge never started (locked files, dirty tree,
      // unlinkable paths) — surface git's own words so the operator sees the
      // real failure instead of a phantom "conflict" with an empty file list.
      const gitStderr = String((mergeErr && mergeErr.stderr) || (mergeErr && mergeErr.message) || '').trim().slice(0, 500);

      // Emit a loud register event — slice must never be silently stranded
      registerEvent(sliceId, 'ERROR', {
        slice_id: String(sliceId),
        reason: 'merge_conflict',
        conflicting_files: conflictingFiles,
        git_error: gitStderr,
      });

      // Write a visible ERROR file so the slice is not left accepted-but-unmerged
      const completed = new Date().toISOString();
      const conflictedList = conflictingFiles.length > 0
        ? conflictingFiles.map(f => `- \`${f}\``).join('\n')
        : '- (could not determine conflicting files)';
      const errorContent = [
        '---',
        `id: "${sliceId}"`,
        `title: "Slice ${sliceId} — merge_conflict"`,
        'from: orchestrator',
        'to: chiefobrien',
        'status: ERROR',
        `slice_id: "${sliceId}"`,
        `completed: "${completed}"`,
        'reason: "merge_conflict"',
        '---',
        '',
        '## Merge conflict during drift-resolve',
        '',
        `The drift-resolve step (\`git merge --no-ff dev\` into \`${sliceBranch}\`) failed.`,
        'The merge was aborted. This slice requires manual intervention.',
        '',
        '## Conflicting files',
        '',
        conflictedList,
        '',
        '## Git error',
        '',
        '```',
        gitStderr || '(no stderr captured)',
        '```',
      ].join('\n');
      const errorPath = path.join(QUEUE_DIR, `${sliceId}-ERROR.md`);
      try { fs.writeFileSync(errorPath, errorContent); } catch (_) {}
      try { archiveSiblingStateFiles(sliceId, 'ERROR'); } catch (_) {}

      return { success: false, error: `merge_conflict:${conflictPaths}`, conflicting_files: conflictingFiles };
    }
  }

  // Step 2: FUSE-safe checkout to dev
  try {
    fuseSafeCheckoutBranch(sliceId, 'dev');
  } catch (checkoutErr) {
    return { success: false, error: `dev_checkout_failed: ${checkoutErr.message}` };
  }

  // dev's tip as it stands BEFORE the squash. If the lock regeneration below fails, this
  // is exactly where the local tip is put back, so a recovery run squashes again from a
  // clean starting point instead of inheriting a commit with known-wrong locks.
  let preSquashSha;
  try {
    preSquashSha = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  } catch (parseErr) {
    return { success: false, error: `rev_parse_failed: ${parseErr.message}` };
  }

  // Step 2b: Squash merge the slice onto dev
  try {
    execSync(`git merge --squash ${sliceBranch}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (squashErr) {
    try { execSync('git merge --abort', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    return { success: false, error: `squash_failed: ${squashErr.message}` };
  }

  // Propagate the slice's AC declarations into the squash commit so the merge-gate AC scan
  // (lib/ac-range-scan over origin/main..origin/dev) actually sees them. Rom declares each
  // acceptance criterion as an `AC: slice-N-ac-K: <text>` trailer in his branch commit(s);
  // the fresh squash message would otherwise drop them and the gate would scan an EMPTY AC
  // set (a false green — the long-standing last-mile gap). No trailers → behaves as before.
  let acTrailers = '';
  let moveTrailers = '';
  try {
    // --reverse = OLDEST-first. git log defaults to newest-first, so last-writer-wins below
    // would keep the OLDEST text if a tag is amended across commits. Oldest-first makes the
    // newest declaration win — matching the gate's scanner (lib/ac-range-scan). (Bug found by
    // Julian while guarding slice-350-ac-1.)
    const bodies = execSync(`git log dev..${sliceBranch} --reverse --format=%B`, { cwd: PROJECT_DIR, encoding: 'utf-8' });
    const byTag = new Map(); // last declaration wins = newest, because the log is now oldest-first
    const re = /^AC:\s*(slice-\d+-ac-\d+):\s*(.+?)\s*$/gim;
    let m;
    while ((m = re.exec(bodies)) !== null) byTag.set(m[1].toLowerCase(), m[2].trim());
    for (const [tag, text] of byTag) acTrailers += `AC: ${tag}: ${text}\n`;

    // `AC:` was never the only trailer that matters. The Test-Update Gate reads
    // origin/main..origin/dev, a range in which the branch's own commits do not exist, so
    // every gate trailer left behind here is a declaration the builder made and the gate
    // never hears — his declared test moves arrive looking like undeclared ones. Carry the
    // three test-move trailers across, each once, after the AC lines. A second regex over
    // the SAME bodies string: the literal `git log dev..${sliceBranch} --reverse` above is
    // pinned by j-ac-amend-order, and a second log call would be a second thing to keep
    // in step with it.
    const moveRe = /^(Tests-Not-Needed|Test-Loosen-OK|Coverage-Removed):\s*(.+?)\s*$/gim;
    const seenMove = new Set();
    let mv;
    while ((mv = moveRe.exec(bodies)) !== null) {
      const line = `${mv[1]}: ${mv[2].trim()}`;
      const key = line.toLowerCase(); // the gate's own parser is case-insensitive
      if (seenMove.has(key)) continue;
      seenMove.add(key);
      moveTrailers += `${line}\n`;
    }

    // AC-Change-OK and Spec-Owner are PHILIPP'S pair, not a builder's: together they clear
    // an AC-MUTATED finding. Carrying one up from a branch commit would let the builder
    // authorise his own acceptance-criterion edit with a signature he typed himself — the
    // evasion the human gate exists to stop. Dropped, and said out loud.
    const humanRe = /^(AC-Change-OK|Spec-Owner):\s*(.+?)\s*$/gim;
    let hm;
    while ((hm = humanRe.exec(bodies)) !== null) {
      log('warn', 'squash-to-dev', {
        sliceId,
        msg: 'human-only trailer on an agent commit; add it on dev at landing if intended',
        trailer: `${hm[1]}: ${hm[2].trim()}`,
      });
    }
  } catch (_) { /* no branch log → no trailers, squash proceeds unchanged */ }

  // One helper spells the S<id> prefix for every commit the pipeline writes (slice
  // 395); for the squash it produces exactly the `S<id>: <title>` subject that
  // j-s-numbering-squash-subject has pinned since slice 350.
  // `Kind: S` says this node on dev is a slice LANDING (405), told apart from the
  // pipeline's own bookkeeping (`Kind: P`) and from a person's commit (no trailer, read
  // as H). It is deliberately NOT in the harvest above: the kind describes the commit
  // being written here, so a branch commit's own `Kind: P` must stay on the branch —
  // carrying it up would give the landing two Kind trailers and let the first one win.
  const commitMsg = `${gitFinalizer.pipelineCommitSubject(sliceId, sliceTitle)}\n\nKind: S\nSlice-Id: ${sliceId}\nSlice-Branch: ${sliceBranch}\nLane: ${resolvedLane}\n${acTrailers}${moveTrailers}`;
  const commitMsgFile = path.join(PROJECT_DIR, '.squash-commit-msg');
  try {
    fs.writeFileSync(commitMsgFile, commitMsg);
    // Reference the message file RELATIVE to cwd (= PROJECT_DIR). The absolute path
    // could contain spaces; interpolating it unquoted made
    // git read each word as a separate pathspec and the squash commit failed.
    execSync('git commit -F .squash-commit-msg', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (commitErr) {
    return { success: false, error: `commit_failed: ${commitErr.message}` };
  } finally {
    try { fs.unlinkSync(commitMsgFile); } catch (_) {}
  }

  // The squash just applied the slice's tree to dev. If the slice untracked a
  // runtime file, git has now DELETED it from this — the live — working tree.
  // Put it back before step 3 reads branch-state.json, and before the ledgers
  // are appended to and the loss becomes permanent.
  recoverRuntimeStateAfterGit(`squash-${sliceBranch}`, sliceId);

  // The pipeline owns the lock files (slice 387). The builder's branch carried whatever
  // copies he happened to have; the squash just applied them to dev, and this overwrites
  // them with a fresh regeneration folded into the same commit. It runs AFTER the commit
  // because build-ac-manifest reads the `AC:` trailers from HEAD — and before the push,
  // so the amend never rewrites public history. A repo with no scripts/ directory (the
  // squash fixtures) skips it, the same rule hasLayer2 uses above.
  if (fs.existsSync(path.join(PROJECT_DIR, 'scripts', 'build-coverage-map.js'))) {
    const regen = regenerateLocksAtLanding(sliceId, sliceBranch, preSquashSha);
    if (!regen.success) return regen;
  }

  // Read AFTER the amend: this sha is what gets pushed, recorded in branch-state and
  // emitted as squash_sha — which is the SHA the rollback button reverts.
  let devSha;
  try {
    devSha = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  } catch (parseErr) {
    return { success: false, error: `rev_parse_failed: ${parseErr.message}` };
  }

  try {
    execSync('git push origin dev', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (pushErr) {
    log('warn', 'squash-to-dev', { sliceId, msg: 'git push origin dev failed (squash succeeded locally)', error: pushErr.message });
  }

  // Step 3: Update branch-state.json
  try {
    const branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
    if (!branchState.dev) branchState.dev = { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] };
    if (!Array.isArray(branchState.dev.commits)) branchState.dev.commits = [];
    const ts = new Date().toISOString();
    branchState.dev.commits.push({
      sha: devSha,
      slice_id: String(sliceId),
      title: sliceTitle,
      ts,
      is_pending_squash: false,
    });
    branchState.dev.commits_ahead_of_main = (branchState.dev.commits_ahead_of_main || 0) + 1;
    branchState.dev.tip_sha = devSha;
    branchState.dev.tip_ts = ts;
    writeJsonAtomic(BRANCH_STATE_PATH, branchState);
  } catch (stateErr) {
    log('warn', 'squash-to-dev', { sliceId, msg: 'branch-state update failed', error: stateErr.message });
  }

  // Step 4: Emit register event
  registerEvent(sliceId, 'SLICE_SQUASHED_TO_DEV', {
    slice_id: String(sliceId),
    dev_tip_sha: devSha,
    squash_sha: devSha,
    lane: resolvedLane,
  });

  // Recompute RR after squash (slice 270)
  recomputeAndPersistRR();

  // Step 5: Return success
  return { success: true, dev_sha: devSha };
  } finally {
    // Re-lock Layer 2 on every path — success, error return, or throw.
    if (hasLayer2) {
      try { execSync('bash scripts/lock-main.sh', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------
// Read slice metadata from queue files (for drain)
// ---------------------------------------------------------------------------

/**
 * readSliceMeta(sliceId)
 *
 * Reads slice metadata (title, branch, lane) from queue files. Checks ACCEPTED,
 * PARKED, DONE, and IN_PROGRESS files in priority order.
 * Returns { title, branch, lane }.
 *
 * Title and branch are first-wins across all four files. The LANE is read from
 * `-PARKED.md` and nowhere else: that file is the brief, and the brief is where
 * Alex declares the lane. `-ACCEPTED.md` is Sam's DONE report renamed and carries
 * no lane at all — reading the lane first-wins like the others would have found
 * nothing on the file that is checked first and made every squash say core.
 *
 * The loop no longer breaks once title and branch are known, for the same reason:
 * the early exit fired on `-ACCEPTED.md` and `-PARKED.md` was never opened. Four
 * small reads; first-wins means the extra ones cannot change the answer.
 */
function readSliceMeta(sliceId) {
  // -IN_QA.md is the ACCEPTED file's name while Julian's stage runs (slice 363); without
  // it a slice in QA reads as having no title and no branch.
  const suffixes = ['-ACCEPTED.md', '-IN_QA.md', '-PARKED.md', '-DONE.md', '-IN_PROGRESS.md'];
  let title = null;
  let branch = null;
  let lane = null;

  for (const suffix of suffixes) {
    const filePath = path.join(QUEUE_DIR, `${sliceId}${suffix}`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const meta = parseFrontmatter(content);
      if (meta) {
        if (!title && meta.title) title = meta.title;
        if (!branch && meta.branch) branch = meta.branch;
        if (suffix === '-PARKED.md' && meta.lane) lane = meta.lane;
      }
    } catch (_) { /* file not found — try next */ }
  }

  // Fallback branch from convention
  if (!branch) branch = `slice/${sliceId}`;

  return { title: title || `slice ${sliceId}`, branch, lane: resolveLane({ lane }) };
}

// ---------------------------------------------------------------------------
// Drain deferred slices after gate release (slice 273)
// ---------------------------------------------------------------------------

/**
 * drainDeferredAfterGate()
 *
 * Called after every releaseGateMutex. Reads deferred_slices from branch-state,
 * sorts by accepted_ts, and squashes each to dev via squashSliceToDev.
 * Halts on first conflict — remaining slices stay deferred for next cycle.
 * After drain, if gate.status is IDLE and dev has commits ahead, transitions
 * gate.status to ACCUMULATING.
 */
function drainDeferredAfterGate() {
  // Re-entrancy guard. finishQaStage ends by calling this, and a stage that fails to start
  // (no prompt template, `claude` not spawnable) calls finishQaStage from inside
  // startQaStageOrArchive — which this loop calls. Without the guard the inner drain
  // re-reads deferred_slices, squashes the slices this loop is part-way through, and the
  // outer loop then carries on against its own stale snapshot: one slice squashed twice.
  // Dropping the nested call loses nothing, because the loop that owns the flag is still
  // walking the same list.
  if (_draining) {
    log('debug', 'drain', { msg: 'drainDeferredAfterGate: already draining — nested call ignored' });
    return;
  }
  _draining = true;
  try {
    _drainDeferredAfterGate();
  } finally {
    _draining = false;
  }
}

function _drainDeferredAfterGate() {
  let branchState;
  try {
    branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  } catch (err) {
    log('warn', 'drain', { msg: 'drainDeferredAfterGate: cannot read branch-state.json', error: err.message });
    return;
  }

  const deferred = (branchState.dev && branchState.dev.deferred_slices) || [];
  if (deferred.length === 0) return;

  // Sort FIFO by accepted_ts, tiebreak by numeric slice ID
  const sorted = deferred.slice().sort((a, b) => {
    const tsA = a.accepted_ts || '';
    const tsB = b.accepted_ts || '';
    if (tsA < tsB) return -1;
    if (tsA > tsB) return 1;
    return (parseInt(a.slice_id, 10) || 0) - (parseInt(b.slice_id, 10) || 0);
  });

  let drained = 0;
  for (const entry of sorted) {
    const meta = readSliceMeta(entry.slice_id);
    const result = squashSliceToDev(entry.slice_id, meta.title, meta.branch, meta.lane);
    if (!result.success) {
      log('warn', 'drain', {
        msg: `drainDeferredAfterGate: squash failed for slice ${entry.slice_id}`,
        error: result.error,
      });
      break;
    }
    // Remove this entry from deferred_slices FIRST: the squash succeeded, so the slice has
    // landed and is not deferred any more whatever the stage does next. Leaving it in the
    // list across the stage start is what let a failed start re-enter this loop and squash
    // an already-landed slice a second time.
    // Re-read branch-state since squashSliceToDev updates it
    try {
      branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
    } catch (_) {}
    branchState.dev.deferred_slices = (branchState.dev.deferred_slices || []).filter(
      e => e.slice_id !== entry.slice_id
    );
    writeJsonAtomic(BRANCH_STATE_PATH, branchState);
    drained++;

    // A drained slice has landed, so its stage starts the same way handleAccepted's does —
    // and the archival the stage now holds (the ARCHIVED event, the branch delete, the
    // worktree prune, the sibling sweep) runs when that stage records its result. Without
    // this the drained slice would be ARCHIVED on disk and in git with no ARCHIVED event,
    // no pruned worktree and its branch still alive.
    const stage = startQaStageOrArchive(entry.slice_id, {
      branchName: meta.branch, title: meta.title, sha: result.dev_sha, lane: meta.lane,
    });

    // One slice at a time, unchanged in spirit: the stage holds the gate mutex, so the
    // next squash would defer anyway. Stop draining and let finishQaStage call us back —
    // draining on regardless is what would put two slices on dev under one stage.
    if (stage && stage.started) {
      log('info', 'drain', { msg: `drainDeferredAfterGate: pausing — slice ${entry.slice_id} is in QA` });
      break;
    }
  }

  // State transition: IDLE + commits on dev → ACCUMULATING
  if (drained > 0) {
    try {
      branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
    } catch (_) {}
    if (branchState.gate && branchState.gate.status === 'IDLE' &&
        branchState.dev && branchState.dev.commits_ahead_of_main > 0) {
      branchState.gate.status = 'ACCUMULATING';
      writeJsonAtomic(BRANCH_STATE_PATH, branchState);
    }
  }

  log('info', 'drain', { msg: `drainDeferredAfterGate: drained ${drained} of ${sorted.length} deferred slices` });
}

// ---------------------------------------------------------------------------
// Dev → main merge (slice 269)
// ---------------------------------------------------------------------------

/**
 * mergeDevToMain()
 *
 * On regression-pass, merges dev → main via --no-ff under the main-lock
 * protocol, fast-forwards dev to main, updates branch-state, emits
 * merge-complete, releases the gate mutex, and drains deferred slices.
 *
 * Returns { success, merge_sha, error }.
 * On failure emits gate-abort, releases mutex, leaves main unchanged.
 */
function mergeDevToMain() {
  const ctx = { registerEvent, log };

  // RETIRED — GitHub-CI merge model (docs/adr/ADR-GITHUB-CI-MERGE-MODEL.md).
  // dev→main is owned by ci.yml (Bashir's regression gate) + promote.yml (fast-forwards
  // main to the green dev commit). squashSliceToDev already pushes dev; the orchestrator
  // no longer checks out / merges / pushes main. Stand the gate down; GitHub promotes.
  log('info', 'dev-to-main', { msg: 'mergeDevToMain retired — GitHub CI + promote own dev→main' });
  try {
    const _st = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
    _st.gate = _st.gate || {};
    _st.gate.status = 'IDLE';
    _st.gate.current_run = null;
    writeJsonAtomic(BRANCH_STATE_PATH, _st);
  } catch (_) { /* best effort */ }
  releaseGateMutex('dev_to_main_ci', ctx);
  drainDeferredAfterGate();
  return { success: true, merge_sha: null, error: null, retired: true };

  // ── legacy local-merge logic below is now unreachable (kept for history / revert) ──
  // 1. Read branch-state for batch info
  let branchState;
  try {
    branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  } catch (err) {
    emitGateTelemetry('gate-abort', { reason: 'branch-state-unreadable', error: err.message });
    releaseGateMutex('gate_abort', ctx);
    drainDeferredAfterGate();
    return { success: false, merge_sha: null, error: 'branch_state_unreadable' };
  }

  const commits = (branchState.dev && branchState.dev.commits) || [];
  const sliceIds = commits.map(c => String(c.slice_id));
  if (sliceIds.length === 0) {
    emitGateTelemetry('gate-abort', { reason: 'no-slices-on-dev' });
    releaseGateMutex('gate_abort', ctx);
    drainDeferredAfterGate();
    return { success: false, merge_sha: null, error: 'no_slices_on_dev' };
  }

  const sliceRange = sliceIds.length === 1
    ? sliceIds[0]
    : `${sliceIds[0]}..${sliceIds[sliceIds.length - 1]}`;
  const commitSubject = `merge: dev gate batch — slices ${sliceRange}`;
  const commitBody = `Batch merge of ${sliceIds.length} slice(s) from dev to main via Bashir gate.\n\nSlices: ${sliceIds.join(',')}`;
  const fullMsg = `${commitSubject}\n\n${commitBody}`;

  // 2. Acquire main-lock (unlock-main.sh)
  const unlockScript = path.join(PROJECT_DIR, 'scripts', 'unlock-main.sh');
  const lockScript = path.join(PROJECT_DIR, 'scripts', 'lock-main.sh');

  const unlockStart = Date.now();
  try { execSync(`bash "${unlockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
  emitGateTelemetry('lock-cycle', { cycle_phase: 'unlock', triggering_op: 'dev-to-main-merge', held_duration_ms: Date.now() - unlockStart });

  process.env.DS9_WATCHER_MERGE = '1';

  try {
    // 3. Switch to main — FUSE-safe (the working dir is a FUSE mount where plain
    //    `git checkout` can't reliably replace tracked files). First discard the
    //    runtime-state dirt the gate run just wrote (Bashir heartbeat, branch-state,
    //    suite logs) so the switch isn't blocked by "local changes would be overwritten".
    try { execSync('git checkout -- bridge/state/', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    fuseSafeCheckoutMain('gate-merge');

    // 4. git merge --no-ff dev
    const msgFile = path.join(PROJECT_DIR, '.dev-merge-msg');
    fs.writeFileSync(msgFile, fullMsg);
    try {
      execSync(`git merge --no-ff dev -F "${msgFile}"`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    } finally {
      try { fs.unlinkSync(msgFile); } catch (_) {}
    }

    const mergeSha = execSync('git rev-parse main', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();

    // 5. Push main
    try {
      execSync('git push origin main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (pushErr) {
      // Push reject — abort, reset main
      try { execSync(`git reset --hard ${mergeSha}~1`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
      emitGateTelemetry('gate-abort', { reason: 'push-rejected', error: pushErr.message });
      releaseGateMutex('gate_abort', ctx);
      drainDeferredAfterGate();
      return { success: false, merge_sha: null, error: 'push_rejected' };
    }

    // 6. Fast-forward dev to main (ADR §1). BEST-EFFORT: main is already merged AND
    //    pushed above, so any failure here (FUSE checkout, non-ff dev push) must NOT
    //    trigger the outer catch's rollback — the merge has already succeeded.
    try {
      execSync('git checkout -- bridge/state/', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (_) {}
    try {
      execSync('git checkout dev', { cwd: PROJECT_DIR, stdio: 'pipe' });
      execSync('git merge --ff-only main', { cwd: PROJECT_DIR, stdio: 'pipe' });
      try {
        execSync('git push origin dev', { cwd: PROJECT_DIR, stdio: 'pipe' });
      } catch (devPushErr) {
        log('warn', 'dev-to-main', { msg: 'git push origin dev failed (ff succeeded locally)', error: devPushErr.message });
      }
    } catch (devFfErr) {
      log('warn', 'dev-to-main', { msg: 'dev fast-forward failed (main already merged+pushed)', error: devFfErr.message });
    }

    // Switch back to main for working-tree consistency (best-effort, FUSE-safe).
    try { fuseSafeCheckoutMain('gate-merge-switchback'); } catch (_) {}

    // 7. Update branch-state
    const ts = new Date().toISOString();
    branchState.main = branchState.main || {};
    branchState.main.tip_sha = mergeSha;
    branchState.main.tip_subject = commitSubject;
    branchState.main.tip_ts = ts;

    branchState.dev = branchState.dev || {};
    branchState.dev.tip_sha = mergeSha;
    branchState.dev.tip_ts = ts;
    branchState.dev.commits = [];
    branchState.dev.commits_ahead_of_main = 0;

    branchState.last_merge = {
      merge_sha: mergeSha,
      ts,
      slices: sliceIds,
    };

    branchState.gate = branchState.gate || {};
    branchState.gate.status = 'IDLE';
    branchState.gate.current_run = null;
    branchState.gate.last_failure = null;

    writeJsonAtomic(BRANCH_STATE_PATH, branchState);

    // 8. Emit per-slice SLICE_MERGED_TO_MAIN register events
    for (const sid of sliceIds) {
      registerEvent(sid, 'SLICE_MERGED_TO_MAIN', {
        slice_id: sid,
        merge_sha: mergeSha,
      });
    }

    // 9. Emit merge-complete telemetry
    emitGateTelemetry('merge-complete', {
      merge_sha: mergeSha,
      slices: sliceIds,
      dev_fast_forwarded_to: mergeSha,
    });

    // Reset RR after merge-complete — dev is empty (slice 270)
    recomputeAndPersistRR();

    // 10. Release mutex + drain deferred slices
    releaseGateMutex('regression_pass', ctx);
    drainDeferredAfterGate();

    log('info', 'dev-to-main', {
      msg: 'Dev merged to main successfully',
      merge_sha: mergeSha,
      slices: sliceIds,
    });

    return { success: true, merge_sha: mergeSha, error: null };
  } catch (err) {
    // Any unexpected failure — abort, emit gate-abort, release mutex
    try { execSync('git merge --abort', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    try { execSync('git checkout main', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    emitGateTelemetry('gate-abort', { reason: 'merge-failed', error: err.message });
    releaseGateMutex('gate_abort', ctx);
    drainDeferredAfterGate();
    return { success: false, merge_sha: null, error: err.message };
  } finally {
    delete process.env.DS9_WATCHER_MERGE;
    const relockStart = Date.now();
    try { execSync(`bash "${lockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    emitGateTelemetry('lock-cycle', { cycle_phase: 'relock', triggering_op: 'dev-to-main-merge', held_duration_ms: Date.now() - relockStart });
  }
}

// ---------------------------------------------------------------------------
// Exports — for use by helper scripts (e.g. bridge/next-id.js)
// ---------------------------------------------------------------------------

module.exports = { invokeRom, invokeNog, resolveLane, laneEventFields, applyLaneArgs, romSpawnArgs, registerCommissioned, sessionTelemetry, reviewTelemetry, recordBuildTiming, fillDoneMetrics, validateDoneMetrics, extractRomTelemetry, buildDoneTemplate, buildHashLines, regenerateLocksAtLanding, newestDoneEvent, isLockDeriverInput, LOCK_FILES, checkDispatchProvenance, parkUnprovenancedSlice, hasPreCutoverHistory, fileIsPreCutover, provenanceRootId, parseFrontmatter, readNogVerdict, NOG_VERDICTS, handleNogReturn, startGate, abortGate, buildBashirPrompt, startQaStage, finishQaStage, startQaStageOrArchive, quarantineQaLeftovers, dirtyLockDeriverInputs, QA_LEFTOVER_GRACE_MS, recoverOrphanedQaStages, qaStageSourceDoc, qaStageResultPath, setQaStageInBranchState, QA_STAGE_TIMEOUT_MS, qaStage, buildBashirNonGatePrompt, invokeBashirNonGate, _gateTestsUpdated, _gateAbort, _checkForEvent, _parseFailedAcs, _parseSuiteSize, _updateBranchStateOnFail, mergeDevToMain, BASHIR_HEARTBEAT_PATH, BASHIR_NON_GATE_PROMPT_TEMPLATE, BASHIR_STDOUT_LOG, BASHIR_HEARTBEAT_POLL_MS, BASHIR_HEARTBEAT_STALE_MS, BASHIR_TIMEOUT_MS, BASHIR_NON_GATE_DEFAULT_TIMEOUT_MS, REGRESSION_STDOUT_LOG, REGRESSION_STDERR_LOG, REGRESSION_TIMEOUT_MS, nextSliceId, getQueueSnapshot, classifyNoReportExit, rescueWorktree, isRomSelfTerminated, verifyRomActuallyWorked, classifyHonestNonProduct, doneSummarySection, assertMergeIntegrity, verifyOriginAdvanced, latestRestagedTs, latestAttemptStartTs, hasReviewEvent, hasMergedEvent, isTerminal, depsAreMet, restagedBootstrap, backfillArchive, backfillAcceptedFiles, backfillBranches, acceptAndMerge, archiveAcceptedSlice, archiveSiblingStateFiles, recordArchivedQueueRename, validateIntakeMeta, ensureIntegrationIsFresh, ensureMainIsFresh: ensureIntegrationIsFresh, fastForwardIntegrationRef, branchNamesFrom, INTEGRATION_BRANCH, TRUNK_BRANCH, extractSessionId, shouldForceFreshSession, appendRoundEntry, computeNextAttemptNumber, auditLegacyFiles, CANONICAL_LIVE_SUFFIXES, CANONICAL_SUFFIX_RE, handleReturnToStage, findOriginalSliceBody, reconcileBranchState, squashSliceToDev, drainDeferredAfterGate, readSliceMeta, provisionWorkspaceDeps, releaseDispatch, _testSetHeartbeatFile: (p) => { HEARTBEAT_FILE = p; }, _testGetDispatchState: () => ({ processing, heartbeat: { ...heartbeatState } }), _testSetRegisterFile: (p) => { REGISTER_FILE = p; }, _testSetDirs: (q, s, t) => { QUEUE_DIR = q; STAGED_DIR = s; TRASH_DIR = t; }, _testSetProjectDir: (dir) => { PROJECT_DIR = dir; BRANCH_STATE_PATH = path.join(dir, 'bridge', 'state', 'branch-state.json'); }, _testResetDeferredEmitted: () => { _deferredEmitted.clear(); }, _testGetDeferredEmitted: () => _deferredEmitted, hasTerminalLandedEvent, crashRecovery, trashEntryRecordsStaging, STAGING_TRASH_SUFFIXES, countUnreadableVerdicts, unreadableBackoffMs, retryBackoffElapsed, MAX_UNREADABLE_ATTEMPTS, UNREADABLE_BACKOFF_MS, porcelainPaths, isVolatileRuntimePath, isPipelineOwnedPath, recoverRuntimeStateAfterGit, stageablePathsFrom, autoCommitDirtyTree, shQuote, stageQueueArchiveForLanding, revertQueueArchiveStaging, hasArchivedEvent, pipelineCommitSubject: gitFinalizer.pipelineCommitSubject, refillLandedDoneReport, _testResetRefusalEmitted: () => { _refusalEmitted.clear(); }, _testGetRefusalEmitted: () => _refusalEmitted };

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { execFileSync, execFile } = require('child_process');

const PORT         = process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT, 10) : 4747;
const HOST         = process.env.DASHBOARD_HOST ?? '0.0.0.0';
// REPO_ROOT defaults to the repo (one above dashboard/). E2E/integration harnesses
// set DASHBOARD_REPO_ROOT to point the data layer (bridge/, .claude/, regression/) at a
// deterministic fixture, while the frontend (lcars-dashboard.html) is still served from __dirname.
const REPO_ROOT    = process.env.DASHBOARD_REPO_ROOT
  ? path.resolve(process.env.DASHBOARD_REPO_ROOT)
  : path.resolve(__dirname, '..');
const QUEUE_DIR    = path.join(REPO_ROOT, 'bridge', 'queue');
const HEARTBEAT    = path.join(REPO_ROOT, 'bridge', 'heartbeat.json');
const REGISTER     = path.join(REPO_ROOT, 'bridge', 'register.jsonl');
const STAGED_DIR   = path.join(REPO_ROOT, 'bridge', 'staged');
const TRASH_DIR    = path.join(REPO_ROOT, 'bridge', 'trash');
const LOGS_DIR     = path.join(REPO_ROOT, 'bridge', 'logs');
const DASHBOARD    = path.join(__dirname, 'lcars-dashboard.html');
const TOKENS_CSS   = path.join(__dirname, 'tokens.css');
const TEST_DRIFT_PAGE = path.join(__dirname, 'test-drift.html');
const MERGE_GATE_PAGE = path.join(__dirname, 'merge-gate.html');
const BRANCH_STATE = path.join(REPO_ROOT, 'bridge', 'state', 'branch-state.json');

const FIRST_OUTPUT  = path.join(REPO_ROOT, 'bridge', 'first-output.json');
const NOG_ACTIVE    = path.join(REPO_ROOT, 'bridge', 'nog-active.json');
const CONTROL_DIR   = path.join(REPO_ROOT, 'bridge', 'control');
const SESSIONS      = path.join(REPO_ROOT, 'bridge', 'sessions.jsonl');
const { translateEvent, resetDedupeState } = require(path.join(REPO_ROOT, 'bridge', 'lifecycle-translate'));

// The volatile runtime state (heartbeat, queue order, branch-state schema) is
// untracked (slice 372), so a fresh clone starts without it and the panels below
// read it before the orchestrator has ever written it. Seed the missing files —
// idempotent, and scoped to REPO_ROOT so e2e fixture roots are seeded too.
try {
  require(path.join(REPO_ROOT, 'bridge', 'state', 'seed-runtime-state')).ensureRuntimeState(REPO_ROOT);
} catch (_) {
  // A test/fixture REPO_ROOT that doesn't ship the seeder writes its own
  // deterministic state — there is nothing to seed and nothing to fail on.
}

const CORS_ORIGIN  = 'https://dax-dashboard.lovable.app';

// Hide DONE slices older than this many days from the Queue panel.
// Pre-lifecycle stragglers sit in DONE forever; this keeps them out of sight.
const STALE_DONE_DAYS = 7;

// ── Crew dossier (slice: crew-dossier-tabs) ─────────────────────────────────
// Clicking a crew card opens a menu: New / Resume conversation, Inspect role.
// "Inspect role" opens a 3-tab dossier — ROLE description / MEMORY / ARTIFACTS.
// All file reads are read-only and scoped to REPO_ROOT. Conversation launch is
// best-effort (opens Terminal running `claude`); the exact command is always
// returned so the UI can show it when auto-launch is unavailable.
const os     = require('os');
const crypto = require('crypto');

const ROLE_CONVERSATIONS = path.join(REPO_ROOT, 'bridge', 'role-conversations.json');

const CREW = {
  sisko:  { num: '01', name: 'Sisko',         title: 'Product Manager' },
  ziyal:  { num: '02', name: 'Ziyal',         title: 'UX Specialist' },
  obrien: { num: '03', name: "Chief O'Brien", title: 'Tech Lead' },
  rom:    { num: '04', name: 'Rom',           title: 'Backend Implementor' },
  nog:    { num: '05', name: 'Nog',           title: 'Evaluator' },
  bashir: { num: '06', name: 'Bashir',        title: 'QA Engineer' },
  dax:    { num: '07', name: 'Dax',           title: 'Architect' },
  worf:   { num: '08', name: 'Worf',          title: 'DevOps / Release Engineer' },
  leeta:  { num: '—',  name: 'Leeta',         title: 'Frontend' },
};

// ROLE tab (first existing wins) + MEMORY tab (every existing source concatenated).
const ROLE_SOURCES = {
  sisko:  { role: ['.claude/roles/sisko/ROLE.md'],  memory: ['.claude/roles/sisko/memory/MEMORY.md',  '.claude/roles/sisko/LEARNING.md'] },
  ziyal:  { role: ['.claude/roles/ziyal/ROLE.md'],  memory: ['.claude/roles/ziyal/memory/MEMORY.md',  '.claude/roles/ziyal/LEARNING.md'] },
  obrien: { role: ['.claude/roles/obrien/ROLE.md'], memory: ['.claude/roles/obrien/memory/MEMORY.md', '.claude/roles/obrien/LEARNING.md'] },
  rom:    { role: ['.claude/CLAUDE.md'],             memory: ['.claude/roles/rom/CRAFT.md',            '.claude/roles/rom/LEARNING.md'] },
  nog:    { role: ['.claude/roles/nog/ROLE.md'],    memory: ['.claude/roles/nog/memory/MEMORY.md',    '.claude/roles/nog/LEARNING.md'] },
  bashir: { role: ['.claude/roles/bashir/ROLE.md'], memory: ['.claude/roles/bashir/memory/MEMORY.md', '.claude/roles/bashir/LEARNING.md'] },
  dax:    { role: ['.claude/roles/dax/ROLE.md'],    memory: ['.claude/roles/dax/memory/MEMORY.md',    '.claude/roles/dax/LEARNING.md'] },
  worf:   { role: ['.claude/roles/worf/ROLE.md'],   memory: ['.claude/roles/worf/memory/MEMORY.md',   '.claude/roles/worf/LEARNING.md'] },
  leeta:  { role: ['.claude/roles/leeta/ROLE.md'],  memory: ['.claude/roles/leeta/memory/MEMORY.md',  '.claude/roles/leeta/LEARNING.md'] },
};

// ARTIFACTS tab — curated, in-repo, clickable. Missing files are filtered out at request time.
const CREW_ARTIFACTS = {
  sisko: [
    { title: 'Bet 2 — architecture response',         path: '.claude/roles/sisko/RESPONSE-BET2-ARCHITECTURE-FROM-DAX.md' },
    { title: 'Eval-loop spike — handoff',             path: '.claude/roles/sisko/HANDOFF-EVAL-LOOP-SPIKE-FROM-DAX.md' },
    { title: 'Internal-improvement features',         path: '.claude/roles/sisko/RESPONSE-INTERNAL-IMPROVEMENT-FEATURES-FROM-DAX.md' },
    { title: 'Dax session report — response',         path: '.claude/roles/sisko/RESPONSE-DAX-SESSION-REPORT-2026-04-08.md' },
  ],
  ziyal: [
    { title: 'Ops UX concept (hi-fi)',                path: '.claude/roles/ziyal/deliveries/ops-ux-concept.html' },
    { title: 'Ops dashboard — spec',                  path: '.claude/roles/ziyal/deliveries/ops-dashboard-spec.md' },
    { title: 'Bet 2 dashboard — wireframe',           path: '.claude/roles/ziyal/deliveries/bet2-dashboard-wireframe.html' },
    { title: 'Bet 2 dashboard — design spec',         path: '.claude/roles/ziyal/deliveries/bet2-dashboard-design-spec.md' },
    { title: 'Landing — wireframe v1',                path: '.claude/roles/ziyal/deliveries/dax-landing-wireframe-v1.html' },
    { title: 'Landing — copy draft v1',               path: '.claude/roles/ziyal/deliveries/landing-page-copy-draft-v1.md' },
    { title: 'Leeta landing-page — handoff',          path: '.claude/roles/ziyal/deliveries/HANDOFF-LEETA-LANDING-PAGE.md' },
  ],
  obrien: [
    { title: 'Git strategy',                          path: 'docs/git-strategy.md' },
    { title: 'Slice 309 — DONE report',               path: 'bridge/queue/309-DONE.md' },
    { title: 'Slice 304 — DONE report',               path: 'bridge/queue/304-DONE.md' },
    { title: 'Evaluator implementation — handoff',    path: '.claude/roles/obrien/HANDOFF-EVALUATOR-IMPLEMENTATION-FROM-DAX.md' },
    { title: 'Bet 3 slice-tracking — handoff',        path: '.claude/roles/obrien/HANDOFF-BET3-SLICE-TRACKING-FROM-DAX.md' },
  ],
  rom: [
    { title: 'Dashboard server',                      path: 'dashboard/server.js' },
    { title: 'Orchestrator',                          path: 'bridge/orchestrator.js' },
    { title: 'Git finalizer',                         path: 'bridge/git-finalizer.js' },
    { title: 'New-slice generator',                   path: 'bridge/new-slice.js' },
  ],
  nog: [
    { title: 'Review prompt builder',                 path: 'bridge/nog-prompt.js' },
    { title: 'Refactor-risk compute',                 path: 'bridge/rr-compute.js' },
  ],
  bashir: [
    { title: 'Last regression report (what regressed)', path: 'regression/LAST-RUN.md' },
    { title: 'Regression coverage — overview',        path: 'regression/COVERAGE.md' },
    { title: 'Regression suite — README',             path: 'regression/README.md' },
    { title: 'Top-5 user journeys (tests)',           path: 'regression/top-user-journeys/top-5-user-journeys.test.js' },
    { title: 'Slice 311 — regression test',           path: 'regression/slice-311.test.js' },
  ],
  dax: [
    { title: 'Architecture brief',                    path: 'docs/architecture/DAX-ARCHITECTURE-BRIEF.md' },
    { title: 'Bet 2 — relay/dashboard architecture',  path: 'docs/architecture/BET2-RELAY-DASHBOARD-ARCHITECTURE.md' },
    { title: 'Bet 3 — per-slice tracking',            path: 'docs/architecture/BET3-PER-SLICE-TRACKING.md' },
    { title: 'Bet 3 — T&T failsafe decision',         path: 'docs/architecture/BET3-TT-FAILSAFE-DECISION.md' },
    { title: 'Wormhole ADR',                          path: 'docs/architecture/WORMHOLE-ADR.md' },
    { title: 'Ops display: outcome vs review-status', path: 'docs/architecture/OPS-DISPLAY-OUTCOME-VS-REVIEWSTATUS.md' },
  ],
  worf: [
    { title: 'Dev base-reset consult (dev/main reconcile)', path: '.claude/roles/dax/inbox/CONSULT-DEV-RECONCILE-FROM-WORF.md' },
    { title: 'CI workflow',                           path: '.github/workflows/ci.yml' },
    { title: 'Promote workflow (operator-gated merge)', path: '.github/workflows/promote.yml' },
    { title: 'Runbook — push & merge',                path: 'docs/runbooks/RUNBOOK-PUSH-AND-MERGE.md' },
    { title: 'Runbook — Bashir gate',                 path: 'docs/runbooks/RUNBOOK-BASHIR-GATE.md' },
    { title: 'Runbook — Claude auth',                 path: 'docs/runbooks/RUNBOOK-CLAUDE-AUTH.md' },
    { title: 'Main-lock protocol — unlock',           path: 'scripts/unlock-main.sh' },
    { title: 'Main-lock protocol — lock',             path: 'scripts/lock-main.sh' },
  ],
  leeta: [
    { title: 'Landing-page — handoff',                path: '.claude/roles/leeta/HANDOFF-LANDING-PAGE.md' },
  ],
};

function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(CREW, role);
}

// Resolve a repo-relative path safely: must stay within REPO_ROOT and be a real file.
function safeRepoFile(relPath) {
  const abs = path.resolve(REPO_ROOT, relPath);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) return null;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return { abs, mtime: st.mtime.toISOString() };
  } catch (_) {
    return null;
  }
}

function readFirstExisting(relPaths) {
  for (const rel of relPaths || []) {
    const f = safeRepoFile(rel);
    if (f) return { markdown: fs.readFileSync(f.abs, 'utf8'), updated: f.mtime, source: rel };
  }
  return null;
}

// Concatenate every existing source with a source comment + horizontal rule.
function readConcat(relPaths) {
  const parts = [];
  let newest = null;
  for (const rel of relPaths || []) {
    const f = safeRepoFile(rel);
    if (!f) continue;
    parts.push(`<!-- source: ${rel} -->\n${fs.readFileSync(f.abs, 'utf8')}`);
    if (!newest || f.mtime > newest) newest = f.mtime;
  }
  if (!parts.length) return null;
  return { markdown: parts.join('\n\n---\n\n'), updated: newest };
}

function artifactKind(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'md';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'code';
}

function listArtifacts(role) {
  return (CREW_ARTIFACTS[role] || [])
    .map(a => {
      const f = safeRepoFile(a.path);
      return f ? { title: a.title, path: a.path, kind: artifactKind(a.path), updated: f.mtime } : null;
    })
    .filter(Boolean);
}

// Membership guard for the content/raw routes: only serve declared artifacts.
function isDeclaredArtifact(role, relPath) {
  return (CREW_ARTIFACTS[role] || []).some(a => a.path === relPath);
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function readRoleConversations() {
  try { return JSON.parse(fs.readFileSync(ROLE_CONVERSATIONS, 'utf8')); }
  catch (_) { return {}; }
}
function writeRoleConversations(obj) {
  // Atomic: write to a temp file then rename, so a crash mid-write can't leave a
  // half-written JSON that wipes every role's resume pointer on next read.
  try {
    const tmp = ROLE_CONVERSATIONS + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
    fs.renameSync(tmp, ROLE_CONVERSATIONS);
  } catch (_) { /* non-fatal: resume just won't find a record */ }
}

function roleBootstrapPrompt(role) {
  const meta = CREW[role];
  const roleFile = role === 'rom' ? '.claude/CLAUDE.md' : `.claude/roles/${role}/ROLE.md`;
  return `You are ${meta.name} (${meta.title}) on the Denorios project. `
       + `Read ${roleFile} and operate in that role for this conversation.`;
}

// Build the `claude` command for a new (pinned session id) or resumed conversation.
function buildConversationCommand(role, sessionId, mode) {
  if (mode === 'resume') return `claude --resume ${shellQuote(sessionId)}`;
  const meta = CREW[role];
  const name = `${meta.name} · ${new Date().toISOString().slice(0, 10)}`;
  return `claude --session-id ${shellQuote(sessionId)} `
       + `-n ${shellQuote(name)} `
       + `--append-system-prompt ${shellQuote(roleBootstrapPrompt(role))}`;
}

// Best-effort: open Terminal.app running the command in REPO_ROOT. Never rejects.
// Async (execFile, not execFileSync) so a cold Terminal launch or a pending
// automation-permission prompt can't stall the dashboard's single event loop.
// Set LOB_NO_LAUNCH=1 to skip the GUI launch (tests / headless) and just return
// the command for the UI to display.
function launchInTerminal(command) {
  if (process.env.LOB_NO_LAUNCH === '1') return Promise.resolve({ launched: false, error: 'launch_disabled' });
  return new Promise((resolve) => {
    try {
      const script = `#!/bin/bash\ncd ${shellQuote(REPO_ROOT)}\nexec ${command}\n`;
      const scriptPath = path.join(os.tmpdir(), `lob-convo-${crypto.randomUUID()}.sh`);
      fs.writeFileSync(scriptPath, script, { mode: 0o755 });
      const osa = `tell application "Terminal" to do script "bash ${scriptPath}"\n`
                + `tell application "Terminal" to activate`;
      execFile('osascript', ['-e', osa], { timeout: 8000 }, (err) => {
        resolve(err ? { launched: false, error: String((err && err.message) || err) } : { launched: true, error: null });
      });
    } catch (err) {
      resolve({ launched: false, error: String((err && err.message) || err) });
    }
  });
}

// ── GitHub state cache (TTL-based) ──────────────────────────────────────────
// Caches origin/main + origin/dev tips, CI status, and promote result.
// Uses git fetch (network) + gh CLI; both are best-effort and non-blocking
// on cache hit. TTL: 30s for git, 60s for gh (separate sub-caches).
const GIT_TTL_MS = 30 * 1000;
const GH_TTL_MS  = 60 * 1000;
let _gitTipsCache   = { value: null, fetchedAt: 0 };
let _ghCiCache      = { value: null, fetchedAt: 0 };
let _ghPromoteCache = { value: null, fetchedAt: 0 };

// Files matching this pattern count as "critical" for the refactor-risk score.
const RR_CRITICAL_RE = /^(bridge\/|dashboard\/|\.github\/workflows\/|scripts\/)/;

// Scope 'all' (the dispatch path — everything we know is about to change) or 'refs'
// (the promote-COMPLETED path). 'refs' keeps the promote reading: that reading is the
// one that just told us something changed, so it is by definition fresh, and
// re-fetching it would be a wasted network round-trip.
function _bustGitHubCache(scope = 'all') {
  _gitTipsCache = { value: null, fetchedAt: 0 };
  _ghCiCache    = { value: null, fetchedAt: 0 };
  if (scope !== 'refs') _ghPromoteCache = { value: null, fetchedAt: 0 };
}

// ── Promote completion → cache invalidation (slice 362) ─────────────────────
// A promote COMPLETING is an event, but until slice 362 nothing observed it:
// _bustGitHubCache() fired only on dispatch, minutes earlier. So when main
// fast-forwarded, the tips reading above just went on serving the pre-merge refs
// until its own lifetime happened to run out — and every panel read in that window
// showed the slices that had just merged as still pending on dev. On 2026-09-01 an
// operator read that as commits appearing on an unexpected branch and called for an
// investigation. Nothing had moved; the panel was confidently wrong.
//
// _getGhPromote() already fetches `gh run list` to drive the promote strip, so the
// completion is noticed on that same read — no second timer, no extra API call
// (trap 2) — and the refs are dropped the moment the run goes terminal.
const PROMOTE_TERMINAL  = new Set(['success', 'failure']);
const PROMOTE_IN_FLIGHT = new Set(['pending', 'in_progress']);

// Noticing the completion only helps if it happens BEFORE the refs would have
// expired on their own, and GH_TTL_MS (60s) is twice GIT_TTL_MS (30s) — at the
// default lifetime the tips refresh first and the event always arrives too late to
// change anything. So while a run is IN FLIGHT (the one window where main can
// fast-forward under us, and the one window the operator is actually watching the
// strip) the promote reading follows the panel's own 5s poll instead of the full
// lifetime. It also makes the gate phases update per-poll rather than once a minute.
//
// This is NOT "shorten the TTLs" (trap 1): the quiet path — no run in flight — keeps
// GH_TTL_MS exactly, so an ordinary read costs precisely what it always did.
const GH_PROMOTE_LIVE_TTL_MS = 10 * 1000;

// The last promote reading we actually fetched (not served from cache). Only
// readings that carried a real run are recorded, so a gh outage (which degrades to
// `idle`/null) doesn't erase what we were watching. `live_since` is when the run we
// are holding was FIRST seen in flight — keeping the status through an outage needs a
// floor, or an outage that starts mid-run leaves it `in_progress` forever (below).
let _lastPromoteSeen = { run_id: null, status: null, live_since: 0 };

// The live lifetime has to be bounded, because the status it keys off is sticky by
// design. If `gh` breaks while a run is in flight, every later reading degrades to
// `idle`/null and is discarded, so the last status we hold stays `in_progress` for as
// long as the outage lasts — and an unbounded live lifetime would then retry a
// blocking `gh` call (15s timeout, on the request path) every 10s forever. Past this
// window, fall back to the quiet lifetime: nobody is still watching the strip for a
// run this long, and a completion is then noticed within GH_TTL_MS instead of never
// letting the cache rest. Generous enough that a real slow gate keeps the live path.
const GH_PROMOTE_LIVE_WINDOW_MS = 15 * 60 * 1000;

// Lifetime for the NEXT promote read: live only while the run we last saw is still
// running AND has been running less than the window above. Needs no extra call — it
// reads the status we already fetched. Takes its state as arguments so the bound is
// directly testable.
function _promoteTtlMs(seen = _lastPromoteSeen, now = Date.now()) {
  if (!seen || !PROMOTE_IN_FLIGHT.has(seen.status)) return GH_TTL_MS;
  return (now - (seen.live_since || 0)) < GH_PROMOTE_LIVE_WINDOW_MS
    ? GH_PROMOTE_LIVE_TTL_MS : GH_TTL_MS;
}

// Pure: did this promote reading just observe a run FINISH? True when the reading is
// terminal and we were not already holding a terminal reading of that same run — so
// a settled run re-read every TTL does NOT keep busting (that would defeat the cache
// for the quiet path). A run_id we have never seen counts: it either started and
// finished inside one TTL window, or it is the first read after a restart, where the
// caches are empty anyway and the bust is a no-op.
function isFreshPromoteCompletion(prev, next) {
  if (!next || !PROMOTE_TERMINAL.has(next.status) || next.run_id == null) return false;
  if (!prev || prev.run_id !== next.run_id) return true;
  return !PROMOTE_TERMINAL.has(prev.status);
}

// Pure: is the state we are about to serve KNOWN to be behind a merge that already
// happened? A successful promote fast-forwards main to the exact sha it ran against,
// so a success for the current dev tip while our view of main still trails it means
// our refs predate the merge. Say "reconciling" rather than assert the pre-merge
// answer — honest transience beats confident staleness.
//
// A success whose sha is NOT dev's tip is a PAST promote (dev moved on since); main
// trailing dev is then simply real pending work, not a stale read.
function isReconciling(tips, promote) {
  if (!promote || promote.status !== 'success' || !promote.head_sha7) return false;
  // Needs a real refs reading to compare against. Refs we could not read at all are a
  // DIFFERENT failure — already surfaced as github.error — and dressing it up as "a
  // merge is landing" would latch the panel into reconciling (and hold the merge
  // button shut) for as long as the network is down.
  if (tips.error || !tips.origin_dev_sha || !tips.origin_main_sha) return false;
  if (promote.head_sha7 !== tips.origin_dev_sha) return false;
  return tips.origin_main_sha !== promote.head_sha7;
}

function _getGitTips() {
  const now = Date.now();
  if (_gitTipsCache.value && now - _gitTipsCache.fetchedAt < GIT_TTL_MS) {
    return _gitTipsCache.value;
  }
  const result = { origin_main_sha: null, origin_dev_sha: null, commits_ahead: 0,
                   dev_commits: [], promote: null, fetched_at: null, error: null,
                   rr: { score: 0, level: 'clean', commits: 0, churn: 0, critical_files: [],
                         breakdown: { commits_pts: 0, churn_pts: 0, critical_pts: 0 } } };
  try {
    execFileSync('git', ['fetch', 'origin', 'main', 'dev', '--quiet'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    const mainFull = execFileSync('git', ['rev-parse', 'origin/main'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
    const devFull  = execFileSync('git', ['rev-parse', 'origin/dev'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
    result.origin_main_sha = mainFull ? mainFull.slice(0, 7) : null;
    result.origin_dev_sha  = devFull  ? devFull.slice(0, 7)  : null;

    const aheadStr = execFileSync('git', ['rev-list', '--count', 'origin/main..origin/dev'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
    result.commits_ahead = parseInt(aheadStr, 10) || 0;

    // Refactor-risk score (rr) — deterministic, from origin/main...origin/dev.
    // ahead==0 keeps the 'clean' default above without extra git calls.
    if (result.commits_ahead > 0) {
      const shortstat = execFileSync('git', ['diff', '--shortstat', 'origin/main...origin/dev'],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
      const insM = shortstat.match(/(\d+) insertion/);
      const delM = shortstat.match(/(\d+) deletion/);
      const churnIns = insM ? parseInt(insM[1], 10) : 0;
      const churnDel = delM ? parseInt(delM[1], 10) : 0;
      const churn = churnIns + churnDel;

      const namesOut = execFileSync('git', ['diff', '--name-only', 'origin/main...origin/dev'],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
      const criticalFiles = namesOut
        ? namesOut.split('\n').filter(f => RR_CRITICAL_RE.test(f))
        : [];

      const commitsPts  = Math.min(30, result.commits_ahead * 6);
      const churnPts    = Math.min(30, Math.ceil(churn / 40));
      const criticalPts = Math.min(40, criticalFiles.length * 8);
      const score = Math.min(100, commitsPts + churnPts + criticalPts);
      result.rr = {
        score,
        level: score < 25 ? 'low' : score < 50 ? 'moderate' : 'high',
        commits: result.commits_ahead,
        churn,
        churn_ins: churnIns,
        churn_del: churnDel,
        critical_files: criticalFiles,
        breakdown: { commits_pts: commitsPts, churn_pts: churnPts, critical_pts: criticalPts },
      };
    }

    // Ceiling, not a window: the serpentine topology renderer folds every
    // unmerged commit onto stacked rows, so we send all of them (up to a sane
    // safety cap). If dev ever runs past the cap the renderer's dashed lead-in
    // marks the truncation honestly rather than silently showing a partial count.
    const logOut = execFileSync('git',
      ['log', 'origin/dev', '--not', 'origin/main', '--format=%H %ct %s', '--max-count=60', '--reverse'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
    if (logOut) {
      result.dev_commits = logOut.split('\n').filter(Boolean).map(line => {
        const sp1 = line.indexOf(' ');
        const sp2 = sp1 !== -1 ? line.indexOf(' ', sp1 + 1) : -1;
        const sha = sp1 !== -1 ? line.slice(0, sp1) : line;
        const ct = sp2 !== -1 ? parseInt(line.slice(sp1 + 1, sp2), 10) * 1000 : NaN;
        const subj = sp2 !== -1 ? line.slice(sp2 + 1) : '';
        const m = subj.match(/^S(\d+):/i) || subj.match(/^slice[/\s]+(\d+)/i);
        return { sha: sha.slice(0, 7), full_sha: sha, slice_id: m ? m[1] : null,
                 _ct: isNaN(ct) ? 0 : ct,
                 subject: subj, age_s: isNaN(ct) ? null : Math.round((now - ct) / 1000) };
      });
    }

    const mainLog = execFileSync('git', ['log', 'origin/main', '--max-count=1', '--format=%H %ct %s'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
    if (mainLog) {
      const sp1 = mainLog.indexOf(' ');
      const sp2 = sp1 !== -1 ? mainLog.indexOf(' ', sp1 + 1) : -1;
      const sha = sp1 !== -1 ? mainLog.slice(0, sp1) : mainLog;
      const ct = sp2 !== -1 ? parseInt(mainLog.slice(sp1 + 1, sp2), 10) * 1000 : NaN;
      const subj = sp2 !== -1 ? mainLog.slice(sp2 + 1) : '';
      const mp = subj.match(/^S(\d+):/i) || subj.match(/^slice[/\s]+(\d+)/i);
      result.promote = { sha: sha ? sha.slice(0, 7) : null, full_sha: sha || null,
                         _ct: isNaN(ct) ? 0 : ct,
                         age_s: isNaN(ct) ? null : Math.round((now - ct) / 1000),
                         slice_id: mp ? mp[1] : null };
    }
    (result.dev_commits || []).forEach(c => { delete c._ct; });
    if (result.promote) delete result.promote._ct;
    result.fetched_at = new Date(now).toISOString();
  } catch (e) {
    result.error = String(e.message || e).slice(0, 200);
  }
  _gitTipsCache = { value: result, fetchedAt: now };
  return result;
}

function _getGhCi() {
  const now = Date.now();
  if (_ghCiCache.fetchedAt > 0 && now - _ghCiCache.fetchedAt < GH_TTL_MS) {
    return _ghCiCache.value;
  }
  let result = null;
  try {
    const out = execFileSync('gh',
      ['run', 'list', '--workflow=ci.yml', '--branch=dev',
       '--json=status,conclusion,number,url,headSha,updatedAt,databaseId', '--limit=1'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000 }).trim();
    const runs = JSON.parse(out);
    if (runs && runs.length > 0) {
      const run = runs[0];
      let state;
      if (run.status === 'in_progress' || run.status === 'queued') state = 'running';
      else if (run.conclusion === 'success') state = 'passing';
      else if (run.conclusion === 'failure' || run.conclusion === 'cancelled') state = 'failing';
      else state = 'unknown';
      result = { state, run_number: run.number, run_id: run.databaseId ?? null,
                 url: run.url, head_sha: run.headSha, updated_at: run.updatedAt || null };
    }
  } catch (_) { /* gh not installed or not authenticated — non-fatal */ }
  _ghCiCache = { value: result, fetchedAt: now };
  return result;
}

// The regression report that reflects the ACTUAL latest GATE run. Both ci.yml
// (per-push, early warning) AND promote.yml (the operator-gated merge gate) run
// Bashir's suite and upload regression/LAST-RUN.md as the `regression-report`
// artifact. We pick the NEWEST completed run across BOTH workflows on dev and
// download its report, so the panel reflects the run the operator just triggered
// — a promotion included — not only the last push run. (Before this, the panel was
// pinned to ci.yml and froze at the last push whenever a promote ran since.)
//
// Listed newest-first; the newest run that actually carries the artifact wins, so
// a promote from before report-upload (or an expired artifact) is skipped in favour
// of the next real report rather than silently dropping to the stale local file.
const REPORT_WORKFLOWS = { 'CI': 'ci.yml', 'Promote dev to main': 'promote.yml' };
let _reportRunsCache = { value: null, fetchedAt: 0 };
function _latestReportRuns() {
  const now = Date.now();
  if (_reportRunsCache.fetchedAt > 0 && now - _reportRunsCache.fetchedAt < GH_TTL_MS) {
    return _reportRunsCache.value;
  }
  let runs = [];
  try {
    const out = execFileSync('gh',
      ['run', 'list', '--branch=dev', '--limit=15',
       '--json=status,conclusion,number,url,headSha,updatedAt,databaseId,workflowName'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000 }).trim();
    runs = (JSON.parse(out) || [])
      .filter(r => REPORT_WORKFLOWS[r.workflowName] && r.status === 'completed' && r.databaseId != null)
      .map(r => ({
        run_id: r.databaseId,
        run_number: r.number,
        url: r.url || null,
        updated_at: r.updatedAt || null,
        state: r.conclusion === 'success' ? 'passing'
             : (r.conclusion === 'failure' || r.conclusion === 'cancelled') ? 'failing' : 'unknown',
        workflow: REPORT_WORKFLOWS[r.workflowName],
      }))
      // Newest-first by completion time. Missing timestamp (can't occur for a
      // completed run, but be explicit) sorts oldest rather than relying on the
      // Date.parse(0) → year-2000 coincidence.
      .sort((a, b) => {
        const ta = Date.parse(a.updated_at), tb = Date.parse(b.updated_at);
        return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
      });
  } catch (_) { /* gh missing/unauthenticated — non-fatal, caller falls back to local */ }
  _reportRunsCache = { value: runs, fetchedAt: now };
  return runs;
}

let _regReportCache = { runId: null, value: null, fetchedAt: 0 };
const REG_REPORT_TTL_MS = 60 * 1000;
function getGitHubRegressionReport() {
  const candidates = _latestReportRuns();
  if (!candidates.length) return null;
  const newestId = candidates[0].run_id;
  const now = Date.now();
  // Cache against the newest run id: a fresh ci/promote run changes it and busts
  // the cache; otherwise re-use it (the download is slow and the report is stable).
  if (_regReportCache.runId === newestId && _regReportCache.value &&
      (now - _regReportCache.fetchedAt) < REG_REPORT_TTL_MS) {
    return _regReportCache.value;
  }
  let value = null;
  for (const run of candidates.slice(0, 4)) {
    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-report-'));
      // Artifacts exist only once a run finished uploading; on miss this throws → next candidate.
      execFileSync('gh', ['run', 'download', String(run.run_id), '-n', 'regression-report', '-D', dir],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
      const f = path.join(dir, 'LAST-RUN.md');
      if (fs.existsSync(f)) {
        const markdown = fs.readFileSync(f, 'utf8');
        const first = markdown.split('\n')[0];
        const status = /🔴|—\s*FAIL/.test(first) ? 'fail'
                     : /🟢|—\s*PASS/.test(first) ? 'pass' : 'none';
        value = { markdown, updated: run.updated_at || new Date(now).toISOString(),
                  status, source: 'github', run_number: run.run_number,
                  run_url: run.url, workflow: run.workflow };
        break;
      }
    } catch (_) { /* no artifact on this run → try the next candidate */ }
    finally { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } }
  }
  // Cache against the newest id even on miss, so we don't re-attempt downloads each
  // request within the TTL; a brand-new run changes newestId and busts it.
  _regReportCache = { runId: newestId, value, fetchedAt: now };
  return value;
}

// Strip machine tags from a test name so the operator reads plain behaviour:
// "J-foo slice-99809-ac-2 — the dashboard explains promote" -> "the dashboard explains promote".
function humanizeTestName(name) {
  let h = String(name || '');
  const dash = h.indexOf(' — ');
  if (dash !== -1) h = h.slice(dash + 3);
  h = h.replace(/^(?:J-[\w-]+\s+)?(?:slice-[\w-]+\s+)?(?:—\s*)?/i, '');
  return h.trim() || String(name || '');
}

// What changed in the REGRESSION + E2E suites between main and dev, in plain
// language, so the operator can approve (intended behaviour change) or stop
// (a removed/loosened check that may be masking a real regression) before the
// gate runs. Cached briefly — it shells git per changed test file.
let _testChangesCache = { key: null, value: null, fetchedAt: 0 };
function getTestChanges() {
  const now = Date.now();
  let head = null;
  try { head = execFileSync('git', ['rev-parse', 'origin/dev'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim(); } catch (_) {}
  const key = head;
  if (key && _testChangesCache.key === key && (now - _testChangesCache.fetchedAt) < 30000) {
    return _testChangesCache.value;
  }

  let files = [];
  try {
    const out = execFileSync('git',
      ['diff', '--name-only', 'origin/main...origin/dev', '--', 'regression/', 'e2e/'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 8000 }).trim();
    files = out ? out.split('\n').filter(Boolean) : [];
  } catch (_) { files = []; }

  // Per-check classification (ADR-TEST-UPDATE-GATE, Slice A). The signed engine keys
  // each check by its slice-ac tag, and reports a DIRECTION (tightened / loosened /
  // reworded / removed / skipped) — so loosen/delete/skip are loud, not benign churn.
  // Required lazily (code, relative to this file) so the test harness — which compiles
  // server.js at a faked path and only string-rewrites the bridge require — never needs
  // to stage lib/ unless a test actually exercises this endpoint.
  const { classifyFileDiff } = require(path.join(__dirname, '..', 'lib', 'assert-direction'));
  const added = [], removed = [], modified = [];
  for (const f of files) {
    if (!/\.(test|spec)\.js$/.test(f)) continue;
    let diff = '';
    try {
      diff = execFileSync('git', ['diff', 'origin/main...origin/dev', '--', f],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 8000 });
    } catch (_) { continue; }
    const byTag = classifyFileDiff(diff);
    for (const k of Object.keys(byTag)) {
      const e = byTag[k];
      const name = humanizeTestName(e.name);
      // A renamed check arrives already merged with its predecessor, so it lands in
      // `modified` with a real direction plus a `renamedFrom` label -- never in `removed`.
      const renamedFrom = e.rename ? humanizeTestName(e.rename.from) : null;
      if (e.onPlus && !e.onMinus) added.push({ file: f, name, direction: 'added' });
      else if (e.onMinus && !e.onPlus) removed.push({ file: f, name, direction: 'removed' });
      else modified.push({ file: f, name, direction: e.direction, renamedFrom });
    }
  }
  // The dangerous subset the gate + UI must surface loudly.
  const loosened = modified.filter(m => m.direction === 'loosened');
  const skipped  = modified.filter(m => m.direction === 'skipped');

  const value = {
    base: 'origin/main', head: 'origin/dev',
    counts: { added: added.length, removed: removed.length, modified: modified.length,
              loosened: loosened.length, skipped: skipped.length },
    added, removed, modified, loosened, skipped,
    anyChange: added.length + removed.length + modified.length > 0,
  };
  _testChangesCache = { key, value, fetchedAt: now };
  return value;
}

// The Test-Update Gate VERDICT for the dev→main promotion (ADR-TEST-UPDATE-GATE,
// Slice D). getTestChanges() lists what changed; this says whether it's SAFE to run:
// clear / needs_review / overridden / red_flag. Pins base = merge-base(main,dev),
// head = dev tip, so the verdict is the exact promoted changeset. SHA-keyed cache.
// The dashboard defaults to STOP on red_flag and demands a second acknowledgement.
let _testsNeededCache = { key: null, value: null, fetchedAt: 0 };
function getTestsNeeded() {
  const now = Date.now();
  let head = null, base = null;
  try { head = execFileSync('git', ['rev-parse', 'origin/dev'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim(); } catch (_) {}
  try { base = execFileSync('git', ['merge-base', 'origin/main', 'origin/dev'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim(); } catch (_) {}
  if (!head || !base) return { error: 'cannot resolve git refs', decision: 'unknown', head, base };

  const key = base + '..' + head;
  if (_testsNeededCache.key === key && (now - _testsNeededCache.fetchedAt) < 30000) {
    return _testsNeededCache.value;
  }

  // Lazily required (code, relative to this file) for the same reason as the engine
  // in getTestChanges — the test harness compiles server.js at a faked path.
  const { classify } = require(path.join(__dirname, '..', 'lib', 'tests-needed'));
  let r;
  try { r = classify({ base, head, repoRoot: REPO_ROOT }); }
  catch (err) { return { error: String(err && err.message || err), decision: 'unknown', head, base }; }

  const value = {
    decision: r.decision,
    base: r.base, head: r.head, base7: String(r.base || '').slice(0, 7), head7: String(r.head || '').slice(0, 7),
    counts: {
      loosened: r.loosenedUndeclared.length, removed: r.removedUndeclared.length, skipped: r.skippedUndeclared.length,
      newBehaviourNoTest: r.newBehaviourNoTest.length, unguarded: r.unguardedSourceChanges.length,
      overridden: r.overridden.length, rejectedTrailers: r.rejectedTrailers.length,
    },
    coverageShrink: !!r.coverageShrink, coverageShrinkUndeclared: !!r.coverageShrinkUndeclared,
    coverageGuardCount: r.coverageGuardCount, coverageGuardCountBase: r.coverageGuardCountBase,
    mismatchedOverride: !!r.mismatchedOverride,
    // The dangerous, human-readable specifics the second-ack must enumerate.
    blockers: []
      .concat(r.loosenedUndeclared.map(c => ({ kind: 'loosened', name: humanizeTestName(c.tag), file: c.file, renamedFrom: c.rename ? humanizeTestName(c.rename.from) : null })))
      .concat(r.removedUndeclared.map(c => ({ kind: 'removed', name: humanizeTestName(c.tag), file: c.file, renamedFrom: null })))
      .concat(r.skippedUndeclared.map(c => ({ kind: 'skipped', name: humanizeTestName(c.tag), file: c.file, renamedFrom: c.rename ? humanizeTestName(c.rename.from) : null })))
      .concat(r.newBehaviourNoTest.map(b => ({ kind: 'untested', name: b.path, file: b.path }))),
    needsReview: r.unguardedSourceChanges.map(b => b.path),
  };
  _testsNeededCache = { key, value, fetchedAt: now };
  return value;
}

// ── The Test Drift Gate (operator-facing review over the Test-Update classifier) ──
// Re-buckets the SAME pinned verdict into PROCEED / REVIEW / STOP with two plain-English
// piles — POSSIBLE REGRESSION (a guard weakened/removed, or new code untested) vs
// DELIBERATE CHANGE (behaviour moved, no test moved). Read-only/advisory; the dashboard
// turns it into the OK/STOP checkpoint. Same changeset as the promote gate: origin/dev
// vs merge-base(origin/main, origin/dev). Fails safe to STOP.
let _testDriftCache = { key: null, value: null, fetchedAt: 0 };
function getTestDrift() {
  const now = Date.now();
  let head = null, base = null;
  try { head = execFileSync('git', ['rev-parse', 'origin/dev'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim(); } catch (_) {}
  try { base = execFileSync('git', ['merge-base', 'origin/main', 'origin/dev'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim(); } catch (_) {}
  const safeStop = (headline) => ({ decision: 'unknown', action: 'STOP', headline,
    regression: [], deliberate: [], declared: [], counts: { regression: 0, deliberate: 0, declared: 0 }, base, head });
  if (!head || !base) return safeStop('Cannot resolve git refs — STOP (fail safe).');

  const key = base + '..' + head;
  if (_testDriftCache.key === key && (now - _testDriftCache.fetchedAt) < 30000) return _testDriftCache.value;

  const { classify } = require(path.join(__dirname, '..', 'lib', 'tests-needed'));
  const { drift } = require(path.join(__dirname, '..', 'lib', 'test-drift'));
  let value;
  try { value = drift(classify({ base, head, repoRoot: REPO_ROOT })); }
  catch (err) { value = safeStop('Could not classify the changeset: ' + String(err && err.message || err)); }
  _testDriftCache = { key, value, fetchedAt: now };
  return value;
}

// ── CHECK FOR TEST UPDATES — stage ① of the two-stage merge gate ──────────────
// Drains the ACs, reconciles them against the test suite, applies recorded human
// decisions, and triages each (high-confidence acts; low-confidence MISSING is flagged).
// `ready` gates the merge button. Reads fresh each call (no cache) so a just-recorded
// decision flips the verdict immediately.
function getCheckTestUpdates() {
  const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fb; } };
  const { reconcile } = require(path.join(__dirname, '..', 'lib', 'ac-reconcile'));
  const { triage } = require(path.join(__dirname, '..', 'lib', 'check-test-updates'));
  const { scanRangeManifest } = require(path.join(__dirname, '..', 'lib', 'ac-range-scan'));
  // LIVE manifest: the ACs actually being promoted (origin/main..origin/dev `AC:` trailers),
  // NOT the static regression/AC-MANIFEST.lock. Reconciling that stale, in-sync lock against
  // COVERAGE.lock is what made this gate go GREEN in milliseconds regardless of the merge.
  const manifest  = scanRangeManifest({
    // --reverse = OLDEST-first. git log defaults to newest-first; the scanner's dedup is
    // last-writer-wins, so without --reverse an AMENDED AC would resolve to its OLDEST text —
    // and if that old text already had a guard, the amendment false-greens (untested new text
    // sails through). Oldest-first makes last-writer land on the newest declaration.
    gitLog: (range) => execFileSync('git', ['log', range, '--reverse', '--format=%B'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }),
  });
  const coverage  = readJson(path.join(REPO_ROOT, 'regression', 'COVERAGE.lock'), { bySource: {} });
  const decisions = readJson(path.join(REPO_ROOT, 'regression', 'AC-DECISIONS.json'), {});
  try {
    const report = triage({ reconcile: reconcile({ manifest, coverage }), manifest, decisions });
    report.range = 'origin/main..origin/dev';
    report.acsInRange = Object.keys(manifest.byTag || {}).length;
    // Annotate each flagged AC with what Julian has authored for it (draft / question / in-flight).
    for (const it of (report.flagged || [])) it.authoring = authoringStateFor(it.tag);
    report.ts = new Date().toISOString();
    return report;
  } catch (e) {
    return { ready: false, verdict: 'ERROR', items: [], flagged: [],
      summary: { checked: 0, passed: 0, autoUpdate: 0, flagged: 0, kept: 0 }, error: String(e && e.message || e) };
  }
}

// ── THE MERGE LOCK — derived on the SERVER, not in the browser ────────────────
// The padlock used to be advisory: renderPromoteAction() disabled the button in
// the page, and POST /api/promote/dispatch fired `gh workflow run promote.yml`
// regardless — it consulted only commits_ahead and the run mutex. On 2026-09-01 a
// merge went through with the decision popup still open. A disabled button is a
// hint; a stale page, a second tab, or a scripted POST walks straight past it.
//
// mergeLockRefusal() is that rule, made real. It returns null when the dispatch
// may proceed, or the refusal body otherwise:
//   test_updates_unresolved  — an AC in the pending range still needs a human call
//   stale_check              — the operator's check was made against a different tip
//   test_updates_unavailable — the triage could not be derived at all (fail CLOSED)
//
// The request may NEVER assert the answer. The one client-supplied value read here
// is WHICH tip the operator's check was made against, and it can only ever ADD a
// refusal, never remove one — supplying a matching sha is not a way to be let
// through, it is one more way to be turned back (cf. approval provenance, s354).
//
// Deliberately UNCACHED: getCheckTestUpdates() shells out to `git log` over the
// range every call. A slightly slow refusal is correct; a fast stale one is the
// bug this closes.
function mergeLockRefusal({ checkedSha, devSha } = {}) {
  let report;
  try { report = getCheckTestUpdates(); }
  catch (err) {
    return { error: 'test_updates_unavailable',
             detail: String(err && err.message || err).slice(0, 200) };
  }
  if (!report || report.error || report.verdict === 'ERROR') {
    return { error: 'test_updates_unavailable',
             detail: String((report && report.error) || 'test-update triage unavailable').slice(0, 200) };
  }

  // Name what is outstanding: the count and the tags, so the panel can say WHY.
  const flagged = Array.isArray(report.flagged) ? report.flagged : [];
  if (flagged.length > 0 || report.ready !== true) {
    return {
      error: 'test_updates_unresolved',
      outstanding: flagged.length,
      tags: flagged.map(f => f && f.tag).filter(Boolean),
      items: flagged.map(f => ({ tag: f && f.tag, title: f && f.title })),
      range: report.range || null,
      verdict: report.verdict || null,
    };
  }

  // Bind the pass to a tip. A check earned against an OLDER integration tip does
  // not unlock a newer one — the operator ruled on a different changeset than the
  // one about to reach main. (Absent a supplied sha the derivation above still
  // governs; it is always computed against the CURRENT range.)
  if (checkedSha != null && checkedSha !== '') {
    if (!_shaMatches(checkedSha, devSha)) {
      return { error: 'stale_check',
               checked_sha: String(checkedSha).trim().slice(0, 40),
               dev_sha: devSha || null };
    }
  }
  return null;
}

// Short-sha-tolerant equality: the dashboard carries 7-char tips, callers may pass
// full 40s. Both sides must be real hex of at least abbreviation length, so a stray
// "a" can never prefix-match its way past the tip binding.
function _shaMatches(a, b) {
  const x = String(a == null ? '' : a).trim().toLowerCase();
  const y = String(b == null ? '' : b).trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(x) || !/^[0-9a-f]{7,40}$/.test(y)) return false;
  const n = Math.min(x.length, y.length);
  return x.slice(0, n) === y.slice(0, n);
}

// Record (or clear) the operator's per-AC ruling for a low-confidence AC.
// decision: 'update' | 'keep' | null(clear). Persisted to regression/AC-DECISIONS.json.
function recordAcDecision(tag, decision) {
  const p = path.join(REPO_ROOT, 'regression', 'AC-DECISIONS.json');
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  if (decision === 'update' || decision === 'keep') cur[tag] = decision;
  else delete cur[tag];
  fs.writeFileSync(p, JSON.stringify(cur, null, 1));
  return cur;
}

// ── CHECK gate authoring: Julian drafts/updates the test for a flagged AC ──────────────
// One press of CHECK FOR TEST UPDATES drains the ACs AND kicks Julian off (scripts/
// author-ac-test.js → claude -p, adversarial QA mission, autonomous) to author the guarding
// test for each flagged AC. Drafts land in regression/.drafts/ for review — never straight
// into the live suite, and the operator can't green the gate off an un-tested AC.
const DRAFTS_DIR = path.join(REPO_ROOT, 'regression', '.drafts');
function _draftMtime(p) { try { return fs.statSync(p).mtimeMs; } catch (_) { return 0; } }

// What has Julian produced for this AC: drafted | question | authoring | failed | pending.
function authoringStateFor(tag) {
  let files = [];
  try { files = fs.readdirSync(DRAFTS_DIR); } catch (_) { return { state: 'pending' }; }
  const draft = files.find(f => f.startsWith(`${tag}.draft.`));
  if (draft) { try { fs.unlinkSync(path.join(DRAFTS_DIR, `${tag}.running`)); } catch (_) {} return { state: 'drafted', draft }; }
  if (files.includes(`${tag}.QUESTION.md`)) {
    try { fs.unlinkSync(path.join(DRAFTS_DIR, `${tag}.running`)); } catch (_) {}
    let question = ''; try { question = fs.readFileSync(path.join(DRAFTS_DIR, `${tag}.QUESTION.md`), 'utf8'); } catch (_) {}
    return { state: 'question', question };
  }
  if (files.includes(`${tag}.running`)) {
    const age = Date.now() - _draftMtime(path.join(DRAFTS_DIR, `${tag}.running`));
    return { state: age > 12 * 60 * 1000 ? 'failed' : 'authoring' };
  }
  return { state: 'pending' };
}

// Spawn Julian (detached) for each not-already-handled tag. Returns the tags kicked off.
function kickOffAuthoring(tags) {
  const { spawn } = require('child_process');
  const authorScript = path.join(REPO_ROOT, 'scripts', 'author-ac-test.js');
  // Never spawn where the author script isn't present (e.g. the e2e seed-fixture tmpdir,
  // which has no scripts/): it couldn't author anyway, and a stray spawn + .running marker
  // would pollute the shared test server and flake unrelated specs.
  if (!fs.existsSync(authorScript)) return [];
  try { fs.mkdirSync(DRAFTS_DIR, { recursive: true }); } catch (_) {}
  const kicked = [];
  for (const tag of tags) {
    if (!/^slice-\d+-ac-\d+$/.test(tag)) continue;
    const st = authoringStateFor(tag).state;
    if (st === 'drafted' || st === 'question' || st === 'authoring') continue; // done or in-flight
    try {
      fs.writeFileSync(path.join(DRAFTS_DIR, `${tag}.running`), new Date().toISOString());
      const child = spawn(process.execPath, [authorScript, tag],
        { cwd: REPO_ROOT, detached: true, stdio: 'ignore' });
      child.unref();
      kicked.push(tag);
    } catch (_) {}
  }
  return kicked;
}

// The three gate phases promote.yml runs, in order, before main moves. Matched by
// step name so renaming a step's prose doesn't silently drop a phase (the match is
// the contract; j-promote-gate-phases locks it).
const PROMOTE_PHASES = [
  { key: 'tests-needed', label: 'test-update gate', match: /test-update gate/i },
  { key: 'regression',   label: 'regression',       match: /regression gate/i },
  { key: 'e2e',          label: 'e2e',               match: /e2e|playwright|click-paths/i },
  { key: 'ff',           label: 'fast-forward',      match: /fast-forward main/i },
];

// Steps that prepare the run rather than BE a gate phase. Excluded from matching so
// e.g. "Install dependencies (browser e2e gate)" (1s) is never mistaken for the actual
// "Run browser e2e gate" step (~34s) — that mismatch made e2e look instant.
const PROMOTE_NON_PHASE = /^(install|set up|setup|post |complete |checkout|run actions)/i;

// Pure: fold a promote run's raw job steps into the 3 gate phases with status +
// duration, so the dashboard can show "regression ✓ 2s → e2e ⟳ → fast-forward ⏳".
// Exported for unit testing (no network).
function mapPromotePhases(steps) {
  if (!Array.isArray(steps)) return null;
  return PROMOTE_PHASES.map(p => {
    const s = steps.find(st => {
      const name = st && st.name || '';
      return p.match.test(name) && !PROMOTE_NON_PHASE.test(name);
    });
    let status = 'pending';
    let duration_s = null;
    if (s) {
      if (s.status === 'in_progress' || s.status === 'queued') status = (s.status === 'in_progress') ? 'running' : 'pending';
      else if (s.conclusion === 'success') status = 'passed';
      else if (s.conclusion === 'failure' || s.conclusion === 'cancelled' || s.conclusion === 'timed_out') status = 'failed';
      else if (s.conclusion === 'skipped') status = 'skipped';
      const st = s.startedAt ? Date.parse(s.startedAt) : NaN;
      const en = s.completedAt ? Date.parse(s.completedAt) : NaN;
      if (!isNaN(st) && !isNaN(en) && en >= st) duration_s = Math.round((en - st) / 1000);
    }
    return { key: p.key, label: p.label, status, duration_s };
  });
}

// Fetch a promote run's step-level progress (one extra gh call, shares the 60s cache).
function _getPromotePhases(runId) {
  if (runId == null) return null;
  try {
    const out = execFileSync('gh', ['run', 'view', String(runId), '--json', 'jobs'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000 }).trim();
    const steps = (JSON.parse(out).jobs || []).flatMap(j => j.steps || []);
    return mapPromotePhases(steps);
  } catch (_) { return null; }
}

// When a promote run FAILS, pull the specific failing tests out of its log so the
// operator handoff prompt names the cause instead of a generic "go investigate". The
// run log is the only place this lives — the gate forbids always()/failure() steps,
// so promote.yml itself can't emit a failure report. Pure parser + run-id-cached fetch.
function parseGateFailures(log) {
  if (!log) return null;
  const tests = [], seenT = new Set();
  // Playwright numbered failure summary: "N) [chromium] › e2e/foo.spec.js:LINE:COL › title".
  const tre = /\d+\)\s+\[[^\]]+\]\s+›\s+(e2e\/\S+\.spec\.js):(\d+):\d+\s+›\s+(.+?)\s*$/gm;
  let m;
  while ((m = tre.exec(log)) !== null) {
    const key = `${m[1]}:${m[2]}|${m[3]}`;
    if (seenT.has(key)) continue; seenT.add(key);
    tests.push({ spec: m[1], line: m[2], title: m[3].trim() });
  }
  const locators = [], seenL = new Set();
  // "Locator: locator('…').locator('.leaf')" → surface the leaf selector that wasn't found.
  const lre = /Locator:\s*(.+?)\s*$/gm;
  while ((m = lre.exec(log)) !== null) {
    const full = m[1].trim();
    const leafs = [...full.matchAll(/\.locator\(\s*['"]([^'"]+)['"]/g)];
    const loc = leafs.length ? leafs[leafs.length - 1][1] : full;
    if (seenL.has(loc)) continue; seenL.add(loc);
    locators.push(loc);
  }
  // Non-Playwright gate failures (the Test-Update gate, node:test regression) print a
  // different shape, so the e2e regexes above miss them — that left the dev-lead handoff
  // prompt generic ("investigate the test-update suite") with no specifics. GH `--log-failed`
  // prefixes each line with "<job> <step> <ISO-timestamp> "; strip up to the timestamp to
  // recover the real content (keeping its original indentation), then parse it.
  const reasons = [], seenR = new Set();
  const pushR = (r) => { r = (r || '').trim(); if (r && !seenR.has(r)) { seenR.add(r); reasons.push(r); } };
  const clean = log.split('\n').map(l => l.replace(/^.*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''));
  // Test-Update gate: "⚠ <Category> (N):" failure headers, each followed by "  - <item>"
  // lines. The declared/advisory categories ("… (declared)", "Needs review …") carry no ⚠,
  // so we only capture ⚠-marked categories plus "Rejected trailers" (printed without a ⚠).
  let cat = null;
  for (const line of clean) {
    const cov = line.match(/^\s*⚠\s*(Coverage shrank:.+?)\s*$/);
    if (cov) { pushR(cov[1]); cat = null; continue; }
    const hdr = line.match(/^\s*(⚠\s*)?(.+?)\s*\(\d+\):\s*$/);
    if (hdr) { const name = hdr[2].trim(); cat = (hdr[1] || name === 'Rejected trailers') ? name : null; continue; }
    const im = line.match(/^\s+-\s+(.+?)\s*$/);
    if (im && cat) { pushR(`${cat}: ${im[1]}`); continue; }
    if (line.trim() && !/^\s/.test(line)) cat = null; // a non-indented line ends the block
  }
  // node:test regression failures: "✖ <test name> (Nms)" (spec reporter) or TAP
  // "not ok N - <name>" (some CI configs). Skip the "✖ failing tests:" summary header.
  for (const line of clean) {
    const fm = line.match(/^✖\s+(.+?)(?:\s+\(\d[\d.]*ms\))?\s*$/);
    if (fm && !/^failing tests:?$/i.test(fm[1].trim())) pushR(`Failing test: ${fm[1].trim()}`);
    const tap = line.match(/^not ok \d+ - (.+?)(?:\s+#.*)?\s*$/);
    if (tap) pushR(`Failing test: ${tap[1].trim()}`);
  }
  return (tests.length || locators.length || reasons.length) ? { tests, locators, reasons } : null;
}

let _promoteFailCache = { runId: null, value: null, fetchedAt: 0 };
function getPromoteFailureDetail(runId) {
  if (runId == null) return null;
  const now = Date.now();
  if (_promoteFailCache.runId === runId && (now - _promoteFailCache.fetchedAt) < GH_TTL_MS) {
    return _promoteFailCache.value;
  }
  let value = null;
  try {
    const log = execFileSync('gh', ['run', 'view', String(runId), '--log-failed'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
    value = parseGateFailures(log);
  } catch (_) { value = null; }
  _promoteFailCache = { runId, value, fetchedAt: now };
  return value;
}

function _getGhPromote() {
  const now = Date.now();
  if (_ghPromoteCache.fetchedAt > 0 && now - _ghPromoteCache.fetchedAt < _promoteTtlMs()) {
    return _ghPromoteCache.value;
  }
  let result = { status: 'idle', run_id: null, url: null, head_sha7: null, updated_at: null, phases: null };
  try {
    const out = execFileSync('gh',
      ['run', 'list', '--workflow=promote.yml', '--limit', '1',
       '--json', 'status,conclusion,databaseId,url,headSha'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000 }).trim();
    const runs = JSON.parse(out);
    if (runs && runs.length > 0) {
      const run = runs[0];
      let status;
      if (run.status === 'queued' || run.status === 'waiting' ||
          run.status === 'requested' || run.status === 'pending') status = 'pending';
      else if (run.status === 'in_progress') status = 'in_progress';
      else if (run.status === 'completed' && run.conclusion === 'success') status = 'success';
      else if (run.status === 'completed' &&
               (run.conclusion === 'failure' || run.conclusion === 'cancelled' ||
                run.conclusion === 'timed_out')) status = 'failure';
      else status = 'idle';
      result = {
        status,
        run_id: run.databaseId ?? null,
        url: run.url ?? null,
        head_sha7: run.headSha ? run.headSha.slice(0, 7) : null,
        updated_at: new Date(now).toISOString(),
        // Per-phase gate progress (regression → e2e → fast-forward) so the operator
        // SEES the regression suite run green before main moves.
        phases: _getPromotePhases(run.databaseId),
        // On a red gate, the specific failing tests + not-found selectors, so the
        // operator handoff prompt is precise instead of "go investigate the suite".
        failure_detail: status === 'failure' ? getPromoteFailureDetail(run.databaseId) : null,
      };
    }
  } catch (_) { /* gh not installed or not authenticated — non-fatal, degrade to idle */ }
  _ghPromoteCache = { value: result, fetchedAt: now };

  // This reading is the ONLY place a completed promote can be noticed without a
  // second poller. If the run just went terminal, the refs we hold are pre-merge.
  if (result.run_id != null) {
    if (isFreshPromoteCompletion(_lastPromoteSeen, result)) _bustGitHubCache('refs');
    // Carry the original in-flight stamp across polls of the SAME run, so the live
    // window measures how long the RUN has been going, not how long since the last poll.
    const sameRunAlreadyLive =
      (_lastPromoteSeen.run_id === result.run_id &&
       PROMOTE_IN_FLIGHT.has(_lastPromoteSeen.status))
        ? _lastPromoteSeen.live_since : 0;
    _lastPromoteSeen = {
      run_id: result.run_id,
      status: result.status,
      live_since: PROMOTE_IN_FLIGHT.has(result.status) ? (sameRunAlreadyLive || now) : 0,
    };
  }
  return result;
}

// Promote FIRST, then the refs. A promote that just completed invalidates the refs
// caches above, so ordering it first means the very response that reports the merge
// also carries post-merge tips — instead of pairing a fresh "success" with refs from
// before the fast-forward (the skew that made merged slices read as pending).
function getGitHubState() {
  const promote_run = _getGhPromote();
  const tips        = _getGitTips();
  const ci          = _getGhCi();
  // Honest transience: if the refs still don't show main at the promoted sha, say so
  // rather than serving the pre-merge answer as fact.
  const reconciling = isReconciling(tips, promote_run);
  return { ...tips, ci, promote_run, reconciling };
}

// ── Rollback (revert-forward through the gate) ──────────────────────────────
// ADR-ROLLBACK-MODEL: rollback is NOT a reset/force-push of main. It is a
// `git revert` commit on dev, promoted through the EXISTING gate (promote.yml).
// main stays fast-forward-only; the regression suite re-runs against the
// reverted state before it reaches main. These helpers create the revert
// commit; the /api/rollback/dispatch endpoint then fires promote.yml exactly
// like /api/promote/dispatch (same 409 mutex, same CI strip).

// Thin git runner. _runGitIn(cwd, ...) runs in an explicit dir; _runGit(...)
// defaults to REPO_ROOT (same isolation as getGitHubState's calls). Returns
// trimmed stdout.
function _runGitIn(cwd, args, timeout = 15000) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function _runGit(args, timeout = 15000) {
  return _runGitIn(REPO_ROOT, args, timeout);
}

// Resolve a slice id to the dev commit it squashed to, from the register's
// authoritative SLICE_SQUASHED_TO_DEV event (latest wins). Returns the full
// sha string, or null if the slice never squashed to dev.
function resolveSquashSha(sliceId) {
  const events = readRegister();
  let sha = null;
  for (const ev of events) {
    if (ev.event === 'SLICE_SQUASHED_TO_DEV' && String(ev.id) === String(sliceId)) {
      sha = ev.squash_sha || ev.dev_tip_sha || sha;
    }
  }
  return sha;
}

// Given a revert that conflicts, name the later slice/commit most likely to
// blame: the newest commit in <squashSha>..origin/dev that touched a conflicted
// file. Best-effort — used only for the operator-facing "needs a forward-fix"
// message, never for control flow.
function _blameConflict(squashSha, conflictFiles) {
  if (!conflictFiles || conflictFiles.length === 0) return null;
  try {
    const out = _runGit(['log', `${squashSha}..origin/dev`, '--max-count=1',
      '--format=%H %s', '--', ...conflictFiles]);
    if (!out) return null;
    const sp = out.indexOf(' ');
    const sha = sp === -1 ? out : out.slice(0, sp);
    const subject = sp === -1 ? '' : out.slice(sp + 1);
    const m = subject.match(/^S(\d+):/i) || subject.match(/slice[/\s]+(\d+)/i);
    return { sha: sha.slice(0, 7), subject, slice_id: m ? m[1] : null };
  } catch (_) {
    return null;
  }
}

/**
 * createRevertCommit({ squashSha, sliceId })
 *
 * Creates a clean `git revert` commit of `squashSha` on dev and pushes it to
 * origin/dev. Returns a tagged result; NEVER throws for the expected refusal
 * cases (caller maps them to HTTP codes):
 *
 *   { ok: true, revert_sha }                       — revert committed + pushed
 *   { ok: false, code: 'unknown_sha' }             — no commit to revert
 *   { ok: false, code: 'not_on_dev' }              — sha not reachable from origin/dev
 *   { ok: false, code: 'not_on_main' }             — slice isn't promoted; nothing on main to undo
 *   { ok: false, code: 'conflict', conflict_files, blame } — later slice touched the same code
 *   { ok: false, code: 'git_error', detail }       — unexpected git failure
 *
 * The revert is built in an ISOLATED, throwaway git worktree checked out at
 * origin/dev — the live REPO_ROOT working tree (perpetually dirty with
 * register/state churn) is never touched. Clean-only by design: on conflict we
 * discard the worktree and degrade to a human-authored forward-fix (ADR Q3).
 * We never auto-resolve or force.
 */
function createRevertCommit({ squashSha, sliceId, push = true }) {
  if (!squashSha) return { ok: false, code: 'unknown_sha' };
  let wt = null;
  try {
    _runGit(['fetch', 'origin', 'main', 'dev', '--quiet'], 20000);

    // The commit must exist and be reachable from origin/dev (you cannot revert
    // what isn't on the branch you'd push to).
    try {
      _runGit(['merge-base', '--is-ancestor', squashSha, 'origin/dev']);
    } catch (_) {
      // Distinguish "no such commit" from "commit exists but off-branch".
      try { _runGit(['cat-file', '-e', `${squashSha}^{commit}`]); }
      catch (_2) { return { ok: false, code: 'unknown_sha' }; }
      return { ok: false, code: 'not_on_dev' };
    }

    // Rollback only undoes things that actually reached main. A slice still
    // only on dev isn't "rolled back" — it's simply not promoted yet.
    try {
      _runGit(['merge-base', '--is-ancestor', squashSha, 'origin/main']);
    } catch (_) {
      return { ok: false, code: 'not_on_main' };
    }

    // Build the revert in a detached, throwaway worktree at origin/dev. Sharing
    // REPO_ROOT's object DB, this never disturbs the live checkout (its branch,
    // index, and uncommitted register/state churn are all untouched).
    wt = path.join(os.tmpdir(), `lob-rollback-${squashSha.slice(0, 7)}-${process.pid}-${Date.now()}`);
    _runGit(['worktree', 'add', '--quiet', '--detach', wt, 'origin/dev'], 20000);

    try {
      _runGitIn(wt, ['revert', '--no-edit', squashSha], 20000);
    } catch (revErr) {
      // Conflict (or any failed revert): a later slice touched the same code.
      let conflictFiles = [];
      try {
        conflictFiles = _runGitIn(wt, ['diff', '--name-only', '--diff-filter=U'])
          .split('\n').filter(Boolean);
      } catch (_) { /* best-effort */ }
      const blame = _blameConflict(squashSha, conflictFiles);
      return { ok: false, code: 'conflict', conflict_files: conflictFiles, blame,
               detail: String(revErr.message || revErr).slice(0, 200) };
    }

    const revertSha = _runGitIn(wt, ['rev-parse', 'HEAD']);
    // Push the detached revert straight onto origin/dev (a fast-forward — its
    // parent is the current origin/dev tip).
    if (push) _runGitIn(wt, ['push', 'origin', 'HEAD:dev', '--quiet'], 20000);
    return { ok: true, revert_sha: revertSha, slice_id: sliceId != null ? String(sliceId) : null };
  } catch (err) {
    return { ok: false, code: 'git_error', detail: String(err.message || err).slice(0, 200) };
  } finally {
    // Always reclaim the throwaway worktree.
    if (wt) {
      try { _runGit(['worktree', 'remove', '--force', wt]); }
      catch (_) { try { fs.rmSync(wt, { recursive: true, force: true }); } catch (_2) {} }
    }
  }
}

// ── Mtime-based in-memory cache ─────────────────────────────────────────────
// Eliminates per-request re-parse of large files (register.jsonl is 27MB+).
// Each cache entry stores { mtimeMs, value }. On read, stat the file; if mtime
// is unchanged, return cached value. Otherwise re-parse and update cache.
const _cache = {};

/**
 * getCachedFile(filePath, parser)
 *
 * Returns the cached parsed result if the file's mtime hasn't changed.
 * `parser` receives the raw file content (utf-8 string) and returns the parsed value.
 * Returns null if the file doesn't exist or can't be read.
 */
function getCachedFile(filePath, parser) {
  try {
    const stat = fs.statSync(filePath);
    const entry = _cache[filePath];
    if (entry && entry.mtimeMs === stat.mtimeMs) {
      return entry.value;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const value = parser(raw);
    _cache[filePath] = { mtimeMs: stat.mtimeMs, value };
    return value;
  } catch (_) {
    return null;
  }
}

/**
 * getCachedDir(dirPath, fileParser)
 *
 * Caches a directory listing + per-file parsed content using mtime checks.
 * The directory's own mtime invalidates the file list. Per-file mtimes
 * invalidate individual parsed entries. Returns { files, parsed }.
 * `fileParser(filePath, content)` returns parsed value per file (or null to skip).
 */
function getCachedDir(dirPath, fileFilter, fileParser) {
  let dirEntry = _cache['dir:' + dirPath];
  let dirMtimeMs;
  try {
    dirMtimeMs = fs.statSync(dirPath).mtimeMs;
  } catch (_) {
    return { files: [], parsed: {} };
  }

  // If dir mtime changed, re-read file list
  if (!dirEntry || dirEntry.dirMtimeMs !== dirMtimeMs) {
    let allFiles;
    try { allFiles = fs.readdirSync(dirPath).filter(fileFilter); }
    catch (_) { allFiles = []; }
    dirEntry = { dirMtimeMs, files: allFiles, perFile: dirEntry ? dirEntry.perFile : {} };
    _cache['dir:' + dirPath] = dirEntry;
  }

  // Check per-file mtimes
  const parsed = {};
  for (const file of dirEntry.files) {
    const filePath = path.join(dirPath, file);
    try {
      const fstat = fs.statSync(filePath);
      const existing = dirEntry.perFile[file];
      if (existing && existing.mtimeMs === fstat.mtimeMs) {
        parsed[file] = existing.value;
      } else {
        const raw = fs.readFileSync(filePath, 'utf8');
        const value = fileParser(filePath, raw);
        dirEntry.perFile[file] = { mtimeMs: fstat.mtimeMs, value };
        parsed[file] = value;
      }
    } catch (_) {}
  }

  // Prune stale per-file entries
  const fileSet = new Set(dirEntry.files);
  for (const k of Object.keys(dirEntry.perFile)) {
    if (!fileSet.has(k)) delete dirEntry.perFile[k];
  }

  return { files: dirEntry.files, parsed };
}

// ── Register tail reader (gate-health, slice 260) ──────────────────────────
function _readRegisterTail(regPath, count, filter) {
  try {
    const raw = fs.readFileSync(regPath, 'utf-8').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const result = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!filter || filter(obj)) result.push(obj);
      } catch (_) { /* skip malformed */ }
    }
    return result.slice(-count);
  } catch (_) { return []; }
}

// Legacy file suffix (pre-D3 backward compat — files may still exist on disk)
const LEGACY_NEEDS_SUFFIX = '-NEEDS_' + 'AMEND' + 'MENT.md';
const LEGACY_VERDICT_REQ  = 'AMEND' + 'MENT_REQUIRED';
const LEGACY_VERDICT_NEED = 'AMEND' + 'MENT_NEEDED';
const LEGACY_NOTE_FIELD   = 'amend' + 'ment_note';

const QUEUE_ORDER  = path.join(REPO_ROOT, 'bridge', 'queue-order.json');
const STAGED_ORDER = path.join(REPO_ROOT, 'bridge', 'staged-order.json');

// ── Ensure staging directories exist ─────────────────────────────────────────
for (const dir of [STAGED_DIR, TRASH_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Sprint lookup ────────────────────────────────────────────────────────────
// Sprint 1: 001–056, Sprint 2: 057–088, Sprint 3: 089+
function getSprintForId(id) {
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  if (n <= 56) return 1;
  if (n <= 88) return 2;
  return 3;
}

// ── Queue order persistence ──────────────────────────────────────────────────
function readQueueOrder() {
  try { return JSON.parse(fs.readFileSync(QUEUE_ORDER, 'utf8')); }
  catch (_) { return []; }
}
function writeQueueOrder(order) {
  fs.writeFileSync(QUEUE_ORDER, JSON.stringify(order, null, 2), 'utf8');
}

// ── Staged order persistence ────────────────────────────────────────────────
function readStagedOrder() {
  try { return JSON.parse(fs.readFileSync(STAGED_ORDER, 'utf8')); }
  catch (_) { return []; }
}
function writeStagedOrder(order) {
  fs.writeFileSync(STAGED_ORDER, JSON.stringify(order, null, 2), 'utf8');
}

// ── Frontmatter parser ───────────────────────────────────────────────────────
// Extracts key:value pairs from the YAML block between the first two `---` lines.
function parseFrontmatter(text) {
  const lines = text.split('\n');
  let inside = false;
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (!inside) { inside = true; continue; }
      else { break; }
    }
    if (!inside) continue;
    // Skip comment lines
    if (trimmed.startsWith('<!--')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let val = trimmed.slice(colon + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

// ── Body extractor ───────────────────────────────────────────────────────────
// Returns everything after the closing `---` of the YAML frontmatter block.
function extractBody(text) {
  const lines = text.split('\n');
  let dashes = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') dashes++;
    if (dashes === 2) return lines.slice(i + 1).join('\n').trim();
  }
  return '';
}

// ── Frontmatter updater ─────────────────────────────────────────────────────
// Sets or replaces key-value pairs in YAML frontmatter. Returns updated text.
function updateFrontmatter(text, updates) {
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
    const newLine = `${key}: "${val}"`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }

  return [...lines.slice(0, start + 1), ...fmLines, ...lines.slice(end)].join('\n');
}

// ── JSON body reader ─────────────────────────────────────────────────────────
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (_) { resolve(null); }
    });
    req.on('error', reject);
  });
}

// ── Rounds array parser ─────────────────────────────────────────────────
// Extracts the rounds[] YAML array from slice file frontmatter.
// Each round entry is a set of key:value pairs in a YAML list item.
function parseRoundsArray(text) {
  const lines = text.split('\n');
  let inside = false;
  let inRounds = false;
  const rounds = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (!inside) { inside = true; continue; }
      else { break; }
    }
    if (!inside) continue;
    if (/^rounds:\s*$/.test(trimmed) || /^rounds:\s*\[\s*\]\s*$/.test(trimmed)) {
      inRounds = /^rounds:\s*$/.test(trimmed);
      continue;
    }
    if (inRounds) {
      // New list item
      if (/^\s*-\s+\w/.test(line)) {
        if (current) rounds.push(current);
        current = {};
        const kv = trimmed.replace(/^-\s+/, '');
        const c = kv.indexOf(':');
        if (c !== -1) {
          const k = kv.slice(0, c).trim();
          let v = kv.slice(c + 1).trim().replace(/^["']|["']$/g, '');
          current[k] = isNaN(Number(v)) ? v : Number(v);
        }
      } else if (/^\s{2,}\w/.test(line) && current) {
        // Continuation of current list item
        const c = trimmed.indexOf(':');
        if (c !== -1) {
          const k = trimmed.slice(0, c).trim();
          let v = trimmed.slice(c + 1).trim().replace(/^["']|["']$/g, '');
          current[k] = isNaN(Number(v)) ? v : Number(v);
        }
      } else if (/^\w/.test(trimmed)) {
        // New top-level key — end of rounds
        inRounds = false;
        if (current) { rounds.push(current); current = null; }
      }
    }
  }
  if (current) rounds.push(current);
  return rounds;
}

// ── Round-section extractor ──────────────────────────────────────────────────
// Parses a multi-round slice body for per-round rom_report / nog_review sections.
function extractRoundSections(body) {
  const sections = {};
  const lines = body.split('\n');
  let key = null;
  let buf = [];
  for (const line of lines) {
    const romM = line.match(/^##\s+Round\s+(\d+)/i);
    const nogM = line.match(/^##\s+Nog\s+(?:Review|Verdict)[^#\n]*Round\s+(\d+)/i);
    if (romM) {
      if (key) sections[key] = buf.join('\n').trim();
      key = `rom_${romM[1]}`; buf = [];
    } else if (nogM) {
      if (key) sections[key] = buf.join('\n').trim();
      key = `nog_${nogM[1]}`; buf = [];
    } else if (key) {
      buf.push(line);
    }
  }
  if (key) sections[key] = buf.join('\n').trim();
  return sections;
}

// ── Slice investigation builder ──────────────────────────────────────────────
// Returns { id, prompt, report, reviews } for a given slice ID.
// Accepts optional dirs override for testability: { queueDir, stagedDir }.
// Live build log (J-watch-slice-live-log): read the per-slice rom log the orchestrator
// tees while Rom runs (bridge/logs/rom-<id>.log). Returns the last `maxLines` lines so a
// long build doesn't ship megabytes per poll, plus the byte size + mtime so the viewer
// can tell whether new output arrived. Returns null when no log exists yet.
function readRomLog(id, maxLines, dir) {
  const logsDir = dir || LOGS_DIR;
  const p = path.join(logsDir, `rom-${id}.log`);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
  const max = maxLines || 400;
  const allLines = raw.split('\n');
  // Drop a single trailing empty element from a final newline so line counts are honest.
  if (allLines.length && allLines[allLines.length - 1] === '') allLines.pop();
  const truncated = allLines.length > max;
  const lines = truncated ? allLines.slice(allLines.length - max) : allLines;
  let updated = null;
  try { updated = fs.statSync(p).mtime.toISOString(); } catch (_) {}
  return { id: String(id), lines, text: lines.join('\n'), totalLines: allLines.length, truncated, bytes: Buffer.byteLength(raw), updated };
}

function buildSliceInvestigation(id, dirs) {
  const qDir = (dirs && dirs.queueDir) || QUEUE_DIR;
  const sDir = (dirs && dirs.stagedDir) || STAGED_DIR;
  const q = f => path.join(qDir, f);
  const s = f => path.join(sDir, f);

  // Prompt: earliest available file per precedence. ARCHIVED is the terminal,
  // single-file state (slice-pipeline §4/§5): the archived .md holds the original
  // body + all appended blocks, so it is the lowest-precedence fallback — without it
  // the detail tabs render empty for a terminal ARCHIVED slice even though the file
  // is on disk (getTitleAndGoal and /api/queue/:id/content already read it).
  const promptFiles = [
    q(`${id}-IN_PROGRESS.md`), q(`${id}-QUEUED.md`), s(`${id}-STAGED.md`),
    q(`${id}-PARKED.md`), q(`${id}-STUCK.md`),
    q(`${id}-DONE.md`), q(`${id}-ERROR.md`), q(`${id}-ACCEPTED.md`), q(`${id}-ARCHIVED.md`),
  ];
  let prompt = null;
  for (const p of promptFiles) {
    if (fs.existsSync(p)) { prompt = extractBody(fs.readFileSync(p, 'utf8')); break; }
  }

  // Report: body of terminal file (ARCHIVED carries the appended Rom DONE + Nog review).
  const termFiles = [
    q(`${id}-DONE.md`), q(`${id}-STUCK.md`), q(`${id}-ERROR.md`), q(`${id}-ACCEPTED.md`), q(`${id}-ARCHIVED.md`),
  ];
  let report = null;
  for (const p of termFiles) {
    if (fs.existsSync(p)) { report = extractBody(fs.readFileSync(p, 'utf8')); break; }
  }

  // Reviews: PARKED or STUCK (multi-round) → rounds[] → per-round entries
  let reviews = [];
  const parkedPath = q(`${id}-PARKED.md`);
  const stuckPath  = q(`${id}-STUCK.md`);
  const nogPath    = q(`${id}-NOG.md`);
  const multiPath  = fs.existsSync(parkedPath) ? parkedPath : fs.existsSync(stuckPath) ? stuckPath : null;

  if (multiPath) {
    const raw = fs.readFileSync(multiPath, 'utf8');
    const rounds = parseRoundsArray(raw);
    if (rounds.length > 0) {
      const secs = extractRoundSections(extractBody(raw));
      reviews = rounds.map(r => {
        const rn = typeof r.round === 'number' ? r.round : Number(r.round) || 1;
        return {
          round:      rn,
          verdict:    r.nog_verdict  ?? null,
          summary:    r.nog_reason   ?? null,
          rom_report: secs[`rom_${rn}`] || null,
          nog_review: secs[`nog_${rn}`] || r.nog_reason || null,
          done_at:    r.done_at      ?? null,
          durationMs: r.durationMs   ?? null,
          costUsd:    r.costUsd      ?? null,
        };
      });
    }
  } else if (fs.existsSync(nogPath)) {
    const nogRaw = fs.readFileSync(nogPath, 'utf8');
    const fm = parseFrontmatter(nogRaw);
    reviews = [{ round: 1, verdict: fm.verdict ?? null, summary: fm.summary ?? null,
                 rom_report: null, nog_review: extractBody(nogRaw) || null,
                 done_at: fm.completed ?? null, durationMs: null, costUsd: null }];
  }

  // 404 if nothing found
  const allDirs = [qDir, sDir];
  const found = allDirs.some(d => {
    try { return fs.readdirSync(d).some(f => f.startsWith(`${id}-`)); } catch (_) { return false; }
  });
  if (!found) {
    const e = new Error(`No slice found for ID ${id}`); e.status = 404; throw e;
  }

  return { id, prompt, report, reviews };
}

// ── Register reader ──────────────────────────────────────────────────────────
// All register reads route through the lifecycle translation shim so legacy
// event names (NOG_PASS, REVIEW_RECEIVED, ACCEPTED-as-event, etc.) are
// presented as canonical names to every consumer.
function readRegister() {
  const parsed = getCachedFile(REGISTER, raw => {
    return raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  });
  if (!parsed) return [];
  resetDedupeState();
  return parsed.map(ev => translateEvent(ev)).filter(Boolean);
}

// ── Register writer ──────────────────────────────────────────────────────────
function writeRegisterEvent(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(REGISTER, line, 'utf8');
}

// ── Title/goal fallback ─────────────────────────────────────────────────────
// First try the COMMISSIONED register event, then fall back to {id}-PARKED.md (or legacy ARCHIVED).
function getTitleAndGoal(id, commissioned) {
  if (commissioned[id]?.title) {
    return { title: commissioned[id].title, goal: commissioned[id].goal ?? null };
  }
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  try {
    const resolvedPath = fs.existsSync(parkedPath) ? parkedPath : legacyPath;
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const fm = parseFrontmatter(content);
    return { title: fm.title ?? null, goal: fm.goal ?? null };
  } catch (_) {
    return { title: null, goal: null };
  }
}

// ── Result-level caches (mtime-keyed) ───────────────────────────────────────
// Caches the full return value of buildBridgeData / buildCostsData so that
// downstream processing (translateEvent over 29K+ events, O(N) loops) is
// skipped entirely on cache hit.  Invalidated when source file mtimes change.
let _bridgeDataCache = { regMtime: null, hbMtime: null, value: null };
let _costsDataCache  = { regMtime: null, queueMtime: null, sessMtime: null, value: null };

function _getMtimeMs(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch (_) { return null; }
}

function getCachedBridgeData() {
  const regMtime = _getMtimeMs(REGISTER);
  const hbMtime  = _getMtimeMs(HEARTBEAT);
  // buildBridgeData also reads the queue + staged dirs, so the cache must invalidate
  // when those change directly (a file moved/removed without a register/heartbeat write —
  // e.g. an external edit). Without these keys the bridge view can serve stale queue state.
  const qMtime = _getMtimeMs(QUEUE_DIR);
  const sMtime = _getMtimeMs(STAGED_DIR);
  // buildBridgeData also reads the two ORDER files, and a drag-reorder rewrites one of
  // them without touching any other keyed path. Without these keys the operator drags a
  // row, the POST persists, and the very next /api/bridge — a poll or a page reload —
  // replays the pre-drag order from cache. In production constant heartbeat churn hides
  // this; with a quiet orchestrator the reorder visibly springs back.
  const qoMtime = _getMtimeMs(QUEUE_ORDER);
  const soMtime = _getMtimeMs(STAGED_ORDER);
  if (_bridgeDataCache.value !== null &&
      _bridgeDataCache.regMtime === regMtime &&
      _bridgeDataCache.hbMtime === hbMtime &&
      _bridgeDataCache.qMtime === qMtime &&
      _bridgeDataCache.sMtime === sMtime &&
      _bridgeDataCache.qoMtime === qoMtime &&
      _bridgeDataCache.soMtime === soMtime) {
    return _bridgeDataCache.value;
  }
  const value = buildBridgeData();
  _bridgeDataCache = { regMtime, hbMtime, qMtime, sMtime, qoMtime, soMtime, value };
  return value;
}

function getCachedCostsData() {
  const regMtime   = _getMtimeMs(REGISTER);
  const queueMtime = _getMtimeMs(QUEUE_DIR);
  const sessMtime  = _getMtimeMs(SESSIONS);
  if (_costsDataCache.value !== null &&
      _costsDataCache.regMtime === regMtime &&
      _costsDataCache.queueMtime === queueMtime &&
      _costsDataCache.sessMtime === sessMtime) {
    return _costsDataCache.value;
  }
  const value = buildCostsData();
  _costsDataCache = { regMtime, queueMtime, sessMtime, value };
  return value;
}

// ── History outcome derivation (exported for testing) ────────────────────────
/**
 * deriveHistoryOutcome(id, rawOutcome, { squashedToDevIds, deferredIds, acceptedSet })
 *
 * Pure function: given an entry's id + raw DONE/ERROR outcome and the three
 * event-derived ID sets, returns the display outcome string.
 */
function deriveHistoryOutcome(id, rawOutcome, { squashedToDevIds, deferredIds, acceptedSet }) {
  if (squashedToDevIds.has(id))       return 'ON_DEV';
  if (deferredIds.has(id))            return 'DEFERRED';
  if (rawOutcome === 'ERROR' && acceptedSet.has(id)) return 'ON_DEV';
  // Historical pre-gate slices with a MERGED event but no SLICE_SQUASHED_TO_DEV
  // fall through with rawOutcome === 'MERGED'. Map to ON_DEV for pill display.
  if (rawOutcome === 'MERGED')        return 'ON_DEV';
  return rawOutcome;
}

// Pure: a slice's review status, which drives the History outcome pill. The green
// "success" pill (reviewStatus === 'accepted') REQUIRES Nog to have ACCEPTED the work
// (NOG_DECISION verdict) or the slice to have actually MERGED to main. It must NOT be
// driven by the operator's staged-backlog START approval (HUMAN_APPROVAL) — that is
// "approved to begin", not "review passed". Conflating the two is the recurring bug where
// a slice flips to a green success pill the instant Rom finishes, before Nog reviews.
function deriveReviewStatus({ verdict, mergedToMain }) {
  if (verdict === 'ACCEPTED') return 'accepted';
  if (verdict === 'APENDMENT_REQUIRED' || verdict === LEGACY_VERDICT_REQ) return 'apendment_required';
  if (mergedToMain) return 'accepted';
  return 'waiting_for_review';
}

// ── Bridge data builder ──────────────────────────────────────────────────────
function buildBridgeData() {
  // Heartbeat
  let heartbeat = { ts: null, status: 'down', current_slice: null,
                    slice_elapsed_seconds: null, processed_total: 0 };
  const hbRaw = getCachedFile(HEARTBEAT, raw => JSON.parse(raw));
  if (hbRaw) {
    const age = hbRaw.ts ? (Date.now() - new Date(hbRaw.ts).getTime()) / 1000 : Infinity;
    heartbeat = {
      ts:                        hbRaw.ts   ?? null,
      status:                    age < 60 ? (hbRaw.status ?? 'idle') : 'down',
      current_slice:             hbRaw.current_slice ?? null,
      slice_elapsed_seconds:     hbRaw.slice_elapsed_seconds ?? null,
      processed_total:           hbRaw.processed_total ?? 0,
    };
  }

  // First-output signal (invocation gap indicator)
  try {
    const fo = JSON.parse(fs.readFileSync(FIRST_OUTPUT, 'utf8'));
    heartbeat.firstOutputAt = fo.firstOutputAt ?? null;
  } catch (_) {
    heartbeat.firstOutputAt = null;
  }

  // Register events
  const events = readRegister();

  // Index COMMISSIONED events by id for goal lookup and recent title
  const commissioned = {};
  for (const ev of events) {
    if (ev.event === 'COMMISSIONED') commissioned[ev.id] = ev;
  }

  // Build recent (last 10 completed) and economics from DONE/ERROR events
  const completedMap = {};
  const reviewedMap  = {};
  const acceptedSet  = new Set();
  const economics = { totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, totalSlices: 0 };
  for (const ev of events) {
    if (ev.event === 'DONE' || ev.event === 'ERROR') {
      const { title: resolvedTitle, goal: resolvedGoal } = getTitleAndGoal(ev.id, commissioned);
      completedMap[ev.id] = {
        id:          ev.id,
        title:       resolvedTitle,
        goal:        resolvedGoal,
        outcome:     ev.event,
        durationMs:  ev.durationMs  ?? null,
        tokensIn:    ev.tokensIn    ?? null,
        tokensOut:   ev.tokensOut   ?? null,
        costUsd:     ev.costUsd     ?? null,
        completedAt: ev.ts          ?? null,
        reason:      ev.reason     ?? null,
      };
      if (ev.event === 'DONE') {
        economics.totalTokensIn  += ev.tokensIn  ?? 0;
        economics.totalTokensOut += ev.tokensOut ?? 0;
        economics.totalCostUsd   += ev.costUsd   ?? 0;
        economics.totalSlices++;
      }
    }
    // NOG_DECISION carries the verdict (translated from legacy REVIEWED/NOG_PASS)
    if (ev.event === 'NOG_DECISION') {
      reviewedMap[ev.id] = ev.verdict;
    }
    // Only an actual MERGE to main counts as "landed/accepted" here. HUMAN_APPROVAL is the
    // staged-backlog START approval (approve a slice to BEGIN), NOT Nog accepting finished
    // work — feeding it to acceptedSet flipped a slice to the green "success" pill the
    // instant Rom finished, before Nog reviewed. Nog's acceptance rides the NOG_DECISION
    // verdict instead (see deriveReviewStatus).
    if (ev.event === 'MERGED' || ev.event === 'SLICE_MERGED_TO_MAIN') {
      acceptedSet.add(ev.id);
    }
  }
  // API_RETRY events — last 20, newest first, for toast notification
  const apiRetries = events
    .filter(ev => ev.event === 'API_RETRY')
    .slice(-20)
    .reverse();

  // Build squashedToDevIds: slices squashed to dev
  const squashedToDevIds = new Set();
  // Build deferredIds: slices deferred because gate was running
  const deferredIds = new Set();
  // Build mergedIds for terminal-ID set only (not used in pill derivation)
  const mergedIds = new Set();
  // onMainIds: slices that actually reached main (gate-promoted), distinct from the
  // legacy MERGED-to-dev event. Drives the Logbook lifecycle chain's "on main" stage.
  const onMainIds = new Set();
  // squashShaById: slice id → the squashed dev commit sha (from the orchestrator's
  // SLICE_SQUASHED_TO_DEV event). This is the authoritative slice→commit map the
  // rollback feature reverts against — recent dev commits are prose, not slice/N
  // subjects, so commit-subject parsing is not reliable. (ADR-ROLLBACK-MODEL.)
  const squashShaById = {};
  for (const ev of events) {
    if (ev.event === 'MERGED' || ev.event === 'SLICE_MERGED_TO_MAIN') mergedIds.add(String(ev.id));
    if (ev.event === 'SLICE_MERGED_TO_MAIN') onMainIds.add(String(ev.id));
    if (ev.event === 'SLICE_SQUASHED_TO_DEV') {
      squashedToDevIds.add(String(ev.id));
      const sha = ev.squash_sha || ev.dev_tip_sha || null;
      if (sha) squashShaById[String(ev.id)] = sha;
    }
    if (ev.event === 'SLICE_DEFERRED') deferredIds.add(String(ev.id));
  }
  // Slices that were deferred but later squashed are not deferred any more
  for (const id of squashedToDevIds) deferredIds.delete(id);

  const recent = Object.values(completedMap)
    .sort((a, b) => {
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return new Date(b.completedAt) - new Date(a.completedAt);
    })
    .slice(0, 200)
    .map(entry => {
      const verdict = reviewedMap[entry.id];
      const finalOutcome = deriveHistoryOutcome(entry.id, entry.outcome,
        { squashedToDevIds, deferredIds, acceptedSet });
      const reviewStatus = deriveReviewStatus({ verdict, mergedToMain: acceptedSet.has(entry.id) });
      const onMain = onMainIds.has(String(entry.id));
      return { ...entry, outcome: finalOutcome, reviewStatus, sprint: getSprintForId(entry.id),
               onMain, regressionPassed: onMain,
               squash_sha: squashShaById[String(entry.id)] || null };
    });

  // Queue files (cached dir scan — avoids re-stat + re-parse of 348 files)
  const queueCache = getCachedDir(
    QUEUE_DIR,
    f => f.endsWith('.md'),
    (_fp, raw) => parseFrontmatter(raw),
  );
  const files = queueCache.files;

  // Build terminal ID set: filesystem ACCEPTED/ARCHIVED/SLICE markers + MERGED events
  const terminalIds = new Set(mergedIds);
  for (const f of files) {
    const tm = f.match(/^(.+?)-(ACCEPTED|ARCHIVED|ERROR|STUCK|SLICE)\.md$/);
    if (tm) terminalIds.add(String(tm[1]));
  }

  const queue = { waiting: 0, active: 0, done: 0, error: 0 };
  const slices = [];

  for (const filename of files) {
    // Derive state from filename suffix: {id}-{STATE}.md
    const match = filename.match(/^(.+?)-(PENDING|QUEUED|IN_PROGRESS|DONE|ERROR)\.md$/);
    if (!match) continue;
    const [, rawId, state] = match;

    // Skip terminal slices (merged to main or marked ACCEPTED/ARCHIVED/SLICE)
    if (terminalIds.has(rawId)) continue;

    // Hide stale DONE entries from the Queue panel.
    // Prefer frontmatter `completed` (immune to mtime refresh by recovery ops);
    // fall back to mtime when `completed` is missing or unparseable.
    if (state === 'DONE') {
      const staleCutoff = STALE_DONE_DAYS * 86400 * 1000;
      const fm0 = queueCache.parsed[filename] || {};
      const completedMs = fm0.completed ? new Date(fm0.completed).getTime() : NaN;
      if (!isNaN(completedMs)) {
        if (Date.now() - completedMs > staleCutoff) continue;
      } else {
        try {
          const mtimeMs = fs.statSync(path.join(QUEUE_DIR, filename)).mtimeMs;
          if (Date.now() - mtimeMs > staleCutoff) continue;
        } catch (_) {}
      }
    }

    switch (state) {
      case 'PENDING':     queue.waiting++; break;
      case 'QUEUED':      queue.waiting++; break;
      case 'IN_PROGRESS': queue.active++;  break;
      case 'DONE':        queue.done++;    break;
      case 'ERROR':       queue.error++;   break;
    }

    const fm = queueCache.parsed[filename] || {};

    const id = fm.id ?? rawId;
    const goalFromRegister = commissioned[id]?.goal ?? null;
    const goalFromFm       = fm.goal ?? null;

    // For ERROR/DONE state, the file's own title is a watcher-generated fallback
    // ("Slice N — crash"). Prefer the real title from the COMMISSIONED event or
    // the SLICE archive so the error display shows something meaningful.
    const { title: betterTitle, goal: betterGoal } = (state === 'ERROR' || state === 'DONE')
      ? getTitleAndGoal(id, commissioned)
      : { title: null, goal: null };

    slices.push({
      id,
      title:     betterTitle ?? fm.title ?? filename,
      state,
      from:      fm.from      ?? null,
      created:   fm.created   ?? null,
      completed: fm.completed ?? null,
      goal:           betterGoal ?? goalFromRegister ?? goalFromFm,
      references:     fm.references ?? null,
      sprint:         fm.sprint ? parseInt(fm.sprint, 10) : getSprintForId(id),
      apiRetryCount:  fm._api_retry_count ? parseInt(fm._api_retry_count, 10) : 0,
    });
  }

  // Sort by numeric ID descending
  slices.sort((a, b) => {
    const na = parseInt(a.id, 10);
    const nb = parseInt(b.id, 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return b.id.localeCompare(a.id);
  });

  const queueOrder = readQueueOrder();
  const stagedOrder = readStagedOrder();

  // Nog active state (slice 105)
  let nogActive = null;
  try {
    const raw = JSON.parse(fs.readFileSync(NOG_ACTIVE, 'utf8'));
    if (raw && raw.sliceId) nogActive = raw;
  } catch (_) {}

  return { heartbeat, queue, slices, recent, economics, queueOrder, stagedOrder, nogActive, apiRetries, events };
}

// ── Cost Center aggregation ──────────────────────────────────────────────────
// Economics (Quark's Ledger): every crew role gets a tracker, with a per-purpose
// token breakdown. Only `input` (tokens_in) and `output` (tokens_out) are captured
// today; `context` (cache-reuse) and `thinking` (extended-thinking) tokens are NOT
// recorded by the orchestrator yet, so they surface as null until the capture
// pipeline is instrumented. See the Economics footnote in the dashboard.
function buildCostsData() {
  // Seed one zeroed row per crew role so the ledger shows everyone, with or without spend.
  const ROLE_ORDER = ['sisko', 'ziyal', 'obrien', 'rom', 'nog', 'bashir', 'dax', 'worf', 'leeta'];
  const rows = {};
  for (const r of ROLE_ORDER) {
    rows[r] = { role: r, model: null, count: 0,
                input: 0, output: 0, context: null, thinking: null,
                cost_usd: 0, _has_data: false };
  }
  function rowFor(role) {
    if (!rows[role]) {
      rows[role] = { role, model: null, count: 0, input: 0, output: 0,
                     context: null, thinking: null, cost_usd: 0, _has_data: false };
    }
    return rows[role];
  }

  // Rom — sum DONE events from register.jsonl (cached parse)
  const romRow = rowFor('rom'); romRow.model = 'claude-sonnet-4-6';
  const regParsed = getCachedFile(REGISTER, raw => {
    return raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  });
  if (regParsed) {
    for (const ev of regParsed) {
      if (ev.event !== 'DONE') continue;
      romRow.count++;
      romRow.input  += ev.tokensIn  ?? 0;
      romRow.output += ev.tokensOut ?? 0;
      romRow.cost_usd += ev.costUsd ?? 0;
      romRow._has_data = true;
    }
  }

  // Nog — sum rounds[] across all DONE.md files in queue/
  const nogRow = rowFor('nog'); nogRow.model = 'claude-sonnet-4-6';
  try {
    const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-DONE.md'));
    for (const file of files) {
      let text;
      try { text = fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'); }
      catch (_) { continue; }
      const rounds = parseRoundsArray(text);
      for (const r of rounds) {
        nogRow.count++;
        nogRow.input  += r.tokensIn  ?? 0;
        nogRow.output += r.tokensOut ?? 0;
        nogRow.cost_usd += r.costUsd ?? 0;
        nogRow._has_data = true;
      }
    }
  } catch (_) {}

  // Sessions — group by role from sessions.jsonl (the interactive roles)
  let updatedAt = new Date().toISOString();
  try {
    const raw = fs.readFileSync(SESSIONS, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      const row = rowFor(entry.role ?? 'unknown');
      if (entry.model && !row.model) row.model = entry.model;
      row.count++;
      if (entry.tokens_in  != null) { row.input  += entry.tokens_in;  row._has_data = true; }
      if (entry.tokens_out != null) { row.output += entry.tokens_out; row._has_data = true; }
      if (entry.cost_usd   != null) { row.cost_usd += entry.cost_usd;  row._has_data = true; }
      if (entry.ts && entry.ts > updatedAt) updatedAt = entry.ts;
    }
  } catch (_) {}

  // Finalise: roles with no captured spend show null tokens/cost (an em-dash in the UI),
  // not a misleading zero. `tokens_in`/`tokens_out` kept as aliases for back-compat.
  const by_role = Object.values(rows).map(row => {
    const has = row._has_data;
    const input  = has ? row.input  : null;
    const output = has ? row.output : null;
    return {
      role: row.role, model: row.model, count: row.count,
      input, output, context: null, thinking: null,
      total: has ? (row.input + row.output) : null,
      tokens_in: input, tokens_out: output,
      cost_usd: has ? row.cost_usd : null,
    };
  });

  const total_cost_usd = by_role.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  return { by_role, total_cost_usd, updated_at: updatedAt };
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(DASHBOARD, (err, data) => {
      if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/tokens.css') {
    fs.readFile(TOKENS_CSS, (err, data) => {
      if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Test Drift Gate — standalone operator review page (reads GET /api/test-drift).
  if (pathname === '/test-drift' || pathname === '/test-drift.html') {
    fs.readFile(TEST_DRIFT_PAGE, (err, data) => {
      if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // The two-stage merge gate: ① Check for test updates → ② Run gate & merge.
  if (pathname === '/merge-gate' || pathname === '/merge-gate.html') {
    fs.readFile(MERGE_GATE_PAGE, (err, data) => {
      if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/api/bridge/review') {
    const corsHeaders = {
      'Access-Control-Allow-Origin':  CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Method Not Allowed');
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { id, verdict, reason } = payload;
      const VALID_VERDICTS = ['ACCEPTED', 'APENDMENT_NEEDED', LEGACY_VERDICT_NEED, 'STUCK'];
      if (!id || !verdict) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Missing required fields: id, verdict' }));
        return;
      }
      if (!VALID_VERDICTS.includes(verdict)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: `Invalid verdict. Must be one of: ${VALID_VERDICTS.join(', ')}` }));
        return;
      }

      // UI-refresh nudge only — the watcher writes REVIEW_RECEIVED to
      // register.jsonl synchronously. This endpoint no longer touches the
      // register; it exists so legacy callers get a 200 instead of a 404.
      console.log(`[review-nudge] POST /api/bridge/review id=${id} verdict=${verdict} (no register write)`);

      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ ok: true, nudge: true }));
    });
    return;
  }

  // ── Staged slice endpoints ──────────────────────────────────────────────
  if (pathname === '/api/bridge/staged' && req.method === 'GET') {
    let files = [];
    try { files = fs.readdirSync(STAGED_DIR).filter(f => f.endsWith('-STAGED.md') || f.endsWith('-NEEDS_APENDMENT.md') || f.endsWith(LEGACY_NEEDS_SUFFIX)); }
    catch (_) {}

    const items = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(STAGED_DIR, file), 'utf8');
        const fm = parseFrontmatter(content);
        const body = extractBody(content);
        const status = (file.endsWith('-NEEDS_APENDMENT.md') || file.endsWith(LEGACY_NEEDS_SUFFIX)) ? 'NEEDS_APENDMENT' : (fm.status || 'STAGED');
        const itemId = fm.id ?? file.replace(/-(STAGED|NEEDS_APENDMENT|NEEDS_AMEND\w+)\.md$/, '');
        items.push({
          id:              itemId,
          title:           fm.title ?? null,
          summary:         fm.summary ?? null,
          goal:            fm.goal ?? null,
          status,
          apendment_note:  fm.apendment_note ?? fm[LEGACY_NOTE_FIELD] ?? null,
          references:      fm.references ?? null,
          sprint:          fm.sprint ? parseInt(fm.sprint, 10) : getSprintForId(itemId),
          body,
        });
      } catch (_) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));
    return;
  }

  const stagedMatch = pathname.match(/^\/api\/bridge\/staged\/(\d+)\/(approve|slice|amend|reject|update-body)$/);
  if (stagedMatch) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const id     = stagedMatch[1];
    const action = stagedMatch[2];

    // Find the staged file (could be STAGED or NEEDS_APENDMENT or legacy suffix)
    const stagedPath     = path.join(STAGED_DIR, `${id}-STAGED.md`);
    const apendmentPath  = path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`);
    const legacyAmdPath  = path.join(STAGED_DIR, `${id}${LEGACY_NEEDS_SUFFIX}`);
    const filePath = fs.existsSync(stagedPath) ? stagedPath
                   : fs.existsSync(apendmentPath) ? apendmentPath
                   : fs.existsSync(legacyAmdPath) ? legacyAmdPath
                   : null;

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Staged slice ${id} not found` }));
      return;
    }

    if (action === 'approve' || action === 'slice') {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'QUEUED' });
        fs.writeFileSync(path.join(QUEUE_DIR, `${id}-QUEUED.md`), content, 'utf8');
        try { fs.renameSync(filePath, path.join(TRASH_DIR, path.basename(filePath) + '.approved')); } catch (_) {}
        // Add to queue order (apendments go to front, others to end)
        const order = readQueueOrder();
        const fm2 = parseFrontmatter(content);
        if (fm2.references && fm2.references !== 'null') {
          // Apendment: insert at front
          order.unshift(id);
        } else if (!order.includes(id)) {
          order.push(id);
        }
        writeQueueOrder(order);
        writeRegisterEvent({ event: 'HUMAN_APPROVAL', slice_id: id, action: 'approved' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (action === 'amend') {
      const payload = await readJsonBody(req);
      if (!payload || !payload.note) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: note' }));
        return;
      }
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'NEEDS_APENDMENT', apendment_note: payload.note });
        // Rename to NEEDS_APENDMENT if currently STAGED
        const destPath = path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`);
        fs.writeFileSync(destPath, content, 'utf8');
        if (filePath !== destPath) { try { fs.renameSync(filePath, path.join(TRASH_DIR, path.basename(filePath) + '.amended')); } catch (_) {} }
        writeRegisterEvent({ event: 'HUMAN_APPROVAL', slice_id: id, action: 'refined' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (action === 'update-body') {
      const payload = await readJsonBody(req);
      if (!payload || typeof payload.body !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: body' }));
        return;
      }
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n');
        let dashes = 0, fmEnd = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === '---') dashes++;
          if (dashes === 2) { fmEnd = i; break; }
        }
        if (fmEnd === -1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Could not parse frontmatter' }));
          return;
        }
        const updated = lines.slice(0, fmEnd + 1).join('\n') + '\n\n' + payload.body;
        fs.writeFileSync(filePath, updated, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (action === 'reject') {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'REJECTED' });
        try { fs.renameSync(filePath, path.join(TRASH_DIR, `${id}-REJECTED.md`)); } catch (_) { fs.writeFileSync(path.join(TRASH_DIR, `${id}-REJECTED.md`), content, 'utf8'); }
        writeRegisterEvent({ event: 'HUMAN_APPROVAL', slice_id: id, action: 'rejected' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }
  }

  // ── Un-approve: move queued slice back to staged ────────────────────────
  const unapproveMatch = pathname.match(/^\/api\/slice\/(\d+)\/unapprove$/);
  if (unapproveMatch && req.method === 'POST') {
    const id = unapproveMatch[1];

    // Check if the slice is the currently-dispatched slice (race protection)
    let hbCurrent = null;
    try {
      const hb = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
      hbCurrent = hb.current_slice ? String(hb.current_slice) : null;
    } catch (_) {}
    if (hbCurrent === id) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'already-picked-up' }));
      return;
    }

    // Find the QUEUED file
    const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
    if (!fs.existsSync(queuedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Queued slice ${id} not found` }));
      return;
    }

    try {
      // Read current queue position before removal
      const qOrder = readQueueOrder();
      const prevPosition = qOrder.indexOf(id);

      // Move file: QUEUED → STAGED in staged dir
      let content = fs.readFileSync(queuedPath, 'utf8');
      content = updateFrontmatter(content, { status: 'STAGED' });
      fs.writeFileSync(path.join(STAGED_DIR, `${id}-STAGED.md`), content, 'utf8');
      try { fs.unlinkSync(queuedPath); } catch (_) {}

      // Update queue-order.json: remove from queue
      const newQueueOrder = qOrder.filter(oid => oid !== id);
      writeQueueOrder(newQueueOrder);

      // Update staged-order.json: append to end
      const sOrder = readStagedOrder();
      if (!sOrder.includes(id)) sOrder.push(id);
      writeStagedOrder(sOrder);

      // Emit register event
      writeRegisterEvent({ event: 'slice-unapproved', slice_id: id, prev_position: prevPosition });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Archive (remove from queue): move queued slice to trash ─────────────
  const archiveMatch = pathname.match(/^\/api\/queue\/(\d+)\/remove$/);
  if (archiveMatch && req.method === 'POST') {
    const id = archiveMatch[1];

    // Race protection: if currently dispatched, reject
    let hbCurrent = null;
    try {
      const hb = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
      hbCurrent = hb.current_slice ? String(hb.current_slice) : null;
    } catch (_) {}
    if (hbCurrent === id) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'already-picked-up' }));
      return;
    }

    // Validate QUEUED file exists
    const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
    if (!fs.existsSync(queuedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Queued slice ${id} not found` }));
      return;
    }

    try {
      // Remove from queue-order.json
      const qOrder = readQueueOrder();
      const newQueueOrder = qOrder.filter(oid => oid !== id);
      writeQueueOrder(newQueueOrder);

      // Move QUEUED file to trash with timestamp
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const trashName = `${id}-QUEUED.md.removed-${ts}`;
      try { fs.renameSync(queuedPath, path.join(TRASH_DIR, trashName)); }
      catch (_) {
        const content = fs.readFileSync(queuedPath, 'utf8');
        fs.writeFileSync(path.join(TRASH_DIR, trashName), content, 'utf8');
        fs.unlinkSync(queuedPath);
      }

      // Register event
      writeRegisterEvent({ event: 'slice-archived-from-queue', slice_id: id, ts: new Date().toISOString(), reason: 'user-removed' });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, action: 'archived' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Error detail endpoints (slice 094/104) ──────────────────────────────
  const ERRORS_DIR = path.join(REPO_ROOT, 'bridge', 'errors');

  const errorDetailMatch = pathname.match(/^\/api\/bridge\/errors\/(\d+)$/);

  if (errorDetailMatch && req.method === 'GET') {
    const id = errorDetailMatch[1];
    const filePath = path.join(ERRORS_DIR, `${id}-ERROR.json`);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(raw);
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
    return;
  }

  if (pathname === '/api/bridge/errors' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(ERRORS_DIR).filter(f => f.endsWith('-ERROR.json'));
      const items = [];
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(ERRORS_DIR, file), 'utf8'));
          items.push(raw);
        } catch (_) {}
      }
      items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(items.slice(0, 20)));
    } catch (_) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  if (pathname === '/api/health') {
    const now = Date.now();
    let watcher = { status: 'down', heartbeatAge_s: null, currentSlice: null,
                    elapsedSeconds: null, lastActivityAge_s: null, processedTotal: 0 };
    const hbHealth = getCachedFile(HEARTBEAT, raw => JSON.parse(raw));
    if (hbHealth) {
      const age = hbHealth.ts ? (now - new Date(hbHealth.ts).getTime()) / 1000 : Infinity;
      const status = age < 30 ? 'up' : age < 60 ? 'stale' : 'down';
      const lastActivityAge = hbHealth.last_activity_ts
        ? (now - new Date(hbHealth.last_activity_ts).getTime()) / 1000 : null;
      watcher = {
        status,
        heartbeatAge_s:    Math.round(age),
        currentSlice:      hbHealth.current_slice ?? null,
        elapsedSeconds:    hbHealth.slice_elapsed_seconds ?? null,
        lastActivityAge_s: lastActivityAge != null ? Math.round(lastActivityAge) : null,
        processedTotal:    hbHealth.processed_total ?? 0,
      };
    }
    const wormholePath = path.join(REPO_ROOT, 'bridge', 'wormhole-heartbeat.json');
    let wormhole = { lastWriteTs: null, lastWriteTool: null, lastWritePath: null, ageSeconds: null };
    try {
      const raw = JSON.parse(fs.readFileSync(wormholePath, 'utf8'));
      const age = raw.ts ? (now - new Date(raw.ts).getTime()) / 1000 : Infinity;
      wormhole = { lastWriteTs: raw.ts ?? null, lastWriteTool: raw.tool ?? null,
                   lastWritePath: raw.path ?? null, ageSeconds: raw.ts ? Math.round(age) : null };
    } catch (_) {}
    // Read host-side health detector status (written by host-health-detector.sh)
    let hostHealth = null;
    try {
      hostHealth = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'bridge', 'host-health.json'), 'utf8'));
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString(), watcher, wormhole, hostHealth }));
    return;
  }

  // ── Gate Health endpoint (slice 260) ──────────────────────────────────────
  if (pathname === '/api/gate-health' && req.method === 'GET') {
    const { evaluateAlerts, computeHealthColor } = require(path.join(REPO_ROOT, 'bridge', 'state', 'gate-alerts'));
    const STATE_DIR = path.join(REPO_ROOT, 'bridge', 'state');
    const mutexPath = path.join(STATE_DIR, 'gate-running.json');
    const bashirHbPath = path.join(STATE_DIR, 'bashir-heartbeat.json');

    // Read mutex state
    let mutexState = null;
    try { mutexState = JSON.parse(fs.readFileSync(mutexPath, 'utf8')); } catch (_) {}

    // Read heartbeat
    let heartbeatAge = null;
    let heartbeatExists = false;
    try {
      const hb = JSON.parse(fs.readFileSync(bashirHbPath, 'utf8'));
      heartbeatExists = true;
      if (hb.ts) heartbeatAge = Date.now() - new Date(hb.ts).getTime();
    } catch (err) {
      if (err.code !== 'ENOENT') heartbeatExists = true; // exists but unreadable
    }

    // Last lock-cycle duration from register
    let lastLockCycleDuration = null;
    const regTail = _readRegisterTail(REGISTER, 50, e => e.event && (e.event.startsWith('gate-') || e.event === 'lock-cycle'));
    const lockEvents = regTail.filter(e => e.event === 'lock-cycle');
    if (lockEvents.length > 0) {
      lastLockCycleDuration = lockEvents[lockEvents.length - 1].held_duration_ms || null;
    }

    const alerts = evaluateAlerts({ mutexState, heartbeatAge, heartbeatExists, recentEvents: regTail });
    const color = computeHealthColor(alerts);
    const last5 = regTail.slice(-5);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      color,
      mutex: mutexState ? { present: true, started_ts: mutexState.started_ts, dev_tip_sha: mutexState.dev_tip_sha } : { present: false },
      heartbeat: { exists: heartbeatExists, age_ms: heartbeatAge },
      last_lock_cycle_duration_ms: lastLockCycleDuration,
      alerts,
      recent_events: last5,
    }));
    return;
  }

  // ── Queue slice content (for slice detail overlay) ─────────────────────────
  const queueContentMatch = pathname.match(/^\/api\/queue\/(\d+)\/content$/);
  if (queueContentMatch && req.method === 'GET') {
    const id = queueContentMatch[1];
    // PARKED.md is the original prompt given to O'Brien — show it first.
    // Fall back to legacy ARCHIVED, then PENDING (same content, still in queue) then STAGED, then DONE report.
    const candidates = [
      path.join(QUEUE_DIR, `${id}-PARKED.md`),
      path.join(QUEUE_DIR, `${id}-ARCHIVED.md`),
      path.join(QUEUE_DIR, `${id}-QUEUED.md`),
      path.join(QUEUE_DIR, `${id}-PENDING.md`),
      path.join(STAGED_DIR, `${id}-STAGED.md`),
      path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`),
      path.join(STAGED_DIR, `${id}${LEGACY_NEEDS_SUFFIX}`),
      path.join(QUEUE_DIR, `${id}-ACCEPTED.md`),
      path.join(QUEUE_DIR, `${id}-IN_REVIEW.md`),
      path.join(QUEUE_DIR, `${id}-REVIEWED.md`),
      path.join(QUEUE_DIR, `${id}-DONE.md`),
    ];
    let found = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) { found = p; break; }
    }
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No content found for slice ${id}` }));
      return;
    }
    try {
      const raw = fs.readFileSync(found, 'utf8');
      const frontmatter = parseFrontmatter(raw);
      const body = extractBody(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, frontmatter, body, raw }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (queueContentMatch && req.method === 'PATCH') {
    const id = queueContentMatch[1];
    const payload = await readJsonBody(req);
    if (!payload || typeof payload.body !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required field: body' }));
      return;
    }

    const candidates = [
      path.join(QUEUE_DIR, `${id}-QUEUED.md`),
      path.join(QUEUE_DIR, `${id}-PENDING.md`),
      path.join(STAGED_DIR, `${id}-STAGED.md`),
      path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`),
      path.join(STAGED_DIR, `${id}${LEGACY_NEEDS_SUFFIX}`),
    ];
    let found = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) { found = p; break; }
    }
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No editable content found for slice ${id}` }));
      return;
    }

    try {
      const raw = fs.readFileSync(found, 'utf8');
      const lines = raw.split('\n');
      let dashes = 0, fmEnd = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '---') dashes++;
        if (dashes === 2) { fmEnd = i; break; }
      }
      if (fmEnd === -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not parse frontmatter' }));
        return;
      }
      const updated = lines.slice(0, fmEnd + 1).join('\n') + '\n\n' + payload.body;
      fs.writeFileSync(found, updated, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Return queued slice to staged for O'Brien revision ──────────────────
  const returnQueuedMatch = pathname.match(/^\/api\/queue\/(\d+)\/return-to-stage$/);
  if (returnQueuedMatch && req.method === 'POST') {
    const id = returnQueuedMatch[1];
    const payload = await readJsonBody(req);

    // Race protection: if currently dispatched, reject
    let hbCurrent = null;
    try {
      const hb = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
      hbCurrent = hb.current_slice ? String(hb.current_slice) : null;
    } catch (_) {}
    if (hbCurrent === id) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'already-picked-up' }));
      return;
    }

    const queuedPath  = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
    const pendingPath = path.join(QUEUE_DIR, `${id}-PENDING.md`);
    const sourcePath  = fs.existsSync(queuedPath) ? queuedPath
                      : fs.existsSync(pendingPath) ? pendingPath
                      : null;
    if (!sourcePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Queued slice ${id} not found` }));
      return;
    }

    try {
      const note = payload && typeof payload.note === 'string' && payload.note.trim()
        ? payload.note.trim()
        : "Returned to O'Brien from Ops queue";
      let content = fs.readFileSync(sourcePath, 'utf8');
      content = updateFrontmatter(content, { status: 'NEEDS_APENDMENT', apendment_note: note });

      const destPath = path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`);
      fs.writeFileSync(destPath, content, 'utf8');

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const trashName = `${path.basename(sourcePath)}.returned-to-stage-${ts}`;
      try { fs.renameSync(sourcePath, path.join(TRASH_DIR, trashName)); }
      catch (_) {
        try { fs.unlinkSync(sourcePath); } catch (_) {}
      }

      const qOrder = readQueueOrder().filter(oid => oid !== id);
      writeQueueOrder(qOrder);
      const sOrder = readStagedOrder();
      if (!sOrder.includes(id)) sOrder.push(id);
      writeStagedOrder(sOrder);

      writeRegisterEvent({ event: 'returned_to_stage', slice_id: id, source: 'dashboard', note });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, action: 'returned_to_stage' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Return-to-stage (writes control file for watcher) ────────────────────
  const returnMatch = pathname.match(/^\/api\/bridge\/return-to-stage\/(\d+)$/);
  if (returnMatch && req.method === 'POST') {
    const id = returnMatch[1];
    // Ensure control dir exists
    if (!fs.existsSync(CONTROL_DIR)) fs.mkdirSync(CONTROL_DIR, { recursive: true });
    const controlFile = path.join(CONTROL_DIR, `return-${id}-${Date.now()}.json`);
    try {
      fs.writeFileSync(controlFile, JSON.stringify({ action: 'return_to_stage', slice_id: id }), 'utf8');
      writeRegisterEvent({ event: 'RETURN_TO_STAGE_REQUESTED', slice_id: id, source: 'dashboard' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Pause / Resume / Abort (write control files for watcher) ─────────────
  const controlMatch = pathname.match(/^\/api\/bridge\/(pause|resume|abort)\/(\d+)$/);
  if (controlMatch && req.method === 'POST') {
    const action = controlMatch[1];
    const id = controlMatch[2];
    if (!fs.existsSync(CONTROL_DIR)) fs.mkdirSync(CONTROL_DIR, { recursive: true });
    const controlFile = path.join(CONTROL_DIR, `${action}-${id}-${Date.now()}.json`);
    try {
      fs.writeFileSync(controlFile, JSON.stringify({ action, slice_id: id }), 'utf8');
      writeRegisterEvent({ event: `${action.toUpperCase()}_REQUESTED`, slice_id: id, source: 'dashboard' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Slice frontmatter endpoint (for rounds[] and total_* fields) ─────────
  const sliceFmMatch = pathname.match(/^\/api\/slice\/(\d+)\/frontmatter$/);
  if (sliceFmMatch && req.method === 'GET') {
    const id = sliceFmMatch[1];
    // Search queue dir, staged dir for any file with this ID
    const dirs = [QUEUE_DIR, STAGED_DIR];
    let found = null;
    for (const dir of dirs) {
      try {
        const files = fs.readdirSync(dir).filter(f => f.startsWith(`${id}-`) && f.endsWith('.md'));
        if (files.length > 0) {
          found = path.join(dir, files[0]);
          break;
        }
      } catch (_) {}
    }
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No slice file found for ID ${id}` }));
      return;
    }
    try {
      const raw = fs.readFileSync(found, 'utf8');
      const fm = parseFrontmatter(raw);
      // Parse rounds[] from the YAML frontmatter (simple line-by-line)
      const rounds = parseRoundsArray(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, frontmatter: fm, rounds }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Slice investigation: prompt + report + per-round reviews ─────────────
  const sliceInvMatch = pathname.match(/^\/api\/slice\/(\d+)$/);
  if (sliceInvMatch && req.method === 'GET') {
    const id = sliceInvMatch[1];
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildSliceInvestigation(id)));
    } catch (err) {
      const status = err.status === 404 ? 404 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  // 400 for any /api/slice/* that didn't match a valid route above (non-numeric ID)
  if (pathname.startsWith('/api/slice/') && req.method === 'GET') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Slice ID must be numeric' }));
    return;
  }

  // ── Live build log (J-watch-slice-live-log): tail of bridge/logs/rom-<id>.log ──
  // no-store so a poll always reflects the file as it grows while Rom runs.
  const logMatch = pathname.match(/^\/api\/log\/(\d+)$/);
  if (logMatch && req.method === 'GET') {
    const id = logMatch[1];
    try {
      const log = readRomLog(id);
      if (!log) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ id, error: 'no_log_yet', lines: [], text: '' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(log));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  if (pathname.startsWith('/api/log/') && req.method === 'GET') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Log slice ID must be numeric' }));
    return;
  }

  // ── Queue order persistence (drag-reorder) ──────────────────────────────────
  if (pathname === '/api/queue/order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { order } = JSON.parse(body);
        if (!Array.isArray(order)) throw new Error('order must be array');
        writeQueueOrder(order.map(String));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── Staged order persistence (drag-reorder) ────────────────────────────────
  if (pathname === '/api/staged/order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { order } = JSON.parse(body);
        if (!Array.isArray(order)) throw new Error('order must be array');
        writeStagedOrder(order.map(String));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/bridge') {
    const corsHeaders = {
      'Access-Control-Allow-Origin':  CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    let data;
    try { data = getCachedBridgeData(); }
    catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify(data));
    return;
  }

  // ── Cost Center ─────────────────────────────────────────────────────────
  if (pathname === '/api/costs' && req.method === 'GET') {
    try {
      const result = getCachedCostsData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Regression catalogue overview (Bashir crew card) ───────────────────────
  if (pathname === '/api/regression/coverage' && req.method === 'GET') {
    try {
      const coveragePath = path.join(REPO_ROOT, 'regression', 'COVERAGE.md');
      if (!fs.existsSync(coveragePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'coverage_not_found' }));
        return;
      }
      const markdown = fs.readFileSync(coveragePath, 'utf8');
      const updated = fs.statSync(coveragePath).mtime.toISOString();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ markdown, updated }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Last regression report (Bashir → O'Brien feedback loop) ────────────────
  // Serves regression/LAST-RUN.md: what passed/regressed in the latest run.
  // status: 'pass' | 'fail' | 'none', parsed from the report heading.
  // What changed in the regression + e2e suites since the last promotion, in plain
  // language — so the operator approves intended spec changes and stops a removed/
  // loosened check that may be masking a real regression, before the gate runs.
  if (pathname === '/api/test-changes' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getTestChanges()));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // The Test-Update Gate verdict for the pinned promotion changeset. no-store so the
  // operator always sees the verdict for the current dev tip, never a cached SHA.
  if (pathname === '/api/tests-needed' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getTestsNeeded()));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Test Drift Gate — the operator-facing pre-gate review (PROCEED / REVIEW / STOP).
  if (pathname === '/api/test-drift' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getTestDrift()));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Stage ① — CHECK FOR TEST UPDATES: the AC-drain triage that gates the merge button.
  if (pathname === '/api/check-test-updates' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getCheckTestUpdates()));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Record the operator's per-AC ruling for a flagged (low-confidence) AC.
  if (pathname === '/api/check-test-updates/decide' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { tag, decision } = JSON.parse(body || '{}');
        if (!tag || typeof tag !== 'string') throw new Error('tag required');
        if (decision != null && decision !== 'update' && decision !== 'keep') throw new Error('decision must be update|keep|null');
        recordAcDecision(tag, decision);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getCheckTestUpdates()));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // CHECK FOR TEST UPDATES → drain the flagged ACs AND kick Julian off (autonomous,
  // adversarial QA) to author the guarding test for each. Returns immediately; the drafts
  // land asynchronously in regression/.drafts/ and surface on the next GET (poll).
  if (pathname === '/api/check-test-updates/author' && req.method === 'POST') {
    try {
      const rep = getCheckTestUpdates();
      const tags = (rep.flagged || []).map(f => f.tag).filter(Boolean);
      const kicked = kickOffAuthoring(tags);
      const out = getCheckTestUpdates();
      out.kicked = kicked;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (pathname === '/api/regression/report' && req.method === 'GET') {
    try {
      // Prefer the report from the ACTUAL latest GitHub run (artifact) so it can't
      // disagree with the live CI/gate. Fall back to the local file (flagged as such).
      const fromGithub = getGitHubRegressionReport();
      if (fromGithub) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fromGithub));
        return;
      }
      const reportPath = path.join(REPO_ROOT, 'regression', 'LAST-RUN.md');
      if (!fs.existsSync(reportPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ markdown: null, updated: null, status: 'none', source: 'none' }));
        return;
      }
      const markdown = fs.readFileSync(reportPath, 'utf8');
      const updated = fs.statSync(reportPath).mtime.toISOString();
      const status = /🔴|—\s*FAIL/.test(markdown.split('\n')[0]) ? 'fail'
                   : /🟢|—\s*PASS/.test(markdown.split('\n')[0]) ? 'pass' : 'none';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ markdown, updated, status, source: 'local' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Crew dossier: role description / memory / artifacts (slice: crew-dossier-tabs)
  const crewDossierMatch = pathname.match(/^\/api\/crew\/([a-z]+)\/dossier$/);
  if (crewDossierMatch && req.method === 'GET') {
    const role = crewDossierMatch[1];
    if (!isValidRole(role)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown_role' }));
      return;
    }
    try {
      const src = ROLE_SOURCES[role] || {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        role:      readFirstExisting(src.role),
        memory:    readConcat(src.memory),
        artifacts: listArtifacts(role),
        meta:      { name: CREW[role].name, title: CREW[role].title, num: CREW[role].num },
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Crew artifact content (JSON, rendered inside the dossier overlay) ───────
  if (pathname === '/api/crew/artifact' && req.method === 'GET') {
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      const role = u.searchParams.get('role') || '';
      const rel  = u.searchParams.get('path') || '';
      if (!isValidRole(role) || !isDeclaredArtifact(role, rel)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown_artifact' }));
        return;
      }
      const f = safeRepoFile(rel);
      if (!f) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'artifact_missing' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        kind: artifactKind(rel), content: fs.readFileSync(f.abs, 'utf8'), path: rel, updated: f.mtime,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Crew artifact raw (opens HTML mockups / source in a new browser tab) ────
  if (pathname === '/api/crew/artifact/raw' && req.method === 'GET') {
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      const role = u.searchParams.get('role') || '';
      const rel  = u.searchParams.get('path') || '';
      if (!isValidRole(role) || !isDeclaredArtifact(role, rel)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('unknown artifact');
        return;
      }
      const f = safeRepoFile(rel);
      if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('artifact missing'); return; }
      const isHtml = artifactKind(rel) === 'html';
      const headers = {
        'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      };
      // Crew-authored HTML mockups render, but in an opaque-origin sandbox with no
      // scripts — so a poisoned artifact can't reach the dashboard's (unauthenticated)
      // privileged endpoints from this same origin.
      if (isHtml) headers['Content-Security-Policy'] = 'sandbox';
      res.writeHead(200, headers);
      res.end(fs.readFileSync(f.abs));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
    return;
  }

  // ── Crew conversation launch: new (pinned session id) / resume last ─────────
  const crewConvoMatch = pathname.match(/^\/api\/crew\/([a-z]+)\/conversation$/);
  if (crewConvoMatch && req.method === 'POST') {
    const role = crewConvoMatch[1];
    if (!isValidRole(role)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown_role' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { mode } = JSON.parse(body || '{}');
        const convos = readRoleConversations();
        const prev = convos[role] || null;

        let effectiveMode = mode === 'resume' ? 'resume' : 'new';
        let sessionId;
        let resumedExisting = false;

        if (effectiveMode === 'resume' && prev && prev.session_id) {
          sessionId = prev.session_id;
          resumedExisting = true;
        } else {
          // 'new', or 'resume' with no history on record → start a fresh session.
          effectiveMode = 'new';
          sessionId = crypto.randomUUID();
        }

        const command = buildConversationCommand(role, sessionId, effectiveMode);
        const launch  = await launchInTerminal(command);

        if (!resumedExisting) {
          // Keep the prior session id under `previous` so a "New conversation" click
          // doesn't permanently orphan the last resumable session from the dashboard.
          convos[role] = {
            session_id: sessionId,
            name: CREW[role].name,
            started: new Date().toISOString(),
            previous: (prev && prev.session_id) || null,
          };
          writeRoleConversations(convos);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true, role,
          mode: effectiveMode,
          requested_mode: mode === 'resume' ? 'resume' : 'new',
          had_previous: !!(prev && prev.session_id),
          session_id: sessionId,
          command,
          launched: launch.launched,
          launch_error: launch.error,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── Gate start (slice 265) ─────────────────────────────────────────────────
  if (pathname === '/api/gate/start' && req.method === 'POST') {
    // Validate branch-state preconditions
    let branchState;
    try {
      branchState = JSON.parse(fs.readFileSync(BRANCH_STATE, 'utf8'));
    } catch (_) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'branch-state-unavailable' }));
      return;
    }

    const gateStatus = branchState.gate ? branchState.gate.status : 'IDLE';
    if (gateStatus === 'GATE_RUNNING' || gateStatus === 'GATE_FAILED' || gateStatus === 'GATE_ABORTED') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'gate-not-idle', status: gateStatus }));
      return;
    }

    const commitsAhead = branchState.dev ? (branchState.dev.commits_ahead_of_main || 0) : 0;
    if (commitsAhead === 0) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'nothing-to-gate' }));
      return;
    }

    // Invoke orchestrator's startGate()
    try {
      const { startGate } = require(path.join(REPO_ROOT, 'bridge', 'orchestrator'));
      const result = startGate();
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ started: true, dev_tip_sha: result.devTipSha }));
    } catch (err) {
      if (err.code === 'MUTEX_HELD') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'gate-not-idle', status: 'GATE_RUNNING' }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // ── Gate events (slice 265) — lightweight poll endpoint for client event dispatch
  if (pathname === '/api/gate/events' && req.method === 'GET') {
    const GATE_LIFECYCLE_EVENTS = new Set([
      'gate-start', 'tests-updated', 'regression-pass',
      'regression-fail', 'merge-complete', 'gate-abort',
    ]);
    const events = _readRegisterTail(REGISTER, 20, e => GATE_LIFECYCLE_EVENTS.has(e.event));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(events));
    return;
  }

  // ── Gate abort (slice 271) ─────────────────────────────────────────────────
  if (pathname === '/api/gate/abort' && req.method === 'POST') {
    // Validate branch-state preconditions
    let branchState;
    try {
      branchState = JSON.parse(fs.readFileSync(BRANCH_STATE, 'utf8'));
    } catch (_) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'branch-state-unavailable' }));
      return;
    }

    const gateStatus = branchState.gate ? branchState.gate.status : 'IDLE';
    if (gateStatus !== 'GATE_FAILED' && gateStatus !== 'GATE_ABORTED') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'gate-not-failed', status: gateStatus }));
      return;
    }

    try {
      const { abortGate } = require(path.join(REPO_ROOT, 'bridge', 'orchestrator'));
      const result = abortGate();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      if (err.code === 'INVALID_STATE') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'gate-not-failed', status: err.status }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // ── Gate state-doctor health (slice 271) ──────────────────────────────────
  if (pathname === '/api/gate/doctor' && req.method === 'GET') {
    try {
      const { execFileSync } = require('child_process');
      const output = execFileSync('node', [path.join(REPO_ROOT, 'bridge', 'state-doctor.js'), '--gate-health'], {
        encoding: 'utf-8',
        timeout: 10000,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output: err.stdout || err.message, error: true }));
    }
    return;
  }

  // ── Promote dispatch — operator-gated trigger for promote.yml ─────────────
  // Promotion is operator-gated: promote.yml is workflow_dispatch-only and
  // re-runs the regression suite against dev, fast-forwarding main on green.
  if (pathname === '/api/promote/dispatch' && req.method === 'POST') {
    // The body is optional and carries exactly one field the server reads:
    // checked_sha — the integration tip the operator's check was made against.
    // Nothing in it can grant a dispatch; see mergeLockRefusal().
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}') || {}; } catch (_) { /* tolerate empty/garbage */ }

      const gh = getGitHubState();

      if ((gh.commits_ahead || 0) === 0) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'nothing_to_promote' }));
        return;
      }

      const runStatus = gh.promote_run ? gh.promote_run.status : 'idle';
      if (runStatus === 'pending' || runStatus === 'in_progress') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'gate_already_running' }));
        return;
      }

      // The lock. Derived here, never asserted by the caller.
      const locked = mergeLockRefusal({ checkedSha: payload.checked_sha,
                                        devSha: gh.origin_dev_sha });
      if (locked) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, ...locked }));
        return;
      }

      try {
        execFileSync('gh', ['workflow', 'run', 'promote.yml', '--ref', 'dev'],
          { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000 });
        _bustGitHubCache();
        try {
          writeRegisterEvent({ event: 'promote-dispatched',
                               dev_tip_sha: gh.origin_dev_sha || null,
                               commits_ahead: gh.commits_ahead });
        } catch (_) { /* register write is best-effort */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'dispatch_failed',
                                 detail: String(err.message || err).slice(0, 200) }));
      }
    });
    return;
  }

  // ── Rollback preview — "what will move to main" (ADR-ROLLBACK-MODEL gotcha) ──
  // GET /api/rollback/preview?slice_id=N (or ?sha=...). Read-only: creates
  // nothing. Surfaces the revert plus the already-pending dev commits that a
  // rollback would carry to main, so the operator sees Y and Z before clicking.
  if (pathname === '/api/rollback/preview' && req.method === 'GET') {
    const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const sliceId = qs.get('slice_id');
    const sha = qs.get('sha') || (sliceId ? resolveSquashSha(sliceId) : null);
    if (!sha) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unknown_slice' }));
      return;
    }
    const gh = getGitHubState();
    // Already-pending un-promoted dev commits (origin/main..origin/dev). A
    // rollback fast-forwards main past these too — this is the one real gotcha.
    const pending = Array.isArray(gh.dev_commits) ? gh.dev_commits : [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      slice_id: sliceId != null ? String(sliceId) : null,
      squash_sha: sha.slice(0, 7),
      // The revert commit itself, plus every commit already ahead of main.
      will_move: pending.length + 1,
      pending_commits: pending.map(c => ({ sha: c.sha, slice_id: c.slice_id, subject: c.subject })),
      // dev level with main ⇒ the clean "merge then immediately roll back" case.
      dev_level_with_main: (gh.commits_ahead || 0) === 0,
    }));
    return;
  }

  // ── Rollback dispatch — operator-gated revert-forward through the gate ──────
  // POST /api/rollback/dispatch { slice_id }. Creates a clean git revert commit
  // on dev (clean-only; conflict degrades to a human forward-fix) then fires
  // promote.yml exactly like /api/promote/dispatch — mechanically a rollback IS
  // a promote dispatch, so the same 409 mutex, the same merge lock, and the same
  // CI strip apply.
  if (pathname === '/api/rollback/dispatch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) { /* tolerate empty */ }
      const sliceId = payload.slice_id != null ? String(payload.slice_id) : null;

      // Mutex: you cannot promote and roll back at once. A gate already in
      // flight blocks the rollback (mirrors the promote 409).
      const gh = getGitHubState();
      const runStatus = gh.promote_run ? gh.promote_run.status : 'idle';
      if (runStatus === 'pending' || runStatus === 'in_progress') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'gate_already_running' }));
        return;
      }

      const sha = payload.squash_sha || (sliceId ? resolveSquashSha(sliceId) : null);
      if (!sha) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unknown_slice' }));
        return;
      }

      // The same lock as promote — a rollback IS a promote dispatch, and it moves
      // main just the same. Checked HERE, before createRevertCommit: a refused
      // rollback must leave nothing behind on dev to clean up.
      const locked = mergeLockRefusal({ checkedSha: payload.checked_sha,
                                        devSha: gh.origin_dev_sha });
      if (locked) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, ...locked }));
        return;
      }

      // Build the revert commit on dev (or refuse cleanly).
      const r = createRevertCommit({ squashSha: sha, sliceId });
      if (!r.ok) {
        const codeToStatus = { unknown_sha: 404, not_on_dev: 409, not_on_main: 409,
                               dirty_worktree: 409, conflict: 409, git_error: 502 };
        if (r.code === 'conflict') {
          // Route the forward-fix the honest way: record it for the operator.
          // We do NOT auto-create a queue brief — that would auto-dispatch Rom,
          // which is operator-gated. A human authors the forward-fix slice.
          try {
            writeRegisterEvent({ event: 'rollback-conflict', slice_id: sliceId,
                                 squash_sha: sha.slice(0, 7),
                                 conflict_files: r.conflict_files || [],
                                 blamed_slice: r.blame ? r.blame.slice_id : null });
          } catch (_) { /* best-effort audit */ }
        }
        res.writeHead(codeToStatus[r.code] || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: r.code, conflict_files: r.conflict_files,
                                 blame: r.blame, detail: r.detail }));
        return;
      }

      // Revert is committed + pushed to origin/dev. Now fire the gate exactly
      // like a promotion — promote.yml re-tests the reverted state before main
      // fast-forwards to it.
      _bustGitHubCache();
      try {
        execFileSync('gh', ['workflow', 'run', 'promote.yml', '--ref', 'dev'],
          { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000 });
        try {
          writeRegisterEvent({ event: 'rollback-dispatched', slice_id: sliceId,
                               squash_sha: sha.slice(0, 7), revert_sha: r.revert_sha.slice(0, 7) });
        } catch (_) { /* register write is best-effort */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, revert_sha: r.revert_sha.slice(0, 7) }));
      } catch (err) {
        // The revert is on dev but the gate didn't start. main is untouched;
        // the operator can press RUN GATE to promote the revert later.
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'dispatch_failed', revert_pushed: true,
                                 revert_sha: r.revert_sha.slice(0, 7),
                                 detail: String(err.message || err).slice(0, 200) }));
      }
    });
    return;
  }

  // ── Register tail (slice 271) — last N register events for Investigate panel
  if (pathname === '/api/gate/register-tail' && req.method === 'GET') {
    const events = _readRegisterTail(REGISTER, 50, e => {
      const ts = e.ts;
      // Return events since last gate-start
      return e.event && (e.event.startsWith('gate-') || e.event === 'lock-cycle' ||
        e.event === 'regression-pass' || e.event === 'regression-fail' ||
        e.event === 'tests-updated' || e.event === 'merge-complete');
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(events));
    return;
  }

  // ── Branch state (slice 262, extended slice 314) ──────────────────────────
  // Returns local gate/queue state overlaid with real GitHub origin tips,
  // commits-ahead count, CI run status, and promote result from git+gh.
  if (pathname === '/api/branch-state' && req.method === 'GET') {
    let base = {};
    try { base = JSON.parse(fs.readFileSync(BRANCH_STATE, 'utf8')); } catch (_) {}

    const gh = getGitHubState();
    base.github = gh;

    // Whether the dev changeset actually touched any regression/e2e check. Drives the
    // "Update tests" gate step: green ✓ only if tests were really updated, otherwise it
    // reads "not req." (cached 30s in getTestChanges, so it's cheap on every poll).
    if (gh && !gh.error) {
      try { base.github.tests_changed = getTestChanges().anyChange; } catch (_) {}
    }

    // Overlay GitHub tips into the existing main/dev subobjects so the
    // topology renderer picks up real origin SHAs without code changes there.
    if (gh && !gh.error) {
      base.main = base.main || {};
      base.main.tip_sha = gh.origin_main_sha || base.main.tip_sha || null;
      base.dev  = base.dev  || {};
      base.dev.tip_sha              = gh.origin_dev_sha  || base.dev.tip_sha  || null;
      base.dev.commits_ahead_of_main = gh.commits_ahead;
      // gh is healthy here, so origin/main..origin/dev is authoritative — INCLUDING
      // when it is empty. The old `length > 0` guard fell back to branch-state.json's
      // `commits` array in exactly the case that matters: right after a promote, when
      // the range empties. That would have drawn the just-merged commits back onto the
      // dev ribbon from a file the retired local gate stopped updating in June.
      if (Array.isArray(gh.dev_commits)) {
        base.dev.commits = gh.dev_commits;
      }
      // Replace the stale local last_merge (written by retired local-merge gate)
      // with the live promote result so the topology dot reflects origin/main now.
      if (gh.promote && gh.promote.sha) {
        base.last_merge = { sha: gh.promote.sha, full_sha: gh.promote.full_sha,
                            slice_id: gh.promote.slice_id || null, age_s: gh.promote.age_s };
      } else {
        base.last_merge = null;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(base));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`LCARS dashboard server running at http://${HOST}:${PORT}`);
  });
}

module.exports = { mergeLockRefusal, buildSliceInvestigation, parseFrontmatter, extractBody, parseRoundsArray, extractRoundSections, getCachedFile, getCachedDir, _cache, getCachedBridgeData, getCachedCostsData, buildBridgeData, buildCostsData, STALE_DONE_DAYS, deriveHistoryOutcome, deriveReviewStatus, authoringStateFor, kickOffAuthoring, createRevertCommit, resolveSquashSha, mapPromotePhases, parseGateFailures, isFreshPromoteCompletion, isReconciling, _promoteTtlMs };

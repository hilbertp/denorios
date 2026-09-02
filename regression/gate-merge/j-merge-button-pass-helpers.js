'use strict';

/**
 * Helpers for J-merge-button-pass (gate-merge).
 *
 * Provides:
 *   - isolated git fixtures: a work repo + a LOCAL BARE origin (no network),
 *     main and dev pushed, dev initially equal to main
 *   - a PATH-stubbed `gh` executable so the dashboard server's
 *     execFileSync('gh', ...) can NEVER reach real GitHub (a real authenticated
 *     gh would actually dispatch promote.yml — forbidden)
 *   - workflow-YAML step parsing (indentation-based, no YAML dependency) so the
 *     promote.yml `run: |` blocks can be asserted on and executed behaviorally
 *
 * #99992 rule: nothing here ever touches live bridge/queue/, bridge/staged/,
 * bridge/state/, or bridge/register.jsonl — all paths are caller-supplied
 * tmpdirs.
 */

const fs   = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Deterministic git identity + isolation from machine/user git config
// (CI runners have no identity; dev machines may have gpgsign etc.).
const GIT_ENV = {
  GIT_AUTHOR_NAME:     'Bashir Fixture',
  GIT_AUTHOR_EMAIL:    'bashir@fixture.test',
  GIT_COMMITTER_NAME:  'Bashir Fixture',
  GIT_COMMITTER_EMAIL: 'bashir@fixture.test',
  GIT_CONFIG_GLOBAL:   '/dev/null',
  GIT_CONFIG_SYSTEM:   '/dev/null',
};

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(workDir, relPath, content, message) {
  const abs = path.join(workDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  git(['add', relPath], workDir);
  git(['commit', '--quiet', '-m', message], workDir);
  return git(['rev-parse', 'HEAD'], workDir);
}

/**
 * Create a work repo at workDir and a local bare origin at originDir.
 * main gets one seed commit; dev is branched from main (0 commits ahead);
 * both are pushed to origin. Leaves the work tree checked out on dev
 * (mirroring promote.yml's `checkout ref: dev`).
 * Returns { mainSha } — the seed commit sha (== initial dev tip).
 */
function initGitFixture({ workDir, originDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  git(['init', '--quiet', '--bare', originDir], workDir);
  git(['init', '--quiet', '-b', 'main'], workDir);
  const mainSha = commitFile(workDir, 'README-fixture.md', 'seed for J-merge-button-pass\n', 'seed: initial main commit');
  git(['remote', 'add', 'origin', originDir], workDir);
  git(['push', '--quiet', 'origin', 'main'], workDir);
  git(['checkout', '--quiet', '-b', 'dev', 'main'], workDir);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  return { mainSha };
}

/** Commit a file on dev and push it to origin/dev. Returns the new dev tip sha. */
function advanceDev(workDir, relPath, content, message) {
  git(['checkout', '--quiet', 'dev'], workDir);
  const sha = commitFile(workDir, relPath, content, message);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  return sha;
}

/** Commit a file directly on main and push it (out-of-band push — divergence). */
function divergeMain(workDir, relPath, content, message) {
  git(['checkout', '--quiet', 'main'], workDir);
  const sha = commitFile(workDir, relPath, content, message);
  git(['push', '--quiet', 'origin', 'main'], workDir);
  git(['checkout', '--quiet', 'dev'], workDir);
  return sha;
}

// ── gh stub ──────────────────────────────────────────────────────────────────

/**
 * Write an executable `gh` stub into binDir. Behavior is driven by files in
 * stubStateDir:
 *   promote-runs.json — JSON printed for `gh run list --workflow=promote.yml`
 *   dispatch-fail     — if present, `gh workflow run ...` exits 1 (auth failure)
 *   dispatches.log    — appended with argv for every successful `workflow run`
 *   calls.log         — appended with argv for every invocation
 * Prepend binDir to process.env.PATH BEFORE compiling the server.
 */
function installGhStub(binDir, stubStateDir) {
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(stubStateDir, { recursive: true });
  fs.writeFileSync(path.join(stubStateDir, 'promote-runs.json'), '[]', 'utf8');
  const script = `#!/bin/sh
# gh stub for J-merge-button-pass — offline; never contacts GitHub.
ROOT="${stubStateDir}"
echo "$*" >> "$ROOT/calls.log"
case "$1 $2" in
  "workflow run")
    if [ -f "$ROOT/dispatch-fail" ]; then
      echo "HTTP 401: Bad credentials (gh stub)" >&2
      exit 1
    fi
    echo "$*" >> "$ROOT/dispatches.log"
    exit 0
    ;;
  "run list")
    case "$*" in
      *promote.yml*) cat "$ROOT/promote-runs.json" ;;
      *) echo "[]" ;;
    esac
    exit 0
    ;;
esac
echo "[]"
exit 0
`;
  const ghPath = path.join(binDir, 'gh');
  fs.writeFileSync(ghPath, script, { mode: 0o755 });
  return ghPath;
}

function setPromoteRuns(stubStateDir, runs) {
  fs.writeFileSync(path.join(stubStateDir, 'promote-runs.json'), JSON.stringify(runs), 'utf8');
}

function setDispatchFail(stubStateDir, on) {
  const marker = path.join(stubStateDir, 'dispatch-fail');
  if (on) fs.writeFileSync(marker, '1', 'utf8');
  else fs.rmSync(marker, { force: true });
}

function readDispatches(stubStateDir) {
  try {
    return fs.readFileSync(path.join(stubStateDir, 'dispatches.log'), 'utf8')
      .split('\n').filter(Boolean);
  } catch (_) {
    return [];
  }
}

// ── workflow YAML parsing (indentation-based; promote.yml only needs this) ──

/**
 * Return the lines of a top-level block (e.g. 'on') as a single string —
 * everything from `key:` up to the next non-indented key.
 */
function topLevelBlock(workflowSrc, key) {
  const lines = workflowSrc.split('\n');
  const start = lines.findIndex(l => l === `${key}:` || l.startsWith(`${key}:`));
  if (start === -1) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.search(/\S/) === 0) break; // next top-level key
    out.push(l);
  }
  return out.join('\n');
}

/**
 * Split the (single) job's `steps:` sequence into ordered step chunks
 * (raw text, one string per `- ...` item). Sequence order in YAML is
 * execution order, so array order == step execution order.
 */
function parseJobSteps(workflowSrc) {
  const lines = workflowSrc.split('\n');
  const stepsIdx = lines.findIndex(l => l.trim() === 'steps:');
  if (stepsIdx === -1) return [];
  const stepsIndent = lines[stepsIdx].search(/\S/);
  const steps = [];
  let current = null;
  for (let i = stepsIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { if (current) current.push(l); continue; }
    const indent = l.search(/\S/);
    if (indent <= stepsIndent) break; // dedented out of the steps block
    if (l.trim().startsWith('- ') && indent === stepsIndent + 2) {
      if (current) steps.push(current.join('\n'));
      current = [l];
    } else if (current) {
      current.push(l);
    }
  }
  if (current) steps.push(current.join('\n'));
  return steps;
}

/** Extract the dedented body of a step's `run: |` block scalar (or null). */
function runBlockOf(stepText) {
  const lines = stepText.split('\n');
  const runIdx = lines.findIndex(l => l.trim() === 'run: |');
  if (runIdx === -1) return null;
  const runIndent = lines[runIdx].search(/\S/);
  const raw = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { raw.push(''); continue; }
    if (l.search(/\S/) <= runIndent) break;
    raw.push(l);
  }
  const indents = raw.filter(l => l.trim()).map(l => l.search(/\S/));
  if (indents.length === 0) return '';
  const min = Math.min(...indents);
  return raw.map(l => (l.trim() ? l.slice(min) : '')).join('\n');
}

// ── merge-lock dependencies in a fixture root ────────────────────────────────
// Since slice 361 the dispatch endpoints derive the test-update lock server-side
// (mergeLockRefusal → getCheckTestUpdates), which resolves lib/ and scripts/ off
// REPO_ROOT and reads regression/COVERAGE.lock + AC-DECISIONS.json. The lock fails
// CLOSED, so a fixture root missing those refuses every dispatch with
// test_updates_unavailable — correct product behaviour, but it walls off the
// endpoints these suites exist to pin.
//
// This gives the fixture the REAL engine and an empty, honest gate state: fixture
// commits carry no `AC:` trailers, so the range yields no ACs, nothing is flagged,
// and the lock is open. A fixture that WANTS the lock shut declares an AC trailer
// on dev (see J-merge-lock-server).
function seedMergeLockDeps(root) {
  const realRoot = path.resolve(__dirname, '..', '..');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'regression'), { recursive: true });
  fs.cpSync(path.join(realRoot, 'lib'), path.join(root, 'lib'), { recursive: true });
  fs.cpSync(path.join(realRoot, 'scripts', 'build-ac-manifest.js'),
            path.join(root, 'scripts', 'build-ac-manifest.js'));
  fs.writeFileSync(path.join(root, 'regression', 'COVERAGE.lock'),
                   JSON.stringify({ bySource: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'regression', 'AC-DECISIONS.json'), '{}', 'utf8');
}

// ── server-in-tmpdir compiler ────────────────────────────────────────────────
// Compile dashboard/server.js against a tmp fixture root (REPO_ROOT rewritten,
// lifecycle shim stubbed, auto-listen disabled) and return its exports. Shared
// by J-merge-button-pass and J-s-numbering-legacy-resolve; extracted 2026-09-01.
function compileServer(root) {
  const Module = require('node:module');
  const serverSrcPath = path.join(__dirname, '..', '..', 'dashboard', 'server.js');
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(lifecyclePath, `
'use strict';
module.exports = {
  translateEvent(ev) { return ev; },
  resetDedupeState() {},
};
`, 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  const src = fs.readFileSync(serverSrcPath, 'utf8')
    .replace(
      /const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/,
      `const REPO_ROOT = ${JSON.stringify(root)};`
    )
    .replace(
      /const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/,
      `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`
    )
    .replace(
      /const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/,
      `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`
    )
    .replace(
      /require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/,
      `require(${JSON.stringify(lifecyclePath)})`
    )
    .replace(/if \(require\.main === module\)/, 'if (false)')
    .replace(/module\.exports = \{ /, 'module.exports = { server, _bustGitHubCache, ');

  const mod = new Module('patched-dashboard-server');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports;
}

module.exports = {
  GIT_ENV,
  git,
  commitFile,
  initGitFixture,
  advanceDev,
  divergeMain,
  installGhStub,
  seedMergeLockDeps,
  compileServer,
  setPromoteRuns,
  setDispatchFail,
  readDispatches,
  topLevelBlock,
  parseJobSteps,
  runBlockOf,
};

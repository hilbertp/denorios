'use strict';

// J-gate-fail-retry helpers — Tier 2 git + stub-gh harness for gate-merge
// journeys (same shape as the J-merge-button-pass harness; shareable).
//
// #99992 rule: every byte of state lives under fs.mkdtempSync(os.tmpdir()).
// The live bridge/ tree is never touched. A stub `gh` is written into
// <tmpRoot>/bin and MUST be prepended to process.env.PATH before any request
// is made, so the compiled dashboard server can never reach real GitHub —
// a real authenticated gh would ACTUALLY dispatch promote.yml.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_SRC = path.join(REPO_ROOT, 'dashboard', 'server.js');

// Ignore user/system git config (signing, hooksPath, odd defaults) for both
// the fixture-building git calls and the compiled server's git calls (the
// server inherits process.env — the caller sets these there too).
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// Build the bridge/dashboard fixture tree the dashboard server expects.
function makeBridgeFixture(prefix) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const dir of [
    path.join(tmpRoot, 'bridge', 'queue'),
    path.join(tmpRoot, 'bridge', 'staged'),
    path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
    path.join(tmpRoot, 'bin'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const b = (...p) => path.join(tmpRoot, 'bridge', ...p);
  fs.writeFileSync(b('register.jsonl'), '', 'utf8');
  fs.writeFileSync(b('heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(b('queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(b('staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(b('sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(b('first-output.json'), '{}', 'utf8');
  fs.writeFileSync(b('nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(b('state', 'branch-state.json'), '{}', 'utf8');
  return tmpRoot;
}

// Local-only git topology: tmpRoot is a work tree with a bare origin.git
// remote inside the same tmpdir. main has 1 commit; dev is 1 commit ahead.
// `git fetch origin main dev` then works fully offline.
function initGitFixture(tmpRoot) {
  git(tmpRoot, ['init', '-q', '-b', 'main']);
  git(tmpRoot, ['config', 'user.name', 'Bashir Fixture']);
  git(tmpRoot, ['config', 'user.email', 'bashir@fixture.test']);
  git(tmpRoot, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(tmpRoot, 'README.md'), 'gate-fail-retry fixture\n', 'utf8');
  git(tmpRoot, ['add', 'README.md']);
  git(tmpRoot, ['commit', '-q', '-m', 'fixture: main base']);

  const originDir = path.join(tmpRoot, 'origin.git');
  git(tmpRoot, ['init', '-q', '--bare', originDir]);
  git(tmpRoot, ['remote', 'add', 'origin', originDir]);
  git(tmpRoot, ['push', '-q', 'origin', 'main']);

  git(tmpRoot, ['checkout', '-q', '-b', 'dev']);
  fs.writeFileSync(path.join(tmpRoot, 'fix-slice.txt'), 'fix slice landed on dev\n', 'utf8');
  git(tmpRoot, ['add', 'fix-slice.txt']);
  git(tmpRoot, ['commit', '-q', '-m', 'slice 247: fix queue-reorder atomic persist']);
  git(tmpRoot, ['push', '-q', 'origin', 'dev']);

  return {
    mainSha: git(tmpRoot, ['rev-parse', 'main']),
    devSha: git(tmpRoot, ['rev-parse', 'dev']),
  };
}

// Executable stub gh. Behavior is driven by control files in tmpRoot:
//   gh-ci.json          — JSON the stub emits for `gh run list --workflow=ci.yml`
//   gh-promote.json     — JSON for `gh run list --workflow=promote.yml`
//   gh-dispatch-fail    — if present, `gh workflow run promote.yml` exits 1
//   gh-calls.log        — every invocation's argv is appended here
function writeStubGh(tmpRoot) {
  const binDir = path.join(tmpRoot, 'bin');
  const callsLog = path.join(tmpRoot, 'gh-calls.log');
  const promoteJson = path.join(tmpRoot, 'gh-promote.json');
  const ciJson = path.join(tmpRoot, 'gh-ci.json');
  const dispatchFailFlag = path.join(tmpRoot, 'gh-dispatch-fail');
  fs.writeFileSync(callsLog, '', 'utf8');
  fs.writeFileSync(promoteJson, '[]', 'utf8');
  fs.writeFileSync(ciJson, '[]', 'utf8');

  const script = [
    '#!/bin/sh',
    '# stub gh — never talks to GitHub; controlled by files in the fixture root',
    `ROOT=${JSON.stringify(tmpRoot)}`,
    'printf \'%s\\n\' "$*" >> "$ROOT/gh-calls.log"',
    'case "$*" in',
    "  'workflow run promote.yml'*)",
    '    if [ -f "$ROOT/gh-dispatch-fail" ]; then',
    "      echo 'stub gh: dispatch refused (auth failure simulation)' >&2",
    '      exit 1',
    '    fi',
    '    exit 0',
    '    ;;',
    "  *'--workflow=ci.yml'*) cat \"$ROOT/gh-ci.json\"; exit 0 ;;",
    "  *'--workflow=promote.yml'*) cat \"$ROOT/gh-promote.json\"; exit 0 ;;",
    'esac',
    'exit 0',
    '',
  ].join('\n');

  const ghPath = path.join(binDir, 'gh');
  fs.writeFileSync(ghPath, script, 'utf8');
  fs.chmodSync(ghPath, 0o755);
  return { binDir, callsLog, promoteJson, ciJson, dispatchFailFlag };
}

// Compile dashboard/server.js with REPO_ROOT redirected into tmpRoot
// (pattern copied from test/api-queue-content-return-to-stage.test.js),
// additionally exporting _bustGitHubCache so tests can defeat the 30s/60s
// git/gh TTL caches between stub-state changes.
function compileServer(tmpRoot) {
  const dashboardDir = path.join(tmpRoot, 'dashboard');
  const lifecyclePath = path.join(tmpRoot, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(lifecyclePath, [
    "'use strict';",
    'module.exports = {',
    '  translateEvent(ev) { return ev; },',
    '  resetDedupeState() {},',
    '};',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  const src = fs.readFileSync(SERVER_SRC, 'utf8')
    .replace(
      /const REPO_ROOT\s*=\s*path\.resolve\(__dirname,\s*'\.\.'\);/,
      `const REPO_ROOT = ${JSON.stringify(tmpRoot)};`
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

  // #99992 guard: if the REPO_ROOT rewrite did not land, the compiled server
  // would point at the LIVE repo. Refuse to continue.
  if (!src.includes(JSON.stringify(tmpRoot))) {
    throw new Error('compileServer: REPO_ROOT rewrite failed — refusing to run against live repo');
  }

  const mod = new Module('patched-dashboard-server');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  if (typeof mod.exports.server?.listen !== 'function') {
    throw new Error('compileServer: server export rewrite failed');
  }
  if (typeof mod.exports._bustGitHubCache !== 'function') {
    throw new Error('compileServer: _bustGitHubCache export rewrite failed');
  }
  return { server: mod.exports.server, bustGitHubCache: mod.exports._bustGitHubCache };
}

function request(port, method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: body
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        : {},
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) { /* leave as text */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  makeBridgeFixture,
  initGitFixture,
  writeStubGh,
  compileServer,
  request,
};

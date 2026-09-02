'use strict';

// J-s-numbering — slice-350-ac-4: legacy "slice N:" commit subjects still
// resolve to their slice id in rollback preview and revert blame. The S350
// re-numbering changed the squash subject to "S{id}: {title}"; history written
// before it still reads "slice N: …" — the resolvers must understand BOTH, or
// rollback attribution silently breaks for every pre-S350 slice.
//
// Real-server integration: dashboard/server.js compiled against a tmpdir
// fixture (shared compileServer harness), a local bare origin (offline), and a
// PATH-stubbed gh. Live bridge state is never touched (#99992 rule).
//
//   • preview — GET /api/rollback/preview lists the pending dev commits with
//     slice attributions parsed from subjects: a legacy "slice 041:" subject
//     must attribute slice 041, an "S043:" subject slice 043.
//   • blame — POST /api/rollback/dispatch where the revert conflicts with a
//     LATER legacy-subject commit touching the same lines: the conflict blame
//     must name slice 041, resolved from its legacy subject.
//
// @ac-hash: slice-350-ac-4 sha256:f22483194781ee1702b5b2fd60d8e3870984a658aa99c8361507cde21f69995c

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const {
  git, initGitFixture, installGhStub, compileServer, seedMergeLockDeps,
} = require('./j-merge-button-pass-helpers');

let tmpRoot, server, port, bustCache, squashSha;

function request(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-legacy-resolve-'));
  for (const dir of [
    'bridge/queue', 'bridge/staged', 'bridge/trash', 'bridge/control',
    'bridge/errors', 'bridge/state', 'dashboard',
  ]) fs.mkdirSync(path.join(tmpRoot, dir), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');
  // The rollback dispatch derives the merge lock server-side (slice 361) and
  // fails closed; the fixture needs the real engine and an open gate state.
  seedMergeLockDeps(tmpRoot);

  const binDir = path.join(tmpRoot, 'bin');
  installGhStub(binDir, path.join(tmpRoot, 'gh-stub'));
  process.env.PATH = binDir + path.delimiter + process.env.PATH;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';

  const originDir = path.join(tmpRoot, 'origin.git');
  initGitFixture({ workDir: tmpRoot, originDir });
  // Repo-LOCAL identity: the compiled server's own git operations (fetch,
  // worktree, revert) run with the plain process env — a clean CI runner has
  // no global identity, so pin one in the fixture repo.
  git(['config', 'user.email', 'bashir@fixture.test'], tmpRoot);
  git(['config', 'user.name', 'Bashir Fixture'], tmpRoot);

  // dev history, oldest→newest, pushed to the local origin:
  //   S042 squash   — creates shared.txt (the slice we roll back)
  //   slice 041     — LEGACY subject, rewrites shared.txt (the revert of S042
  //                   conflicts with it → blame path)
  //   ── main fast-forwarded to HERE (rollback needs the squash ON main) ──
  //   S043          — modern subject, pending ahead of main
  //   slice 044     — LEGACY subject, pending ahead of main (preview attribution)
  git(['checkout', '--quiet', 'dev'], tmpRoot);
  fs.writeFileSync(path.join(tmpRoot, 'shared.txt'), 'from slice 042\n');
  git(['add', 'shared.txt'], tmpRoot);
  git(['commit', '--quiet', '-m', 'S042: Fused-identity feature\n\nSlice-Id: 042\nSlice-Branch: slice/042'], tmpRoot);
  squashSha = git(['rev-parse', 'HEAD'], tmpRoot);

  fs.writeFileSync(path.join(tmpRoot, 'shared.txt'), 'rewritten by legacy slice 041\n');
  git(['add', 'shared.txt'], tmpRoot);
  git(['commit', '--quiet', '-m', 'slice 041: Legacy-subject rework\n\nSlice-Id: 041\nSlice-Branch: slice/041'], tmpRoot);

  // Promote everything so far: origin/main reaches the squash (and 041).
  git(['push', '--quiet', 'origin', 'dev:main'], tmpRoot);

  fs.writeFileSync(path.join(tmpRoot, 'modern.txt'), 'modern pending work\n');
  git(['add', 'modern.txt'], tmpRoot);
  git(['commit', '--quiet', '-m', 'S043: Modern pending slice\n\nSlice-Id: 043\nSlice-Branch: slice/043'], tmpRoot);

  fs.writeFileSync(path.join(tmpRoot, 'legacy-pending.txt'), 'legacy pending tweak\n');
  git(['add', 'legacy-pending.txt'], tmpRoot);
  git(['commit', '--quiet', '-m', 'slice 044: Legacy-subject pending tweak\n\nSlice-Id: 044\nSlice-Branch: slice/044'], tmpRoot);
  git(['push', '--quiet', 'origin', 'dev'], tmpRoot);

  // Register: the squash event resolveSquashSha() reads.
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'register.jsonl'),
    JSON.stringify({ ts: '2026-09-01T10:00:00.000Z', event: 'SLICE_SQUASHED_TO_DEV', id: '042', squash_sha: squashSha }) + '\n');

  const exported = compileServer(tmpRoot);
  server = exported.server;
  bustCache = exported._bustGitHubCache;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('slice-350-ac-4 rollback preview attributes pending commits by subject — legacy "slice 041:" resolves to 041, "S043:" to 043', async () => {
  if (bustCache) bustCache();
  const res = await request('GET', '/api/rollback/preview?slice_id=042');
  assert.equal(res.status, 200, `preview must resolve the squash: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.squash_sha, squashSha.slice(0, 7), 'squash sha resolved from the register');

  const byId = Object.fromEntries((res.body.pending_commits || []).map(c => [c.slice_id, c]));
  assert.ok(byId['044'], `legacy "slice 044:" subject must attribute slice 044 — got ${JSON.stringify(res.body.pending_commits)}`);
  assert.match(byId['044'].subject, /^slice 044:/, 'the attributed commit is the legacy-subject one');
  assert.ok(byId['043'], 'modern "S043:" subject must attribute slice 043');
});

test('slice-350-ac-4 revert blame resolves a conflicting legacy-subject commit to its slice id', async () => {
  if (bustCache) bustCache();
  const res = await request('POST', '/api/rollback/dispatch', { slice_id: '042' });
  // The revert of S042's shared.txt edit conflicts with slice 041's later
  // rewrite of the same line — the dispatch must refuse cleanly AND name the
  // legacy slice as the blame, resolved from its "slice 041:" subject.
  assert.equal(res.status, 409, `conflicting revert must refuse cleanly: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error, 'conflict', `refusal must be the conflict path: ${JSON.stringify(res.body)}`);
  const blame = res.body.blame;
  assert.ok(blame, 'conflict response carries a blame');
  const blameId = blame.slice_id || (Array.isArray(blame) && blame[0] && blame[0].slice_id);
  assert.equal(String(blameId), '041', `blame must resolve the legacy subject to slice 041 — got ${JSON.stringify(blame)}`);
});

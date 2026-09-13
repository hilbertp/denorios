'use strict';

// J-gate-lanes — the coverage gate learns the lane (slice 390, ADR-PROOF-LANES §2).
//
// Slice 389 gave a brief a lane, and the lane stopped at Sam's report template. One step
// later the gate collected the tax again: lib/ac-reconcile called a surface criterion with
// no guard MISSING, lib/check-test-updates turned MISSING into "needs a human" and parked
// Pipeline A on NEEDS_YOU, and lib/tests-needed asked a file that only a surface commit had
// touched for a guard it was never going to have.
//
// After this slice the lane travels with the criterion: the manifest and the live range
// scan record it per commit, reconcile answers SURFACE, triage passes it with its evidence
// named, and the Test-Update Gate stops policing a surface-only file. What the gate does
// with a CORE criterion and a CORE commit does not move by one field — ac-5 and trap 1 are
// the whole of that claim, pinned against the fixtures the existing guards already use.
//
// @ac-hash: slice-390-ac-1 sha256:9bf166357dbd2a64fe3c0a0fb27fb6ab882e7283213a215c622c846265d7fbd9
// @ac-hash: slice-390-ac-2 sha256:ef01de7aa6b5f7ada148195628c81700c8350371909a07469effb43e3a40ad8a
// @ac-hash: slice-390-ac-3 sha256:159e718207366077125ab90370995f3a4ac1910d9f500a26f8069ba1f38e8d36
// @ac-hash: slice-390-ac-4 sha256:9de50e68f6048529c22369fb5b982faab2341dee2a3a30a294205069b8dc7697
// @ac-hash: slice-390-ac-5 sha256:7e4d4e7f317ed3e0e3eb0dc1a20625c8a383898250ed3c0801d7fc3b6766cb0c

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AC_BLOCK_SRC   = path.resolve(REPO_ROOT, 'lib', 'ac-block.js');
const RANGE_SCAN_SRC = path.resolve(REPO_ROOT, 'lib', 'ac-range-scan.js');
const RECONCILE_SRC  = path.resolve(REPO_ROOT, 'lib', 'ac-reconcile.js');
const CHECK_SRC      = path.resolve(REPO_ROOT, 'lib', 'check-test-updates.js');
const GATE_SRC       = path.resolve(REPO_ROOT, 'lib', 'tests-needed.js');
const MANIFEST_SRC   = path.resolve(REPO_ROOT, 'scripts', 'build-ac-manifest.js');
const RECONCILE_CLI  = path.resolve(REPO_ROOT, 'scripts', 'ac-reconcile.js');
const SERVER_SRC     = path.resolve(REPO_ROOT, 'dashboard', 'server.js');
const MANIFEST_LOCK  = path.resolve(REPO_ROOT, 'regression', 'AC-MANIFEST.lock');

const { laneOfSliceFile, laneOfCommitBody } = require(AC_BLOCK_SRC);
const { parseAcTrailers, scanRangeManifest } = require(RANGE_SCAN_SRC);
const { reconcile, newAcs } = require(RECONCILE_SRC);
const { triage, triageTag, CONF } = require(CHECK_SRC);
const { decide, gather } = require(GATE_SRC);
const { buildAcManifest, acHashOf } = require(MANIFEST_SRC);
const { newAcsWorklist } = require(RECONCILE_CLI);

// ── fixtures ────────────────────────────────────────────────────────────────

// Copied verbatim from the guards this slice changes, so "unchanged" is measured against
// the same inputs they measure: j-ac-reconcile-classifier, j-check-test-updates and
// j-tests-needed-verdict. A fixture rewritten for this file would prove nothing about them.
const cov = (entries) => ({ bySource: { 'lib/x.js': entries } });
const man = (byTag) => ({ byTag });
const noTrailers = () => ({ testsNotNeeded: [], loosenOk: [], coverageRemoved: [], rejected: [] });
const bfile = (p, isNew) => ({ path: p, area: /^dashboard\//.test(p) ? 'ui' : 'server', isNew: !!isNew });

// One `%B%x00` log record: a commit body, terminated the way git terminates it.
const rec = (...lines) => lines.join('\n') + '\0';

const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A throwaway repo on branches main..dev whose commits carry real `Lane:` trailers and
// real file lists. The per-commit attribution can only be proved against a real log: the
// failure it guards against (a file read against the wrong commit's lane) is invisible to
// any fixture that hands the parser a string somebody already split correctly.
//
// Commit messages are written OUTSIDE the tree — a message file inside it would be swept
// into the next commit by `git add -A` and show up in --name-only as a changed file.
function repoWithCommits(commits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-lanes-'));
  const msgFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-lanes-msg-')), 'msg');
  g(['init', '-q', '-b', 'main'], root);
  g(['config', 'user.email', 't@t.co'], root);
  g(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  g(['add', '-A'], root); g(['commit', '-qm', 'base'], root);
  g(['checkout', '-q', '-b', 'dev'], root);

  for (const c of commits) {
    if (c.branch) { g(c.branch === 'new' ? ['checkout', '-q', '-b', c.name] : ['checkout', '-q', c.name], root); continue; }
    if (c.merge) {
      fs.writeFileSync(msgFile, c.body);
      g(['merge', '--no-ff', '-q', '-F', msgFile, c.merge], root);
      continue;
    }
    for (const [rel, content] of Object.entries(c.files || {})) {
      const abs = path.join(root, rel.split('/').join(path.sep));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    g(['add', '-A'], root);
    fs.writeFileSync(msgFile, c.body);
    g(['commit', '-qF', msgFile], root);
  }
  return root;
}
const rmRepo = (root) => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} };

// A tracked slice file in a temp repo, so the deriver's frontmatter fallback is exercised
// through the same git-index read the live deriver uses.
function repoWithSliceFile(name, body, guards) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-lanes-fm-'));
  fs.mkdirSync(path.join(root, 'bridge', 'queue'), { recursive: true });
  fs.mkdirSync(path.join(root, 'regression'), { recursive: true });
  g(['init', '-q', '-b', 'main'], root);
  g(['config', 'user.email', 't@t.co'], root);
  g(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'bridge', 'queue', name), body);
  g(['add', '-f', `bridge/queue/${name}`], root);
  fs.writeFileSync(path.join(root, 'regression', 'COVERAGE.lock'),
    JSON.stringify({ bySource: { 'dashboard/server.js': guards.map(tag => ({ tag })) } }, null, 2));
  return root;
}

// ── acceptance criteria ─────────────────────────────────────────────────────

test('J-gate-lanes slice-390-ac-1 — every manifest and live-scan entry carries a lane: the declaring commit\u2019s Lane: trailer first, the slice frontmatter as fallback, core by default', () => {
  // The live scan, per record: two commits in one range keep their own lanes.
  const scanned = parseAcTrailers(
    rec('S700: a screen change', '', 'Lane: surface', 'AC: slice-700-ac-1: the panel header reads DEVOPS STATION')
    + rec('S701: a behaviour change', '', 'Lane: core', 'AC: slice-701-ac-1: the endpoint returns 404 for an unknown id')
    + rec('S702: a slice from before lanes existed', '', 'AC: slice-702-ac-1: nobody classified this one')
  ).byTag;
  assert.equal(scanned['slice-700-ac-1'].lane, 'surface');
  assert.equal(scanned['slice-701-ac-1'].lane, 'core');
  assert.equal(scanned['slice-702-ac-1'].lane, null,
    'the raw read reports silence as silence: a record that DECLARED core and one that said nothing are not the same fact');
  // …and the rest of the entry is untouched by the lane.
  assert.equal(scanned['slice-700-ac-1'].text, 'the panel header reads DEVOPS STATION');
  assert.equal(scanned['slice-700-ac-1'].acHash, acHashOf('the panel header reads DEVOPS STATION'));
  assert.equal(scanned['slice-700-ac-1'].legacy, false);

  // scanRangeManifest carries it through from an injected log, and still fails open to
  // EXACTLY { byTag: {} } — the shape j-ac-range-scan deep-equals.
  const live = scanRangeManifest({ gitLog: () => rec('S700: x', '', 'Lane: surface', 'AC: slice-700-ac-1: the header reads DEVOPS STATION') });
  assert.equal(live.byTag['slice-700-ac-1'].lane, 'surface');
  assert.deepEqual(scanRangeManifest({ gitLog: () => { throw new Error('not a git repository'); } }), { byTag: {} });

  // …and the live boundary resolves that silence to core, so EVERY live-scan entry carries a
  // lane. A commit log is one source with nowhere else to look, and unclassified is core.
  const unlabelled = scanRangeManifest({ gitLog: () => rec('S702: a slice from before lanes existed', '', 'AC: slice-702-ac-1: nobody classified this one') });
  assert.equal(unlabelled.byTag['slice-702-ac-1'].lane, 'core', 'no Lane: trailer is the back catalogue — full rigour');

  // The manifest: the trailer wins, as it already does for the text.
  const trailered = repoWithSliceFile('700-DONE.md',
    '---\nid: "700"\nlane: core\n---\n\n## Acceptance criteria\n\n- slice-700-ac-1: the text the file holds\n\n## Traps\n',
    ['slice-700-ac-1']);
  try {
    const m = buildAcManifest(trailered, { gitLog: () => rec('S700: land it', '', 'Lane: surface', 'AC: slice-700-ac-1: the text history declares') });
    assert.equal(m.byTag['slice-700-ac-1'].source, 'commit-trailer');
    assert.equal(m.byTag['slice-700-ac-1'].lane, 'surface', 'the declaring commit\u2019s Lane: trailer is the source of truth');
  } finally { rmRepo(trailered); }

  // …and a trailer that DOES declare core overrides a frontmatter surface. This pair is the
  // whole distinction: a declared lane wins, an undeclared one defers.
  const trailerCore = repoWithSliceFile('704-DONE.md',
    '---\nid: "704"\nlane: surface\n---\n\n## Acceptance criteria\n\n- slice-704-ac-1: the endpoint returns 404\n\n## Traps\n',
    ['slice-704-ac-1']);
  try {
    const m = buildAcManifest(trailerCore, { gitLog: () => rec('S704: land it', '', 'Lane: core', 'AC: slice-704-ac-1: the endpoint returns 404') });
    assert.equal(m.byTag['slice-704-ac-1'].lane, 'core', 'a commit that names core outranks the file that said surface');
  } finally { rmRepo(trailerCore); }

  // THE LIVE CONFIGURATION, and the one that failed review: the landing squash carries the
  // `AC:` lines and NO `Lane:` line — every slice landing until the daemon restarts on 389's
  // squash. History owns the text, as always; it must not thereby claim the lane it never
  // named, because the frontmatter is the only thing that classified this criterion.
  const trailerNoLane = repoWithSliceFile('703-DONE.md',
    '---\nid: "703"\nlane: surface\n---\n\n## Acceptance criteria\n\n- slice-703-ac-1: the panel header reads DEVOPS STATION\n\n## Traps\n',
    ['slice-703-ac-1']);
  try {
    const m = buildAcManifest(trailerNoLane, { gitLog: () => rec('S703: land it', '', 'AC: slice-703-ac-1: the panel header reads DEVOPS STATION') });
    assert.equal(m.byTag['slice-703-ac-1'].source, 'commit-trailer', 'history still owns the text');
    assert.equal(m.byTag['slice-703-ac-1'].lane, 'surface',
      'a trailer that declares the criterion but no lane must not overwrite the frontmatter with core');
  } finally { rmRepo(trailerNoLane); }

  // …and the tracked slice file's frontmatter is the fallback when no trailer speaks at all.
  const fileOnly = repoWithSliceFile('701-DONE.md',
    '---\nid: "701"\nlane: surface\n---\n\n## Acceptance criteria\n\n- slice-701-ac-1: the panel is renamed\n\n## Traps\n',
    ['slice-701-ac-1', 'slice-702-ac-1']);
  try {
    const m = buildAcManifest(fileOnly, { gitLog: () => '' });
    assert.equal(m.byTag['slice-701-ac-1'].source, 'bridge/queue/701-DONE.md');
    assert.equal(m.byTag['slice-701-ac-1'].lane, 'surface');
    assert.equal(m.byTag['slice-702-ac-1'].legacy, true);
    assert.equal(m.byTag['slice-702-ac-1'].lane, 'core', 'a grandfathered tag has nobody to classify it — core');
  } finally { rmRepo(fileOnly); }

  // laneOfCommitBody itself: two declarations and one silence, and silence is its own answer.
  assert.equal(laneOfCommitBody('S1: a body\n\nLane: surface\n'), 'surface');
  assert.equal(laneOfCommitBody('S1: a body\n\nLane: core\n'), 'core');
  assert.equal(laneOfCommitBody('S1: a body that classifies nothing\n'), null);

  // laneOfSliceFile itself: the fence, the default, and the typo that must not become policy.
  assert.equal(laneOfSliceFile('---\nlane: surface\n---\n'), 'surface');
  assert.equal(laneOfSliceFile('---\nlane: "surface"\n---\n'), 'surface');
  assert.equal(laneOfSliceFile('---\nid: "9"\n---\n'), 'core');
  assert.equal(laneOfSliceFile('---\nlane: srufacce\n---\n'), 'core');
  assert.equal(laneOfSliceFile('no frontmatter at all'), 'core');

  // The live lock records it for every entry — the field the integrity deepEqual now covers.
  const lock = JSON.parse(fs.readFileSync(MANIFEST_LOCK, 'utf8'));
  for (const [tag, e] of Object.entries(lock.byTag)) {
    assert.ok(e.lane === 'core' || e.lane === 'surface', `${tag} must carry a lane, got ${JSON.stringify(e.lane)}`);
  }

  // The deriver reads history with a per-commit separator. Without it a surface slice's
  // Lane: line and the next slice's AC: lines land in one record.
  assert.match(fs.readFileSync(MANIFEST_SRC, 'utf8'), /--format=%B%x00/);
  // The lane reader is a regex over the fence, never a require of the daemon: the deriver
  // must stay a pure library read, and bridge/orchestrator.js opens files the moment it loads.
  assert.doesNotMatch(fs.readFileSync(AC_BLOCK_SRC, 'utf8'), /require\([^)]*orchestrator/);
});

test('J-gate-lanes slice-390-ac-2 — reconcile answers SURFACE for an unguarded surface criterion, leaves it out of the work set, and still ratchets one that has a guard', () => {
  const r = reconcile({
    manifest: man({
      'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'surface' },   // no guard → SURFACE
      'slice-1-ac-2': { acHash: 'sha256:bb', legacy: false, lane: 'core' },      // no guard → MISSING
      'slice-1-ac-3': { acHash: 'sha256:cc', legacy: false },                    // no lane → core → MISSING
    }),
    coverage: cov([]),
  });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'SURFACE');
  assert.equal(r.byTag['slice-1-ac-2'].status, 'MISSING');
  assert.equal(r.byTag['slice-1-ac-3'].status, 'MISSING');
  assert.equal(r.counts.SURFACE, 1);
  assert.equal(r.workSet, 2, 'SURFACE is work nobody owes — it never enters the work set');
  // The contract lives in the module, not only in this fixture: SURFACE is decided by the
  // entry's lane, and the work set is MISSING + STALE with no SURFACE term. Reading the
  // source here is also what ties this guard to lib/ac-reconcile.js in the coverage map.
  const reconcileSrc = fs.readFileSync(RECONCILE_SRC, 'utf8');
  assert.match(reconcileSrc, /entry\.lane === 'surface' \? 'SURFACE' : 'MISSING'/);
  assert.match(reconcileSrc, /const workSet = counts\.MISSING \+ counts\.STALE;/);

  // GREEN when nothing but SURFACE, COVERED and LEGACY_UNHASHED remains.
  const green = reconcile({
    manifest: man({
      'slice-2-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'surface' },
      'slice-2-ac-2': { acHash: 'sha256:bb', legacy: false, lane: 'core' },
      'slice-2-ac-3': { acHash: null, legacy: true, lane: 'core' },
    }),
    coverage: cov([
      { tag: 'slice-2-ac-2', file: 't', guardAcHash: 'sha256:bb' },
      { tag: 'slice-2-ac-3', file: 't' },
    ]),
  });
  assert.deepEqual(green.counts, { COVERED: 1, STALE: 0, MISSING: 0, SURFACE: 1, LEGACY_UNHASHED: 1 });
  assert.equal(green.workSet, 0);
  assert.equal(green.verdict, 'GREEN');

  // A surface criterion that DOES have a guard is ratcheted like any other.
  const guarded = reconcile({
    manifest: man({
      'slice-3-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'surface' },
      'slice-3-ac-2': { acHash: 'sha256:NEW', legacy: false, lane: 'surface' },
    }),
    coverage: cov([
      { tag: 'slice-3-ac-1', file: 't', guardAcHash: 'sha256:aa' },
      { tag: 'slice-3-ac-2', file: 't', guardAcHash: 'sha256:OLD' },
    ]),
  });
  assert.equal(guarded.byTag['slice-3-ac-1'].status, 'COVERED');
  assert.equal(guarded.byTag['slice-3-ac-2'].status, 'STALE');
  assert.equal(guarded.verdict, 'NEEDS_RECONCILE');

  // The drain feed shows the lane's answer and asks Julian for nothing.
  const feed = newAcs({
    manifest: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'surface', text: 'the header reads DEVOPS STATION', slice: '1' } }),
    drained: { drained: {} },
    reconcileByTag: r.byTag,
  });
  assert.equal(feed[0].coverage, 'SURFACE');
  const worklist = newAcsWorklist(feed, new Date().toISOString());
  assert.match(worklist, /coverage: SURFACE/);
  assert.match(worklist, /no test is expected/i);

  // The STEP-1 console line reports the surface count instead of hiding it inside "missing".
  // A source grep because a console.log has no other surface; loose enough to survive a
  // rename of the local, tight enough that dropping the count fails.
  assert.match(fs.readFileSync(RECONCILE_CLI, 'utf8'), /surface \$\{[^}]*\.SURFACE\}/);
});

test('J-gate-lanes slice-390-ac-3 — triage passes a SURFACE criterion with its evidence named: high confidence, no human, counted as passed, absent from flagged', () => {
  const row = triageTag('slice-1-ac-1', 'SURFACE', null, undefined);
  assert.equal(row.confidence, CONF.HIGH);
  assert.equal(row.action, 'pass');
  assert.equal(row.needsHuman, false);
  assert.equal(row.reason, 'Surface change: Jordan\u2019s review is the evidence; the browser suite covers the screen at the gate.');

  const r = triage({
    reconcile: { byTag: { 'slice-1-ac-1': { status: 'SURFACE' }, 'slice-1-ac-2': { status: 'COVERED' } } },
    manifest: { byTag: {} }, decisions: {},
  });
  assert.deepEqual(r.flagged, [], 'a surface AC never asks the operator anything');
  assert.equal(r.summary.passed, 2);
  assert.equal(r.summary.flagged, 0);
  assert.equal(r.summary.checked, 2, 'accounted for, not hidden: the overlay counts it among the handled');
  assert.equal(r.ready, true);
  assert.equal(r.verdict, 'CLEAR');

  // A range of nothing but surface criteria unlocks the merge gate on its own.
  const allSurface = triage({
    reconcile: { byTag: { 'slice-1-ac-1': { status: 'SURFACE' }, 'slice-1-ac-2': { status: 'SURFACE' } } },
    manifest: { byTag: {} }, decisions: {},
  });
  assert.equal(allSurface.ready, true);
  assert.equal(allSurface.verdict, 'CLEAR');

  // The copy lives in one constant, so the operator-facing sentence has a single home.
  const src = fs.readFileSync(CHECK_SRC, 'utf8');
  assert.match(src, /SURFACE_REASON/);
  assert.match(src, /browser suite covers the screen at the gate/);
});

test('J-gate-lanes slice-390-ac-4 — the Test-Update Gate stops policing a surface-only file, keeps policing every other, and calls a core-to-surface lane flip an AC mutation', () => {
  // Pure decide(): a surface-only file is excluded from both lists and reported by name.
  const r = decide({
    behaviourFiles: [bfile('dashboard/lcars-dashboard.html'), bfile('dashboard/new-panel.js', true)],
    checks: [], trailers: noTrailers(),
    surfaceOnlyFiles: ['dashboard/lcars-dashboard.html', 'dashboard/new-panel.js'],
  });
  assert.deepEqual(r.unguardedSourceChanges, []);
  assert.deepEqual(r.newBehaviourNoTest, []);
  assert.deepEqual(r.surfaceOnlyFiles.map(f => f.path), ['dashboard/lcars-dashboard.html', 'dashboard/new-panel.js']);
  assert.equal(r.decision, 'clear');

  // A file the lane does NOT excuse is policed exactly as before.
  const mixed = decide({
    behaviourFiles: [bfile('dashboard/lcars-dashboard.html'), bfile('lib/tests-needed.js')],
    checks: [], trailers: noTrailers(),
    surfaceOnlyFiles: ['dashboard/lcars-dashboard.html'],
  });
  assert.deepEqual(mixed.unguardedSourceChanges.map(f => f.path), ['lib/tests-needed.js']);
  assert.equal(mixed.decision, 'needs_review');

  // A lane flip on an unchanged criterion is a spec edit: identical text, but a criterion
  // that owed a test stops owing one. It needs the spec owner's signature like any other.
  const flipFacts = (trailers) => ({
    behaviourFiles: [], checks: [], trailers: trailers || noTrailers(), acEnforce: true,
    acManifest: {
      base: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'core' } }),
      head: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'surface' } }),
    },
  });
  const flipped = decide(flipFacts());
  assert.deepEqual(flipped.acMutated, ['slice-1-ac-1']);
  assert.deepEqual(flipped.acMutatedUndeclared, ['slice-1-ac-1']);
  assert.equal(flipped.decision, 'red_flag');
  const declared = decide(flipFacts(require(GATE_SRC).parseTrailers([
    'AC-Change-OK: slice-1-ac-1 mutated the criterion is about what the screen says\nSpec-Owner: Philipp',
  ])));
  assert.deepEqual(declared.acOverridden, ['slice-1-ac-1']);
  assert.equal(declared.decision, 'overridden');
  // The reverse flip is not a mutation — surface → core only ever asks for MORE proof.
  const tightened = decide({
    behaviourFiles: [], checks: [], trailers: noTrailers(), acEnforce: true,
    acManifest: {
      base: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'surface' } }),
      head: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'core' } }),
    },
  });
  assert.deepEqual(tightened.acMutated, []);

  // gather(): against a real log, the file list and the lane come from the SAME commit.
  const root = repoWithCommits([
    { body: 'S800: rename the panel\n\nSlice-Id: 800\nLane: surface\n', files: { 'dashboard/panel.js': 'v2\n' } },
    { body: 'S801: fix the endpoint\n\nSlice-Id: 801\nLane: core\n', files: { 'lib/endpoint.js': 'v2\n' } },
  ]);
  try {
    const facts = gather({ base: 'main', head: 'dev', repoRoot: root });
    assert.deepEqual(facts.surfaceOnlyFiles, ['dashboard/panel.js']);
    const verdict = decide(facts);
    assert.deepEqual(verdict.unguardedSourceChanges.map(f => f.path), ['lib/endpoint.js']);
    assert.deepEqual(verdict.surfaceOnlyFiles.map(f => f.path), ['dashboard/panel.js']);
  } finally { rmRepo(root); }

  // The forbidden shape, at the source: `%B%x00 --name-only` puts a commit's files in the
  // NEXT record, so every file would be read against the lane of the commit before it.
  assert.doesNotMatch(fs.readFileSync(GATE_SRC, 'utf8'), /%B%x00['"]\s*,\s*['"]--name-only/);
});

test('J-gate-lanes slice-390-ac-5 — with no Lane: trailer anywhere, reconcile, triage and decide answer exactly what they answered before, plus an empty surface lane', () => {
  // The j-ac-reconcile-classifier fixtures, all four statuses, in one manifest.
  const r = reconcile({
    manifest: man({
      'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false },
      'slice-1-ac-2': { acHash: 'sha256:NEW', legacy: false },
      'slice-1-ac-3': { acHash: 'sha256:cc', legacy: false },
      'slice-1-ac-4': { acHash: null, legacy: true },
    }),
    coverage: cov([
      { tag: 'slice-1-ac-1', file: 't', guardAcHash: 'sha256:aa' },
      { tag: 'slice-1-ac-2', file: 't', guardAcHash: 'sha256:OLD' },
      { tag: 'slice-1-ac-4', file: 't' },
    ]),
  });
  assert.deepEqual(r.byTag, {
    'slice-1-ac-1': { status: 'COVERED', legacy: false },
    'slice-1-ac-2': { status: 'STALE', legacy: false },
    'slice-1-ac-3': { status: 'MISSING', legacy: false },
    'slice-1-ac-4': { status: 'LEGACY_UNHASHED', legacy: true },
  });
  assert.deepEqual(r.counts, { COVERED: 1, STALE: 1, MISSING: 1, SURFACE: 0, LEGACY_UNHASHED: 1 });
  assert.equal(r.counts.SURFACE, 0);
  assert.equal(r.workSet, 2);
  assert.equal(r.verdict, 'NEEDS_RECONCILE');

  // triage over that same reconcile — every field of every row, as before.
  const t = triage({ reconcile: { byTag: r.byTag }, manifest: { byTag: {} }, decisions: {} });
  assert.deepEqual(t.items.map(i => [i.tag, i.title, i.status, i.confidence, i.action, i.needsHuman, i.reason]), [
    ['slice-1-ac-3', 'slice-1-ac-3', 'MISSING', 'low', 'decide', true,
      'No test guards this AC. Should it have a permanent regression/smoke test, or is it not worth guarding?'],
    ['slice-1-ac-2', 'slice-1-ac-2', 'STALE', 'high', 'update-test', false,
      'The AC changed but its test did not \u2014 update the test to match the new AC.'],
    ['slice-1-ac-1', 'slice-1-ac-1', 'COVERED', 'high', 'pass', false,
      'Already tested \u2014 a guard\u2019s @ac-hash matches this AC.'],
  ]);
  assert.deepEqual(t.summary, { checked: 3, passed: 1, autoUpdate: 1, flagged: 1, kept: 0 });
  assert.equal(t.ready, false);
  assert.equal(t.verdict, 'NEEDS_YOU');

  // decide over the j-tests-needed-verdict fixtures — the full return, field for field.
  const unchanged = {
    checks: [], loosenedUndeclared: [], removedUndeclared: [], skippedUndeclared: [],
    overridden: [], mismatchedOverride: false, coverageShrink: false,
    coverageShrinkUndeclared: false, coverageRemovalOverridden: false, coverageRemovals: [],
    coverageGuardCount: null, coverageGuardCountBase: null, rejectedTrailers: [],
    coverageMapPresent: false, acMutated: [], acRetired: [], acMutatedUndeclared: [],
    acRetiredUndeclared: [], acOverridden: [], acEnforce: false, surfaceOnlyFiles: [],
  };
  assert.deepEqual(decide({ behaviourFiles: [bfile('dashboard/server.js')], checks: [], trailers: noTrailers() }), {
    decision: 'needs_review',
    behaviourFiles: [{ path: 'dashboard/server.js', area: 'ui', isNew: false }],
    newBehaviourNoTest: [],
    unguardedSourceChanges: [{ path: 'dashboard/server.js', area: 'ui', isNew: false }],
    ...unchanged,
  });
  assert.deepEqual(decide({ behaviourFiles: [bfile('scripts/new-thing.js', true)], checks: [], trailers: noTrailers() }), {
    decision: 'red_flag',
    behaviourFiles: [{ path: 'scripts/new-thing.js', area: 'server', isNew: true }],
    newBehaviourNoTest: [{ path: 'scripts/new-thing.js', area: 'server', isNew: true }],
    unguardedSourceChanges: [{ path: 'scripts/new-thing.js', area: 'server', isNew: true }],
    ...unchanged,
  });
});

// ── traps ───────────────────────────────────────────────────────────────────

test('J-gate-lanes \u2014 trap 1: a core criterion and a core commit gain the two new fields and nothing else', () => {
  // The shape, not just the values: a field nobody asked for is how a pure function that
  // three callers deep-equal starts failing guards that have nothing to do with this slice.
  const r = reconcile({
    manifest: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false } }),
    coverage: cov([{ tag: 'slice-1-ac-1', file: 't', guardAcHash: 'sha256:aa' }]),
  });
  assert.deepEqual(Object.keys(r).sort(), ['byTag', 'counts', 'verdict', 'workSet']);
  assert.deepEqual(Object.keys(r.counts).sort(), ['COVERED', 'LEGACY_UNHASHED', 'MISSING', 'STALE', 'SURFACE']);
  assert.deepEqual(Object.keys(r.byTag['slice-1-ac-1']).sort(), ['legacy', 'status'],
    'the lane belongs to the manifest entry, not to the reconcile row');

  const t = triage({ reconcile: { byTag: r.byTag }, manifest: { byTag: {} }, decisions: {} });
  assert.deepEqual(Object.keys(t).sort(), ['flagged', 'items', 'ready', 'summary', 'verdict']);
  assert.deepEqual(Object.keys(t.items[0]).sort(), ['action', 'confidence', 'needsHuman', 'reason', 'status', 'tag', 'title']);
  assert.deepEqual(Object.keys(t.summary).sort(), ['autoUpdate', 'checked', 'flagged', 'kept', 'passed']);

  const d = decide({ behaviourFiles: [bfile('dashboard/server.js')], checks: [], trailers: noTrailers() });
  assert.deepEqual(Object.keys(d).sort(), [
    'acEnforce', 'acMutated', 'acMutatedUndeclared', 'acOverridden', 'acRetired', 'acRetiredUndeclared',
    'behaviourFiles', 'checks', 'coverageGuardCount', 'coverageGuardCountBase', 'coverageMapPresent',
    'coverageRemovalOverridden', 'coverageRemovals', 'coverageShrink', 'coverageShrinkUndeclared',
    'decision', 'loosenedUndeclared', 'mismatchedOverride', 'newBehaviourNoTest', 'overridden', 'rejectedTrailers',
    'removedUndeclared', 'skippedUndeclared', 'surfaceOnlyFiles', 'unguardedSourceChanges',
  ]);
  assert.deepEqual(d.surfaceOnlyFiles, []);

  // A real range of core commits: nothing is excused, and the verdict is the old verdict.
  const root = repoWithCommits([
    { body: 'S900: fix the endpoint\n\nSlice-Id: 900\nLane: core\n', files: { 'lib/endpoint.js': 'v2\n' } },
    { body: 'S901: a slice from before lanes existed\n', files: { 'dashboard/panel.js': 'v2\n' } },
  ]);
  try {
    const facts = gather({ base: 'main', head: 'dev', repoRoot: root });
    assert.deepEqual(facts.surfaceOnlyFiles, []);
    assert.deepEqual(decide(facts).unguardedSourceChanges.map(f => f.path).sort(), ['dashboard/panel.js', 'lib/endpoint.js']);
  } finally { rmRepo(root); }
});

test('J-gate-lanes \u2014 trap 2: the criterion the lane excuses from a test is still ratcheted when its text changes', () => {
  // The two halves belong in one test because the danger is exactly their conjunction:
  // excused from a guard AND unratcheted is an acceptance criterion anyone can rewrite.
  const entry = { acHash: acHashOf('the panel header reads DEVOPS STATION'), legacy: false, lane: 'surface' };

  // Half one — this criterion owes no test. Nothing in the gate asks for one.
  const r = reconcile({ manifest: man({ 'slice-1-ac-1': entry }), coverage: cov([]) });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'SURFACE');
  assert.equal(r.workSet, 0);
  assert.equal(triage({ reconcile: { byTag: r.byTag }, manifest: { byTag: {} }, decisions: {} }).ready, true);

  // Half two — and its TEXT is still immutable without the spec owner's signature.
  const facts = (trailers) => ({
    behaviourFiles: [], checks: [], trailers: trailers || noTrailers(), acEnforce: true,
    acManifest: {
      base: man({ 'slice-1-ac-1': entry }),
      head: man({ 'slice-1-ac-1': { ...entry, acHash: acHashOf('the panel header reads OPS') } }),
    },
  });
  const edited = decide(facts());
  assert.deepEqual(edited.acMutatedUndeclared, ['slice-1-ac-1'], 'a surface AC is still a spec — editing its text is still a mutation');
  assert.equal(edited.decision, 'red_flag');

  const { parseTrailers } = require(GATE_SRC);
  const authorised = decide(facts(parseTrailers(['AC-Change-OK: slice-1-ac-1 mutated the wording was wrong\nSpec-Owner: Philipp'])));
  assert.deepEqual(authorised.acOverridden, ['slice-1-ac-1']);
  assert.equal(authorised.decision, 'overridden');

  // …and AC-Change-OK without the co-signature clears nothing, lane or no lane.
  const unsigned = decide(facts(parseTrailers(['AC-Change-OK: slice-1-ac-1 mutated no owner named'])));
  assert.deepEqual(unsigned.acMutatedUndeclared, ['slice-1-ac-1']);
  assert.equal(unsigned.decision, 'red_flag');

  // A surface criterion whose guard drifted is STALE — the lane excuses an ABSENT guard,
  // never a guard that no longer matches the criterion it claims to cover.
  const drifted = reconcile({
    manifest: man({ 'slice-1-ac-1': { acHash: 'sha256:NEW', legacy: false, lane: 'surface' } }),
    coverage: cov([{ tag: 'slice-1-ac-1', file: 't', guardAcHash: 'sha256:OLD' }]),
  });
  assert.equal(drifted.byTag['slice-1-ac-1'].status, 'STALE');
  assert.equal(drifted.workSet, 1);
});

test('J-gate-lanes \u2014 trap 3: one body with no separator still parses, and the callers still feed the scan oldest-first', () => {
  // Every existing caller hands parseAcTrailers a single concatenated body. It stays ONE
  // record: last-in-body wins, which is the amendment contract j-ac-amend-order depends on.
  const m = parseAcTrailers('random line\nAC: slice-1-ac-1: first wording\nmore prose\nAC: slice-1-ac-1: amended wording');
  assert.equal(Object.keys(m.byTag).length, 1);
  assert.equal(m.byTag['slice-1-ac-1'].text, 'amended wording');
  assert.equal(m.byTag['slice-1-ac-1'].lane, null, 'a body that names no lane names no lane');

  // The same, oldest-first across records: the newest declaration still wins, and it brings
  // its own lane with it rather than the lane of the commit that declared the old text.
  const amended = parseAcTrailers(
    rec('S1: first', '', 'Lane: core', 'AC: slice-1-ac-1: OLD original text')
    + rec('S1b: amend', '', 'Lane: surface', 'AC: slice-1-ac-1: NEW amended text')
  );
  assert.equal(amended.byTag['slice-1-ac-1'].text, 'NEW amended text');
  assert.equal(amended.byTag['slice-1-ac-1'].lane, 'surface');

  // The live caller keeps the argv spelling j-ac-amend-order pins, and now carries the
  // separator too — dropping either one reopens a false green.
  const server = fs.readFileSync(SERVER_SRC, 'utf8');
  assert.match(server, /'log',\s*range,\s*'--reverse'/, 'the gate scan git-log must still carry --reverse');
  assert.match(server, /'log',\s*range,\s*'--reverse',\s*'--format=%B%x00'/);

  // The scanner splits records on the NUL itself; without that there are no per-commit
  // boundaries to read a lane from.
  assert.match(fs.readFileSync(RANGE_SCAN_SRC, 'utf8'), /split\('\\0'\)/);
});

test('J-gate-lanes \u2014 trap 4: a SURFACE criterion can never reach the overlay as a row to decide', () => {
  // Only MISSING asks the operator anything. If SURFACE ever joined it, the operator would
  // face a card whose question the lane has already answered — the dead end of 2026-09-01.
  const asks = ['COVERED', 'STALE', 'MISSING', 'SURFACE', 'LEGACY_UNHASHED']
    .filter(s => triageTag('slice-1-ac-1', s, null, undefined).needsHuman);
  assert.deepEqual(asks, ['MISSING']);
  assert.notEqual(triageTag('slice-1-ac-1', 'SURFACE', null, undefined).action, 'decide');

  const r = triage({
    reconcile: { byTag: { 'slice-1-ac-1': { status: 'SURFACE' }, 'slice-1-ac-2': { status: 'MISSING' } } },
    manifest: { byTag: {} }, decisions: {},
  });
  assert.deepEqual(r.flagged.map(i => i.tag), ['slice-1-ac-2'], 'the flagged set is what the overlay renders');
  assert.equal(r.summary.checked - r.flagged.length, 1, 'the surface AC is counted among the handled, not listed');

  // The overlay renders `flagged` and counts the rest — so passing SURFACE is all it takes.
  const dash = fs.readFileSync(path.resolve(REPO_ROOT, 'dashboard', 'lcars-dashboard.html'), 'utf8');
  assert.match(dash, /const flagged = rep\.flagged/);
  assert.match(dash, /for \(const it of flagged\)/);
  assert.match(dash, /already covered or handled automatically/i);
});

test('J-gate-lanes \u2014 trap 5: a lane reaches only its own commit\u2019s criteria and its own commit\u2019s files', () => {
  // Two commits, two lanes, one range: ac-1 is excused, ac-2 is not.
  const split = parseAcTrailers(
    rec('S1: a screen change', '', 'Lane: surface', 'AC: slice-1-ac-1: the header reads DEVOPS STATION')
    + rec('S2: a behaviour change', '', 'Lane: core', 'AC: slice-2-ac-1: the endpoint returns 404')
  ).byTag;
  const r = reconcile({ manifest: man(split), coverage: cov([]) });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'SURFACE');
  assert.equal(r.byTag['slice-2-ac-1'].status, 'MISSING');

  // The same two bodies concatenated — one record with two lanes. There is no honest way to
  // say which criterion belongs to which, so both read core and the core criterion keeps
  // owing its test. Relabelling ac-2 would be a false green built out of punctuation.
  const merged = parseAcTrailers(
    'S1: a screen change\n\nLane: surface\nAC: slice-1-ac-1: the header reads DEVOPS STATION\n'
    + 'S2: a behaviour change\n\nLane: core\nAC: slice-2-ac-1: the endpoint returns 404\n'
  ).byTag;
  assert.equal(merged['slice-2-ac-1'].lane, 'core');
  assert.equal(merged['slice-1-ac-1'].lane, 'core');
  assert.equal(reconcile({ manifest: man(merged), coverage: cov([]) }).byTag['slice-2-ac-1'].status, 'MISSING');
  assert.equal(laneOfCommitBody('Lane: surface\nLane: core'), 'core');

  // A file touched by BOTH lanes is policed, in either order — one core commit is enough.
  for (const order of [['surface', 'core'], ['core', 'surface']]) {
    const root = repoWithCommits([
      { body: `S1: first\n\nLane: ${order[0]}\n`, files: { 'dashboard/shared.js': 'v2\n' } },
      { body: `S2: second\n\nLane: ${order[1]}\n`, files: { 'dashboard/shared.js': 'v3\n' } },
    ]);
    try {
      assert.deepEqual(gather({ base: 'main', head: 'dev', repoRoot: root }).surfaceOnlyFiles, [],
        `${order.join(' then ')}: one core commit on a file keeps the file policed`);
    } finally { rmRepo(root); }
  }

  // A merge commit lists no files of its own, so its lane excuses nothing: the file under it
  // is attributed to the core commit that actually wrote it, and stays policed.
  const merge = repoWithCommits([
    { body: 'S1: the work\n\nLane: core\n', files: { 'dashboard/worked.js': 'v2\n' } },
    { branch: 'new', name: 'feature' },
    { body: 'S2: a screen change\n\nLane: surface\n', files: { 'dashboard/screen.js': 'v2\n' } },
    { branch: 'checkout', name: 'dev' },
    { merge: 'feature', body: 'Merge feature\n\nLane: surface\n' },
  ]);
  try {
    const facts = gather({ base: 'main', head: 'dev', repoRoot: merge });
    assert.deepEqual(facts.surfaceOnlyFiles, ['dashboard/screen.js']);
    assert.ok(decide(facts).unguardedSourceChanges.some(f => f.path === 'dashboard/worked.js'),
      'a file with no attributed surface commit is policed exactly as today');
  } finally { rmRepo(merge); }

  // A base entry that predates the lane (no field at all) against a surface head entry is a
  // mutation: absent reads core, so the flip still needs the spec owner's signature.
  const flipped = decide({
    behaviourFiles: [], checks: [], trailers: noTrailers(), acEnforce: true,
    acManifest: {
      base: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false } }),
      head: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false, lane: 'surface' } }),
    },
  });
  assert.deepEqual(flipped.acMutatedUndeclared, ['slice-1-ac-1']);
});

'use strict';
// J-coverage-run-and-require — slice 410: the merge gate sees a test that RUNS a file or
// LOADS it, not only one that reads it.
//
// Promote 36190555313 went RED FLAG on three files that were under test. The coverage
// deriver credited exactly one shape of proof — readFileSync(<static path>) — so an
// install script a test RUNS through bash, a plist a test hands to plutil, and a module a
// test REQUIRES all read as "new behaviour, no test". Alex cleared it by hand with a
// Tests-Not-Needed trailer on dev (659bc18). This suite is why that never has to happen
// again, and the fence around the widening: coverage is still not transitive, still not
// dynamic, and still only over BEHAVIOUR files.
//
// The fixture bodies below are assembled through ${…} rather than written out, on purpose.
// The deriver scans THIS file too: a fixture written literally would make this test a
// guard of every path its fixtures name, and would put files that exist only inside a
// tmpdir into the real COVERAGE.lock.
//
// @ac-hash: slice-410-ac-1 sha256:f56001266f1b077e73af36ec57a647fb0e7576b74fce141775d7ef7ab331dd76
// @ac-hash: slice-410-ac-2 sha256:a0954df23f6960092106d35e2f43c7b8eced2289b8ef0b46e4d45115dba228c3
// @ac-hash: slice-410-ac-3 sha256:598c7867a6ba3428c99c4fba8a2c23693213ca2931f83c6508ac610d277fdb43
// @ac-hash: slice-410-ac-4 sha256:04043cdb663b8959ad0515b83d364489de0f497ab4c11713ebfd0d6138c9864e
// @ac-hash: slice-410-ac-6 sha256:9ca2c52b3f73af95481f45f0f55c2b63ba8051877a840415b983a6be87a00a74
// @ac-hash: slice-410-ac-7 sha256:dff76d9cac9ea434fa4c88405c18c796385b7e2e9398ac22b6efa1a9819e9bc2

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildCoverageMap, serialize, walkTests } = require('../../scripts/build-coverage-map');
const { gather, decide, bucketOf } = require('../../lib/tests-needed');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOCK_PATH = path.resolve(__dirname, '..', 'COVERAGE.lock');

// The failing promote, pinned: base and head exactly as run 36190555313 classified them.
const FAILED_BASE = '9a8e46a';
const FAILED_HEAD = '24e6891';

// A fixture tag in the reserved 99xxx band — never a real slice, so nothing written here
// can be mistaken for coverage of real work.
const FIX_TAG = 'slice-99410-ac-1';
const FIX_REL = 'regression/area/j-fixture-410.test.js';

// ── fixture assembly (see the note at the top of this file) ──────────────────
const REPO_CONST = "path.resolve(__dirname, '..', '..')";
const under = (...seg) => 'path.join(ROOT, ' + seg.map(x => JSON.stringify(x)).join(', ') + ')';
const joinIn = (base, ...seg) => 'path.join(' + base + ', ' + seg.map(x => JSON.stringify(x)).join(', ') + ')';
const pathConst = (name, ...seg) => 'const ' + name + ' = ' + under(...seg) + ';';
const runs = (fn, cmd, argv, opts) => fn + '(' + cmd + ', [' + argv.join(', ') + ']' + (opts ? ', ' + opts : '') + ');';
const loads = (spec) => 'require(' + JSON.stringify(spec) + ');';
const loadsConst = (name) => 'require(' + name + ');';

const FIX_HEAD = [
  "'use strict';",
  "const { test } = require('node:test');",
  "const fs = require('fs');",
  "const path = require('path');",
  'const ROOT = ' + REPO_CONST + ';',
];
// One template literal, not a concatenation. The slice-316-ac-9 tag scanner reads every
// regression source for a test-call opener followed straight away by a quote, and takes
// what comes next for a test name. When this line built the opener as its own string
// chunk, the quote closing that chunk was the quote the scanner wanted, and the join that
// followed read as the name of a test that does not exist. Nothing here opens a quote
// right after the opener, so there is nothing for the scanner to take. Same bytes out —
// slice-411-ac-3 pins them.
const tagged = (tag) => `test(${JSON.stringify(`J-fixture ${tag || FIX_TAG} the behaviour holds`)}, () => {});`;

const roots = [];
after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (_) {} } });

// A throwaway repo root holding one tagged regression test, and the derived map over it.
// bucketOf() classifies a source by its PATH, so the files the fixture names need not
// exist — which is the same reason lib/apply-draft.js can derive against a suite-only mirror.
function derive(lines, rel) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-run-require-'));
  roots.push(root);
  const at = rel || FIX_REL;
  const abs = path.join(root, at);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, lines.join('\n') + '\n');
  return { root, rel: at, map: buildCoverageMap(root), write: (r, text) => {
    const a = path.join(root, r);
    fs.mkdirSync(path.dirname(a), { recursive: true });
    fs.writeFileSync(a, text);
  } };
}

const tagsOf = (map, source) => (map.bySource[source] || []).map(g => g.tag);
const filesOf = (map, source) => (map.bySource[source] || []).map(g => g.file);

// ── AC-1 — a file the test RUNS ─────────────────────────────────────────────

test('slice-410-ac-1 a static repo path run as the command or as an argument-array element of spawn, spawnSync, execFile or execFileSync becomes a guarded source', () => {
  const d = derive([
    ...FIX_HEAD,
    pathConst('SH', 'scripts', 'fixture-410-install.sh'),
    pathConst('PLIST', 'scripts', 'fixture-410.plist'),
    pathConst('CMD', 'bridge', 'fixture-410-cmd.js'),
    pathConst('SCRIPT', 'lib', 'fixture-410-run.js'),
    pathConst('NEVER', 'scripts', 'fixture-410-untouched.sh'),
    runs('spawnSync', "'bash'", ['SH'], "{ encoding: 'utf8' }"),
    runs('execFileSync', "'/usr/bin/plutil'", ["'-lint'", 'PLIST'], "{ encoding: 'utf8' }"),
    runs('execFile', 'CMD', [], '() => {}'),
    runs('spawn', "'node'", ['SCRIPT']),
    // Neither the cwd nor the env is a file under test.
    runs('spawnSync', "'true'", [], '{ cwd: ROOT, env: { SOMETHING: NEVER } }'),
    tagged(),
  ]);

  for (const source of [
    'scripts/fixture-410-install.sh',   // argument-array element of spawnSync
    'scripts/fixture-410.plist',        // argument-array element of execFileSync
    'bridge/fixture-410-cmd.js',        // the command of execFile
    'lib/fixture-410-run.js',           // argument-array element of spawn
  ]) {
    assert.deepEqual(tagsOf(d.map, source), [FIX_TAG], source + ' is guarded by the running test file\'s tags');
    assert.deepEqual(filesOf(d.map, source), [d.rel]);
  }
  assert.equal(d.map.bySource['scripts/fixture-410-untouched.sh'], undefined,
    'a path that is only an option — a cwd, an env value — is not a file the test ran');

  // And the two files the failed promote flagged, in the repo as it stands: the install
  // script is run by spawnSync('bash', [INSTALL_SH]) and the plist is linted by
  // execFileSync('/usr/bin/plutil', ['-lint', PLIST_SRC]), both in j-dashboard-service.
  const live = buildCoverageMap(REPO_ROOT);
  const GUARD = 'regression/recovery/j-dashboard-service.test.js';
  for (const source of ['scripts/install-dashboard-service.sh', 'scripts/dev.denorios.dashboard.plist']) {
    const mine = (live.bySource[source] || []).filter(g => g.file === GUARD).map(g => g.tag);
    assert.deepEqual(mine, ['slice-403-ac-1', 'slice-403-ac-2', 'slice-403-ac-3'],
      source + ' must list the slice-403 tags of the test that runs it');
  }
});

// ── AC-2 — a file the test LOADS ────────────────────────────────────────────

test('slice-410-ac-2 a BEHAVIOUR file loaded with require() of a static relative path, with or without the .js, or of a static path const, becomes a guarded source', () => {
  const d = derive([
    ...FIX_HEAD,
    pathConst('LIB', 'lib', 'fixture-410-const.js'),
    loadsConst('LIB'),
    loads('../../lib/fixture-410-with-ext.js'),
    loads('../../bridge/fixture-410-no-ext'),
    tagged(),
  ]);

  assert.deepEqual(tagsOf(d.map, 'lib/fixture-410-const.js'), [FIX_TAG], 'require(<path const>)');
  assert.deepEqual(tagsOf(d.map, 'lib/fixture-410-with-ext.js'), [FIX_TAG],
    'a relative specifier that spells out the .js');
  assert.deepEqual(tagsOf(d.map, 'bridge/fixture-410-no-ext.js'), [FIX_TAG],
    'a specifier with no extension names the .js file Node would load, which is the file the bucket map can read');

  // In the repo as it stands: the streaming helper is loaded, never read, by its own suite.
  const live = buildCoverageMap(REPO_ROOT);
  const GUARD = 'regression/dispatch-execution/j-session-streamed.test.js';
  const mine = (live.bySource['lib/session-stream.js'] || []).filter(g => g.file === GUARD).map(g => g.tag);
  assert.ok(mine.includes('slice-396-ac-1'),
    'j-session-streamed requires lib/session-stream.js and must now guard it');
  assert.ok(mine.includes('slice-410-ac-5'), 'including the guard this slice adds');
});

// ── AC-3 — coverage is not transitive ───────────────────────────────────────

test('slice-410-ac-3 a file reached only through another file\'s require() is not credited', () => {
  const d = derive([
    ...FIX_HEAD,
    loads('../../bridge/fixture-410-orch.js'),
    tagged(),
  ]);
  // The loaded module loads a third file. That is the module's business, not the test's.
  d.write('bridge/fixture-410-orch.js', "'use strict';\n" + loads('../lib/fixture-410-deep.js') + '\n');
  const map = buildCoverageMap(d.root);

  assert.deepEqual(tagsOf(map, 'bridge/fixture-410-orch.js'), [FIX_TAG], 'the file the TEST loads is guarded');
  assert.equal(map.bySource['lib/fixture-410-deep.js'], undefined,
    'the file that file loads is not: a test that loads the orchestrator has not tested what the orchestrator loads');

  // In the repo as it stands: bridge/orchestrator.js requires lib/session-stream.js, and a
  // good many suites require the orchestrator. Not one of them guards the helper.
  const live = buildCoverageMap(REPO_ROOT);
  const guards = new Set(filesOf(live, 'lib/session-stream.js'));
  const orchOnly = walkTests(REPO_ROOT).filter(rel => {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    return /require\(\s*['"]\.\.?\/[^'"]*bridge\/orchestrator(\.js)?['"]\s*\)/.test(src) && !src.includes('session-stream');
  });
  assert.ok(orchOnly.length > 0, 'the repo really does hold suites that load the orchestrator');
  assert.deepEqual(orchOnly.filter(f => guards.has(f)), [],
    'a test that requires only bridge/orchestrator.js never appears in bySource of lib/session-stream.js');
});

// ── AC-4 — what stays uncredited ────────────────────────────────────────────

test('slice-410-ac-4 a path that cannot be resolved statically, a path outside the repo and a file that is not BEHAVIOUR are still not credited', () => {
  const d = derive([
    ...FIX_HEAD,
    // 1 — built from a temp directory
    "const TMP = fs.mkdtempSync('/tmp/fixture-410-');",
    runs('spawnSync', "'bash'", [joinIn('TMP', 'x.sh')]),
    // 2 — a function parameter
    'function run(p) { return ' + runs('spawnSync', "'bash'", ['p'], "{ encoding: 'utf8' }") + ' }',
    // 3 — a variable that is not path.resolve/join of a known base
    'const OTHER = process.env.SOMEWHERE_ELSE;',
    loadsConst('OTHER'),
    runs('spawnSync', "'bash'", ['OTHER']),
    // 4 — outside the repo
    'const OUT = ' + joinIn('ROOT', '..', 'outside-410', 'x.js') + ';',
    loadsConst('OUT'),
    runs('spawnSync', "'node'", ['OUT']),
    // 5 — resolvable, in the repo, and not a BEHAVIOUR file
    pathConst('DOC', 'docs', 'fixture-410.sh'),
    runs('spawnSync', "'bash'", ['DOC']),
    loads('../helpers/fixture-410-helper.js'),
    tagged(),
  ]);

  assert.deepEqual(Object.keys(d.map.bySource), [],
    'not one of those five shapes may become a source');
  assert.equal(d.map.guardCount, 0);
  // Why 5 is out: the bucket map, not this test, decides what is behaviour.
  assert.equal(bucketOf('docs/fixture-410.sh'), 'INERT');
  assert.equal(bucketOf('regression/helpers/fixture-410-helper.js'), 'TEST');

  // The control: the same file, with one statically resolvable BEHAVIOUR path added, does
  // register — so the empty map above is the resolver refusing, not the fixture misfiring.
  const ok = derive([
    ...FIX_HEAD,
    pathConst('REAL', 'lib', 'fixture-410-real.js'),
    runs('spawnSync', "'node'", ['REAL']),
    tagged(),
  ]);
  assert.deepEqual(tagsOf(ok.map, 'lib/fixture-410-real.js'), [FIX_TAG]);
});

// ── trap 1 — a package name is not a path ───────────────────────────────────

test('J-coverage-run-and-require — trap 1: a package specifier never becomes a source, and never throws on the way', () => {
  // The fixture names six packages and one repo file, in one file, interleaved. Only the
  // repo file may come out — which is also what stops this trap passing vacuously.
  const d = derive([
    ...FIX_HEAD,
    loads('node:fs'),
    loads('node:child_process'),
    loads('@playwright/test'),
    loads('../../lib/fixture-410-among-packages.js'),
    loads('fs'),
    loads('crypto'),
    loads('@scope/name/deep'),
    loads('./fixture-410-sibling'),
    tagged(),
  ]);

  assert.deepEqual(Object.keys(d.map.bySource), ['lib/fixture-410-among-packages.js'],
    'the one relative specifier resolves; the six package names do not, and the sibling is a TEST file');
  assert.deepEqual(tagsOf(d.map, 'lib/fixture-410-among-packages.js'), [FIX_TAG]);
  for (const key of Object.keys(d.map.bySource)) {
    assert.ok(!/^(@|node:)/.test(key) && !/^(fs|crypto)(\.js)?$/.test(key), key + ' is a package, not a source');
  }
  // The whole live suite is full of package requires — deriving over it must not throw.
  assert.doesNotThrow(() => buildCoverageMap(REPO_ROOT));
  const live = buildCoverageMap(REPO_ROOT);
  const bad = Object.keys(live.bySource).filter(k => /^(@|node:)/.test(k) || !k.includes('/'));
  assert.deepEqual(bad, [], 'no package specifier reached the live map');
  // Nothing invented either — not restated here, because J-apply-draft slice-358-trap-4
  // already asserts every key in the live map is a file on disk. Widening the deriver
  // widens what a comment or an assertion message can accidentally name, so that guard
  // now does more work than it did; it is why the fixtures above are interpolated.
});

// ── AC-6 — nothing already counted is lost ──────────────────────────────────

test('slice-410-ac-6 every source and guard the lock listed before this slice is still listed, and two regenerations are byte-identical', () => {
  const committed = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  const fresh = buildCoverageMap(REPO_ROOT);

  const lost = [];
  for (const source of Object.keys(committed.bySource)) {
    const have = new Set((fresh.bySource[source] || []).map(g => g.tag + '|' + g.file));
    for (const g of committed.bySource[source]) {
      if (!have.has(g.tag + '|' + g.file)) lost.push(source + ' ← ' + g.tag + ' (' + g.file + ')');
    }
  }
  assert.deepEqual(lost, [], 'widening what counts as a guard may only ADD; these entries went missing');
  assert.ok(fresh.guardCount >= committed.guardCount, 'and the ratchet currency may not fall');

  assert.equal(serialize(buildCoverageMap(REPO_ROOT)), serialize(buildCoverageMap(REPO_ROOT)),
    'regenerating the lock twice must give byte-identical files');
});

// ── AC-7 — the promote that failed ──────────────────────────────────────────

test('slice-410-ac-7 the range of the failed promote 36190555313 no longer lists the two tested files under new behaviour, no test', () => {
  const rev = (r) => execFileSync('git', ['rev-parse', '--verify', r + '^{commit}'],
    { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  let base, tip;
  try { base = rev(FAILED_BASE); tip = rev(FAILED_HEAD); } catch (e) {
    assert.fail('the pinned commits of run 36190555313 are not in this checkout (needs full history): ' + e.message);
  }

  const facts = gather({ base, head: tip, repoRoot: REPO_ROOT });
  const changed = facts.behaviourFiles.map(f => f.path);
  assert.ok(changed.includes('scripts/install-dashboard-service.sh')
    && changed.includes('scripts/dev.denorios.dashboard.plist'),
    'the range really is the one that flagged those two files');

  // gather() reads the COMMITTED lock; the criterion is about the map THIS slice derives,
  // which is what the pipeline writes into the commit that lands it.
  facts.covMap = buildCoverageMap(REPO_ROOT);
  const flagged = decide(facts).newBehaviourNoTest.map(f => f.path);

  assert.ok(!flagged.includes('scripts/install-dashboard-service.sh'),
    'the install script is run by a test, so it is not new behaviour without a test');
  assert.ok(!flagged.includes('scripts/dev.denorios.dashboard.plist'),
    'the plist is linted by a test, so it is not new behaviour without a test');
});

// ── AC-3 (slice 411) — the fixture assembly is not itself a test name ───────
//
// The helper above used to build the fixture by concatenating a chunk that ended in a
// test-call opener. The slice-316-ac-9 scanner in j-gate-fail-retry.test.js reads every
// regression source for that opener followed by a quote, so the quote closing the chunk
// handed it a "test name" made of the join that came next — an untagged name for a test
// that has never existed, and a red merge gate nobody can clear by fixing a test. This
// guard keeps the assembly out of the scanner's way without letting the fixture bytes move.

// @ac-hash: slice-411-ac-3 sha256:540c135fb02ca94a557a8dd992d10831cdbd116dfea801cef43941697932d3fa
test('slice-411-ac-3 no string in this file reads to the slice-316-ac-9 scanner as an untagged test name, and the fixture bytes are the ones slice 410 verified', () => {
  // Byte-for-byte, the fixture line every derive() above feeds the deriver. Written out
  // here, not built from the helper, so a helper that starts emitting something else is
  // caught rather than agreed with.
  assert.equal(tagged(), `test("J-fixture ${FIX_TAG} the behaviour holds", () => {});`);
  assert.equal(tagged('slice-99411-ac-2'), 'test("J-fixture slice-99411-ac-2 the behaviour holds", () => {});');

  // The scanner of j-gate-fail-retry.test.js slice-316-ac-9, over this file alone. Copied
  // rather than imported: requiring that file here would register its whole suite inside
  // this one. It must stay in step with the original, which this slice may not touch.
  const nameRe = /\btest(?:\.skip)?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const isTagged = name =>
    /slice-\d+-ac-\d+/.test(name) ||
    /(?:^|[^\w-])J-[A-Za-z0-9]/.test(name) ||
    /journey-/.test(name);

  const names = [...fs.readFileSync(__filename, 'utf8').matchAll(nameRe)].map(m => m[2]);
  assert.ok(names.length >= 7, 'sanity: the names the scanner reads out of this file were found');
  assert.deepEqual(names.filter(n => !isTagged(n)), [],
    'a string in this file reads as an untagged test name, which reds the merge gate over a test that does not exist');
});

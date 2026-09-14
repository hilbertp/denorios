'use strict';

/**
 * Journey: J-apply-draft (Tier 1 — in-process, throwaway fixture repos)
 * Category: Gate & Merge
 *
 * Slice 358. Slice 356 made Julian's drafts readable and slice 357 made them applicable by
 * construction; this is the step that actually moves one into the suite. The bar is not
 * "there is a button": it is that the only ways an AC leaves the flagged list are (a) a
 * real guard now covers it, or (b) a human knowingly says no test is needed.
 *
 *   ac-1  plan then confirm — the plan is computed and shown, and no file is written
 *         until the operator confirms the plan they were shown.
 *   ac-2  a confirmed apply lands the guard at its declared target AND regenerates
 *         COVERAGE.lock, as ONE commit.
 *   ac-3  refused, tree untouched, when the rebuilt map does not carry the AC's tag.
 *   ac-4  refused when the guard is not green where it lands, or when applying would
 *         drop the read-corroborated guard count.
 *   ac-5  the apply never writes an AC decision record and never modifies an AC.
 *   ac-6  after a successful apply the AC reconciles as COVERED and stops being flagged,
 *         and the overlay reads that from the server rather than assuming it.
 *   trap1 AC-DECISIONS.json is a permanent, unprovenanced un-flag. This path shares no
 *         code with it and stamps every write with how it was authorized.
 *   trap2 a passing test is not a counted test — green is not sufficient evidence.
 *   trap3 never touch an acceptance criterion: the apply moves exactly two files.
 *   trap4 regenerating COVERAGE.lock is gate-visible — the lock must match the tree in
 *         the same commit, and a lock already out of date refuses rather than sweeping.
 *   trap5 a guard lands under regression/ or e2e/ and nowhere else, and nothing is ever
 *         written back into regression/.drafts/.
 *
 * Every fixture is its own git repo in a tmpdir, so nothing here can write to this one.
 * Fixture AC tags live in the reserved 99xxx range and are never named in a test() title,
 * so the coverage deriver cannot mistake one for real coverage.
 *
 * // @ac-hash: slice-358-ac-1 sha256:66f22d244736375b169b32473dd20f4866ff08df373f311e5976075f403668e1
 * // @ac-hash: slice-358-ac-2 sha256:f14188d7fa140cded16a1e7a9dc015e23a9096064cc87c83f48efbb4127222c2
 * // @ac-hash: slice-358-ac-3 sha256:a0df642d9c558f264dbbea2b545b2a48b0967c469684cf9988249d4c02efa499
 * // @ac-hash: slice-358-ac-4 sha256:90c5e39bffadd3f69abc766d920ecc2658dc24369f978cb4b239d455cca91e35
 * // @ac-hash: slice-358-ac-5 sha256:eaafef3d62adfd8189171dba4175777677afa1b42682a1beb5a10acfd6e8f05c
 * // @ac-hash: slice-358-ac-6 sha256:306ddc815a5129ea773ab4c2e6df83add8d98c4f8ab15cc476b7952a7b0cc29e
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_SRC = path.join(REPO_ROOT, 'dashboard', 'server.js');
const HTML_SRC = path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html');
const APPLY_SRC = path.join(REPO_ROOT, 'lib', 'apply-draft.js');
const SERVER = fs.readFileSync(SERVER_SRC, 'utf8');
const HTML = fs.readFileSync(HTML_SRC, 'utf8');
const APPLY = fs.readFileSync(APPLY_SRC, 'utf8');

const { planApply, applyDraft, touchesAc, scratchRunPathFor, commitMessageFor, LOCK_REL, RUNNERS } =
  require('../../lib/apply-draft');
const { buildCoverageMap, serialize } = require('../../scripts/build-coverage-map');
const { reconcile } = require('../../lib/ac-reconcile');
const { triage } = require('../../lib/check-test-updates');

// Reserved fixture tags — never a real AC, and never written into a test() title here.
const FX = 'slice-99358-ac-1';
const HASH = 'sha256:' + 'ab'.repeat(32);
const OTHER_HASH = 'sha256:' + 'cd'.repeat(32);

const roots = [];
after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (_) {} } });

const git = (root, args) => execFileSync('git', args,
  { cwd: root, encoding: 'utf8', env: { ...process.env, DS9_WATCHER_MERGE: '1' } }).trim();

// The annotation is BUILT, never written literally: a literal one beside a tagged title in
// this file would register the fixture tag as real coverage.
const annotation = (tag, hash) => '// @ac-' + 'hash: ' + tag + ' ' + hash;

// A contract-valid draft: the annotation the deriver parses, beside a tagged test() title.
function draftSource(tag, hash, body) {
  return [
    "'use strict';",
    annotation(tag, hash),
    "const { test } = require('node:test');",
    `test('J-fixture ${tag} — the criterion holds', () => { ${body || ''} });`,
  ].join('\n') + '\n';
}

// A guard the coverage map COUNTS (form 1): it readFileSync's a BEHAVIOUR source, so it
// contributes to guardCount — the anti-shrink ratchet's currency.
//
// Its two load-bearing lines are BUILT, never written literally, for the same reason the
// @ac-hash annotation above is: the coverage deriver is a regex text scanner with no notion
// of string nesting (CONST_RE / READ_CONST_RE in scripts/build-coverage-map.js), and it
// does not check that the path it resolves exists. A literal `const SRC = path.join(…
// 'lib', 'thing.js')` beside a literal `readFileSync(SRC)` in THIS file therefore reads out
// of this file and registers lib/thing.js — which exists only inside a tmpdir fixture — as
// a read-corroborated BEHAVIOUR source carrying all six slice-358 tags. Six phantom guards
// go into COVERAGE.lock, and a later rename of this helper then "loses" coverage that never
// existed and demands a Coverage-Removed: trailer for it. What the fixture SAYS must not be
// readable as what this file GUARDS.
function corroboratingGuard(tag, hash) {
  const declare = 'const SRC = path.' + "join(__dirname, '..', '..', 'lib', 'thing.js');";
  const read = 'fs.read' + 'FileSync(SRC);';
  return [
    "'use strict';",
    annotation(tag, hash),
    "const { test } = require('node:test');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    declare,
    `test('J-live ${tag} — reads the real source', () => { ${read} });`,
  ].join('\n') + '\n';
}

/**
 * A throwaway repo: a real git repo, a real (tiny) suite, a COVERAGE.lock in sync with it,
 * and one draft in regression/.drafts/ waiting to be applied.
 */
function fixture(opts) {
  const o = opts || {};
  const tag = o.tag || FX;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-apply-fx-')));
  roots.push(root);
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  w('package.json', '{"name":"apply-fixture"}\n');
  w('lib/thing.js', "module.exports = 1;\n");
  w('regression/area/j-existing.test.js', draftSource('slice-99000-ac-1', OTHER_HASH));
  fs.mkdirSync(path.join(root, 'e2e'), { recursive: true });
  // The provenance stamp must be the real slice-354 one, minted into THIS root's state dir.
  w('bridge/approval-provenance.js',
    `module.exports = require(${JSON.stringify(path.join(REPO_ROOT, 'bridge', 'approval-provenance'))});\n`);
  // The HMAC key exists before the apply runs, exactly as it does in a live installation:
  // whichever process boots first mints it. Pre-seeded so that "the apply moved exactly
  // two files" is measured against a running system, not against first boot.
  w('bridge/state/approval-secret', crypto.randomBytes(32).toString('hex') + '\n');
  fs.chmodSync(path.join(root, 'bridge', 'state', 'approval-secret'), 0o600);
  for (const [rel, body] of Object.entries(o.files || {})) w(rel, body);

  if (o.draft !== null) w(`regression/.drafts/${tag}.draft.${o.ext || 'test.js'}`, o.draft || draftSource(tag, HASH));
  if (o.target) w(`regression/.drafts/${tag}.target.json`, JSON.stringify({ tag, ...o.target }));

  w(LOCK_REL, o.staleLock ? '{\n  "generator": "stale",\n  "guardCount": 0,\n  "bySource": {}\n}\n'
                          : serialize(buildCoverageMap(root)));
  git(root, ['init', '-q', '-b', 'dev']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture suite']);
  return root;
}

// Every tracked-or-not file in the tree, hashed. The point of comparing WHOLE trees rather
// than named files: "the tree is untouched" has to mean untouched, not "the files I thought
// to check are untouched".
function snapshot(root) {
  const out = {};
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full).split(path.sep).join('/')] =
        crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  })(root);
  return out;
}

const codes = (r) => (r.refusals || []).map(x => x.code);
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort();

// ── ac-1 ─────────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-ac-1 — the plan is computed and shown, and nothing is written until the operator confirms it', () => {
  const root = fixture({ target: { new: 'regression/area/j-applied.test.js' } });
  const before = snapshot(root);
  const head = git(root, ['rev-parse', 'HEAD']);

  // Step one: the plan. It says where the guard lands, whether it runs green THERE, and
  // whether the rebuilt map counts it — and it writes nothing.
  const plan = planApply({ repoRoot: root, tag: FX });
  assert.equal(plan.ok, true, `the plan must be appliable: ${JSON.stringify(plan.refusals)}`);
  assert.equal(plan.target.path, 'regression/area/j-applied.test.js');
  assert.equal(plan.target.mode, 'new');
  assert.equal(plan.run.ok, true, 'the plan runs the draft and reports pass/fail');
  assert.equal(plan.coverage.tagInMap, true, 'the plan rebuilds the coverage map and says whether the tag lands in it');
  assert.equal(typeof plan.coverage.guardCount.delta, 'number', 'the plan reports the guardCount delta');
  assert.ok(plan.token, 'the plan is identified, so a confirmation can name the plan it confirms');
  assert.deepEqual(changed(before, snapshot(root)), [], 'planning must not write a single byte');

  // …and the guard is RUN at its landing depth: a guard resolves the repo with
  // path.resolve(__dirname, '..', '..'), so running it anywhere else proves nothing.
  assert.equal(plan.run.at, 'regression/area/.apply-scratch.test.js');
  assert.equal(scratchRunPathFor(root, 'e2e/j-x.spec.js', 'spec.js'), 'e2e/.apply-scratch.spec.js');
  assert.equal(scratchRunPathFor(root, 'regression/nowhere-yet/j-x.test.js', 'test.js'),
    'regression/area/.apply-scratch.test.js', 'a target directory that does not exist yet still runs at the right DEPTH');
  assert.deepEqual(Object.keys(RUNNERS).sort(), ['spec.js', 'test.js'], 'each draft is run by the runner its suite uses');

  // Step two, unconfirmed: no token, no write.
  const unconfirmed = applyDraft({ repoRoot: root, tag: FX, provenance: 'human-click' });
  assert.equal(unconfirmed.ok, false);
  assert.deepEqual(codes(unconfirmed), ['E_NOT_CONFIRMED']);
  assert.deepEqual(changed(before, snapshot(root)), [], 'a refused apply writes nothing');
  assert.equal(git(root, ['rev-parse', 'HEAD']), head, 'and commits nothing');

  // The overlay is the same two steps: a control that fetches the plan, and a confirm
  // control that only exists once the plan came back appliable.
  assert.match(HTML, /onclick="_toggleApply\('\$\{_escAttr\(it\.tag\)\}', this\)"/, 'the drafted card must offer an apply control');
  assert.match(HTML, /uiFetch\('\/api\/check-test-updates\/apply-plan\?tag=' \+ encodeURIComponent\(tag\)/,
    'the control must read the plan first, over the nonce-bearing fetch');
  const render = HTML.slice(HTML.indexOf('function _renderApplyPlan'), HTML.indexOf('async function _confirmApply'));
  assert.match(render, /if \(plan\.ok && plan\.token\) \{/, 'the confirm control exists only for an appliable plan');
  assert.match(render, /go\.onclick = \(\) => _confirmApply\(tag, plan\.token, go\)/, 'confirming names the plan it confirms');
  assert.match(HTML, /body: JSON\.stringify\(\{ tag, plan_token: token \}\)/, 'the confirmation echoes the plan token back');
  assert.match(SERVER, /if \(pathname === '\/api\/check-test-updates\/apply-plan' && req\.method === 'GET'\)/,
    'the plan is a GET — it changes nothing the repo keeps');
  assert.match(SERVER, /if \(pathname === '\/api\/check-test-updates\/apply' && req\.method === 'POST'\)/,
    'the apply is the only POST, and it is a separate call');

  // Both halves are origin-gated. The plan spawns a test runner and blocks this
  // single-threaded server while it runs, so an ungated plan route is a way to stop the
  // dashboard answering, not merely a read.
  for (const route of ['/api/check-test-updates/apply-plan', '/api/check-test-updates/apply']) {
    const at = SERVER.indexOf(`if (pathname === '${route}' && req.method ===`);
    assert.notEqual(at, -1, `${route} must exist`);
    assert.match(SERVER.slice(at, at + 700), /classifyApprovalOrigin\(req\)/,
      `${route} must refuse a request that cannot show it came from the dashboard`);
  }
});

// ── ac-2 ─────────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-ac-2 — a confirmed apply lands the guard and regenerates the coverage lock as one commit', () => {
  const root = fixture({ target: { new: 'regression/area/j-applied.test.js' } });
  const plan = planApply({ repoRoot: root, tag: FX });
  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, true, `the apply must succeed: ${JSON.stringify(out.refusals)}`);

  const target = path.join(root, 'regression', 'area', 'j-applied.test.js');
  assert.equal(fs.readFileSync(target, 'utf8'), plan.draft.source, 'the guard lands at its DECLARED target, byte for byte');

  const lock = fs.readFileSync(path.join(root, LOCK_REL), 'utf8');
  assert.equal(lock, serialize(buildCoverageMap(root)), 'the lock is regenerated from the tree the guard now sits in');

  // ONE commit, carrying BOTH — never the guard now and the lock later.
  const files = git(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean).sort();
  assert.deepEqual(files, [LOCK_REL, 'regression/area/j-applied.test.js'].sort());
  assert.deepEqual(out.commit.files.sort(), files, 'the result names exactly what it committed');
  assert.equal(git(root, ['status', '--porcelain']).trim(), '', 'nothing is left half-applied in the working tree');

  // …stamped with the slice-354 provenance, so the write can say how it was authorized.
  const msg = git(root, ['log', '-1', '--format=%B']);
  assert.match(msg, /^Approval-Provenance: human-click$/m);
  assert.match(msg, /^Approval-Ts: \d{4}-\d{2}-\d{2}T[\d:.]+Z$/m);
  assert.match(msg, /^Approval-Sig: [0-9a-f]{64}$/m);
  assert.match(msg, new RegExp(`^Applied-Draft: ${FX}$`, 'm'));

  // An apply that cannot say who authorized it is not an apply.
  const root2 = fixture({ target: { new: 'regression/area/j-applied.test.js' } });
  const p2 = planApply({ repoRoot: root2, tag: FX });
  for (const bad of ['machine-unknown', 'legacy-unattributed', 'not-a-provenance', undefined]) {
    const r = applyDraft({ repoRoot: root2, tag: FX, planToken: p2.token, provenance: bad });
    assert.equal(r.ok, false, `provenance ${String(bad)} must not be able to apply a guard`);
    assert.deepEqual(codes(r), ['E_NO_PROVENANCE']);
  }
  assert.ok(!fs.existsSync(path.join(root2, 'regression', 'area', 'j-applied.test.js')), 'and writes nothing');
});

// ── ac-3 ─────────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-ac-3 — the apply is refused, tree untouched, when the rebuilt map does not carry the tag', () => {
  // A dot-directory under regression/ is contract-valid as a path but invisible to the
  // coverage walker, so a guard applied there registers nothing at all.
  const root = fixture({ target: { new: 'regression/.quiet/j-uncounted.test.js' } });
  const before = snapshot(root);
  const head = git(root, ['rev-parse', 'HEAD']);

  const plan = planApply({ repoRoot: root, tag: FX });
  assert.equal(plan.coverage.tagInMap, false, 'the rebuilt map does not carry the tag');
  assert.equal(plan.ok, false, 'so the plan is not appliable');
  assert.ok(codes(plan).includes('E_TAG_NOT_IN_MAP'), `expected E_TAG_NOT_IN_MAP, got ${codes(plan)}`);
  assert.match((plan.refusals.find(r => r.code === 'E_TAG_NOT_IN_MAP') || {}).message, /count for nothing|still does not carry/i,
    'and says so in words the operator can act on');

  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, false);
  assert.equal(out.stage, 'plan', 'the refusal happens before anything is written');
  assert.ok(codes(out).includes('E_TAG_NOT_IN_MAP'));
  assert.deepEqual(changed(before, snapshot(root)), [], 'the tree is byte-identical after a refusal');
  assert.equal(git(root, ['rev-parse', 'HEAD']), head, 'and no commit was made');
});

// ── ac-4 ─────────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-ac-4 — the apply is refused when the guard is not green, or when the guard count would fall', () => {
  // (a) not green where it lands.
  const red = fixture({
    draft: draftSource(FX, HASH, "throw new Error('the criterion does not hold');"),
    target: { new: 'regression/area/j-red.test.js' },
  });
  const beforeRed = snapshot(red);
  const redPlan = planApply({ repoRoot: red, tag: FX });
  assert.equal(redPlan.run.ok, false, 'a failing guard must be reported as failing');
  assert.ok(codes(redPlan).includes('E_SUITE_RED'), `expected E_SUITE_RED, got ${codes(redPlan)}`);
  const redOut = applyDraft({ repoRoot: red, tag: FX, planToken: redPlan.token, provenance: 'human-click' });
  assert.equal(redOut.ok, false);
  assert.deepEqual(changed(beforeRed, snapshot(red)), [], 'a red guard is never applied');

  // …and it stays red whoever started the dashboard. node:test sets NODE_TEST_CONTEXT in
  // every test child; a `node --test` that inherits it switches to the child-reporter
  // protocol and EXITS 0 WITH FAILING TESTS — a false green at the one place where green
  // is the entire question.
  const prev = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = 'child-v8';
  try {
    assert.equal(planApply({ repoRoot: red, tag: FX }).run.ok, false,
      'an inherited NODE_TEST_CONTEXT must not turn a failing guard green');
  } finally {
    if (prev === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prev;
  }

  // (b) the rewrite drops the source read that made the old guard count.
  const shrink = fixture({
    files: { 'regression/area/j-live.test.js': corroboratingGuard(FX, HASH) },
    draft: draftSource(FX, HASH),
    target: { replaces: 'regression/area/j-live.test.js' },
  });
  const beforeShrink = snapshot(shrink);
  const plan = planApply({ repoRoot: shrink, tag: FX });
  assert.equal(plan.coverage.guardCount.before, 1, 'the live guard is read-corroborated');
  assert.equal(plan.coverage.guardCount.after, 0, 'the rewrite is not');
  assert.equal(plan.run.ok, true, 'the rewrite is green — green is not the question here');
  assert.equal(plan.coverage.tagInMap, true, 'and the tag is still in the map — that is not the question either');
  assert.ok(codes(plan).includes('E_GUARD_COUNT_FELL'), `expected E_GUARD_COUNT_FELL, got ${codes(plan)}`);
  const out = applyDraft({ repoRoot: shrink, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, false);
  assert.deepEqual(changed(beforeShrink, snapshot(shrink)), [], 'the suite never covers less than it did');

  // (c) "new" naming a guard it does not declare as `replaces` — applying would duplicate it.
  const dup = fixture({
    files: { 'regression/area/j-live.test.js': corroboratingGuard(FX, HASH) },
    target: { new: 'regression/area/j-live.test.js' },
  });
  const dupPlan = planApply({ repoRoot: dup, tag: FX });
  assert.equal(dupPlan.ok, false);
  assert.ok((dupPlan.refusals || []).some(r => /already exists|declare it as "replaces"/.test(r.message)),
    `a "new" target that already exists must be refused: ${JSON.stringify(dupPlan.refusals)}`);
});

// ── ac-5 ─────────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-ac-5 — the apply writes no AC decision record and modifies no acceptance criterion', () => {
  const acFiles = {
    'regression/AC-DECISIONS.json': '{\n "slice-99999-ac-1": "keep"\n}',
    'regression/AC-MANIFEST.lock': '{"byTag":{"slice-99999-ac-1":{"acHash":"sha256:0"}}}\n',
    'regression/AC-DRAINED.json': '{"byTag":{}}\n',
    'docs/contracts/ac-custody.md': '# AC Custody\nReconcile may update a TEST from an AC; never the reverse.\n',
    'bridge/queue/99358-DONE.md': '---\nid: "99358"\n---\n- slice-99358-ac-1: the criterion\n',
  };
  const root = fixture({ files: acFiles, target: { new: 'regression/area/j-applied.test.js' } });
  const before = snapshot(root);

  const plan = planApply({ repoRoot: root, tag: FX });
  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, true, `the apply must succeed: ${JSON.stringify(out.refusals)}`);

  assert.deepEqual(changed(before, snapshot(root)), [LOCK_REL, 'regression/area/j-applied.test.js'].sort(),
    'an apply moves exactly two files — every AC file is byte-identical afterwards');
  for (const rel of Object.keys(acFiles)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), acFiles[rel], `${rel} must be untouched`);
  }

  // The rule itself, not just this run of it.
  assert.equal(touchesAc('regression/AC-DECISIONS.json'), true);
  assert.equal(touchesAc('regression/AC-MANIFEST.lock'), true);
  assert.equal(touchesAc('docs/contracts/ac-custody.md'), true);
  assert.equal(touchesAc('bridge/queue/358-PENDING.md'), true);
  assert.equal(touchesAc(LOCK_REL), false, 'COVERAGE.lock is a TEST artefact — that asymmetry is the custody contract');

  // No AC may be declared, restated or retired by an apply commit.
  assert.throws(() => commitMessageFor(plan, ['AC: slice-358-ac-1: something']), /must not carry an AC trailer/);
  assert.ok(!/^AC:/m.test(git(root, ['log', '-1', '--format=%B'])), 'the commit declares no AC');
  assert.ok(!/recordAcDecision/.test(APPLY),
    'the apply engine shares no code with the un-flag — it names the ledger only to refuse it');
});

// ── ac-6 ─────────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-ac-6 — after a successful apply the AC reconciles as covered and stops being flagged', () => {
  const root = fixture({ target: { new: 'regression/area/j-applied.test.js' } });
  const manifest = { byTag: { [FX]: { acHash: HASH, text: 'the criterion', lane: 'core' } } };

  const wasFlagged = triage({ reconcile: reconcile({ manifest, coverage: JSON.parse(fs.readFileSync(path.join(root, LOCK_REL), 'utf8')) }), manifest, decisions: {} });
  assert.deepEqual(wasFlagged.flagged.map(f => f.tag), [FX], 'before the apply the AC needs a human');

  const plan = planApply({ repoRoot: root, tag: FX });
  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, true, `the apply must succeed: ${JSON.stringify(out.refusals)}`);

  const coverage = JSON.parse(fs.readFileSync(path.join(root, LOCK_REL), 'utf8'));
  const rec = reconcile({ manifest, coverage });
  assert.equal(rec.byTag[FX].status, 'COVERED', 'the AC is covered because a guard genuinely carries its hash');
  const now = triage({ reconcile: rec, manifest, decisions: {} });
  assert.deepEqual(now.flagged, [], 'so nothing is left awaiting a human');
  assert.equal(now.ready, true, 'and stage ① goes green — by coverage, not by a ruling');

  // …and the overlay reads that from the server rather than assuming the apply worked.
  const route = SERVER.slice(SERVER.indexOf("if (pathname === '/api/check-test-updates/apply' && req.method === 'POST')"));
  assert.match(route.slice(0, 2200), /if \(out\.ok\) out\.check = getCheckTestUpdates\(\);/,
    'a successful apply must answer with a freshly derived triage');
  assert.match(HTML, /if \(out\.check\) _renderTestUpdatesBody\(out\.check\);/,
    'and the overlay must re-render from it');
});

// ── trap 1 ───────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-trap-1 — the apply is provenanced where the decisions ledger is not, and shares no code with it', () => {
  // recordAcDecision() writes a bare {"<tag>":"keep"} — no actor, no timestamp, no sha —
  // and triageTag() then answers needsHuman:false forever, across every future dev sha.
  // This test says nothing about whether that ledger is still shaped that way: pinning
  // somebody else's unfixed defect would turn the day it IS provenanced into a red guard
  // for a correct change. What trap 1 owns is the apply path — that it shares no code with
  // the un-flag, never reaches it, and stamps its own write with how it was authorized.
  for (const fn of ['applyPlanFor', 'applyDraftFor']) {
    const at = SERVER.indexOf(`function ${fn}(`);
    assert.notEqual(at, -1, `${fn}() must exist`);
    const body = SERVER.slice(at, SERVER.indexOf('\n}', at));
    assert.ok(!/recordAcDecision|AC-DECISIONS/.test(body), `${fn}() must not touch the decisions ledger`);
  }
  const route = SERVER.slice(SERVER.indexOf("if (pathname === '/api/check-test-updates/apply' && req.method === 'POST')"), SERVER.indexOf("// CHECK FOR TEST UPDATES → drain the flagged ACs"));
  assert.ok(!/recordAcDecision|AC-DECISIONS/.test(route), 'and neither may the route');

  // What the apply writes instead: a stamp naming how it was authorized, bound to the tag.
  const root = fixture({ files: { 'regression/AC-DECISIONS.json': '{}' }, target: { new: 'regression/area/j-applied.test.js' } });
  const plan = planApply({ repoRoot: root, tag: FX });
  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'regression', 'AC-DECISIONS.json'), 'utf8'), '{}',
    'an apply never un-flags an AC by writing a ruling');
  const { verifyStampedMeta } = require(path.join(root, 'bridge', 'approval-provenance'));
  const msg = git(root, ['log', '-1', '--format=%B']);
  const meta = {
    approval_provenance: (msg.match(/^Approval-Provenance: (.+)$/m) || [])[1],
    approval_ts: (msg.match(/^Approval-Ts: (.+)$/m) || [])[1],
    approval_sig: (msg.match(/^Approval-Sig: (.+)$/m) || [])[1],
  };
  assert.deepEqual(verifyStampedMeta(root, meta, `apply-draft:${FX}`), { ok: true, provenance: 'human-click', reason: null },
    'the stamp verifies against THIS installation and THIS tag');
  assert.equal(verifyStampedMeta(root, meta, 'apply-draft:slice-99358-ac-9').ok, false,
    'and cannot be moved to another AC');
});

// ── trap 2 ───────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-trap-2 — a guard that passes but registers nothing is refused, because green is not the evidence', () => {
  const root = fixture({ target: { new: 'regression/.quiet/j-uncounted.test.js' } });
  const plan = planApply({ repoRoot: root, tag: FX });

  assert.equal(plan.run.ok, true, 'the guard genuinely passes — this is the whole trap');
  assert.equal(plan.coverage.tagInMap, false, 'and registers nothing');
  assert.equal(plan.ok, false, 'a pass is not sufficient evidence');
  assert.ok(codes(plan).includes('E_TAG_NOT_IN_MAP'));

  // The same draft at a target the walker DOES reach is appliable — so the refusal is
  // about registration, not about the draft.
  const ok = fixture({ target: { new: 'regression/area/j-counted.test.js' } });
  const good = planApply({ repoRoot: ok, tag: FX });
  assert.equal(good.ok, true, `${JSON.stringify(good.refusals)}`);
  assert.equal(good.coverage.registeredAs.file, 'regression/area/j-counted.test.js');
  assert.equal(good.coverage.registeredAs.guardAcHash, HASH, 'and it is registered against the hash it claims');

  // The map is rebuilt with the deriver's own code, so "counted" cannot drift from what
  // COVERAGE.lock actually counts.
  assert.match(APPLY, /require\('\.\.\/scripts\/build-coverage-map'\)/);
  assert.match(APPLY, /buildCoverageMap/);
  assert.match(APPLY, /serialize/);
});

// ── trap 3 ───────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-trap-3 — an apply moves exactly two files, and an acceptance criterion is never one of them', () => {
  const root = fixture({ target: { new: 'regression/area/j-applied.test.js' } });
  const plan = planApply({ repoRoot: root, tag: FX });
  assert.deepEqual(plan.writes, ['regression/area/j-applied.test.js', LOCK_REL],
    'the plan declares its whole write set up front');
  assert.deepEqual(plan.writes.filter(touchesAc), [], 'and none of it is AC custody');

  const before = snapshot(root);
  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, true, `${JSON.stringify(out.refusals)}`);
  assert.deepEqual(changed(before, snapshot(root)), plan.writes.slice().sort(),
    'what moved is exactly what the plan said would move — nothing else in the tree');
  assert.deepEqual(out.commit.files.slice().sort(), plan.writes.slice().sort(),
    'and the commit carries exactly that');

  // The custody rule is a list, not a vibe: the manifest is off-limits, the coverage map
  // is not. "Reconcile may update a TEST from an AC; never the reverse."
  for (const p of ['regression/AC-MANIFEST.lock', 'regression/AC-CHECK.json', 'docs/adr/ADR-AC-RECONCILE.md', '.claude/roles/rom/ROLE.md']) {
    assert.equal(touchesAc(p), true, `${p} must be off-limits to this path`);
  }
  for (const p of ['regression/COVERAGE.lock', 'regression/area/j-applied.test.js', 'e2e/j-x.spec.js']) {
    assert.equal(touchesAc(p), false, `${p} is a test artefact, not a criterion`);
  }
  assert.match(APPLY, /E_TOUCHES_AC/, 'and a write set that reached custody would refuse by name');
});

// ── trap 4 ───────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-trap-4 — the regenerated lock matches the tree in the same commit, and a stale lock refuses rather than sweeping', () => {
  const root = fixture({ target: { new: 'regression/area/j-applied.test.js' } });
  const plan = planApply({ repoRoot: root, tag: FX });
  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, true, `${JSON.stringify(out.refusals)}`);

  // What `node scripts/build-coverage-map.js --check` would compare, at the applied commit.
  const committedLock = git(root, ['show', `HEAD:${LOCK_REL}`]) + '\n';
  assert.equal(committedLock, serialize(buildCoverageMap(root)),
    'the committed lock is exactly what the deriver derives from the committed tree');
  const files = git(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
  assert.ok(files.includes(LOCK_REL) && files.includes('regression/area/j-applied.test.js'),
    'the lock moves IN the commit that adds the guard — never in a follow-up the gate would see as drift');

  // A lock already out of date with the tree is somebody else's uncommitted change.
  // Regenerating it here would commit their work under this apply's message.
  const stale = fixture({ staleLock: true, target: { new: 'regression/area/j-applied.test.js' } });
  const before = snapshot(stale);
  const stalePlan = planApply({ repoRoot: stale, tag: FX });
  assert.equal(stalePlan.coverage.lockInSync, false);
  assert.ok(codes(stalePlan).includes('E_LOCK_STALE'), `expected E_LOCK_STALE, got ${codes(stalePlan)}`);
  const refused = applyDraft({ repoRoot: stale, tag: FX, planToken: stalePlan.token, provenance: 'human-click' });
  assert.equal(refused.ok, false);
  assert.deepEqual(changed(before, snapshot(stale)), [], 'and nothing is swept in');

  // …and THIS file must not pollute the map it is testing. The deriver resolves a source
  // path by reading text, and never checks the file exists, so a fixture guard written as
  // a literal `const X = path.join(…)` / `readFileSync(X)` pair registers a source that
  // lives only in a tmpdir. guardCount is the anti-shrink ratchet's currency: phantom
  // guards inflate it here and read as lost coverage the day this file is edited.
  const live = buildCoverageMap(REPO_ROOT);
  const phantom = Object.keys(live.bySource).filter(rel => !fs.existsSync(path.join(REPO_ROOT, rel)));
  assert.deepEqual(phantom, [], 'every source the coverage map credits must exist on disk');
});

// ── trap 5 ───────────────────────────────────────────────────────────────────────────
test('J-apply-draft slice-358-trap-5 — a guard lands under regression/ or e2e/ and nowhere else, and the drafts directory is never written', () => {
  for (const [target, why] of [
    [{ new: 'lib/j-x.test.js' }, 'a node guard outside regression/'],
    [{ new: 'regression/.drafts/j-x.test.js' }, 'back into the drafts directory'],
    [{ new: '../outside/j-x.test.js' }, 'outside the repo'],
    [{ new: 'e2e/j-x.test.js' }, 'a .test.js draft into the browser suite'],
  ]) {
    const root = fixture({ target });
    const before = snapshot(root);
    const plan = planApply({ repoRoot: root, tag: FX });
    assert.equal(plan.ok, false, `${why} must be refused`);
    const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
    assert.equal(out.ok, false, `${why} must not be applied`);
    assert.deepEqual(changed(before, snapshot(root)), [], `${why} must leave the tree untouched`);
  }
  // The drafts-directory case is refused by this slice's own rule, by name.
  const drafts = fixture({ target: { new: 'regression/.drafts/j-x.test.js' } });
  assert.ok(codes(planApply({ repoRoot: drafts, tag: FX })).includes('E_OUTSIDE_SUITE'));

  // And a SUCCESSFUL apply leaves the drafts directory exactly as it found it: the draft
  // stays as the record of what was proposed, and nothing is ever written back into it.
  const root = fixture({ target: { new: 'regression/area/j-applied.test.js' } });
  const draftsBefore = snapshot(path.join(root, 'regression', '.drafts'));
  const plan = planApply({ repoRoot: root, tag: FX });
  const out = applyDraft({ repoRoot: root, tag: FX, planToken: plan.token, provenance: 'human-click' });
  assert.equal(out.ok, true, `${JSON.stringify(out.refusals)}`);
  assert.deepEqual(changed(draftsBefore, snapshot(path.join(root, 'regression', '.drafts'))), [],
    'regression/.drafts/ is read-only to this path');
  assert.ok(out.plan.target.path.startsWith('regression/'), 'and the guard landed in the suite');
});

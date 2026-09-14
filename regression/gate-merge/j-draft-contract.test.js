'use strict';
// J-draft-contract — a drafted guard must be APPLICABLE BY CONSTRUCTION (slice 357).
//
// scripts/author-ac-test.js proposes guards into regression/.drafts/ for a human to apply.
// Measured on 2026-09-01: 14 drafts, 0 carrying an `@ac-hash` annotation. The coverage
// deriver registers a guard exactly two ways — the test reads a BEHAVIOUR source, or it
// carries the annotation beside a tagged test() title. A draft with neither can be applied,
// run, PASS, and change nothing in COVERAGE.lock: the AC stays flagged and the only control
// left to clear it is "No test needed for this AC". That is a straight path from a
// well-meant apply to a silently weakened suite, so the fix is upstream of apply — a draft
// is only written when it already carries what the suite needs to count it.
//
// This suite guards the contract (lib/draft-contract.js), its enforcement in the authoring
// script, and the two things that must NOT change: other tags' drafts are never touched,
// and coverage derivation itself is untouched.
//
// @ac-hash: slice-357-ac-1 sha256:7ec02336cea12356cb363c89ac2d0f0c2dedf8272cc2021895f938c4475bfa25
// @ac-hash: slice-357-ac-2 sha256:869bdb9872f7442675f87546ba41d74bff4f1376072cf9b10237a8e05b9a969e
// @ac-hash: slice-357-ac-3 sha256:9edee92e268d598690b9d97ef7f6eecfe2b47bc7c47e8b3d142fa4378a616c41
// @ac-hash: slice-357-ac-4 sha256:0089213c6da962578b26e8df343977c73536361f3eeb8477ce34db062d64419e
// @ac-hash: slice-357-ac-5 sha256:1e6fe4552f48c95b862a3eff68039bf245ad516e4dbf0ae348042c649f80b1e8

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT_SRC = path.join(REPO_ROOT, 'lib', 'draft-contract.js');
const AGENT_MODEL_SRC = path.join(REPO_ROOT, 'lib', 'agent-model.js');
const AUTHOR_SRC = path.join(REPO_ROOT, 'scripts', 'author-ac-test.js');
const PKG_SRC = path.join(REPO_ROOT, 'package.json');
const LIVE_DRAFTS = path.join(REPO_ROOT, 'regression', '.drafts');

const {
  annotationFor, targetName, draftName, validateDraft, auditDrafts,
} = require(CONTRACT_SRC);
const { agentModel } = require(AGENT_MODEL_SRC);
const { acHashOf } = require('../../scripts/build-ac-manifest');
const { acHashesIn, buildCoverageMap, walkTests } = require('../../scripts/build-coverage-map');

// A fixture AC in the reserved 99xxx slice range — never a real tag, so nothing this file
// writes can be mistaken for coverage of real work.
const TAG = 'slice-99357-ac-1';
const HASH = 'sha256:' + 'ab12cd34'.repeat(8); // 64 hex
const codes = (res) => res.errors.map(e => e.code);

// A draft body that satisfies the contract: the annotation the deriver parses, beside a
// test() title carrying the same tag.
function goodDraft(tag, hash) {
  return [
    "'use strict';",
    annotationFor(tag || TAG, hash || HASH),
    "const { test } = require('node:test');",
    `test('J-fixture ${tag || TAG} — the behaviour holds', () => {});`,
  ].join('\n');
}

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'draft-contract-'));

// Run the authoring script for real, with PATH stripped so the `claude` spawn cannot
// resolve: everything up to and including the prompt is exercised, no agent is ever run.
function runAuthor(argv, env) {
  return spawnSync(process.execPath, [AUTHOR_SRC, ...argv], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, PATH: '', ...(env || {}) },
  });
}

// The same run, but with a stand-in `claude` on PATH that drops a prepared set of files
// into the drafts directory — the agent's whole observable contribution. This exercises the
// script's VERIFICATION of what came back without spending an agent run. (The real `claude`
// lives in ~/.local/bin, so a PATH of the shim plus the system directories cannot reach it.)
//
// It writes into the drafts directory of the checkout it was HANDED (`./regression/.drafts/`,
// relative to its cwd), because since slice 359 that is a throwaway sandbox worktree rather
// than this repo, and a draft reaches the live directory only by being harvested out of it.
// A shim writing straight into the live directory would exercise a path the agent no
// longer has.
function runAuthorWithAgent(files) {
  const bin = mkTmp();
  const payload = mkTmp();
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(payload, name), body);
  const shim = path.join(bin, 'claude');
  fs.writeFileSync(shim, `#!/bin/sh\ncp -R "${payload}/." "./regression/.drafts/"\nexit 0\n`);
  fs.chmodSync(shim, 0o755);
  try {
    return runAuthor([TAG, '--text', 'the flux capacitor refuses a negative charge'],
      { PATH: `${bin}:/usr/bin:/bin` });
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(payload, { recursive: true, force: true });
  }
}

// Everything this fixture tag could have left in the live drafts directory. Since slice 359
// that includes a `<tag>.FAILED.md`: a run whose sandbox could not be created (these runs
// strip PATH, so neither `claude` NOR `git` resolves) records the failure the same way the
// live panel reads it, and the fixture's debris is the fixture's to sweep.
after(clearFixture);
function clearFixture() {
  let files = [];
  try { files = fs.readdirSync(LIVE_DRAFTS); } catch (_) { return; }
  for (const f of files) if (f.startsWith(TAG + '.')) fs.unlinkSync(path.join(LIVE_DRAFTS, f));
}

// ── slice-357-ac-1 — the annotation, in the deriver's exact form ──────────────────────
test('J-draft-contract slice-357-ac-1 — the authoring run demands the annotation the deriver parses, and a draft without it is invalid', () => {
  const acText = 'the flux capacitor refuses a negative charge';
  const res = runAuthor([TAG, '--text', acText]);

  // The script prints the one line it requires of the agent — built from the SPEC's hash,
  // not invented by the agent — before it ever spawns.
  const line = (res.stdout.match(/required annotation: (.+)/) || [])[1];
  assert.ok(line, `the run must state the required annotation\n${res.stdout}${res.stderr}`);
  assert.equal(line.trim(), annotationFor(TAG, acHashOf(acText)),
    'the required annotation must carry the spec hash build-ac-manifest.js derives');

  // …and the deriver's OWN parser must extract it: form, spacing and hash length all match.
  assert.equal(acHashesIn(line)[TAG], acHashOf(acText),
    'the demanded line must be one build-coverage-map.js recognises');

  // The other half of the contract: a draft that omits it is not applicable.
  const target = { tag: TAG, new: 'regression/gate-merge/j-fixture-99357.test.js' };
  const without = validateDraft({
    filename: draftName(TAG, 'test.js'),
    source: `const { test } = require('node:test');\ntest('J-fixture ${TAG} — no annotation', () => {});`,
    target,
  });
  assert.deepEqual(codes(without), ['E_ANNOTATION_MISSING']);

  // A short hash PARSES (the deriver's regex allows {6,64}) but can never equal the
  // manifest's, so ac-reconcile would read the AC STALE forever — reject it here.
  const short = validateDraft({
    filename: draftName(TAG, 'test.js'), source: goodDraft(TAG, 'sha256:ab12cd'), target,
  });
  assert.deepEqual(codes(short), ['E_ANNOTATION_HASH_FORM']);

  // A well-formed hash that is not THIS spec's is the same silent failure.
  const wrong = validateDraft({
    filename: draftName(TAG, 'test.js'), source: goodDraft(), target,
    expectedAcHash: 'sha256:' + 'f'.repeat(64),
  });
  assert.deepEqual(codes(wrong), ['E_ANNOTATION_HASH_MISMATCH']);

  // An annotation with no tagged test() title registers nothing — the deriver joins the two.
  const untitled = validateDraft({
    filename: draftName(TAG, 'test.js'),
    source: `'use strict';\n${annotationFor(TAG, HASH)}\ntest('J-fixture — untagged', () => {});`,
    target,
  });
  assert.deepEqual(codes(untitled), ['E_TAG_NOT_IN_TITLE']);

  assert.deepEqual(codes(validateDraft({ filename: draftName(TAG, 'test.js'), source: goodDraft(), target })), [],
    'annotation + tagged title + declared target is a valid draft');

  // End to end: an agent that returns an unannotated draft leaves NO draft behind. "Not
  // written" is the whole point — an unappliable draft sitting in the directory is exactly
  // what invites the apply that registers nothing.
  const hash = acHashOf(acText);
  const declared = JSON.stringify({ tag: TAG, new: 'regression/gate-merge/j-fixture-99357.test.js' });
  try {
    const bad = runAuthorWithAgent({
      [draftName(TAG, 'test.js')]: `test('J-fixture ${TAG} — no annotation', () => {});`,
      [targetName(TAG)]: declared,
    });
    assert.equal(bad.status, 1, `an unannotated draft must fail the run\n${bad.stdout}${bad.stderr}`);
    assert.ok(!fs.existsSync(path.join(LIVE_DRAFTS, draftName(TAG, 'test.js'))),
      'the unappliable draft must not be left behind for someone to apply');
    const rejected = fs.readFileSync(path.join(LIVE_DRAFTS, `${TAG}.REJECTED.md`), 'utf8');
    assert.match(rejected, /E_ANNOTATION_MISSING/, 'the reason is recorded, not just the removal');
    assert.match(rejected, /no annotation/, "and so is the agent's work, so nothing is lost");

    // …and the same run with a contract-satisfying draft keeps it, and reports where it lands.
    const good = runAuthorWithAgent({
      [draftName(TAG, 'test.js')]: goodDraft(TAG, hash),
      [targetName(TAG)]: declared,
    });
    assert.equal(good.status, 0, `a contract-satisfying draft must be accepted\n${good.stdout}${good.stderr}`);
    assert.ok(fs.existsSync(path.join(LIVE_DRAFTS, draftName(TAG, 'test.js'))));
    assert.match(good.stdout, /target: new file regression\/gate-merge\/j-fixture-99357\.test\.js/);
    assert.ok(!fs.existsSync(path.join(LIVE_DRAFTS, `${TAG}.REJECTED.md`)),
      'a fresh run clears the previous rejection');
  } finally {
    clearFixture();
  }
});

// ── slice-357-ac-2 — only extensions both the runner and the walker pick up ───────────
test('J-draft-contract slice-357-ac-2 — only .test.js and .spec.js are accepted, and they are exactly what the runner and the walkers see', () => {
  const target = { tag: TAG, new: 'regression/gate-merge/j-fixture-99357.test.js' };
  const spec = { tag: TAG, new: 'e2e/j-fixture-99357.spec.js' };

  // The live bare-.js draft (slice-351-ac-1.draft.js) landed as regression/<name>.js would
  // match neither the runner's glob nor the coverage walker: invisible to both, forever.
  const bare = validateDraft({ filename: `${TAG}.draft.js`, source: goodDraft(), target });
  assert.ok(codes(bare).includes('E_EXTENSION'), 'a bare .js draft must be rejected');
  assert.ok(codes(validateDraft({ filename: `${TAG}.draft.mjs`, source: goodDraft(), target })).includes('E_EXTENSION'));

  assert.deepEqual(codes(validateDraft({ filename: draftName(TAG, 'test.js'), source: goodDraft(), target })), []);
  assert.deepEqual(codes(validateDraft({ filename: draftName(TAG, 'spec.js'), source: goodDraft(), target: spec })), []);

  // Why those two and no others: the suite runner's glob…
  const pkg = JSON.parse(fs.readFileSync(PKG_SRC, 'utf8'));
  assert.match(pkg.scripts.test, /regression\/\*\*\/\*\.test\.js/,
    'the node:test runner only globs regression/**/*.test.js');

  // …and the coverage walkers, on a tree holding one file of each shape.
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'regression', 'area'), { recursive: true });
  fs.mkdirSync(path.join(root, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(root, 'regression', 'area', 'j-fixture.test.js'), goodDraft());
  fs.writeFileSync(path.join(root, 'e2e', 'j-fixture.spec.js'), goodDraft());
  fs.writeFileSync(path.join(root, 'regression', 'j-fixture.js'), goodDraft());
  assert.deepEqual(walkTests(root), ['regression/area/j-fixture.test.js'],
    'the regression walker takes .test.js and skips a bare .js');
  assert.deepEqual(Object.keys(buildCoverageMap(root).bySource),
    ['e2e/j-fixture.spec.js', 'regression/area/j-fixture.test.js'],
    'the map sees the .test.js and the .spec.js — the bare .js is invisible to it');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── slice-357-ac-3 — every draft declares where it lands ──────────────────────────────
test('J-draft-contract slice-357-ac-3 — a draft must declare exactly one of a new path or the guard it replaces', () => {
  const source = goodDraft();
  const filename = draftName(TAG, 'test.js');
  const NEW = 'regression/gate-merge/j-fixture-99357.test.js';
  const EXISTING = 'regression/gate-merge/j-check-authoring.test.js';

  assert.deepEqual(codes(validateDraft({ filename, source, target: null })), ['E_TARGET_MISSING'],
    'no companion at all is the current state of every live draft — reject it');
  assert.deepEqual(codes(validateDraft({ filename, source, target: {} })), ['E_TARGET_MALFORMED']);
  assert.deepEqual(codes(validateDraft({ filename, source, target: { new: NEW, replaces: EXISTING } })),
    ['E_TARGET_MALFORMED'], 'both keys is ambiguous, not permissive');
  assert.deepEqual(codes(validateDraft({ filename, source, target: { tag: 'slice-99999-ac-9', new: NEW } })),
    ['E_TARGET_MALFORMED'], 'a companion naming another tag does not belong to this draft');

  // The declared path must suit the draft: extension and home directory both.
  assert.ok(codes(validateDraft({ filename, source, target: { new: 'e2e/j-fixture.spec.js' } }))
    .includes('E_TARGET_PATH'), 'a .test.js draft cannot land in e2e/');
  assert.ok(codes(validateDraft({ filename: draftName(TAG, 'spec.js'), source, target: { new: 'regression/x.test.js' } }))
    .includes('E_TARGET_PATH'), 'a .spec.js draft cannot land in regression/');
  assert.ok(codes(validateDraft({ filename, source, target: { new: '../outside/j.test.js' } }))
    .includes('E_TARGET_PATH'), 'a draft cannot declare a path outside the repo');

  // With a repo to check against: this is the guardCount inflation the brief names — a
  // rewrite of an existing guard declared as "new" lands a second copy, both register, and
  // deleting the duplicate later needs a Coverage-Removed: trailer.
  assert.deepEqual(codes(validateDraft({ filename, source, target: { new: EXISTING }, repoRoot: REPO_ROOT })),
    ['E_TARGET_EXISTS'], 'a rewrite declared as "new" must be caught');
  assert.deepEqual(codes(validateDraft({ filename, source, target: { replaces: NEW }, repoRoot: REPO_ROOT })),
    ['E_TARGET_ABSENT'], '"replaces" must name a guard that exists');
  assert.deepEqual(codes(validateDraft({ filename, source, target: { tag: TAG, replaces: EXISTING }, repoRoot: REPO_ROOT })), [],
    'a declared rewrite of a real guard is the valid shape');
});

// ── slice-357-ac-4 — the guard over the drafts directory ──────────────────────────────
test('J-draft-contract slice-357-ac-4 — the audit reports every violating draft and stays silent on an empty or absent directory', () => {
  const root = mkTmp();
  const drafts = path.join(root, 'drafts');

  assert.deepEqual(auditDrafts(path.join(root, 'nope')), [], 'an absent drafts directory is not a violation');
  fs.mkdirSync(drafts, { recursive: true });
  assert.deepEqual(auditDrafts(drafts), [], 'an empty drafts directory is not a violation');

  // A draft that satisfies the contract keeps it silent…
  fs.writeFileSync(path.join(drafts, draftName(TAG, 'test.js')), goodDraft());
  fs.writeFileSync(path.join(drafts, targetName(TAG)), JSON.stringify({ tag: TAG, new: 'regression/area/j-fixture.test.js' }));
  assert.deepEqual(auditDrafts(drafts), [], 'a contract-satisfying draft must not be reported');

  // …and each violation shape breaks it. This is the state of the live directory today:
  // an unannotated draft with no companion.
  const OTHER = 'slice-99357-ac-2';
  fs.writeFileSync(path.join(drafts, draftName(OTHER, 'test.js')),
    `const { test } = require('node:test');\ntest('J-fixture ${OTHER} — unannotated', () => {});`);
  const found = auditDrafts(drafts);
  assert.equal(found.length, 1, 'exactly the violating draft is reported');
  assert.equal(found[0].file, draftName(OTHER, 'test.js'));
  assert.deepEqual(found[0].errors.map(e => e.code).sort(), ['E_ANNOTATION_MISSING', 'E_TARGET_MISSING']);

  fs.rmSync(root, { recursive: true, force: true });

  // The live directory itself. Fixture tags (the reserved 99xxx range) are skipped: other
  // suites write drafts into this same real directory and `node --test` runs files in
  // parallel, so judging their transient fixtures here would flake.
  const live = auditDrafts(LIVE_DRAFTS, {
    repoRoot: REPO_ROOT,
    ignoreTag: (t) => /^slice-99\d{3}-ac-\d+$/.test(t),
  });
  assert.deepEqual(live, [],
    'regression/.drafts/ holds a draft that would register no coverage if applied — regenerate it ' +
    '(node scripts/author-ac-test.js <tag>) or discard it:\n' +
    live.map(v => `${v.file}: ${v.errors.map(e => e.code).join(', ')}`).join('\n'));
});

// ── slice-357-ac-5 — the agent's model and effort come from configuration ─────────────
test('J-draft-contract slice-357-ac-5 — the authoring agent runs at the model configured in bridge.config.json, never a hardcoded one', () => {
  const configured = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'bridge', 'bridge.config.json'), 'utf8'));
  const flag = (f) => configured.claudeArgs[configured.claudeArgs.indexOf(f) + 1];
  const resolved = agentModel(REPO_ROOT);
  assert.equal(resolved.model, flag('--model'));
  assert.equal(resolved.effort, flag('--effort'));

  // The script announces what it spawns at — and it is the configured pair, not a literal.
  const res = runAuthor([TAG, '--text', 'anything at all']);
  assert.match(res.stdout, new RegExp(`spawning Julian \\(${flag('--model')}/${flag('--effort')},`),
    `the authoring run must spawn at the configured model\n${res.stdout}${res.stderr}`);

  // No fallback model may be baked in: `claude` without --model silently uses
  // ANTHROPIC_MODEL, so a config with no model must STOP rather than guess.
  const bare = mkTmp();
  fs.mkdirSync(path.join(bare, 'bridge'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'bridge', 'bridge.config.json'), JSON.stringify({ claudeArgs: ['-p'] }));
  const none = agentModel(bare);
  assert.equal(none.model, null);
  assert.equal(none.effort, null);
  assert.match(none.source, /bridge\.config\.json/, 'the caller must be told where to look');

  fs.writeFileSync(path.join(bare, 'bridge', 'bridge.config.json'),
    JSON.stringify({ claudeArgs: ['--model', 'claude-from-config', '--effort', 'low'] }));
  assert.deepEqual(
    (({ model, effort }) => ({ model, effort }))(agentModel(bare)),
    { model: 'claude-from-config', effort: 'low' });
  assert.deepEqual(
    (({ model, effort }) => ({ model, effort }))(agentModel(bare, { DENORIOS_AGENT_MODEL: 'x', DENORIOS_AGENT_EFFORT: 'y' })),
    { model: 'x', effort: 'y' }, 'an explicit override outranks the config');
  fs.rmSync(bare, { recursive: true, force: true });

  // The regression this AC exists for: a model id spelled out in the code. Neither the
  // resolver nor its caller may carry one — a literal there is how the authoring runs stayed
  // on claude-opus-4-8/high while bridge.config.json had long since moved to opus-5/max.
  const uncommented = (src) => src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(uncommented(fs.readFileSync(AUTHOR_SRC, 'utf8')),
    /['"]claude-[a-z0-9-]+['"]/, 'no model id may be hardcoded in scripts/author-ac-test.js');
  assert.doesNotMatch(uncommented(fs.readFileSync(AGENT_MODEL_SRC, 'utf8')),
    /['"]claude-[a-z0-9-]+['"]/, 'no default model may be baked into lib/agent-model.js');
});

// ── trap 1 — the drafts that predate this contract are not ours to touch ──────────────
test('J-draft-contract slice-357-ac-1 trap — an authoring run only ever touches its own tag\'s files', () => {
  // The live directory holds drafts authored before this contract existed. Regenerating or
  // discarding them is a human call, so a run for one tag must leave every other tag alone —
  // including the stale-artifact sweep that opens the run.
  fs.mkdirSync(LIVE_DRAFTS, { recursive: true });
  const FOREIGN = 'slice-99356-ac-1';
  const foreignFiles = {
    [draftName(FOREIGN, 'test.js')]: 'predates the contract — no annotation, no target',
    [`${FOREIGN}.rationale.txt`]: 'why',
    [`${FOREIGN}.target.json`]: '{}',
  };
  for (const [name, body] of Object.entries(foreignFiles)) fs.writeFileSync(path.join(LIVE_DRAFTS, name), body);
  // …plus an artifact of OUR tag, which the sweep is entitled to clear.
  fs.writeFileSync(path.join(LIVE_DRAFTS, draftName(TAG, 'test.js')), 'stale');

  try {
    runAuthor([TAG, '--text', 'anything at all']);
    for (const [name, body] of Object.entries(foreignFiles)) {
      const p = path.join(LIVE_DRAFTS, name);
      assert.ok(fs.existsSync(p), `${name} belongs to another AC and must survive the run`);
      assert.equal(fs.readFileSync(p, 'utf8'), body, `${name} must be left byte-identical`);
    }
    assert.ok(!fs.existsSync(path.join(LIVE_DRAFTS, draftName(TAG, 'test.js'))),
      "the run's own stale draft is cleared, so the outcome is unambiguous");
  } finally {
    for (const name of Object.keys(foreignFiles)) {
      try { fs.unlinkSync(path.join(LIVE_DRAFTS, name)); } catch (_) {}
    }
    try { fs.unlinkSync(path.join(LIVE_DRAFTS, draftName(TAG, 'test.js'))); } catch (_) {}
  }
});

// ── trap 2 — the annotation must match what the map ACTUALLY parses ───────────────────
test('J-draft-contract slice-357-ac-2 trap — a draft the contract accepts really does register in a freshly built coverage map', () => {
  // An annotation the deriver does not recognise is worse than none, because it looks
  // correct. So the round trip is asserted against the real deriver, not a copy of its
  // regex: a contract-valid draft, applied at its declared target, must appear in the map.
  const root = mkTmp();
  const rel = 'regression/area/j-fixture.test.js';
  const target = { tag: TAG, new: rel };
  const source = goodDraft();

  assert.deepEqual(codes(validateDraft({ filename: draftName(TAG, 'test.js'), source, target, repoRoot: root })), [],
    'the draft is contract-valid');

  fs.mkdirSync(path.join(root, 'regression', 'area'), { recursive: true });
  fs.writeFileSync(path.join(root, rel), source); // apply it
  const map = buildCoverageMap(root);
  const entries = (map.bySource[rel] || []);
  assert.deepEqual(entries, [{ tag: TAG, file: rel, guardAcHash: HASH }],
    'applying a contract-valid draft registers the tag with its claimed spec hash');

  // And the negative: strip the annotation and the same applied file registers NOTHING —
  // which is exactly what every live draft would do today.
  fs.writeFileSync(path.join(root, rel), source.split('\n').filter(l => !l.includes('@ac-')).join('\n'));
  assert.equal(buildCoverageMap(root).bySource[rel], undefined,
    'without the annotation the applied test registers no coverage at all');

  fs.rmSync(root, { recursive: true, force: true });
});

// ── trap 3 — this slice must not change how coverage is derived ───────────────────────
test('J-draft-contract slice-357-ac-4 trap — drafts still change nothing about what the coverage map counts', () => {
  // The contract changes what a draft CONTAINS. It must never change what COVERAGE.lock
  // counts — so a drafts directory, however full and however valid, is invisible to the
  // deriver both before and after this slice.
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'regression', 'area'), { recursive: true });
  fs.writeFileSync(path.join(root, 'regression', 'area', 'j-real.test.js'), goodDraft());
  const before = buildCoverageMap(root);

  const drafts = path.join(root, 'regression', '.drafts');
  fs.mkdirSync(drafts, { recursive: true });
  fs.writeFileSync(path.join(drafts, draftName(TAG, 'test.js')), goodDraft());
  fs.writeFileSync(path.join(drafts, targetName(TAG)), JSON.stringify({ tag: TAG, new: 'regression/area/j-new.test.js' }));
  fs.writeFileSync(path.join(drafts, draftName('slice-99357-ac-3', 'spec.js')), goodDraft('slice-99357-ac-3'));

  assert.deepEqual(buildCoverageMap(root), before,
    'a populated drafts directory must not move guardCount or bySource by a single entry');
  assert.equal(before.guardCount, buildCoverageMap(root).guardCount);
  fs.rmSync(root, { recursive: true, force: true });

  // Belt and braces: the contract module reads the deriver's parsers rather than restating
  // them, so "the exact form the map recognises" cannot drift apart from the map.
  const contract = fs.readFileSync(CONTRACT_SRC, 'utf8');
  assert.match(contract, /require\('\.\.\/scripts\/build-coverage-map'\)/);
  assert.match(contract, /acHashesIn/);
  assert.match(contract, /tagsIn/);
});

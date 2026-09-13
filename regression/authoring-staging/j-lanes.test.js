'use strict';

// J-lanes — two lanes of rigour, declared in the brief and obeyed downstream
// (slice 389, ADR-PROOF-LANES §2).
//
// Slice 383 changed 13 product lines and was proved like a change to the merge
// gate: nine tests, a 227-line report, a break-it check, screenshots. 15.5 of
// its 16.3 minutes were proof and paperwork. The fix is not "prove less"; it is
// "say which kind of change this is, once, in the brief, and let everything
// downstream read it".
//
// These guards hold the five places that have to agree on the answer: the writer
// (new-slice.js), the register events, the report template, the reviewer's prompt
// and the effort the model is spawned with. Plus the six ways the wiring could
// look right and be wrong — chief among them a lane read off Sam's DONE report,
// which never has one, so every squash would quietly say core.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_PATH = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const NEW_SLICE = path.join(REPO_ROOT, 'bridge', 'new-slice.js');
const ORCH_SRC = fs.readFileSync(ORCH_PATH, 'utf8');
const NEW_SLICE_SRC = fs.readFileSync(NEW_SLICE, 'utf8');

const orchestrator = require('../../bridge/orchestrator.js');
const {
  resolveLane,
  laneEventFields,
  applyLaneArgs,
  romSpawnArgs,
  registerCommissioned,
  readSliceMeta,
  squashSliceToDev,
  buildDoneTemplate,
  validateIntakeMeta,
} = orchestrator;
const { buildNogPrompt } = require('../../bridge/nog-prompt.js');

// The global args as bridge.config.json ships them, and the lane's override.
const GLOBAL_ARGS = ['-p', '--verbose', '--output-format', 'stream-json', '--model', 'claude-opus-5', '--effort', 'max'];
const LANE_ARGS = { surface: ['--effort', 'high'] };

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Lane Fixture', GIT_AUTHOR_EMAIL: 'lane@fixture.test',
  GIT_COMMITTER_NAME: 'Lane Fixture', GIT_COMMITTER_EMAIL: 'lane@fixture.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (args, cwd) => execFileSync('git', args,
  { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let tmp, workDir, queueDir, registerPath;

// A throwaway bare+clone repo in os.tmpdir(), the orchestrator redirected through
// its _testSet* hooks. Live bridge state is never touched. No scripts/ directory,
// so the Layer-2 lock and the landing lock regeneration both skip themselves.
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j-lanes-'));
  const bareDir = path.join(tmp, 'bare.git');
  workDir = path.join(tmp, 'work');
  git(['init', '--quiet', '--bare', '--initial-branch=main', bareDir], tmp);
  git(['clone', '--quiet', bareDir, workDir], tmp);

  fs.writeFileSync(path.join(workDir, 'base.txt'), 'base\n');
  git(['add', 'base.txt'], workDir);
  git(['commit', '--quiet', '-m', 'initial'], workDir);
  git(['push', '--quiet', 'origin', 'main'], workDir);
  git(['checkout', '--quiet', '-b', 'dev'], workDir);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  // Repo-local identity: squashSliceToDev commits with the plain process env, and
  // a clean CI runner has no global one.
  git(['config', 'user.email', 'lane@fixture.test'], workDir);
  git(['config', 'user.name', 'Lane Fixture'], workDir);

  const bridgeDir = path.join(workDir, 'bridge');
  queueDir = path.join(bridgeDir, 'queue');
  for (const d of ['state', 'queue', 'staged', 'trash'].map(x => path.join(bridgeDir, x))) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(bridgeDir, 'state', 'branch-state.json'), JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');
  registerPath = path.join(bridgeDir, 'register.jsonl');
  fs.writeFileSync(registerPath, '');

  orchestrator._testSetProjectDir(workDir);
  orchestrator._testSetRegisterFile(registerPath);
  orchestrator._testSetDirs(queueDir, path.join(bridgeDir, 'staged'), path.join(bridgeDir, 'trash'));
});

after(() => {
  orchestrator._testSetProjectDir(REPO_ROOT);
  orchestrator._testSetRegisterFile(path.join(REPO_ROOT, 'bridge', 'register.jsonl'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function runNewSlice(args, envOverrides) {
  const box = fs.mkdtempSync(path.join(tmp, 'cli-'));
  const result = spawnSync(process.execPath, [NEW_SLICE, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DS9_QUEUE_DIR: path.join(box, 'queue'),
      DS9_STAGED_DIR: path.join(box, 'staged'),
      DS9_REGISTER_FILE: path.join(box, 'register.jsonl'),
      DS9_TRASH_DIR: path.join(box, 'trash'),
      ...(envOverrides || {}),
    },
    input: '',
    encoding: 'utf8',
    timeout: 15000,
  });
  const stagedDir = path.join(box, 'staged');
  const staged = fs.existsSync(stagedDir) ? fs.readdirSync(stagedDir) : [];
  return { ...result, stagedDir, staged };
}

function readStaged({ stagedDir, staged }) {
  assert.equal(staged.length, 1, `exactly one staged file expected, got ${JSON.stringify(staged)}`);
  return fs.readFileSync(path.join(stagedDir, staged[0]), 'utf8');
}

function writeQueueFile(id, suffix, frontmatter) {
  const body = ['---', ...frontmatter, '---', '', '## Goal', 'Fixture.', ''].join('\n');
  fs.writeFileSync(path.join(queueDir, `${id}${suffix}`), body);
}

// A slice branch cut from the CURRENT dev tip. Every squash advances dev, so a
// branch made once in before() would drift-conflict against the slices that
// landed ahead of it — which the real pipeline never does, because
// ensureIntegrationIsFresh cuts every worktree from the live dev.
function cutSliceBranch(id) {
  const branch = `slice/${id}`;
  git(['checkout', '--quiet', 'dev'], workDir);
  git(['checkout', '--quiet', '-b', branch], workDir);
  fs.writeFileSync(path.join(workDir, `feature-${id}.txt`), `work on ${id}\n`);
  git(['add', `feature-${id}.txt`], workDir);
  git(['commit', '--quiet', '-m', `work on ${branch}`], workDir);
  git(['checkout', '--quiet', 'dev'], workDir);
  return branch;
}

function registerLines() {
  return fs.readFileSync(registerPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

const TEMPLATE_ARGS = {
  id: '389', worktreeDonePath: '/tmp/ds9-worktrees/389/bridge/queue/389-DONE.md',
  sliceBranch: 'slice/389', sliceContent: '',
};
const PROMPT_ARGS = {
  id: '389', round: 1, sliceFileContents: '(brief)', doneReportContents: '(report)',
  gitDiff: '(diff)', scopeDiff: '(scope)', slicePath: '/tmp/389-PARKED.md',
};

// ---------------------------------------------------------------------------
// slice-389-ac-1 — the writer declares the lane
// ---------------------------------------------------------------------------
// @ac-hash: slice-389-ac-1 sha256:be8b8cccc8d30ec230afc9180b374379bbd2104e78ee98eeccf9dccb3b2fc9a4

test('slice-389-ac-1 new-slice.js writes the declared lane, defaults to core with a warning, refuses anything else, and requires the field on write', () => {
  // Both lanes round-trip from the flag into the frontmatter.
  for (const lane of ['surface', 'core']) {
    const run = runNewSlice(['--title', 'A panel header', '--goal', 'Say Coverage', '--lane', lane]);
    assert.equal(run.status, 0, `--lane ${lane} must succeed: ${run.stderr}`);
    assert.match(readStaged(run), new RegExp(`^lane: ${lane}$`, 'm'),
      `--lane ${lane} must write "lane: ${lane}" into the frontmatter`);
  }

  // Omitted → core, and said out loud. A silent default is a classification
  // nobody made; the whole point of the lane is that Alex chose it.
  const bare = runNewSlice(['--title', 'A panel header', '--goal', 'Say Coverage']);
  assert.equal(bare.status, 0, `an omitted --lane must still stage: ${bare.stderr}`);
  assert.match(readStaged(bare), /^lane: core$/m, 'an omitted --lane must default to core');
  assert.match(`${bare.stderr}${bare.stdout}`, /no --lane given; defaulting to core \(full rigour\)/,
    'the default must be announced, not silent');

  // Anything else is refused outright — not coerced, not defaulted.
  const bogus = runNewSlice(['--title', 'A panel header', '--goal', 'Say Coverage', '--lane', 'lightweight']);
  assert.notEqual(bogus.status, 0, 'an unknown --lane must fail the run');
  assert.match(bogus.stderr, /--lane must be one of: surface, core \(got: lightweight\)/,
    'the error must name the flag, the allowed values and what was given');
  assert.deepEqual(bogus.staged, [], 'a refused lane must not leave a staged file behind');

  // Required on write: the writer's own self-check would reject a generated file
  // without the field.
  assert.match(NEW_SLICE_SRC, /^const REQUIRED_FIELDS = \[[^\]]*'lane'[^\]]*\];$/m,
    "new-slice.js must carry 'lane' in REQUIRED_FIELDS so the field is mandatory on write");
});

// ---------------------------------------------------------------------------
// slice-389-ac-2 — the lane travels through the register and onto dev
// ---------------------------------------------------------------------------
// @ac-hash: slice-389-ac-2 sha256:1dc3a072fbaa3a6df9748ce2b3e385369b9535f5a26466f05b9e92648ad258de

test('slice-389-ac-2 resolveLane defaults to core, the COMMISSIONED line carries the body\'s lane, readSliceMeta reads the brief not the report, and the squash writes the lane it is given', () => {
  // resolveLane: missing and unknown both land on full rigour.
  assert.equal(resolveLane({ lane: 'surface' }), 'surface');
  assert.equal(resolveLane({ lane: 'core' }), 'core');
  assert.equal(resolveLane({}), 'core', 'a brief with no lane is core');
  assert.equal(resolveLane(null), 'core', 'an unparseable brief is core');
  assert.equal(resolveLane({ lane: 'lightweight' }), 'core', 'an unknown lane is core, not a third lane');

  // registerCommissioned reads the lane out of the slice body it already receives.
  const body = ['---', 'id: "701"', 'title: "T"', 'lane: surface', '---', '', 'body'].join('\n');
  registerCommissioned('701', { title: 'T', goal: 'G', body });
  const commissioned = registerLines().filter(e => e.event === 'COMMISSIONED' && e.slice_id === '701');
  assert.equal(commissioned.length, 1, 'exactly one COMMISSIONED line for slice 701');
  assert.equal(commissioned[0].lane, 'surface', 'COMMISSIONED must carry the lane declared in the body');

  // readSliceMeta: the PARKED brief wins over the ACCEPTED report, which is
  // checked first in the suffix list and is Sam's report renamed.
  writeQueueFile('701', '-ACCEPTED.md', ['id: "701"', 'title: "Report title"', 'branch: "slice/701"', 'lane: surface']);
  writeQueueFile('701', '-PARKED.md', ['id: "701"', 'title: "Brief title"', 'lane: core']);
  const meta = readSliceMeta('701');
  assert.equal(meta.lane, 'core', 'the lane must come from the PARKED brief, never from the ACCEPTED report');
  assert.equal(meta.branch, 'slice/701', 'title and branch stay first-wins across all four files');

  // squashSliceToDev writes what it is handed, as a trailer and as an event field.
  cutSliceBranch('701');
  const result = squashSliceToDev('701', 'A core slice', 'slice/701', 'core');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);
  const msg = git(['log', '-1', '--format=%B', 'dev'], workDir);
  assert.match(msg, /^Lane: core$/m, 'the landing commit must carry the Lane trailer');
  const squashed = registerLines().filter(e => e.event === 'SLICE_SQUASHED_TO_DEV' && e.slice_id === '701');
  assert.equal(squashed.length, 1);
  assert.equal(squashed[0].lane, 'core', 'SLICE_SQUASHED_TO_DEV must carry the lane');
});

// ---------------------------------------------------------------------------
// slice-389-ac-3 — the report template follows the lane
// ---------------------------------------------------------------------------
// @ac-hash: slice-389-ac-3 sha256:27ed7222af09db8d3d1bcd7ae9b4c7e7c8656e1512a2c559540cba1b55420285

test('slice-389-ac-3 the surface template asks for four report headings and the surface test rule; the core template asks for the seven contract headings and the break-it check', () => {
  const surface = buildDoneTemplate({ ...TEMPLATE_ARGS, lane: 'surface' });
  const core = buildDoneTemplate({ ...TEMPLATE_ARGS, lane: 'core' });

  for (const heading of ['## Summary', '## What changed', '## Screen hooks', '## Commit']) {
    assert.ok(surface.includes(heading), `the surface template must name ${heading}`);
  }
  assert.match(surface, /Add `## Safety-net tests` only if you wrote one\./,
    'Safety-net tests is optional on the surface lane, and must be named as optional');
  assert.ok(!surface.includes('Acceptance criteria verification'),
    'the surface template must not ask for Acceptance criteria verification');
  assert.ok(!surface.includes('Tests moved or weakened'),
    'the surface template must not ask for Tests moved or weakened');
  assert.match(surface, /Write a safety-net test only for a criterion that asserts behaviour \(an interaction or a computed value\)\./,
    'the surface test rule must be stated');
  assert.match(surface, /No break-it check\./, 'the surface lane has no break-it check');

  const CORE_HEADINGS = [
    '## Summary', '## What changed', '## Acceptance criteria verification',
    '## Safety-net tests', '## Screen hooks', '## Tests moved or weakened', '## Commit',
  ];
  let cursor = -1;
  for (const heading of CORE_HEADINGS) {
    const at = core.indexOf(heading, cursor + 1);
    assert.ok(at > cursor, `the core template must name ${heading}, in contract order`);
    cursor = at;
  }
  assert.match(core, /Write one safety-net test per acceptance criterion, plus one for each trap, then stop; before committing, stash your fix, run your new test file, confirm every new test goes red, restore the fix, and list which went red under Safety-net tests\./,
    'the core test rule and the break-it check must be stated');
  assert.ok(!core.includes('No break-it check'), 'the core lane keeps the break-it check');
});

// ---------------------------------------------------------------------------
// slice-389-ac-4 — the reviewer is told the lane
// ---------------------------------------------------------------------------
// @ac-hash: slice-389-ac-4 sha256:9e65d4679d37a4b532d848f2ba4a9713240f9966e1306a43d87360a10df4e06d

test('slice-389-ac-4 the surface prompt carries the lane check and the lane-mismatch fix instruction; the core prompt says the lane is core', () => {
  const surface = buildNogPrompt({ ...PROMPT_ARGS, lane: 'surface' });
  const core = buildNogPrompt({ ...PROMPT_ARGS, lane: 'core' });

  assert.match(surface, /Lane check: this slice is declared surface\./);
  assert.match(surface, /Do not reject for missing tests, a missing break-it list or missing browser evidence\./,
    'a lighter lane is worthless if the reviewer rejects for the proof it excused');
  assert.match(surface, /lane mismatch: this change alters behaviour \(name the function or branch\); Alex must re-file it as core/,
    'the fix instruction must be verbatim so the lead can act on it without interpretation');
  assert.match(surface, /if the diff adds or changes control flow, state, git operations, the gate, an API endpoint or its response/,
    'the reviewer must be told what a behaviour change looks like');
  assert.match(surface, /do not reject for the absence of Acceptance criteria verification, Safety-net tests or Tests moved or weakened/,
    'the three headings a surface report omits must be named');

  assert.match(core, /Lane check: this slice is declared core\./);
  assert.ok(!core.includes('lane mismatch'), 'a core slice cannot be a lane mismatch');
  assert.ok(!core.includes('Do not reject for missing tests'), 'the core lane keeps its test rules');

  // The part count moved from four to five in both places that state it.
  for (const [name, prompt] of [['surface', surface], ['core', core]]) {
    assert.match(prompt, /Your review has FIVE parts:/, `${name}: the part count must say five`);
    assert.match(prompt, /Perform your review covering all five parts\./, `${name}: the closing instruction must say five`);
    assert.match(prompt, /### Part 5: Lane check/, `${name}: Part 5 must exist`);
  }

  // A prompt built without a lane is a core prompt — the whole staged backlog.
  assert.match(buildNogPrompt({ ...PROMPT_ARGS }), /Lane check: this slice is declared core\./);
});

// ---------------------------------------------------------------------------
// slice-389-ac-5 — the effort setting follows the lane
// ---------------------------------------------------------------------------
// @ac-hash: slice-389-ac-5 sha256:5e3fa6984fca07d0f98b18b51456fb9451a584eaec59f38dfd2c7b725a2195d4

test('slice-389-ac-5 romSpawnArgs gives a surface slice the lane effort on both paths and leaves core untouched; laneEventFields reports the lane and the effort actually spawned', () => {
  const fresh = romSpawnArgs({ claudeArgs: GLOBAL_ARGS, laneArgs: LANE_ARGS, lane: 'surface', round: 1 });
  assert.deepEqual(fresh.slice(fresh.indexOf('--effort')), ['--effort', 'high'],
    'a fresh surface run must spawn at the lane effort');
  assert.ok(fresh.includes('-p'), 'the fresh path keeps -p');

  const resumed = romSpawnArgs({
    claudeArgs: GLOBAL_ARGS, laneArgs: LANE_ARGS, lane: 'surface',
    round: 2, sessionId: 'sess-abc', nogReason: 'one heading is misspelled',
  });
  assert.deepEqual(resumed.slice(resumed.indexOf('--effort')), ['--effort', 'high'],
    'a resumed surface round must spawn at the lane effort too');
  assert.deepEqual(resumed.slice(0, 2), ['--resume', 'sess-abc'], 'the resume path still resumes');
  assert.ok(!resumed.includes('-p'), 'the resume path still drops -p');

  // Core, and a lane with no entry, both get the global list back unchanged.
  assert.deepEqual(romSpawnArgs({ claudeArgs: GLOBAL_ARGS, laneArgs: LANE_ARGS, lane: 'core', round: 1 }), GLOBAL_ARGS);
  assert.deepEqual(romSpawnArgs({ claudeArgs: GLOBAL_ARGS, laneArgs: {}, lane: 'surface', round: 1 }), GLOBAL_ARGS);
  assert.deepEqual(romSpawnArgs({ claudeArgs: GLOBAL_ARGS, lane: 'surface', round: 1 }), GLOBAL_ARGS,
    'no laneArgs in config at all must behave exactly as before lanes existed');

  // laneEventFields reports what was run, not what was configured.
  assert.deepEqual(laneEventFields({ lane: 'surface' }, fresh), { lane: 'surface', effort: 'high' });
  assert.deepEqual(laneEventFields({ lane: 'core' }, GLOBAL_ARGS), { lane: 'core', effort: 'max' });
  assert.deepEqual(laneEventFields({ lane: 'surface' }), { lane: 'surface' },
    'with no args there is no effort to report, and none is invented');
  assert.deepEqual(laneEventFields({}, ['-p', '--verbose']), { lane: 'core' },
    'args without --effort report no effort');
});

// ---------------------------------------------------------------------------
// Trap 1 — the --resume path used to build its own list
// ---------------------------------------------------------------------------

test('slice-389-trap-1 a rework round of a surface slice does not silently run at the global effort', () => {
  // The resume list was assembled inline, by filtering -p out of config.claudeArgs.
  // Anything added to the fresh path missed every round after the first, and a
  // rejected surface slice would have been reworked at max while its first
  // attempt ran at high — the measurement in ADR §8 reading two lanes as one.
  for (const round of [2, 3, 5]) {
    const args = romSpawnArgs({
      claudeArgs: GLOBAL_ARGS, laneArgs: LANE_ARGS, lane: 'surface',
      round, sessionId: 'sess-abc', nogReason: 'a heading is misspelled',
    });
    assert.ok(!args.includes('max'), `round ${round} must not fall back to the global effort`);
    assert.deepEqual(args.slice(args.indexOf('--effort')), ['--effort', 'high'], `round ${round}`);
  }

  // A forced-fresh rework (trigger keyword or >500 chars of feedback) is still a
  // fresh spawn, and still at the lane's effort.
  const forced = romSpawnArgs({
    claudeArgs: GLOBAL_ARGS, laneArgs: LANE_ARGS, lane: 'surface',
    round: 2, sessionId: 'sess-abc', nogReason: 'x'.repeat(600),
  });
  assert.ok(!forced.includes('--resume'), 'long feedback forces a fresh session');
  assert.deepEqual(forced.slice(forced.indexOf('--effort')), ['--effort', 'high']);

  // The reviewer's spawn shares config.claudeArgs by reference; substituting in
  // place would have set Jordan's effort from Sam's lane.
  const shared = GLOBAL_ARGS.slice();
  applyLaneArgs(shared, 'surface', LANE_ARGS);
  assert.deepEqual(shared, GLOBAL_ARGS, 'applyLaneArgs must never mutate the array it is given');
});

// ---------------------------------------------------------------------------
// Trap 2 — the whole staged backlog predates the field
// ---------------------------------------------------------------------------

test('slice-389-trap-2 the orchestrator does not require a lane on intake', () => {
  // Only the writer requires it. Every queue file staged before this landed has
  // no lane; if intake validation learned the field, the backlog would stop
  // dispatching the moment this shipped.
  const laneless = { id: '700', title: 'An older slice', from: 'obrien', to: 'rom', priority: 'normal', created: '2026-09-01T00:00:00Z' };
  const verdict = validateIntakeMeta(laneless);
  assert.equal(verdict.ok, true, `a slice file without a lane must still pass intake: ${JSON.stringify(verdict)}`);
  assert.deepEqual(verdict.missingFields, []);

  // And it reads as core everywhere downstream, without a warning — a missing
  // lane is the back catalogue, not a mistake.
  assert.equal(resolveLane(laneless), 'core');
  assert.deepEqual(laneEventFields(laneless, GLOBAL_ARGS), { lane: 'core', effort: 'max' });
  assert.deepEqual(romSpawnArgs({ claudeArgs: GLOBAL_ARGS, laneArgs: LANE_ARGS, lane: resolveLane(laneless), round: 1 }), GLOBAL_ARGS);
});

// ---------------------------------------------------------------------------
// Trap 3 — the template is one string; only two things vary
// ---------------------------------------------------------------------------

test('slice-389-trap-3 the surface template keeps the report path, the frontmatter example and the trailer instruction', () => {
  const surface = buildDoneTemplate({ ...TEMPLATE_ARGS, lane: 'surface' });
  const core = buildDoneTemplate({ ...TEMPLATE_ARGS, lane: 'core' });

  // Branching a template by lane is how a lane loses the instructions that have
  // nothing to do with rigour.
  for (const shared of [
    'Write your report to: /tmp/ds9-worktrees/389/bridge/queue/389-DONE.md',
    'Use this exact frontmatter structure (the orchestrator fills the metric fields):',
    'status: DONE',
    'branch: "slice/389"',
    'compaction_occurred: false',
    'Leave tokens_in, tokens_out and elapsed_ms at 0',
    '## What you run',
    'Never run the full safety-net suite',
    'Stage your report with `git add -f bridge/queue/389-DONE.md`',
  ]) {
    assert.ok(surface.includes(shared), `the surface template must keep: ${shared}`);
    assert.ok(core.includes(shared), `the core template must keep: ${shared}`);
  }

  // "Exactly four" counts report-body headings, not every "## " line: the
  // template's own headings belong to both lanes.
  for (const own of ['## DONE report template', '## Your report', '## What you run']) {
    assert.ok(surface.includes(own), `the surface template keeps its own heading ${own}`);
  }

  // The hash lines are the template's, not the lane's.
  const withAcs = [
    '## Acceptance criteria', '', '- slice-389-ac-1: the first thing is true', '',
  ].join('\n');
  const surfaceHashed = buildDoneTemplate({ ...TEMPLATE_ARGS, sliceContent: withAcs, lane: 'surface' });
  assert.match(surfaceHashed, /## Your hash lines/, 'a surface brief with criteria still gets its hash lines');
  assert.match(surfaceHashed, /@ac-hash: slice-389-ac-1 sha256:[0-9a-f]{64}/);
});

// ---------------------------------------------------------------------------
// Trap 4 — Slice 390 parses this trailer
// ---------------------------------------------------------------------------

test('slice-389-trap-4 the Lane trailer is exactly one line, one of two values, beside Slice-Id', () => {
  // Slice 390 parses this line the way the gate parses `AC:` — line-anchored,
  // one declaration per line. Two Lane lines, or a value the parser has to
  // interpret, and the gate reads a rigour setting nobody declared.
  cutSliceBranch('702');
  const result = squashSliceToDev('702', 'A surface slice', 'slice/702', 'surface');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  const msg = git(['log', '-1', '--format=%B', 'dev'], workDir);
  const laneLines = msg.split('\n').filter(l => /^Lane:/.test(l));
  assert.equal(laneLines.length, 1, `exactly one Lane trailer, got ${JSON.stringify(laneLines)}`);
  assert.equal(laneLines[0], 'Lane: surface', 'the trailer is the bare value, nothing appended');

  // Beside Slice-Id and Slice-Branch, in the trailer block.
  const lines = msg.split('\n');
  assert.ok(lines.indexOf('Lane: surface') > lines.indexOf('Slice-Branch: slice/702'),
    'the Lane trailer sits with the other slice trailers');

  // An unknown lane cannot reach the commit message as a third value.
  cutSliceBranch('706');
  const bogus = squashSliceToDev('706', 'A miscategorised slice', 'slice/706', 'lightweight');
  assert.equal(bogus.success, true, `squash must succeed: ${JSON.stringify(bogus)}`);
  assert.deepEqual(
    git(['log', '-1', '--format=%B', 'dev'], workDir).split('\n').filter(l => /^Lane:/.test(l)),
    ['Lane: core'],
    'an unknown lane is normalised to core before it is written, never passed through');
});

// ---------------------------------------------------------------------------
// Trap 5 — the ACCEPTED file is Sam's report, and it has no lane
// ---------------------------------------------------------------------------

test('slice-389-trap-5 the lane is never taken from the ACCEPTED report', () => {
  // The failure this guards: -ACCEPTED.md is first in readSliceMeta's suffix
  // list, and it is the DONE report renamed. Read the lane first-wins like the
  // title and it is always absent on the file checked first — and because the
  // loop used to break once title and branch were known, -PARKED.md was never
  // opened at all. Every squash would have said core, silently, forever.
  writeQueueFile('703', '-ACCEPTED.md', ['id: "703"', 'title: "Report title"', 'branch: "slice/703"']);
  writeQueueFile('703', '-PARKED.md', ['id: "703"', 'title: "Brief title"', 'lane: surface']);
  assert.equal(readSliceMeta('703').lane, 'surface',
    'a laneless ACCEPTED report must not shadow the surface lane declared in the brief');
  assert.equal(readSliceMeta('703').title, 'Report title',
    'title is still first-wins — only the lane is brief-only');

  // The reverse: a report cannot confer a lane on a brief that never declared one.
  writeQueueFile('704', '-ACCEPTED.md', ['id: "704"', 'title: "T"', 'branch: "slice/704"', 'lane: surface']);
  assert.equal(readSliceMeta('704').lane, 'core',
    'a lane on the report is not a declaration; with no PARKED brief the answer is core');

  // Nor may any other queue file speak for the brief.
  writeQueueFile('705', '-DONE.md', ['id: "705"', 'title: "T"', 'branch: "slice/705"', 'lane: surface']);
  writeQueueFile('705', '-IN_PROGRESS.md', ['id: "705"', 'title: "T"', 'lane: surface']);
  assert.equal(readSliceMeta('705').lane, 'core', 'only -PARKED.md carries the declaration');
});

// ---------------------------------------------------------------------------
// Trap 6 — the wiring no unit test can reach
// ---------------------------------------------------------------------------

test('slice-389-trap-6 the call sites are wired to the exported seams', () => {
  // Every function above can be correct while nothing calls it. These four
  // checks are the house pattern for the wiring a unit test cannot drive.
  const invoke = ORCH_SRC.slice(ORCH_SRC.indexOf('function invokeRom('));
  const invokeBody = invoke.slice(0, invoke.indexOf('\nfunction '));
  const romSpawnCalls = invokeBody.match(/romSpawnArgs\(\{/g) || [];
  assert.equal(romSpawnCalls.length, 1,
    'invokeRom must decide the spawn args in exactly one place — a second call site is a second answer');
  assert.match(invokeBody, /const clauseArgs = romSpawnArgs\(\{[\s\S]{0,400}?lane: romLane,[\s\S]{0,200}?\}\);/,
    'the spawned args must come from romSpawnArgs with the slice\'s lane');
  assert.ok(!/clauseArgs = \['--resume'/.test(invokeBody),
    'the resume path must not rebuild its own argument list beside romSpawnArgs');

  assert.match(ORCH_SRC, /registerEvent\(id, 'DONE', \{[\s\S]{0,400}?\.\.\.laneEventFields\(sliceMeta, clauseArgs\),/,
    'the DONE event must report the effort actually spawned, not the configured one');

  const accepted = ORCH_SRC.slice(ORCH_SRC.indexOf('function handleAccepted('));
  const acceptedBody = accepted.slice(0, accepted.indexOf('\nfunction '));
  assert.match(acceptedBody, /const lane = readSliceMeta\(id\)\.lane;/,
    'handleAccepted must read the lane through readSliceMeta, not parse a file a second time');
  assert.match(acceptedBody, /acceptAndMerge\(id, evaluatingPath, branchName, title, \{ lane \}\)/,
    'the lane must reach acceptAndMerge, or the trailer defaults to core on every landing');

  assert.match(ORCH_SRC, /const prompt = sliceContent \+ buildDoneTemplate\(\{ id, worktreeDonePath, sliceBranch, sliceContent, lane: romLane \}\);/,
    'the template glued to the brief must be built for the slice\'s lane');
  assert.match(ORCH_SRC, /slicePath: resolvedParkedPath,\s*\n\s*lane: resolveLane\(parseFrontmatter\(sliceContent\)\),/,
    'the reviewer prompt must be built for the slice\'s lane');

  // The pickup loop's commissioning call is pinned byte for byte by
  // j-finished-slice-not-redispatched, which is why the lane is resolved inside
  // registerCommissioned instead of being added here.
  assert.ok(ORCH_SRC.includes('registerCommissioned(id, { title, goal, body: sliceContent });'),
    'the pinned pickup call must stay byte for byte unchanged');
});

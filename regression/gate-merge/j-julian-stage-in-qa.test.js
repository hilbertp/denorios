'use strict';

/**
 * Journey: J-julian-stage-in-qa
 * Category: Gate & Merge
 *
 * Spec source: slice 363 — "Julian's stage becomes a real step: the IN_QA state and its
 * packet." First of three; the stage is not live until all three land.
 *
 * WHY THIS EXISTS: Julian's stage used to be the Ops merge button. A human pressed it,
 * `startGate()` spawned Bashir over the whole of dev at once, and what Bashir got was a
 * regex-cut `## Acceptance criteria` block from whichever file had survived archiving —
 * usually the builder's re-typed copy of the criteria, never the brief. Archival ran the
 * instant the squash landed, so the brief and the reviewer's verdict were already in
 * bridge/trash/ by the time anyone could have read them. This suite pins the replacement:
 * one stage per slice, started by the landing, holding the slice as {id}-IN_QA.md, fed a
 * fixed eight-item packet with no code in it, and archiving only once it has recorded
 * that it ran.
 *
 * What this pins (behaviour, not implementation):
 *   - a slice landing on the integration branch starts the stage with nobody pressing
 *     anything, and the two ways the button used to start it both refuse;
 *   - the slice wears the IN_QA name while the stage runs and the register says so;
 *   - IN_QA and the QA question sidecar are canonical on both sides of the queue, so the
 *     startup audit does not flag them and Ops can show them;
 *   - archival waits for the stage's result;
 *   - the built prompt is the eight items plus operational lines, and carries no diff and
 *     no line of a product source file, however much code the documents it is made of hold;
 *   - the authoring script no longer sends Julian into the product folders;
 *   - the panel names the slice under check, from server state, in a colour that is not green.
 *
 * Deliberately NOT asserted (and why):
 *   - the verdict, the two red exits and the Playwright run — they are the next two slices,
 *     and trap 3 asserts their ABSENCE here rather than their shape;
 *   - how the line renders in a browser (Julian's e2e owns the rendered page; the hooks and
 *     the server payload behind it ARE asserted here).
 *
 * #99992: every fixture lives in a per-test tmpdir with the orchestrator's dirs redirected,
 * and the gate mutex is injected — nothing here can create bridge/state/gate-running.json
 * and defer a real slice out from under the running daemon.
 */

// @ac-hash: slice-363-ac-1 sha256:5ae26caefed8993e1b97957a02d9315489b929f4eceb1b1341b0791749db56d3
// @ac-hash: slice-363-ac-2 sha256:51053c05bfa9c95b7f370e2bd33ded85ef059ef17192f5ca414867b268dc4b40
// @ac-hash: slice-363-ac-3 sha256:153a7d0a876e55b3eb2d2c6e9cf90c67439239a19ae1ac006baf9704beee3734
// @ac-hash: slice-363-ac-4 sha256:de6cbfff611a3e3dfa681ca78945cf8b6175b04c8ac3d6f7e7adaa470c23831f
// @ac-hash: slice-363-ac-5 sha256:5213f5e8bbd6130e8ad4bf93097194672fce3c191302d48669ae6e13fef846d0
// @ac-hash: slice-363-ac-6 sha256:d037330c3147acdadc9b2fcadd8825cd4e9bd3bc26c57c6d82ba11bf0d13e302
// @ac-hash: slice-363-ac-7 sha256:cf129b43b68e1c6b673992ed124acce62af88fbd3197b72ed9031f4fcce2e95f
// @ac-hash: slice-363-ac-8 sha256:8848de8b28af4dbe26236613fc470d1dd3113938f1c4b93b67c2c60eff051e1d

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const {
  GIT_ENV, initGitFixture, installGhStub, compileServer,
} = require('./j-merge-button-pass-helpers');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_SRC = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const DASH_HTML = path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html');
const AUTHOR_SCRIPT = path.join(REPO_ROOT, 'scripts', 'author-ac-test.js');

// Far outside the live slice range, so no fixture file can collide with a real slice and
// no worktree path under /tmp/ds9-worktrees/ that archival prunes can ever exist.
const ID = '99363';

// The code these fixture documents carry. Every one of them is exactly what must NOT reach
// Julian: a hunk in the report, a source fence in the brief, a quoted line in the verdict.
const PRODUCT_LINE = "const PORT = process.env.DASHBOARD_PORT ? 1 : 4747;";
const BRIEF_SOURCE_LINE = "function squashSliceToDev(sliceId) { return 'nope'; }";
const VERDICT_SOURCE_LINE = "if (fs.existsSync(archivedPath)) return { archived: false };";

// Shaped like a REAL brief, which is the whole point: the goal lives in the FRONTMATTER
// (`goal:`), never in the body, and the body opens `## What is broken`. A fixture that put
// the goal in the body would survive frontmatter-stripping and green a packet that had
// silently dropped the one sentence saying what the slice was for.
const BRIEF = [
  '---', `id: "${ID}"`, 'title: "Fixture slice"', 'lane: core', 'references: null',
  'goal: "THE-BRIEF-GOAL-SENTENCE — the stage starts by itself when the slice lands."',
  '---', '',
  '# Fixture slice', '',
  '## What is broken', '', 'The stage is not a step the pipeline takes by itself.', '',
  '## Tasks', '', '1. Do the thing.', '',
  '```js', BRIEF_SOURCE_LINE, '```', '',
  '## Traps', '', '1. THE-BRIEF-TRAP-SENTENCE must hold.', '',
  '## Acceptance criteria', '', `- slice-${ID}-ac-1: it works`, '',
  '## Nog Review — Round 1', '', 'THE-ROUND-ONE-NOTE.', '',
].join('\n');

const REPORT = [
  '---', `id: "${ID}"`, 'title: "Fixture slice"', `branch: "slice/${ID}"`, 'status: DONE', '---', '',
  '## Summary', '', 'THE-ROM-SUMMARY-SENTENCE.', '',
  '## Screen hooks', '', '- `#qa-stage-line` — visible when a slice is in QA.', '',
  '## Tests moved or weakened', '', '- THE-MOVED-TEST-LINE (renamed, same assertions).', '',
  '## Commit', '', 'abc1234', '',
  '```diff',
  'diff --git a/dashboard/server.js b/dashboard/server.js',
  '--- a/dashboard/server.js',
  '+++ b/dashboard/server.js',
  '@@ -8,1 +8,1 @@',
  `-${PRODUCT_LINE}`,
  '+const PORT = 4747;',
  '```', '',
].join('\n');

const VERDICT = [
  '---', 'verdict: ACCEPTED', '---', '',
  '## Nog Review — Round 1', '', 'THE-NOG-VERDICT-SENTENCE. Accepted.', '',
  '```js', VERDICT_SOURCE_LINE, '```', '',
].join('\n');

// ── Orchestrator fixture ─────────────────────────────────────────────────────
// The orchestrator is a singleton with test seams for its directories. The gate mutex is
// NOT one of them by default — it resolves to the live bridge/state/gate-running.json — so
// every stage call here injects a fake, and the real daemon never sees a thing.
const FAKE_MUTEX = { acquire: () => ({ ok: true }), release: () => {} };

function orchFixture(label, { landed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  for (const d of ['bridge/queue', 'bridge/staged', 'bridge/trash', 'bridge/state']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  const queueDir = path.join(root, 'bridge', 'queue');
  const trashDir = path.join(root, 'bridge', 'trash');
  const stateDir = path.join(root, 'bridge', 'state');
  const regFile = path.join(root, 'bridge', 'register.jsonl');
  fs.writeFileSync(regFile, '');
  fs.writeFileSync(path.join(stateDir, 'branch-state.json'),
    JSON.stringify({ dev: { deferred_slices: [] }, gate: { status: 'IDLE' } }));

  // The queue exactly as a landing leaves it: the brief with its review round, the
  // builder's report under the name the landing commit gave it, and the reviewer's
  // verdict where the ACCEPT path puts it.
  fs.writeFileSync(path.join(queueDir, `${ID}-PARKED.md`), BRIEF);
  fs.writeFileSync(path.join(queueDir, `${ID}-${landed ? 'ARCHIVED' : 'ACCEPTED'}.md`), REPORT);
  fs.writeFileSync(path.join(trashDir, `${ID}-NOG.md.pass`), VERDICT);

  const orch = require(ORCH_SRC);
  orch._testSetDirs(queueDir, path.join(root, 'bridge', 'staged'), trashDir);
  orch._testSetRegisterFile(regFile);
  orch._testSetProjectDir(root);

  const events = () => fs.readFileSync(regFile, 'utf8').trim().split('\n')
    .filter(Boolean).map(l => JSON.parse(l));

  return {
    root, queueDir, trashDir, stateDir, regFile, orch, events,
    opts: { branchName: `slice/${ID}`, title: 'Fixture slice', queueDir, trashDir, stateDir,
            changedFiles: ['dashboard/server.js'], spawn: () => null, mutex: FAKE_MUTEX },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

// ── Dashboard-server fixture ─────────────────────────────────────────────────
function request(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function serverFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  for (const d of ['bridge/queue', 'bridge/staged', 'bridge/trash', 'bridge/control',
                   'bridge/errors', 'bridge/state', 'dashboard', 'regression', 'scripts']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'bridge', 'register.jsonl'), '');
  fs.writeFileSync(path.join(root, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }));
  fs.writeFileSync(path.join(root, 'bridge', 'queue-order.json'), '[]');
  fs.writeFileSync(path.join(root, 'bridge', 'staged-order.json'), '[]');
  fs.writeFileSync(path.join(root, 'bridge', 'sessions.jsonl'), '');
  fs.writeFileSync(path.join(root, 'bridge', 'first-output.json'), '{}');
  fs.writeFileSync(path.join(root, 'bridge', 'nog-active.json'), '{}');
  fs.writeFileSync(path.join(root, 'bridge', 'state', 'branch-state.json'), '{}');
  fs.writeFileSync(path.join(root, 'regression', 'COVERAGE.lock'), JSON.stringify({ bySource: {} }));
  fs.writeFileSync(path.join(root, 'regression', 'AC-DECISIONS.json'), '{}');
  fs.cpSync(path.join(REPO_ROOT, 'lib'), path.join(root, 'lib'), { recursive: true });

  const binDir = path.join(root, 'bin');
  installGhStub(binDir, path.join(root, 'gh-stub'));
  const prevPath = process.env.PATH;
  const prevEnv = {};
  for (const k of Object.keys(GIT_ENV)) prevEnv[k] = process.env[k];
  process.env.PATH = binDir + path.delimiter + process.env.PATH;
  Object.assign(process.env, GIT_ENV);
  initGitFixture({ workDir: root, originDir: path.join(root, 'origin.git') });

  const exported = compileServer(root);
  await new Promise(r => exported.server.listen(0, '127.0.0.1', r));
  const port = exported.server.address().port;

  return {
    root, exported, port,
    queueDir: path.join(root, 'bridge', 'queue'),
    req: (m, u) => request(port, m, u),
    teardown: async () => {
      await new Promise(r => exported.server.close(r));
      process.env.PATH = prevPath;
      for (const k of Object.keys(prevEnv)) {
        if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// ── AC-1 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-1 — a landing starts the stage by itself, and the merge button no longer starts it', async () => {
  const fx = orchFixture('j-qa-ac1-');
  try {
    // Nobody presses anything: this is what the landing paths call, and a slice that has
    // just reached the integration branch is in QA when it returns.
    const started = fx.orch.startQaStageOrArchive(ID, fx.opts);
    assert.equal(started.started, true, 'a landed slice must start its own stage');
    assert.ok(fs.existsSync(path.join(fx.queueDir, `${ID}-IN_QA.md`)),
      'the stage must be holding the slice');

    // Both landing paths go through that entry point rather than archiving on the spot.
    const src = fs.readFileSync(ORCH_SRC, 'utf8');
    const accepted = src.slice(src.indexOf('function handleAccepted('),
                               src.indexOf('function countNogRounds('));
    assert.match(accepted, /startQaStageOrArchive\(/,
      'handleAccepted must start the stage when the squash lands');
    assert.doesNotMatch(accepted, /archiveAcceptedSlice\(/,
      'handleAccepted must no longer archive at squash time');
    const drain = src.slice(src.indexOf('function drainDeferredAfterGate('),
                            src.indexOf('function mergeDevToMain('));
    assert.match(drain, /startQaStageOrArchive\(/,
      'a drained slice must start its stage the same way');

    // …and starting it must not be able to land the same slice twice. A start that fails
    // (no prompt template, `claude` not spawnable) calls finishQaStage, which ends by
    // draining — from inside the drain that called it. Two things stop the double-squash:
    // the landed slice leaves deferred_slices BEFORE its stage starts, and a nested drain
    // is a no-op instead of re-walking the list this loop is part-way through.
    const removeAt = drain.indexOf('deferred_slices = (branchState.dev.deferred_slices || []).filter');
    const startAt = drain.indexOf('startQaStageOrArchive(');
    assert.ok(removeAt > -1 && startAt > -1 && removeAt < startAt,
      'a slice that has landed must leave deferred_slices before its stage starts');
    assert.match(drain, /if \(_draining\)/,
      'the drain must refuse to re-enter itself');
  } finally {
    fx.cleanup();
  }

  // The old press is gone on both sides: the function refuses, and so does the endpoint.
  const orch = require(ORCH_SRC);
  assert.throws(() => orch.startGate(), err => err.code === 'GATE_RETIRED',
    'startGate must refuse — the stage is per-slice and starts itself');

  const sv = await serverFixture('j-qa-ac1-srv-');
  try {
    const res = await sv.req('POST', '/api/gate/start');
    assert.equal(res.status, 410, "the merge button's old gate endpoint must be retired");
    assert.equal(res.body.error, 'gate-start-retired');
    // Not merely unreachable: the server no longer imports the thing that spawns Bashir,
    // so no later edit to that handler can quietly wake it up. (A comment naming the
    // retired function is fine — a require of it is not.)
    const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'server.js'), 'utf8');
    const code = serverSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /startGate/,
      'the server must not be able to spawn the gate at all');
  } finally {
    await sv.teardown();
  }
});

// ── AC-2 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-2 — the slice is renamed to the in-QA state while the stage runs and the register says so', () => {
  const fx = orchFixture('j-qa-ac2-');
  try {
    fx.orch.startQaStage(ID, fx.opts);

    const names = fs.readdirSync(fx.queueDir);
    assert.ok(names.includes(`${ID}-IN_QA.md`), `the slice file must be ${ID}-IN_QA.md while the stage runs`);
    assert.ok(!names.includes(`${ID}-ARCHIVED.md`) && !names.includes(`${ID}-ACCEPTED.md`),
      'the name it had before must not still be there beside it');

    const inQa = fx.events().filter(e => e.event === 'IN_QA');
    assert.equal(inQa.length, 1, 'exactly one IN_QA event must be emitted when the stage starts');
    assert.equal(inQa[0].slice_id, ID);
    assert.ok(inQa[0].started_ts, 'the event must record when the stage started');

    // The other end of the state: a daemon that dies mid-stage leaves the slice wearing
    // IN_QA. Startup recovery reads the gate mutex to tell the two cases apart, and the
    // mutex has an answer only because this runs AFTER recoverGateMutex — which keeps the
    // mutex exactly when Julian's heartbeat is still fresh.
    const stillWriting = fx.orch.recoverOrphanedQaStages(
      Object.assign({}, fx.opts, { mutex: Object.assign({}, FAKE_MUTEX, { held: () => true }) }));
    assert.deepEqual(stillWriting, [],
      'a stage whose Julian outlived the daemon is his to finish, not startup recovery\'s');
    assert.ok(fs.existsSync(path.join(fx.queueDir, `${ID}-IN_QA.md`)),
      'a live stage must still be holding its slice after recovery ran');
    assert.deepEqual(fx.events().filter(e => e.event === 'QA_STAGE_RECORDED'), [],
      'recovery must not record a result for a stage that is still running');

    // Mutex gone: the stage died with the daemon, and the slice must not stay pinned in QA
    // with its worktree, its branch and its ARCHIVED event outstanding.
    const orphaned = fx.orch.recoverOrphanedQaStages(
      Object.assign({}, fx.opts, { mutex: Object.assign({}, FAKE_MUTEX, { held: () => false }) }));
    assert.deepEqual(orphaned.map(a => a.id), [ID], 'a stage that died with the daemon must be recovered');
    const recorded = fx.events().filter(e => e.event === 'QA_STAGE_RECORDED');
    assert.equal(recorded.length, 1, 'the orphaned stage must record exactly one result');
    assert.equal(recorded[0].outcome, 'stage_error',
      'an orphaned stage is an error — never anything that reads as a pass');

    // And the order it depends on is the order the startup block actually has.
    const startup = fs.readFileSync(ORCH_SRC, 'utf8');
    const from = startup.indexOf('const recoveryActions = crashRecovery()');
    assert.ok(from > -1, 'the startup recovery block must still be findable');
    const block = startup.slice(from, startup.indexOf('printStartupBlock(recoveryActions)', from));
    const mutexAt = block.indexOf('recoverGateMutex(');
    const qaAt = block.indexOf('recoverOrphanedQaStages(');
    assert.ok(mutexAt > -1 && qaAt > -1 && mutexAt < qaAt,
      'IN_QA recovery must run after the gate-mutex recovery, never before it');
  } finally {
    fx.cleanup();
  }
});

// ── AC-3 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-3 — the in-QA and question suffixes are whitelisted, so the audit stays quiet and Ops can read them', async () => {
  const fx = orchFixture('j-qa-ac3-');
  try {
    assert.ok(fx.orch.CANONICAL_LIVE_SUFFIXES.includes('-IN_QA.md'));
    assert.ok(fx.orch.CANONICAL_LIVE_SUFFIXES.includes('-QA_QUESTION.md'));

    // The startup audit, run over a queue holding both: neither is residue.
    fs.writeFileSync(path.join(fx.queueDir, `${ID}-IN_QA.md`), REPORT);
    fs.writeFileSync(path.join(fx.queueDir, `${ID}-QA_QUESTION.md`), '## Question\n\nWhich journey?\n');
    fx.orch.auditLegacyFiles({ queueDir: fx.queueDir });
    const flagged = fx.events().filter(e => e.event === 'LEGACY_FILES_DETECTED');
    assert.deepEqual(flagged, [], 'the startup audit must not flag the stage files as legacy residue');

    // And a genuinely unknown suffix still IS flagged — the whitelist widened, not dissolved.
    fs.writeFileSync(path.join(fx.queueDir, `${ID}-BRIEF.md`), 'residue');
    fx.orch.auditLegacyFiles({ queueDir: fx.queueDir });
    assert.equal(fx.events().filter(e => e.event === 'LEGACY_FILES_DETECTED').length, 1,
      'pre-terminology residue must still be flagged');
  } finally {
    fx.cleanup();
  }

  // The Ops half of the same map.
  const sv = await serverFixture('j-qa-ac3-srv-');
  try {
    assert.equal(sv.exported.QUEUE_SUFFIX_STATE['-IN_QA.md'], 'IN_QA',
      "the Ops suffix-to-state map must know the stage's state");
    assert.deepEqual(sv.exported.queueStateOf(`${ID}-IN_QA.md`), { id: ID, state: 'IN_QA' });
    assert.equal(sv.exported.isQueueSidecar(`${ID}-QA_QUESTION.md`), true,
      'the question file is a sidecar, not a state');
    assert.equal(sv.exported.queueStateOf(`${ID}-QA_QUESTION.md`), null,
      'no slice is ever "in QA_QUESTION"');
  } finally {
    await sv.teardown();
  }
});

// ── AC-4 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-4 — archival happens when the stage records its result, not at squash time', () => {
  const fx = orchFixture('j-qa-ac4-');
  try {
    fx.orch.startQaStage(ID, fx.opts);

    // Mid-stage: nothing has been archived. The brief and the verdict are still readable.
    assert.deepEqual(fx.events().filter(e => e.event === 'ARCHIVED'), [],
      'archival must not have happened while the stage is running');
    assert.ok(fs.existsSync(path.join(fx.queueDir, `${ID}-PARKED.md`)),
      'the brief must still be in the queue while the stage runs');

    const fin = fx.orch.finishQaStage(ID, 'recorded', fx.opts);
    assert.equal(fin.recorded, true);
    assert.equal(fin.archived, true, 'the result is what releases the archival');

    const order = fx.events().map(e => e.event);
    assert.ok(order.indexOf('QA_STAGE_RECORDED') < order.indexOf('ARCHIVED'),
      `the result must be recorded before the ARCHIVED event: ${order.join(' → ')}`);
    assert.ok(fs.existsSync(path.join(fx.queueDir, `${ID}-ARCHIVED.md`)));
    assert.ok(!fs.existsSync(path.join(fx.queueDir, `${ID}-PARKED.md`)),
      'the sweep runs with the archival, at the end');

    // The run is measured: start, end and outcome, for one stage.
    const run = JSON.parse(fs.readFileSync(path.join(fx.stateDir, `qa-stage-${ID}.json`), 'utf8'));
    assert.ok(run.started_ts && run.ended_ts, 'the stage must record when it ran');
  } finally {
    fx.cleanup();
  }
});

// ── AC-5 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-5 — the built prompt carries the eight packet items and, beyond them, only operational lines', () => {
  const fx = orchFixture('j-qa-ac5-');
  try {
    const prompt = fx.orch.buildBashirPrompt(ID, {
      queueDir: fx.queueDir, trashDir: fx.trashDir, changedFiles: ['dashboard/server.js'],
    });
    const headings = fx.orch.qaStage.promptHeadings(prompt);

    const eight = [
      '1. The slice file', "2. Rom's DONE report", "3. Nog's verdict and review",
      '4. Changed files (names only)', '5. Screen hooks', '6. Tests Rom moved or weakened',
      '7. The live dashboard', '8. Break-it result',
    ];
    for (const item of eight) {
      assert.ok(headings.includes(item), `packet item missing from the prompt: ${item}`);
    }
    // Nothing beyond them but the operational lines — the heading list IS the contract, so
    // a ninth thing smuggled in shows up here.
    const operational = ['Mutex contract', 'Where you write'];
    const extra = headings.filter(h => !eight.includes(h) && !operational.includes(h));
    assert.deepEqual(extra, [], `the prompt carries something beyond the eight: ${extra.join(', ')}`);

    // Each item is actually FILLED, not an empty heading: the brief as written (goal, tasks,
    // traps, criteria), the report, the verdict, the names, the hooks, the moved tests.
    // Item 1 is the WHOLE slice file. In a real brief the goal is a frontmatter field, so
    // a packet built from the body alone drops the one sentence saying what the slice was
    // for — which is the field Julian judges the shipped slice against.
    assert.match(prompt, /THE-BRIEF-GOAL-SENTENCE/, 'item 1: the goal, which lives in the frontmatter');
    assert.match(prompt, /lane: core/, 'item 1: the frontmatter goes over whole, not just the goal');
    assert.match(prompt, /THE-BRIEF-TRAP-SENTENCE/, 'item 1: including its traps');
    assert.match(prompt, new RegExp(`slice-${ID}-ac-1`), 'item 1: including the tagged criteria');
    assert.match(prompt, /THE-ROUND-ONE-NOTE/, 'item 1: including every review round');
    assert.match(prompt, /THE-ROM-SUMMARY-SENTENCE/, "item 2: Rom's report");
    assert.match(prompt, /THE-NOG-VERDICT-SENTENCE/, "item 3: Nog's verdict");
    assert.match(prompt, /dashboard\/server\.js/, 'item 4: the changed file NAME');
    assert.match(prompt, /#qa-stage-line/, 'item 5: the screen hooks');
    assert.match(prompt, /THE-MOVED-TEST-LINE/, 'item 6: the tests Rom moved');
    assert.match(prompt, /http:\/\/localhost:\d+/, 'item 7: where to look at the product');
    assert.match(prompt, /break-it script is the next slice/i,
      'item 8: the placeholder the next slice fills');
  } finally {
    fx.cleanup();
  }
});

// ── AC-6 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-6 — the built prompt contains no diff and no line of any product source file', () => {
  const fx = orchFixture('j-qa-ac6-');
  try {
    const prompt = fx.orch.buildBashirPrompt(ID, {
      queueDir: fx.queueDir, trashDir: fx.trashDir, changedFiles: ['dashboard/server.js'],
    });

    // The documents this packet is made of ALL carry code — that is the point of the
    // fixture. The prose survives; the code does not.
    assert.match(prompt, /THE-ROM-SUMMARY-SENTENCE/, 'the prose must survive the redaction');
    assert.ok(!prompt.includes('diff --git'), 'the prompt must never carry a diff');
    assert.ok(!prompt.includes('@@ -'), 'not even a hunk header');
    assert.ok(!prompt.includes('--- a/'), 'nor a diff file header');
    assert.ok(!prompt.includes(PRODUCT_LINE),
      'no line of a product source file, however it was pasted into the report');
    assert.ok(!prompt.includes(BRIEF_SOURCE_LINE),
      'a source fence in the brief is still product source');
    assert.ok(!prompt.includes(VERDICT_SOURCE_LINE),
      "the reviewer quoting the code he objected to must not hand it over either");
    assert.match(prompt, /information-only/i,
      'and the prompt must say why he does not go looking for it');
  } finally {
    fx.cleanup();
  }
});

// ── AC-7 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-7 — the explore-the-repo instruction and the product-folder list are gone from the authoring script', () => {
  const src = fs.readFileSync(AUTHOR_SCRIPT, 'utf8');
  // Slice 359 moved the prompt into promptFor(draftsDir) so every path it names points
  // inside the sandbox. Same prompt, new address: re-anchored on the function, not on the
  // `const prompt = \`` line that used to hold it. Every assertion below is unchanged.
  const prompt = src.slice(src.indexOf('function promptFor('), src.indexOf('// \u2500\u2500 The box'));
  assert.ok(prompt.length > 0, 'the authoring prompt must still be there to check');

  assert.doesNotMatch(prompt, /explore the repo/i,
    'the "explore the repo" instruction is the opposite of information-only');
  assert.doesNotMatch(prompt, /\(dashboard\/, lib\/, scripts\/, server\)/,
    'the product-folder list must be gone');
  assert.doesNotMatch(prompt, /infer the intent from the codebase/i,
    'nor may it point him at the codebase when the AC text is missing');

  // Replaced, not merely deleted: the rule that takes its place is stated.
  assert.match(prompt, /INFORMATION-ONLY/,
    'the packet replaces the exploration — say so');
  assert.match(prompt, /regression\/\*\*\/\*\.test\.js/,
    'he still reads the suites: those are his own files');
});

// ── AC-8 ─────────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa slice-363-ac-8 — the panel names the slice under check, never renders green while running, and survives a reload', async () => {
  const sv = await serverFixture('j-qa-ac8-srv-');
  try {
    // Nothing in QA: no line.
    const idle = await sv.req('GET', '/api/branch-state');
    assert.equal(idle.body.qa_stage, null, 'no line when no slice is in QA');

    // A slice in QA. The payload is derived from the queue directory on every request, so
    // this IS the reload case: a fresh client, no accumulated events, same answer.
    fs.writeFileSync(path.join(sv.queueDir, `${ID}-IN_QA.md`), REPORT);
    const running = await sv.req('GET', '/api/branch-state');
    assert.ok(running.body.qa_stage, 'the panel must be told a stage is running');
    assert.equal(running.body.qa_stage.slice_id, ID, 'and which slice it is checking');
    assert.equal(running.body.qa_stage.status, 'IN_QA');

    const reload = await sv.req('GET', '/api/branch-state');
    assert.deepEqual(reload.body.qa_stage, running.body.qa_stage,
      'a reload mid-stage must read the same thing');

    // A slice in QA is not also queue work waiting on the builder.
    const bridge = sv.exported.buildBridgeData();
    assert.ok(!bridge.slices.some(s => String(s.id) === ID),
      'a slice in QA has landed — it must not sit in the queue panel as live work');

    // And the stage ends by the file going away, never by the payload going stale.
    fs.unlinkSync(path.join(sv.queueDir, `${ID}-IN_QA.md`));
    const done = await sv.req('GET', '/api/branch-state');
    assert.equal(done.body.qa_stage, null, 'the line must not outlive the stage');
  } finally {
    await sv.teardown();
  }

  // The line itself: named, wired to the payload, and NOT green while it runs.
  const html = fs.readFileSync(DASH_HTML, 'utf8');
  assert.match(html, /id="qa-stage-line"/, 'the panel needs a stable hook for the line');
  assert.match(html, /Julian is writing browser tests for slice/,
    'the line must name what is happening, to which slice');
  assert.match(html, /renderQaStage\(data\.qa_stage\)/,
    'the line must be rendered from the server payload, not from a client-side event');
  const css = html.slice(html.indexOf('.qa-stage-line {'), html.indexOf('.qa-stage-line {') + 600);
  assert.match(css, /--warn-/, 'a running stage reads as in-progress');
  assert.doesNotMatch(css, /--ok\b/,
    'never green while running — this stage records no verdict at all yet');
});

// ── TRAP 1 ───────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa trap-1 slice-363-ac-6 — the packet and the sticker carry no diff and no product source, whatever the documents held', () => {
  const fx = orchFixture('j-qa-trap1-');
  try {
    const packet = fx.orch.qaStage.assemblePacket(ID, {
      queueDir: fx.queueDir, trashDir: fx.trashDir, changedFiles: ['dashboard/server.js'],
    });
    const blob = JSON.stringify(packet);
    for (const forbidden of ['diff --git', '@@ -', PRODUCT_LINE, BRIEF_SOURCE_LINE, VERDICT_SOURCE_LINE]) {
      assert.ok(!blob.includes(forbidden), `the packet must not carry: ${forbidden}`);
    }
    // Names only — never contents.
    assert.deepEqual(packet.changedFiles, ['dashboard/server.js']);

    const sticker = fx.orch.qaStage.buildSticker(ID, packet, { title: 'Fixture slice' });
    for (const forbidden of ['diff --git', '@@ -', PRODUCT_LINE, BRIEF_SOURCE_LINE, VERDICT_SOURCE_LINE]) {
      assert.ok(!sticker.includes(forbidden), `the sticker must not carry: ${forbidden}`);
    }
    // What survives archive is the whole record, not just the builder's report.
    assert.match(sticker, /THE-BRIEF-GOAL-SENTENCE/, 'the brief survives');
    assert.match(sticker, /THE-ROUND-ONE-NOTE/, 'with every review round');
    assert.match(sticker, /THE-ROM-SUMMARY-SENTENCE/, "the builder's report survives");
    assert.match(sticker, /THE-NOG-VERDICT-SENTENCE/, "the reviewer's verdict survives");
    assert.match(sticker, /## Julian's result/, "and there is a slot for Julian's result");
  } finally {
    fx.cleanup();
  }
});

// ── TRAP 2 ───────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa trap-2 slice-363-ac-4 — the file is still there for the stage to rename, and the packet is made before the sweep', () => {
  const fx = orchFixture('j-qa-trap2-');
  try {
    // The failure this guards: archival at squash sweeps the brief and the verdict into
    // bridge/trash/ and renames the report, so a stage starting a moment later finds an
    // empty queue and a packet with nothing in it.
    fx.orch.startQaStage(ID, fx.opts);
    const inQa = fs.readFileSync(path.join(fx.queueDir, `${ID}-IN_QA.md`), 'utf8');
    assert.match(inQa, /THE-BRIEF-GOAL-SENTENCE/, 'the brief was still readable when the stage started');
    assert.match(inQa, /THE-NOG-VERDICT-SENTENCE/, 'and so was the verdict');

    // Archival then finds the slice under its IN_QA name and completes normally.
    fx.orch.finishQaStage(ID, 'recorded', fx.opts);
    const archived = fs.readFileSync(path.join(fx.queueDir, `${ID}-ARCHIVED.md`), 'utf8');
    assert.match(archived, /THE-BRIEF-GOAL-SENTENCE/, 'and the record survives the archival');
  } finally {
    fx.cleanup();
  }

  // Even reached directly, archival must know the name the stage gave the slice — a rename
  // it cannot find is a slice stranded in QA forever.
  const fx2 = orchFixture('j-qa-trap2b-', { landed: false });
  try {
    fs.renameSync(path.join(fx2.queueDir, `${ID}-ACCEPTED.md`),
                  path.join(fx2.queueDir, `${ID}-IN_QA.md`));
    const res = fx2.orch.archiveAcceptedSlice(ID, `slice/${ID}`,
      { queueDir: fx2.queueDir, trashDir: fx2.trashDir });
    assert.equal(res.archived, true, 'archival must accept the IN_QA file as its source');
    assert.ok(fs.existsSync(path.join(fx2.queueDir, `${ID}-ARCHIVED.md`)));
  } finally {
    fx2.cleanup();
  }
});

// ── TRAP 3 ───────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa trap-3 slice-363-ac-4 — no verdict, no red exits and no browser run are wired here', () => {
  const fx = orchFixture('j-qa-trap3-');
  try {
    fx.orch.startQaStage(ID, fx.opts);
    fx.orch.finishQaStage(ID, 'recorded', fx.opts);

    // A half-built verdict path that can go green is worse than none. Nothing this stage
    // emits may be read as a pass.
    const names = fx.events().map(e => e.event);
    for (const verdictish of ['QA_GREEN', 'QA_RED', 'regression-pass', 'regression-fail', 'GATE_PASSED']) {
      assert.ok(!names.includes(verdictish),
        `this slice must not emit a verdict event: ${verdictish}`);
    }
    const recorded = fx.events().find(e => e.event === 'QA_STAGE_RECORDED');
    assert.ok(recorded, 'the stage records that it ran');
    assert.ok(!/pass|green|accepted/i.test(String(recorded.outcome)),
      `the recorded outcome must not read as a pass: ${recorded.outcome}`);

    // No red exit is built yet either: no per-slice handoff, no question file.
    assert.ok(!fs.existsSync(path.join(fx.queueDir, `${ID}-QA_QUESTION.md`)),
      'the unclear-criterion exit is the next slice, not this one');
  } finally {
    fx.cleanup();
  }

  // And the stage does not run the browser suite — that is the third slice's job.
  const src = fs.readFileSync(ORCH_SRC, 'utf8');
  const stage = src.slice(src.indexOf('function startQaStage('),
                          src.indexOf('function startQaStageOrArchive('));
  assert.doesNotMatch(stage, /playwright/i, 'the stage must not run Playwright yet');
  assert.doesNotMatch(stage, /regression-pass|regression-fail/,
    'nor emit a suite verdict');
});

// ── TRAP 4 ───────────────────────────────────────────────────────────────────
test('J-julian-stage-in-qa trap-4 slice-363-ac-5 — the e2e fixtures and specs are Julian\'s own files, and the prompt says so', () => {
  const fx = orchFixture('j-qa-trap4-');
  try {
    const prompt = fx.orch.buildBashirPrompt(ID, { queueDir: fx.queueDir, trashDir: fx.trashDir });
    assert.match(prompt, /e2e\/seed-fixture\.js/,
      'the seed fixture is his — name it so he knows he may touch it');
    assert.match(prompt, /read them and extend them/i,
      'the prompt must say he reads and extends his own suite');
    assert.match(prompt, /e2e\/\*\.spec\.js/,
      'the existing specs are his own files too');
    // ...and they are NOT product code, so nothing about them may read as forbidden.
    const whereYouWrite = prompt.slice(prompt.indexOf('## Where you write'),
                                       prompt.indexOf('## 1. The slice file'));
    assert.doesNotMatch(whereYouWrite, /never\s+read/i,
      'his own test files must not be caught by the information-only rule');
  } finally {
    fx.cleanup();
  }
});

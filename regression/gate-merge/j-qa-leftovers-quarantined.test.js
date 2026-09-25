'use strict';

/**
 * Journey: J-qa-leftovers-quarantined
 * Category: Gate & Merge
 *
 * Spec source: slice 407 — "Files Julian's stage leaves behind never block a landing."
 *
 * WHY THIS EXISTS: Julian's stage runs `claude -p` in the LIVE working tree. Three stages
 * out of three after the 09-24 restart (401, 368, 396) ended stage_error or heartbeat_stale
 * and left an untracked `e2e/*.spec.js` sitting in that tree. The next landing then refused,
 * every time: the lock derivers read the tree, so an uncommitted test file would be written
 * into a lock that is supposed to describe the COMMITTED suite, and the landing's step-1
 * guard says no. That guard is right and stays — three real landings (402, 397, 405) were
 * blocked by it, and the fix is not to weaken it but to clear up after the stage.
 *
 * What this pins (behaviour, not implementation):
 *   - however the stage ends — heartbeat_stale, the absolute cap, a non-zero exit, a spawn
 *     error, or an ordinary exit 0 — a lock-deriver input Julian left uncommitted is MOVED
 *     to bridge/quarantine/qa-<id>/<path>, content for content, and the register says so;
 *   - the clear-up waits for his process, because SIGTERM is where the stage ends and not
 *     where he does: a file written in that window is still swept, and a process that never
 *     dies is given a grace and then swept anyway;
 *   - the working tree is SHARED, so what was already uncommitted when the stage started is
 *     never touched and never claimed in the event — moving it would delete somebody's work;
 *   - a tracked file he modified goes back to its committed content, with his version kept;
 *   - anything that is not a lock-deriver input is left exactly alone, and a clean stage
 *     writes no event at all;
 *   - and the point of the whole slice: the landing that follows such a stage regenerates
 *     its locks instead of failing lock_regen_failed.
 *
 * Deliberately NOT asserted (and why):
 *   - why Julian's heartbeat goes stale on every stage — proposed follow-up, and
 *     ADR-JULIAN-ALONGSIDE may rebuild the stage that owns it;
 *   - running Julian in his own worktree, which would remove the shared tree entirely
 *     (ADR-JULIAN-ALONGSIDE step D). This slice assumes the shared tree and survives it.
 *
 * #99992: every fixture is a throwaway git repo under a per-test tmpdir with the
 * orchestrator's dirs, register, project dir, gate mutex, spawn, heartbeat file and both
 * liveness clocks redirected into it. Nothing here can read or write live state — and in
 * particular nothing can touch the real bridge/state/bashir-heartbeat.json, whose mtime is
 * what tells the daemon whether a real Julian is alive.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');

const { GIT_ENV, git, commitFile, initGitFixture } = require('./j-merge-button-pass-helpers');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_SRC = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');

// Far outside the live slice range, so no fixture file can collide with a real slice and no
// worktree path under /tmp/ds9-worktrees/ that archival prunes can ever exist.
const ID = '99407';

// The tracked lock-deriver input every fixture commits: this is the file ac-5 restores.
const TRACKED_TEST = 'regression/j-fixture-committed.test.js';
const COMMITTED_BODY = "// committed: the content the landing commit has\n";

const LOCK_BODY = JSON.stringify({ generator: 'fixture', guardCount: 0, bySource: {} }, null, 2) + '\n';

// Stub derivers. The landing runs `node scripts/build-*.js` in the working tree; what they
// compute is not what ac-7 is about, and the real ones are Rom's to never run. These write
// the committed lock body back, so the landing's own "did a lock move?" step is honest.
const stubDeriver = (lockName) => [
  "const fs = require('fs'); const path = require('path');",
  `fs.writeFileSync(path.join(__dirname, '..', 'regression', '${lockName}'), ${JSON.stringify(LOCK_BODY)});`,
  '',
].join('\n');

// Queue documents shaped like a landing leaves them, so the stage assembles its packet and
// gets as far as spawning. Nothing here is read by the assertions.
const BRIEF = ['---', `id: "${ID}"`, 'title: "Fixture slice"', 'lane: core', 'references: null',
  'goal: "A fixture slice."', '---', '', '# Fixture slice', '', '## Acceptance criteria', '',
  `- slice-${ID}-ac-1: it works`, ''].join('\n');
const REPORT = ['---', `id: "${ID}"`, 'status: DONE', `branch: "slice/${ID}"`, '---', '',
  '## Summary', '', 'A fixture report.', '', '## Screen hooks', '', 'None.', ''].join('\n');
const VERDICT = ['---', 'verdict: ACCEPTED', '---', '', '## Nog Review — Round 1', '', 'Accepted.', ''].join('\n');

// The gate mutex is live machine state shared with the running daemon, never a default seam.
const FAKE_MUTEX = { acquire: () => ({ ok: true }), release: () => {} };

// ── fixture ──────────────────────────────────────────────────────────────────

function fixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  for (const d of ['bridge/queue', 'bridge/staged', 'bridge/trash', 'bridge/state', 'e2e', 'regression', 'scripts']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }

  initGitFixture({ workDir: root, originDir: path.join(root, 'origin.git') });
  // Local identity and no signing: the landing's `git commit --amend` is production code and
  // runs with no env help from the test.
  git(['config', 'user.name', 'Rom Fixture'], root);
  git(['config', 'user.email', 'rom@fixture.test'], root);
  git(['config', 'commit.gpgsign', 'false'], root);

  commitFile(root, TRACKED_TEST, COMMITTED_BODY, 'seed: a committed safety-net test');
  commitFile(root, 'regression/COVERAGE.lock', LOCK_BODY, 'seed: coverage lock');
  commitFile(root, 'regression/AC-MANIFEST.lock', LOCK_BODY, 'seed: ac manifest lock');
  commitFile(root, 'scripts/build-coverage-map.js', stubDeriver('COVERAGE.lock'), 'seed: stub deriver');
  commitFile(root, 'scripts/build-ac-manifest.js', stubDeriver('AC-MANIFEST.lock'), 'seed: stub deriver');

  const queueDir = path.join(root, 'bridge', 'queue');
  const trashDir = path.join(root, 'bridge', 'trash');
  const stateDir = path.join(root, 'bridge', 'state');
  fs.writeFileSync(path.join(queueDir, `${ID}-PARKED.md`), BRIEF);
  fs.writeFileSync(path.join(queueDir, `${ID}-ARCHIVED.md`), REPORT);
  fs.writeFileSync(path.join(trashDir, `${ID}-NOG.md.pass`), VERDICT);
  fs.writeFileSync(path.join(stateDir, 'branch-state.json'),
    JSON.stringify({ dev: { deferred_slices: [] }, gate: { status: 'IDLE' } }));

  const regFile = path.join(root, 'bridge', 'register.jsonl');
  fs.writeFileSync(regFile, '');

  const orch = require(ORCH_SRC);
  orch._testSetDirs(queueDir, path.join(root, 'bridge', 'staged'), trashDir);
  orch._testSetRegisterFile(regFile);
  orch._testSetProjectDir(root);

  const events = (name) => fs.readFileSync(regFile, 'utf8').trim().split('\n')
    .filter(Boolean).map(l => JSON.parse(l)).filter(e => !name || e.event === name);

  return {
    root, queueDir, trashDir, stateDir, orch, events,
    abs: (rel) => path.join(root, rel.split('/').join(path.sep)),
    quarantined: (rel) => path.join(root, 'bridge', 'quarantine', `qa-${ID}`, rel.split('/').join(path.sep)),
    quarantineRoot: path.join(root, 'bridge', 'quarantine', `qa-${ID}`),
    write: (rel, body) => {
      const abs = path.join(root, rel.split('/').join(path.sep));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    },
    read: (abs) => fs.readFileSync(abs, 'utf8'),
    // What the stage recorded for itself: outcome and the detail that names the ending.
    result: () => {
      try { return JSON.parse(fs.readFileSync(path.join(stateDir, `qa-stage-${ID}.json`), 'utf8')); }
      catch (_) { return {}; }
    },
    porcelain: (rel) => execFileSync('git', ['status', '--porcelain', '-uall', '--', rel],
      { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim(),
    head: () => git(['rev-parse', 'HEAD'], root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Julian, as far as the stage can see him: something that can be killed and can exit. */
function fakeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

function startStage(fx, extra) {
  const child = fakeChild();
  const res = fx.orch.startQaStage(ID, Object.assign({
    branchName: `slice/${ID}`, title: 'Fixture slice',
    queueDir: fx.queueDir, trashDir: fx.trashDir, stateDir: fx.stateDir,
    changedFiles: ['bridge/orchestrator.js'],
    mutex: FAKE_MUTEX,
    repoRoot: fx.root,
    heartbeatPath: path.join(fx.stateDir, 'bashir-heartbeat.json'),
    leftoverGraceMs: 80,
    spawn: () => child,
  }, extra || {}));
  assert.equal(res.started, true, `the stage must start (reason: ${res.reason})`);
  assert.equal(res.spawned, true, 'the fixture child must be the spawned process');
  return child;
}

async function waitFor(label, fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try { value = fn(); } catch (_) { value = false; }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(r => setTimeout(r, 10));
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the criteria ─────────────────────────────────────────────────────────────

// @ac-hash: slice-407-ac-1 sha256:06f81c8d71bfd14c395eecd2e16ab7343098b37687d4f7f72dc1d8652b3eeb13
test('slice-407-ac-1: a stage that ends badly leaves no untracked spec in the tree, and the register says where it went', async () => {
  // The four endings the criterion names. heartbeat_stale and timeout are driven through the
  // real liveness guards with their clocks turned down, not simulated.
  const endings = {
    heartbeat_stale: { extra: { heartbeatStaleMs: 0, heartbeatPollMs: 5 }, detail: 'heartbeat_stale', exits: false },
    timeout:         { extra: { timeoutMs: 5 },                            detail: 'timeout',        exits: false },
    exit_nonzero:    { extra: {},                                          detail: 'exit_1',         exits: true },
    spawn_error:     { extra: {},                                          detail: 'spawn_error: boom', exits: false },
  };

  for (const [name, spec] of Object.entries(endings)) {
    const fx = fixture(`ds9-407-ac1-${name}-`);
    const child = startStage(fx, spec.extra);
    try {
      // Julian writes a browser test during the stage and never commits it.
      fx.write('e2e/x.spec.js', '// julian, mid-thought\n');
      if (name === 'exit_nonzero') child.emit('exit', 1);
      if (name === 'spawn_error') child.emit('error', new Error('boom'));

      await waitFor(`${name}: e2e/x.spec.js to be quarantined`, () => fs.existsSync(fx.quarantined('e2e/x.spec.js')));

      assert.equal(fs.existsSync(fx.abs('e2e/x.spec.js')), false,
        `${name}: the leftover must be out of the working tree`);
      assert.equal(fx.read(fx.quarantined('e2e/x.spec.js')), '// julian, mid-thought\n',
        `${name}: the quarantined copy must be his file, content for content`);
      assert.equal(fx.porcelain('e2e/x.spec.js'), '',
        `${name}: git must see nothing at that path any more`);

      const evs = fx.events('QA_LEFTOVERS_QUARANTINED');
      assert.equal(evs.length, 1, `${name}: exactly one quarantine event`);
      assert.equal(evs[0].slice_id, ID, `${name}: the event names the slice`);
      assert.deepEqual(evs[0].paths, ['e2e/x.spec.js'], `${name}: the event lists the path it moved`);

      // …and the stage really did end the way this case claims.
      assert.equal(fx.result().outcome, 'stage_error', `${name}: the stage ends stage_error`);
      assert.equal(fx.result().detail, spec.detail, `${name}: the recorded detail names the ending`);
    } finally {
      child.emit('exit', 0);   // disarm any pending grace before the tmpdir goes
      fx.cleanup();
    }
  }
});

// @ac-hash: slice-407-ac-2 sha256:ee0f4dea83e0367ce1ec39f09352ca19909dc8bfb613d03fd26ce1367e6a605f
test('slice-407-ac-2: a stage that ends recorded on exit 0 is swept the same way', async () => {
  const fx = fixture('ds9-407-ac2-');
  const child = startStage(fx);
  try {
    fx.write('regression/qa-left-this.test.js', '// a half-written safety net\n');
    child.emit('exit', 0);

    await waitFor('the leftover to be quarantined', () => fs.existsSync(fx.quarantined('regression/qa-left-this.test.js')));

    assert.equal(fx.result().outcome, 'recorded', 'exit 0 records the stage, it does not error');
    assert.equal(fs.existsSync(fx.abs('regression/qa-left-this.test.js')), false,
      'a good stage clears up after itself too');
    assert.equal(fx.read(fx.quarantined('regression/qa-left-this.test.js')), '// a half-written safety net\n');
    assert.deepEqual(fx.events('QA_LEFTOVERS_QUARANTINED').map(e => e.paths), [['regression/qa-left-this.test.js']]);
  } finally {
    fx.cleanup();
  }
});

// @ac-hash: slice-407-ac-3 sha256:a3e60dc78e9f1b8555fb7c085d6055160284f391fef58a667dc4889ee2776931
test('slice-407-ac-3: the sweep waits for Julian to be gone, and gives up waiting after the grace', async () => {
  assert.equal(fx0QaGrace(), 10 * 1000, 'the grace the criterion names is ten seconds');

  // (a) The stage has ended — SIGTERM sent, result recorded — and only THEN does his dying
  //     process write the file. Sweeping at the end of the stage would have missed it.
  const late = fixture('ds9-407-ac3-late-');
  const lateChild = startStage(late, { heartbeatStaleMs: 0, heartbeatPollMs: 5, leftoverGraceMs: 4000 });
  try {
    await waitFor('the stage to be recorded', () => late.result().outcome === 'stage_error');
    assert.equal(lateChild.killed, true, 'the stage ended by killing him');
    assert.equal(late.events('QA_LEFTOVERS_QUARANTINED').length, 0,
      'nothing has been swept yet — he is still alive');

    late.write('e2e/late.spec.js', '// written on the way out\n');
    lateChild.emit('exit', 143);

    await waitFor('the late file to be quarantined', () => fs.existsSync(late.quarantined('e2e/late.spec.js')));
    assert.equal(fs.existsSync(late.abs('e2e/late.spec.js')), false);
    assert.equal(late.read(late.quarantined('e2e/late.spec.js')), '// written on the way out\n');
    assert.deepEqual(late.events('QA_LEFTOVERS_QUARANTINED').map(e => e.paths), [['e2e/late.spec.js']]);
  } finally {
    late.cleanup();
  }

  // (b) He ignores SIGTERM and never exits. The file appears AFTER the stage ended — so the
  //     pass at the end of the stage cannot have caught it — and the grace sweeps it anyway.
  //     A wedged Julian cannot hold up a landing either.
  const stuck = fixture('ds9-407-ac3-stuck-');
  const stuckChild = startStage(stuck, { timeoutMs: 5, leftoverGraceMs: 150 });
  try {
    await waitFor('the stage to be recorded', () => stuck.result().outcome === 'stage_error');
    stuck.write('e2e/stuck.spec.js', '// he never let go\n');

    await waitFor('the grace to expire and sweep', () => fs.existsSync(stuck.quarantined('e2e/stuck.spec.js')));
    assert.equal(stuckChild.killed, true, 'he was asked to stop');
    assert.equal(fs.existsSync(stuck.abs('e2e/stuck.spec.js')), false);
    const evs = stuck.events('QA_LEFTOVERS_QUARANTINED');
    assert.deepEqual(evs.map(e => e.paths), [['e2e/stuck.spec.js']]);
    assert.equal(evs[0].reason, 'grace_expired', 'the grace is what swept it, not his exit');
  } finally {
    stuckChild.emit('exit', 0);
    stuck.cleanup();
  }
});

/** The shipped default grace, read off the module rather than retyped. */
function fx0QaGrace() {
  return require(ORCH_SRC).QA_LEFTOVER_GRACE_MS;
}

// @ac-hash: slice-407-ac-4 sha256:4abbab64c7bc1c510c314f2ef4920bb9f54a9faade9b1c2d9c8ae9a2879fed95
test('slice-407-ac-4: what was already uncommitted when the stage started is never touched and never claimed', async () => {
  const fx = fixture('ds9-407-ac4-');
  // Somebody else's unfinished work, both flavours, already in the tree BEFORE the stage:
  // an untracked spec and a modified tracked test.
  fx.write('e2e/persons-wip.spec.js', '// a person, halfway through\n');
  fx.write(TRACKED_TEST, '// a person edited the committed test\n');

  const child = startStage(fx);
  try {
    // During the stage the person's untracked file changes again — the criterion says that
    // makes no difference — and Julian leaves one of his own.
    fs.appendFileSync(fx.abs('e2e/persons-wip.spec.js'), '// and further\n');
    fx.write('e2e/julian.spec.js', '// julian\n');
    child.emit('exit', 1);

    await waitFor('his own file to be quarantined', () => fs.existsSync(fx.quarantined('e2e/julian.spec.js')));

    assert.equal(fx.read(fx.abs('e2e/persons-wip.spec.js')),
      '// a person, halfway through\n// and further\n',
      'the person\'s untracked file stays where it is, with the change it gained');
    assert.equal(fs.existsSync(fx.quarantined('e2e/persons-wip.spec.js')), false,
      'and it is not in the quarantine');
    assert.equal(fx.read(fx.abs(TRACKED_TEST)), '// a person edited the committed test\n',
      'the person\'s edit to a TRACKED test is not reverted either');
    assert.equal(fs.existsSync(fx.quarantined(TRACKED_TEST)), false);

    assert.deepEqual(fx.events('QA_LEFTOVERS_QUARANTINED').map(e => e.paths), [['e2e/julian.spec.js']],
      'the event claims only what the stage actually moved');
  } finally {
    fx.cleanup();
  }
});

// @ac-hash: slice-407-ac-5 sha256:3764d6b11a8c14fcb3656d134483a12068dec58d492f93d0bcc142a60a0d44e6
test('slice-407-ac-5: a tracked test Julian modified goes back to its committed content, with his version kept', async () => {
  const fx = fixture('ds9-407-ac5-');
  const child = startStage(fx);
  try {
    fx.write(TRACKED_TEST, '// julian rewrote a committed test and never committed it\n');
    child.emit('exit', 1);

    await waitFor('the modified test to be quarantined', () => fs.existsSync(fx.quarantined(TRACKED_TEST)));

    assert.equal(fx.read(fx.abs(TRACKED_TEST)), COMMITTED_BODY,
      'the working tree holds the committed content again — a committed test is never deleted');
    assert.equal(fx.read(fx.quarantined(TRACKED_TEST)), '// julian rewrote a committed test and never committed it\n',
      'and his version is kept, not thrown away');
    assert.equal(fx.porcelain(TRACKED_TEST), '', 'the path reads clean to the next landing');
    assert.deepEqual(fx.events('QA_LEFTOVERS_QUARANTINED').map(e => e.paths), [[TRACKED_TEST]]);
  } finally {
    fx.cleanup();
  }
});

// @ac-hash: slice-407-ac-6 sha256:0fe8b53c8a77986636bbe0d5405e4fcb31908da41e4de373216e6b39b672028b
test('slice-407-ac-6: uncommitted files that are not lock-deriver inputs are left alone, and a clean stage writes no event', async () => {
  // First, a stage where the sweep DOES run — a real leftover alongside the runtime JSON the
  // crew's tree nearly always carries. Without the positive control this criterion would be
  // two absences, and two absences hold just as well when nothing sweeps at all.
  const mixed = fixture('ds9-407-ac6-mixed-');
  const mixedChild = startStage(mixed);
  try {
    mixed.write('regression/TEST-DRIFT.json', '{"drift":true}\n');
    mixed.write('bridge/state/bashir-heartbeat.json', '{"ts":"fixture"}\n');
    mixed.write('e2e/his.spec.js', '// julian\n');
    mixedChild.emit('exit', 0);

    await waitFor('the sweep to run', () => fs.existsSync(mixed.quarantined('e2e/his.spec.js')));

    assert.equal(mixed.read(mixed.abs('regression/TEST-DRIFT.json')), '{"drift":true}\n',
      'runtime JSON under regression/ is not a deriver input and is not moved');
    assert.equal(mixed.read(mixed.abs('bridge/state/bashir-heartbeat.json')), '{"ts":"fixture"}\n',
      'nor is the stage\'s own heartbeat file');
    assert.equal(fs.existsSync(mixed.quarantined('regression/TEST-DRIFT.json')), false);
    assert.equal(fs.existsSync(mixed.quarantined('bridge/state/bashir-heartbeat.json')), false);
    assert.deepEqual(mixed.events('QA_LEFTOVERS_QUARANTINED').map(e => e.paths), [['e2e/his.spec.js']],
      'the event lists the deriver input and nothing else');
  } finally {
    mixed.cleanup();
  }

  // Then a stage that leaves nothing a deriver would read: no event, no folder.
  const clean = fixture('ds9-407-ac6-clean-');
  const cleanChild = startStage(clean);
  try {
    clean.write('regression/TEST-DRIFT.json', '{"drift":true}\n');
    clean.write('bridge/state/bashir-heartbeat.json', '{"ts":"fixture"}\n');
    cleanChild.emit('exit', 0);

    await waitFor('the stage to be recorded', () => clean.result().outcome === 'recorded');
    await sleep(240);  // three times the grace: a late sweep would have fired by now

    assert.equal(clean.read(clean.abs('regression/TEST-DRIFT.json')), '{"drift":true}\n');
    assert.equal(clean.read(clean.abs('bridge/state/bashir-heartbeat.json')), '{"ts":"fixture"}\n');
    assert.equal(fs.existsSync(clean.quarantineRoot), false,
      'nothing was moved, so no quarantine folder is created');
    assert.equal(clean.events('QA_LEFTOVERS_QUARANTINED').length, 0,
      'an ordinary stage leaves the register alone');
  } finally {
    clean.cleanup();
  }
});

// @ac-hash: slice-407-ac-7 sha256:ab20a53726a5b6a7ab9de9dea36962c299f85d57b0d8a282b5e1b677e03d5cd7
test('slice-407-ac-7: the landing after such a stage regenerates its locks instead of failing lock_regen_failed', async () => {
  // The stage ends on a stale heartbeat and Julian is NOT gone — he was sent SIGTERM and
  // that is all. This is the real moment of the failure: finishQaStage ends by draining the
  // slices that deferred behind the stage, and that drain squashes them in the same tick,
  // while he is still alive. So the landing here is attempted with no exit emitted.
  const fx = fixture('ds9-407-ac7-');
  const child = startStage(fx, { heartbeatStaleMs: 0, heartbeatPollMs: 5, leftoverGraceMs: 30000 });
  try {
    fx.write('e2e/x.spec.js', '// the file that blocked 402, 397 and 405\n');
    await waitFor('the stage to end', () => fx.result().outcome === 'stage_error');
    assert.equal(fs.existsSync(fx.quarantined('e2e/x.spec.js')), true,
      'the tree is clear the moment the stage ends, not ten seconds later');

    const landed = fx.orch.regenerateLocksAtLanding(ID, `slice/${ID}`, fx.head());
    assert.equal(landed.success, true, `the landing must go through (error: ${landed.error})`);
    assert.equal(fx.events('ERROR').length, 0, 'and it writes no ERROR event');
    // The evidence stays on disk, and being under bridge/ it is not itself a deriver input:
    // clearing up must not hand the next landing a new blocker.
    assert.equal(fs.existsSync(fx.quarantined('e2e/x.spec.js')), true);

    // The guard that refused those three landings is untouched: put an unswept file back and
    // the landing still says no, by name. This is what the sweep exists to avoid, not weaken.
    fx.write('e2e/y.spec.js', '// nobody swept this one\n');
    const blocked = fx.orch.regenerateLocksAtLanding(ID, `slice/${ID}`, fx.head());
    assert.equal(blocked.success, false, 'an unswept deriver input still blocks the landing');
    assert.match(blocked.error, /^lock_regen_failed: uncommitted lock-deriver inputs/);
    assert.match(blocked.error, /e2e\/y\.spec\.js/);
  } finally {
    child.emit('exit', 0);   // disarm the grace before the tmpdir goes
    fx.cleanup();
  }
});

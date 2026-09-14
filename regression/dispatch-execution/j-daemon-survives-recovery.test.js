'use strict';

/**
 * Journey: J-daemon-survives-recovery
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   Four faults seen live between 2026-09-11 and 2026-09-13, each one a stuck pipeline
 *   or a lost round, all of them in the daemon's own recovery and completion paths.
 *
 *   1 · A landing INSIDE startup recovery killed the daemon. The startup block calls
 *       crashRecovery() while the module is still being evaluated, so every module-scope
 *       const below it is in its temporal dead zone: a recovery that landed an orphaned
 *       ACCEPTED slice reached regenerateLocksAtLanding and threw "Cannot access
 *       'LOCK_FILES' before initialization" — after the squash commit and before the
 *       register event. The daemon exited 1, launchd restarted it, the second attempt
 *       found nothing left to squash, and slice 389's ticket sat in ACCEPTED with its
 *       commit already on dev (2026-09-13 19:25:28Z).
 *
 *   2 · Recovery treated every approved slice as finished. isTerminal()'s trash signal
 *       fired on ANY `{id}-` entry, and the dashboard drops `{id}-STAGED.md.approved`
 *       there the moment Philipp presses approve — an entry that appears when a slice
 *       STARTS. "startup-recovery: skipped terminal slice 390", and the round was gone.
 *
 *   3 · A verification failure left the daemon "processing" for ever. That branch
 *       returned without releasing the dispatch slot or resetting the heartbeat, unlike
 *       every other ERROR path; nothing was dispatched until a restart (slice 388,
 *       2026-09-11 20:20Z–22:41Z, with 387's rework queued behind it).
 *
 *   4 · An honest report was filed as fake work. verifyRomActuallyWorked asks "does the
 *       diff contain product work?", and BLOCKED, PARTIAL and "it was already on dev"
 *       all answer no for honest reasons (slice 388's first attempt; slice 394, where
 *       the change had been made by hand a minute before approval).
 *
 * Guards:
 *   slice-393-ac-1 — a daemon started with an orphaned ACCEPTED slice and a squashable
 *                    branch lands it during startup recovery, exits 0, records
 *                    SLICE_SQUASHED_TO_DEV
 *   slice-393-ac-2 — a slice whose only trash entry is its .approved staging copy is not
 *                    terminal, and crashRecovery re-queues its orphaned IN_PROGRESS file
 *   slice-393-ac-3 — after a DONE report fails verification the heartbeat file says idle
 *                    with no current slice, and the next poll can dispatch
 *   slice-393-ac-4 — BLOCKED yields no ERROR file, a BLOCKED event and a ticket back in
 *                    STAGED; PARTIAL proceeds to review; a report-only branch that says
 *                    the work was already on dev yields NOTHING_TO_DO and an archive
 *
 * Fixture isolation (#99992): every byte of state lives under fs.mkdtempSync(os.tmpdir())
 * with a LOCAL BARE origin. The ac-1 child process additionally fences fs.rmSync to the
 * fixture root — the daemon's startup sweeps orphaned worktrees out of the hardcoded
 * /tmp/ds9-worktrees judged against its OWN repo, which in a fixture is every live crew
 * workspace. The fence caught exactly that on the first run.
 */

// @ac-hash: slice-393-ac-1 sha256:fce4b2a465a9140d721df2ad76755a2ef2a61c6a69979c907dadc40c3875071b
// @ac-hash: slice-393-ac-2 sha256:bbdf9e9908d0230d1d80f0763bae9f1e73b016d60bee9c7c55cf3e4646ea39ce
// @ac-hash: slice-393-ac-3 sha256:78239759404e5d166039d3093a63abdf347dadcab5fe42a3da6bbb02f35e1f12
// @ac-hash: slice-393-ac-4 sha256:12eb4590fb3bbbadb14765437c3bad9e19cc3e8846c55cd9ac449d0c1d6dd667

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_PATH = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const SRC = fs.readFileSync(ORCH_PATH, 'utf8');

const gitFinalizer = require('../../bridge/git-finalizer');
const orch = require('../../bridge/orchestrator');
const {
  isTerminal, crashRecovery, trashEntryRecordsStaging, STAGING_TRASH_SUFFIXES,
  releaseDispatch, classifyHonestNonProduct, doneSummarySection,
  _testSetDirs, _testSetRegisterFile, _testSetProjectDir, _testSetHeartbeatFile,
  _testGetDispatchState,
} = orch;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Rom Fixture', GIT_AUTHOR_EMAIL: 'rom@fixture.test',
  GIT_COMMITTER_NAME: 'Rom Fixture', GIT_COMMITTER_EMAIL: 'rom@fixture.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (args, cwd) => execFileSync('git', args,
  { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const tmpDirs = [];
const mkTmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `j-daemon-recovery-${tag}-`));
  tmpDirs.push(d);
  return d;
};
after(() => { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// ── source reading: the branch this slice rewires ───────────────────────────

/** The `if (!verify.ok) { … }` block, brace-matched from the source. */
function verifyBranchSource() {
  const start = SRC.indexOf('if (!verify.ok) {');
  assert.ok(start > 0, 'the verify-verdict branch must still exist');
  let depth = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error('the verify-verdict branch is unbalanced');
}

/** A named `if (honest.kind === '<kind>') { … }` block inside that branch. */
function honestKindSource(kind) {
  const branch = verifyBranchSource();
  const start = branch.indexOf(`if (honest.kind === '${kind}') {`);
  assert.ok(start > 0, `the ${kind} route must live inside the verdict branch`);
  let depth = 0;
  for (let i = branch.indexOf('{', start); i < branch.length; i++) {
    if (branch[i] === '{') depth += 1;
    else if (branch[i] === '}') { depth -= 1; if (depth === 0) return branch.slice(start, i + 1); }
  }
  throw new Error(`the ${kind} route is unbalanced`);
}

// ═══ slice-393-ac-1 ═════════════════════════════════════════════════════════

/**
 * Builds a whole repo the daemon can be run against as its own project: a bare origin,
 * main + dev, one un-landed slice branch with real product work, and an orphaned
 * ACCEPTED ticket in the queue. The two lock derivers are present but empty — their
 * PRESENCE is what routes the landing through regenerateLocksAtLanding, which is where
 * the daemon died.
 */
function buildDaemonFixture(id) {
  const tmp = mkTmp('daemon');
  const bare = path.join(tmp, 'bare.git');
  const work = path.join(tmp, 'work');
  git(['init', '--quiet', '--bare', '--initial-branch=main', bare], tmp);
  git(['clone', '--quiet', bare, work], tmp);
  // Repo-local identity: the daemon commits with the plain process env, and a clean CI
  // runner has no global one.
  git(['config', 'user.email', 'rom@fixture.test'], work);
  git(['config', 'user.name', 'Rom Fixture'], work);

  const bridgeDir = path.join(work, 'bridge');
  fs.mkdirSync(path.join(bridgeDir, 'state'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO_ROOT, 'bridge'))) {
    if (f.endsWith('.js') || f === 'bridge.config.json') {
      fs.copyFileSync(path.join(REPO_ROOT, 'bridge', f), path.join(bridgeDir, f));
    }
  }
  for (const f of fs.readdirSync(path.join(REPO_ROOT, 'bridge', 'state'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(REPO_ROOT, 'bridge', 'state', f), path.join(bridgeDir, 'state', f));
  }
  fs.copyFileSync(path.join(REPO_ROOT, '.gitignore'), path.join(work, '.gitignore'));

  // Long enough that nothing polls between startup and shutdown.
  const cfgPath = path.join(bridgeDir, 'bridge.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.pollIntervalMs = 3600000;
  cfg.heartbeatIntervalMs = 3600000;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
  for (const s of ['build-coverage-map.js', 'build-ac-manifest.js']) {
    fs.writeFileSync(path.join(work, 'scripts', s), "'use strict';\n// fixture stub: presence is the point\n");
  }

  fs.writeFileSync(path.join(work, 'base.txt'), 'base\n');
  git(['add', '-A'], work);
  git(['commit', '--quiet', '-m', 'initial'], work);
  git(['push', '--quiet', 'origin', 'main'], work);
  git(['checkout', '--quiet', '-b', 'dev'], work);
  git(['push', '--quiet', 'origin', 'dev'], work);

  git(['checkout', '--quiet', '-b', `slice/${id}`], work);
  fs.writeFileSync(path.join(work, 'feature.txt'), 'the work that must land\n');
  git(['add', 'feature.txt'], work);
  git(['commit', '--quiet', '-m', `slice ${id} work\n\nAC: slice-${id}-ac-1: the work lands\nLane: core`], work);
  git(['checkout', '--quiet', 'dev'], work);

  for (const d of ['queue', 'staged', 'trash', 'logs', 'escalations', 'control']) {
    fs.mkdirSync(path.join(bridgeDir, d), { recursive: true });
  }
  fs.writeFileSync(path.join(bridgeDir, 'register.jsonl'), '');
  fs.writeFileSync(path.join(bridgeDir, 'state', 'branch-state.json'), JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  const head = (extra) => `---\nid: "${id}"\ntitle: "Fixture slice ${id}"\n${extra}---\n\n## Body\n`;
  fs.writeFileSync(path.join(bridgeDir, 'queue', `${id}-ACCEPTED.md`),
    head(`from: rom\nto: nog\nstatus: DONE\nslice_id: "${id}"\nbranch: "slice/${id}"\nlane: core\n`));
  fs.writeFileSync(path.join(bridgeDir, 'queue', `${id}-PARKED.md`),
    head(`from: obrien\nto: rom\ngoal: "land it"\npriority: high\ncreated: "2026-09-13T00:00:00.000Z"\nlane: core\n`));

  // The driver is the only way to reproduce this fault: the fix lives in the ORDER a
  // module evaluates in, and the startup block runs only when the orchestrator is the
  // entry module (trap 2).
  const driver = path.join(tmp, 'driver.js');
  fs.writeFileSync(driver, `'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ORCH = path.resolve(process.argv[2]);
const ROOT = path.resolve(process.argv[3]);
// #99992 fence: startup sweeps orphaned worktree dirs out of the HARDCODED
// /tmp/ds9-worktrees, judged against this fixture's worktree list — i.e. every live crew
// workspace. Nothing outside the fixture is ever removed.
const realRm = fs.rmSync;
fs.rmSync = function (target, opts) {
  if (!path.resolve(String(target)).startsWith(ROOT + path.sep)) return undefined;
  return realRm.call(fs, target, opts);
};
process.argv[1] = ORCH;
Module._load(ORCH, null, true);
// Startup is synchronous: reaching this line means the daemon survived it. Stop it the
// way launchd would and let the daemon choose its own exit code.
process.kill(process.pid, 'SIGTERM');
`);

  return { tmp, work, bridgeDir, driver };
}

test('slice-393-ac-1 a landing during startup recovery does not crash the daemon: it exits 0 and records SLICE_SQUASHED_TO_DEV', () => {
  const id = '777';
  const fx = buildDaemonFixture(id);

  const run = spawnSync(process.execPath, [fx.driver, path.join(fx.bridgeDir, 'orchestrator.js'), fx.work], {
    cwd: fx.work,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, DS9_USE_GATE_FLOW: '1', NO_COLOR: '1' },
  });

  assert.doesNotMatch(String(run.stderr || ''), /Cannot access '\w+' before initialization/,
    `the startup block must not read a module binding that is still in its dead zone:\n${run.stderr}`);
  assert.equal(run.status, 0,
    `the daemon must survive a landing inside startup recovery\nstderr:\n${run.stderr}\nstdout:\n${run.stdout}`);

  const register = fs.readFileSync(path.join(fx.bridgeDir, 'register.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  const squashed = register.find(e => e.event === 'SLICE_SQUASHED_TO_DEV' && String(e.slice_id) === id);
  assert.ok(squashed, `the landing must reach its register event, not die between commit and event: ${
    JSON.stringify(register.filter(e => String(e.slice_id) === id).map(e => e.event))}`);

  // …and the commit it names is really on dev, so "landed" is not just an event.
  const devSubject = git(['log', '-1', '--format=%s', 'dev'], fx.work);
  assert.equal(devSubject, `S${id}: Fixture slice ${id}`, 'dev must carry the squash commit');
  assert.equal(git(['rev-parse', 'dev'], fx.work), squashed.squash_sha,
    'the recorded squash sha must be the tip the landing actually produced');
});

// ═══ slice-393-ac-2 ═════════════════════════════════════════════════════════

test('slice-393-ac-2 a slice whose only trash entry is its .approved staging copy is not terminal, and crashRecovery re-queues it', () => {
  const root = mkTmp('approved');
  const queueDir = path.join(root, 'queue');
  const stagedDir = path.join(root, 'staged');
  const trashDir = path.join(root, 'trash');
  for (const d of [queueDir, stagedDir, trashDir]) fs.mkdirSync(d, { recursive: true });
  const regFile = path.join(root, 'register.jsonl');
  fs.writeFileSync(regFile, '');

  const id = '390';
  // Exactly the live shape: the dashboard moved the staged brief aside at approval, the
  // daemon then died mid-flight leaving the IN_PROGRESS file behind.
  fs.writeFileSync(path.join(trashDir, `${id}-STAGED.md.approved`), 'the staged brief, approved\n');
  fs.writeFileSync(path.join(queueDir, `${id}-IN_PROGRESS.md`),
    `---\nid: "${id}"\ntitle: "Interrupted mid-flight"\nstatus: IN_PROGRESS\n---\n\n## Body\n`);

  assert.equal(isTerminal(id, { queueDir, trashDir, regFile }), false,
    'an approval record is not a completion record');

  _testSetDirs(queueDir, stagedDir, trashDir);
  _testSetRegisterFile(regFile);
  const actions = crashRecovery();

  assert.deepEqual(actions.filter(a => a.id === id), [{ id, type: 'requeued' }],
    `recovery must re-queue the orphan, not skip it: ${JSON.stringify(actions)}`);
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), true, 'the slice is back in the queue');
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-IN_PROGRESS.md`)), false, 'the orphan file is gone');
});

// ═══ slice-393-ac-3 ═════════════════════════════════════════════════════════

test('slice-393-ac-3 a verification failure releases the dispatch slot: the heartbeat file goes idle and the next poll can dispatch', () => {
  const root = mkTmp('heartbeat');
  const queueDir = path.join(root, 'queue');
  const stagedDir = path.join(root, 'staged');
  const trashDir = path.join(root, 'trash');
  for (const d of [queueDir, stagedDir, trashDir]) fs.mkdirSync(d, { recursive: true });
  const hbPath = path.join(root, 'heartbeat.json');
  _testSetDirs(queueDir, stagedDir, trashDir);
  _testSetHeartbeatFile(hbPath);

  // The file as the daemon left it on 2026-09-11: busy, naming a slice, for two hours.
  fs.writeFileSync(hbPath, JSON.stringify({
    ts: '2026-09-11T20:20:23.309Z',
    pickup_ts: '2026-09-11T20:05:00.000Z',
    status: 'processing',
    current_slice: '388',
    current_slice_title: 'the slice that froze the queue',
    current_slice_goal: 'it never got one',
    slice_elapsed_seconds: 923,
    processed_total: 4,
  }, null, 2) + '\n');

  releaseDispatch('388');

  const hb = JSON.parse(fs.readFileSync(hbPath, 'utf8'));
  assert.equal(hb.status, 'idle', 'the heartbeat must stop saying processing');
  assert.equal(hb.current_slice, null, 'and must stop naming the slice');
  assert.equal(hb.current_slice_title, null);
  assert.equal(hb.pickup_ts, null, 'a cleared pickup time is what stops the elapsed clock running for ever');
  assert.equal(hb.slice_elapsed_seconds, null);
  assert.equal(_testGetDispatchState().processing, false, 'and the poll loop is free to dispatch again');

  // The branch that forgot to do it. Every exit from the verdict branch owes the
  // release — the ERROR path is the one that did not pay it.
  const branch = verifyBranchSource();
  const returns = branch.split('\n').map(l => l.trim()).reduce((acc, line, i, all) => {
    if (line === 'return;') acc.push(all.slice(Math.max(0, i - 6), i).join('\n'));
    return acc;
  }, []);
  assert.ok(returns.length >= 3, `the verdict branch must still have its early returns: ${returns.length}`);
  for (const before of returns) {
    assert.match(before, /releaseDispatch\(id\);/,
      `every return out of the verdict branch must release the dispatch slot first, this one does not:\n${before}`);
  }
});

// ═══ slice-393-ac-4 ═════════════════════════════════════════════════════════

/** A repo whose slice branch changes nothing but its own DONE report. */
function buildReportOnlyFixture(id, reportBody) {
  const tmp = mkTmp('honest');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work, { recursive: true });
  git(['init', '--quiet', '--initial-branch=main', work], tmp);
  git(['config', 'user.email', 'rom@fixture.test'], work);
  git(['config', 'user.name', 'Rom Fixture'], work);
  fs.writeFileSync(path.join(work, 'base.txt'), 'base\n');
  git(['add', 'base.txt'], work);
  git(['commit', '--quiet', '-m', 'initial'], work);
  git(['checkout', '--quiet', '-b', 'dev'], work);

  const queueDir = path.join(work, 'bridge', 'queue');
  fs.mkdirSync(queueDir, { recursive: true });
  git(['checkout', '--quiet', '-b', `slice/${id}`], work);
  fs.writeFileSync(path.join(queueDir, `${id}-DONE.md`), reportBody);
  git(['add', '-f', `bridge/queue/${id}-DONE.md`], work);
  git(['commit', '--quiet', '-m', `S${id}: the report, and nothing else`], work);

  return { work, queueDir };
}

const report = (status, summary) =>
  `---\nid: "394"\ntitle: "A report"\nfrom: rom\nto: nog\nstatus: ${status}\nslice_id: "394"\nbranch: "slice/394"\n---\n\n` +
  `## Summary\n\n${summary}\n\n## What changed\n\nNothing else.\n`;

test('slice-393-ac-4 an honest report is not fake work: BLOCKED goes back to O\'Brien, PARTIAL goes to review, already-on-dev is archived', () => {
  const id = '394';
  const alreadyOnDev = 'The rename was already done before I was invoked. Commit `ae50dd7`, by hand, one minute '
    + 'before this brief was approved, landed the exact change the brief asks for, and it is already on `dev`.';
  const fx = buildReportOnlyFixture(id, report('DONE', alreadyOnDev));
  _testSetProjectDir(fx.work);
  _testSetDirs(fx.queueDir, path.join(fx.work, 'bridge', 'staged'), path.join(fx.work, 'bridge', 'trash'));
  // The rule reads the diff through git-finalizer, which the daemon wires up at startup
  // and a test has to wire up itself (the pattern j-rom-work-substance uses).
  gitFinalizer.init({
    PROJECT_DIR: fx.work,
    registerEvent: () => {},
    log: () => {},
    HEARTBEAT_FILE: path.join(fx.work, 'heartbeat.json'),
    QUEUE_DIR: fx.queueDir,
  });

  // ── the three honest verdicts ────────────────────────────────────────────
  assert.equal(classifyHonestNonProduct(id, `slice/${id}`).kind, 'nothing_to_do',
    'a report-only branch saying the work was already on dev is nothing to do, not fabrication');

  fs.writeFileSync(path.join(fx.queueDir, `${id}-DONE.md`), report('BLOCKED', 'I cannot proceed: the API key is missing.'));
  const blocked = classifyHonestNonProduct(id, `slice/${id}`);
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.summary, 'I cannot proceed: the API key is missing.',
    "the register event carries the builder's own words");
  assert.equal(doneSummarySection('---\nid: "1"\n---\n\n## Summary\n\nOne line.\nAnd its wrap.\n\n## What changed\n\nElsewhere.\n'),
    'One line. And its wrap.', 'the summary is the Summary section, flattened, and stops at the next heading');

  fs.writeFileSync(path.join(fx.queueDir, `${id}-DONE.md`), report('partial', 'Two of the four tasks are done.'));
  assert.equal(classifyHonestNonProduct(id, `slice/${id}`).kind, 'partial', 'the status test is case-insensitive');

  // ── and the dishonest one is still caught ────────────────────────────────
  fs.writeFileSync(path.join(fx.queueDir, `${id}-DONE.md`), report('DONE', 'I implemented the whole thing.'));
  assert.equal(classifyHonestNonProduct(id, `slice/${id}`), null,
    'a DONE report claiming work on a branch that changed nothing is still fake work');

  // A claim of "already on dev" is not enough on its own: the diff has to agree.
  fs.writeFileSync(path.join(fx.queueDir, 'other.txt'), 'a real change\n');
  git(['add', '-f', 'bridge/queue/other.txt'], fx.work);
  git(['commit', '--quiet', '-m', 'a second commit that changes something else'], fx.work);
  fs.writeFileSync(path.join(fx.queueDir, `${id}-DONE.md`), report('DONE', alreadyOnDev));
  assert.equal(classifyHonestNonProduct(id, `slice/${id}`), null,
    'a branch that changed something other than its report is not nothing-to-do, whatever the summary says');

  // ── where each verdict sends the slice ───────────────────────────────────
  const blockedRoute = honestKindSource('blocked');
  assert.doesNotMatch(blockedRoute, /writeErrorFile\(/, 'BLOCKED must write no ERROR file');
  assert.match(blockedRoute, /registerEvent\(id, 'BLOCKED'/, 'BLOCKED must be recorded as BLOCKED');
  assert.match(blockedRoute, /summary,/, "…carrying the report's summary line");
  assert.match(blockedRoute, /STAGED_DIR, `\$\{id\}-STAGED\.md`/, 'the ticket goes back to staged for O\'Brien');

  const nothingRoute = honestKindSource('nothing_to_do');
  assert.doesNotMatch(nothingRoute, /writeErrorFile\(/, 'nothing-to-do is not an error');
  assert.match(nothingRoute, /registerEvent\(id, 'NOTHING_TO_DO'/, 'it is recorded as NOTHING_TO_DO');
  assert.match(nothingRoute, /QUEUE_DIR, `\$\{id\}-ARCHIVED\.md`/, 'and the ticket is archived where it stands');

  // PARTIAL has no route of its own: it falls through to the DONE event and Jordan.
  const branch = verifyBranchSource();
  assert.doesNotMatch(branch, /if \(honest\.kind === 'partial'\)/,
    'PARTIAL must fall through to review, not get a return of its own');
  const doneIdx = SRC.indexOf("registerEvent(id, 'DONE'");
  assert.ok(doneIdx > SRC.indexOf(branch) + branch.length,
    'the DONE event — and the review it starts — is still what follows the verdict branch');
});

// ═══ traps ══════════════════════════════════════════════════════════════════

test("J-daemon-survives-recovery — trap 1: the pinned call site and its order are untouched", () => {
  const callIdx = SRC.indexOf('verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut)');
  assert.ok(callIdx > 0, 'j-rom-work-substance pins this call byte for byte');
  const doneIdx = SRC.indexOf("registerEvent(id, 'DONE'");
  assert.ok(callIdx < doneIdx, 'verification must still run before the DONE event');

  // The exact regex j-rom-work-substance trap 1 uses. Its first return must still be the
  // ERROR path's, or the assertion it makes about writeErrorFile silently stops applying.
  const block = SRC.match(/if \(!verify\.ok\)[\s\S]*?return;\s*\}/);
  assert.ok(block, 'the verify-failure block must still be findable by the pinning regex');
  assert.match(block[0], /writeErrorFile\(errorPath, id, verify\.reason/,
    'the reason the rule returns must still reach the ERROR file');

  // The skip is INSIDE the branch, not wrapped around the call.
  assert.match(verifyBranchSource(), /const honest = classifyHonestNonProduct\(id, sliceBranch\);/,
    'the honest-report verdict is read inside the branch');
  assert.doesNotMatch(SRC, /if \(!verify\.ok && /, 'the branch condition itself must not grow a clause');
});

test('J-daemon-survives-recovery — trap 2: the startup fault is unreachable in-process, so the guard runs a child', () => {
  // Requiring the module finishes evaluating it, LOCK_FILES and all — which is exactly
  // why an in-process test cannot see fault 1. The startup block only runs for the entry
  // module, and the ac-1 guard above is the one that runs it.
  assert.match(SRC, /if \(require\.main === module\) \{/, 'the startup block is still entry-module-only');
  assert.equal(typeof orch.LOCK_FILES, 'object',
    'in-process the binding is always initialised — proof this file cannot reproduce the fault by requiring');

  const startupIdx = SRC.indexOf('if (require.main === module) {');
  for (const decl of [
    "const LOCK_FILES = ['regression/COVERAGE.lock'", // regenerateLocksAtLanding — the one that crashed
    'let BRANCH_STATE_PATH = ',                       // squashSliceToDev, one step further on
    'const STAGING_TRASH_SUFFIXES = ',                // isTerminal, called by crashRecovery itself
  ]) {
    const idx = SRC.indexOf(decl);
    assert.ok(idx > 0, `${decl} must still be declared once at module scope`);
    assert.ok(idx < startupIdx,
      `${decl} is read by a path startup recovery drives — it must be initialised before the startup block, not after it`);
  }

  // And the guard that proves it really does use a separate process.
  const self = fs.readFileSync(__filename, 'utf8');
  assert.match(self, /spawnSync\(process\.execPath/, 'the ac-1 guard must run the daemon in a child process');
  assert.match(self, /Module\._load\(ORCH, null, true\)/, '…with the orchestrator as the entry module');
});

test('J-daemon-survives-recovery — trap 3: the trash exclusion covers staging suffixes only, so real terminal states stay terminal', () => {
  // Read off bridge/trash/ on 2026-09-14: these are the shapes the pipeline writes.
  for (const staging of [
    '390-STAGED.md.approved',            // the dashboard's approve button
    '390-STAGED.md.approved.branch-checkout', // …after a checkout parked it again (13 live)
    '390-STAGED.md.amended',             // the dashboard's refine button
    '390-IN_PROGRESS.md.blocked',        // this slice's return-to-O'Brien route
  ]) {
    assert.equal(trashEntryRecordsStaging(staging), true, `${staging} records a start, not a finish`);
  }

  for (const terminal of [
    '390-PARKED.md.cleanup-ARCHIVED-2026-09-13T19-26-01-000Z',
    '390-IN_PROGRESS.md.cleanup-ERROR-2026-09-11T20-20-23-309Z',
    '390-ERROR.md.attempt1',
    '390-DONE.md',
    '390-DONE.md.branch-checkout',
    '390-NOG.md.pass',
    '390-IN_PROGRESS.md.orphan',
    '390-IN_PROGRESS.md.ratelimit',
    '390-IN_PROGRESS.md.api-retry',
  ]) {
    assert.equal(trashEntryRecordsStaging(terminal), false,
      `${terminal} must keep a finished slice terminal — a wrong answer here re-dispatches landed work`);
  }

  assert.deepEqual(STAGING_TRASH_SUFFIXES, ['.approved', '.amended', '.blocked'],
    'the exclusion list stays short and enumerated; widening it needs the same evidence this one had');

  // The narrowness is load-bearing: with a real completion record in trash the slice is
  // terminal again, even though the .approved entry is still sitting next to it.
  const root = mkTmp('trap3');
  const queueDir = path.join(root, 'queue');
  const trashDir = path.join(root, 'trash');
  for (const d of [queueDir, trashDir]) fs.mkdirSync(d, { recursive: true });
  const regFile = path.join(root, 'register.jsonl');
  fs.writeFileSync(regFile, '');
  fs.writeFileSync(path.join(trashDir, '366-STAGED.md.approved'), 'approved\n');
  assert.equal(isTerminal('366', { queueDir, trashDir, regFile }), false);
  fs.writeFileSync(path.join(trashDir, '366-DONE.md.cleanup-ARCHIVED-2026-09-02T16-11-51-000Z'), 'archived\n');
  assert.equal(isTerminal('366', { queueDir, trashDir, regFile }), true,
    'a finished slice is still terminal, approval record or not');
});

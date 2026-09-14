'use strict';

/**
 * Journey: J-authoring-containment (Tier 1 — in-process, throwaway fixture repos)
 * Category: Gate & Merge
 *
 * Slice 359. Two halves of one change: the operator can dispatch Julian for ONE flagged
 * acceptance criterion, and the agent that dispatch spawns now runs in a box.
 *
 * Before this, kickOffAuthoring() spawned `claude -p --permission-mode bypassPermissions`
 * with cwd set to the repo root, and the only thing keeping that agent out of the live
 * suite was a sentence in its prompt. A per-AC button multiplies how often that spawn
 * happens, so the box ships with the button.
 *
 *   ac-1  one flagged AC can be authored on its own, and what comes back is a reviewable
 *         draft — never an installed test.
 *   ac-2  the agent's writable world is a throwaway worktree; the live suite is not in it.
 *   ac-3  every run is verified afterwards, and a run that touched the live suite or the
 *         source directories is rejected with its draft withheld.
 *   ac-4  a dispatch records who requested it.
 *   ac-5  a run that ends in a question surfaces as a question awaiting a human, and
 *         leaves no stale progress marker behind.
 *   trap1 authoring is not applying: a contained run installs nothing, whatever its
 *         declared target says.
 *   trap2 a spawn from an HTTP POST has no operator identity of its own — the endpoints
 *         refuse an unproven origin, and a dispatch is never recorded with a blank one.
 *   trap3 a run that ends must not keep reporting itself as in-flight.
 *   trap4 model and effort come from configuration, and the sandboxed spawn still uses them.
 *
 * Every containment fixture is its own git repo in a tmpdir, so nothing here can write to
 * this one. Fixture AC tags live in the reserved 99xxx range and are never named in a
 * test() title, so the coverage deriver cannot mistake one for real coverage.
 *
 * // @ac-hash: slice-359-ac-1 sha256:125d16965df34771d93cd253c63424fe7adc6a9893e3750f41d94cc87ccfe37c
 * // @ac-hash: slice-359-ac-2 sha256:0ea3a4284521eee05ad8803d08397b3641d28995af6342289cb7a2f1a53513c5
 * // @ac-hash: slice-359-ac-3 sha256:c0cbd68e02a390a4854d3b2cb467627895f3ab9a6e5c459c8b3784af05306f2a
 * // @ac-hash: slice-359-ac-4 sha256:44b64e2d4b9044988809cf4e47b921f63c869d875fd56aa376535773a210432c
 * // @ac-hash: slice-359-ac-5 sha256:4792476b9eb1c830acd8ffd00a4f6e0fbc994a6ce62876bc43eb3e341abea2a1
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_SRC = path.join(REPO_ROOT, 'dashboard', 'server.js');
const HTML_SRC = path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html');
const AUTHOR_SRC = path.join(REPO_ROOT, 'scripts', 'author-ac-test.js');
const SERVER = fs.readFileSync(SERVER_SRC, 'utf8');
const HTML = fs.readFileSync(HTML_SRC, 'utf8');
const AUTHOR = fs.readFileSync(AUTHOR_SRC, 'utf8');

const { runContained, isPoliced, formatBreaches, POLICED_DIRS } = require('../../lib/author-sandbox');
const { authoringStateFor, recordAuthoringDispatch, kickOffAuthoring } = require('../../dashboard/server');
const { agentModel } = require('../../lib/agent-model');

// Reserved fixture tags — never a real AC, and never written into a test() title here.
const FX = 'slice-99359-ac-1';
const LIVE_DRAFTS = path.join(REPO_ROOT, 'regression', '.drafts');

const roots = [];
after(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (_) {} }
  clearLiveFixture();
});

// What this file may leave in the REAL drafts directory: fixture-tagged files only.
function clearLiveFixture() {
  let files = [];
  try { files = fs.readdirSync(LIVE_DRAFTS); } catch (_) { return; }
  for (const f of files) {
    if (f.startsWith(FX + '.')) { try { fs.unlinkSync(path.join(LIVE_DRAFTS, f)); } catch (_) {} }
  }
}
const liveFixture = (name, body) => {
  fs.mkdirSync(LIVE_DRAFTS, { recursive: true });
  fs.writeFileSync(path.join(LIVE_DRAFTS, name), body == null ? 'x' : body);
};

const LIVE_GUARD = "const { test } = require('node:test');\ntest('the live guard', () => {});\n";

/** A miniature of this repo: the policed directories, a guard in one of them, one commit. */
function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'author-sandbox-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args,
    { cwd: root, encoding: 'utf8', env: { ...process.env, DS9_WATCHER_MERGE: '1' } });
  for (const d of POLICED_DIRS.concat(['regression/gate-merge'])) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'regression/.drafts/\nnode_modules\n');
  fs.writeFileSync(path.join(root, 'regression', 'gate-merge', 'j-live.test.js'), LIVE_GUARD);
  fs.writeFileSync(path.join(root, 'e2e', 'live.spec.js'), '// a browser guard\n');
  fs.writeFileSync(path.join(root, 'dashboard', 'server.js'), '// the server\n');
  git('init', '-q', '-b', 'dev');
  git('config', 'user.email', 'fixture@example.com');
  git('config', 'user.name', 'Fixture');
  git('add', '-A');
  git('commit', '-qm', 'fixture suite');
  return { root, git, drafts: path.join(root, 'regression', '.drafts') };
}

const DRAFT_BODY = "// a proposed guard\nconst { test } = require('node:test');\n";
const TARGET_REL = 'regression/gate-merge/j-authored.test.js';

/** A well-behaved agent: writes only where it was told, and records what it was handed. */
function goodAgent(files, seen) {
  return ({ cwd, draftsDir }) => {
    if (seen) seen.push({ cwd, draftsDir });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(draftsDir, name), body);
    return { status: 0 };
  };
}

/** The failure this whole slice exists for: an agent writing the suite it can see. */
function rogueAgent({ cwd, draftsDir }) {
  fs.writeFileSync(path.join(draftsDir, `${FX}.draft.test.js`), DRAFT_BODY);
  fs.writeFileSync(path.join(cwd, 'regression', 'gate-merge', 'j-live.test.js'), '// weakened to nothing\n');
  fs.writeFileSync(path.join(cwd, 'e2e', 'sneaky.spec.js'), '// a guard nobody reviewed\n');
  return { status: 0 };
}

// ── slice-359-ac-1 ────────────────────────────────────────────────────────────────────
test('J-authoring-containment slice-359-ac-1 — one AC can be authored on its own, and the result is a reviewable draft, not an installed test', () => {
  const { root, drafts } = fixtureRepo();
  const res = runContained({
    repoRoot: root, tag: FX, draftDir: drafts,
    runAgent: goodAgent({
      [`${FX}.draft.test.js`]: DRAFT_BODY,
      [`${FX}.target.json`]: JSON.stringify({ tag: FX, new: TARGET_REL }),
      [`${FX}.rationale.txt`]: 'guards the criterion directly',
    }),
  });

  assert.equal(res.ok, true, `the run must succeed: ${JSON.stringify(res.breaches)} ${res.error || ''}`);
  assert.deepEqual(res.harvested.sort(),
    [`${FX}.draft.test.js`, `${FX}.rationale.txt`, `${FX}.target.json`],
    'the draft, its declared target and its rationale come back out of the box');
  assert.equal(fs.readFileSync(path.join(drafts, `${FX}.draft.test.js`), 'utf8'), DRAFT_BODY,
    'the draft is readable where the review path looks for it');

  // …and it is a DRAFT. The target file it declares does not exist: authoring proposes,
  // applying installs, and this path never does the second one.
  assert.ok(!fs.existsSync(path.join(root, TARGET_REL)),
    'a draft must not be installed at its declared target — that is the apply path (slice 358)');

  // The dispatch itself: one AC, over the same machinery, from a control on that AC's card.
  assert.match(SERVER, /pathname === '\/api\/check-test-updates\/author-one' && req\.method === 'POST'/,
    'a per-AC dispatch endpoint must exist');
  assert.match(SERVER, /kickOffAuthoring\(\[tag\], \{ provenance: origin\.provenance, journey \}\)/,
    'the per-AC dispatch must reuse kickOffAuthoring, not a parallel spawn path');
  assert.match(HTML, /onclick="_dispatchAuthoring\('\$\{tagAttr\}', this\)"/,
    'the flagged card must carry the per-AC dispatch control');
  assert.match(HTML, /uiFetch\('\/api\/check-test-updates\/author-one'/,
    'the control must dispatch over the nonce-bearing fetch');
});

// ── slice-359-ac-2 ────────────────────────────────────────────────────────────────────
test('J-authoring-containment slice-359-ac-2 — the agent runs in a throwaway worktree, so it cannot write the live suite', () => {
  const { root, drafts } = fixtureRepo();
  const live = path.join(root, 'regression', 'gate-merge', 'j-live.test.js');
  const seen = [];

  const res = runContained({
    repoRoot: root, tag: FX, draftDir: drafts,
    runAgent: (ctx) => { seen.push(ctx); return rogueAgent(ctx); },
  });

  const ctx = seen[0];
  assert.ok(ctx, 'the agent must actually be run');
  assert.notEqual(path.resolve(ctx.cwd), path.resolve(root),
    'the agent must never be handed the live checkout as its working directory');
  assert.equal(path.resolve(ctx.draftsDir), path.resolve(ctx.cwd, 'regression', '.drafts'),
    'it writes into the sandbox’s own drafts directory, not this repo’s');
  assert.ok(!path.resolve(ctx.draftsDir).startsWith(path.resolve(root) + path.sep),
    'and that directory is outside the live checkout entirely');

  // The rogue writes went somewhere. Not here.
  assert.equal(fs.readFileSync(live, 'utf8'), LIVE_GUARD, 'the live guard must be byte-identical');
  assert.ok(!fs.existsSync(path.join(root, 'e2e', 'sneaky.spec.js')),
    'a guard the agent invented must not appear in the live browser suite');
  assert.ok(!fs.existsSync(ctx.cwd), 'and the sandbox is gone when the run ends');
  assert.equal(res.ok, false, 'a run that wrote outside the drafts directory is not a success');

  // The rule itself: the drafts directory is the one hole in the policed set.
  assert.equal(isPoliced('regression/.drafts/x.draft.test.js'), false);
  assert.equal(isPoliced('regression/gate-merge/j-live.test.js'), true);
  for (const d of ['e2e', 'lib', 'scripts', 'dashboard', 'bridge']) {
    assert.equal(isPoliced(`${d}/anything.js`), true, `${d}/ must be policed`);
  }
});

// ── slice-359-ac-3 ────────────────────────────────────────────────────────────────────
test('J-authoring-containment slice-359-ac-3 — every run is verified afterwards, and a run that touched the suite has its draft withheld', () => {
  const { root, drafts } = fixtureRepo();
  const res = runContained({ repoRoot: root, tag: FX, draftDir: drafts, runAgent: rogueAgent });

  assert.equal(res.ok, false, 'a run that changed a policed directory must be rejected');
  const touched = res.breaches.map(b => b.path).sort();
  assert.deepEqual(touched, ['e2e/sneaky.spec.js', 'regression/gate-merge/j-live.test.js'],
    'the rejection names what was touched — both the modified guard and the added one');
  assert.match(formatBreaches(res.breaches), /e2e\/sneaky\.spec\.js/,
    'and it is formatted for a human to read, not just counted');

  // Withheld: the draft exists nowhere the review or apply path can reach it.
  assert.deepEqual(res.harvested, [], 'nothing is carried out of a run that broke containment');
  assert.ok(!fs.existsSync(path.join(drafts, `${FX}.draft.test.js`)),
    'the draft must not be presented for review');
  assert.equal(authoringStateFor(FX).state !== 'drafted', true,
    'and nothing on disk may make it read as drafted');

  // Withheld, not lost: the operator can still read what the agent wrote.
  const withheld = (res.withheld || []).find(w => w.name === `${FX}.draft.test.js`);
  assert.ok(withheld && withheld.source === DRAFT_BODY,
    'the withheld draft comes back as text, so the failure report can quote it');

  // Verification happens on EVERY run, not only the suspicious ones: a clean run is
  // verified too, and says so by reporting no breaches.
  const clean = runContained({
    repoRoot: root, tag: FX, draftDir: drafts,
    runAgent: goodAgent({ [`${FX}.draft.test.js`]: DRAFT_BODY }),
  });
  assert.deepEqual(clean.breaches, [], 'a well-behaved run is verified and comes back clean');
  assert.equal(clean.ok, true);

  // …and it stays clean while THIS SYSTEM works around it. The live checkout is not a
  // clean room: O'Brien stages a slice, a role's wrap-up appends a timesheet, the gate
  // rewrites its own report — all under policed directories, all during the ten minutes a
  // run takes. None of it is the agent, and none of it may cost the operator a good draft.
  const routine = runContained({
    repoRoot: root, tag: FX, draftDir: drafts,
    runAgent: (ctx) => {
      fs.mkdirSync(path.join(root, 'bridge', 'staged'), { recursive: true });
      fs.writeFileSync(path.join(root, 'bridge', 'staged', '396-STAGED.md'), '# a slice O’Brien staged\n');
      fs.writeFileSync(path.join(root, 'bridge', 'timesheet-obrien.jsonl'), '{"role":"obrien"}\n');
      fs.writeFileSync(path.join(root, 'regression', 'AC-CHECK.json'), '{"flagged":[]}\n');
      return goodAgent({ [`${FX}.draft.test.js`]: DRAFT_BODY })(ctx);
    },
  });
  assert.deepEqual(routine.breaches, [],
    'the system’s own routine writes are not the authoring agent writing outside its box');
  assert.deepEqual(routine.harvested, [`${FX}.draft.test.js`],
    'and the draft the operator asked for is delivered, not withheld over them');

  // The reach-around is still caught — including on a file that was ALREADY DIRTY when the
  // run started. Status codes cannot see that one (` M` before, ` M` after), and the files
  // most likely to be dirty are the ones someone has open: exactly the interesting targets.
  const server = path.join(root, 'dashboard', 'server.js');
  fs.writeFileSync(server, '// the server, with somebody’s work in progress\n');
  const reachAround = runContained({
    repoRoot: root, tag: FX, draftDir: drafts,
    runAgent: (ctx) => {
      fs.writeFileSync(server, '// the gate that judges me, edited by me\n');
      fs.writeFileSync(path.join(root, 'regression', 'gate-merge', 'j-rogue.test.js'), '// invented\n');
      return goodAgent({ [`${FX}.draft.test.js`]: DRAFT_BODY })(ctx);
    },
  });
  assert.deepEqual(reachAround.breaches.map(b => b.path).sort(),
    ['dashboard/server.js', 'regression/gate-merge/j-rogue.test.js'],
    'an absolute-path write into the live checkout is caught even where git’s status code never changed');
  assert.deepEqual(reachAround.harvested, [], 'and that run’s draft is withheld too');
  assert.match(formatBreaches(reachAround.breaches), /\[live checkout\] dashboard\/server\.js/,
    'the report says which checkout it happened in, so the operator knows where to look');

  // The failure is loud where the operator is looking: the script writes the report, and
  // the panel renders it as a failure with what it says, not as a spinner.
  assert.match(AUTHOR, /CONTAINMENT BREACH — the authoring agent wrote outside the drafts directory\./);
  assert.match(AUTHOR, /writeFailure\(/, 'a breach writes a failure report');
  assert.match(HTML, /utc-authored-fail/, 'and the panel has a failure state to render it in');
  assert.match(HTML, /Julian&#39;s run FAILED/, 'which says the run failed, in words');
});

// ── slice-359-ac-4 ────────────────────────────────────────────────────────────────────
test('J-authoring-containment slice-359-ac-4 — a dispatch records who requested it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'author-dispatch-'));
  roots.push(dir);
  const register = path.join(dir, 'register.jsonl');

  const marker = recordAuthoringDispatch(FX, { provenance: 'human-click', draftsDir: dir, register });
  assert.equal(marker.provenance, 'human-click');

  // The in-flight marker carries it, so the panel can say who has an agent running.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, `${FX}.running`), 'utf8'));
  assert.equal(onDisk.provenance, 'human-click');
  assert.equal(onDisk.tag, FX);
  assert.ok(Date.parse(onDisk.ts) > 0, 'and when it started');

  // …and the register carries the permanent record, the same way an approval does.
  const events = fs.readFileSync(register, 'utf8').trim().split('\n').map(JSON.parse);
  const ev = events.find(e => e.event === 'AC_AUTHORING_DISPATCH');
  assert.ok(ev, 'a dispatch is an event in the register');
  assert.equal(ev.tag, FX);
  assert.equal(ev.provenance, 'human-click');
  assert.ok(Date.parse(ev.ts) > 0);

  // The route decides the provenance server-side — the request may never assert its own.
  const route = SERVER.slice(SERVER.indexOf("'/api/check-test-updates/author-one'"),
                             SERVER.indexOf("'/api/regression/report'"));
  assert.match(route, /classifyApprovalOrigin\(req\)/, 'the origin is classified by the server');
  assert.doesNotMatch(route, /body.*provenance|provenance.*JSON\.parse/,
    'and never read from the request body');
});

// ── slice-359-ac-5 ────────────────────────────────────────────────────────────────────
test('J-authoring-containment slice-359-ac-5 — a run that ends in a question surfaces as a question, with no marker left running', () => {
  const { root, drafts } = fixtureRepo();
  const question = 'Should the pill show the trend for a single run, or only across runs?';
  const res = runContained({
    repoRoot: root, tag: FX, draftDir: drafts,
    runAgent: goodAgent({ [`${FX}.QUESTION.md`]: question }),
  });

  assert.equal(res.ok, true, 'a question is an answer request, not a failed run');
  assert.deepEqual(res.harvested, [`${FX}.QUESTION.md`], 'the question comes out of the sandbox');
  assert.deepEqual(res.breaches, [], 'and asking one is not a containment breach');

  // On screen it is a question awaiting a human — and the marker that said "working" is gone.
  clearLiveFixture();
  liveFixture(`${FX}.QUESTION.md`, question);
  liveFixture(`${FX}.running`, JSON.stringify({ tag: FX, ts: new Date().toISOString() }));
  const st = authoringStateFor(FX);
  assert.equal(st.state, 'question', 'a question on file reads as a question, never as still-working');
  assert.match(st.question, /single run/, 'and carries the text the operator has to answer');
  assert.ok(!fs.existsSync(path.join(LIVE_DRAFTS, `${FX}.running`)),
    'the in-flight marker must not survive the run that asked the question');
  clearLiveFixture();

  // The answer goes back to the same dispatch, so a question is never a dead end.
  assert.match(HTML, /utc-q-input/, 'the question is renderable with somewhere to answer it');
  assert.match(SERVER, /if \(st === 'question' && !answered\) continue;/,
    'a question parks the tag until it is answered');
  assert.match(SERVER, /if \(answered\) args\.push\('--journey', journey\);/,
    'and the answer is handed to the next run as the decided journey');
});

// ── trap 1 — authoring is not applying ────────────────────────────────────────────────
test('J-authoring-containment slice-359-ac-1 trap — a contained run installs nothing, whatever its declared target says', () => {
  const { root, git, drafts } = fixtureRepo();
  const head = git('rev-parse', 'HEAD').trim();

  runContained({
    repoRoot: root, tag: FX, draftDir: drafts,
    runAgent: goodAgent({
      [`${FX}.draft.test.js`]: DRAFT_BODY,
      // A target that names an EXISTING guard: applying this would overwrite it. Authoring
      // must not, or "review before it lands" would be a description of nothing.
      [`${FX}.target.json`]: JSON.stringify({ tag: FX, replaces: 'regression/gate-merge/j-live.test.js' }),
    }),
  });

  assert.equal(fs.readFileSync(path.join(root, 'regression', 'gate-merge', 'j-live.test.js'), 'utf8'),
    LIVE_GUARD, 'the guard the draft would replace is untouched until someone applies it');
  assert.equal(git('status', '--porcelain', '--', ...POLICED_DIRS).trim(), '',
    'an authoring run leaves the policed directories exactly as it found them');
  assert.equal(git('rev-parse', 'HEAD').trim(), head, 'and commits nothing');

  // The dispatch endpoint authors. It has no apply in it at all.
  const route = SERVER.slice(SERVER.indexOf("'/api/check-test-updates/author-one'"),
                             SERVER.indexOf("'/api/regression/report'"));
  // A missing route slices to '', and "no apply in ''" is true of every file ever written.
  assert.ok(route.length > 0, 'there must be a route to check before checking what is not in it');
  assert.doesNotMatch(route, /applyDraft|applyPlanFor/,
    'dispatching an authoring run must share no code with applying a draft');
  assert.doesNotMatch(AUTHOR, /require\('\.\.\/lib\/apply-draft'\)/,
    'and the authoring script cannot apply one either');
});

// ── trap 2 — a spawn from an HTTP POST has no operator identity ───────────────────────
test('J-authoring-containment slice-359-ac-4 trap — an unproven dispatch is refused, and one that gets through is never recorded blank', () => {
  // Both spawn paths — the CHECK press and the per-AC button — are origin-gated, because
  // both make the system spend a model run on the strength of one POST.
  for (const route of ['author', 'author-one']) {
    const body = SERVER.slice(SERVER.indexOf(`'/api/check-test-updates/${route}' && req.method === 'POST'`));
    const head = body.slice(0, body.indexOf('kickOffAuthoring'));
    assert.match(head, /classifyApprovalOrigin\(req\)/, `/${route} must classify the request's origin`);
    assert.match(head, /res\.writeHead\(403/, `/${route} must refuse a request with no live UI nonce`);
    assert.match(head, /E_NOT_UI/, `/${route} must say why it refused`);
  }

  // And when a dispatch does happen with nothing known about its origin, that is what gets
  // written down — never an empty field, which is what let an unattributed event be read
  // as a person on 2026-09-01.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'author-blank-'));
  roots.push(dir);
  const register = path.join(dir, 'register.jsonl');
  const marker = recordAuthoringDispatch(FX, { draftsDir: dir, register });
  assert.equal(marker.provenance, 'machine-unknown', 'an unattributed dispatch is machine-origin');
  const ev = fs.readFileSync(register, 'utf8').trim().split('\n').map(JSON.parse)
    .find(e => e.event === 'AC_AUTHORING_DISPATCH');
  assert.equal(ev.provenance, 'machine-unknown', 'and the register says so too');
  assert.match(SERVER, /PROVENANCED_EVENTS = new Set\(\[[^\]]*'AC_AUTHORING_DISPATCH'/,
    'a dispatch event is in the set that can never be written without provenance');
});

// ── trap 3 — a finished run must stop reporting itself as in-flight ───────────────────
test('J-authoring-containment slice-359-ac-5 trap — a run that ended reads as failed, not as still drafting', () => {
  clearLiveFixture();
  // A run that failed FAST used to clear its marker and read as 'pending', which the panel
  // renders as "Julian is drafting…" — a spinner for a process that had already exited.
  liveFixture(`${FX}.FAILED.md`, '# failed\n\nCONTAINMENT BREACH — it wrote e2e/sneaky.spec.js');
  liveFixture(`${FX}.running`, JSON.stringify({ tag: FX, ts: new Date().toISOString() }));
  const failed = authoringStateFor(FX);
  assert.equal(failed.state, 'failed', 'a failure report on file reads as failed');
  assert.equal(failed.reason, 'run');
  assert.match(failed.detail, /CONTAINMENT BREACH/, 'and carries why, so the panel can show it');
  assert.ok(!fs.existsSync(path.join(LIVE_DRAFTS, `${FX}.running`)),
    'the stale progress marker is cleared, not left to time out');
  clearLiveFixture();

  // The same for a draft rejected by the contract — also a finished run.
  liveFixture(`${FX}.REJECTED.md`, '# rejected\n\nE_ANNOTATION_MISSING');
  assert.equal(authoringStateFor(FX).reason, 'contract');
  clearLiveFixture();

  // A genuinely in-flight marker still reads as in-flight, and is not re-dispatched over:
  // a second agent on the same tag would race the first onto the same draft file.
  liveFixture(`${FX}.running`, JSON.stringify({ tag: FX, ts: new Date().toISOString(), provenance: 'human-click' }));
  const running = authoringStateFor(FX);
  assert.equal(running.state, 'authoring');
  assert.equal(running.by, 'human-click', 'and names who set it going');
  assert.deepEqual(kickOffAuthoring([FX]), [], 'an in-flight tag must not be dispatched again');
  clearLiveFixture();

  // And the script clears its own marker on every exit path — proved by RUNNING it, not by
  // reading it. The two guard clauses that refuse to spawn (no resolvable AC hash, no model
  // from configuration) used to exit before the handler was even registered, so a dispatch
  // that failed in under a second still held the card at "Julian is on it…" for twelve
  // minutes and then reported a bare timeout. This tag resolves to no AC anywhere, so the
  // run takes the first of those exits — without spawning an agent.
  liveFixture(`${FX}.running`, JSON.stringify({ tag: FX, ts: new Date().toISOString() }));
  const ran = spawnSync(process.execPath, [AUTHOR_SRC, FX],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(ran.status, 2, 'a run with no resolvable AC refuses to spawn an agent');
  assert.ok(!fs.existsSync(path.join(LIVE_DRAFTS, `${FX}.running`)),
    'and it takes its in-flight marker with it, rather than leaving the card spinning');
  const report = authoringStateFor(FX);
  assert.equal(report.state, 'failed', 'the panel reads it as failed, not as pending or timed out');
  assert.equal(report.reason, 'run');
  assert.match(report.detail, /could not be resolved/,
    'and the failure says what went wrong instead of timing out into a blank one');
  clearLiveFixture();
});

// ── trap 4 — the model comes from configuration, even inside the box ──────────────────
test('J-authoring-containment slice-359-ac-2 trap — the sandboxed spawn still takes its model and effort from configuration', () => {
  const configured = agentModel(REPO_ROOT);
  assert.ok(configured.model && configured.effort,
    `bridge/bridge.config.json must supply the model and effort (${configured.source})`);

  // The spawn moved into the sandbox; what it spawns at did not move with it.
  const runAgent = AUTHOR.slice(AUTHOR.indexOf('function runAgent('), AUTHOR.indexOf('function writeFailure('));
  assert.match(runAgent, /'--model', model, '--effort', effort/,
    'the sandboxed spawn must still pass the configured pair');
  assert.match(runAgent, /spawnSync\('claude', args,\s*\{ cwd,/,
    'and it must run in the sandbox, not in the repo root');
  assert.doesNotMatch(runAgent, /['"]claude-[a-z0-9-]+['"]/, 'no model id may be hardcoded');
  assert.equal(AUTHOR.split("spawnSync('claude'").length - 1, 1,
    'the agent is spawned in exactly one place — the one inside the sandbox');

  // The prompt is built per-run around the sandbox's drafts directory, so every path the
  // agent is told to write to is inside the box.
  assert.match(AUTHOR, /function promptFor\(draftsDir\)/);
  assert.match(AUTHOR, /promptFor\(draftsDir\)/, 'and the spawn uses the run’s own drafts directory');
});

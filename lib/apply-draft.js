'use strict';
// ── apply-draft.js — putting a drafted guard into the suite, on the operator's word ──
//
// Slice 356 made Julian's drafts readable. Slice 357 made them applicable by construction.
// This is the step that actually moves one: for a flagged AC with a drafted guard, PLAN
// what applying it would do, show that plan, and — only on the operator's confirmation —
// land the guard at its declared target and regenerate COVERAGE.lock in the same commit.
//
// ── Why plan-then-confirm, and not one button ────────────────────────────────────────
// Philipp refused to click "No test needed for this AC" when a test WAS needed. That
// refusal is what commissioned this: the only ways an AC leaves the flagged list are (a) a
// real guard now covers it, or (b) a human knowingly says no test is needed. Writing into
// the test suite is irreversible in the sense that matters — it is the thing every later
// green depends on — so the machine computes the consequences, shows them, and waits.
//
// ── Why "green" is not enough ────────────────────────────────────────────────────────
// A guard can be applied, run, PASS, and register NOTHING: the coverage deriver counts a
// tag only where an `@ac-hash` annotation sits beside a tagged test() title (or the test
// reads a BEHAVIOUR source). That AC then stays flagged and the only control left is the
// lie. So the plan rebuilds the coverage map with the draft in place and asserts the TAG
// IS IN IT. A pass with no registration is a refusal, not a success.
//
// ── What this module may never do ────────────────────────────────────────────────────
//   · never write regression/AC-DECISIONS.json (or any AC-custody file). That ledger is a
//     permanent, unprovenanced un-flag — `{"<tag>":"keep"}`, no actor, no timestamp, no
//     sha — and triageTag() then answers needsHuman:false forever, across every future dev
//     sha. This path clears a flag by GUARDING the AC or not at all.
//   · never change an acceptance criterion. docs/contracts/ac-custody.md is explicit:
//     "Reconcile may update a TEST from an AC; never the reverse." The write set is
//     exactly two paths and both are checked against the custody list before anything is
//     written; the commit carries no `AC:` trailer.
//   · never leave a half-applied tree. Every check runs against a scratch mirror BEFORE a
//     byte is written inside the repo, so a refusal is structurally a no-op rather than a
//     rollback that has to work.
//
// The deriver's own functions do the deriving (buildCoverageMap/serialize) and the draft
// contract does the validating, so "what counts as coverage" cannot drift apart from what
// this module predicts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const { buildCoverageMap, serialize, walkTests, walkSpecs } = require('../scripts/build-coverage-map');
const { validateDraft, parseDraftName, targetName, manifestAcHash } = require('./draft-contract');

const TAG_RE = /^slice-\d+-ac-\d+$/;
const DRAFTS_REL = 'regression/.drafts';
const LOCK_REL = 'regression/COVERAGE.lock';

// The runners, one per extension the draft contract allows. A guard is run the way the
// suite runs it, or its result would not be evidence about the suite.
//
// The caps are what an operator will sit through, not what a runner might want. The server
// is single-threaded and these run under spawnSync, so the whole dashboard — every route,
// the poll, the heartbeat — is frozen for the duration, and a confirm pays it twice
// (applyDraft recomputes the plan). A guard that needs longer than this is refused as "did
// not finish inside its time limit", which is a sentence the operator can read and act on;
// a four-minute freeze is not. The 90s for a spec is set against a playwright config whose
// own per-test cap is 20s and whose webServer boot is capped at 30s.
const RUNNERS = {
  'test.js': { label: 'node --test', timeoutMs: 60000 },
  'spec.js': { label: 'playwright test', timeoutMs: 90000 },
};

// The scratch file a draft is EXECUTED as. Dot-prefixed and named once, so .gitignore can
// name it too: a crashed run leaves ignored debris rather than a file the next `git add -A`
// commits. It is written into the TARGET'S OWN DIRECTORY on purpose — a guard resolves the
// repo with path.resolve(__dirname, '..', '..'), so running it at any other depth makes it
// read a repo that is not there and fail for a reason that has nothing to do with the AC.
const SCRATCH_STEM = '.apply-scratch';

// ── AC custody — the paths this operation may never write ────────────────────────────
// The spec layer and everything that records a ruling about it. AC-MANIFEST.lock is here
// and COVERAGE.lock is not, which is the whole asymmetry of the custody contract: a test
// may be updated from an AC, never the reverse.
const AC_CUSTODY_FILES = new Set([
  'regression/AC-MANIFEST.lock',
  'regression/AC-DECISIONS.json',
  'regression/AC-DRAINED.json',
  'regression/AC-CHECK.json',
  'regression/AC-RECONCILE.json',
  'regression/TESTS-NEEDED.json',
]);
const AC_CUSTODY_DIRS = ['docs/contracts/', 'docs/adr/', 'bridge/queue/', 'bridge/staged/', '.claude/'];

/** True when writing `rel` would touch an acceptance criterion or a ruling about one. */
function touchesAc(rel) {
  const p = String(rel == null ? '' : rel).split(path.sep).join('/');
  if (AC_CUSTODY_FILES.has(p)) return true;
  return AC_CUSTODY_DIRS.some(d => p.startsWith(d));
}

const refuse = (code, message) => ({ code, message });
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const posix = (p) => String(p).split(path.sep).join('/');

// ── The scratch mirror ───────────────────────────────────────────────────────────────
// A throwaway root holding EXACTLY the files the coverage deriver reads — every
// regression/**/*.test.js and e2e/**/*.spec.js, at their repo-relative paths. Faithful
// because buildCoverageMap() reads nothing else: bucketOf() classifies a source by its
// PATH, so the product files a guard names never have to exist here. This is what lets the
// plan answer "would the tag be counted?" without writing a byte inside the repo.
// A leftover scratch RUN file is excluded by name: the walkers take any file with the
// right extension, dot-prefixed or not, so debris from a crashed run must never be able to
// tilt the prediction the operator is asked to confirm.
function mirrorSuite(repoRoot, dest) {
  for (const d of ['regression', 'e2e']) fs.mkdirSync(path.join(dest, d), { recursive: true });
  for (const rel of [...walkTests(repoRoot), ...walkSpecs(repoRoot)]) {
    if (path.basename(rel).startsWith(SCRATCH_STEM + '.')) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), to);
  }
  return dest;
}

/**
 * Where the draft is run: the target's own directory when it exists, else any existing
 * sibling at the same depth (a `new` guard may name a directory nobody has created yet,
 * and the plan may not create it — planning writes nothing inside the repo).
 * __dirname-relative resolution depends on DEPTH, not on the directory's name.
 */
function scratchRunPathFor(repoRoot, targetRel, ext) {
  const dir = posix(path.dirname(targetRel));
  const file = `${SCRATCH_STEM}.${ext}`;
  if (fs.existsSync(path.join(repoRoot, dir))) return `${dir}/${file}`;
  const parent = posix(path.dirname(dir));
  let entries = [];
  try { entries = fs.readdirSync(path.join(repoRoot, parent), { withFileTypes: true }); } catch (_) { return null; }
  const sib = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
  return sib ? `${parent}/${sib.name}/${file}` : null;
}

// Run one guard, the way its suite runs it. Never throws: a runner that is missing, that
// dies, or that runs past its cap is reported as NOT GREEN, which refuses the apply.
function runGuard(repoRoot, { ext, scratchRel }) {
  const spec = RUNNERS[ext];
  if (!spec) return { ok: false, label: null, command: null, ms: 0, output: `no runner for .${ext}` };
  const isSpec = ext === 'spec.js';
  const cmd = isSpec ? 'npx' : process.execPath;
  const args = isSpec ? ['playwright', 'test', scratchRel, '--reporter=line'] : ['--test', scratchRel];
  const command = `${isSpec ? 'npx' : 'node'} ${args.join(' ')}`;
  const started = Date.now();
  // No CI=1: the playwright config turns on retries and an HTML report under CI, and a
  // retried flake reported as green is exactly the evidence this path must not accept.
  const env = { ...process.env, FORCE_COLOR: '0' };
  // …and NODE_TEST_CONTEXT is scrubbed, which is load-bearing. node:test sets it in every
  // test child; a `node --test` that inherits it switches to the child-reporter protocol
  // and EXITS 0 WITH FAILING TESTS. Any parent that happens to set it — a harness, a CI
  // step, a wrapper that starts the dashboard — would otherwise make every red guard read
  // green here, at the one place where green is the entire question.
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: spec.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
  const timedOut = res.error && res.error.code === 'ETIMEDOUT';
  return {
    ok: !res.error && res.status === 0,
    label: spec.label,
    command,
    ms: Date.now() - started,
    timedOut: !!timedOut,
    output: (timedOut ? `timed out after ${spec.timeoutMs}ms\n` : '') + out.slice(-4000),
  };
}

/**
 * planApply({ repoRoot, tag, run }) → the plan. CHANGES NOTHING THE REPO KEEPS.
 *
 * Precisely: the coverage map is rebuilt against a scratch mirror in a tmpdir, and the one
 * thing written inside the repo is the dot-prefixed scratch RUN file (SCRATCH_STEM, below)
 * — a guard has to execute at its landing depth or it resolves a repo that is not there.
 * That file is removed in a finally, it is gitignored, and the suite's own glob does not
 * match a dot-prefixed name, so a concurrent run cannot pick it up. Every tracked file is
 * byte-identical before and after; that is what the ac-1 guard measures.
 *
 * `run` is the guard runner (injectable so a test can plan without spawning a suite).
 * The plan is appliable exactly when `ok` is true; `refusals` says why not, in words the
 * operator can act on. `token` fingerprints the decisive facts — the apply will not act on
 * a plan whose facts have moved since the operator read them.
 */
function planApply(opts) {
  const o = opts || {};
  const repoRoot = o.repoRoot;
  const tag = String(o.tag == null ? '' : o.tag);
  const run = typeof o.run === 'function' ? o.run : runGuard;
  const refusals = [];
  const plan = { tag, ok: false, refusals, writes: [] };

  if (!TAG_RE.test(tag)) { refusals.push(refuse('E_BAD_TAG', `"${tag}" is not an AC tag`)); return plan; }

  // ── the draft on disk ──
  const draftsDir = path.join(repoRoot, DRAFTS_REL);
  let names = [];
  try { names = fs.readdirSync(draftsDir); } catch (_) { names = []; }
  const name = names.filter(f => f.startsWith(`${tag}.draft.`)).sort()[0];
  if (!name) {
    refusals.push(refuse('E_NO_DRAFT', `no draft for ${tag} — press CHECK to have Julian draft one`));
    return plan;
  }
  const parsed = parseDraftName(name);
  const ext = parsed ? parsed.ext : null;
  let source = '';
  try { source = fs.readFileSync(path.join(draftsDir, name), 'utf8'); }
  catch (_) { refusals.push(refuse('E_NO_DRAFT', `${name} is not readable`)); return plan; }
  plan.draft = { name, path: `${DRAFTS_REL}/${name}`, source, bytes: Buffer.byteLength(source) };

  let target = null;
  try { target = JSON.parse(fs.readFileSync(path.join(draftsDir, targetName(tag)), 'utf8')); } catch (_) {}

  // ── the draft contract (slice 357), including "new" naming a file that already exists ──
  const { errors } = validateDraft({
    filename: name, source, target, repoRoot,
    expectedAcHash: manifestAcHash(repoRoot, tag),
  });
  for (const e of errors) refusals.push(refuse('E_CONTRACT', e.message));
  if (errors.length || !target) return plan;

  const mode = Object.prototype.hasOwnProperty.call(target, 'replaces') ? 'replaces' : 'new';
  const targetRel = posix(mode === 'replaces' ? target.replaces : target.new);
  plan.target = { path: targetRel, mode, exists: fs.existsSync(path.join(repoRoot, targetRel)) };

  // ── trap 5 — a guard lands in the suite, and never back in the drafts directory ──
  const inSuite = targetRel.startsWith('regression/') || targetRel.startsWith('e2e/');
  if (!inSuite || targetRel.startsWith(`${DRAFTS_REL}/`)) {
    refusals.push(refuse('E_OUTSIDE_SUITE',
      `${targetRel} is not a place a guard may land — a draft applies into regression/ or e2e/, never into ${DRAFTS_REL}/`));
    return plan;
  }

  // ── trap 3 — nothing in this operation may touch an acceptance criterion ──
  plan.writes = [targetRel, LOCK_REL];
  const custody = plan.writes.filter(touchesAc);
  if (custody.length) {
    refusals.push(refuse('E_TOUCHES_AC',
      `applying this would write ${custody.join(', ')} — an acceptance criterion is the human's to change, never this path's`));
    return plan;
  }

  // ── the coverage map, rebuilt against a scratch copy ──
  const lockAbs = path.join(repoRoot, LOCK_REL);
  let liveLock = null;
  try { liveLock = fs.readFileSync(lockAbs, 'utf8'); } catch (_) {}
  if (liveLock == null) {
    refusals.push(refuse('E_NO_LOCK', `${LOCK_REL} is missing — there is no coverage map to regenerate`));
    return plan;
  }

  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-apply-'));
  let before, after;
  try {
    mirrorSuite(repoRoot, mirror);
    before = buildCoverageMap(mirror);
    const mirrored = path.join(mirror, targetRel);
    fs.mkdirSync(path.dirname(mirrored), { recursive: true });
    fs.writeFileSync(mirrored, source);
    after = buildCoverageMap(mirror);
  } finally {
    try { fs.rmSync(mirror, { recursive: true, force: true }); } catch (_) {}
  }

  // ── trap 4 — the regenerated lock must be THIS apply's change and nothing else ──
  // If the committed lock already disagrees with the suite on disk, regenerating it here
  // would sweep somebody else's uncommitted test change into this commit.
  const lockInSync = serialize(before) === liveLock;
  if (!lockInSync) {
    refusals.push(refuse('E_LOCK_STALE',
      `${LOCK_REL} is already out of date with the tests on disk. Regenerating it here would commit changes this apply did not make — run node scripts/build-coverage-map.js and commit that first.`));
  }

  const registered = (after.bySource[targetRel] || []).filter(g => g && g.tag === tag);
  plan.coverage = {
    tagInMap: registered.length > 0,
    registeredAs: registered[0] || null,
    guardCount: { before: before.guardCount, after: after.guardCount, delta: after.guardCount - before.guardCount },
    lockInSync,
  };
  plan._after = after;                      // the exact map the apply must reproduce

  // ── trap 2 — a passing test is not a counted test ──
  if (!plan.coverage.tagInMap) {
    refusals.push(refuse('E_TAG_NOT_IN_MAP',
      `rebuilt with this guard at ${targetRel}, the coverage map still does not carry ${tag}. It would run, pass, and count for nothing — ${tag} would stay flagged.`));
  }
  if (plan.coverage.guardCount.delta < 0) {
    refusals.push(refuse('E_GUARD_COUNT_FELL',
      `applying this drops the guard count from ${before.guardCount} to ${after.guardCount} — the suite would cover less than it does now`));
  }

  // ── run the draft where it would land ──
  const scratchRel = scratchRunPathFor(repoRoot, targetRel, ext);
  if (!scratchRel) {
    refusals.push(refuse('E_NO_SCRATCH', `cannot run the draft at the depth of ${targetRel} — no directory to run it in`));
    return plan;
  }
  const scratchAbs = path.join(repoRoot, scratchRel);
  try {
    fs.writeFileSync(scratchAbs, source);
    plan.run = run(repoRoot, { ext, scratchRel, tag });
  } catch (err) {
    // A runner that cannot even be started is not evidence of green.
    plan.run = { ok: false, command: null, ms: 0, output: String(err && err.message || err).slice(0, 400) };
  } finally {
    try { fs.unlinkSync(scratchAbs); } catch (_) {}
  }
  if (!plan.run || typeof plan.run.ok !== 'boolean') plan.run = { ok: false, output: 'the guard was never run' };
  plan.run.at = scratchRel;
  if (!plan.run.ok) {
    refusals.push(refuse('E_SUITE_RED',
      plan.run.timedOut
        ? `the guard did not finish inside its time limit, so it is not green`
        : `the guard is not green when it runs at ${path.dirname(targetRel)}/ — applying it would turn the suite red`));
  }

  plan.ok = refusals.length === 0;
  plan.token = tokenFor(plan);
  return plan;
}

// The decisive facts, fingerprinted. Timings and console output are deliberately out: they
// move between two identical runs, and a token that changes on its own would turn every
// confirmation into a refusal.
function tokenFor(plan) {
  return sha256(JSON.stringify({
    tag: plan.tag,
    draft: plan.draft && plan.draft.name,
    source: plan.draft && sha256(plan.draft.source),
    target: plan.target && plan.target.path,
    mode: plan.target && plan.target.mode,
    writes: plan.writes,
    tagInMap: plan.coverage && plan.coverage.tagInMap,
    guards: plan.coverage && plan.coverage.guardCount,
    green: plan.run && plan.run.ok === true,
    ok: plan.ok,
  }));
}

// What a plan is safe to hand to a browser: everything but the predicted map, which is an
// implementation detail and the size of COVERAGE.lock.
function publicPlan(plan) {
  const { _after, ...rest } = plan;
  return rest;
}

// The three stamped keys from slice 354, rendered as commit trailers. No stamp, no apply:
// a write into the test suite that cannot say how it was authorized is exactly the
// unattributed action the provenance work exists to stop.
function stampTrailers(repoRoot, tag, provenance, loadModule) {
  const load = loadModule || ((r) => require(path.join(r, 'bridge', 'approval-provenance')));
  const mod = load(repoRoot);
  if (!Object.values(mod.PROVENANCE).includes(provenance)) {
    throw new Error(`unknown approval provenance "${provenance}"`);
  }
  if (provenance === mod.PROVENANCE.MACHINE_UNKNOWN || provenance === mod.PROVENANCE.LEGACY_UNATTRIBUTED) {
    throw new Error(`provenance "${provenance}" cannot apply a guard — a person confirms this, or nobody does`);
  }
  const stamp = mod.stampFrontmatter(repoRoot, { id: `apply-draft:${tag}`, provenance });
  return [
    `Applied-Draft: ${tag}`,
    `Approval-Provenance: ${stamp.approval_provenance}`,
    `Approval-Ts: ${stamp.approval_ts}`,
    `Approval-Sig: ${stamp.approval_sig}`,
  ];
}

// Wrap a paragraph at git's customary width so the message reads in `git log` rather than
// running off the side of it.
function wrap(text, width = 76) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line.length + 1 + word.length) > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

function commitMessageFor(plan, trailers) {
  const landing = plan.target.mode === 'replaces'
    ? `overwriting the guard already at ${plan.target.path}`
    : `as a new guard at ${plan.target.path}`;
  const g = plan.coverage.guardCount;
  const msg = [
    `test(coverage): guard ${plan.tag}`,
    '',
    ...wrap(`Applied ${plan.draft.path} from the CHECK overlay, ${landing}, after the `
      + `operator read the plan and confirmed it.`),
    '',
    ...wrap(`It runs green there (${plan.run.command}) and the rebuilt coverage map `
      + `credits ${plan.tag} to that file — a guard that passes without registering `
      + `would leave the criterion flagged. ${LOCK_REL} is regenerated in this same `
      + `commit (${g.before} → ${g.after} read-corroborated guards), so the lock and the `
      + `tree never disagree between commits.`),
    '',
    ...trailers,
    '',
  ].join('\n');
  // An apply must never declare, restate or retire an acceptance criterion.
  if (/^AC:/m.test(msg) || /^AC-Change-OK:/m.test(msg)) {
    throw new Error('the apply commit message must not carry an AC trailer');
  }
  return msg;
}

/**
 * applyDraft({ repoRoot, tag, planToken, provenance, run, git }) → the outcome.
 *
 * The plan is RECOMPUTED here; the caller's token can only ever add a refusal. Nothing is
 * written until every check has passed against the scratch mirror, and a failure after the
 * first byte restores the two files it touched.
 */
function applyDraft(opts) {
  const o = opts || {};
  const repoRoot = o.repoRoot;
  const plan = planApply(o);

  if (!plan.ok) return { ok: false, stage: 'plan', refusals: plan.refusals, plan: publicPlan(plan) };
  // ── AC-1 — the two steps. No plan read, no token; no token, no write. ──
  if (!o.planToken) {
    return { ok: false, stage: 'confirm', plan: publicPlan(plan),
      refusals: [refuse('E_NOT_CONFIRMED', 'nothing is written until the operator confirms the plan they were shown')] };
  }
  if (o.planToken !== plan.token) {
    return { ok: false, stage: 'confirm', plan: publicPlan(plan),
      refusals: [refuse('E_STALE_PLAN', 'the draft or the suite moved since this plan was shown — read the new plan and confirm that one')] };
  }

  const git = typeof o.git === 'function' ? o.git : (args) => execFileSync('git', args, {
    cwd: repoRoot, encoding: 'utf8', timeout: 30000,
    // The main working tree's pre-commit hook admits only the sanctioned write paths.
    // This is one: a human confirmed it, and the commit carries who authorized it.
    env: { ...process.env, DS9_WATCHER_MERGE: '1' },
  }).trim();

  let trailers;
  try { trailers = stampTrailers(repoRoot, plan.tag, o.provenance, o.loadProvenance); }
  catch (err) {
    return { ok: false, stage: 'confirm', plan: publicPlan(plan),
      refusals: [refuse('E_NO_PROVENANCE', String(err && err.message || err))] };
  }

  const targetRel = plan.target.path;
  const targetAbs = path.join(repoRoot, targetRel);
  const lockAbs = path.join(repoRoot, LOCK_REL);
  const had = fs.existsSync(targetAbs);
  const prevTarget = had ? fs.readFileSync(targetAbs) : null;
  const prevLock = fs.readFileSync(lockAbs);
  let wroteTarget = false;

  const rollback = () => {
    try { git(['reset', '-q', '--', targetRel, LOCK_REL]); } catch (_) {}
    try {
      if (wroteTarget) { if (had) fs.writeFileSync(targetAbs, prevTarget); else fs.unlinkSync(targetAbs); }
    } catch (_) {}
    try { fs.writeFileSync(lockAbs, prevLock); } catch (_) {}
  };

  try {
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.writeFileSync(targetAbs, plan.draft.source);
    wroteTarget = true;

    // ── AC-2 — the lock is regenerated from the tree the guard now sits in ──
    const rebuilt = serialize(buildCoverageMap(repoRoot));
    if (rebuilt !== serialize(plan._after)) {
      throw new Error('the rebuilt coverage map is not the one the plan showed — the tree moved mid-apply');
    }
    fs.writeFileSync(lockAbs, rebuilt);

    // …and both land in ONE commit. `--only` with an explicit pathspec is what makes it
    // one change: whatever else is staged in this working tree stays staged and stays out.
    git(['add', '--', targetRel, LOCK_REL]);
    git(['commit', '--only', '-m', commitMessageFor(plan, trailers), '--', targetRel, LOCK_REL]);

    const sha = git(['rev-parse', 'HEAD']);
    const files = git(['show', '--name-only', '--format=', 'HEAD']).split('\n').map(s => s.trim()).filter(Boolean).sort();
    const expected = [targetRel, LOCK_REL].sort();
    if (JSON.stringify(files) !== JSON.stringify(expected)) {
      return { ok: false, stage: 'commit', plan: publicPlan(plan), commit: { sha, files },
        refusals: [refuse('E_COMMIT_DRIFT', `the commit ${sha.slice(0, 7)} carries ${files.join(', ')} — expected exactly ${expected.join(' and ')}. Inspect it before anything else touches this branch.`)] };
    }
    return {
      ok: true, stage: 'done', plan: publicPlan(plan),
      commit: { sha, short: sha.slice(0, 7), files, pushed: false, provenance: o.provenance },
    };
  } catch (err) {
    rollback();
    return { ok: false, stage: 'apply', plan: publicPlan(plan),
      refusals: [refuse('E_APPLY_FAILED', `${String(err && err.message || err).slice(0, 300)} — nothing was applied; the tree is as it was`)] };
  }
}

module.exports = {
  planApply, applyDraft, publicPlan, touchesAc, mirrorSuite, scratchRunPathFor,
  runGuard, commitMessageFor, stampTrailers, tokenFor,
  AC_CUSTODY_FILES, AC_CUSTODY_DIRS, SCRATCH_STEM, LOCK_REL, DRAFTS_REL, RUNNERS,
};

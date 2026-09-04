'use strict';

// J-rom-work-substance — whether Rom worked is decided by the DIFF (slice 375).
//
// The old rule in verifyRomActuallyWorked failed any branch that was exactly one
// commit ahead of the integration branch when the DONE report self-reported more
// than 1000 tokens_out. It never looked inside the commit. It killed two finished
// slices: 366 (700 insertions, a 274-line suite) and 371 (8 files, +988/−14). The
// ERROR text then contradicted itself, saying "made no commits" and "1 commit(s)
// ahead" in one sentence.
//
// One clean commit is normal, and better practice than two. So the load-bearing
// tests here are the two that keep the rule honest in BOTH directions: real work
// in a single commit must pass (no matter what the report claims), and a branch
// that only files its own paperwork must still fail — with its own reason, not by
// pretending there are no commits.
//
// The self-reported metrics are not evidence. They can only produce a log warning.
//
// @ac-hash: slice-375-ac-1 sha256:2203ba7486a7a086162e3dfc4068556b900ca31cb5bdcdc343da1c2d6ebc49da
// @ac-hash: slice-375-ac-2 sha256:d0fc52e37e3e94d478131522a418bd7db12fefa8a058eaf47564544670298c27
// @ac-hash: slice-375-ac-3 sha256:2bfeb0423c80dec8e346be4ff570e3cd5f17fba3588e8aff5214f4219815d1a0
// @ac-hash: slice-375-ac-4 sha256:e5df61a9766d3c5fb5f6534c3fa26dba65ea06858bbdc762b09eca00964b548b
// @ac-hash: slice-375-ac-5 sha256:cea49fb58eeef9175d0d21ba1e7b772e06ec490ce5ddf30e4fab6628637b0a31
// @ac-hash: slice-375-ac-6 sha256:5c2d774d14e8a6377fdc227636fb590507840948e9fe677be2062112c812e6e1
// @ac-hash: slice-375-ac-7 sha256:4c53cf94d41440f0ae8309cd10090aa774ce38081ef43aa0cac1a03e77d85f29

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_PATH = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const LOG_FILE = path.join(REPO_ROOT, 'bridge', 'bridge.log');
const SRC = fs.readFileSync(ORCH_PATH, 'utf8');

const gitFinalizer = require('../../bridge/git-finalizer');
const orchestrator = require('../../bridge/orchestrator.js');
const { verifyRomActuallyWorked } = orchestrator;

// Sandbox: DONE fixtures and register writes go to a temp dir, never into the
// live bridge/queue the running watcher polls.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rom-substance-'));
orchestrator._testSetDirs(TMP, TMP, TMP);
orchestrator._testSetRegisterFile(path.join(TMP, 'register.jsonl'));

// The integration branch the rule compares against, read the way the rule reads it.
const INTEGRATION = orchestrator.INTEGRATION_BRANCH;

// ── Fixtures ────────────────────────────────────────────────────────────────

// A DONE report claiming substantial work — the exact shape the old rule punished.
function writeDone(id, tokensOut, elapsedMs) {
  fs.writeFileSync(path.join(TMP, `${id}-DONE.md`), [
    '---', `id: "${id}"`, 'status: DONE',
    `tokens_in: ${tokensOut}`, `tokens_out: ${tokensOut}`, `elapsed_ms: ${elapsedMs}`,
    'estimated_human_hours: 2.0', 'compaction_occurred: false', '---', '', '## Summary', 'x',
  ].join('\n'));
}

// Stands in for git: answers the three commands the rule issues and records them,
// so a test can prove the verdict was read off the diff and not off the report.
function withGit({ exists = true, commits = 1, numstat = '' }, fn) {
  const real = gitFinalizer.runGit;
  const seen = [];
  gitFinalizer.runGit = (cmd) => {
    seen.push(cmd);
    if (cmd.includes('rev-parse --verify')) {
      if (!exists) throw new Error('fatal: Needed a single revision');
      return '';
    }
    if (cmd.includes('rev-list')) return String(commits) + '\n';
    if (cmd.includes('diff --numstat')) return numstat;
    return '';
  };
  try { return fn(seen); } finally { gitFinalizer.runGit = real; }
}

const PRODUCT_DIFF = [
  '121\t0\tbridge/queue/371-DONE.md',
  '28\t10\tdashboard/lcars-dashboard.html',
  '11\t2\tdashboard/server.js',
  '423\t0\tregression/authoring-staging/j-reorder-proposed-backlog.test.js',
].join('\n') + '\n';

// Every path the brief names as bookkeeping, in one diff. Nothing else.
const BOOKKEEPING_ONLY_DIFF = [
  '199\t0\tbridge/queue/375-DONE.md',
  '4\t2\tbridge/state/branch-state.json',
  '1\t1\tbridge/heartbeat.json',
  '3\t0\tbridge/timesheet.jsonl',
  '12\t0\tbridge/trash/366-DONE.md',
].join('\n') + '\n';

// ── AC-1: an empty branch still fails the way it always did ─────────────────

test('slice-375-ac-1 a branch with zero commits ahead of the integration branch still fails with rom_no_commits', () => {
  writeDone('99375', 8600, 1980000);
  const result = withGit({ commits: 0, numstat: '' }, () =>
    verifyRomActuallyWorked('99375', 'slice/99375', 22000, 563));

  assert.equal(result.ok, false, 'a branch level with the integration branch is not work');
  assert.equal(result.reason, 'rom_no_commits', 'the existing no-commits reason must survive');
  assert.match(result.detail, new RegExp(INTEGRATION), 'the detail names the branch it was compared against');
});

// ── AC-2: one commit with real content passes, decided from the diff ────────

test('slice-375-ac-2 one commit touching a file outside the bookkeeping paths passes, read off the diff not the report', () => {
  // The report claims 8600 tokens_out — the exact input that used to fail this branch.
  writeDone('99375', 8600, 1980000);
  const result = withGit({ commits: 1, numstat: PRODUCT_DIFF }, (seen) => {
    const r = verifyRomActuallyWorked('99375', 'slice/99375', 22000, 563);
    assert.ok(
      seen.some((c) => /git diff --numstat/.test(c) && c.includes(`${INTEGRATION}...slice/99375`)),
      `the rule must ask git what changed; commands issued: ${JSON.stringify(seen)}`,
    );
    return r;
  });

  assert.deepEqual(result, { ok: true }, 'one clean commit of real work is work');

  // Same report, same commit count, only the diff differs → opposite verdict.
  // That is what "decided from the diff rather than the report" means.
  const empty = withGit({ commits: 1, numstat: BOOKKEEPING_ONLY_DIFF }, () =>
    verifyRomActuallyWorked('99375', 'slice/99375', 22000, 563));
  assert.equal(empty.ok, false, 'the identical report must not carry a branch with no product change');
});

// ── AC-3: paperwork only is its own, named failure ──────────────────────────

test('slice-375-ac-3 a branch that changes only bookkeeping files fails with rom_no_product_change', () => {
  writeDone('99375', 8600, 1980000);
  const result = withGit({ commits: 2, numstat: BOOKKEEPING_ONLY_DIFF }, () =>
    verifyRomActuallyWorked('99375', 'slice/99375', 22000, 563));

  assert.equal(result.ok, false, 'filing the DONE report is not delivering the slice');
  assert.equal(result.reason, 'rom_no_product_change', 'the reason must be distinct from rom_no_commits');
  assert.match(result.detail, /product/i, 'the detail names the absence of a product change');

  // A DONE report alone is the canonical case.
  const doneOnly = withGit({ commits: 1, numstat: '199\t0\tbridge/queue/375-DONE.md\n' }, () =>
    verifyRomActuallyWorked('99375', 'slice/99375', 22000, 563));
  assert.equal(doneOnly.reason, 'rom_no_product_change', 'a DONE-report-only branch is no product change');

  // And the ERROR file must speak for the new reason instead of falling through
  // to the frontmatter-validation text.
  assert.ok(SRC.includes("reason === 'rom_no_product_change'"),
    'writeErrorFile must handle rom_no_product_change');
});

// ── AC-4: the self-reported number cannot fail a slice; it warns ────────────

test('slice-375-ac-4 a wild self-reported token count cannot fail a slice, and the divergence is warned about', () => {
  writeDone('99375', 999999, 9990000);           // absurd claim
  const before = (() => { try { return fs.statSync(LOG_FILE).size; } catch (_) { return 0; } })();

  const result = withGit({ commits: 1, numstat: PRODUCT_DIFF }, () =>
    verifyRomActuallyWorked('99375', 'slice/99375', 22000, 500)); // 2000× the actual

  assert.deepEqual(result, { ok: true }, 'a number Rom typed is not evidence about the branch');

  const tail = (() => {
    try {
      const fd = fs.openSync(LOG_FILE, 'r');
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.max(0, size - before));
      if (buf.length) fs.readSync(fd, buf, 0, buf.length, before);
      fs.closeSync(fd);
      return buf.toString('utf8');
    } catch (_) { return ''; }
  })();

  const warned = tail.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return {}; } })
    .find((e) => e.id === '99375' && /Metrics divergence/.test(e.msg || ''));
  assert.ok(warned, 'the claimed-vs-actual divergence must still be written as a warning');
  assert.equal(warned.level, 'warn', 'divergence is a warning, not a verdict');
});

// ── AC-5: no failure message claims "no commits" about a branch that has one ─

test('slice-375-ac-5 no failure message says there are no commits when the branch has one', () => {
  writeDone('99375', 8600, 1980000);

  for (const commits of [1, 2, 7]) {
    const r = withGit({ commits, numstat: BOOKKEEPING_ONLY_DIFF }, () =>
      verifyRomActuallyWorked('99375', 'slice/99375', 22000, 563));
    assert.notEqual(r.reason, 'rom_no_commits',
      `a branch ${commits} commit(s) ahead must never be reported as having no commits`);
    assert.doesNotMatch(r.detail, /no commits|made no commits/i,
      `the detail contradicted itself: ${r.detail}`);
    assert.match(r.detail, new RegExp(`${commits} commit\\(s\\)`),
      'the detail states the real commit count');
  }

  // The ERROR-file text for the new reason must not inherit the old sentence.
  const arm = SRC.match(/reason === 'rom_no_product_change'\s*\?\s*`([^`]*)`/);
  assert.ok(arm, "the rom_no_product_change arm of writeErrorFile's detail was not found");
  assert.doesNotMatch(arm[1], /no commits|made no commits/i,
    'the ERROR text for a branch that HAS commits must not say it has none');
});

// ── AC-6: the function others call keeps its name and signature ─────────────

test('slice-375-ac-6 verifyRomActuallyWorked keeps its name and its four-parameter signature', () => {
  assert.equal(typeof verifyRomActuallyWorked, 'function', 'still exported under its own name');
  assert.equal(verifyRomActuallyWorked.length, 4, 'still takes (id, branchName, actualDurationMs, actualTokensOut)');
  assert.match(SRC, /function verifyRomActuallyWorked\(id, branchName, actualDurationMs, actualTokensOut\)/,
    'the declaration itself must be unchanged — test/ callers bind to it by name');
});

// ── AC-7: the rule, run against the real slice/371, as it stands ────────────

// slice/371 is a local branch that was never pushed; a clean CI checkout does not
// have it. Resolve it honestly and skip rather than pass on an absent ref — the
// branch-existence guard returns ok:true for a missing branch, which would be a
// green that proves nothing.
function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function refExists(ref) {
  try { git(['rev-parse', '--verify', '--quiet', ref]); return true; } catch (_) { return false; }
}
const HAS_371 = refExists('refs/heads/slice/371') && refExists(`refs/heads/${INTEGRATION}`);
const SKIP_371 = 'slice/371 is not in this checkout (local-only branch) — nothing to run the rule against';

// The commit this slice was written about is FROZEN, but `slice/371` is not the ref that
// holds it any more. O'Brien re-staged 371 as attempt 2: the original branch was renamed
// to slice/371-attempt1 and a fresh slice/371 cut from dev to continue the work on. The
// artifact is unchanged — same commit, same blobs — so the assertions below name the ref
// that actually preserves it. Pinning them to a live working branch made them fail the
// moment anyone touched 371 again, which is the opposite of what a freeze guard is for.
const FROZEN_371 = 'slice/371-attempt1';
const HAS_FROZEN_371 = refExists(`refs/heads/${FROZEN_371}`) && refExists(`refs/heads/${INTEGRATION}`);
const SKIP_FROZEN_371 = `${FROZEN_371} is not in this checkout (local-only branch) — nothing to compare against`;

// Wires the real runGit to real git in this repo, with the orchestrator's own
// dependency injection. Only the register and log sinks are redirected.
function withRealGit(fn) {
  gitFinalizer.init({
    PROJECT_DIR: REPO_ROOT,
    registerEvent: () => {},
    log: () => {},
    HEARTBEAT_FILE: path.join(TMP, 'heartbeat.json'),
    QUEUE_DIR: TMP,
  });
  return fn();
}

test('slice-375-ac-7 the rule passes on the real single-commit branch slice/371', (t) => {
  if (!HAS_371) return t.skip(SKIP_371);

  // 371's report claimed far more than 1000 tokens_out — the input that failed it.
  writeDone('371', 8600, 1980000);
  const result = withRealGit(() => verifyRomActuallyWorked('371', 'slice/371', 22000, 563));

  assert.deepEqual(result, { ok: true },
    `slice/371 is 8 files and +988/−14 of finished work: ${JSON.stringify(result)}`);
});

// ── Trap 1: the call site and the ERROR path stay wired ─────────────────────

test('J-rom-work-substance — trap 1: invokeRom still calls the function by name and routes its reason to the ERROR file', () => {
  const callIdx = SRC.indexOf('verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut)');
  assert.ok(callIdx > 0, 'invokeRom must still call verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut)');

  const doneIdx = SRC.indexOf("registerEvent(id, 'DONE'");
  assert.ok(doneIdx > 0 && callIdx < doneIdx, 'verification must still run before the DONE event');

  const block = SRC.match(/if \(!verify\.ok\)[\s\S]*?return;\s*\}/);
  assert.ok(block, 'the verify-failure block was not found');
  assert.match(block[0], /writeErrorFile\(errorPath, id, verify\.reason/,
    'whatever reason the rule returns must reach the ERROR file — including rom_no_product_change');

  // Both reasons the rule can return are spelled out in writeErrorFile.
  for (const reason of ['rom_no_commits', 'rom_no_product_change']) {
    assert.ok(SRC.includes(`reason === '${reason}'`), `writeErrorFile must handle ${reason}`);
  }
});

// ── Trap 2: slice/371's commit was not touched to make this pass ────────────

test('J-rom-work-substance — trap 2: slice/371 still stands as it was, one unmodified commit', (t) => {
  if (!HAS_FROZEN_371) return t.skip(SKIP_FROZEN_371);

  assert.equal(git(['rev-parse', FROZEN_371]), '4357ad2e3762fec1d5a468b58abde48c71d7207a',
    `${FROZEN_371} must still point at 371's original commit — the rule was fixed, not the branch`);
  assert.equal(git(['rev-list', FROZEN_371, `^${INTEGRATION}`, '--count']), '1',
    'still exactly one commit ahead');
});

// ── Trap 3: the browser test on slice/371 is left alone ─────────────────────

test('J-rom-work-substance — trap 3: the browser test on slice/371 is untouched, and this slice writes none', (t) => {
  if (!HAS_FROZEN_371) return t.skip(SKIP_FROZEN_371);

  // Not this slice's business to remove or reject it — Julian keeps, rewrites or
  // drops it at his stage.
  assert.equal(git(['rev-parse', `${FROZEN_371}:e2e/staged-reorder.spec.js`]),
    '74f4ae4998c0fdfde202d6f08b2ea10fd2fc548e',
    `the 201-line spec on ${FROZEN_371} must still be there, byte for byte`);

  // And this branch WRITES no browser test of its own. Authorship, not reachability: the
  // commits made on this branch are its first-parent, non-merge history. A merge that
  // carries an already-existing commit across (371 attempt 1 → attempt 2, on O'Brien's
  // instruction) brings that commit's spec with it, and reading the flat
  // INTEGRATION...HEAD tree diff would book someone else's file as this branch's work.
  const own = git(['log', '--first-parent', '--no-merges', '--name-only', '--format=', `${INTEGRATION}..HEAD`])
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((p) => /^e2e\/.*\.spec\.js$/.test(p));
  assert.deepEqual([...new Set(own)], [],
    `Rom never writes a browser test; this branch touches: ${own.join(', ')}`);
});

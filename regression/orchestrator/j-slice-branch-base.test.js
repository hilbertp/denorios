'use strict';

// J-slice-branch-base — slices must be born on the INTEGRATION branch, and every
// lineage/scope/review comparison must be made against that same branch.
//
// Background (slice 353): every slice was cut from the local `main` ref, which sat
// 42 commits behind origin/main because the "refresh" ran `git merge --ff-only
// origin/main` — an operation on HEAD, not on `main`. With HEAD parked on `dev`,
// git answered "Already up to date", the verify re-read the untouched sha, and the
// guard logged `Fast-forwarded main: f7fd230 -> f7fd230`. Slices 348-352 were born
// conflicted off that frozen base; 350 would have silently reverted two landed
// fixes if merged naively.
//
// This guard reads bridge/orchestrator.js as text. It is a SHAPE assertion: the
// bug it prevents is a literal branch name creeping back into a git command on the
// slice path, which no behavioural test catches until a slice is already conflicted.
//
// @ac-hash: slice-353-ac-1 sha256:e6959bd1602ae97f439077c066e22991ba18fcdbd8131f57a8b2ec6e4433d426
// @ac-hash: slice-353-ac-2 sha256:6e3dbc2b695e99da32d0b59b126b542437f724a5d3d6b13a47cd88f885e1dee5
// @ac-hash: slice-353-ac-3 sha256:20848b572575d1fbf60b14b7639e3cf69270445fbf7bd2821f5e102ae240e6a2
// @ac-hash: slice-353-ac-4 sha256:068f817f9a40801a19222c611fbeed2eed0b937338ddd15556e883b177555afb
// @ac-hash: slice-353-ac-5 sha256:f601aea39e2bcd7140b2668c4b34a43accd3fc16300bfcebc7bf1e22a9ecad3a
// @ac-hash: slice-353-ac-6 sha256:654e10a369330557fb0efeddf53ac5001fb3e974dfd7250f21ef411465eea571
// @ac-hash: slice-353-ac-7 sha256:9e6e74b03e15a148a19a4c469fc90e233d85d8367d16a230801169dc9f107987

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_PATH  = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const CONFIG_PATH = path.join(REPO_ROOT, 'bridge', 'bridge.config.json');

const SRC = fs.readFileSync(ORCH_PATH, 'utf8');

// Lines that are pure comment or JSDoc. The prose deliberately says "main" a lot
// (it explains the bug), so every scan below runs over CODE ONLY.
function codeLines() {
  const out = [];
  let inBlockComment = false;
  SRC.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      return;
    }
    if (line.startsWith('//') || line.startsWith('*')) return;
    out.push({ n: i + 1, text: raw });
  });
  return out;
}

const CODE = codeLines();

function findCode(re) {
  return CODE.filter(l => re.test(l.text));
}

// ── AC-1 + AC-6: the worktree is BORN on the configured integration branch ──

test('slice-353-ac-1 the new-branch worktree command forks from the configured integration branch, never a literal main', () => {
  const adds = findCode(/git worktree add[^`]*-b \$\{branchName\}/);
  assert.equal(adds.length, 1, 'exactly one new-branch worktree creation command is expected');

  const cmd = adds[0].text;
  assert.match(cmd, /-b \$\{branchName\} \$\{INTEGRATION_BRANCH\}/,
    `worktree creation must fork from \${INTEGRATION_BRANCH}; got: ${cmd.trim()}`);
  assert.doesNotMatch(cmd, /-b \$\{branchName\} main\b/,
    'worktree creation must not fork from a literal main — that is the frozen-base bug');
});

test('slice-353-ac-6 branch topology is read from config with dev/main defaults', () => {
  assert.match(SRC, /integrationBranch:\s*'dev'/, "DEFAULTS must define integrationBranch: 'dev'");
  assert.match(SRC, /trunkBranch:\s*'main'/, "DEFAULTS must define trunkBranch: 'main'");
  assert.match(SRC, /const INTEGRATION_BRANCH\s*=\s*config\.integrationBranch/,
    'INTEGRATION_BRANCH must be resolved from config, not hardcoded');
  assert.match(SRC, /const TRUNK_BRANCH\s*=\s*config\.trunkBranch/,
    'TRUNK_BRANCH must be resolved from config, not hardcoded');

  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  assert.equal(cfg.integrationBranch, 'dev', 'bridge.config.json must mirror integrationBranch');
  assert.equal(cfg.trunkBranch, 'main', 'bridge.config.json must mirror trunkBranch');
});

// ── AC-6: no active-path git command still hardcodes main ───────────────────
//
// Scoped to the sites slice 353 moved. The retired direct-to-main path
// (mergeBranch, mergeIntegrity_*, archiveAccepted_sha, mergeDevToMain,
// fuseSafeCheckoutMain) legitimately names the trunk and is out of scope.

test('slice-353-ac-6 no slice-path git command hardcodes main', () => {
  // op: tags of the commands that must compare against the integration branch.
  const SLICE_PATH_OPS = [
    'createWorktree',
    'verifyBranch_ahead',
    'verifyBranch_mergeBase',
    'verifyBranch_isAncestor',
    'buildScopeDiff_stat',
    'buildScopeDiff_nameStatus',
    'verifyRomWork_revList',
    'nog_gitDiff',
    'classifyNoReport_log',
  ];

  for (const op of SLICE_PATH_OPS) {
    const lines = findCode(new RegExp(`op: '${op}'`));
    assert.ok(lines.length > 0, `expected to find the ${op} git command`);
    for (const l of lines) {
      assert.doesNotMatch(l.text, /(?:^|[\s`^.])main(?:\.\.|\.\.\.|\b)/,
        `${op} (line ${l.n}) must not reference a literal main:\n  ${l.text.trim()}`);
    }
  }

  // The Nog high-risk-surface diff is an execSync, not a runGit op: tag.
  const telemetryDiff = findCode(/git diff --name-only .*slice\/\$\{id\}/);
  assert.equal(telemetryDiff.length, 1, 'expected the NOG_TELEMETRY surface diff');
  assert.match(telemetryDiff[0].text, /\$\{INTEGRATION_BRANCH\}\.\.slice/,
    'the NOG_TELEMETRY surface diff must be taken against the integration branch');
});

// ── AC-5: Nog's review diff and the scope diff target the integration branch ──

test('slice-353-ac-5 Nog review diff and scope diff are three-dot against the integration branch', () => {
  const nog = findCode(/op: 'nog_gitDiff'/);
  assert.equal(nog.length, 1, 'expected exactly one nog_gitDiff command');
  assert.match(nog[0].text, /git diff \$\{INTEGRATION_BRANCH\}\.\.\.\$\{branchName\}/,
    "Nog must review INTEGRATION...branch, or the diff carries all of dev's unrelated work");

  for (const op of ['buildScopeDiff_stat', 'buildScopeDiff_nameStatus']) {
    const lines = findCode(new RegExp(`op: '${op}'`));
    assert.equal(lines.length, 1, `expected exactly one ${op} command`);
    assert.match(lines[0].text, /\$\{INTEGRATION_BRANCH\}\.\.\.\$\{branchName\}/,
      `${op} must diff INTEGRATION...branch`);
  }
});

// ── AC-2: lineage accepts ANY ancestor of the integration tip ───────────────

test('slice-353-ac-2 lineage asserts ancestry of the integration tip, not tip-equality', () => {
  const isAncestor = findCode(/op: 'verifyBranch_isAncestor'/);
  assert.equal(isAncestor.length, 1, 'lineage must use a merge-base --is-ancestor check');
  assert.match(isAncestor[0].text,
    /git merge-base --is-ancestor \$\{mergeBase\} \$\{INTEGRATION_BRANCH\}/,
    'the fork point must be asserted as an ANCESTOR of the integration tip');

  // The old semantics read the tip sha to compare against the merge-base. An
  // advancing dev makes that comparison false on every long-running slice.
  assert.doesNotMatch(SRC, /op: 'verifyBranch_mainTip'/,
    'the tip-equality lineage check must be gone — dev advances while a slice is in flight');
});

// ── AC-3: whole-branch-name matching ────────────────────────────────────────

test('slice-353-ac-3 branch-name matching is whole-name, so dev-linear cannot satisfy a check meant for dev', () => {
  assert.match(SRC, /function branchNamesFrom\(/, 'a whole-name branch parser must exist');

  // The substring form is the bug: `dev-linear`/`dev-linear2` both contain "dev".
  const containsCall = findCode(/op: 'verifyBranch_contains'/);
  assert.equal(containsCall.length, 1, 'expected the branch --contains diagnostic');
  assert.match(containsCall[0].text, /branchNamesFrom\(/,
    '`git branch --contains` output must be parsed into whole names, never substring-matched');
  assert.doesNotMatch(SRC, /isOnMain\.includes\(/,
    'the substring branch check must be gone');

  // Behavioural: the parser must reject look-alike names outright.
  const { branchNamesFrom } = require(ORCH_PATH);
  const parsed = branchNamesFrom('  dev-linear\n* dev-linear2\n+ slice/353\n  (HEAD detached at abc1234)\n');
  assert.deepEqual(parsed, ['dev-linear', 'dev-linear2', 'slice/353'],
    'markers and detached-HEAD rows must be stripped, names kept intact');
  assert.ok(!parsed.includes('dev'), 'dev-linear and dev-linear2 must NOT satisfy a check for dev');
  assert.ok(branchNamesFrom('  dev\n  dev-linear\n').includes('dev'), 'a real dev row must still match');
});

// ── AC-4 + AC-7: the refresh moves the ref, and proves it by comparing refs ──

test('slice-353-ac-4 the integration branch is fetched and refreshed before the worktree is created', () => {
  assert.match(SRC, /function ensureIntegrationIsFresh\(id\)/, 'the refresh must be integration-scoped');
  assert.match(SRC, /git fetch origin \$\{B\}/, 'the refresh must fetch the integration branch from origin');

  // Ordering: every worktree creation is preceded by the refresh in the same try block.
  const callSites = findCode(/ensureIntegrationIsFresh\(id\);/);
  assert.ok(callSites.length >= 2,
    `both the Rom and Bashir worktree paths must refresh first; found ${callSites.length}`);

  const createSites = findCode(/createWorktreeWithRetry\(createWorktree/);
  assert.ok(createSites.length >= 2, 'expected the worktree creation call sites');
  for (const create of createSites) {
    const preceding = callSites.filter(c => c.n < create.n && create.n - c.n <= 5);
    assert.ok(preceding.length > 0,
      `worktree creation at line ${create.n} must be immediately preceded by ensureIntegrationIsFresh`);
  }
});

test('slice-353-ac-7 the refresh moves the local ref and verifies by ref comparison, not by exit code', () => {
  // The fatal predecessor: `git merge --ff-only origin/main` acts on HEAD. It may
  // only run when HEAD is provably ON the branch being refreshed.
  assert.match(SRC, /function fastForwardIntegrationRef\(/,
    'the ref move must be factored into a HEAD-aware helper');
  assert.match(SRC, /if \(head === branch\) \{/,
    'the ff-merge path must be guarded by a HEAD-is-on-the-branch check');

  const ffMerge = findCode(/op: 'ffIntegration_ffMerge'/);
  assert.equal(ffMerge.length, 1, 'expected exactly one ff-merge command');
  const guardIdx = findCode(/if \(head === branch\) \{/)[0].n;
  assert.ok(ffMerge[0].n > guardIdx && ffMerge[0].n - guardIdx <= 3,
    'the ff-merge must sit inside the HEAD-is-on-the-branch guard');

  // HEAD-independent path: move the ref explicitly.
  assert.ok(
    findCode(/op: 'ffIntegration_fetchRef'/).length === 1 &&
    findCode(/op: 'ffIntegration_updateRef'/).length === 1,
    'when HEAD is elsewhere the ref must be moved explicitly (fetch refspec / update-ref)');

  // The post-condition: compare refs and THROW on mismatch. A no-op refresh must
  // never be reportable as a fast-forward.
  assert.match(SRC, /if \(after !== remote\) \{/,
    'the ff path must compare the local ref against origin and fail on mismatch');
  assert.match(SRC, /fast-forward of \$\{B\} did not move the local ref/,
    'a refresh that did not move the ref must raise, not log success');
  assert.match(SRC, /if \(afterRemote !== local\) \{/,
    'the push path must verify origin advanced');

  // The success log must be reached only after the comparison above.
  const successLog = findCode(/Fast-forwarded \$\{B\}/);
  assert.equal(successLog.length, 1, 'expected one fast-forward success log');
  const mismatchThrow = findCode(/fast-forward of \$\{B\} did not move the local ref/);
  assert.ok(successLog[0].n > mismatchThrow[0].n,
    'the success log must come AFTER the ref comparison that can throw');
});

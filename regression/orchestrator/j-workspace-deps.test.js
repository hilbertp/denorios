'use strict';

// J-workspace-deps — every workspace gets its dependencies (slice 376).
//
// `git worktree add` checks out TRACKED files only. node_modules is gitignored, so a
// fresh slice workspace could not run either suite. On slice 371 Rom worked around it
// by hand — symlink the main checkout's node_modules, remember to delete the link
// before committing — four calls of plumbing on every single run.
//
// The workaround was also a loaded gun. `node_modules/` (WITH the trailing slash)
// means "directory only"; git sees a symlink as a file, so the link was NOT ignored
// and the first `git add -A` would have committed it. The fix is two parts and both
// are load-bearing: createWorktree provisions the link, and .gitignore drops the
// slash. Reverting either one alone is caught below.
//
// @ac-hash: slice-376-ac-1 sha256:6a3e93cb09290862898859e84a55c4a84e1ed098822d6c979614e58987cc81fb
// @ac-hash: slice-376-ac-2 sha256:6e6f7b809a108ecd4bf3682f64f322e20cffd313e860f7bdd79eea5b9955b79f
// @ac-hash: slice-376-ac-3 sha256:88379708bca6022c35bd2aa6b6ba2b07c4e87481138421b690e40ce99027fb55
// @ac-hash: slice-376-ac-4 sha256:0ed0ae2330ee797d53c08877b0784d5a6a846af515916d7944d8b3ed9cae2bae
// @ac-hash: slice-376-ac-5 sha256:821694680608016dfc35b296d765cefc16f22dd2c5fd30e54923fcdd726cbacf

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_PATH = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const GITIGNORE_PATH = path.join(REPO_ROOT, '.gitignore');

const SRC = fs.readFileSync(ORCH_PATH, 'utf8');

const orchestrator = require(ORCH_PATH);
const { provisionWorkspaceDeps } = orchestrator;

// ── fixture: a throwaway "main checkout" + a worktree of it ──────────────────
//
// Everything that asserts on git's ignore behaviour runs against a fixture repo
// carrying a byte-for-byte copy of the SHIPPED .gitignore, never against the live
// repo. A real `git worktree add` of this repo would check out HEAD, whose .gitignore
// is whatever last landed — the file under test is the one on disk.

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Builds { root, workspace, cleanup }: a git repo with a node_modules holding one
// resolvable package, and a real worktree of it with nothing in it yet.
function makeCheckoutWithWorkspace({ gitignore } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-deps-'));
  const root = path.join(base, 'checkout');
  fs.mkdirSync(root);

  git(['init', '-q', '-b', 'main'], base && root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);

  fs.writeFileSync(
    path.join(root, '.gitignore'),
    gitignore !== undefined ? gitignore : fs.readFileSync(GITIGNORE_PATH, 'utf8'));
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(['add', '.gitignore', 'README.md'], root);
  git(['commit', '-qm', 'init'], root);

  // The dependency tree the workspace must end up with access to.
  const pkgDir = path.join(root, 'node_modules', 'fixture-dep');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"fixture-dep","version":"1.0.0","main":"index.js"}');
  fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = 376;\n');

  const workspace = path.join(base, 'workspace');
  git(['worktree', 'add', '-q', '--detach', workspace, 'HEAD'], root);

  return {
    root,
    workspace,
    cleanup() { try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {} },
  };
}

// provisionWorkspaceDeps reads the module-level PROJECT_DIR; point it at the fixture
// for the duration of one call and always put it back.
function provisionAgainst(root, workspace, id) {
  orchestrator._testSetProjectDir(root);
  try {
    return provisionWorkspaceDeps(workspace, id || 'test');
  } finally {
    orchestrator._testSetProjectDir(REPO_ROOT);
  }
}

// Comment/JSDoc lines are stripped: the prose below deliberately names `npm ci` and
// `playwright install` to explain why neither is used.
function codeLines(src) {
  const out = [];
  let inBlockComment = false;
  src.split('\n').forEach((raw, i) => {
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

const CODE = codeLines(SRC);
const findCode = (re) => CODE.filter(l => re.test(l.text));

// The body of provisionWorkspaceDeps, for the "it does no work" assertions.
function provisionerBody() {
  const start = SRC.indexOf('function provisionWorkspaceDeps(');
  assert.notEqual(start, -1, 'provisionWorkspaceDeps must exist in bridge/orchestrator.js');
  const end = SRC.indexOf('\n}\n', start);
  return SRC.slice(start, end);
}

// ── AC-1 ────────────────────────────────────────────────────────────────────

test('slice-376-ac-1 a newly created workspace has its dependencies immediately, with no manual step', () => {
  const fx = makeCheckoutWithWorkspace();
  try {
    // Precondition: this is exactly the state slice 371 hand-patched every run.
    assert.equal(fs.existsSync(path.join(fx.workspace, 'node_modules')), false,
      'a bare `git worktree add` must start with no dependencies — otherwise this test proves nothing');

    assert.equal(provisionAgainst(fx.root, fx.workspace), true, 'provisioning must report success');

    // "Available" means resolvable from inside the workspace, not merely present.
    const resolved = require.resolve('fixture-dep', { paths: [fx.workspace] });
    assert.equal(fs.readFileSync(resolved, 'utf8').trim(), 'module.exports = 376;',
      'the workspace must resolve a dependency that only exists in the main checkout');
  } finally {
    fx.cleanup();
  }

  // ...and no caller has to ask for it. createWorktree provisions on BOTH of its exits:
  // the fresh-create path and the reuse path.
  const calls = findCode(/provisionWorkspaceDeps\(wtPath, id\)/).filter(l => !/^\s*function /.test(l.text));
  assert.equal(calls.length, 2,
    `createWorktree must provision on both the fresh-create and the reuse path; found ${calls.length}`);

  const createFn = SRC.slice(SRC.indexOf('function createWorktree('), SRC.indexOf('function cleanupWorktree('));
  assert.match(createFn, /Reusing existing worktree[\s\S]*?return wtPath;/,
    'expected the reuse early-return inside createWorktree');
  const reuseReturn = createFn.indexOf('return wtPath;');
  assert.ok(createFn.indexOf('provisionWorkspaceDeps(wtPath, id)') < reuseReturn && reuseReturn !== -1,
    'the reuse path must provision BEFORE it returns, or a requeued slice gets an empty workspace');
});

// ── AC-2 ────────────────────────────────────────────────────────────────────
//
// Runs against a real worktree of THIS repo, because "can list the browser suite"
// cannot be faked: it loads the real playwright.config.js and collects e2e/.
//
// The safety-net suite needs only node, so it runs anywhere. The browser half needs
// the main checkout to actually have dependencies — ci.yml's `test` job installs none
// ("pure Node, no install step"), so there it is skipped by design and the e2e /
// promote jobs, which do install, are where it bites in CI.

test('slice-376-ac-2 a fresh workspace can run the safety-net suite and can list the browser suite', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-deps-real-'));
  const workspace = path.join(base, 'wt');
  try {
    git(['worktree', 'add', '-q', '--detach', workspace, 'HEAD'], REPO_ROOT);
    provisionAgainst(REPO_ROOT, workspace, '376-ac-2');

    // The safety-net suite: a real regression file, run from the fresh workspace.
    execFileSync(process.execPath,
      ['--test', path.join('regression', 'orchestrator', 'j-slice-branch-base.test.js')],
      { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const hasDeps = fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@playwright', 'test'));
    if (hasDeps) {
      assert.doesNotThrow(() => require.resolve('@playwright/test', { paths: [workspace] }),
        'the browser runner must be resolvable from the fresh workspace');

      const listed = execFileSync('npx', ['playwright', 'test', '--list'],
        { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.match(listed, /Total: \d+ tests? in \d+ files?/,
        'the browser suite must be listable from the fresh workspace');
    }
  } finally {
    try { git(['worktree', 'remove', '--force', workspace], REPO_ROOT); } catch (_) {}
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
    try { git(['worktree', 'prune'], REPO_ROOT); } catch (_) {}
  }
});

// ── AC-3 ────────────────────────────────────────────────────────────────────

test('slice-376-ac-3 a fresh workspace is clean and the dependency directory cannot be committed', () => {
  const fx = makeCheckoutWithWorkspace();
  try {
    provisionAgainst(fx.root, fx.workspace);

    assert.equal(git(['status', '--porcelain'], fx.workspace).trim(), '',
      'a provisioned workspace must have a clean git status');

    // Ignored, per git itself — not per our reading of the pattern.
    assert.doesNotThrow(() => git(['check-ignore', '-q', 'node_modules'], fx.workspace),
      'git must report node_modules as ignored inside the workspace');

    // The gun that slice 371 was holding: stage everything, see what git took.
    git(['add', '-A'], fx.workspace);
    const staged = git(['diff', '--cached', '--name-only'], fx.workspace).split('\n').filter(Boolean);
    assert.deepEqual(staged, [], `\`git add -A\` must stage nothing in a fresh workspace; staged: ${staged.join(', ')}`);
  } finally {
    fx.cleanup();
  }
});

// ── AC-4 ────────────────────────────────────────────────────────────────────

test('slice-376-ac-4 provisioning downloads no browsers and installs nothing per slice', () => {
  const fx = makeCheckoutWithWorkspace();
  try {
    provisionAgainst(fx.root, fx.workspace);

    // Nothing was fetched or copied: the workspace's tree IS the main checkout's tree.
    assert.equal(
      fs.realpathSync(path.join(fx.workspace, 'node_modules')),
      fs.realpathSync(path.join(fx.root, 'node_modules')),
      'the workspace must share the main checkout\'s dependency tree, not get a copy of its own');
    assert.equal(fs.lstatSync(path.join(fx.workspace, 'node_modules')).isSymbolicLink(), true,
      'a real directory here means something installed per slice');
  } finally {
    fx.cleanup();
  }

  // No install command anywhere in the orchestrator's executable lines. Log messages
  // are excluded: advising a human to run `npm install` is fine — the orchestrator
  // running one per slice is what must never appear.
  const executable = CODE.filter(l => !/\blog\(\s*'(info|warn|error|debug)'/.test(l.text));
  for (const forbidden of [/npm\s+(ci|install|i)\b/, /(yarn|pnpm)\s+(install|i)\b/, /playwright\s+install\b/]) {
    const hits = executable.filter(l => forbidden.test(l.text));
    assert.deepEqual(hits.map(h => h.n), [],
      `the orchestrator must run no per-slice install; found ${forbidden} at line(s) ${hits.map(h => h.n).join(', ')}`);
  }

  // Playwright's machine-wide cache is the default one. Setting PLAYWRIGHT_BROWSERS_PATH
  // would relocate it (per-repo or per-workspace) and reintroduce the download.
  assert.deepEqual(findCode(/PLAYWRIGHT_BROWSERS_PATH/).map(l => l.n), [],
    'the orchestrator must not redirect the machine-wide Playwright browser cache');
});

// ── AC-5 ────────────────────────────────────────────────────────────────────

test('slice-376-ac-5 the reviewer\'s workspace is provisioned the same way as the implementer\'s', () => {
  // One provisioner, not two implementations that can drift apart.
  assert.equal(findCode(/^function provisionWorkspaceDeps\(/m).length, 1,
    'there must be exactly one workspace provisioner');

  // Nog's path usually REUSES Rom's worktree and never calls createWorktree, so it has
  // to provision on the path it settled on.
  const nogBlock = SRC.slice(SRC.indexOf("// Resolve worktree path for Nog's cwd."));
  assert.notEqual(nogBlock, '', "expected Nog's worktree resolution block");
  const nogProvision = nogBlock.indexOf('provisionWorkspaceDeps(nogWorktreePath, id)');
  assert.ok(nogProvision > 0 && nogProvision < 1200,
    "Nog's resolved workspace must be provisioned by the same function as Rom's");

  // Behaviourally: Rom provisions, then Nog provisions the same reused workspace. The
  // second call must be a no-op that leaves an identical, still-clean workspace.
  const fx = makeCheckoutWithWorkspace();
  try {
    assert.equal(provisionAgainst(fx.root, fx.workspace, 'rom'), true);
    const afterRom = fs.realpathSync(path.join(fx.workspace, 'node_modules'));

    assert.equal(provisionAgainst(fx.root, fx.workspace, 'nog'), true,
      'provisioning a reused workspace must succeed, not fail on the existing link');
    assert.equal(fs.realpathSync(path.join(fx.workspace, 'node_modules')), afterRom,
      'the reviewer must land on the same dependency tree the implementer used');
    assert.equal(git(['status', '--porcelain'], fx.workspace).trim(), '',
      "the reviewer's workspace must be clean too");
  } finally {
    fx.cleanup();
  }
});

// ── TRAP 1: the trailing slash is the whole hazard ──────────────────────────

test('slice-376-ac-3 TRAP the node_modules ignore has no trailing slash, so the symlink cannot be committed', () => {
  const lines = fs.readFileSync(GITIGNORE_PATH, 'utf8').split('\n').map(l => l.trim());
  assert.equal(lines.includes('node_modules/'), false,
    '.gitignore must not carry `node_modules/` — the trailing slash means "directory only" and lets the symlink through');
  assert.equal(lines.includes('node_modules'), true,
    '.gitignore must carry the slashless `node_modules`');

  // CONTROL — the same fixture, the same link, with the slash restored. This is the
  // bug the pattern change prevents; if it stops reproducing, the guard above is
  // asserting nothing.
  const bad = makeCheckoutWithWorkspace({ gitignore: 'node_modules/\n' });
  try {
    provisionAgainst(bad.root, bad.workspace);
    assert.equal(git(['status', '--porcelain'], bad.workspace).trim(), '?? node_modules',
      'with the trailing slash the link must show up as untracked — that is the hazard being guarded');
  } finally {
    bad.cleanup();
  }

  // And with the shipped pattern, the same link is invisible to git.
  const good = makeCheckoutWithWorkspace({ gitignore: 'node_modules\n' });
  try {
    provisionAgainst(good.root, good.workspace);
    assert.equal(git(['status', '--porcelain'], good.workspace).trim(), '',
      'without the trailing slash the link must be ignored');
  } finally {
    good.cleanup();
  }
});

// ── TRAP 2: verify the clean status, do not assume it ───────────────────────

test('slice-376-ac-3 TRAP a provisioned workspace is verified clean, including untracked-all', () => {
  const fx = makeCheckoutWithWorkspace();
  try {
    provisionAgainst(fx.root, fx.workspace);

    // -uall descends into untracked directories: the strictest view git offers, and
    // the one that would surface anything provisioning dropped into the workspace.
    assert.equal(git(['status', '--porcelain', '-uall'], fx.workspace).trim(), '',
      'nothing provisioning creates may be visible to git, under any --untracked-files setting');

    // The link is genuinely there — a clean status because provisioning silently did
    // nothing would pass the line above and fail the slice.
    assert.equal(fs.existsSync(path.join(fx.workspace, 'node_modules')), true,
      'the workspace must be clean AND provisioned, not clean because it is empty');
  } finally {
    fx.cleanup();
  }
});

// ── TRAP 3: the cure must be cheaper than the plumbing it replaces ──────────

test('slice-376-ac-1 TRAP provisioning costs no install — no subprocess, no network, milliseconds', () => {
  const body = provisionerBody();
  for (const forbidden of ['execSync', 'execFileSync', 'spawn', 'runGit', 'fetch(', 'https']) {
    assert.equal(body.includes(forbidden), false,
      `provisionWorkspaceDeps must not use ${forbidden} — an install per slice costs more than the plumbing it replaces`);
  }

  const fx = makeCheckoutWithWorkspace();
  try {
    const started = Date.now();
    provisionAgainst(fx.root, fx.workspace);
    const elapsed = Date.now() - started;
    // A symlink is one syscall. `npm ci` is tens of seconds; the budget is generous
    // enough for a loaded machine and still an order of magnitude below any install.
    assert.ok(elapsed < 1000, `provisioning must be effectively free; took ${elapsed}ms`);
  } finally {
    fx.cleanup();
  }
});

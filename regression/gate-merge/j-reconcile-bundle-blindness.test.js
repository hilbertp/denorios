'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BUILD-1 (ADR-AC-RECONCILE §5): the blindness fence. The reconcile bundle must contain the
// test surface and PHYSICALLY EXCLUDE the implementation — no source trees, no .git/object
// store — so reconcile cannot launder code behaviour into the spec. Structural, not "please don't look".

const REPO = path.resolve(__dirname, '..', '..');
const BUNDLE_SRC = path.resolve(REPO, 'scripts', 'make-reconcile-bundle.js');
const { makeBundle, assertBlind } = require(BUNDLE_SRC);

const withBundle = (fn) => {
  const dir = makeBundle({ ref: 'HEAD', repoRoot: REPO });
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('J-reconcile-bundle slice-99828-ac-1 — the bundle contains the test surface (regression + e2e)', () => {
  withBundle((dir) => {
    assert.ok(fs.existsSync(path.join(dir, 'regression')), 'regression/ must be in the bundle');
    assert.ok(fs.existsSync(path.join(dir, 'e2e')), 'e2e/ must be in the bundle');
  });
});

test('J-reconcile-bundle slice-99828-ac-2 — the bundle is BLIND: no source trees, no .git', () => {
  withBundle((dir) => {
    assert.deepEqual(assertBlind(dir), [], 'assertBlind found leaks');
    for (const leak of ['lib', 'bridge', 'dashboard', 'scripts', '.git']) {
      assert.equal(fs.existsSync(path.join(dir, leak)), false, `${leak} leaked into the bundle`);
    }
  });
});

test('J-reconcile-bundle slice-99828-ac-3 — git cannot resolve source from inside the bundle (no object store)', () => {
  withBundle((dir) => {
    let leaked = false;
    try { execFileSync('git', ['show', 'HEAD:lib/tests-needed.js'], { cwd: dir, stdio: 'ignore' }); leaked = true; } catch (_) {}
    assert.equal(leaked, false, 'source reachable via git from the bundle — the fence is broken');
  });
});

test('J-reconcile-bundle slice-99828-ac-4 — the manifest handed in is AC-prose-only (source pointer stripped)', () => {
  withBundle((dir) => {
    const lockPath = path.join(dir, 'regression', 'AC-MANIFEST.lock');
    if (!fs.existsSync(lockPath)) return; // no manifest at HEAD yet is acceptable
    const man = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    for (const e of Object.values(man.byTag || {})) {
      assert.equal('source' in e, false, 'the source pointer (photograph of the impl) leaked into the bundle');
    }
  });
});

test('J-reconcile-bundle slice-99828-ac-5 — the fence source on disk implements the git-archive export', () => {
  const src = fs.readFileSync(BUNDLE_SRC, 'utf8');
  assert.match(src, /git archive/);
  assert.match(src, /FORBIDDEN/);
  assert.match(src, /module\.exports[\s\S]*makeBundle/);
});

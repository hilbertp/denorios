#!/usr/bin/env node
'use strict';

// The blindness fence — BUILD-1 of ADR-AC-RECONCILE §5.
//
// Reconcile (STEP 1) must update tests FROM ACs without seeing the implementation — else
// it launders the code's behaviour into the spec. Blindness can't be "please don't look",
// and it CANNOT be `git worktree add` (a linked worktree shares the object store, so
// `git show dev:lib/anything.js` still returns the source). So we physically export only
// the test surface to a non-repo tmpdir:
//
//   git archive <ref> -- regression e2e docs/contracts | tar -x -C <tmpdir>
//
// No .git, no remotes, no object store, no lib/bridge/dashboard/scripts. Julian's
// `claude -p` runs with cwd = this export; source files are unreachable. The manifest is
// handed in AC-prose-only — its `source` pointer (the photograph of the implementation)
// is stripped before the bundle.
//
//   node scripts/make-reconcile-bundle.js [ref]   # build + assert blind (exit 1 on leak)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// The ONLY trees Julian may see: the tests he authors + the published contracts.
const SURFACE = ['regression', 'e2e', 'docs/contracts'];
// Anything here in the bundle is a leak of the implementation.
const FORBIDDEN = ['.git', 'lib', 'bridge', 'dashboard', 'scripts'];

function makeBundle({ ref = 'HEAD', repoRoot = process.cwd(), dest } = {}) {
  const out = dest || fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-bundle-'));
  const present = SURFACE.filter(p => {
    try { execFileSync('git', ['cat-file', '-e', `${ref}:${p}`], { cwd: repoRoot, stdio: 'ignore' }); return true; }
    catch (_) { return false; }
  });
  if (present.length) {
    const tar = execFileSync('git', ['archive', ref, '--', ...present], { cwd: repoRoot, maxBuffer: 128 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', out], { input: tar });
  }
  // Hand in the AC prose only — strip the `source` pointer that dereferences to Rom's work.
  try {
    const raw = execFileSync('git', ['show', `${ref}:regression/AC-MANIFEST.lock`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 }).toString();
    const man = JSON.parse(raw);
    for (const t of Object.keys(man.byTag || {})) delete man.byTag[t].source;
    fs.mkdirSync(path.join(out, 'regression'), { recursive: true });
    fs.writeFileSync(path.join(out, 'regression', 'AC-MANIFEST.lock'), JSON.stringify(man, null, 2) + '\n');
  } catch (_) {}
  return out;
}

// Leakage guard: returns the list of blindness violations (empty = blind).
function assertBlind(bundleDir) {
  const problems = [];
  for (const leak of FORBIDDEN) {
    if (fs.existsSync(path.join(bundleDir, leak))) problems.push(`${leak} reachable in bundle`);
  }
  return problems;
}

module.exports = { makeBundle, assertBlind, SURFACE, FORBIDDEN };

if (require.main === module) {
  const dir = makeBundle({ ref: process.argv[2] || 'HEAD', repoRoot: path.resolve(__dirname, '..') });
  const problems = assertBlind(dir);
  console.log(`reconcile bundle: ${dir}`);
  if (problems.length) { console.error('LEAKAGE — fence is broken: ' + problems.join('; ')); process.exit(1); }
  console.log('blind ✓  (regression + e2e + contracts only; no source, no .git, no object store)');
}

'use strict';

// J-s-numbering — retirement half of slice-350-ac-1: "the running commit counter is
// retired (commit-numbers.json is no longer read or written)". The AC's claim is about
// the product's relationship to that state file, so the guard reads each primary product
// surface and fails if any of them references commit-numbers again — then sweeps the
// remaining product dirs as belt-and-braces. The LABEL half of ac-1 (and ac-2's
// sha-alone labeling) is behavioural browser coverage in e2e/s-numbering.spec.js.
//
// Data files are excluded on purpose: a leftover bridge/state/commit-numbers.json on a
// dev machine is inert history, not a read or a write.
//
// @ac-hash: slice-350-ac-1 sha256:f1aedeee46ff306b61d631f636ff511524e8b437262aba9e8f6ea72fdf96f0d1

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
// The surfaces slice 350 rewired (static reads — these register the guard in COVERAGE.lock).
const SERVER = path.join(REPO_ROOT, 'dashboard', 'server.js');
const HTML = path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html');
const ORCH = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const REPORT = path.join(REPO_ROOT, 'scripts', 'regression-report.js');

const PRODUCT_DIRS = ['dashboard', 'bridge', 'scripts', 'lib', 'bin'];
const SOURCE_EXT = new Set(['.js', '.html', '.sh']);

function walkSources(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'trash' || e.name === 'logs') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkSources(full, out);
    else if (SOURCE_EXT.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

test('slice-350-ac-1 the running commit counter is retired — the rewired surfaces no longer reference commit-numbers.json', () => {
  assert.doesNotMatch(fs.readFileSync(SERVER, 'utf8'), /commit-numbers/,
    'dashboard/server.js no longer reads or writes commit-numbers.json');
  assert.doesNotMatch(fs.readFileSync(HTML, 'utf8'), /commit-numbers/,
    'dashboard/lcars-dashboard.html no longer references commit-numbers.json');
  assert.doesNotMatch(fs.readFileSync(ORCH, 'utf8'), /commit-numbers/,
    'bridge/orchestrator.js no longer reads or writes commit-numbers.json');
  assert.doesNotMatch(fs.readFileSync(REPORT, 'utf8'), /commit-numbers/,
    'scripts/regression-report.js no longer references commit-numbers.json');
});

test('slice-350-ac-1 no product source anywhere reads or writes commit-numbers.json (full sweep)', () => {
  const offenders = [];
  for (const dir of PRODUCT_DIRS) {
    for (const file of walkSources(path.join(REPO_ROOT, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes('commit-numbers')) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
  }
  assert.deepEqual(offenders, [],
    `commit-numbers.json is retired (slice 350); these product sources still reference it:\n  ${offenders.join('\n  ')}`);
});

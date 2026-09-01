'use strict';

// J-denorios-cli — the packaged CLI + npm test wiring (slice 351).
//
// slice-351-ac-2: "node bin/denorios.js status" reports orchestrator and dashboard state
// and exits 0 on this repo. CI-portable by the AC's own design: with no orchestrator and
// no dashboard on the runner, status still REPORTS their (down) state and still exits 0 —
// the command never fails just because the station is dark.
// slice-351-ac-3: "npm test" runs the regression suite — package.json's test script is
// the contract; it must invoke the node test runner over regression/.
//
// @ac-hash: slice-351-ac-2 sha256:50db92403312971e214b166f59683aea7d29376587cc966d1d0f2479bf98a456
// @ac-hash: slice-351-ac-3 sha256:195fc0d5f29a6050b522efc2b798f0ef437309bf1343dd6a24b50cc4864d8dbd

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('slice-351-ac-2 node bin/denorios.js status reports orchestrator and dashboard state and exits 0', () => {
  // execFileSync throws on a non-zero exit — reaching the assertions IS the exit-0 check.
  const out = execFileSync('node', [path.join('bin', 'denorios.js'), 'status'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.match(out, /orchestrator:/, 'status output reports orchestrator state');
  assert.match(out, /dashboard:/, 'status output reports dashboard state');
});

test('slice-351-ac-3 npm test runs the regression suite', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts && pkg.scripts.test;
  assert.ok(script, 'package.json has a scripts.test entry');
  assert.match(script, /node --test/, 'npm test invokes the node test runner');
  assert.match(script, /regression\//, 'npm test targets the regression suite');
});

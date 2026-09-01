'use strict';

/**
 * Journey: J-npm-pack-whitelist
 * Category: Packaging
 *
 * Asserts that `npm pack --dry-run --json` produces a manifest that contains
 * NO personal or state files. The `files` whitelist in package.json is the
 * structural control; this test is the guard.
 *
 * AC tag: slice-351-ac-1
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const BANNED_PATTERNS = [
  /bridge\/trash/,
  /\.claude\//,
  /timesheet/,
  /anchors/,
  /register\.jsonl/,
  /\.env/,
  /bridge\/state\//,
];

test('slice-351-ac-1 npm pack dry-run manifest contains no state or personal files', () => {
  let raw;
  try {
    raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, npm_config_loglevel: 'silent' },
    });
  } catch (err) {
    assert.fail(`npm pack --dry-run failed: ${err.message}`);
  }

  let packResult;
  try {
    packResult = JSON.parse(raw);
  } catch {
    assert.fail(`npm pack --dry-run --json output was not valid JSON`);
  }

  const entry = Array.isArray(packResult) ? packResult[0] : packResult;
  const files = (entry && entry.files) ? entry.files.map(f => f.path || f) : [];

  assert.ok(files.length > 0, 'npm pack produced an empty file list — whitelist may be wrong');

  const violations = [];
  for (const filePath of files) {
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(filePath)) {
        violations.push({ file: filePath, pattern: pattern.toString() });
      }
    }
  }

  assert.deepStrictEqual(
    violations,
    [],
    `Banned files in pack manifest:\n${violations.map(v => `  ${v.file}  (matched ${v.pattern})`).join('\n')}`
  );
});

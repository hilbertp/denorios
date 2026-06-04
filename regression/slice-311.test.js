'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_JSON_PATH = path.resolve(__dirname, '..', 'package.json');

test('slice-311-ac-1 root package.json parses as valid JSON with a non-empty name field', () => {
  const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    assert.fail(`package.json is not valid JSON: ${err.message}`);
  }

  assert.strictEqual(typeof parsed.name, 'string', 'package.json top-level name field must be a string');
  assert.ok(parsed.name.trim().length > 0, 'package.json top-level name field must be non-empty');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// PRE-2 (ADR-AC-RECONCILE): the structured `## Acceptance criteria` block — one
// explicitly-tagged `- slice-<id>-ac-<k>: <text>` line per AC — and its commission-time
// validator. Tags are the literal join key the AC manifest derives from.

const AC_BLOCK_SRC = path.resolve(__dirname, '..', '..', 'lib', 'ac-block.js');
const { parseAcBlock, validateAcBlock } = require(AC_BLOCK_SRC);

const slice = (id, acBody) => `---\nid: "${id}"\ntitle: "t"\n---\n\n## Goal\n\ng\n\n## Acceptance criteria\n\n${acBody}\n`;

test('J-ac-block slice-99824-ac-1 — a well-formed tagged block parses every AC and validates clean', () => {
  const content = slice('050', '- slice-050-ac-1: returns 200 with the body\n- slice-050-ac-2: unknown id returns 404');
  const r = validateAcBlock(content, '050');
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.acs.map(a => a.tag), ['slice-050-ac-1', 'slice-050-ac-2']);
  assert.equal(r.acs[0].text, 'returns 200 with the body');
});

test('J-ac-block slice-99824-ac-2 — a duplicate AC tag is a hard error', () => {
  const content = slice('050', '- slice-050-ac-1: first\n- slice-050-ac-1: dupe');
  const r = validateAcBlock(content, '050');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /duplicate AC tag slice-050-ac-1/.test(e)));
});

test('J-ac-block slice-99824-ac-3 — an AC tag whose id does not match the slice is an error (padding-tolerant)', () => {
  const content = slice('050', '- slice-051-ac-1: wrong slice');
  const r = validateAcBlock(content, '050');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /does not match this slice/.test(e)));
  // padding tolerance: slice-50 matches id 050
  assert.equal(validateAcBlock(slice('050', '- slice-50-ac-1: ok'), '050').ok, true);
});

test('J-ac-block slice-99824-ac-4 — a slice with no Acceptance criteria section does not validate', () => {
  const content = '---\nid: "050"\n---\n\n## Goal\n\ng\n';
  const r = validateAcBlock(content, '050');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /no "## Acceptance criteria" section/.test(e)));
});

test('J-ac-block slice-99824-ac-5 — an unfilled stub (comment only) is advisory: a warning, never an error', () => {
  const content = slice('050', '<!-- O\'Brien: one tagged line per AC: - slice-050-ac-1: <text> -->');
  const r = validateAcBlock(content, '050');
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some(w => /unfilled stub/.test(w)));
});

test('J-ac-block slice-99824-ac-6 — non-contiguous AC indices are allowed (warning, still ok)', () => {
  const content = slice('050', '- slice-050-ac-1: a\n- slice-050-ac-2: b\n- slice-050-ac-7: g');
  const r = validateAcBlock(content, '050');
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.ok(r.warnings.some(w => /non-contiguous/.test(w)));
});

test('J-ac-block slice-99824-ac-7 — a malformed bullet that is not a valid tagged line is an error', () => {
  const content = slice('050', '- the endpoint returns 200');
  const r = validateAcBlock(content, '050');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /unparseable AC line/.test(e)));
});

test('J-ac-block slice-99824-ac-8 — the validator module on disk exports the parse + validate contract', () => {
  // readFileSync establishes the COVERAGE.lock guard on lib/ac-block.js (the gate's
  // file-grained corroboration model) and pins the public contract.
  const src = fs.readFileSync(AC_BLOCK_SRC, 'utf8');
  assert.match(src, /module\.exports\s*=\s*{[^}]*validateAcBlock/);
  assert.match(src, /AC_LINE_RE\s*=\s*\//);
  assert.equal(typeof parseAcBlock, 'function');
  assert.equal(typeof validateAcBlock, 'function');
});

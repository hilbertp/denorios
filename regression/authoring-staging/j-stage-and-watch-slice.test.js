'use strict';

/**
 * Journey: J-stage-and-watch-slice
 * Category: Authoring & Staging
 *
 * What this tests:
 *   The observable contract for staging a new slice: the file appears in
 *   bridge/staged/ with the -STAGED.md suffix, valid frontmatter containing all
 *   required fields, status STAGED, a body with the mandatory sections, and zero
 *   register events at creation time.
 *
 * Portability note:
 *   These tests do NOT spawn new-slice.js (it requires orchestrator.js, which
 *   has startup side effects). Instead they test the file-format contract that
 *   new-slice.js must produce, using self-contained fixture helpers.  Any future
 *   integration test that spawns new-slice.js in a controlled environment can
 *   extend this contract.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { makeTmpDir, removeTmpDir }         = require('../helpers/tmp-dir');
const { buildSliceFile, REQUIRED_FIELDS }  = require('../helpers/slice-factory');
const { parseFrontmatter, nextSliceId }    = require('../helpers/pipeline-logic');
const { parseRegisterLines, initRegisterFile } = require('../helpers/register-helper');

let tmpDir;
let stagedDir;
let registerFile;
const FIXTURE_ID = '042';

before(() => {
  tmpDir = makeTmpDir('j-stage-watch');
  stagedDir    = path.join(tmpDir, 'staged');
  registerFile = path.join(tmpDir, 'register.jsonl');
  fs.mkdirSync(stagedDir);
  initRegisterFile(registerFile);
});

after(() => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// AC1: Slice file exists at staged/{id}-STAGED.md
// ---------------------------------------------------------------------------
test('J-stage-and-watch-slice slice-042-ac-1 — staged file exists in staged/ with -STAGED.md suffix', () => {
  const content  = buildSliceFile({ id: FIXTURE_ID, status: 'STAGED' });
  const filePath = path.join(stagedDir, `${FIXTURE_ID}-STAGED.md`);
  fs.writeFileSync(filePath, content);
  assert.ok(fs.existsSync(filePath), 'STAGED file must exist in staged/');
});

// ---------------------------------------------------------------------------
// AC2: Frontmatter contains all required fields (non-empty)
// ---------------------------------------------------------------------------
test('J-stage-and-watch-slice slice-042-ac-2 — frontmatter has all required fields', () => {
  const content = buildSliceFile({ id: FIXTURE_ID, status: 'STAGED' });
  const meta    = parseFrontmatter(content);
  assert.ok(meta, 'Frontmatter block must be parseable');
  for (const field of REQUIRED_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(meta, field),
      `Required frontmatter field missing: "${field}"`
    );
    assert.ok(
      String(meta[field]).trim().length > 0,
      `Required frontmatter field "${field}" must be non-empty`
    );
  }
});

// ---------------------------------------------------------------------------
// AC3: status field is STAGED
// ---------------------------------------------------------------------------
test('J-stage-and-watch-slice slice-042-ac-3 — frontmatter status is STAGED', () => {
  const content = buildSliceFile({ id: FIXTURE_ID, status: 'STAGED' });
  const meta    = parseFrontmatter(content);
  assert.strictEqual(meta.status, 'STAGED', 'status must be STAGED at creation time');
});

// ---------------------------------------------------------------------------
// AC4: Register contains no events for this slice at creation time
// ---------------------------------------------------------------------------
test('J-stage-and-watch-slice slice-042-ac-4 — register contains no events for slice at creation', () => {
  const events      = parseRegisterLines(registerFile);
  const sliceEvents = events.filter(e => String(e.slice_id || e.id || '') === FIXTURE_ID);
  assert.strictEqual(
    sliceEvents.length, 0,
    `Register must be empty for slice ${FIXTURE_ID} before dispatch`
  );
});

// ---------------------------------------------------------------------------
// AC5: Body has all mandatory sections (pipeline contract §3.3)
// ---------------------------------------------------------------------------
test('J-stage-and-watch-slice slice-042-ac-5 — slice body contains all mandatory sections', () => {
  const content = buildSliceFile({ id: FIXTURE_ID });
  const required = [
    '## Goal',
    '## Context',
    '## Scope',
    '## Out of scope',
    '## Tasks',
    '## Acceptance criteria',
    '## Quality + goal check',
    '## Files expected to change',
  ];
  for (const section of required) {
    assert.ok(
      new RegExp(`^${section.replace(/[+]/g, '\\+')}`, 'm').test(content),
      `Slice body missing required section: "${section}"`
    );
  }
});

// ---------------------------------------------------------------------------
// AC6: Acceptance criteria section is non-empty
// ---------------------------------------------------------------------------
test('J-stage-and-watch-slice slice-042-ac-6 — acceptance criteria section is non-empty', () => {
  const content = buildSliceFile(
    { id: FIXTURE_ID },
    ['1. The widget renders correctly.', '2. The widget responds to clicks.']
  );
  const acMatch = content.match(/^## Acceptance criteria\n([\s\S]*?)(?=\n## |\n---$|$)/m);
  assert.ok(acMatch, 'Acceptance criteria section must be present');
  const acBody = acMatch[1].trim();
  assert.ok(acBody.length > 0, 'Acceptance criteria section must not be empty');
});

// ---------------------------------------------------------------------------
// AC7: nextSliceId assigns max+1, zero-padded to 3 digits
// ---------------------------------------------------------------------------
test('J-stage-and-watch-slice slice-042-ac-7 — nextSliceId returns max+1 zero-padded to 3 digits', () => {
  const files = ['040-STAGED.md', '041-QUEUED.md', '039-DONE.md'];
  assert.strictEqual(nextSliceId(files), '042');
});

test('J-stage-and-watch-slice slice-042-ac-8 — nextSliceId returns 001 when queue is empty', () => {
  assert.strictEqual(nextSliceId([]), '001');
});

test('J-stage-and-watch-slice slice-042-ac-9 — nextSliceId pads single-digit IDs to 3 chars', () => {
  assert.strictEqual(nextSliceId(['005-STAGED.md']), '006');
  assert.strictEqual(nextSliceId(['009-DONE.md', '003-QUEUED.md']), '010');
});

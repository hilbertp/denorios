'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guards the CHECK-gate authoring wiring (dashboard/server.js): one CHECK press drains the
// flagged ACs AND kicks Julian off to author each guarding test. authoringStateFor() reports
// what he produced; kickOffAuthoring() must NOT re-spawn an agent for a tag already drafted /
// in-flight (a double-spawn would burn opus runs and race on the same draft).

const { authoringStateFor, kickOffAuthoring } = require('../../dashboard/server');
const DRAFTS = path.resolve(__dirname, '..', '.drafts');
const mk = (name, body) => { fs.mkdirSync(DRAFTS, { recursive: true }); fs.writeFileSync(path.join(DRAFTS, name), body || 'x'); };
const rm = (name) => { try { fs.unlinkSync(path.join(DRAFTS, name)); } catch (_) {} };

test('J-check-authoring slice-349-ac-1 — a present draft reads as "drafted" with its filename', () => {
  mk('slice-99988-ac-1.draft.test.js');
  const s = authoringStateFor('slice-99988-ac-1');
  assert.equal(s.state, 'drafted');
  assert.equal(s.draft, 'slice-99988-ac-1.draft.test.js');
  rm('slice-99988-ac-1.draft.test.js');
});

test('J-check-authoring slice-349-ac-2 — a QUESTION file reads as "question" and carries the text', () => {
  mk('slice-99988-ac-2.QUESTION.md', 'which journey?');
  const s = authoringStateFor('slice-99988-ac-2');
  assert.equal(s.state, 'question');
  assert.match(s.question, /which journey/);
  rm('slice-99988-ac-2.QUESTION.md');
});

test('J-check-authoring slice-349-ac-3 — no artifacts reads as "pending"', () => {
  assert.equal(authoringStateFor('slice-99988-ac-9').state, 'pending');
});

test('J-check-authoring slice-349-ac-4 — kickOffAuthoring does NOT re-spawn for an already-drafted tag', () => {
  mk('slice-99988-ac-3.draft.test.js');
  assert.deepEqual(kickOffAuthoring(['slice-99988-ac-3']), [], 'a drafted tag must be skipped (no double-spawn)');
  rm('slice-99988-ac-3.draft.test.js');
});

test('J-check-authoring slice-349-ac-5 — kickOffAuthoring ignores malformed tags (never spawns junk)', () => {
  assert.deepEqual(kickOffAuthoring(['not-a-tag', '']), []);
});

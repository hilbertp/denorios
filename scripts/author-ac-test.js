#!/usr/bin/env node
'use strict';

// author-ac-test.js — Julian's (Bashir's) USER-GUIDED test authoring.
//
// This is the auto-WRITE half of the test-update gate: given an acceptance criterion that
// the CHECK gate flagged (new + uncovered, or changed + conflicting with an existing test),
// spawn a Bashir agent (claude -p) to AUTHOR or UPDATE the test that guards it — writing a
// DRAFT for human review, never straight into the live suite.
//
// User-guided by design: the agent is instructed that when the right user JOURNEY (what to
// assert / which path to cover) is genuinely ambiguous, it must NOT guess — it writes a
// short, specific QUESTION for the operator and stops. The operator answers, then re-runs
// with --journey "<answer>" to produce the test. This keeps the human on exactly the
// high-judgment decision and the agent on the mechanical authoring — which is the safe
// division (an agent silently rewriting assertions to "match" an AC could mask a real
// regression; a human-confirmed journey can't).
//
// Usage:
//   node scripts/author-ac-test.js <slice-N-ac-K> [--text "<AC text>"] [--journey "<operator answer>"]
//
// Output (in regression/.drafts/):
//   <tag>.draft.<ext>     — the proposed test (review, then move into the suite to apply)
//   <tag>.rationale.txt   — one-line why
//   <tag>.QUESTION.md     — present ONLY when the agent needs a journey decision from you

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DRAFT_DIR = path.join(REPO, 'regression', '.drafts');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const tag = process.argv[2];
if (!tag || !/^slice-\d+-ac-\d+$/.test(tag)) {
  console.error('usage: node scripts/author-ac-test.js <slice-N-ac-K> [--text "<AC text>"] [--journey "<answer>"]');
  process.exit(2);
}
const journey = arg('--journey');
let acText = arg('--text') || resolveAcText(tag);

// Resolve the AC text from the pending range's `AC:` trailers, then the static manifest.
function resolveAcText(t) {
  try {
    const log = execFileSync('git', ['log', 'origin/main..origin/dev', '--format=%B'],
      { cwd: REPO, encoding: 'utf8' });
    const m = log.match(new RegExp('^AC:\\s*' + t.replace(/[-]/g, '\\-') + ':\\s*(.+?)\\s*$', 'im'));
    if (m) return m[1].trim();
  } catch (_) {}
  try {
    const man = JSON.parse(fs.readFileSync(path.join(REPO, 'regression', 'AC-MANIFEST.lock'), 'utf8'));
    if (man.byTag && man.byTag[t] && man.byTag[t].text) return man.byTag[t].text;
  } catch (_) {}
  return '';
}

fs.mkdirSync(DRAFT_DIR, { recursive: true });
// Clear any stale artifacts for this tag so the result is unambiguous.
for (const suffix of ['.QUESTION.md', '.rationale.txt']) {
  try { fs.unlinkSync(path.join(DRAFT_DIR, tag + suffix)); } catch (_) {}
}

const journeyClause = journey
  ? `The operator has ALREADY answered the journey question for this AC:\n"""\n${journey}\n"""\nAuthor the test to match that answer — do not ask again.`
  : `DECIDE AUTONOMOUSLY. Test-design calls — pin an exact value vs assert a property, how strict to be, which of several equivalent paths to cover — are YOURS as the QA engineer; do NOT bounce them to the operator. Make the call that best surfaces faults, write one line of WHAT you decided and WHY into the rationale, and proceed. Escalate (write ${DRAFT_DIR}/${tag}.QUESTION.md and STOP) ONLY for a genuine PRODUCT-level ambiguity unresolvable from the AC text + the codebase — e.g. the AC contradicts itself, or the correct behaviour depends on intent only the product owner holds. Default strongly to deciding.`;

const prompt = `You are Julian (Bashir), the QA engineer for this repo. Your mission is ADVERSARIAL: surface as many wrong/faulty things as fast as possible — you write tests to BREAK the feature, never to rubber-stamp it. You did NOT build this code; your incentive is to catch its faults, which is exactly why it is safe for you (not the implementer) to author the guard. The test-update gate flagged an acceptance criterion that needs coverage. Author (or update) the test that GUARDS it.

AC ${tag}: ${acText || '(text not found in trailers/manifest — infer the intent from the codebase and the tag)'}

Steps:
1. Explore the repo. Find the feature/behaviour this AC describes (dashboard/, lib/, scripts/, server) and any EXISTING tests (regression/**/*.test.js node:test, e2e/*.spec.js Playwright) that touch it. Match the house style and the j-<name> ${tag} naming.
2. If an existing test CONFLICTS with this AC (a wanted change), UPDATE it to match — preserving its real intent, never weakening it to a no-op just to pass.
3. If nothing covers this AC, WRITE a new test. node:test for source/logic assertions; Playwright (e2e/) for browser journeys.
4. ${journeyClause}
5. Otherwise write your proposed test to ${DRAFT_DIR}/${tag}.draft.<ext> (the correct extension for the kind of test) and a one-line rationale to ${DRAFT_DIR}/${tag}.rationale.txt.

HARD RULES: this is a DRAFT for human review — do NOT modify, add, or delete anything in the live regression/ or e2e/ suites, or anywhere outside ${DRAFT_DIR}. The draft must be runnable and must genuinely fail if the AC is violated.`;

const args = ['-p', '--permission-mode', 'bypassPermissions',
  '--model', 'claude-opus-4-8', '--effort', 'high', prompt];

console.log(`[author-ac-test] ${tag}: spawning Julian (opus-4.8/high)…`);
console.log(`[author-ac-test] AC text: ${acText || '(not resolved — agent will infer)'}`);
const res = spawnSync('claude', args, { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
if (res.status !== 0) {
  console.error(`[author-ac-test] agent run failed (exit ${res.status}).`);
  process.exit(1);
}

// Report what the agent produced.
const q = path.join(DRAFT_DIR, `${tag}.QUESTION.md`);
const draft = fs.readdirSync(DRAFT_DIR).find(f => f.startsWith(`${tag}.draft.`));
console.log('\n──────────────────────────────────────────────');
if (fs.existsSync(q)) {
  console.log(`[author-ac-test] ${tag}: Julian NEEDS A JOURNEY DECISION from you:\n`);
  console.log(fs.readFileSync(q, 'utf8'));
  console.log(`\nAnswer it, then re-run: node scripts/author-ac-test.js ${tag} --journey "<your answer>"`);
} else if (draft) {
  console.log(`[author-ac-test] ${tag}: DRAFT test proposed → regression/.drafts/${draft}`);
  try { console.log(`rationale: ${fs.readFileSync(path.join(DRAFT_DIR, `${tag}.rationale.txt`), 'utf8').trim()}`); } catch (_) {}
  console.log(`Review it, then move it into the live suite to apply.`);
} else {
  console.log(`[author-ac-test] ${tag}: agent finished but produced no draft or question — inspect ${DRAFT_DIR}.`);
}

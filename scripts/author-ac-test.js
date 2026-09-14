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
// APPLICABLE BY CONSTRUCTION (slice 357): a draft is only written when it carries what the
// coverage deriver needs to COUNT it — the `@ac-hash` annotation with the spec's own hash,
// the tag in a test() title, a runnable extension, and a companion declaring where it lands.
// Without those a draft can be applied, run, pass, and register NO coverage: the AC stays
// flagged and the only control left is "No test needed for this AC" — a well-meant apply
// that silently weakens the suite. The contract lives in lib/draft-contract.js; here it is
// (a) instructed to the agent with the exact hash precomputed, and (b) VERIFIED afterwards.
// A draft that fails verification is not left behind as a draft.
//
// Usage:
//   node scripts/author-ac-test.js <slice-N-ac-K> [--text "<AC text>"] [--journey "<operator answer>"]
//
// Output (in regression/.drafts/):
//   <tag>.draft.test.js   — proposed node:test guard (lands under regression/<area>/)
//   <tag>.draft.spec.js   — proposed Playwright guard (lands under e2e/)
//   <tag>.target.json     — {"new": "<path>"} or {"replaces": "<path>"} — where it lands
//   <tag>.rationale.txt   — one-line why
//   <tag>.QUESTION.md     — present ONLY when the agent needs a journey decision from you
//   <tag>.REJECTED.md     — present when the agent's draft broke the contract (with reasons)

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DRAFT_DIR = path.join(REPO, 'regression', '.drafts');
const { acHashOf } = require('./build-ac-manifest');
const {
  annotationFor, targetName, validateDraft, manifestAcHash, formatViolations,
} = require('../lib/draft-contract');
// The model + effort come from bridge/bridge.config.json — the one place this system's
// model is set (the orchestrator spawns Rom from the same claudeArgs), so a fleet-wide bump
// reaches Julian's authoring runs too. Hardcoding it here is how this script stayed pinned
// to claude-opus-4-8/high long after the fleet had moved on.
const { agentModel } = require('../lib/agent-model');

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

// The SPEC hash this guard must claim. The manifest's acHash is canonical when it has one;
// otherwise it is derived from the AC prose exactly as build-ac-manifest.js derives it, so
// the annotation matches the moment the AC lands in the lock. No hash → no appliable draft.
function expectedAcHash() {
  if (acText) return acHashOf(acText);
  return manifestAcHash(REPO, tag);
}

const expectedHash = expectedAcHash();
if (!expectedHash) {
  console.error(`[author-ac-test] ${tag}: cannot resolve the AC text or its hash — no \`AC: ${tag}: …\` trailer in origin/main..origin/dev and no hashed entry in regression/AC-MANIFEST.lock.`);
  console.error('Without the spec hash the draft could not carry a coverage annotation that ever matches, so it would register no coverage. Re-run with --text "<the AC text>".');
  process.exit(2);
}

const { model, effort, source: modelSource } = agentModel(REPO);
if (!model || !effort) {
  console.error(`[author-ac-test] no --model/--effort from ${modelSource} — refusing to spawn at an unknown model.`);
  process.exit(2);
}

fs.mkdirSync(DRAFT_DIR, { recursive: true });
// Clear this tag's artifacts so the run's outcome is entirely this run's — a draft left
// from an earlier run paired with a target file from this one is exactly the mismatch the
// contract exists to prevent. TAG-SCOPED on purpose: every other file in this directory
// belongs to another AC (some predating this contract) and is not this run's to touch.
clearArtifacts();
function clearArtifacts() {
  let files = [];
  try { files = fs.readdirSync(DRAFT_DIR); } catch (_) { return; }
  for (const f of files) {
    if (f.startsWith(`${tag}.draft.`) ||
        ['.QUESTION.md', '.rationale.txt', '.REJECTED.md', '.target.json'].some(sfx => f === tag + sfx)) {
      try { fs.unlinkSync(path.join(DRAFT_DIR, f)); } catch (_) {}
    }
  }
}

const journeyClause = journey
  ? `The operator has ALREADY answered the journey question for this AC:\n"""\n${journey}\n"""\nAuthor the test to match that answer — do not ask again.`
  : `DECIDE AUTONOMOUSLY. Test-design calls — pin an exact value vs assert a property, how strict to be, which of several equivalent paths to cover — are YOURS as the QA engineer; do NOT bounce them to the operator. Make the call that best surfaces faults, write one line of WHAT you decided and WHY into the rationale, and proceed. Escalate (write ${DRAFT_DIR}/${tag}.QUESTION.md and STOP) ONLY for a genuine PRODUCT-level ambiguity unresolvable from the AC text and the existing suites — e.g. the AC contradicts itself, or the correct behaviour depends on intent only the product owner holds. Default strongly to deciding.`;

const ANNOTATION = annotationFor(tag, expectedHash);

const prompt = `You are Julian (Bashir), the QA engineer for this repo. Your mission is ADVERSARIAL: surface as many wrong/faulty things as fast as possible — you write tests to BREAK the feature, never to rubber-stamp it. You did NOT build this code; your incentive is to catch its faults, which is exactly why it is safe for you (not the implementer) to author the guard. The test-update gate flagged an acceptance criterion that needs coverage. Author (or update) the test that GUARDS it.

AC ${tag}: ${acText || '(text not found in trailers/manifest — infer the intent from the tag and the existing suites; do not go looking in the product)'}

Steps:
1. You are INFORMATION-ONLY. Do not explore the product: not dashboard/, not lib/, not scripts/, not the server, not the diff. The AC text above plus the stage's packet is what you get, and that independence is exactly why your guard is worth having — a test written from the code under test can only ever agree with it. What you DO read is the test suites, which are your own files: the EXISTING tests (regression/**/*.test.js node:test, e2e/*.spec.js Playwright) and the fixtures beside them, so you match the house style and the j-<name> ${tag} naming and find anything that already touches this AC.
2. If an existing test CONFLICTS with this AC (a wanted change), UPDATE it to match — preserving its real intent, never weakening it to a no-op just to pass.
3. If nothing covers this AC, WRITE a new test. node:test for source/logic assertions; Playwright (e2e/) for browser journeys.
4. ${journeyClause}
5. Otherwise write your proposed test to ${DRAFT_DIR}/${tag}.draft.<ext> and a one-line rationale to ${DRAFT_DIR}/${tag}.rationale.txt.

THE DRAFT CONTRACT — a draft that breaks any of these is REJECTED and thrown away, because the coverage deriver would not count it: applied, it would run, pass, and leave ${tag} still flagged.

A. ANNOTATION. The draft MUST contain this line, verbatim, near the top (copy it exactly — do not recompute the hash, do not shorten it):
${ANNOTATION}
B. TAGGED TITLE. At least one test() title must contain the literal ${tag} (e.g. test('J-<name> ${tag} — …', …)). The deriver only registers the annotation alongside a tagged title; an annotation on its own registers nothing.
C. EXTENSION. Exactly one of:
   ${DRAFT_DIR}/${tag}.draft.test.js   → a node:test guard, landing under regression/<area>/
   ${DRAFT_DIR}/${tag}.draft.spec.js   → a Playwright guard, landing under e2e/
   No other extension exists. A bare .js draft is picked up by neither \`node --test 'regression/**/*.test.js'\` nor the coverage walker — it would be invisible to both, forever.
D. DECLARED TARGET. Also write ${DRAFT_DIR}/${targetName(tag)} — a JSON object with EXACTLY ONE of:
   {"tag": "${tag}", "new": "regression/<area>/j-<name>.test.js"}        — a brand-new guard at a path that does NOT yet exist
   {"tag": "${tag}", "replaces": "e2e/<existing>.spec.js"}               — you rewrote an EXISTING guard; applying overwrites that file
   If step 2 applied (you updated an existing test), it is ALWAYS "replaces" naming that exact file. Getting this wrong means both copies land and both register, inflating the guard count and forcing a Coverage-Removed: trailer later just to delete the duplicate. The path's extension and directory must match the draft's (.test.js → regression/, .spec.js → e2e/).

HARD RULES: this is a DRAFT for human review — do NOT modify, add, or delete anything in the live regression/ or e2e/ suites, or anywhere outside ${DRAFT_DIR}. Do NOT read a product source file or a diff to work out what the AC means: a criterion you cannot judge from the AC text and the suites is an unclear criterion, which you escalate. The draft must be runnable and must genuinely fail if the AC is violated.`;

const args = ['-p', '--permission-mode', 'bypassPermissions',
  '--model', model, '--effort', effort, prompt];

console.log(`[author-ac-test] ${tag}: spawning Julian (${model}/${effort}, from ${modelSource})…`);
console.log(`[author-ac-test] AC text: ${acText || '(not resolved — agent will infer)'}`);
console.log(`[author-ac-test] required annotation: ${ANNOTATION}`);
const res = spawnSync('claude', args, { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
if (res.status !== 0) {
  console.error(`[author-ac-test] agent run failed (exit ${res.status}).`);
  process.exit(1);
}

// ── Verify what came back, and refuse to leave an unappliable draft behind ────────────
// Only files named for THIS tag are ever touched: the directory also holds other ACs'
// drafts, some predating this contract, and they are not this run's to judge or delete.
function draftsForTag() {
  try { return fs.readdirSync(DRAFT_DIR).filter(f => f.startsWith(`${tag}.draft.`)).sort(); }
  catch (_) { return []; }
}

function readTarget() {
  try { return JSON.parse(fs.readFileSync(path.join(DRAFT_DIR, targetName(tag)), 'utf8')); }
  catch (_) { return null; }
}

// Move the offending drafts aside into <tag>.REJECTED.md (reasons + the rejected source, so
// nothing the agent did is lost) and remove them, so no unappliable draft can be applied.
function reject(violations) {
  const body = [
    `# ${tag} — draft REJECTED`, '',
    `The authored draft does not satisfy the draft contract (lib/draft-contract.js), so it`,
    `would register no coverage if applied. It has been removed; the source is preserved below.`, '',
    '## Why', '', '```', formatViolations(violations), '```', '',
  ];
  for (const v of violations) {
    const p = path.join(DRAFT_DIR, v.file);
    let src = '';
    try { src = fs.readFileSync(p, 'utf8'); } catch (_) {}
    body.push(`## ${v.file}`, '', '```js', src, '```', '');
    try { fs.unlinkSync(p); } catch (_) {}
  }
  fs.writeFileSync(path.join(DRAFT_DIR, `${tag}.REJECTED.md`), body.join('\n'));
  try { fs.unlinkSync(path.join(DRAFT_DIR, `${tag}.running`)); } catch (_) {}
  console.error(`\n[author-ac-test] ${tag}: DRAFT REJECTED — it would register no coverage.\n`);
  console.error(formatViolations(violations));
  console.error(`\nReasons + the rejected source: regression/.drafts/${tag}.REJECTED.md`);
  console.error(`Re-run to try again: node scripts/author-ac-test.js ${tag}`);
}

const q = path.join(DRAFT_DIR, `${tag}.QUESTION.md`);
const drafts = draftsForTag();
console.log('\n──────────────────────────────────────────────');
if (fs.existsSync(q) && !drafts.length) {
  console.log(`[author-ac-test] ${tag}: Julian NEEDS A JOURNEY DECISION from you:\n`);
  console.log(fs.readFileSync(q, 'utf8'));
  console.log(`\nAnswer it, then re-run: node scripts/author-ac-test.js ${tag} --journey "<your answer>"`);
} else if (drafts.length) {
  const target = readTarget();
  const violations = [];
  for (const file of drafts) {
    let source = '';
    try { source = fs.readFileSync(path.join(DRAFT_DIR, file), 'utf8'); } catch (_) {}
    const { errors } = validateDraft({
      filename: file, source, target, repoRoot: REPO, expectedAcHash: expectedHash,
    });
    if (errors.length) violations.push({ file, errors });
  }
  if (violations.length) {
    reject(violations);
    process.exit(1);
  }
  const landing = target.new ? `new file ${target.new}` : `REPLACING ${target.replaces}`;
  console.log(`[author-ac-test] ${tag}: DRAFT test proposed → regression/.drafts/${drafts[0]}`);
  console.log(`[author-ac-test] target: ${landing}`);
  try { console.log(`rationale: ${fs.readFileSync(path.join(DRAFT_DIR, `${tag}.rationale.txt`), 'utf8').trim()}`); } catch (_) {}
  console.log(`Review it, then move it into the live suite to apply.`);
} else {
  console.log(`[author-ac-test] ${tag}: agent finished but produced no draft or question — inspect ${DRAFT_DIR}.`);
}

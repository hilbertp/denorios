'use strict';

// J-reviewer-runs-nothing — the reviewer's prompt tells Jordan the suites are not
// his, and shows him the verdict file instead of describing it (slice 399,
// ADR-PROOF-LANES Rule 1).
//
// Jordan's review got no faster when the proof lanes landed: 7.0 minutes median
// before, 8.1 after. He ran the full safety-net suite in 15 of 23 reviews, because
// Part 1 asked him to confirm "no regressions" himself and nothing in the prompt
// forbade `npm test`. Separately his verdict file was described in prose only, and
// three times in two days he wrote it without the closing fence, which the daemon
// cannot read — one ACCEPTED verdict cost a whole round that way (388).
//
// The rule has to hold on BOTH lanes. Surface is the cheap lane, and it is exactly
// the one where a full suite run eats the entire saving; core is the lane where the
// temptation to "just check" is strongest. A guard that only pinned one of them
// would let the other drift straight back.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildNogPrompt } = require('../../bridge/nog-prompt.js');

// No `---` anywhere in the fixtures: the verdict-shape check below looks for a
// fence in the prompt, and a fence smuggled in through the slice file or the DONE
// report would pass that check without the prompt teaching Jordan anything.
const PROMPT_ARGS = {
  id: '399',
  round: 1,
  sliceFileContents: 'slice contents',
  doneReportContents: 'done report contents',
  gitDiff: 'diff --git a/bridge/nog-prompt.js b/bridge/nog-prompt.js',
  scopeDiff: 'Changed files: bridge/nog-prompt.js',
  slicePath: '/tmp/399-IN_PROGRESS.md',
};

// Lane unset is included because the orchestrator treats it as core, and a prompt
// built without a lane is what the whole staged backlog gets.
const LANES = [
  ['surface', buildNogPrompt({ ...PROMPT_ARGS, lane: 'surface' })],
  ['core', buildNogPrompt({ ...PROMPT_ARGS, lane: 'core' })],
  ['lane unset', buildNogPrompt({ ...PROMPT_ARGS })],
];

// ---------------------------------------------------------------------------
// slice-399-ac-1 — the reviewer is told not to run the suites
// ---------------------------------------------------------------------------
// @ac-hash: slice-399-ac-1 sha256:7628965f66c659e9f03fe9a50bf96950328ea7f16ea2111dd491021217bd2b28

test('slice-399-ac-1 both lanes forbid the full safety-net suite and the browser suite by name, and allow only the slice\'s own test files', () => {
  for (const [lane, prompt] of LANES) {
    assert.match(prompt, /Do not run the full safety-net suite/,
      `${lane}: the prohibition must be stated, not implied`);
    assert.ok(prompt.includes('`npm test`'),
      `${lane}: the safety-net suite must be named by the command Jordan would actually type`);
    assert.ok(prompt.includes('`npx playwright test`'),
      `${lane}: the browser suite must be named by the command Jordan would actually type`);
    assert.match(prompt, /You may run the test files this slice adds or changes/,
      `${lane}: told only what he may not run, Jordan runs nothing and stops checking the tests at all`);
  }
});

// ---------------------------------------------------------------------------
// slice-399-ac-2 — regressions are the machines' job, not the reviewer's
// ---------------------------------------------------------------------------
// @ac-hash: slice-399-ac-2 sha256:d045735e98e402d25512f2ab735fb7e71fb2fa5d0c2ee70ba5db862a28551839

test('slice-399-ac-2 no lane asks Jordan to confirm "no regressions"; every lane names the three machines that do', () => {
  for (const [lane, prompt] of LANES) {
    assert.ok(!prompt.includes('no regressions'),
      `${lane}: asking the reviewer to confirm "no regressions" is the sentence that sends him to npm test`);
    assert.match(prompt, /Regressions are caught by machines, not by you/,
      `${lane}: the reason must be given, or the prohibition reads as carelessness`);
    assert.match(prompt, /GitHub runs the safety-net suite when the slice lands on dev/, `${lane}: GitHub`);
    assert.match(prompt, /Julian's stage runs both suites/, `${lane}: Julian's stage`);
    assert.match(prompt, /the Promote button runs them again/, `${lane}: the Promote button`);
  }
});

// ---------------------------------------------------------------------------
// slice-399-ac-3 — the verdict file is shown, not described
// ---------------------------------------------------------------------------
// @ac-hash: slice-399-ac-3 sha256:40f2dd3ec915ce9caea7fb3a6c7b7c66ca417133b51730e6b87d81f3f9793895

test('slice-399-ac-3 every lane carries a complete example verdict file: a line that is exactly --- , a verdict, a summary, and a closing line that is exactly ---', () => {
  for (const [lane, prompt] of LANES) {
    const lines = prompt.split('\n');
    const example = lines.findIndex((line, i) =>
      line === '---'
      && /^verdict: \w+$/.test(lines[i + 1] || '')
      && /^summary: /.test(lines[i + 2] || '')
      && lines[i + 3] === '---');

    assert.notEqual(example, -1,
      `${lane}: an example indented or fenced is an example Jordan copies wrongly; the four lines must stand alone`);
    assert.match(prompt, /The first line of the file is `---` and the frontmatter ends with a line that is exactly `---`\./,
      `${lane}: the rule must be spelled out as well as shown — the closing fence is the line he keeps dropping`);
    assert.match(prompt, /Write nothing before the first `---`\./,
      `${lane}: a preamble above the frontmatter is unreadable to the daemon too`);
  }
});

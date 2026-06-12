'use strict';

const REQUIRED_FIELDS  = ['id', 'title', 'goal', 'from', 'to', 'priority', 'created', 'status'];
const VALID_PRIORITIES = ['normal', 'high', 'critical'];
const VALID_TO         = ['rom', 'leeta', 'bashir'];

function buildSliceFrontmatter(overrides = {}) {
  return Object.assign({
    id:       '042',
    title:    'Regression fixture slice',
    goal:     'Validate the pipeline contract end-to-end.',
    from:     'obrien',
    to:       'rom',
    priority: 'normal',
    created:  '2026-01-01T00:00:00Z',
    status:   'STAGED',
  }, overrides);
}

function frontmatterToYaml(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) lines.push(`${k}: null`);
    else lines.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildSliceBody(acLines = ['1. The system behaves correctly.']) {
  return [
    '',
    '## Goal',
    'Validate the pipeline contract end-to-end.',
    '',
    '## Context',
    'This is a regression fixture slice used by the e2e journey suite.',
    '',
    '## Scope',
    '- regression/fixtures/',
    '',
    '## Out of scope',
    '- Production code.',
    '',
    '## Tasks',
    '1. Complete the implementation.',
    '',
    '## Acceptance criteria',
    ...acLines,
    '',
    '## Quality + goal check',
    '- Goal check: fixture slice should satisfy all ACs.',
    '- Quality check: no other files touched.',
    '',
    '## Files expected to change',
    '- (none)',
  ].join('\n');
}

function buildSliceFile(overrides = {}, acLines) {
  const fields = buildSliceFrontmatter(overrides);
  return frontmatterToYaml(fields) + buildSliceBody(acLines);
}

function buildRomDoneReport(round = 1) {
  return [
    '',
    '---',
    `## Rom DONE Report — Round ${round}`,
    '',
    `**Round:** ${round}`,
    '**Author:** rom',
    `**Timestamp:** 2026-01-01T01:00:00Z`,
    '',
    '### Summary',
    'Implementation complete. All ACs addressed.',
    '',
    '### Key changes',
    '- Updated the relevant module.',
    '',
    '### Uncertainties',
    '- None.',
  ].join('\n');
}

function buildNogReviewBlock(round = 1, verdict = 'PASS', reason = 'All ACs satisfied.') {
  return [
    '',
    '---',
    `## Nog Review — Round ${round}`,
    '',
    `**Verdict:** ${verdict}`,
    `**Round:** ${round}`,
    `**Reason:** ${reason}`,
  ].join('\n');
}

function buildRomEscalationBlock(reason = 'AC #1 contradicts AC #2 — cannot satisfy both simultaneously.') {
  return [
    '',
    '---',
    '## Rom Escalation — Slice Broken',
    '',
    '**Author:** rom',
    '**Timestamp:** 2026-01-01T01:00:00Z',
    '',
    '### Problem',
    reason,
  ].join('\n');
}

module.exports = {
  REQUIRED_FIELDS,
  VALID_PRIORITIES,
  VALID_TO,
  buildSliceFrontmatter,
  frontmatterToYaml,
  buildSliceBody,
  buildSliceFile,
  buildRomDoneReport,
  buildNogReviewBlock,
  buildRomEscalationBlock,
};

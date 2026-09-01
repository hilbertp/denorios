'use strict';

// J-release-workflow-shape — structural assertions for release.yml
// (ADR-PACKAGING, slice-352). The file is the authoritative spec artifact:
// its shape enforces the invariants the release pipeline depends on.
//
// Coverage:
//  - release.yml is workflow_dispatch-only (AC-1)
//  - ancestor check is present and precedes every push/tag step (AC-1)
//  - full gate (test-update, regression, e2e) runs before any push/tag step (AC-2)
//  - stable fast-forward and tag/release steps exist after the gate (AC-3)
//  - npm publish step skips gracefully when NPM_TOKEN is absent (AC-4)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_YML = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');

function readReleaseSteps() {
  const src = fs.readFileSync(RELEASE_YML, 'utf8');

  const parts = src.split(/\n\s*steps:\s*\n/);
  assert.equal(parts.length, 2, 'release.yml has exactly one steps: block');

  const chunks = ('\n' + parts[1])
    .split(/\n(?=\s*-\s+(?:name|uses):)/)
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.startsWith('-'));

  const ancestorIdx    = chunks.findIndex(c => /merge-base --is-ancestor/.test(c));
  const testUpdateIdx  = chunks.findIndex(c => /tests-needed\.js --strict/.test(c));
  const regressionIdx  = chunks.findIndex(c => /node --test/.test(c));
  const e2eIdx         = chunks.findIndex(c => /playwright test/.test(c));
  const stableIdx      = chunks.findIndex(c => /git push origin .*refs\/heads\/stable/.test(c));
  const tagPushIdx     = chunks.findIndex(c => /git push origin .*v\$\{VERSION\}/.test(c));
  const releaseIdx     = chunks.findIndex(c => /gh release create/.test(c));
  const npmIdx         = chunks.findIndex(c => /npm publish/.test(c));

  return {
    src, chunks,
    ancestorIdx, testUpdateIdx, regressionIdx, e2eIdx,
    stableIdx, tagPushIdx, releaseIdx, npmIdx,
  };
}

// ── AC-1: dispatch-only + ancestor check before any push ───────────────────

test('slice-352-ac-1 part-a — release.yml is workflow_dispatch-only with no push or pull_request trigger', () => {
  const { src } = readReleaseSteps();

  // Extract the on: block: indented lines immediately after "on:\n"
  const onBlockMatch = src.match(/^on:\n((?:[ \t].+\n)*)/m);
  assert.ok(onBlockMatch, 'on: block found in release.yml');
  const onBlock = onBlockMatch[0];

  assert.match(onBlock, /workflow_dispatch/, 'workflow_dispatch trigger present');
  assert.doesNotMatch(onBlock, /\bpush:/, 'no push: trigger in on: block');
  assert.doesNotMatch(onBlock, /\bpull_request:/, 'no pull_request: trigger in on: block');
});

test('slice-352-ac-1 part-b — ancestor check (merge-base --is-ancestor) exists and precedes every git push step', () => {
  const { chunks, ancestorIdx } = readReleaseSteps();

  assert.notEqual(ancestorIdx, -1, 'a step containing merge-base --is-ancestor exists');

  const pushIdxs = chunks
    .map((c, i) => /git push origin/.test(c) ? i : -1)
    .filter(i => i !== -1);
  assert.ok(pushIdxs.length > 0, 'at least one git push step exists');
  const firstPushIdx = Math.min(...pushIdxs);

  assert.ok(
    ancestorIdx < firstPushIdx,
    `ancestor check (step ${ancestorIdx}) must precede first git push (step ${firstPushIdx})`,
  );
});

// ── AC-2: full gate before any push or tag step ────────────────────────────

test('slice-352-ac-2 part-a — test-update gate (tests-needed.js --strict) runs before any push or tag step', () => {
  const { chunks, testUpdateIdx, stableIdx, tagPushIdx } = readReleaseSteps();

  assert.notEqual(testUpdateIdx, -1, 'tests-needed.js --strict step exists');

  const firstOutputStep = Math.min(
    stableIdx === -1 ? Infinity : stableIdx,
    tagPushIdx === -1 ? Infinity : tagPushIdx,
  );
  assert.ok(firstOutputStep < Infinity, 'at least one push/tag step exists');
  assert.ok(
    testUpdateIdx < firstOutputStep,
    `test-update gate (step ${testUpdateIdx}) must run before first push/tag (step ${firstOutputStep})`,
  );
});

test('slice-352-ac-2 part-b — regression suite (node --test) runs before any push or tag step', () => {
  const { regressionIdx, stableIdx, tagPushIdx } = readReleaseSteps();

  assert.notEqual(regressionIdx, -1, 'regression gate step (node --test) exists');

  const firstOutputStep = Math.min(
    stableIdx === -1 ? Infinity : stableIdx,
    tagPushIdx === -1 ? Infinity : tagPushIdx,
  );
  assert.ok(firstOutputStep < Infinity, 'at least one push/tag step exists');
  assert.ok(
    regressionIdx < firstOutputStep,
    `regression gate (step ${regressionIdx}) must run before first push/tag (step ${firstOutputStep})`,
  );
});

test('slice-352-ac-2 part-c — Playwright e2e gate runs before any push or tag step', () => {
  const { e2eIdx, stableIdx, tagPushIdx } = readReleaseSteps();

  assert.notEqual(e2eIdx, -1, 'Playwright e2e step (playwright test) exists');

  const firstOutputStep = Math.min(
    stableIdx === -1 ? Infinity : stableIdx,
    tagPushIdx === -1 ? Infinity : tagPushIdx,
  );
  assert.ok(firstOutputStep < Infinity, 'at least one push/tag step exists');
  assert.ok(
    e2eIdx < firstOutputStep,
    `e2e gate (step ${e2eIdx}) must run before first push/tag (step ${firstOutputStep})`,
  );
});

test('slice-352-ac-2 part-d — release.yml has no always(), failure(), or continue-on-error escape hatches', () => {
  const { src } = readReleaseSteps();

  assert.doesNotMatch(src, /always\(\)/, 'no always() in release.yml');
  assert.doesNotMatch(src, /failure\(\)/, 'no failure() in release.yml');
  assert.doesNotMatch(src, /continue-on-error/, 'no continue-on-error in release.yml');
});

// ── AC-3: stable fast-forward + tag + GitHub release exist after gate ──────

test('slice-352-ac-3 part-a — stable fast-forward step pushes refs/heads/stable and exists after the gate steps', () => {
  const { stableIdx, regressionIdx, e2eIdx } = readReleaseSteps();

  assert.notEqual(stableIdx, -1, 'a step pushing refs/heads/stable exists');
  assert.ok(regressionIdx < stableIdx, 'regression gate precedes stable push');
  assert.ok(e2eIdx < stableIdx, 'e2e gate precedes stable push');
});

test('slice-352-ac-3 part-b — a tag step and gh release create step exist after the gate and after the stable push', () => {
  const { tagPushIdx, releaseIdx, stableIdx } = readReleaseSteps();

  assert.notEqual(tagPushIdx, -1, 'a step pushing the version tag exists');
  assert.notEqual(releaseIdx, -1, 'a gh release create step exists');
  assert.ok(stableIdx < tagPushIdx || stableIdx < releaseIdx,
    'stable push precedes the tag or release step');
});

// ── AC-4: npm publish skips gracefully without NPM_TOKEN ──────────────────

test('slice-352-ac-4 — npm publish step guards on NPM_TOKEN and exits 0 when the secret is absent', () => {
  const { chunks, npmIdx } = readReleaseSteps();

  assert.notEqual(npmIdx, -1, 'a step containing npm publish exists');
  const npmStep = chunks[npmIdx];

  assert.match(npmStep, /NPM_TOKEN/, 'npm publish step references NPM_TOKEN');
  // The step must print a visible notice and exit 0 — not just skip silently
  assert.match(npmStep, /publish skipped/, 'npm publish step emits a visible "publish skipped" notice');
  assert.match(npmStep, /exit 0/, 'npm publish step exits 0 (success) when NPM_TOKEN is absent');
});

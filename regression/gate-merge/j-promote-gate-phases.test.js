'use strict';

// J-promote-gate-phases — the dashboard must SHOW the gate's phases (regression →
// e2e → fast-forward) so the operator sees the regression suite run green before main
// moves (Philipp 2026-06-13: "this has to run and be green first before promoting").
// mapPromotePhases folds a promote run's raw job steps into those three ordered phases
// with status + duration. Pure function — unit-tested here; rendering covered in e2e.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { mapPromotePhases } = require(path.resolve(__dirname, '..', '..', 'dashboard', 'server.js'));
const PROMOTE_YML = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'promote.yml');
const CI_YML = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');

const STEP = (name, status, conclusion, startedAt, completedAt) =>
  ({ name, status, conclusion, startedAt, completedAt });
const VERDICT_STEP = (status, conclusion, startedAt, completedAt) =>
  STEP('Test-Update Gate (verdict — fail closed on RED)', status, conclusion, startedAt, completedAt);
const byKey = (phases) => Object.fromEntries(phases.map(p => [p.key, p]));

test('J-promote-gate-phases ac-1 — a green run folds to regression/e2e/ff all passed, in order, with real durations', () => {
  const phases = mapPromotePhases([
    STEP('Set up job', 'completed', 'success'),
    VERDICT_STEP('completed', 'success', '2026-06-13T17:06:00Z', '2026-06-13T17:06:01Z'),
    STEP('Run regression gate (fast node:test suite)', 'completed', 'success', '2026-06-13T17:06:02Z', '2026-06-13T17:06:04Z'),
    STEP('Run browser e2e gate (Playwright click-paths)', 'completed', 'success', '2026-06-13T17:06:32Z', '2026-06-13T17:07:06Z'),
    STEP('Fast-forward main to the tested commit', 'completed', 'success', '2026-06-13T17:07:06Z', '2026-06-13T17:07:07Z'),
  ]);
  assert.deepEqual(phases.map(p => p.key), ['tests-needed', 'regression', 'e2e', 'ff'],
    'phases ordered test-update gate → regression → e2e → ff');
  assert.deepEqual(phases.map(p => p.status), ['passed', 'passed', 'passed', 'passed']);
  const k = byKey(phases);
  assert.equal(k['tests-needed'].duration_s, 1, 'the verdict gate ran ~1s');
  assert.equal(k.regression.duration_s, 2, 'regression ran ~2s');
  assert.equal(k.e2e.duration_s, 34, 'e2e ran ~34s — proves it is not instant');
  assert.equal(k.ff.duration_s, 1, 'fast-forward ~1s');
});

test('J-promote-gate-phases ac-2 — a live run shows regression passed, e2e running, ff pending', () => {
  const phases = mapPromotePhases([
    VERDICT_STEP('completed', 'success', '2026-06-13T17:06:00Z', '2026-06-13T17:06:01Z'),
    STEP('Run regression gate (fast node:test suite)', 'completed', 'success', '2026-06-13T17:06:02Z', '2026-06-13T17:06:04Z'),
    STEP('Run browser e2e gate (Playwright click-paths)', 'in_progress', null, '2026-06-13T17:06:32Z', null),
    STEP('Fast-forward main to the tested commit', 'queued', null),
  ]);
  assert.deepEqual(phases.map(p => p.status), ['passed', 'passed', 'running', 'pending']);
  const k = byKey(phases);
  assert.equal(k.regression.duration_s, 2);
  assert.equal(k.e2e.duration_s, null, 'a running phase has no final duration yet');
});

test('J-promote-gate-phases ac-3 — a red e2e marks the e2e phase failed and ff stays unrun (main must not move)', () => {
  const phases = mapPromotePhases([
    VERDICT_STEP('completed', 'success', '2026-06-13T17:06:00Z', '2026-06-13T17:06:01Z'),
    STEP('Run regression gate (fast node:test suite)', 'completed', 'success', '2026-06-13T17:06:02Z', '2026-06-13T17:06:04Z'),
    STEP('Run browser e2e gate (Playwright click-paths)', 'completed', 'failure', '2026-06-13T17:06:32Z', '2026-06-13T17:06:50Z'),
    STEP('Fast-forward main to the tested commit', 'completed', 'skipped'),
  ]);
  const k = byKey(phases);
  assert.equal(k.regression.status, 'passed');
  assert.equal(k.e2e.status, 'failed', 'a red e2e is shown as a failed phase');
  assert.notEqual(k.ff.status, 'passed', 'the fast-forward must never read as passed when e2e failed');
});

test('J-promote-gate-phases ac-4 — e2e phase is matched by "Playwright" so renaming the step prose cannot silently drop it', () => {
  const phases = mapPromotePhases([
    STEP('Run regression gate (fast node:test suite)', 'completed', 'success'),
    STEP('Run the Playwright browser journeys', 'in_progress', null),
    STEP('Fast-forward main to the tested commit', 'queued', null),
  ]);
  assert.equal(byKey(phases).e2e.status, 'running', 'e2e phase still resolves via the Playwright match');
});

test('J-promote-gate-phases ac-7 — the Test-Update Gate phase resolves from the verdict step and fails the phase on a RED verdict', () => {
  const red = mapPromotePhases([
    VERDICT_STEP('completed', 'failure', '2026-06-13T17:06:00Z', '2026-06-13T17:06:02Z'),
    STEP('Run regression gate (fast node:test suite)', 'completed', 'skipped'),
    STEP('Run browser e2e gate (Playwright click-paths)', 'completed', 'skipped'),
    STEP('Fast-forward main to the tested commit', 'completed', 'skipped'),
  ]);
  const k = byKey(red);
  assert.equal(k['tests-needed'].status, 'failed', 'a RED verdict shows the gate phase as failed');
  assert.equal(k['tests-needed'].duration_s, 2, 'the verdict gate carries its real duration');
  assert.notEqual(k.regression.status, 'passed', 'the suites never read as passed when the verdict failed closed');
});

test('J-promote-gate-phases ac-8 — the workflows wire the gate: promote ENFORCES (ordered, no escape hatch), ci WARNS (advisory)', () => {
  const promote = fs.readFileSync(PROMOTE_YML, 'utf8');
  // promote.yml runs the strict verdict AFTER the informational "what changed" step and
  // strictly BEFORE the regression suite — fail closed, with no continue-on-error.
  const informIdx = promote.indexOf('Update tests — what changed in this promotion');
  const verdictIdx = promote.indexOf('Test-Update Gate (verdict');
  const strictIdx  = promote.indexOf('tests-needed.js --strict');
  const regIdx     = promote.search(/node --test 'regression/);
  assert.ok(informIdx !== -1 && verdictIdx !== -1 && strictIdx !== -1 && regIdx !== -1, 'all gate steps must be present');
  assert.ok(informIdx < verdictIdx, 'the verdict step follows the informational "what changed" step');
  assert.ok(verdictIdx < regIdx, 'the verdict gate runs before the regression suite');
  assert.ok(strictIdx < regIdx, 'the verdict gate is enforcing (--strict) and runs before the suite');
  // The verdict step must not be neutered by continue-on-error.
  const verdictBlock = promote.slice(verdictIdx, regIdx);
  assert.ok(!/continue-on-error/.test(verdictBlock), 'the enforcing verdict step must not continue-on-error');

  // ci.yml runs the gate ADVISORY on dev push: no --strict (cannot fail the job).
  const ci = fs.readFileSync(CI_YML, 'utf8');
  assert.ok(/tests-needed\.js/.test(ci), 'ci runs the Test-Update Gate for early warning');
  assert.ok(!/tests-needed\.js --strict/.test(ci), 'per-push CI must be advisory, never --strict');
});

test('J-promote-gate-phases ac-6 — the e2e phase binds to the RUN step, never the "Install (browser e2e gate)" step (the 1s-vs-34s bug)', () => {
  // Both the install-deps step and the run step contain "browser e2e gate"; the install
  // one runs ~1s and comes first. The e2e phase must report the RUN step's ~34s, or it
  // looks like e2e never ran.
  const phases = mapPromotePhases([
    STEP('Run regression gate (fast node:test suite)', 'completed', 'success', '2026-06-13T17:06:02Z', '2026-06-13T17:06:04Z'),
    STEP('Install dependencies (browser e2e gate)', 'completed', 'success', '2026-06-13T17:06:04Z', '2026-06-13T17:06:05Z'),
    STEP('Install Playwright browser', 'completed', 'success', '2026-06-13T17:06:05Z', '2026-06-13T17:06:32Z'),
    STEP('Run browser e2e gate (Playwright click-paths)', 'completed', 'success', '2026-06-13T17:06:32Z', '2026-06-13T17:07:06Z'),
    STEP('Fast-forward main to the tested commit', 'completed', 'success', '2026-06-13T17:07:06Z', '2026-06-13T17:07:07Z'),
  ]);
  const e2e = phases.find(p => p.key === 'e2e');
  assert.equal(e2e.duration_s, 34, 'e2e must report the RUN step (~34s), not the 1s install step');
  assert.notEqual(e2e.duration_s, 1, 'guard against the install-step mismatch');
});

test('J-promote-gate-phases ac-5 — missing steps degrade to pending, never to a false passed; non-array → null', () => {
  const phases = mapPromotePhases([]); // no steps yet (run just queued)
  assert.deepEqual(phases.map(p => p.status), ['pending', 'pending', 'pending', 'pending'],
    'with no steps, nothing is reported as passed — the gate has not proven anything');
  assert.equal(mapPromotePhases(null), null);
  assert.equal(mapPromotePhases(undefined), null);
});

'use strict';
// ── The Test Drift Gate ──────────────────────────────────────────────────────
// The operator-facing review of how dev's pending changes affect the test suite.
// "Drift" = the code and the tests have moved apart. This is a PURE transform over
// the Test-Update classifier (lib/tests-needed.js): it re-buckets that verdict into
// two plain-English piles for the operator and recommends one action —
//
//   • POSSIBLE REGRESSION  → a guard was weakened/removed/skipped, or new code shipped
//                            with no test. This is how a real bug slips through. → STOP.
//   • DELIBERATE CHANGE    → behaviour moved but no test moved with it. Probably an
//                            intended feature change whose test needs updating (or it's
//                            covered elsewhere). → REVIEW: your call.
//
// v1 is SHOW + DECIDE only. drift() never writes a test and never edits an AC — it
// describes the changeset and recommends PROCEED / REVIEW / STOP. The human presses
// OK or STOP. Fails safe: an unclassifiable verdict recommends STOP.

const ACTION = { PROCEED: 'PROCEED', REVIEW: 'REVIEW', STOP: 'STOP' };

// Re-bucket a classify() result (from lib/tests-needed.js) into the operator view.
function drift(classifyResult) {
  const r = classifyResult || {};
  const dec = r.decision || 'unknown';

  // ── POSSIBLE REGRESSION (STOP-worthy) — a check got weaker/gone, or new code is
  //    unguarded. If any of these is intentional the human declares it (override).
  const regression = [];
  const push = (arr, kind, why, getFile, getTag) =>
    (arr || []).forEach(c => regression.push({ kind, why, file: getFile(c), tag: getTag ? getTag(c) : null }));
  push(r.loosenedUndeclared, 'loosened', 'a test assertion was weakened', c => c.file, c => c.tag);
  push(r.removedUndeclared,  'removed',  'a test was removed',            c => c.file, c => c.tag);
  push(r.skippedUndeclared,  'skipped',  'a test was skipped',            c => c.file, c => c.tag);
  push(r.newBehaviourNoTest, 'untested', 'new code shipped with no test', b => b.path);
  // Other red causes that aren't per-check — surface them so STOP is never causeless.
  if (r.coverageShrinkUndeclared)
    regression.push({ kind: 'coverage-shrank', why: `the coverage guard count dropped (${r.coverageGuardCountBase} → ${r.coverageGuardCount}) with no Coverage-Removed declaration`, file: 'regression/COVERAGE.lock', tag: null });
  if (r.mismatchedOverride)
    regression.push({ kind: 'bad-override', why: 'an override trailer declares the wrong transition for the check it names', file: null, tag: null });
  (r.rejectedTrailers || []).forEach(t =>
    regression.push({ kind: 'rejected-override', why: `an override trailer was malformed and rejected (${t.why || 'unscoped'})`, file: null, tag: null }));

  // ── DELIBERATE CHANGE (your call) — behaviour changed, no guard moved with it.
  //    Exclude the new-untested files already counted as regression above.
  const untestedPaths = new Set((r.newBehaviourNoTest || []).map(b => b.path));
  const deliberate = (r.unguardedSourceChanges || [])
    .filter(b => !untestedPaths.has(b.path))
    .map(b => ({ kind: 'behaviour-changed', file: b.path, tag: null, why: 'behaviour changed but no test moved to match' }));

  // ── ALREADY DECLARED — overrides; informational, not a decision.
  const declared = (r.overridden || []).map(o => ({ kind: 'declared', file: o.file, tag: o.tag, why: `declared intentional (${o.transition})` }));

  // ── Verdict → one recommended action + a plain-English headline.
  let action, headline;
  if (dec === 'red_flag') {
    action = ACTION.STOP;
    headline = 'A guard was weakened/removed or new code shipped untested — this is how a regression slips through. STOP and look, unless you meant it (then declare it).';
  } else if (dec === 'needs_review') {
    action = ACTION.REVIEW;
    headline = 'Behaviour changed but no test moved to match. Your call: a deliberate change whose test needs updating, or a coverage gap to chase.';
  } else if (dec === 'overridden') {
    action = ACTION.PROCEED;
    headline = 'Every guarded change is declared-intentional. Clear to proceed.';
  } else if (dec === 'clear') {
    action = ACTION.PROCEED;
    headline = 'No test drift — nothing the suite guards changed in a risky way. Clear to proceed.';
  } else {
    action = ACTION.STOP;
    headline = 'Could not classify the changeset — STOP and investigate (fail safe).';
  }

  return {
    decision: dec,
    action,                 // PROCEED | REVIEW | STOP
    headline,
    regression,             // possible-regression pile (STOP-worthy)
    deliberate,             // likely-deliberate pile (your call)
    declared,               // already-declared (informational)
    counts: { regression: regression.length, deliberate: deliberate.length, declared: declared.length },
    base: r.base || null,
    head: r.head || null,
  };
}

// Pure text render of a drift report — shared by the CLI and the dashboard preview so
// both speak the same plain English.
const GLYPH = { PROCEED: '✓', REVIEW: '●', STOP: '✗' };
function render(d) {
  const sha = (s) => (s ? String(s).slice(0, 7) : '?');
  const L = [`Test Drift Gate: ${GLYPH[d.action] || '?'} ${d.action}  (${sha(d.base)} → ${sha(d.head)})`, `  ${d.headline}`];
  const pile = (title, items) => {
    if (!items || !items.length) return;
    L.push('', `  ${title} (${items.length}):`);
    for (const it of items) {
      const where = it.file ? ` [${it.file}${it.tag ? ` · ${it.tag}` : ''}]` : '';
      L.push(`    • ${it.why}${where}`);
    }
  };
  pile('⚠ POSSIBLE REGRESSION — STOP and look (or declare it intentional)', d.regression);
  pile('✎ DELIBERATE CHANGE — your call: update the test, or confirm it’s covered', d.deliberate);
  pile('✓ ALREADY DECLARED — intentional, no action', d.declared);
  L.push('', d.action === 'PROCEED'
    ? '  → No decision needed. Press RUN GATE & MERGE when ready.'
    : d.action === 'REVIEW'
      ? '  → YOUR CALL: press OK to proceed (you’ll update the tests), or STOP to investigate.'
      : '  → DEFAULT STOP: fix the code or declare the change intentional before merging.');
  return L.join('\n');
}

module.exports = { drift, render, ACTION };

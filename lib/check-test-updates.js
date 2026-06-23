'use strict';
// ── CHECK FOR TEST UPDATES — stage ① of the two-stage merge gate ──────────────
// The operator presses "Check for test updates" BEFORE the merge gate. This drains the
// ACs for the pending commits, reconciles each against the existing regression + smoke
// tests, and lets Bashir decide per AC — acting on high confidence, flagging the rest.
//
// triage() is PURE over a reconcile() result + the manifest + the recorded human
// decisions. It assigns each AC a CONFIDENCE and an ACTION:
//
//   COVERED          → high · pass         (a guard's @ac-hash already matches the AC)
//   STALE            → high · update-test  (guard exists but drifted from the AC → Bashir
//                                           auto-updates the test from the AC text)
//   MISSING          → low  · decide       (no guard — does this AC warrant a permanent
//                                           regression/smoke test? Bashir is unsure → ASK
//                                           the human: Update the tests, or Keep as is)
//   LEGACY_UNHASHED  → n/a  · skip         (grandfathered; not part of this drain)
//
// A recorded human decision overrides the flag: 'update' → update-test, 'keep' → kept.
// Stage ① is GREEN (merge unlocks) only when nothing is left awaiting a human.

const CONF = { HIGH: 'high', LOW: 'low', NA: 'n/a' };

// One AC tag → its triage row.
function triageTag(tag, status, manifestEntry, decision) {
  const title = (manifestEntry && (manifestEntry.title || manifestEntry.text)) || tag;
  // A recorded human decision is final — it never re-flags.
  if (decision === 'keep')   return { tag, title, status, confidence: CONF.HIGH, action: 'kept',        needsHuman: false, reason: 'You ruled this AC needs no test.' };
  if (decision === 'update') return { tag, title, status, confidence: CONF.HIGH, action: 'update-test', needsHuman: false, reason: 'You ruled the test should be updated for this AC.' };

  switch (status) {
    case 'COVERED':
      return { tag, title, status, confidence: CONF.HIGH, action: 'pass', needsHuman: false,
        reason: 'Already tested — a guard’s @ac-hash matches this AC.' };
    case 'STALE':
      return { tag, title, status, confidence: CONF.HIGH, action: 'update-test', needsHuman: false,
        reason: 'The AC changed but its test did not — update the test to match the new AC.' };
    case 'MISSING':
      return { tag, title, status, confidence: CONF.LOW, action: 'decide', needsHuman: true,
        reason: 'No test guards this AC. Should it have a permanent regression/smoke test, or is it not worth guarding?' };
    case 'LEGACY_UNHASHED':
    default:
      return { tag, title, status, confidence: CONF.NA, action: 'skip', needsHuman: false,
        reason: 'Grandfathered (unhashed) — not part of this check.' };
  }
}

// facts = { reconcile: <reconcile() result>, manifest: {byTag}, decisions: {tag: 'update'|'keep'} }
function triage(facts) {
  const rec = (facts && facts.reconcile) || { byTag: {} };
  const manifest = (facts && facts.manifest) || { byTag: {} };
  const decisions = (facts && facts.decisions) || {};

  const items = [];
  for (const [tag, info] of Object.entries(rec.byTag || {})) {
    const row = triageTag(tag, info.status, manifest.byTag && manifest.byTag[tag], decisions[tag]);
    if (row.action === 'skip') continue; // grandfathered/legacy — not surfaced
    items.push(row);
  }
  // Stable order: the ones needing a human first, then auto-updates, then passes.
  const rank = { decide: 0, 'update-test': 1, pass: 2, kept: 3 };
  items.sort((a, b) => (rank[a.action] - rank[b.action]) || a.tag.localeCompare(b.tag));

  const flagged = items.filter(i => i.needsHuman);
  const autoUpdate = items.filter(i => i.action === 'update-test' && !decisions[i.tag]);
  const summary = {
    checked: items.length,
    passed: items.filter(i => i.action === 'pass').length,
    autoUpdate: autoUpdate.length,
    flagged: flagged.length,
    kept: items.filter(i => i.action === 'kept').length,
  };
  // Stage ① is GREEN — the merge gate unlocks — only when nothing awaits a human.
  const ready = flagged.length === 0;
  return {
    items, flagged, summary, ready,
    verdict: ready ? (summary.autoUpdate || summary.kept ? 'RESOLVED' : 'CLEAR') : 'NEEDS_YOU',
  };
}

module.exports = { triage, triageTag, CONF };

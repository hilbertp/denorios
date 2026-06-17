'use strict';

// AC-reconcile classifier — BUILD-1 of ADR-AC-RECONCILE, STEP 1 of the pipeline.
//
// Pure reconcile(facts) — a sibling of lib/tests-needed.js `decide()` — joining the
// AC manifest (acHash per tag = the SPEC) with COVERAGE.lock (which tags have a guard,
// and the guardAcHash embedded in that test = the guard's CLAIM). No I/O, no git, no clock.
//
//   MISSING          — manifest tag has no guard in COVERAGE.lock.
//   STALE            — guard exists but guardAcHash != acHash (the only contradiction
//                      candidate; a STALE that is ALSO semantic is a CONTRADICTION that
//                      Julian judges — he updates the TEST from the AC, NEVER the AC, and
//                      escalates to Philipp if he can't, per the hard ruling).
//   COVERED          — guard exists and guardAcHash matches acHash.
//   LEGACY_UNHASHED  — grandfathered legacy tag (acHash null): a guard exists but it's
//                      never hash-ratcheted until a human backfills the AC text. Drains
//                      off the allowlist over time; not blocking.
//
// "reconciled" is a DERIVED verdict, never a written field: COVERED (or grandfathered
// LEGACY_UNHASHED). MISSING/STALE are the work set.

function indexGuards(coverage) {
  const byTag = new Map();
  for (const src of Object.keys((coverage && coverage.bySource) || {})) {
    for (const e of coverage.bySource[src]) {
      if (!byTag.has(e.tag)) byTag.set(e.tag, { count: 0, hashes: new Set() });
      const g = byTag.get(e.tag);
      g.count++;
      if (e.guardAcHash) g.hashes.add(e.guardAcHash);
    }
  }
  return byTag;
}

// facts: { manifest, coverage, tags? } — tags optionally restricts to an in-window subset.
function reconcile(facts) {
  const manifest = (facts && facts.manifest) || { byTag: {} };
  const guards = indexGuards(facts && facts.coverage);
  const restrict = facts && facts.tags ? new Set(facts.tags) : null;

  const byTag = {};
  const counts = { COVERED: 0, STALE: 0, MISSING: 0, LEGACY_UNHASHED: 0 };

  for (const [tag, entry] of Object.entries(manifest.byTag || {})) {
    if (restrict && !restrict.has(tag)) continue;
    const g = guards.get(tag);
    let status;
    if (!g || g.count === 0) {
      status = 'MISSING';
    } else if (entry.legacy || entry.acHash == null) {
      status = 'LEGACY_UNHASHED';
    } else if (g.hashes.size === 0) {
      // An active (hashed) AC whose guard carries no @ac-hash can't be verified → stale.
      status = 'STALE';
    } else {
      status = g.hashes.has(entry.acHash) ? 'COVERED' : 'STALE';
    }
    byTag[tag] = { status, legacy: !!entry.legacy };
    counts[status]++;
  }

  // Advisory-v1 work set. MISSING/STALE need attention; CONTRADICTION is the subset of
  // STALE Julian must judge (escalating, never editing an AC).
  const workSet = counts.MISSING + counts.STALE;
  return {
    byTag,
    counts,
    workSet,
    verdict: workSet === 0 ? 'GREEN' : 'NEEDS_RECONCILE',
  };
}

// The NEW-AC drain feed (Philipp's workflow): every AC commissioned through a slice must
// surface to Julian when he runs the pipeline; he triages which ones change behaviour, then
// drains. A NEW AC = an ACTIVE manifest entry whose acHash differs from the drained ledger —
// a brand-new tag, or an AC whose text changed since Julian last drained it. Legacy (unhashed)
// entries are NOT "new to triage" — they're the separate grandfathered backfill task.
//
// drained ledger shape: { drained: { "<tag>": "<acHash>" } }
function newAcs({ manifest, drained, reconcileByTag }) {
  const d = (drained && drained.drained) || {};
  const cov = reconcileByTag || {};
  const out = [];
  for (const [tag, e] of Object.entries((manifest && manifest.byTag) || {})) {
    if (e.legacy || e.acHash == null) continue;
    if (d[tag] === e.acHash) continue; // already drained at this exact spec
    out.push({
      tag, slice: e.slice, text: e.text, acHash: e.acHash,
      previouslyDrainedHash: d[tag] || null,
      changed: !!d[tag],                          // drained before at a DIFFERENT hash = behaviour edit
      coverage: (cov[tag] && cov[tag].status) || 'MISSING',
    });
  }
  return out.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

// Advance the drained ledger to the manifest's current state — Julian's "I've triaged these"
// act. Records every tag's current acHash (null for legacy), so a later backfill re-surfaces.
function drainLedger(manifest) {
  const drained = {};
  for (const [tag, e] of Object.entries((manifest && manifest.byTag) || {})) drained[tag] = e.acHash;
  return { generator: 'scripts/ac-reconcile.js --drain', drained };
}

module.exports = { reconcile, indexGuards, newAcs, drainLedger };

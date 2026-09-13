'use strict';

// AC-reconcile classifier — BUILD-1 of ADR-AC-RECONCILE, STEP 1 of the pipeline.
//
// Pure reconcile(facts) — a sibling of lib/tests-needed.js `decide()` — joining the
// AC manifest (acHash per tag = the SPEC) with COVERAGE.lock (which tags have a guard,
// and the guardAcHash embedded in that test = the guard's CLAIM). No I/O, no git, no clock.
//
//   MISSING          — a CORE manifest tag has no guard in COVERAGE.lock.
//   SURFACE          — a SURFACE manifest tag has no guard (slice 390, ADR-PROOF-LANES). Not
//                      a missing test: the criterion is about what the screen shows or says,
//                      Jordan's review is its evidence and the browser suite covers the screen
//                      at the gate. Counted, never in the work set, never a human's decision.
//                      A surface tag that DOES have a guard is ratcheted like any other.
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
// LEGACY_UNHASHED, or lane-excused SURFACE). MISSING/STALE are the work set.

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
  const counts = { COVERED: 0, STALE: 0, MISSING: 0, SURFACE: 0, LEGACY_UNHASHED: 0 };

  for (const [tag, entry] of Object.entries(manifest.byTag || {})) {
    if (restrict && !restrict.has(tag)) continue;
    const g = guards.get(tag);
    let status;
    if (!g || g.count === 0) {
      // The lane decides what an absent guard MEANS. Only an unclassified or core
      // criterion is missing one; a surface criterion never owed one. Anything that is
      // not literally 'surface' is core — an unset lane is the whole back catalogue.
      status = entry.lane === 'surface' ? 'SURFACE' : 'MISSING';
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
  // STALE Julian must judge (escalating, never editing an AC). SURFACE is deliberately
  // absent: it is work nobody owes, so counting it would put the gate back on NEEDS_YOU
  // for exactly the criteria the lane exists to let through.
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

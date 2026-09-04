'use strict';
// ── The Test-Update Gate engine (ADR-TEST-UPDATE-GATE, Slice B) ──────────────
//
// Given a PINNED changeset (base..head, two-dot — the exact commits being promoted),
// decide whether the regression/e2e tests should have been updated, and separate an
// intended-behaviour change (→ update the test) from a masked regression (→ fix the
// code). Resists loosen / delete / skip-to-go-green.
//
// `decide(facts)` is the PURE verdict logic (unit-tested with synthetic facts).
// `gather({base,head,repoRoot})` runs git to collect those facts. `classify(...)`
// composes the two. classify NEVER resolves symbolic refs — the caller pins the SHAs,
// so the classified changeset is the promoted changeset. Fails toward FIX-THE-CODE.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { classifyFileDiff } = require('./assert-direction');

function git(args, repoRoot, quiet) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] });
}

// ── Path buckets ────────────────────────────────────────────────────────────
function bucketOf(p) {
  // gate's own backstop + spec layer (ADR-AC-RECONCILE: the manifest is a first-class input)
  if (p === 'regression/COVERAGE.lock' || p === 'regression/COVERAGE.md' || p === 'regression/AC-MANIFEST.lock') return 'BEHAVIOUR';
  // POLICE ONLY WHAT WE RUN (Philipp's ruling, req. 6). `test/` is deliberately ABSENT here:
  // nothing executes that directory — not ci.yml, not promote.yml, not the orchestrator, not an
  // npm script — and the coverage map never walks it. Policing a suite no runner runs manufactures
  // blockers that no green run can ever answer, so it falls through to INERT below. Re-adding it
  // means porting the suite into regression/ first; j-unrun-test-dir.test.js fails if it comes back.
  if (/^regression\//.test(p) || /^e2e\//.test(p)) return 'TEST';
  if (/^docs\//.test(p) || /^\.claude\//.test(p)) return 'INERT';
  if (/^bridge\/(queue|staged|trash|state)\//.test(p) || p === 'bridge/register.jsonl') return 'INERT';
  if (/^dashboard\//.test(p)) return 'BEHAVIOUR';
  if (/^bridge\/[^/]+\.js$/.test(p)) return 'BEHAVIOUR';
  if (/^scripts\//.test(p) || /^lib\//.test(p)) return 'BEHAVIOUR';
  if (p === '.github/workflows/promote.yml' || p === '.github/workflows/ci.yml') return 'BEHAVIOUR';
  if (/\.md$/.test(p)) return 'INERT';
  return 'INERT';
}
function areaOf(testFile) { return /^e2e\//.test(testFile) ? 'e2e' : 'regression'; }
function transitionFor(direction) {
  return direction === 'loosened' ? 'strict→weak' : direction === 'removed' ? 'removed' : direction === 'skipped' ? 'skipped' : 'reworded';
}
function globToRe(glob) {
  return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '').replace(/\*/g, '[^/]*').replace(//g, '.*') + '$');
}

// ── Override trailers ───────────────────────────────────────────────────────
function parseTrailers(bodies) {
  const testsNotNeeded = [], loosenOk = [], coverageRemoved = [], acChangeOk = [], specOwners = [], rejected = [];
  for (const body of (bodies || [])) {
    for (const line of String(body).split('\n')) {
      let m;
      if ((m = line.match(/^\s*Tests-Not-Needed:\s*(.+)$/i))) {
        const parts = m[1].trim().split(/\s+/);
        const glob = parts.shift(); const reason = parts.join(' ');
        if (!glob || !reason || !/[\/*.]/.test(glob)) rejected.push({ kind: 'Tests-Not-Needed', line: line.trim(), why: 'needs a path-glob and a reason' });
        else testsNotNeeded.push({ glob, reason });
      } else if ((m = line.match(/^\s*Test-Loosen-OK:\s*(\S+)\s+(strict→weak|strict->weak|removed|skipped|reworded)\s+(.+)$/i))) {
        loosenOk.push({ target: m[1].toLowerCase(), transition: m[2].replace('->', '→').toLowerCase(), reason: m[3].trim() });
      } else if ((m = line.match(/^\s*Coverage-Removed:\s*(\S+)\s+(.+)$/i))) {
        coverageRemoved.push({ source: m[1], reason: m[2].trim() });
      } else if ((m = line.match(/^\s*AC-Change-OK:\s*(\S+)\s+(mutated|retired)\s+(.+)$/i))) {
        // ADR-AC-RECONCILE: authorize an AC spec edit. Requires a Spec-Owner co-trailer.
        acChangeOk.push({ tag: m[1].toLowerCase(), kind: m[2].toLowerCase(), reason: m[3].trim() });
      } else if ((m = line.match(/^\s*Spec-Owner:\s*(.+)$/i))) {
        specOwners.push(m[1].trim());
      }
    }
  }
  return { testsNotNeeded, loosenOk, coverageRemoved, acChangeOk, specOwners, rejected };
}

function worst(a, b) { const r = { clear: 0, overridden: 1, needs_review: 2, red_flag: 3 }; return r[b] > r[a] ? b : a; }

// A behaviour file is corroborated only if a MAPPED guard for that file moved in a
// non-masking direction. Without a coverage map nothing clears (file-grained
// corroboration arrives in Slice C) — behaviour changes land needs_review, not clear.
function corroborated(file, checks, covMap) {
  const guards = covMap && covMap.bySource && covMap.bySource[file] || [];
  if (!guards.length) return false;
  const good = new Set(checks.filter(c => c.direction === 'tightened' || c.direction === 'reworded' || c.kind === 'added').map(c => c.tag));
  return guards.some(g => good.has(g.tag));
}

// ── PURE verdict ────────────────────────────────────────────────────────────
// facts = { behaviourFiles:[{path,area,isNew}], checks:[{file,tag,name,area,kind,direction,rename}],
//           trailers:{testsNotNeeded,loosenOk,coverageRemoved,rejected}, covMap }
function decide(facts) {
  const behaviourFiles = facts.behaviourFiles || [];
  const checks = facts.checks || [];
  const trailers = facts.trailers || { testsNotNeeded: [], loosenOk: [], coverageRemoved: [], rejected: [] };
  const covMap = facts.covMap || null;

  const masking = checks.filter(c => c.direction === 'loosened' || c.direction === 'removed' || c.direction === 'skipped');
  const loosenedUndeclared = [], removedUndeclared = [], skippedUndeclared = [], overridden = [];
  let mismatchedOverride = false;
  for (const c of masking) {
    const want = transitionFor(c.direction);
    // An override matches a flagged check by TAG (slice-ac id, optionally e2e:-prefixed)
    // OR by FILE PATH/GLOB. The file-path form is load-bearing for untagged e2e tests:
    // those are keyed by their prose title, which the single-token trailer grammar
    // (Test-Loosen-OK: <\S+> …) cannot name — so renaming one would otherwise produce
    // a RED that NO trailer can clear. A path-like target (contains '/') is glob-matched
    // against the check's file so the intentional change is declarable.
    const ov = trailers.loosenOk.find(o =>
      o.target === c.tag
      || o.target === 'e2e:' + c.tag
      || (/\//.test(o.target) && globToRe(o.target).test(String(c.file).toLowerCase())));
    if (ov && ov.transition === want) { overridden.push({ tag: c.tag, file: c.file, transition: want, reason: ov.reason }); continue; }
    if (ov && ov.transition !== want) mismatchedOverride = true;
    if (c.direction === 'loosened') loosenedUndeclared.push(c);
    else if (c.direction === 'removed') removedUndeclared.push(c);
    else skippedUndeclared.push(c);
  }

  const notNeeded = (p) => trailers.testsNotNeeded.some(t => globToRe(t.glob).test(p));
  // The gate's own spec/coverage artifacts are inputs, not product behaviour needing a guard.
  const isGateSpec = (p) => p === 'regression/AC-MANIFEST.lock';
  const newBehaviourNoTest = behaviourFiles.filter(bf => bf.isNew && !isGateSpec(bf.path) && !notNeeded(bf.path) && !corroborated(bf.path, checks, covMap));
  const unguardedSourceChanges = behaviourFiles.filter(bf => !isGateSpec(bf.path) && !notNeeded(bf.path) && !corroborated(bf.path, checks, covMap));

  // Anti-shrink: the COVERAGE.lock guard count must never fall across the promoted
  // changeset unless a Coverage-Removed trailer declares the deletion on purpose.
  // Deleting a test to dodge corroboration is the same evasion as loosening one.
  const cov = facts.coverage || null;
  const coverageShrink = !!(cov && typeof cov.baseCount === 'number' && typeof cov.headCount === 'number' && cov.headCount < cov.baseCount);
  const coverageRemovalDeclared = (trailers.coverageRemoved || []).length > 0;
  const coverageShrinkUndeclared = coverageShrink && !coverageRemovalDeclared;
  const coverageRemovalOverridden = coverageShrink && coverageRemovalDeclared;

  // ── AC-MANIFEST.lock as a gate input (ADR-AC-RECONCILE §6) ──────────────────
  // Per-tag hash ratchet across base..head. An acHash change is AC-MUTATED; a tag that
  // disappears is AC-RETIRED. Each needs a matching AC-Change-OK + a Spec-Owner co-trailer,
  // else it's undeclared. A legacy backfill (acHash null → value) is NOT a mutation.
  const am = facts.acManifest || { base: null, head: null };
  const baseTags = (am.base && am.base.byTag) || {};
  const headTags = (am.head && am.head.byTag) || {};
  const acMutated = [], acRetired = [];
  for (const tag of Object.keys(headTags)) {
    const b = baseTags[tag], h = headTags[tag];
    if (b && b.acHash && h.acHash && b.acHash !== h.acHash) acMutated.push(tag);
  }
  for (const tag of Object.keys(baseTags)) {
    if (!headTags[tag]) acRetired.push(tag);
  }
  const acOk = trailers.acChangeOk || [];
  const hasSpecOwner = (trailers.specOwners || []).length > 0;
  const declared = (tag, kind) => hasSpecOwner && acOk.some(o => o.tag === tag.toLowerCase() && o.kind === kind);
  const acMutatedUndeclared = acMutated.filter(t => !declared(t, 'mutated'));
  const acRetiredUndeclared = acRetired.filter(t => !declared(t, 'retired'));
  const acOverridden = [...acMutated.filter(t => declared(t, 'mutated')), ...acRetired.filter(t => declared(t, 'retired'))];
  const acUndeclared = acMutatedUndeclared.length + acRetiredUndeclared.length;
  // §11.1: advisory by default (needs_review + auditable counts); RED only when enforcing.
  const acEnforce = !!facts.acEnforce;

  let decision = 'clear';
  if (unguardedSourceChanges.length) decision = worst(decision, 'needs_review');
  if (overridden.length || coverageRemovalOverridden || acOverridden.length) decision = worst(decision, 'overridden');
  if (acUndeclared) decision = worst(decision, acEnforce ? 'red_flag' : 'needs_review');
  if (loosenedUndeclared.length || removedUndeclared.length || skippedUndeclared.length ||
      newBehaviourNoTest.length || mismatchedOverride || trailers.rejected.length || coverageShrinkUndeclared) {
    decision = 'red_flag';
  }

  return {
    decision, behaviourFiles, checks,
    loosenedUndeclared, removedUndeclared, skippedUndeclared,
    newBehaviourNoTest, unguardedSourceChanges, overridden, mismatchedOverride,
    coverageShrink, coverageShrinkUndeclared, coverageRemovalOverridden,
    coverageRemovals: coverageRemovalOverridden ? trailers.coverageRemoved : [],
    coverageGuardCount: cov ? cov.headCount : null, coverageGuardCountBase: cov ? cov.baseCount : null,
    rejectedTrailers: trailers.rejected, coverageMapPresent: !!covMap,
    acMutated, acRetired, acMutatedUndeclared, acRetiredUndeclared, acOverridden, acEnforce,
  };
}

// ── git I/O → facts ─────────────────────────────────────────────────────────
function gather({ base, head, repoRoot }) {
  let changed = [];
  try { const o = git(['diff', '--name-only', `${base}..${head}`], repoRoot).trim(); changed = o ? o.split('\n').filter(Boolean) : []; } catch (_) {}
  let addedSet = new Set();
  try { const o = git(['diff', '--diff-filter=A', '--name-only', `${base}..${head}`], repoRoot).trim(); o.split('\n').filter(Boolean).forEach(f => addedSet.add(f)); } catch (_) {}

  const behaviourFiles = [], testFilesChanged = [];
  for (const f of changed) {
    const b = bucketOf(f);
    if (b === 'BEHAVIOUR') behaviourFiles.push({ path: f, area: /^dashboard\//.test(f) ? 'ui' : 'server', isNew: addedSet.has(f) });
    else if (b === 'TEST') testFilesChanged.push(f);
  }
  const checks = [];
  for (const tf of testFilesChanged) {
    let diff = ''; try { diff = git(['diff', `${base}..${head}`, '--', tf], repoRoot); } catch (_) { continue; }
    const byTag = classifyFileDiff(diff);
    for (const k of Object.keys(byTag)) {
      const e = byTag[k];
      const kind = (e.onPlus && !e.onMinus) ? 'added' : (e.onMinus && !e.onPlus) ? 'removed' : 'modified';
      // `rename` ({from,to}) rides along as a LABEL so the UI can say "renamed, not
      // removed". It never replaces the direction: a paired rename has already been
      // merged and re-classified upstream, so a rename that also weakened its
      // assertions arrives here as 'loosened' and still flags.
      // `name` is the check's TITLE as written in the file, carried for DISPLAY only
      // (slice 367: the merge dialog names a check the way its author wrote it, not by
      // its machine tag). decide() never reads it — nothing here changes a verdict.
      checks.push({ file: tf, tag: k, name: e.name || k, area: areaOf(tf), kind, direction: e.direction, rename: e.rename || null });
    }
  }
  let bodies = [];
  try { bodies = git(['log', '--format=%B%x00', `${base}..${head}`], repoRoot).split('\x00'); } catch (_) {}
  const trailers = parseTrailers(bodies);
  let covMap = null;
  try { covMap = JSON.parse(fs.readFileSync(path.join(repoRoot, 'regression', 'COVERAGE.lock'), 'utf8')); } catch (_) {}

  // Anti-shrink input: guard count of COVERAGE.lock at base vs head. Read each
  // side from its own commit so the comparison is against the promoted tree, not
  // the working copy. A missing base lock (first introduction) → no shrink claim.
  let coverage = null;
  const lockCountAt = (ref) => {
    try { return guardCountOf(JSON.parse(git(['show', `${ref}:regression/COVERAGE.lock`], repoRoot, true))); } catch (_) { return null; }
  };
  const baseCount = lockCountAt(base), headCount = lockCountAt(head);
  if (baseCount !== null && headCount !== null) coverage = { baseCount, headCount };

  // AC-MANIFEST.lock at base & head — read each from its own commit (the promoted tree),
  // same pattern as the coverage lock. A missing base manifest (first introduction) → all
  // head tags are "added", never AC-MUTATED.
  const manifestAt = (ref) => { try { return JSON.parse(git(['show', `${ref}:regression/AC-MANIFEST.lock`], repoRoot, true)); } catch (_) { return null; } };
  const acManifest = { base: manifestAt(base), head: manifestAt(head) };
  const acEnforce = process.env.AC_CUSTODY_ENFORCE === '1';

  return { behaviourFiles, checks, trailers, covMap, coverage, acManifest, acEnforce };
}

function guardCountOf(lock) {
  if (lock && typeof lock.guardCount === 'number') return lock.guardCount;
  const by = (lock && lock.bySource) || {};
  return Object.keys(by).reduce((n, k) => n + (by[k] ? by[k].length : 0), 0);
}

function classify({ base, head, repoRoot }) {
  const facts = gather({ base, head, repoRoot });
  return Object.assign({ base, head }, decide(facts));
}

module.exports = { classify, decide, gather, bucketOf, areaOf, parseTrailers, transitionFor, globToRe, corroborated, guardCountOf };

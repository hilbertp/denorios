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
  if (p === 'regression/COVERAGE.lock' || p === 'regression/COVERAGE.md') return 'BEHAVIOUR'; // gate's own backstop
  if (/^regression\//.test(p) || /^e2e\//.test(p) || /^test\//.test(p)) return 'TEST';
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
  const testsNotNeeded = [], loosenOk = [], coverageRemoved = [], rejected = [];
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
      }
    }
  }
  return { testsNotNeeded, loosenOk, coverageRemoved, rejected };
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
// facts = { behaviourFiles:[{path,area,isNew}], checks:[{file,tag,area,kind,direction}],
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
  const newBehaviourNoTest = behaviourFiles.filter(bf => bf.isNew && !notNeeded(bf.path) && !corroborated(bf.path, checks, covMap));
  const unguardedSourceChanges = behaviourFiles.filter(bf => !notNeeded(bf.path) && !corroborated(bf.path, checks, covMap));

  // Anti-shrink: the COVERAGE.lock guard count must never fall across the promoted
  // changeset unless a Coverage-Removed trailer declares the deletion on purpose.
  // Deleting a test to dodge corroboration is the same evasion as loosening one.
  const cov = facts.coverage || null;
  const coverageShrink = !!(cov && typeof cov.baseCount === 'number' && typeof cov.headCount === 'number' && cov.headCount < cov.baseCount);
  const coverageRemovalDeclared = (trailers.coverageRemoved || []).length > 0;
  const coverageShrinkUndeclared = coverageShrink && !coverageRemovalDeclared;
  const coverageRemovalOverridden = coverageShrink && coverageRemovalDeclared;

  let decision = 'clear';
  if (unguardedSourceChanges.length) decision = worst(decision, 'needs_review');
  if (overridden.length || coverageRemovalOverridden) decision = worst(decision, 'overridden');
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
      checks.push({ file: tf, tag: k, area: areaOf(tf), kind, direction: e.direction });
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

  return { behaviourFiles, checks, trailers, covMap, coverage };
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

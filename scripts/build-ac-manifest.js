#!/usr/bin/env node
'use strict';

// AC-MANIFEST.lock deriver — BUILD-1 of ADR-AC-RECONCILE.
//
// The missing source-of-truth: one entry per AC, KEYED BY THE LITERAL slice-N-ac-K tag
// (never derived from a brief's list position — tags are sparse/non-contiguous by design).
//
//  • Active entries come from each slice's `## Acceptance criteria` tagged lines
//    (parsed by lib/ac-block.js, authored by O'Brien). acHash = sha256 of the normalized
//    AC prose — the identity of the SPEC.
//  • Tags that have a guard in COVERAGE.lock but NO active AC block are seeded legacy:true
//    (grandfathered; text backfilled by a human from brief INTENT — never DONE reports —
//    Nog-reviewed; never hash-ratcheted until then). This is the live-tag-set keying the
//    ADR requires, and it is honestly RED-on-day-one for the ~54 brief-less slices.
//
// Pure over disk (no git, no clock) so the integrity meta-test can regenerate + deepEqual.
//
//   node scripts/build-ac-manifest.js           # write regression/AC-MANIFEST.lock
//   node scripts/build-ac-manifest.js --check    # exit 1 if the lock is stale

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseAcBlock } = require('../lib/ac-block');

// ADR §3: conservative normalization — trim + collapse runs of spaces/tabs ONLY.
// No case-fold, no markdown-strip, no stemming. A one-token flip MUST change the hash.
function normalizeAcText(text) {
  return String(text).replace(/[ \t]+/g, ' ').trim();
}
function acHashOf(text) {
  return 'sha256:' + crypto.createHash('sha256').update(normalizeAcText(text), 'utf8').digest('hex');
}

function sliceFiles(repoRoot) {
  // Only git-TRACKED slice files. bridge/queue/*.md and bridge/staged/*.md are gitignored
  // (local working records — 353 of 375 on-disk files are untracked), so a clean CI checkout
  // has only the committed subset. Sourcing an AC's text from an on-disk-but-untracked file
  // makes the manifest non-reproducible: the integrity gate (committed == fresh regeneration)
  // then passes locally and fails on CI. Consult git so the deriver sees exactly what a clean
  // checkout sees; a tag whose only source is untracked correctly falls back to legacy-backfill.
  const tracked = new Set();
  try {
    const { execFileSync } = require('child_process');
    const ls = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', 'bridge/queue', 'bridge/staged'], { encoding: 'utf8' });
    for (const rel of ls.split('\0')) if (rel.endsWith('.md')) tracked.add(rel);
  } catch (_) { /* not a git tree (e.g. a fixture) — fall through to none */ }
  const out = [];
  for (const d of ['queue', 'staged']) {
    const dir = path.join(repoRoot, 'bridge', d);
    let ents = [];
    try { ents = fs.readdirSync(dir); } catch (_) {}
    for (const f of ents) if (f.endsWith('.md') && tracked.has(`bridge/${d}/${f}`)) out.push(path.join(dir, f));
  }
  return out.sort();
}

// The live tag set: every tag that carries a guard in COVERAGE.lock.
function tagUniverse(repoRoot) {
  const tags = new Set();
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'regression', 'COVERAGE.lock'), 'utf8'));
    for (const src of Object.keys(lock.bySource || {})) {
      for (const e of lock.bySource[src]) tags.add(e.tag);
    }
  } catch (_) {}
  return tags;
}

function buildAcManifest(repoRoot) {
  const byTag = Object.create(null);

  // 1. Active entries authored in slice AC blocks.
  for (const file of sliceFiles(repoRoot)) {
    let content = '';
    try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    const parsed = parseAcBlock(content);
    if (!parsed.present || !parsed.acs.length) continue;
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const ac of parsed.acs) {
      byTag[ac.tag] = {
        slice: ac.slice,
        text: normalizeAcText(ac.text),
        acHash: acHashOf(ac.text),
        source: rel,
        status: 'active',
        legacy: false,
      };
    }
  }

  // 2. Legacy: a guarded tag with no authored AC block. Grandfathered, never ratcheted
  //    until a human backfills its text from brief intent (Nog-reviewed).
  for (const tag of tagUniverse(repoRoot)) {
    if (byTag[tag]) continue;
    const m = tag.match(/^slice-(\d+)-ac-\d+$/);
    byTag[tag] = {
      slice: m ? m[1] : null,
      text: null,
      acHash: null,
      source: 'legacy-backfill',
      status: 'active',
      legacy: true,
    };
  }

  const sortedTags = Object.keys(byTag).sort();
  const out = {};
  let legacyCount = 0;
  for (const t of sortedTags) { out[t] = byTag[t]; if (byTag[t].legacy) legacyCount++; }
  return { generator: 'scripts/build-ac-manifest.js', acCount: sortedTags.length, legacyCount, byTag: out };
}

function serialize(m) { return JSON.stringify(m, null, 2) + '\n'; }

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const lockPath = path.join(repoRoot, 'regression', 'AC-MANIFEST.lock');
  const next = serialize(buildAcManifest(repoRoot));
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = fs.readFileSync(lockPath, 'utf8'); } catch (_) {}
    if (cur !== next) {
      console.error('AC-MANIFEST.lock is STALE — run: node scripts/build-ac-manifest.js');
      process.exit(1);
    }
    const m = JSON.parse(next);
    console.log(`AC-MANIFEST.lock up to date (${m.acCount} tags, ${m.legacyCount} legacy).`);
    return;
  }
  fs.writeFileSync(lockPath, next);
  const m = JSON.parse(next);
  console.log(`Wrote regression/AC-MANIFEST.lock — ${m.acCount} tags (${m.legacyCount} legacy, ${m.acCount - m.legacyCount} active).`);
}

module.exports = { buildAcManifest, normalizeAcText, acHashOf, serialize };

if (require.main === module) main();

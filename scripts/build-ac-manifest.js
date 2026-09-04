#!/usr/bin/env node
'use strict';

// AC-MANIFEST.lock deriver — BUILD-1 of ADR-AC-RECONCILE.
//
// The missing source-of-truth: one entry per AC, KEYED BY THE LITERAL slice-N-ac-K tag
// (never derived from a brief's list position — tags are sparse/non-contiguous by design).
//
//  • Criterion TEXT comes from the `AC: slice-N-ac-K: <text>` commit trailers in history —
//    immutable, and the same declaration lib/ac-range-scan.js already feeds the CHECK gate.
//    acHash = sha256 of the normalized AC prose — the identity of the SPEC.
//  • A slice's `## Acceptance criteria` tagged lines (parsed by lib/ac-block.js, authored by
//    O'Brien) say WHICH criteria that slice put live, and are the text FALLBACK for criteria
//    that carry no trailer yet. Read out of the git INDEX, not off disk (the tree is a
//    last resort that announces itself) — see below.
//  • Tags that have a guard in COVERAGE.lock but no slice file to declare them stay legacy:true
//    (grandfathered; never hash-ratcheted until a human backfills them from brief intent,
//    Nog-reviewed — docs/contracts/ac-custody.md). This is the live-tag-set keying the ADR
//    requires. History carries trailers for 38 of them; draining those is that human's call,
//    not a side effect of this deriver.
//
// WHY NEITHER HALF READS THE WORKING TREE: bridge/queue/*.md are gitignored and force-added,
// and the orchestrator moves them by itself — archiveAcceptedSlice renames {id}-DONE.md to
// {id}-ARCHIVED.md WITHOUT telling git, and archiveSiblingStateFiles moves it out to
// bridge/trash/ on every terminal transition. Git keeps tracking the vanished name and ignores
// the one that now exists, so a deriver that reads the tree finds no source and silently
// degrades those criteria to unhashed legacy — losing the tamper ratchet that makes an AC mean
// anything. It failed the gate four times on 2026-09-04, and the tempting fix each time
// (regenerate + commit) blesses the loss permanently. Permanent data must not be derived from
// transient working files: a commit trailer is beyond their reach, and so is the git index.
//
// Pure over the repo (git index + git history, no clock) so the integrity meta-test can
// regenerate + deepEqual. Reading the index rather than the tree is also what makes the lock
// reproducible on CI, whose checkout has index == HEAD by construction; locally it means an
// edit to a tracked slice file counts once it is staged, not before.
// `gitLog` is injectable so the trailer half is testable without a repo.
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

// The slice id a queue/staged filename carries, normalized so 075 and 75 are one slice.
function sliceIdOf(name) {
  const m = String(name).match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)) : null;
}

// The STAGED content of each path, in one `git cat-file --batch` — the bytes a clean checkout
// would hold, which is the whole point: `git ls-files` already enumerated the index, so the
// content comes from the index too. Renaming, archiving or deleting the working file leaves
// the index blob exactly where it was.
//
// Batch output per request is a header line, then the blob, then a newline:
//   <sha> blob <size>\n<size bytes>\n     a path git can resolve
//   <rev> missing\n                       one it cannot (never expected from ls-files output)
// The header carries the byte length, so the blob is sliced out of a Buffer rather than
// scanned — content that itself contains newlines cannot desync the walk.
function indexBlobs(repoRoot, rels) {
  const byRel = new Map();
  if (!rels.length) return byRel;
  const { execFileSync } = require('child_process');
  // No `encoding`: execFileSync then hands back stdout as a Buffer, which is what the
  // byte-offset walk below needs. (`encoding: 'buffer'` is a spawnSync spelling; execFileSync
  // validates it as a string encoding and throws "Unknown encoding".)
  const buf = execFileSync('git', ['-C', repoRoot, 'cat-file', '--batch'], {
    input: rels.map((rel) => `:${rel}`).join('\n') + '\n',
    timeout: 30000, maxBuffer: 64 * 1024 * 1024,
  });
  let at = 0;
  for (const rel of rels) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const m = /^\S+ blob (\d+)$/.exec(buf.toString('utf8', at, nl));
    if (!m) { at = nl + 1; continue; }
    const size = Number(m[1]);
    byRel.set(rel, buf.toString('utf8', nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return byRel;
}

// Every git-TRACKED slice file, read as git holds it.
//
// bridge/queue/*.md and bridge/staged/*.md are gitignored (local working records — 353 of
// 375 on-disk files are untracked), so a clean CI checkout has only the committed subset.
// Sourcing an AC's text from an on-disk-but-untracked file makes the manifest
// non-reproducible: the integrity gate (committed == fresh regeneration) then passes locally
// and fails on CI. Consult git so the deriver sees exactly what a clean checkout sees.
//
// The tree is a LAST RESORT, reached only if the batch read fails wholesale (git absent, and
// then ls-files returned nothing anyway). It never outranks the index: a criterion that has
// no trailer is sourced from its slice file, and reading that file off disk is precisely the
// archive-rename failure — 34 of the 40 active criteria were repaired by trailers, and the
// remaining 6 still went 198 → 204 legacy on an archive until this read moved to the index.
function trackedSliceFiles(repoRoot) {
  const rels = [];
  try {
    const { execFileSync } = require('child_process');
    const ls = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', 'bridge/queue', 'bridge/staged'], { encoding: 'utf8' });
    for (const rel of ls.split('\0')) if (rel.endsWith('.md')) rels.push(rel);
  } catch (_) { /* not a git tree (e.g. a fixture) — fall through to none */ }
  rels.sort();

  let staged = new Map();
  try { staged = indexBlobs(repoRoot, rels); } catch (e) {
    // Never silent. ls-files answered, so git works and this should not happen; falling back
    // to the tree is what re-exposes the archive rename, and a fallback nobody sees is how a
    // criterion degrades unnoticed — the failure mode this whole deriver exists to close.
    console.error(`build-ac-manifest: index read failed (${e.message}) — falling back to the working tree.`);
  }

  return rels.map((rel) => {
    let content = staged.has(rel) ? staged.get(rel) : null;
    if (content === null) {
      try { content = fs.readFileSync(path.join(repoRoot, rel.split('/').join(path.sep)), 'utf8'); } catch (_) {}
    }
    return { rel, content, sliceId: sliceIdOf(path.basename(rel)) };
  });
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

// Every commit reachable from HEAD. Not a two-dot range: the manifest is the PERMANENT
// record of every live criterion, most of them declared long before the pending merge
// window the CHECK gate scans.
const TRAILER_RANGE = 'HEAD';

// --reverse = OLDEST-first, because ac-range-scan's dedup is last-writer-wins: oldest-first
// makes "last" the NEWEST declaration, so an AMENDED criterion resolves to its current text.
// git's default (newest-first) inverts it and an amendment resolves to the text it superseded
// — the j-ac-amend-order bug, in a file that is committed and ratcheted against.
function defaultGitLog(repoRoot) {
  const { execFileSync } = require('child_process');
  return (range) => execFileSync('git', ['log', range, '--reverse', '--format=%B'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
}

// { tag: { text, acHash } } for every `AC:` trailer in history, newest declaration winning.
function trailerTexts(repoRoot, gitLog) {
  // Required lazily: lib/ac-range-scan reads acHashOf out of THIS module, so a top-level
  // require would destructure a half-initialised module.exports and get undefined.
  const { scanRangeManifest } = require('../lib/ac-range-scan');
  return scanRangeManifest({ gitLog: gitLog || defaultGitLog(repoRoot), range: TRAILER_RANGE }).byTag;
}

function buildAcManifest(repoRoot, { gitLog } = {}) {
  const byTag = Object.create(null);

  // 1. Membership + FALLBACK text: the criteria authored in tracked slice AC blocks. A
  //    tracked path neither the index NOR the tree can produce is unreadable, not archived,
  //    so its slice is noted as one history must answer for instead (step 3).
  const orphanedSlices = new Set();
  for (const file of trackedSliceFiles(repoRoot)) {
    if (file.content === null) { if (file.sliceId) orphanedSlices.add(file.sliceId); continue; }
    const parsed = parseAcBlock(file.content);
    if (!parsed.present || !parsed.acs.length) continue;
    for (const ac of parsed.acs) {
      byTag[ac.tag] = {
        slice: ac.slice,
        text: normalizeAcText(ac.text),
        acHash: acHashOf(ac.text),
        source: file.rel,
        status: 'active',
        legacy: false,
      };
    }
  }

  // 2. Membership: a guarded tag with no authored AC block. Legacy until a source speaks
  //    for it; grandfathered and never hash-ratcheted while it has none.
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

  // 3. The immutable source wins. Two rules keep this a repair rather than a rewrite:
  //
  //    • A trailer only ever REPLACES the text of a tag the universe above already holds —
  //      it never ADDS one. History also carries criteria that were later retired
  //      (slice-372-ac-9 is declared by a trailer and guarded by nothing); resurrecting
  //      those from the log would silently undo a human's decision.
  //    • A grandfathered legacy tag is only spoken for when its slice is one history has to
  //      answer for — a tracked file git itself could not produce. Otherwise legacy stays
  //      legacy: draining the allowlist is a human backfill against brief intent, Nog-reviewed
  //      (docs/contracts/ac-custody.md), not something a deriver does on its own.
  for (const [tag, t] of Object.entries(trailerTexts(repoRoot, gitLog))) {
    const cur = byTag[tag];
    if (!cur) continue;
    if (cur.legacy && !orphanedSlices.has(sliceIdOf(tag))) continue;
    byTag[tag] = {
      slice: cur.slice,
      text: normalizeAcText(t.text),
      acHash: t.acHash,
      source: 'commit-trailer',
      status: 'active',
      legacy: false,
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

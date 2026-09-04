'use strict';

// J-ac-manifest-trailer-source — the AC manifest reads criterion text from commit
// trailers, not from working files (slice 379).
//
// bridge/queue/*.md are gitignored and force-added, and archiveAcceptedSlice renames
// {id}-DONE.md to {id}-ARCHIVED.md on disk without telling git. Git then tracks a name
// that is gone and ignores the one that exists, the deriver finds no source, and the
// criteria fall to unhashed legacy — the tamper ratchet quietly dropped. Four gate
// failures in one evening, each one hand-fixed, and the tempting fix (regenerate and
// commit) makes it permanent. `AC: slice-N-ac-K: <text>` trailers are history; no
// rename, archive or delete can reach them.
//
// @ac-hash: slice-379-ac-1 sha256:8dd1883e49fa0fd5a37acd536aebffe580303172f57de744ee63f9ff8e8c5687
// @ac-hash: slice-379-ac-2 sha256:7e0434a4b9f94c61c9bacf1163e9e62f62802818c84532f2e97771b2d9c48937
// @ac-hash: slice-379-ac-3 sha256:89a49d6b5d91e31bba03666d386f2e3939b53b213c3327886d680abab97fb750
// @ac-hash: slice-379-ac-4 sha256:91b66583b30f7f61296131874031f46324632b7401b60d4cb8838f99ee765724
// @ac-hash: slice-379-ac-5 sha256:80a2be997538d1e071cdb54efdb5d487adc525909c991a3801ae2089b5a9cd80

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_SRC = path.resolve(REPO_ROOT, 'scripts', 'build-ac-manifest.js');
const MANIFEST_LOCK = path.resolve(REPO_ROOT, 'regression', 'AC-MANIFEST.lock');
const { buildAcManifest, acHashOf, serialize } = require(MANIFEST_SRC);

// ── fixtures ────────────────────────────────────────────────────────────────
//
// A throwaway repo, never the live one: the deriver's file half consults `git ls-files`,
// so a plain temp directory would show no slice files at all and the "file present vs
// file gone" comparisons would pass for the wrong reason.

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const QUEUE = ['bridge', 'queue'];

// files: { '<name>.md': [ '<tag>: <text>', ... ] } force-added to bridge/queue exactly the
// way the orchestrator commits a report; guards: the tags carrying a COVERAGE.lock guard,
// which is the membership universe.
function makeRepo({ files = {}, guards = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-trailer-'));
  fs.mkdirSync(path.join(root, ...QUEUE), { recursive: true });
  fs.mkdirSync(path.join(root, 'regression'), { recursive: true });
  git(['init', '-q', '-b', 'main'], root);
  git(['config', 'user.email', 't@t.co'], root);
  git(['config', 'user.name', 'Test'], root);
  for (const [name, acs] of Object.entries(files)) {
    const body = `# a slice\n\n## Acceptance criteria\n\n${acs.map(l => `- ${l}`).join('\n')}\n\n## Traps\n`;
    fs.writeFileSync(path.join(root, ...QUEUE, name), body);
    git(['add', '-f', `bridge/queue/${name}`], root);
  }
  const bySource = { 'dashboard/server.js': guards.map(tag => ({ tag })) };
  fs.writeFileSync(path.join(root, 'regression', 'COVERAGE.lock'), JSON.stringify({ bySource }, null, 2));
  return root;
}

const rmRepo = (root) => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} };
const queued = (root, name) => path.join(root, ...QUEUE, name);

// A gitLog stub: the concatenated commit bodies the deriver would get, OLDEST-first.
const logOf = (...bodies) => () => bodies.join('\n\n');

// ── acceptance criteria ─────────────────────────────────────────────────────

test('slice-379-ac-1 criterion text comes from the commit trailer, not from the working file', () => {
  const root = makeRepo({
    files: { '500-DONE.md': ['slice-500-ac-1: text that lives in a renameable working file'] },
    guards: ['slice-500-ac-1'],
  });
  try {
    const m = buildAcManifest(root, { gitLog: logOf('S500: land it\n\nAC: slice-500-ac-1: text that lives in immutable history') });
    const e = m.byTag['slice-500-ac-1'];
    assert.equal(e.text, 'text that lives in immutable history', 'history outranks the working file');
    assert.equal(e.source, 'commit-trailer');
    assert.equal(e.legacy, false);
    assert.equal(e.acHash, acHashOf('text that lives in immutable history'),
      'the hash ratchets against the criterion history declares, not the one the file happens to hold');
  } finally { rmRepo(root); }
});

test('slice-379-ac-2 archiving, renaming or deleting the queue file leaves the manifest unchanged', () => {
  // TWO slices, because the trailer alone does not carry this criterion. 500 has a trailer;
  // 501 has none, which is the live shape of slice 340 — six criteria whose only source is
  // their tracked file. Those are the ones a working-tree read still degraded (198 → 204)
  // after the trailer half was in place, so the archive cases below must cover both.
  const root = makeRepo({
    files: {
      '500-DONE.md': ['slice-500-ac-1: the criterion as its slice declared it'],
      '501-DONE.md': ['slice-501-ac-1: a criterion no commit trailer speaks for'],
    },
    guards: ['slice-500-ac-1', 'slice-501-ac-1'],
  });
  try {
    const gitLog = logOf('S500: land it\n\nAC: slice-500-ac-1: the criterion as its slice declared it');
    const before = buildAcManifest(root, { gitLog });
    assert.equal(before.legacyCount, 0, 'both criteria start sourced and hash-ratcheted');
    assert.equal(before.byTag['slice-500-ac-1'].source, 'commit-trailer');
    assert.equal(before.byTag['slice-501-ac-1'].source, 'bridge/queue/501-DONE.md',
      'the trailer-less criterion is file-sourced — the case this test exists for');

    const stillUnmoved = (why) => {
      const now = buildAcManifest(root, { gitLog });
      assert.deepEqual(now, before, why);
      assert.equal(now.legacyCount, before.legacyCount, `legacy must not grow: ${why}`);
    };

    // archiveAcceptedSlice, verbatim: rename on disk, tell git nothing. Git keeps tracking
    // {id}-DONE.md (now absent) and ignores {id}-ARCHIVED.md (untracked) — the exact failure.
    for (const id of ['500', '501']) fs.renameSync(queued(root, `${id}-DONE.md`), queued(root, `${id}-ARCHIVED.md`));
    stillUnmoved('an archive rename must not move a criterion to legacy');

    // archiveSiblingStateFiles, verbatim: moved clean out of bridge/queue into gitignored
    // scratch. This one fires on EVERY terminal transition, not just on acceptance.
    fs.mkdirSync(path.join(root, 'bridge', 'trash'), { recursive: true });
    for (const id of ['500', '501']) {
      fs.renameSync(queued(root, `${id}-ARCHIVED.md`), path.join(root, 'bridge', 'trash', `${id}-DONE.md.cleanup-1`));
    }
    stillUnmoved('moving the file out of bridge/queue must not move a criterion to legacy');

    // ... and the hardest case: the working tree does not hold the file at all any more.
    for (const id of ['500', '501']) fs.rmSync(path.join(root, 'bridge', 'trash', `${id}-DONE.md.cleanup-1`));
    stillUnmoved('a deleted working file must not move a criterion to legacy');
  } finally { rmRepo(root); }
});

test('slice-379-ac-3 every criterion active today stays active, and the legacy count does not grow', () => {
  // Two slices, the two shapes the live manifest is made of: 500 put its criterion live
  // through a tracked file, 600 is one of the ~198 grandfathered tags that only ever had a
  // guard. Both carry a trailer.
  const root = makeRepo({
    files: { '500-DONE.md': ['slice-500-ac-1: the criterion its slice declared'] },
    guards: ['slice-500-ac-1', 'slice-600-ac-1'],
  });
  try {
    const gitLog = logOf([
      'S500: land it', '', 'AC: slice-500-ac-1: the criterion its slice declared', '',
      'AC: slice-600-ac-1: a criterion from a slice that never committed a file',
    ].join('\n'));
    const before = buildAcManifest(root, { gitLog });
    assert.equal(before.byTag['slice-500-ac-1'].legacy, false);
    assert.equal(before.byTag['slice-600-ac-1'].legacy, true,
      'a grandfathered tag stays grandfathered — draining it is a human backfill against brief '
      + 'intent, Nog-reviewed (docs/contracts/ac-custody.md), not a deriver side effect');

    fs.renameSync(queued(root, '500-DONE.md'), queued(root, '500-ARCHIVED.md'));
    const after = buildAcManifest(root, { gitLog });
    assert.equal(after.byTag['slice-500-ac-1'].legacy, false, 'a criterion active before the archive is active after it');
    assert.equal(after.acCount, before.acCount, 'the tag universe does not move');
    assert.ok(after.legacyCount <= before.legacyCount, `legacy must not grow: ${before.legacyCount} → ${after.legacyCount}`);
  } finally { rmRepo(root); }

  // And on the live repo: denying the deriver history is the file-only deriver this slice
  // replaces — nothing that resolved as active under it may stop resolving.
  const noHistory = buildAcManifest(REPO_ROOT, { gitLog: () => { throw new Error('no git history'); } });
  const withHistory = buildAcManifest(REPO_ROOT);
  const activeOf = (m) => Object.entries(m.byTag).filter(([, e]) => !e.legacy).map(([t]) => t);
  const after = new Set(activeOf(withHistory));
  for (const tag of activeOf(noHistory)) assert.ok(after.has(tag), `${tag} resolved as active before and must still resolve as active`);
  assert.equal(withHistory.acCount, noHistory.acCount, 'the tag universe is unchanged — only where the text comes from moved');
  assert.ok(withHistory.legacyCount <= noHistory.legacyCount,
    `legacy must not grow: ${noHistory.legacyCount} → ${withHistory.legacyCount}`);
});

test('slice-379-ac-4 a criterion amended across commits resolves to the newest declaration', () => {
  const root = makeRepo({
    files: { '500-DONE.md': ['slice-500-ac-1: the text the working file still holds'] },
    guards: ['slice-500-ac-1'],
  });
  try {
    // Fed oldest-first, as the deriver's own git log feeds it.
    const m = buildAcManifest(root, {
      gitLog: logOf(
        'S500: land it\n\nAC: slice-500-ac-1: OLD superseded text',
        'S500b: amend it\n\nAC: slice-500-ac-1: NEW amended text',
      ),
    });
    assert.equal(m.byTag['slice-500-ac-1'].text, 'NEW amended text');
    assert.equal(m.byTag['slice-500-ac-1'].acHash, acHashOf('NEW amended text'),
      'the ratchet follows the amendment; resolving to the superseded text would false-green it');
  } finally { rmRepo(root); }
});

test('slice-379-ac-5 the manifest integrity and determinism guards still pass', () => {
  assert.equal(fs.readFileSync(MANIFEST_LOCK, 'utf8'), serialize(buildAcManifest(REPO_ROOT)),
    'AC-MANIFEST.lock is stale — run: node scripts/build-ac-manifest.js');
  // git is an input now, so determinism has a new way to break: two reads of the same
  // history must still land byte-identical.
  assert.deepEqual(buildAcManifest(REPO_ROOT), buildAcManifest(REPO_ROOT));
});

// ── traps ───────────────────────────────────────────────────────────────────

test('J-ac-manifest-trailer-source — trap 1: the deriver reads history oldest-first, like the existing scanner', () => {
  // No injected gitLog: this exercises the deriver's OWN git invocation against a real
  // repo. Drop --reverse and last-writer-wins lands on the superseded text instead.
  const root = makeRepo({
    files: { '500-DONE.md': ['slice-500-ac-1: the text the working file still holds'] },
    guards: ['slice-500-ac-1'],
  });
  try {
    const g = (args) => git(args, root);
    g(['add', '-A']);
    fs.writeFileSync(path.join(root, '.m1'), 'S500: land it\n\nAC: slice-500-ac-1: OLD superseded text');
    g(['commit', '-qF', '.m1']);
    fs.writeFileSync(path.join(root, 'b'), '1');
    g(['add', '-A']);
    fs.writeFileSync(path.join(root, '.m2'), 'S500b: amend it\n\nAC: slice-500-ac-1: NEW amended text');
    g(['commit', '-qF', '.m2']);

    assert.equal(buildAcManifest(root).byTag['slice-500-ac-1'].text, 'NEW amended text',
      'the deriver must pass --reverse; newest-first resolves an amendment to the text it superseded');

    // The behavioural check above is the guard: drop the flag and it lands on the superseded
    // text. This read is deliberately NOT a second copy of it — matching the exact argv
    // spelling (`'log', range, '--reverse'`) would go red on any rewrite that builds the same
    // arguments differently. It stays because a readFileSync of a source file is how
    // build-coverage-map registers WHICH source a tag guards; without it all five slice-379
    // tags fall out of COVERAGE.lock and the gate stops corroborating this file at all.
    assert.match(fs.readFileSync(MANIFEST_SRC, 'utf8'), /--reverse/,
      'the deriver states the oldest-first ordering contract it shares with lib/ac-range-scan');
  } finally { rmRepo(root); }
});

test('J-ac-manifest-trailer-source — trap 2: the slice-N-ac-K tag grammar is untouched', () => {
  const root = makeRepo({
    files: { '500-DONE.md': ['slice-500-ac-1: placeholder', 'slice-500-ac-12: placeholder'] },
    guards: ['slice-500-ac-1', 'slice-500-ac-12'],
  });
  try {
    const m = buildAcManifest(root, {
      gitLog: logOf([
        'S500: land it', '',
        'AC: slice-500-ac-1: a well-formed tag is read',
        'AC: slice-500-ac-12: a multi-digit index is read',
        'AC: slice-500-1: a tag off the grammar is not',
        'AC: s500ac1: nor this one',
      ].join('\n')),
    });
    assert.equal(m.byTag['slice-500-ac-1'].text, 'a well-formed tag is read');
    assert.equal(m.byTag['slice-500-ac-12'].text, 'a multi-digit index is read');
    for (const tag of Object.keys(m.byTag)) assert.match(tag, /^slice-\d+-ac-\d+$/, `${tag} keeps the fixed grammar`);
    assert.equal(m.acCount, 2, 'nothing off the grammar leaks into the manifest');
  } finally { rmRepo(root); }
});

test('J-ac-manifest-trailer-source — trap 3: a regeneration cannot launder a lost source into legacy', () => {
  // The trap is the one-command "fix": regenerate, commit, gate goes green, and the
  // criterion is permanently unhashed. A regeneration must only be able to degrade a
  // criterion when NO source is left — never merely because its working file moved.
  const root = makeRepo({
    files: { '500-DONE.md': ['slice-500-ac-1: the criterion its slice declared'] },
    guards: ['slice-500-ac-1'],
  });
  try {
    // The working file is gone, and NO trailer speaks for the tag. Under a working-tree
    // deriver that is a total loss; here the index still holds the blob, so it is not.
    fs.rmSync(queued(root, '500-DONE.md'));

    const sourced = buildAcManifest(root, { gitLog: logOf('S500: land it, with no AC trailer at all') });
    assert.equal(sourced.legacyCount, 0, 'the index still speaks for it — regenerating must not bless the loss');
    assert.equal(sourced.byTag['slice-500-ac-1'].acHash, acHashOf('the criterion its slice declared'),
      'the tamper ratchet survives the regeneration');

    // Now genuinely lost: dropped from the index too, so no source of any kind is left.
    // Only THIS may degrade a criterion — and it must be counted, never guessed at.
    git(['rm', '-q', '--cached', 'bridge/queue/500-DONE.md'], root);
    const unsourced = buildAcManifest(root, { gitLog: logOf('S500: land it, with no AC trailer at all') });
    const e = unsourced.byTag['slice-500-ac-1'];
    assert.equal(e.legacy, true);
    assert.equal(e.text, null, 'a genuinely lost source is recorded as lost, never guessed at');
    assert.equal(e.acHash, null, 'an unsourced criterion is never hash-ratcheted');
    assert.equal(unsourced.legacyCount, 1, 'the loss is counted, so it cannot pass unnoticed');
  } finally { rmRepo(root); }
});

test('J-ac-manifest-trailer-source — trap 4: trailers never resurrect a retired criterion', () => {
  const root = makeRepo({
    files: { '500-DONE.md': ['slice-500-ac-1: placeholder'] },
    guards: ['slice-500-ac-1'],
  });
  try {
    const m = buildAcManifest(root, {
      gitLog: logOf('S500: land it\n\nAC: slice-500-ac-1: a live criterion\nAC: slice-500-ac-9: a criterion its slice later retired'),
    });
    // Paired on purpose: the same log that must NOT bring ac-9 back must still speak for
    // ac-1, so the trap cannot pass by the deriver simply ignoring history.
    assert.equal(m.byTag['slice-500-ac-1'].text, 'a live criterion', 'a criterion in the universe takes its text from history');
    assert.equal(m.byTag['slice-500-ac-9'], undefined, 'history does not put a retired criterion back in the manifest');
    assert.equal(m.acCount, 1);
  } finally { rmRepo(root); }

  // And on the live repo: slice-372-ac-9 is declared by a real trailer and was struck from
  // its slice's block; ac-7 and ac-8 were retired in the block itself.
  const live = buildAcManifest(REPO_ROOT);
  for (const tag of ['slice-372-ac-7', 'slice-372-ac-8', 'slice-372-ac-9']) {
    assert.equal(live.byTag[tag], undefined, `${tag} was retired and must stay retired`);
  }
  assert.ok(live.byTag['slice-372-ac-6'], "slice 372's live criteria are unaffected");
});

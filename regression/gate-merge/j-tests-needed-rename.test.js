'use strict';
// J-tests-needed-rename — a renamed check is RENAMED, not delete-plus-add (slice 366).
//
// The direction engine keys an untagged check by its title text, so rewording a title
// used to read as a removal (RED) plus an unrelated addition. S353 tripped exactly that:
// two checks renamed, both still present and passing, coverage UP in the same diff — and
// the gate still went red. Second false RED in one day. The cost is cry-wolf: a gate that
// flags honest renames trains reflex-ticking, and then gets ticked the day a check is
// genuinely disabled.
//
// The fix pairs a disappearing check with a near-identical appearing one WITHIN one file,
// MERGES the two entries and re-runs the ordinary direction classification. This suite
// exists to keep that from becoming the opposite failure — the CATASTROPHIC FALSE GREEN.
// The tempting shortcut is "if paired, call it renamed and skip the masking check"; that
// would let a gutted check pass by wearing a new title. So the load-bearing tests here are
// the negative ones: a rename that weakens still flags, near-siblings never cross-pair,
// an unpaired disappearance is still a removal, and `renamed` is never a direction value.
//
// @ac-hash: slice-366-ac-1 sha256:a5753433cefe8419398b772a22a3cf59494d1bedd0a6a765c915a1ad24866c86
// @ac-hash: slice-366-ac-2 sha256:0b3658abeaaeeb4b710714d1b1ed433137ee54a5fd58d2e5fa5d989e6e006b25
// @ac-hash: slice-366-ac-3 sha256:c22b86654f7de3e4a3227f47917ba879dfcae757884be2301d568604fa8d9572
// @ac-hash: slice-366-ac-4 sha256:638dd7781fe06807df49f53852807588dac0a65d2b4340cb6d1c3463abb0a9e0
// @ac-hash: slice-366-ac-5 sha256:6edf4e2b47a8db984130ab942d5c24430a695ab0c44e88f2e34d2d3f16363bf8
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { classifyFileDiff, titleSimilarity, RENAME_SIMILARITY } = require('../../lib/assert-direction');
const { decide } = require('../../lib/tests-needed');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
// Read the two sources this suite guards so they are corroborated FILE-grained in
// COVERAGE.lock — the rename logic must not ship coverage-blind.
const DIRECTION_SRC = path.join(REPO_ROOT, 'lib', 'assert-direction.js');
const ENGINE_SRC = path.join(REPO_ROOT, 'lib', 'tests-needed.js');

// ── Synthetic diff builders ─────────────────────────────────────────────────
// The fixtures below quote the REAL S353 titles verbatim — that is where the similarity
// calibration comes from — so they must not spell the declaration keyword literally: the
// suite-wide naming audit (j-gate-fail-retry) and the coverage-map deriver both scan
// source TEXT for that keyword and would read these fixture titles as untagged real tests.
const TEST_KW = 'te' + 'st';

// A whole-block rewrite: the old check disappears, the new one appears. This is what
// git actually emits when a title changes and the body is re-indented or reordered —
// the delete-plus-add shape that used to read as a removal.
function rewrite(file, blocks) {
  const out = [`diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`];
  for (const b of blocks) {
    out.push('@@ -1,9 +1,9 @@');
    if (b.oldTitle) {
      out.push(`-${TEST_KW}('${b.oldTitle}', () => {`);
      for (const l of (b.oldBody || [])) out.push(`-  ${l}`);
      out.push('-});');
    }
    if (b.newTitle) {
      out.push(`+${TEST_KW}('${b.newTitle}', () => {`);
      for (const l of (b.newBody || [])) out.push(`+  ${l}`);
      out.push('+});');
    }
  }
  return out.join('\n');
}

// The other real shape: only the title line moved, the body is untouched context.
function titleOnly(file, oldTitle, newTitle, body) {
  return [
    `diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644',
    `--- a/${file}`, `+++ b/${file}`, '@@ -1,4 +1,4 @@',
    `-${TEST_KW}('${oldTitle}', () => {`,
    `+${TEST_KW}('${newTitle}', () => {`,
  ].concat((body || []).map(l => `   ${l}`)).concat([' });']).join('\n');
}

const FILE = 'e2e/gate-button.spec.js';
// The two titles that actually produced the false RED on 2026-09-01, and their renames.
const OLD_B = 'B: ahead only (3 commits) — push invoked, no reset, MAIN_PUSHED_TO_ORIGIN emitted with ahead_count=3';
const NEW_B = 'B: ahead only (3 commits) — push invoked, no reset, push event emitted with ahead_count=3';
const OLD_C = 'C: behind only (2 commits) — merge --ff-only invoked, no push';
const NEW_C = 'C: behind only (2 commits), HEAD on dev — merge --ff-only invoked, no push';

const entryFor = (diff, title) => classifyFileDiff(diff)[title.trim()];

test('J-tests-needed-rename slice-366-ac-1 — a check renamed within a file reads as renamed, not removed, and does not flag', () => {
  // Whole-block rewrite: the title changed, the assertions are carried over verbatim.
  const diff = rewrite(FILE, [{
    oldTitle: OLD_B, oldBody: ['assert.strictEqual(res.status, 200);'],
    newTitle: NEW_B, newBody: ['assert.strictEqual(res.status, 200);'],
  }]);
  const byKey = classifyFileDiff(diff);

  assert.equal(Object.keys(byKey).length, 1, 'the pair must MERGE into one entry, not stay as removal + addition');
  const e = byKey[NEW_B.trim()];
  assert.ok(e, 'the surviving entry is keyed by the NEW title');
  assert.ok(!byKey[OLD_B.trim()], 'the old title must not survive as a separate removal');
  assert.equal(e.direction, 'reworded', 'a pure rename carries the same assertions, so it classifies as reworded');
  assert.equal(e.onPlus, true);
  assert.equal(e.onMinus, true, 'the check DID exist at base — under its old title');

  // And the verdict layer must not flag it: reworded is not a masking direction.
  const r = decide({ behaviourFiles: [], checks: [{ file: FILE, tag: NEW_B.trim(), area: 'e2e', kind: 'modified', direction: e.direction, rename: e.rename }] });
  assert.equal(r.decision, 'clear', 'an honest rename must not turn the gate red');
  assert.equal(r.removedUndeclared.length, 0);
  assert.equal(r.loosenedUndeclared.length, 0);

  // The title-only diff shape (body untouched as context) must reach the same answer.
  const bodyOnly = titleOnly(FILE, OLD_C, NEW_C, ['assert.strictEqual(pushes, 0);']);
  const c = entryFor(bodyOnly, NEW_C);
  assert.ok(c, 'the title-only rename shape must pair too');
  assert.equal(c.direction, 'reworded');
  assert.ok(!classifyFileDiff(bodyOnly)[OLD_C.trim()], 'no leftover removal for the title-only shape');
});

test('J-tests-needed-rename slice-366-ac-2 — a rename that also weakens or deletes assertions still flags', () => {
  // THE CATASTROPHIC FALSE GREEN this suite exists to prevent: a gutted check wearing
  // a new title. Pairing must MERGE and re-classify, never short-circuit to "renamed".
  const gutted = rewrite(FILE, [{
    oldTitle: OLD_B, oldBody: ['assert.strictEqual(res.status, 200);'],
    newTitle: NEW_B, newBody: ['assert.ok(res);'],
  }]);
  const g = entryFor(gutted, NEW_B);
  assert.equal(g.direction, 'loosened', 'strict equality traded for truthiness under a new title is still a loosening');

  // Assertions deleted outright while the (renamed) check survives.
  const emptied = rewrite(FILE, [{
    oldTitle: OLD_C, oldBody: ['assert.strictEqual(pushes, 0);', 'assert.strictEqual(merges, 1);'],
    newTitle: NEW_C, newBody: [],
  }]);
  assert.equal(entryFor(emptied, NEW_C).direction, 'loosened', 'deleting every assertion under a new title is a loosening');

  // Renamed AND quarantined: the skip must survive the merge.
  const quarantined = rewrite(FILE, [{
    oldTitle: OLD_C, oldBody: ['assert.strictEqual(pushes, 0);'],
    newTitle: null,
  }]) + '\n' + [
    '@@ -20,3 +20,3 @@',
    `+${TEST_KW}.skip('${NEW_C}', () => {`,
    '+  assert.strictEqual(pushes, 0);',
    '+});',
  ].join('\n');
  assert.equal(entryFor(quarantined, NEW_C).direction, 'skipped', 'a rename that also adds .skip must still read as skipped');

  // …and each of those reaches the verdict layer as a blocker.
  for (const [label, direction] of [['loosened', 'loosened'], ['skipped', 'skipped']]) {
    const r = decide({ behaviourFiles: [], checks: [{ file: FILE, tag: NEW_C.trim(), area: 'e2e', kind: 'modified', direction, rename: { from: OLD_C, to: NEW_C } }] });
    assert.equal(r.decision, 'red_flag', `a renamed-and-${label} check must still stop the gate`);
  }
});

test('J-tests-needed-rename slice-366-ac-3 — pairing is 1:1 within a file, and near-siblings never cross-pair', () => {
  // Two DIFFERENT checks sharing a long common prefix — the shape that a loose
  // similarity threshold would cross-pair, silently hiding a real removal.
  const SIB_A = 'F: behind only, HEAD on a slice branch — ref is moved explicitly, HEAD never merged';
  const SIB_B = 'F: ref-move falls back to update-ref when the refspec fetch is refused';
  assert.ok(titleSimilarity(SIB_A, SIB_B) < RENAME_SIMILARITY,
    'near-siblings must score BELOW the pairing threshold');
  // The threshold is itself load-bearing — a loose one cross-pairs near-siblings and
  // silently hides a real removal. Lock the FLOOR, not just today's behaviour: the two
  // real S353 renames score 0.82 and 0.88, so 0.8 is as low as it may ever go.
  assert.ok(RENAME_SIMILARITY >= 0.8,
    `pairing threshold ${RENAME_SIMILARITY} is too loose — it would cross-pair distinct checks`);
  assert.ok(titleSimilarity(OLD_B, NEW_B) >= RENAME_SIMILARITY, 'the real S353 rename must score above it');
  assert.ok(titleSimilarity(OLD_C, NEW_C) >= RENAME_SIMILARITY, 'the real S353 rename must score above it');
  assert.ok(titleSimilarity(OLD_B, NEW_C) < RENAME_SIMILARITY, 'unrelated titles must never pair');

  // A mid-band sibling: same subject, genuinely different check. It sits at ~0.67 —
  // comfortably paired by a loosened threshold, correctly refused by this one.
  const MID_A = 'the gate button stays disabled until the review is accepted';
  const MID_B = 'the gate button stays disabled until the regression suite has finished';
  assert.ok(titleSimilarity(MID_A, MID_B) < RENAME_SIMILARITY, 'mid-band siblings must not pair');
  const midDiff = rewrite(FILE, [
    { oldTitle: MID_A, oldBody: ['await expect(btn).toBeDisabled();'] },
    { newTitle: MID_B, newBody: ['await expect(btn).toBeDisabled();'] },
  ]);
  const mid = classifyFileDiff(midDiff);
  assert.equal(mid[MID_A].direction, 'removed', 'a distinct check that disappeared is still a removal');
  assert.ok(!mid[MID_B].rename, 'and its similar-looking neighbour is not credited as its rename');

  const crossPair = rewrite(FILE, [
    { oldTitle: SIB_A, oldBody: ['assert.strictEqual(ref, "refs/heads/dev");'] },
    { newTitle: SIB_B, newBody: ['assert.strictEqual(fallback, true);'] },
  ]);
  const cp = classifyFileDiff(crossPair);
  assert.equal(cp[SIB_A.trim()].direction, 'removed', 'a real removal must not be hidden by a similar-looking sibling');
  assert.equal(cp[SIB_B.trim()].direction, 'tightened', 'and the sibling stays a plain addition');

  // 1:1: one disappearing check and TWO plausible successors consume exactly one of them.
  const NEAR_1 = 'C: behind only (2 commits), HEAD on dev — merge --ff-only invoked, no push';
  const NEAR_2 = 'C: behind only (2 commits), HEAD on main — merge --ff-only invoked, no push';
  const twoWay = rewrite(FILE, [
    { oldTitle: OLD_C, oldBody: ['assert.strictEqual(pushes, 0);'] },
    { newTitle: NEAR_1, newBody: ['assert.strictEqual(pushes, 0);'] },
    { newTitle: NEAR_2, newBody: ['assert.strictEqual(pushes, 0);'] },
  ]);
  const tw = classifyFileDiff(twoWay);
  assert.ok(!tw[OLD_C.trim()], 'the single removal is consumed by exactly one successor');
  const labelled = Object.keys(tw).filter(k => tw[k].rename);
  assert.equal(labelled.length, 1, 'a removed entry may be consumed at most ONCE — no double-crediting');
  assert.equal(tw[labelled[0]].rename.from, OLD_C);

  // Cross-FILE renames stay RED — a stated, fail-closed limit of this slice.
  const crossFile = [
    'diff --git a/e2e/old-home.spec.js b/e2e/old-home.spec.js',
    '--- a/e2e/old-home.spec.js', '+++ b/e2e/old-home.spec.js', '@@ -1,3 +0,0 @@',
    `-${TEST_KW}('${OLD_C}', () => {`, '-  assert.strictEqual(pushes, 0);', '-});',
    'diff --git a/e2e/new-home.spec.js b/e2e/new-home.spec.js',
    '--- /dev/null', '+++ b/e2e/new-home.spec.js', '@@ -0,0 +1,3 @@',
    `+${TEST_KW}('${NEW_C}', () => {`, '+  assert.strictEqual(pushes, 0);', '+});',
  ].join('\n');
  const cf = classifyFileDiff(crossFile);
  assert.equal(cf[OLD_C.trim()].direction, 'removed', 'a rename that moves files stays a removal — fail closed');
  assert.ok(!cf[OLD_C.trim()].rename, 'and carries no rename label');
});

test('J-tests-needed-rename slice-366-ac-4 — an unpaired disappearance is still reported as removed', () => {
  // Nothing near-identical appears: the removal must stand, untouched by this slice.
  const dropped = rewrite(FILE, [{ oldTitle: OLD_B, oldBody: ['assert.strictEqual(res.status, 200);'] }]);
  const d = classifyFileDiff(dropped);
  assert.equal(d[OLD_B.trim()].direction, 'removed');
  assert.equal(d[OLD_B.trim()].onPlus, false, 'an unpaired removal never gains a head-side presence');

  // A removal alongside an unrelated addition must NOT pair with it.
  const swapped = rewrite(FILE, [
    { oldTitle: OLD_B, oldBody: ['assert.strictEqual(res.status, 200);'] },
    { newTitle: 'G: a push that does not advance origin raises', newBody: ['assert.match(err.message, /did not advance/);'] },
  ]);
  const s = classifyFileDiff(swapped);
  assert.equal(s[OLD_B.trim()].direction, 'removed', 'an unrelated addition is not a rename');

  const r = decide({ behaviourFiles: [], checks: [{ file: FILE, tag: OLD_B.trim(), area: 'e2e', kind: 'removed', direction: 'removed', rename: null }] });
  assert.equal(r.decision, 'red_flag', 'a genuine removal must still stop the gate');
  assert.equal(r.removedUndeclared.length, 1);

  // A TAGGED check keeps tag identity: a changed tag is a real identity change (AC
  // custody's job), never something similarity may paper over.
  const tagged = rewrite(FILE, [
    { oldTitle: 'J-x slice-100-ac-1 — the panel shows the merged slice immediately', oldBody: ['assert.strictEqual(n, 1);'] },
    { newTitle: 'J-x slice-100-ac-2 — the panel shows the merged slice immediately', newBody: ['assert.strictEqual(n, 1);'] },
  ]);
  const t = classifyFileDiff(tagged);
  assert.equal(t['slice-100-ac-1'].direction, 'removed', 'tagged checks are keyed by tag, so they never pair by prose');
  assert.ok(!t['slice-100-ac-2'].rename);
});

test('J-tests-needed-rename slice-366-ac-5 — rename is a label alongside a real direction, never a direction value', () => {
  const DIRECTIONS = ['tightened', 'loosened', 'reworded', 'removed', 'skipped'];

  const pure = entryFor(rewrite(FILE, [{
    oldTitle: OLD_B, oldBody: ['assert.strictEqual(res.status, 200);'],
    newTitle: NEW_B, newBody: ['assert.strictEqual(res.status, 200);'],
  }]), NEW_B);
  assert.ok(DIRECTIONS.includes(pure.direction), 'direction stays one of the five real values');
  assert.notEqual(pure.direction, 'renamed', '"renamed" must never become a direction');
  assert.deepEqual({ from: pure.rename.from, to: pure.rename.to }, { from: OLD_B, to: NEW_B },
    'the label records from → to');

  // The label rides ALONGSIDE a dangerous direction too — it never softens it.
  const weakened = entryFor(rewrite(FILE, [{
    oldTitle: OLD_B, oldBody: ['assert.strictEqual(res.status, 200);'],
    newTitle: NEW_B, newBody: ['assert.ok(res);'],
  }]), NEW_B);
  assert.equal(weakened.direction, 'loosened');
  assert.equal(weakened.rename.from, OLD_B, 'a flagged check still says what it was renamed from');

  // No direction value anywhere in the engine is spelled 'renamed'.
  const src = fs.readFileSync(DIRECTION_SRC, 'utf8');
  assert.ok(!/return\s+'renamed'/.test(src), "the engine must never return 'renamed' as a direction");
  // And the verdict layer still treats the five directions as the only masking signal.
  const engineSrc = fs.readFileSync(ENGINE_SRC, 'utf8');
  assert.ok(/direction === 'loosened' \|\| c\.direction === 'removed' \|\| c\.direction === 'skipped'/.test(engineSrc),
    'the masking filter must keep keying on direction, not on the rename label');
  assert.ok(/rename: e\.rename \|\| null/.test(engineSrc),
    'the checks list must carry the rename label through for the UI');
});

// ── the adversarial case: a one-word semantic inversion ─────────────────────
// No title metric can tell "…is disabled…" -> "…is enabled…" from an honest rename:
// it scores 0.90 and it WILL pair. This test refuses to leave that as a footnote and
// pins both halves of the real answer.
//
// The half that HOLDS: the inversion cannot be used as a vehicle for weakening. The
// merge re-runs the ordinary direction rules over the old side's removed assertions
// and the new side's added ones, so an inversion that also loosens or guts still
// reads 'loosened' and still stops the gate. That is the protection claimed for this
// slice, and it is what keeps the pairing from becoming a false-green channel.
//
// The half that does NOT: an inversion carried out at EQUAL assertion strength
// (strictEqual(x,true) -> strictEqual(x,false)) classifies as 'reworded' and clears.
// That is an ACCEPTED LIMIT, not a regression — the last assertion below proves it is
// pre-existing: the very same inversion edited in place under an UNCHANGED title
// already cleared the same way before this slice existed. The direction engine proves
// assertion direction, not semantic correctness (see its header); the real suite is
// the backstop for does-the-code-work. S366 extends that standing blind spot to the
// renamed case; it does not open a new one.
test('J-tests-needed-rename — a semantic inversion pairs, but merge-and-re-classify still flags it when it weakens', () => {
  const INV_OLD = 'the merge button is disabled while the review is pending';
  const INV_NEW = 'the merge button is enabled while the review is pending';

  // Stated plainly rather than hidden: one word apart, this clears the threshold.
  assert.ok(titleSimilarity(INV_OLD, INV_NEW) >= RENAME_SIMILARITY,
    'a one-word inversion scores ~0.90 — it pairs, and this suite says so out loud');

  // THE PROTECTION. Inversion used to smuggle a weakening through: still 'loosened'.
  const smuggled = entryFor(rewrite(FILE, [{
    oldTitle: INV_OLD, oldBody: ['assert.strictEqual(btn.disabled, true);'],
    newTitle: INV_NEW, newBody: ['assert.ok(btn);'],
  }]), INV_NEW);
  assert.equal(smuggled.direction, 'loosened',
    'an inverted title is no cover for a weakened assertion — the merge re-classifies it');
  assert.equal(smuggled.rename.from, INV_OLD, 'and it still reports what it was renamed from');

  // …including the version that deletes the assertions outright.
  const emptied = entryFor(rewrite(FILE, [{
    oldTitle: INV_OLD, oldBody: ['assert.strictEqual(btn.disabled, true);'],
    newTitle: INV_NEW, newBody: [],
  }]), INV_NEW);
  assert.equal(emptied.direction, 'loosened', 'an inversion that guts its assertions still flags');

  // …and the verdict layer stops on it, which is the outcome that actually matters.
  const r = decide({ behaviourFiles: [], checks: [{ file: FILE, tag: INV_NEW, area: 'e2e', kind: 'modified', direction: smuggled.direction, rename: smuggled.rename }] });
  assert.equal(r.decision, 'red_flag', 'a renamed-and-weakened check must still stop the gate');
  assert.equal(r.loosenedUndeclared.length, 1);

  // THE ACCEPTED LIMIT, pinned so nobody mistakes it for covered ground.
  const equalStrength = entryFor(rewrite(FILE, [{
    oldTitle: INV_OLD, oldBody: ['assert.strictEqual(btn.disabled, true);'],
    newTitle: INV_NEW, newBody: ['assert.strictEqual(btn.disabled, false);'],
  }]), INV_NEW);
  assert.equal(equalStrength.direction, 'reworded',
    'an inversion at equal assertion strength clears — the stated, accepted limit');

  // …and it is PRE-EXISTING, not something rename-pairing introduced: the same
  // inversion made in place, with the title untouched, already cleared identically.
  const inPlace = [
    `diff --git a/${FILE} b/${FILE}`, 'index 1111111..2222222 100644',
    `--- a/${FILE}`, `+++ b/${FILE}`, '@@ -1,4 +1,4 @@',
    `  ${TEST_KW}('${INV_OLD}', () => {`,
    '-  assert.strictEqual(btn.disabled, true);',
    '+  assert.strictEqual(btn.disabled, false);',
    ' });',
  ].join('\n');
  const untouched = classifyFileDiff(inPlace)[INV_OLD];
  assert.equal(untouched.direction, 'reworded',
    'the same inversion under an UNCHANGED title cleared before this slice — the blind spot is the engine’s, not the pairing’s');
  assert.ok(!untouched.rename, 'and it carries no rename label, because nothing was renamed');
});

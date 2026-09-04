'use strict';

/**
 * Journey: J-merge-dialog-one-classification
 * Category: Gate & Merge
 *
 * Spec source: slice 367 — "One classification, one range, one screen."
 *
 * WHY THIS EXISTS: the merge dialog ran TWO classifications. The verdict chip came
 * from /api/tests-needed over the pinned two-dot merge-base(main,dev)..dev across
 * every policed bucket; the change breakdown beneath it came from /api/test-changes
 * over its OWN three-dot origin/main...origin/dev, narrowed by a hand-written
 * `regression/ e2e/` pathspec and cached on the dev tip ALONE. The moment main moved,
 * the two halves of one screen were reading different evidence — a RED chip citing
 * blockers the list never showed, or (once renames were paired) a green chip over a
 * "No longer checked" list. Both halves now project ONE classify() result.
 *
 * What this pins (behavior, not implementation):
 *   - the verdict and the breakdown report the same pinned base..head and the same
 *     checks, and stay agreed when main moves under a still dev;
 *   - a rename is its own NEUTRAL group — but a rename that also guts assertions is
 *     still a warning, and still RED;
 *   - every item leads with a plain sentence naming the slice that made the change,
 *     and the raw check title survives behind the "show titles" toggle;
 *   - the gate still stops by default on RED, See diff is still there, and the added
 *     / changed / removed groups are still rendered.
 *
 * Deliberately NOT asserted (and why):
 *   - rename PAIRING itself (J-tests-needed-rename owns the similarity engine);
 *   - what counts as RED (J-tests-needed-verdict owns the decision; slice 367 changes
 *     what is displayed and from where, never the verdict);
 *   - browser rendering (Bashir's e2e owns the rendered page; the wiring IS asserted
 *     here, against the shipped source).
 *
 * #99992: all state lives in a per-test tmpdir + a LOCAL BARE origin; nothing here
 * touches the live bridge/ or a network.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GIT_ENV, git, initGitFixture, compileServer } = require('./j-merge-button-pass-helpers');

const REPO_ROOT_REAL = path.resolve(__dirname, '..', '..');
const SERVER_SRC = path.join(REPO_ROOT_REAL, 'dashboard', 'server.js');
const DASHBOARD_SRC = path.join(REPO_ROOT_REAL, 'dashboard', 'lcars-dashboard.html');

// The fixture suites quote whole check declarations, so they must not spell the
// declaration keyword literally: the suite-wide naming audit (j-gate-fail-retry) and
// the coverage-map deriver both scan source TEXT and would read these fixture titles
// as untagged real tests of this file. Same guard slice 366 needed.
const KW = 'te' + 'st';

// ── the fixture's checks ────────────────────────────────────────────────────
const A_TITLE = 'a merge that does nothing is reported as success';
const B_TITLE = 'the promote job refuses to run when dev is behind main';
const B_RENAMED = 'the promote job refuses to run when dev is behind main by any commit';
const C_TITLE = 'the operator sees the pinned dev sha beside the verdict';
const C_RENAMED = 'the operator sees the pinned dev sha beside the gate verdict';
const F_TITLE = 'the gate verdict chip is rendered above the change list';
const E_TITLE = 'the renamed group is neutral and never says removed';

const SUITE = 'regression/j-fixture-gate.test.js';

function suite(blocks) {
  return "'use strict';\n" + blocks.map(b =>
    `${KW}('${b.title}', () => {\n` + b.body.map(l => '  ' + l).join('\n') + '\n});\n').join('\n');
}

const CHECK_A = { title: A_TITLE, body: ["assert.strictEqual(result.status, 'success');"] };
const CHECK_B = { title: B_TITLE, body: ['assert.strictEqual(job.refused, true);'] };
const CHECK_B2 = { title: B_RENAMED, body: ['assert.strictEqual(job.refused, true);'] };
const CHECK_C = { title: C_TITLE, body: ["assert.strictEqual(chip.sha, 'abc1234');"] };
// Renamed AND gutted: an exact-equality assertion traded for a bare existence check.
// This one must stay a warning even though it paired as a rename.
const CHECK_C_GUTTED = { title: C_RENAMED, body: ['assert.ok(chip);'] };
// Same title, same strictness, different assertion: a genuine REWORD, which belongs
// in "Changed what we check for" and nowhere else.
const CHECK_F = { title: F_TITLE, body: ["assert.strictEqual(chip.label, 'RED FLAG');"] };
const CHECK_F2 = { title: F_TITLE, body: ["assert.deepStrictEqual(chip.bands, ['RED FLAG']);"] };
const CHECK_E = { title: E_TITLE, body: ["assert.strictEqual(group.tone, 'neutral');"] };

function commitOnDev(workDir, blocks, subject) {
  git(['checkout', '--quiet', 'dev'], workDir);
  const abs = path.join(workDir, SUITE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, suite(blocks), 'utf8');
  git(['add', SUITE], workDir);
  git(['commit', '--quiet', '-m', subject], workDir);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  return git(['rev-parse', 'HEAD'], workDir);
}

/**
 * A repo whose promoted range holds one real removal (S901) and, in a LATER slice
 * (S902), a clean rename, a rename-that-guts, and an addition — all in one file, so
 * per-check slice attribution is exercised rather than assumed.
 */
function makeFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  for (const d of ['dashboard', 'bridge', 'regression', 'scripts']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const prevEnv = {};
  for (const k of Object.keys(GIT_ENV)) prevEnv[k] = process.env[k];
  Object.assign(process.env, GIT_ENV);

  initGitFixture({ workDir: root, originDir: path.join(root, 'origin.git') });

  // Base: four checks, on main AND dev.
  commitOnDev(root, [CHECK_A, CHECK_B, CHECK_C, CHECK_F], 'seed: the base suite');
  git(['checkout', '--quiet', 'main'], root);
  git(['merge', '--quiet', '--ff-only', 'dev'], root);
  git(['push', '--quiet', 'origin', 'main'], root);
  git(['checkout', '--quiet', 'dev'], root);
  const base = git(['rev-parse', 'HEAD'], root);

  // S901 deletes check A outright and puts nothing in its place.
  const s901 = commitOnDev(root, [CHECK_B, CHECK_C, CHECK_F], 'S901: drop the no-op merge check');
  // S902 renames B, renames-and-guts C, rewords F and adds E — in the SAME file S901 touched.
  const s902 = commitOnDev(root, [CHECK_B2, CHECK_C_GUTTED, CHECK_F2, CHECK_E],
    'S902: rename two checks, reword one and add one');

  // The gate's real engine, resolved off the fixture root exactly as in production.
  // No guard covers anything here, and no lock is committed.
  fs.cpSync(path.join(REPO_ROOT_REAL, 'lib'), path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'regression', 'COVERAGE.lock'), JSON.stringify({ bySource: {} }), 'utf8');

  const exported = compileServer(root);
  return {
    root, base, s901, s902,
    changes: exported.getTestChanges, verdict: exported.getTestsNeeded,
    cleanup() {
      for (const k of Object.keys(prevEnv)) {
        if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

const byName = (list) => (list || []).map(i => i.name);
const find = (list, name) => (list || []).find(i => i.name === name);
const Q = String.fromCharCode(0x201C), UNQ = String.fromCharCode(0x201D);

// ── slice-367-ac-1 ──────────────────────────────────────────────────────────
// The verdict and the breakdown are ONE classification: same pinned range, same
// policed paths, same checks. Not "they agree today" — they cannot disagree.
test('J-merge-dialog-one-classification slice-367-ac-1 — the verdict and the change breakdown are computed over the same commit range and the same policed paths', () => {
  const f = makeFixture('s367-ac1-');
  try {
    const tc = f.changes(), tn = f.verdict();

    // One pinned range, reported by both halves as the same two SHAs.
    assert.equal(tc.base, tn.base, 'the breakdown and the verdict must share a base commit');
    assert.equal(tc.head, tn.head, 'the breakdown and the verdict must share a head commit');
    assert.equal(tc.base, f.base, 'the shared base is merge-base(origin/main, origin/dev)');
    assert.equal(tc.head, f.s902, 'the shared head is the dev tip');

    // Same policed paths, same checks: every check the verdict classified appears in
    // exactly one breakdown group, and the breakdown invents none of its own.
    const groups = [].concat(tc.added, tc.removed, tc.modified);
    const seen = groups.map(i => i.file + ' ' + i.tag);
    assert.equal(new Set(seen).size, seen.length, 'no check may appear in two groups');
    assert.equal(groups.length, 5, 'the promoted range holds five changed checks');
    for (const i of groups) assert.equal(i.file, SUITE, 'only policed suite files are listed');

    // And the blocker the chip cites IS in the list beneath it — the original bug.
    const flagged = tn.blockers.filter(b => b.kind === 'removed').map(b => b.name);
    assert.deepEqual(flagged, [A_TITLE], 'the verdict flags the removal');
    assert.ok(byName(tc.removed).includes(A_TITLE), 'and the breakdown shows the very same removal');
  } finally { f.cleanup(); }
});

// ── slice-367-ac-2 ──────────────────────────────────────────────────────────
test('J-merge-dialog-one-classification slice-367-ac-2 — renamed checks appear in their own neutral group, distinct from removals', () => {
  const f = makeFixture('s367-ac2-');
  try {
    const tc = f.changes();

    // The clean rename is its own group, and nowhere near the removals.
    assert.deepEqual(byName(tc.renamed), [B_RENAMED], 'a clean rename is its own group');
    assert.equal(find(tc.renamed, B_RENAMED).renamedFrom, B_TITLE, 'it says what it used to be called');
    assert.ok(!byName(tc.removed).includes(B_TITLE), 'a rename is never listed as a removal');
    assert.ok(!byName(tc.weakened).includes(B_RENAMED), 'and never as a warning');

    // A rename is information, not a warning — but only when it IS just a rename.
    assert.ok(byName(tc.weakened).includes(C_RENAMED), 'a rename that guts assertions stays a warning');
    assert.ok(!byName(tc.renamed).includes(C_RENAMED), 'and is kept OUT of the neutral group');
    assert.equal(find(tc.weakened, C_RENAMED).direction, 'loosened', 'with its real direction intact');

    // The real removal is still a removal — the neutral group did not swallow it.
    assert.deepEqual(byName(tc.removed), [A_TITLE], 'an unpaired disappearance is still a removal');
  } finally { f.cleanup(); }
});

// ── slice-367-ac-3 ──────────────────────────────────────────────────────────
test('J-merge-dialog-one-classification slice-367-ac-3 — each item leads with plain language naming the slice and the change, with raw titles behind the toggle', () => {
  const f = makeFixture('s367-ac3-');
  try {
    const tc = f.changes();
    for (const i of [].concat(tc.added, tc.removed, tc.modified)) {
      assert.ok(i.plain && i.plain.length > 20, `every item leads with a sentence (${i.name})`);
      assert.ok(i.name, 'and keeps its raw check title');
    }

    // The sentence the brief asked for, naming the slice that actually did it — S901
    // removed A even though S902 was the last slice to touch that same file.
    assert.equal(find(tc.removed, A_TITLE).slice, '901', 'the removal is attributed to the slice that made it');
    assert.equal(find(tc.removed, A_TITLE).plain,
      `Slice 901 removed the check ${Q}${A_TITLE}${UNQ} and put nothing in its place. Intended?`);
    assert.equal(find(tc.renamed, B_RENAMED).slice, '902', 'the rename is attributed to the later slice');
    assert.match(find(tc.renamed, B_RENAMED).plain, /^Slice 902 renamed the check /);
    assert.match(find(tc.weakened, C_RENAMED).plain, /^Slice 902 weakened the check .*Intended\?$/);
    assert.match(find(tc.added, E_TITLE).plain, /^Slice 902 added the check /);
    assert.match(find(tc.changed, F_TITLE).plain, /^Slice 902 changed what the check /);

    // On screen: the sentence leads, the raw title sits behind the existing toggle.
    const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');
    const render = html.match(/function _renderTestChanges\([\s\S]*?\n  \}\n/);
    assert.ok(render, '_renderTestChanges must exist');
    assert.match(render[0], /utc-item">\$\{_esc\(i\.plain/, 'each item renders the plain sentence first');
    assert.match(render[0], /utc-raw"><code>\$\{_esc\(i\.name\)/, 'the raw title renders as demoted detail');
    assert.match(render[0], /class="utc-add-titles" hidden/, 'behind the existing collapsed toggle');
  } finally { f.cleanup(); }
});

// ── slice-367-ac-4 ──────────────────────────────────────────────────────────
// The don't-regress criterion: nothing here weakens detection or takes away a control
// the operator already had.
test('J-merge-dialog-one-classification slice-367-ac-4 — the gate still stops by default and See diff plus the added, changed and removed groups are unchanged', () => {
  const f = makeFixture('s367-ac4-');
  try {
    // Stops by default: an undeclared removal is still RED, and RED still locks Approve.
    assert.equal(f.verdict().decision, 'red_flag', 'an undeclared removal still stops the gate');

    const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');
    const apply = html.match(/function _utcApplyVerdict\([\s\S]*?\n  \}\n/);
    assert.ok(apply, '_utcApplyVerdict must exist');
    assert.match(apply[0], /red_flag/, 'the checkpoint still keys off red_flag');
    assert.match(apply[0], /approve\.disabled = true/, 'RED still disables Approve by default');
    assert.match(html, /function utcToggleSecondAck\(\)/, 'the non-author second-ack still gates Approve');

    // See diff, and all three original groups, still on the screen — now fed by the
    // unified payload rather than by a second, independent classification.
    assert.match(html, /See diff/, 'the See diff control survives');
    assert.match(html, /\/compare\/main\.\.\.dev/, 'and still points at the promotion diff');
    const render = html.match(/function _renderTestChanges\([\s\S]*?\n  \}\n/)[0];
    assert.match(render, /No longer checked \(\$\{\(tc\.removed/, 'the removed group is rendered from tc.removed');
    assert.match(render, /Changed what we check for \(\$\{\(tc\.changed/, 'the changed group is rendered from tc.changed');
    assert.match(render, /new coverage/, 'the added group survives as new coverage');
    assert.match(render, /tc\.added\.length/, 'and is rendered from tc.added');

    // The groups are not empty shells: the fixture's four changes land in them, and
    // every modified check lands in exactly one of the three modified bands.
    const tc = f.changes();
    assert.equal(tc.counts.removed, 1);
    assert.equal(tc.counts.added, 1);
    assert.equal(tc.counts.changed, 1, 'the reworded check lands in the changed group');
    assert.equal(tc.counts.changed + tc.counts.renamed + tc.counts.weakened, tc.counts.modified);
  } finally { f.cleanup(); }
});

// ── trap 1 ──────────────────────────────────────────────────────────────────
// "Do not let the two endpoints drift again — assert it in a test, not in a comment."
// The drift was structural: the breakdown keyed its cache on the DEV TIP ALONE, so a
// main that moved left it serving a range the verdict had already abandoned.
test('J-merge-dialog-one-classification slice-367-ac-1 trap-endpoint-drift — main moving under a still dev cannot leave the breakdown on a range the verdict abandoned', () => {
  const f = makeFixture('s367-trap1-');
  try {
    // Warm BOTH halves at the full range: the removal is in it.
    const before = f.changes();
    assert.ok(byName(before.removed).includes(A_TITLE), 'the removal is in the full range');
    assert.equal(f.verdict().decision, 'red_flag');

    // main fast-forwards over S901 — the removal is now BEHIND the base. dev has not
    // moved, so a breakdown keyed on the dev tip alone would still serve the stale list.
    git(['checkout', '--quiet', 'main'], f.root);
    git(['merge', '--quiet', '--ff-only', f.s901], f.root);
    git(['push', '--quiet', 'origin', 'main'], f.root);
    git(['checkout', '--quiet', 'dev'], f.root);

    const tc = f.changes(), tn = f.verdict();
    assert.equal(tc.base, f.s901, 'the breakdown follows the new merge-base');
    assert.equal(tc.base, tn.base, 'and still shares it with the verdict');
    assert.ok(!byName(tc.removed).includes(A_TITLE),
      'the already-promoted removal is gone from the breakdown, as it is from the verdict');
    assert.deepEqual(tn.blockers.filter(b => b.kind === 'removed'), [],
      'the verdict no longer cites it either');
    assert.deepEqual(byName(tc.removed), [], 'the two halves report the same emptiness');
  } finally { f.cleanup(); }
});

// ── trap 2 ──────────────────────────────────────────────────────────────────
// "Removing raw titles entirely would break the operator's ability to write an
// override trailer for an untagged check. Demote them, do not delete them."
test('J-merge-dialog-one-classification slice-367-ac-3 trap-titles-demoted-not-deleted — the exact check title an override must name survives on every group', () => {
  const f = makeFixture('s367-trap2-');
  try {
    const tc = f.changes();
    // For an UNTAGGED check the title IS the override target, so it must survive verbatim.
    for (const i of [].concat(tc.added, tc.removed, tc.modified)) {
      assert.equal(i.name, i.tag, 'an untagged check is keyed by its exact title');
      assert.notEqual(i.name, i.plain, 'the raw title is a field of its own, not only prose');
    }
    assert.ok(byName(tc.removed).includes(A_TITLE), 'verbatim, so it can be pasted into a trailer');

    // Every group — not only the additions — carries the titles behind the toggle.
    const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');
    const render = html.match(/function _renderTestChanges\([\s\S]*?\n  \}\n/)[0];
    const groupFn = render.match(/const _group = \([\s\S]*?\n    \};/);
    assert.ok(groupFn, 'one shared group renderer');
    assert.match(groupFn[0], /show titles/, 'every group gets the show-titles toggle');
    assert.match(groupFn[0], /utc-add-titles" hidden/, 'with the titles collapsed by default');
    assert.match(groupFn[0], /_esc\(i\.name\)/, 'and the raw title inside it');
    assert.match(html, /function _toggleAddedDetail\(btn\)/, 'the existing toggle still drives it');
  } finally { f.cleanup(); }
});

// ── trap 3 ──────────────────────────────────────────────────────────────────
// "The verdict chip colours are inline styles ... If you touch that markup, do not
// make it worse; fixing it is optional and out of scope." So: the chip is left alone,
// and the group this slice ADDS does not repeat the mistake.
test('J-merge-dialog-one-classification slice-367-ac-2 trap-no-new-inline-colours — the new renamed group is themed by stylesheet, and the verdict chip markup is untouched', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The new neutral band is a CSS class with a stylesheet rule — no inline colour.
  assert.match(html, /\.utc-renamed \{[^}]*background:/, 'the renamed band is themed in the stylesheet');
  const render = html.match(/function _renderTestChanges\([\s\S]*?\n  \}\n/)[0];
  assert.match(render, /'utc-renamed'/, 'and the renderer names that class');
  // Scoped to the markup this slice writes: the shared group renderer and the added
  // group. (The pre-existing error paragraph carries an inline colour of its own and
  // is left exactly as it was — this slice neither adds to that nor cleans it up.)
  const groupFn = render.match(/const _group = \([\s\S]*?\n    \};/)[0];
  assert.ok(!/style="/.test(groupFn), 'the shared group renderer adds no inline styles');
  const addedBlock = render.match(/if \(tc\.added && tc\.added\.length\) \{[\s\S]*?\n    \}/)[0];
  assert.ok(!/style="/.test(addedBlock), 'nor does the added group');

  // The chip is left exactly as it was: still its own inline-styled band table,
  // untouched by this slice (fixing it is explicitly out of scope).
  const chip = html.match(/const UTC_VERDICTS = \{[\s\S]*?\n  \};/);
  assert.ok(chip, 'the verdict band table is still there');
  for (const band of ['CLEAR', 'NEEDS REVIEW', 'OVERRIDDEN', 'RED FLAG', 'NO VERDICT']) {
    assert.ok(chip[0].includes(band), `verdict band "${band}" is unchanged`);
  }
});

// ── trap 4 ──────────────────────────────────────────────────────────────────
// "This slice changes what is displayed and from where, never what counts as RED."
// The tempting bug is letting the new neutral group leak into the decision.
test('J-merge-dialog-one-classification slice-367-ac-4 trap-verdict-unmoved — grouping a rename as neutral does not change what counts as RED', () => {
  const f = makeFixture('s367-trap4-');
  try {
    const tn = f.verdict(), tc = f.changes();

    // The engine's own verdict for this range, unchanged by any display grouping.
    assert.equal(tn.decision, 'red_flag');
    assert.equal(tn.counts.removed, 1, 'the undeclared removal still counts');
    assert.equal(tn.counts.loosened, 1, 'so does the rename that gutted its assertions');
    assert.equal(tn.counts.skipped, 0);

    // The renamed-and-gutted check is RED in the verdict AND a warning in the list —
    // being a rename buys it neither a pass nor a neutral band.
    assert.ok(tn.blockers.some(b => b.kind === 'loosened' && b.name === C_RENAMED),
      'the verdict cites the gutted rename by name');
    assert.ok(byName(tc.weakened).includes(C_RENAMED), 'and the list shows it as a warning');
    assert.ok(!byName(tc.renamed).includes(C_RENAMED), 'never as neutral information');

    // The clean rename is neutral on screen and, correctly, not a blocker.
    assert.ok(!tn.blockers.some(b => b.name === B_RENAMED), 'a clean rename is not a blocker');
    assert.deepEqual(byName(tc.renamed), [B_RENAMED]);

    // And the breakdown is downstream of the verdict, never an input to it: the
    // decision is the engine's own, read back unchanged.
    const server = fs.readFileSync(SERVER_SRC, 'utf8');
    const fn = server.match(/function getTestsNeeded\(\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'getTestsNeeded must exist');
    assert.ok(!/getTestChanges\(/.test(fn[0]), 'the verdict never consults the breakdown');
    assert.match(fn[0], /decision: r\.decision/, 'it reports the engine decision verbatim');
  } finally { f.cleanup(); }
});

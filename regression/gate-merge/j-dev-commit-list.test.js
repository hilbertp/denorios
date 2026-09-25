'use strict';
// J-dev-commit-list — slice 397: every commit on dev gets a row under the branch graph.
//
// The list under the graph in QA and Branches used to print one row (the tip) and throw the
// rest of /api/branch-state's dev.commits away. It now prints one row per commit, newest
// first, followed by the base row for origin/main.
//
// Both guards run the REAL renderTopoSvg() lifted out of lcars-dashboard.html — a hand-kept
// copy of the markup would go on passing after the page changed underneath it. What the rows
// LOOK like (wrapping, no ellipsis, escaping) is the browser suite's job; these two pin the
// computed part: how many rows come out, and in which order.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');
const SRC = fs.readFileSync(DASH, 'utf8');

// Brace-match a top-level `function f(` declaration out of the source.
function extractBlock(header) {
  const start = SRC.search(header);
  assert.notEqual(start, -1, `${header} must exist in lcars-dashboard.html`);
  let depth = 0;
  for (let j = SRC.indexOf('{', start); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces while extracting ${header}`);
}

const UNRENDERED = '<<never-rendered>>';  // sentinel: still here ⇒ the renderer never wrote

// Run the page's own renderTopoSvg() over `bs`. Returns the html it wrote to #topo-svg-wrap.
function render(bs) {
  const wrap = { innerHTML: UNRENDERED };
  const document = {
    getElementById: (id) => (id === 'topo-svg-wrap' ? wrap : null),
  };
  const factory = new Function('document', `
    ${extractBlock(/\n\s*function formatAgeShort\s*\(/)}
    ${extractBlock(/\n\s*function _promoteEsc\s*\(/)}
    ${extractBlock(/\n\s*function _ghReconciling\s*\(/)}
    ${extractBlock(/\n\s*function renderTopoSvg\s*\(/)}
    return renderTopoSvg;
  `);
  factory(document)(bs);
  assert.notEqual(wrap.innerHTML, UNRENDERED, 'renderTopoSvg must write to #topo-svg-wrap');
  return wrap.innerHTML;
}

// The `<div class="...">…</div>` rows of the commit list, in DOM order. Parsed off the
// rendered html rather than assembled here, so a row the renderer stops emitting disappears.
function rows(html) {
  const list = html.slice(html.indexOf('<div class="topo-commits">'));
  const out = [];
  const RE = /<div class="(topo-c-row[^"]*)">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = RE.exec(list))) {
    const cell = (k) => {
      const hit = new RegExp(`<span class="topo-c-${k}">([\\s\\S]*?)</span>`).exec(m[2]);
      return hit ? hit[1] : null;
    };
    out.push({ cls: m[1], k: cell('k'), sha: cell('sha'), subj: cell('subj'), age: cell('age') });
  }
  return out;
}

const state = (commits, extra = {}) => ({
  dev: { commits, commits_ahead_of_main: commits.length },
  main: { tip_sha: 'ffffffffff' },
  last_merge: { sha: 'aaaaaaabbb', slice_id: 350, age_s: 3600 },
  ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — one row per commit, then the one base row
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-397-ac-1 sha256:56e362e4524817e15d48a5f11bf2f01613c2e6d6deae680fb949719969f32789
test('J-dev-commit-list slice-397-ac-1 — N commits on dev render N commit rows plus the one base row, each with its sha, subject and age', () => {
  const commit = (i) => ({ sha: `c${i}`.padEnd(10, '0'), subject: `S${300 + i}: commit ${i}`, age_s: 120 });

  for (const n of [1, 2, 3, 7]) {
    const all = rows(render(state(Array.from({ length: n }, (_, i) => commit(i)))));
    const dev = all.filter(r => /\btopo-c-dev\b/.test(r.cls));
    assert.equal(dev.length, n, `${n} commits on dev must render ${n} commit rows, not ${dev.length}`);
    assert.equal(all.length, n + 1, `${n} commit rows plus exactly one base row`);
    assert.equal(all[all.length - 1].k, 'base', 'the last row is the base row for origin/main');
  }

  // Each commit row carries that commit's own 7-char sha, its subject, and its age.
  const [tip] = rows(render(state([commit(4)]))).filter(r => /\btopo-c-dev\b/.test(r.cls));
  assert.equal(tip.sha, 'c4000000'.slice(0, 7), 'the row shows the commit sha cut to 7 characters');
  assert.equal(tip.subj, 'S304: commit 4', 'the row shows that commit\'s subject');
  assert.equal(tip.age, '· 2m ago', 'a commit 120 seconds old reads "· 2m ago"');
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — newest first, and the array the Regression panel shares is not flipped
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-397-ac-2 sha256:b5358737bf7582fc2e44d1e4c4f206d903ecc6cd528c9fa499534f5021b47897
test('J-dev-commit-list slice-397-ac-2 — the rows run newest first with only the tip labelled "newest", and dev.commits keeps its oldest-first order', () => {
  // dev.commits arrives oldest-first (server.js uses --reverse): A, B, C with C the tip.
  const commits = [
    { sha: 'aaaaaaa111', subject: 'A oldest', age_s: 300 },
    { sha: 'bbbbbbb222', subject: 'B middle', age_s: 200 },
    { sha: 'ccccccc333', subject: 'C tip',    age_s: 100 },
  ];
  const all = rows(render(state(commits)));

  assert.deepEqual(all.map(r => r.subj), ['C tip', 'B middle', 'A oldest', 'origin/main S350'],
    'the rows read tip → oldest, then base');
  assert.deepEqual(all.map(r => r.k), ['newest', '', '', 'base'],
    'only the first commit row is labelled "newest"; the rest carry no label');

  // The trap: reverse() would flip the very array _lastBranchState hands the Regression
  // panel, whose "Tested commit (dev tip)" reads dev.commits[length - 1]. After a render
  // that entry must still be the tip.
  assert.deepEqual(commits.map(c => c.sha),
    ['aaaaaaa111', 'bbbbbbb222', 'ccccccc333'],
    'rendering must not reorder dev.commits in place');
  assert.equal(commits[commits.length - 1].subject, 'C tip',
    'the last entry of dev.commits is still the dev tip the Regression panel names');

  // While a promote is reconciling: same commit rows first, then the pre-merge base row,
  // then the reconciling note.
  const rec = rows(render(state(commits, { github: { reconciling: true } })));
  assert.deepEqual(rec.map(r => r.subj.slice(0, 8)),
    ['C tip', 'B middle', 'A oldest', 'origin/m', 'reconcil'],
    'reconciling keeps the commit rows first, then base, then the note');
  assert.match(rec[3].cls, /topo-c-premerge/, 'the base row is marked pre-merge');
  assert.match(rec[4].cls, /topo-c-reconciling/, 'the reconciling note comes last');
});

'use strict';
// J-topo-node-kind — slice 406: every dev node in the branch graph wears the label the
// server sends, and an (i) at the end of the dev line says what the letters mean.
//
// Before this slice the text under a node was rebuilt from slice_id as `S<id>`, so slice
// 402's archive commit read S402 — indistinguishable from the landing it filed. Now the
// node draws `label` (S402, P402, H) and its hover names the kind above today's line.
//
// These guards run the REAL renderTopoSvg() lifted out of lcars-dashboard.html — a
// hand-kept copy of the markup would go on passing after the page changed underneath it.
// What the nodes LOOK like (the 9px grey text, where the (i) sits to the pixel) is the
// browser suite's job; these pin the computed part: which string each node gets, how the
// two hover lines are composed, and when the (i) exists at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');
const SRC = fs.readFileSync(DASH, 'utf8');

// Brace-match a top-level declaration (a `function f(` or a `const X = {`) out of the source.
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
    ${extractBlock(/\n\s*const KIND_MEANINGS\s*=/)};
    ${extractBlock(/\n\s*function kindMeaning\s*\(/)}
    ${extractBlock(/\n\s*function renderTopoSvg\s*\(/)}
    return renderTopoSvg;
  `);
  factory(document)(bs);
  assert.notEqual(wrap.innerHTML, UNRENDERED, 'renderTopoSvg must write to #topo-svg-wrap');
  return wrap.innerHTML;
}

// ── the rendered graph, read back off the html ────────────────────────────────
const svgOf = (html) => html.slice(0, html.indexOf('</svg>') + 6);

// The `<text class="topo-node-label">` for one commit, or null when the node has none.
function nodeLabel(html, sha7) {
  const re = new RegExp(`<text class="topo-node-label" data-sha="${sha7}"([^>]*)>([^<]*)</text>`);
  const m = re.exec(svgOf(html));
  return m ? { attrs: m[1], text: m[2] } : null;
}

// Every node label in the graph, in draw order.
function allNodeLabels(html) {
  return [...svgOf(html).matchAll(/<text class="topo-node-label"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
}

// One dev node's circle and the lines of its hover.
function devNode(html, sha7) {
  const re = new RegExp(`<circle class="topo-dev-node" data-sha="${sha7}"([^>]*)><title>([\\s\\S]*?)</title>`);
  const m = re.exec(svgOf(html));
  assert.ok(m, `a circle.topo-dev-node[data-sha="${sha7}"] with a <title> must be drawn`);
  return { attrs: m[1], hover: m[2], lines: m[2].split('\n') };
}

// The graph's (i), or null when none is drawn.
function kindInfo(html) {
  const m = /<text class="topo-kind-info"([^>]*)>([\s\S]*?)<title>([\s\S]*?)<\/title><\/text>/.exec(svgOf(html));
  if (!m) return null;
  const x = /\bx="([-\d.]+)"/.exec(m[1]);
  return { attrs: m[1], x: Number(x[1]), text: m[2], lines: m[3].split('\n') };
}

const state = (commits, extra = {}) => ({
  dev: { commits, commits_ahead_of_main: commits.length },
  main: { tip_sha: 'ffffffffff' },
  last_merge: { sha: 'aaaaaaabbb', slice_id: 350, age_s: 3600 },
  ...extra,
});

// The wording the acceptance criteria name, spelled out here rather than read from the
// page: this test is what stops the three sentences being quietly reworded or split.
const MEANING = {
  S: 'a slice landing: the finished work of the slice with that number',
  P: 'pipeline bookkeeping for the slice with that number: archiving its brief or saving files left uncommitted',
  H: 'a hand commit: made directly on dev, not by the slice pipeline',
};

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — the node draws `label`, never a slice_id rebuilt into S<id>
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-406-ac-1 sha256:8e9e10c9b9daa2e47d4a7ba33d0aa7098639fe29c30cb59be8ade72bd82e6f69
test('J-topo-node-kind slice-406-ac-1 — every labelled dev node shows the server\'s label, the newest included, and slice 402\'s bookkeeping commit reads P402 not S402', () => {
  const html = render(state([
    { sha: 'aaaaaaa111', full_sha: 'aaaaaaa111', slice_id: 401, label: 'S401', kind: 'S', inferred: false, subject: 'S401: landing', age_s: 300 },
    { sha: 'bbbbbbb222', full_sha: 'bbbbbbb222', slice_id: 402, label: 'P402', kind: 'P', inferred: false, subject: 'S402: autocommit', age_s: 200 },
    { sha: 'ccccccc333', full_sha: 'ccccccc333', slice_id: null, label: 'H',    kind: 'H', inferred: true,  subject: 'tweak the caption', age_s: 100 },
  ]));

  assert.deepEqual(allNodeLabels(html), ['S401', 'P402', 'H'],
    'each node shows its own label; the newest node (H) is labelled too');

  // The whole point of the slice: a bookkeeping commit carries slice_id 402, and the old
  // renderer turned that into S402 — the same text the landing gets.
  assert.equal(nodeLabel(html, 'bbbbbbb').text, 'P402',
    'a commit sent with slice_id 402 and label P402 shows P402');
  assert.ok(!allNodeLabels(html).includes('S402'),
    'no node shows S402: the label is never rebuilt from slice_id');
  // A hand commit has no slice number at all, so nothing may be appended to its letter.
  assert.equal(nodeLabel(html, 'ccccccc').text, 'H', 'a hand commit shows the bare letter H');

  // The screen hooks the browser suite selects on.
  for (const sha7 of ['aaaaaaa', 'bbbbbbb', 'ccccccc']) {
    assert.match(nodeLabel(html, sha7).attrs, /y="70"/, 'the label sits 18 below the dev line (devY 52)');
    assert.match(devNode(html, sha7).attrs, /cy="52"/, 'the dev circle carries its class and sha');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — an inferred kind is drawn exactly like a declared one
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-406-ac-2 sha256:0c4613bf3e3519edf90de6d3b3387138949434cefe63f3128f9953f14c079e3c
test('J-topo-node-kind slice-406-ac-2 — two commits identical but for sha and `inferred` render the same label and the same hover, with no extra mark', () => {
  const commit = (sha, inferred) => ({
    sha, full_sha: sha, slice_id: 402, label: 'S402', kind: 'S', inferred,
    subject: 'S402: the work', age_s: 240,
  });
  // Both non-newest, so the pair differs in nothing but sha and inferred.
  const html = render(state([
    commit('aaaaaaa111', true),
    commit('bbbbbbb222', false),
    { sha: 'ccccccc333', full_sha: 'ccccccc333', slice_id: null, label: 'H', kind: 'H', inferred: true, subject: 'newest', age_s: 10 },
  ]));

  const a = nodeLabel(html, 'aaaaaaa'), b = nodeLabel(html, 'bbbbbbb');
  assert.equal(a.text, b.text, 'the same label text');
  // Colour, font size and weight all live in these attributes; compare them wholesale so
  // any styling keyed off `inferred` (a lighter fill, an italic, a dash) shows up here.
  assert.equal(a.attrs.replace(/data-sha="\w+"/, '').replace(/ x="[-\d.]+"/, ''),
               b.attrs.replace(/data-sha="\w+"/, '').replace(/ x="[-\d.]+"/, ''),
    'identical text attributes apart from sha and position — nothing is styled by `inferred`');

  const na = devNode(html, 'aaaaaaa'), nb = devNode(html, 'bbbbbbb');
  assert.equal(na.hover.replace('aaaaaaa', ''), nb.hover.replace('bbbbbbb', ''),
    'the hovers differ only in the sha');
  assert.equal(na.attrs.replace(/data-sha="\w+"/, '').replace(/cx="[-\d.]+"/, ''),
               nb.attrs.replace(/data-sha="\w+"/, '').replace(/cx="[-\d.]+"/, ''),
    'the circles differ only in position and sha — no extra mark on the inferred one');

  // An inferred kind adds no second glyph anywhere in the graph.
  assert.equal(allNodeLabels(html).length, 3, 'three nodes, three labels, nothing extra drawn');
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — the hover is the kind line, then exactly today's line
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-406-ac-3 sha256:2f0ec220176aa93e356e3cd1cf7f912005514ec4ff66bfa49743377d0238eb5e
test('J-topo-node-kind slice-406-ac-3 — a labelled node hovers as "<label> — <meaning>" then exactly today\'s dev line, with the subject never shortened', () => {
  const long = 'S402: '.padEnd(200, 'x');
  assert.equal(long.length, 200, 'the fixture subject is 200 characters');
  const html = render(state([
    { sha: 'aaaaaaa111', full_sha: 'aaaaaaa111', slice_id: 401, label: 'S401', kind: 'S', inferred: false, subject: 'S401: landing', age_s: 300 },
    { sha: 'bbbbbbb222', full_sha: 'bbbbbbb222', slice_id: 402, label: 'P402', kind: 'P', inferred: false, subject: long, age_s: 120 },
    { sha: 'ccccccc333', full_sha: 'ccccccc333', slice_id: null, label: 'H',    kind: 'H', inferred: true,  subject: 'by hand', age_s: 60 },
  ]));

  assert.deepEqual(devNode(html, 'aaaaaaa').lines,
    [`S401 — ${MEANING.S}`, 'dev: aaaaaaa — S401: landing · 5m ago'],
    'an S node names the landing, then today\'s line');
  assert.deepEqual(devNode(html, 'bbbbbbb').lines,
    [`P402 — ${MEANING.P}`, `dev: bbbbbbb — ${long} · 2m ago`],
    'a P node names the bookkeeping, and the 200-character subject survives whole');
  assert.deepEqual(devNode(html, 'ccccccc').lines,
    [`H — ${MEANING.H}`, 'origin/dev: ccccccc — by hand · 1m ago'],
    'the newest node still says origin/dev on its second line');

  for (const sha7 of ['aaaaaaa', 'bbbbbbb', 'ccccccc']) {
    assert.equal(devNode(html, sha7).lines.length, 2, `${sha7} hovers as exactly two lines`);
  }
  // The meaning in the hover is the (i)'s line with its "S — " stripped, not a second
  // wording that happens to look similar.
  const info = kindInfo(html);
  for (const k of ['S', 'P', 'H']) {
    const fromInfo = info.lines.find(l => l.startsWith(`${k} — `)).slice(`${k} — `.length);
    assert.equal(fromInfo, MEANING[k], `the (i)'s ${k} line and the node hover read the same sentence`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — the (i) exists exactly when a node does, and explains all three letters
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-406-ac-4 sha256:32aeacb94dfe22d235315421a0511c72365f893ccc2153b271f51dfec7937ffe
test('J-topo-node-kind slice-406-ac-4 — with at least one dev node an "(i)" is drawn past the dashed tail and inside the graph, hovering as S, P then H; with no commits none is drawn', () => {
  for (const n of [1, 2, 5]) {
    const html = render(state(Array.from({ length: n }, (_, i) => ({
      sha: `c${i}`.padEnd(10, '0'), full_sha: `c${i}`.padEnd(10, '0'),
      slice_id: 400 + i, label: `S${400 + i}`, kind: 'S', inferred: false,
      subject: `S${400 + i}: work`, age_s: 100,
    }))));
    const info = kindInfo(html);
    assert.ok(info, `${n} dev node(s) ⇒ an (i) is drawn`);
    assert.equal(info.text, '(i)', 'the legend reads "(i)"');

    assert.deepEqual(info.lines, [`S — ${MEANING.S}`, `P — ${MEANING.P}`, `H — ${MEANING.H}`],
      'the (i) hovers as exactly three lines, S then P then H');

    // Right of the newest node, clear of the short dashed tail after it, and wholly
    // inside the viewBox. All three numbers are read back off the rendered graph, so
    // moving the tail or shrinking rightPad breaks this rather than sliding the (i) out.
    const svg = svgOf(html);
    const head = Number(/<circle class="topo-dev-node"[^>]*cx="([\d.]+)"[^>]*r="6.5"/.exec(svg)[1]);
    const tailEnd = Number(/<line x1="[\d.]+" y1="[\d.]+" x2="([\d.]+)"[^>]*stroke-dasharray="5 4"/.exec(svg)[1]);
    const width = Number(/viewBox="0 0 ([\d.]+) /.exec(svg)[1]);
    assert.ok(info.x > head, `the (i) (x ${info.x}) sits right of the newest node (x ${head})`);
    assert.ok(info.x > tailEnd, `the (i) (x ${info.x}) clears the dashed tail (ends x ${tailEnd})`);
    // text-anchor="start" at font-size 10: "(i)" runs ~15 units right of x.
    assert.ok(info.x + 15 <= width, `the (i) (x ${info.x}) fits inside the graph (width ${width})`);
    assert.match(info.attrs, /y="55.5"/, 'the (i) sits level with the dev nodes (devY 52)');
  }

  // No commits on dev: one faint dashed line, no nodes — and so no letters to explain.
  const empty = render({ dev: { commits: [], commits_ahead_of_main: 0 }, main: { tip_sha: 'ffffffffff' }, last_merge: null });
  assert.equal(kindInfo(empty), null, 'an empty dev.commits draws no (i)');
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-5 — no label means no text, and today's single-line hover
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-406-ac-5 sha256:e198745c900b48930c9f96a5ee5e5bd77f93e47e0a5c764adec57cb51680fa45
test('J-topo-node-kind slice-406-ac-5 — a commit sent with no label (missing, null or "") draws no text under its node even with a slice_id, and hovers as exactly today\'s one line', () => {
  const html = render(state([
    { sha: 'aaaaaaa111', full_sha: 'aaaaaaa111', slice_id: 401, subject: 'S401: no label field', age_s: 300 },
    { sha: 'bbbbbbb222', full_sha: 'bbbbbbb222', slice_id: 402, label: null, subject: 'S402: label absent', age_s: 240 },
    { sha: 'ccccccc333', full_sha: 'ccccccc333', slice_id: 403, label: '',   subject: 'S403: empty label', age_s: 180 },
    { sha: 'ddddddd444', full_sha: 'ddddddd444', slice_id: 404, label: 'S404', kind: 'S', inferred: false, subject: 'S404: landed', age_s: 120 },
  ]));

  for (const [sha7, what] of [['aaaaaaa', 'missing'], ['bbbbbbb', 'null'], ['ccccccc', 'empty']]) {
    assert.equal(nodeLabel(html, sha7), null,
      `a ${what} label draws no text under the node, even though slice_id is set`);
  }
  assert.deepEqual(devNode(html, 'aaaaaaa').lines, ['dev: aaaaaaa — S401: no label field · 5m ago'],
    'an unlabelled node hovers as exactly today\'s single line');
  assert.equal(devNode(html, 'bbbbbbb').lines.length, 1, 'a null label adds no first line');
  assert.equal(devNode(html, 'ccccccc').lines.length, 1, 'an empty label adds no first line');

  // The labelled neighbour is untouched, and the unlabelled ones cost nothing: no stray
  // "undefined"/"null" text anywhere in the graph (what a console error would follow).
  assert.deepEqual(allNodeLabels(html), ['S404'], 'the one labelled commit keeps its label');
  assert.ok(!/undefined|null/.test(svgOf(html)), 'the graph markup holds no "undefined" or "null"');
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-6 — an unknown kind, or none, leaves the label standing alone
// ═══════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-406-ac-6 sha256:00dc75a84b9d2a5e11786657c64f127b27aaf008931a7cbf8951b627d8b2747d
test('J-topo-node-kind slice-406-ac-6 — a label whose kind is not S, P or H (or is absent) shows the label, and hovers as the bare label then today\'s line', () => {
  const html = render(state([
    { sha: 'aaaaaaa111', full_sha: 'aaaaaaa111', slice_id: 402, label: 'T402', kind: 'T', inferred: false, subject: 'T402: tests', age_s: 300 },
    { sha: 'bbbbbbb222', full_sha: 'bbbbbbb222', slice_id: 402, label: 'S402', subject: 'S402: no kind field', age_s: 120 },
  ]));

  assert.deepEqual(allNodeLabels(html), ['T402', 'S402'],
    'an unknown kind still gets its label under the node');

  assert.deepEqual(devNode(html, 'aaaaaaa').lines, ['T402', 'dev: aaaaaaa — T402: tests · 5m ago'],
    'kind T has no meaning to add, so the first line is the bare label');
  assert.deepEqual(devNode(html, 'bbbbbbb').lines, ['S402', 'origin/dev: bbbbbbb — S402: no kind field · 2m ago'],
    'no kind field either: the label alone, then today\'s line');

  for (const sha7 of ['aaaaaaa', 'bbbbbbb']) {
    const first = devNode(html, sha7).lines[0];
    assert.ok(!/undefined|null/.test(first), `${sha7}'s first line names no missing value: "${first}"`);
    assert.ok(!/\s—\s*$/.test(first), `${sha7}'s first line does not end in a dangling dash: "${first}"`);
    assert.equal(devNode(html, sha7).lines.length, 2, `${sha7} still hovers as two lines`);
  }

  // A kind that names an inherited property must read as "no meaning", not as a function.
  const proto = render(state([
    { sha: 'eeeeeee555', full_sha: 'eeeeeee555', slice_id: 1, label: 'S1', kind: 'toString', subject: 'S1: x', age_s: 60 },
  ]));
  assert.deepEqual(devNode(proto, 'eeeeeee').lines, ['S1', 'origin/dev: eeeeeee — S1: x · 1m ago'],
    'kind "toString" finds no meaning rather than stringifying Object.prototype.toString');
});

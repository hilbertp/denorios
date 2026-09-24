'use strict';

/**
 * Journey: J-merge-dialog-one-human
 * Category: Gate & Merge
 *
 * Spec source: slice 368 — "The merge dialog stops asking for a second person."
 *
 * WHY THIS EXISTS: the "Run the gate?" dialog used to stop a RED FLAG behind a box
 * headed "A second reviewer (not the author of these changes) must confirm…", ticked
 * by "I am not the author, and I've confirmed…". There is no second human on this
 * project and never will be — Philipp is the only one — so the control was asking for
 * someone who does not exist, and the honest way to clear it was to lie. Philipp's
 * 09-01 ruling: never require a second human. The gate still STOPS by default on RED;
 * it now unlocks on ONE confirmation that names nobody.
 *
 * What this pins (behaviour, not wording of the code):
 *   - nothing the dialog puts on screen, in a title or in an aria-label says "author",
 *     "reviewer" or "second" — under every verdict, and on RED before and after the
 *     box is ticked;
 *   - RED FLAG still locks Run gate, behind exactly one unticked checkbox with one
 *     exact sentence; ticking unlocks, unticking locks again, and a freshly opened
 *     dialog is locked again;
 *   - CLEAR / NEEDS REVIEW / OVERRIDDEN carry no checkbox at all and leave Run gate
 *     free;
 *   - trap 1: the blocker list above the checkbox survives — "every item above" must
 *     have items above it;
 *   - trap 2: the NO VERDICT path is untouched — Run gate stays enabled, no checkbox.
 *
 * HOW: the dialog is BUILT by running the page's own confirmUpdateTests(),
 * _utcApplyVerdict(), _renderTestChanges() and confirmation toggle, lifted out of the
 * shipped lcars-dashboard.html into a minimal document shim, and fed payloads shaped
 * like the two endpoints it fetches. A hand-kept copy of the markup would go on
 * passing after the page changed underneath it. Nothing here reads a name it assumed:
 * the toggle is discovered from the onchange the page actually writes.
 *
 * Deliberately NOT asserted (and why):
 *   - the server checking the confirmation when Run gate dispatches (not built —
 *     ADR-JULIAN-ALONGSIDE slice E item 19);
 *   - the wording of the contract docs and role files (Philipp's own patch);
 *   - what makes a verdict RED (J-tests-needed-verdict owns the decision);
 *   - browser rendering (Julian's e2e owns the rendered page; the wiring is asserted
 *     here, against the shipped source).
 *
 * #99992: nothing here touches the live bridge/, the network, or a real browser.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');
const SRC = fs.readFileSync(DASH, 'utf8');

// The three words Philipp's ruling retires, any letter case, anywhere.
const FORBIDDEN = /author|reviewer|second/i;
const LABEL = 'I have confirmed every item above is intentional.';

// ── Lift the real dialog out of the page ────────────────────────────────────

// Brace-match a top-level declaration (`function f(`, `const X = {`) out of the source.
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

const APPLY_SRC = extractBlock(/\n\s*function _utcApplyVerdict\s*\(/);

// The toggle is whatever the checkbox's onchange actually names — read out of the
// shipped markup, never assumed, so renaming it does not fake a pass here.
const TOGGLE = (/onchange="([A-Za-z_$][\w$]*)\(\)"/.exec(APPLY_SRC) || [])[1];
assert.ok(TOGGLE, 'the RED-FLAG checkbox must wire an onchange handler');

const PAGE = [
  /\n\s*function _ghAhead\s*\(/,
  /\n\s*function _repoBaseUrl\s*\(/,
  /\n\s*function closeUpdateTestsOverlay\s*\(/,
  /\n\s*function _esc\s*\(/,
  /\n\s*function _renderTestChanges\s*\(/,
  /\n\s*const UTC_VERDICTS\s*=\s*\{/,
  new RegExp(`\\n\\s*function ${TOGGLE}\\s*\\(`),
  /\n\s*function confirmUpdateTests\s*\(/,
].map(extractBlock).join('\n') + '\n' + APPLY_SRC;

// ── A document just big enough for this dialog ──────────────────────────────

const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&mdash;/g, '—').replace(/&middot;/g, '·')
  .replace(/&times;/g, '×').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');

const stripTags = (html) => decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function attrValues(html, name) {
  const out = [];
  const re = new RegExp(`\\b${name}="([^"]*)"`, 'g');
  let m;
  while ((m = re.exec(html))) out.push(decode(m[1]));
  return out;
}

// Replace the inner HTML of the element carrying `id` inside `html`, matching its own
// closing tag by depth so a nested element of the same tag cannot cut the splice short.
function spliceInner(html, id, inner) {
  const open = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bid="${id}"[^>]*>`);
  const m = open.exec(html);
  assert.ok(m, `the dialog must carry a #${id} slot`);
  const tag = m[1];
  const start = m.index + m[0].length;
  const scan = new RegExp(`</?${tag}\\b[^>]*>`, 'g');
  scan.lastIndex = start;
  let depth = 1;
  let t;
  while ((t = scan.exec(html))) {
    if (t[0][1] === '/') {
      if (--depth === 0) return html.slice(0, start) + inner + html.slice(t.index);
    } else depth++;
  }
  throw new Error(`unbalanced <${tag}> around #${id}`);
}

function makeDocument() {
  const byId = new Map();

  function idTags(html) {
    const out = [];
    const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
    let m;
    while ((m = re.exec(html))) {
      const id = /\bid="([^"]+)"/.exec(m[2]);
      if (id) out.push({ id: id[1], attrs: m[2] });
    }
    return out;
  }

  // One element. Booleans and attributes come from the markup that declared it, so a
  // button shipped pre-disabled (or a box shipped pre-ticked) reads that way here too.
  function makeEl(attrs) {
    attrs = attrs || '';
    const seeded = {};
    const are = /\s([a-zA-Z-]+)="([^"]*)"/g;
    let a;
    while ((a = are.exec(attrs))) seeded[a[1]] = decode(a[2]);
    const el = {
      _attrs: seeded,
      _html: '',
      _own: [],
      written: false,
      className: '',
      title: seeded.title || '',
      disabled: /\sdisabled(?=[\s=>]|$)/.test(attrs),
      checked: /\schecked(?=[\s=>]|$)/.test(attrs),
      setAttribute(n, v) { this._attrs[n] = String(v); },
      removeAttribute(n) { delete this._attrs[n]; },
      getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; },
      hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); },
      remove() {},
      get innerHTML() { return this._html; },
      set innerHTML(v) {
        for (const id of this._own) byId.delete(id);
        this._html = String(v);
        this.written = true;
        this._own = [];
        for (const t of idTags(this._html)) { this._own.push(t.id); byId.set(t.id, makeEl(t.attrs)); }
      },
    };
    return el;
  }

  const doc = {
    byId,
    overlay: null,
    createElement() { this.overlay = makeEl(''); return this.overlay; },
    body: { appendChild() {} },
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return doc;
}

// Open the dialog for one verdict + one change payload and hand back what a person
// sitting in front of it can see and do.
async function openDialog(opts) {
  opts = opts || {};
  const doc = makeDocument();
  const api = new Function('deps', `
    const document = deps.document, fetch = deps.fetch;
    const _lastBranchState = deps._lastBranchState;
    ${PAGE}
    return { confirmUpdateTests, toggle: ${TOGGLE} };
  `)({
    document: doc,
    _lastBranchState: null,
    fetch: (url) => {
      if (url === '/api/test-changes') {
        return Promise.resolve({ json: () => Promise.resolve(opts.changes || { anyChange: false }) });
      }
      if (url === '/api/tests-needed') {
        return opts.verdictFails
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ json: () => Promise.resolve(opts.verdict) });
      }
      throw new Error(`the dialog asked for an endpoint nobody stubbed: ${url}`);
    },
  });

  api.confirmUpdateTests();
  // Both fetches resolve through promises; a macrotask hop drains every microtask.
  await new Promise((r) => setTimeout(r, 0));
  return view(doc, api);
}

// A live window on the open dialog: every reading is recomputed on access, so what it
// reports after a tick is what the page looks like after a tick, not a stale snapshot.
function view(doc, api) {
  const approve = doc.byId.get('utc-approve-btn');
  const confirmSlot = doc.byId.get('utc-confirm');
  const verdictSlot = doc.byId.get('utc-verdict');
  assert.ok(approve, 'the dialog must carry #utc-approve-btn');
  assert.ok(confirmSlot, 'the dialog must carry the #utc-confirm slot');
  assert.ok(verdictSlot, 'the dialog must carry the #utc-verdict slot');

  return {
    approve,
    confirmSlot,
    // The dialog as rendered: the card the page wrote, with every slot it filled spliced in.
    get html() {
      let html = doc.overlay._html;
      for (const id of doc.overlay._own) {
        const el = doc.byId.get(id);
        if (el && el.written) html = spliceInner(html, id, el._html);
      }
      return html;
    },
    // Every string the dialog shows or announces: its visible text, its titles, its
    // aria-labels, plus the Run-gate tooltip the code sets as a live property.
    get spoken() {
      const html = this.html;
      return [
        stripTags(html),
        ...attrValues(html, 'title'),
        ...attrValues(html, 'aria-label'),
        approve.title || '',
        approve.getAttribute('aria-label') || '',
      ];
    },
    get verdictChip() {
      const m = /<span class="utc-verdict-chip"[^>]*>([\s\S]*?)<\/span>/.exec(verdictSlot._html);
      return m ? stripTags(m[1]) : '';
    },
    get checkboxes() { return this.html.match(/<input\b[^>]*type="checkbox"[^>]*>/g) || []; },
    get box() { return doc.byId.get('utc-ack-box') || null; },
    get label() {
      const m = /<label\b[^>]*class="[^"]*utc-ack-check[^"]*"[^>]*>([\s\S]*?)<\/label>/.exec(confirmSlot._html);
      return m ? stripTags(m[1]) : null;
    },
    tick() { this.box.checked = true; api.toggle(); },
    untick() { this.box.checked = false; api.toggle(); },
  };
}

// ── Payloads shaped like the two endpoints, saying nothing the ruling retires ──

const F = 'regression/gate-merge/j-example.test.js';
const CHANGES = {
  anyChange: true,
  counts: { removed: 1, weakened: 1, renamed: 1, changed: 1, added: 1, modified: 3 },
  removed: [{ name: 'the gate refuses a dirty tree', file: F, slice: '361',
    plain: 'Slice 361 removed the check “the gate refuses a dirty tree” and put nothing in its place. Intended?' }],
  weakened: [{ name: 'promote pins the head sha', file: F, slice: '362',
    plain: 'Slice 362 weakened the check “promote pins the head sha”. Intended?' }],
  renamed: [{ name: 'the ribbon names the live branch', file: F, slice: '362',
    plain: 'Slice 362 renamed the check “the ribbon names the branch”; it still runs.' }],
  changed: [{ name: 'the heartbeat is written by the clock', file: F, slice: '362',
    plain: 'Slice 362 changed what the check “the heartbeat is written by the clock” looks for. Intended?' }],
  added: [{ name: 'a fresh dialog opens locked', file: F, slice: '368' }],
};
const BLOCKERS = [
  { kind: 'removed', name: 'the gate refuses a dirty tree' },
  { kind: 'weakened', name: 'promote pins the head sha' },
];
const RED = { decision: 'red_flag', head7: 'ab12cd3', blockers: BLOCKERS };

// ── slice-368-ac-1 ──────────────────────────────────────────────────────────
// @ac-hash: slice-368-ac-1 sha256:cd7c4262ce4650e0c5950a1cb082576826fa7c7c12b8cbd6e3a2bdbd96ac3909
test('J-merge-dialog-one-human slice-368-ac-1 — no verdict of the dialog says "author", "reviewer" or "second", before or after the box is ticked', async () => {
  // The premise: the payloads are clean, so anything the dialog says is the dialog's own.
  assert.doesNotMatch(JSON.stringify([CHANGES, RED]), FORBIDDEN,
    'the fixture must not smuggle the retired words in through the server payload');

  for (const decision of ['clear', 'needs_review', 'overridden', 'red_flag', 'sideways']) {
    const d = await openDialog({ changes: CHANGES, verdict: { decision, head7: 'ab12cd3', blockers: BLOCKERS } });
    assert.ok(d.verdictChip, `${decision}: the verdict chip must render`);
    for (const said of d.spoken) {
      assert.doesNotMatch(said, FORBIDDEN, `${decision}: the dialog must not say it — "${said.slice(0, 160)}"`);
    }
  }

  // RED again, read after the operator ticks the box and after unticking it: the
  // Run-gate tooltip the toggle writes is part of what the dialog says, and it is the
  // one string the operator only ever sees from the toggle.
  const red = await openDialog({ changes: CHANGES, verdict: RED });
  assert.equal(red.verdictChip, '✗ RED FLAG');
  red.tick();
  for (const said of red.spoken) assert.doesNotMatch(said, FORBIDDEN, `ticked: "${said.slice(0, 160)}"`);
  red.untick();
  for (const said of red.spoken) assert.doesNotMatch(said, FORBIDDEN, `unticked again: "${said.slice(0, 160)}"`);
});

// ── slice-368-ac-2 ──────────────────────────────────────────────────────────
// @ac-hash: slice-368-ac-2 sha256:1150fe5010a1eb9a623e1881ba0697d095788fec62b8e3b4d8b32e113d732f8e
test('J-merge-dialog-one-human slice-368-ac-2 — RED FLAG opens locked behind one unticked box; ticking unlocks Run gate, unticking locks it again', async () => {
  // …with a list of items, with an empty list, and with no list at all.
  for (const [what, verdict] of [
    ['items', RED],
    ['an empty list', { decision: 'red_flag', head7: 'ab12cd3', blockers: [] }],
    ['no list', { decision: 'red_flag', head7: 'ab12cd3' }],
  ]) {
    const d = await openDialog({ changes: CHANGES, verdict });
    assert.equal(d.verdictChip, '✗ RED FLAG', `${what}: the chip must show RED FLAG`);

    assert.equal(d.checkboxes.length, 1, `${what}: exactly one checkbox`);
    assert.doesNotMatch(d.checkboxes[0], /\schecked(?=[\s=>]|$)/, `${what}: it ships unticked`);
    assert.ok(d.box, `${what}: the checkbox is addressable as #utc-ack-box`);
    assert.equal(d.box.checked, false, `${what}: and reads back unticked`);
    assert.equal(d.label, LABEL, `${what}: the label names nobody`);

    assert.equal(d.approve.disabled, true, `${what}: Run gate opens locked`);
    assert.equal(d.approve.getAttribute('aria-disabled'), 'true', `${what}: and says so`);

    d.tick();
    assert.equal(d.approve.disabled, false, `${what}: one tick unlocks Run gate`);
    assert.equal(d.approve.getAttribute('aria-disabled'), null, `${what}: and drops aria-disabled`);

    d.untick();
    assert.equal(d.approve.disabled, true, `${what}: unticking locks it again`);
    assert.equal(d.approve.getAttribute('aria-disabled'), 'true', `${what}: and says so again`);
  }

  // Every time it opens: a second opening after a first was ticked is locked again.
  const first = await openDialog({ changes: CHANGES, verdict: RED });
  first.tick();
  assert.equal(first.approve.disabled, false);
  const again = await openDialog({ changes: CHANGES, verdict: RED });
  assert.equal(again.box.checked, false, 'a freshly opened dialog opens unticked');
  assert.equal(again.approve.disabled, true, 'and locked, whatever the last one ended as');
  assert.equal(again.approve.getAttribute('aria-disabled'), 'true');
});

// ── slice-368-ac-3 ──────────────────────────────────────────────────────────
// @ac-hash: slice-368-ac-3 sha256:e59da76cef2236232b7a1c378ad08a2d3057839e443075fcbba2e8761fad8d2a
test('J-merge-dialog-one-human slice-368-ac-3 — CLEAR, NEEDS REVIEW and OVERRIDDEN carry no checkbox and leave Run gate free', async () => {
  for (const [decision, chip] of [['clear', '✓ CLEAR'], ['needs_review', '● NEEDS REVIEW'], ['overridden', '◑ OVERRIDDEN']]) {
    // Blockers are handed over too: a non-RED verdict must not grow a box from them.
    const d = await openDialog({ changes: CHANGES, verdict: { decision, head7: 'ab12cd3', blockers: BLOCKERS } });
    assert.equal(d.verdictChip, chip, `${decision}: the chip must show ${chip}`);
    assert.equal(d.checkboxes.length, 0, `${decision}: no checkbox anywhere in the dialog`);
    assert.equal(d.confirmSlot.innerHTML, '', `${decision}: the confirmation slot is empty`);
    assert.equal(d.approve.disabled, false, `${decision}: Run gate is free`);
    assert.equal(d.approve.getAttribute('aria-disabled'), null, `${decision}: with no aria-disabled`);
  }
});

// ── trap 1 ──────────────────────────────────────────────────────────────────
// "Confirm every item above" needs items above it. Rewriting the box could drop the
// blocker list and leave the operator confirming an empty screen.
// @ac-hash: slice-368-ac-2 sha256:1150fe5010a1eb9a623e1881ba0697d095788fec62b8e3b4d8b32e113d732f8e
test('J-merge-dialog-one-human slice-368-ac-2 trap-items-above-the-box — the RED FLAG items still list above the checkbox, each with its kind and its name', async () => {
  const d = await openDialog({ changes: CHANGES, verdict: RED });
  const slot = d.confirmSlot.innerHTML;

  const list = /<ul class="utc-ack-list">([\s\S]*?)<\/ul>/.exec(slot);
  assert.ok(list, 'the blockers still render as a list');
  const rows = list[1].match(/<li>[\s\S]*?<\/li>/g) || [];
  assert.equal(rows.length, BLOCKERS.length, 'one row per blocker the verdict named');
  for (let i = 0; i < BLOCKERS.length; i++) {
    assert.match(stripTags(rows[i]), new RegExp(BLOCKERS[i].kind, 'i'), 'the row says what kind of item it is');
    assert.ok(stripTags(rows[i]).includes(BLOCKERS[i].name), 'and names the check');
  }

  assert.ok(slot.indexOf(list[0]) < slot.indexOf('type="checkbox"'),
    'the list sits ABOVE the checkbox — "every item above" must have items above it');
});

// ── trap 2 ──────────────────────────────────────────────────────────────────
// An unreadable verdict is NOT a RED FLAG. It shows NO VERDICT and leaves Run gate
// alone; changing the RED branch must not drag this path with it.
// @ac-hash: slice-368-ac-3 sha256:e59da76cef2236232b7a1c378ad08a2d3057839e443075fcbba2e8761fad8d2a
test('J-merge-dialog-one-human slice-368-ac-3 trap-no-verdict-untouched — an unreadable verdict still shows NO VERDICT, no checkbox, and leaves Run gate enabled', async () => {
  const cases = [
    ['the request fails', { changes: CHANGES, verdictFails: true }],
    ['the payload is an error', { changes: CHANGES, verdict: { available: false, error: 'no git' } }],
    ['the decision is one the dialog does not know', { changes: CHANGES, verdict: { decision: 'sideways', blockers: BLOCKERS } }],
  ];
  for (const [what, opts] of cases) {
    const d = await openDialog(opts);
    assert.equal(d.verdictChip, '? NO VERDICT', `${what}: the chip must show NO VERDICT`);
    assert.equal(d.checkboxes.length, 0, `${what}: no checkbox appears`);
    assert.equal(d.confirmSlot.innerHTML, '', `${what}: the confirmation slot stays empty`);
    assert.equal(d.approve.disabled, false, `${what}: Run gate stays enabled`);
    assert.equal(d.approve.getAttribute('aria-disabled'), null, `${what}: with no aria-disabled`);
  }
});

'use strict';

/**
 * J-ten-rows-a-page — slice 385: every list on the operations page turns pages.
 *
 * The Backlog Queue printed every row it had. Nine proposals were staged the evening
 * this was written and the number only goes up, so the panel that most needed a pager
 * was the one that never had one. History had a pager but set to 25, so the two panels
 * behaved differently and neither was a comfortable read.
 *
 * These tests run the page's OWN functions, lifted out of lcars-dashboard.html the way
 * j-backlog-row-controls.test.js and j-history-chronological-order.test.js lift theirs.
 * A hand-kept copy of a slicer would go on passing after the page changed underneath it,
 * which is the one thing a safety net must not do. The page size is read out of the
 * source, never written down here: a test that hardcoded ten would keep passing if
 * someone quietly made it fifty.
 */

// @ac-hash: slice-385-ac-1 sha256:8d49e82acb0752a6421c5f50b0aa6b8bef0a77a199588c5c1f32b08063849421
// @ac-hash: slice-385-ac-2 sha256:bccbb55e0e024ca3d1db57710a91a4b73d1a8fa5c78475cdbce6731f167be805
// @ac-hash: slice-385-ac-3 sha256:3a8dc2653f847c591b0a8178ae0bae743842c7842a935aab1124815ce964bfc0
// @ac-hash: slice-385-ac-4 sha256:9ce657a504b131bf441143f20e30fb548b997ce3b3dc77112630322daddc2002
// @ac-hash: slice-385-ac-5 sha256:6144f8e7dc39a92ddccfd098a52458761a912eb55aa0f07f3acb90f61cf0eb1b
// @ac-hash: slice-385-ac-6 sha256:cd96bff22de70af125def973070038bab8820c3d54518a140cfd51d778be8e2f

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');
const SRC = fs.readFileSync(DASH, 'utf8');

// ── Lifting the real page logic ─────────────────────────────────────────────

function extractFn(name) {
  const start = SRC.search(new RegExp(`\\n\\s*(?:async )?function ${name}\\s*\\(`));
  assert.notEqual(start, -1, `function ${name}() must exist in lcars-dashboard.html`);
  const i = SRC.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces while extracting ${name}()`);
}

function extractConst(name) {
  const m = SRC.match(new RegExp(`\\n\\s*const ${name}\\s*=\\s*[^;]+;`));
  assert.ok(m, `const ${name} must exist in lcars-dashboard.html`);
  return m[0];
}

// The page's own page size. Never copied: every count below is derived from it. Read per
// test rather than once at load, so a page that lost its pagination fails each test on its
// own terms instead of taking the whole file down before any of them run.
const pageSize = () => vm.runInNewContext(`${extractConst('LIST_PAGE_SIZE')}\nLIST_PAGE_SIZE`, {});

// ── The Backlog Queue panel ─────────────────────────────────────────────────

function loadQueue({ bridgeSlices = [], stagedItems = [], queueOrder = [], stagedOrder = [] } = {}) {
  const container = { innerHTML: '' };
  const factory = new Function('deps', `
    const document = deps.document;
    const setTimeout = deps.setTimeout;
    let _lastBridgeData = null;
    let _pendingEnterIds = new Set();
    let cachedRegisterEvents = [];
    let cachedHistoryAllRows = [];
    let cachedBridgeSlices = deps.bridgeSlices;
    let cachedStagedItems = deps.stagedItems;
    let cachedQueueOrder = deps.queueOrder;
    let cachedStagedOrder = deps.stagedOrder;
    let autoApproveOn = false;
    let queueApprovedPage = 1;
    let queueProposedPage = 1;
    const setupDragAndDrop = () => {};
    const restoreQueueExpanded = () => {};
    const autoApproveSweep = () => {};
    ${extractConst('LIST_PAGE_SIZE')}
    ${extractFn('clampListPage')}
    ${extractFn('escHtml')}
    ${extractFn('isApendment')}
    ${extractFn('buildQueueRows')}
    ${extractFn('renderQueueRow')}
    ${extractFn('queuePagerHtml')}
    ${extractFn('queueApprovedGoPage')}
    ${extractFn('queueProposedGoPage')}
    ${extractFn('renderQueueList')}
    return {
      renderQueueList,
      queueApprovedGoPage,
      queueProposedGoPage,
      setBridgeSlices: (v) => { cachedBridgeSlices = v; },
      setStagedItems: (v) => { cachedStagedItems = v; },
      approvedPage: () => queueApprovedPage,
      proposedPage: () => queueProposedPage,
    };
  `);
  const api = factory({
    document: { getElementById: (id) => (id === 'queue-list' ? container : null), querySelector: () => null },
    setTimeout: () => {},
    bridgeSlices, stagedItems,
    queueOrder: [...queueOrder],
    stagedOrder: [...stagedOrder],
  });
  return { ...api, container };
}

// The panel draws one list, divided in two by the dashed rule. Split it back apart the
// way the operator reads it: everything above the divider is Approved Work Orders,
// everything below is Proposed Improvement.
function sections(html) {
  const at = html.indexOf('<hr class="queue-section-divider">');
  assert.notEqual(at, -1, 'the panel still divides its two sections with the dashed rule');
  return { approved: html.slice(0, at), proposed: html.slice(at) };
}
const idsIn = (html) => [...html.matchAll(/class="queue-row[^"]*" data-id="([^"]*)"/g)].map((m) => m[1]);
const pagerIn = (html, id) => {
  const m = html.match(new RegExp(`<div id="${id}"[^>]*>[\\s\\S]*?</div>`));
  return m ? m[0] : null;
};
const positionsIn = (html) => [...html.matchAll(/queue-position-num">(\d+)\./g)].map((m) => Number(m[1]));

const approvedSlices = (n, from = 5000) =>
  Array.from({ length: n }, (_, i) => ({ id: String(from + i), title: `Work order ${from + i}`, state: 'QUEUED', references: null }));
const proposals = (n, from = 9000) =>
  Array.from({ length: n }, (_, i) => ({ id: String(from + i), title: `Proposal ${from + i}`, status: 'STAGED', references: null }));
const idsOf = (rows) => rows.map((r) => r.id);

// ── The History panel ───────────────────────────────────────────────────────

function fakeEl() {
  const classes = new Set(['hidden']);
  return {
    innerHTML: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
  };
}

function loadHistory() {
  const listEl = fakeEl();
  const pageEl = fakeEl();
  const factory = new Function('deps', `
    const document = deps.document;
    const historyExpandedSet = new Set();
    const humanReason = (r) => String(r);
    let cachedHistoryItems = [];
    let cachedHistoryAllRows = [];
    let historyPage = 1;
    ${extractConst('LIST_PAGE_SIZE')}
    ${extractConst('INPUT_COST_PER_M')}
    ${extractConst('OUTPUT_COST_PER_M')}
    ${extractFn('clampListPage')}
    ${extractFn('escHtml')}
    ${extractFn('classifyTerminalOutcome')}
    ${extractFn('getTerminalRound')}
    ${extractFn('foldLegacyApendments')}
    ${extractFn('historyTerminalTime')}
    ${extractFn('orderHistoryRowsByRecency')}
    ${extractFn('renderHistoryPanel')}
    ${extractFn('fmtDuration')}
    ${extractFn('fmtTerminalTs')}
    ${extractFn('fmtTokens')}
    ${extractFn('fmtCost')}
    ${extractFn('fmtCostWithFallback')}
    ${extractFn('isFailureOutcome')}
    ${extractFn('outcomeHtml')}
    ${extractFn('renderHistoryPage')}
    ${extractFn('historyGoPage')}
    return { renderHistoryPanel, historyGoPage, page: () => historyPage };
  `);
  const api = factory({
    document: { getElementById: (id) => ({ 'history-list': listEl, 'history-pagination': pageEl }[id] || null) },
  });
  return { ...api, listEl, pageEl };
}

const historyIds = (listEl) => [...listEl.innerHTML.matchAll(/data-history-id="([^"]*)"/g)].map((m) => m[1]);
const completedSlices = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(600 + i), title: `Slice ${600 + i}`, outcome: 'DONE',
    completedAt: new Date(Date.UTC(2026, 8, 2, 0, i)).toISOString(), reviewStatus: 'accepted',
  }));

// ── A drag harness that only knows about the rows currently on screen ───────
// This is the paginated world: the DOM holds one page, so a drop handler that reads the
// DOM for its order can only ever see ten ids.

function makeDragHarness({ visibleRows, queueOrder = [], stagedOrder = [], stagedItems = [] }) {
  const posts = [];
  const el = (row) => ({
    dataset: { id: row.id, state: row.state, apendment: String(!!row.apendment) },
    classList: { add() {}, remove() {} },
  });
  const ctx = {
    dragSrcId: null,
    cachedQueueOrder: [...queueOrder],
    cachedStagedOrder: [...stagedOrder],
    cachedStagedItems: stagedItems.map((s) => ({ ...s })),
    renderQueueList() {},
    fetch(url, opts) { posts.push({ url, order: JSON.parse(opts.body).order }); return Promise.resolve({ ok: true }); },
    document: {
      querySelector(sel) {
        const m = sel.match(/data-id="([^"]*)"/);
        const row = m && visibleRows.find((r) => r.id === m[1]);
        return row ? el(row) : null;   // a row on another page simply is not there
      },
    },
  };
  const api = vm.runInNewContext(
    `${extractFn('onDragOver')}\n${extractFn('onDrop')}\n({ onDragOver, onDrop })`, ctx);

  function drag(srcId, targetRow) {
    ctx.dragSrcId = srcId;
    const mk = () => {
      const ev = { prevented: false, preventDefault() { ev.prevented = true; }, currentTarget: el(targetRow), dataTransfer: {} };
      return ev;
    };
    const over = mk();
    api.onDragOver(over);
    api.onDrop(mk());
    ctx.dragSrcId = null;
    return over.prevented;
  }
  return { ctx, posts, drag };
}
const here = (arr) => [...arr];

// ── slice-385-ac-1 ──────────────────────────────────────────────────────────

test('slice-385-ac-1 the History panel shows at most ten rows at a time and its pager reaches every completed slice', () => {
  const h = loadHistory();
  const total = 3 * pageSize() + 4;            // deliberately not a whole number of pages
  const recent = completedSlices(total);
  h.renderHistoryPanel(recent, []);

  assert.equal(pageSize(), 10, 'ten rows a page is the product decision this slice locked in');
  assert.equal(historyIds(h.listEl).length, pageSize(),
    `History draws ${pageSize()} rows a page, not the whole log`);

  // Every completed slice is still reachable, by turning the pages the panel offers.
  const seen = new Set();
  for (let guard = 0; guard <= total; guard++) {
    historyIds(h.listEl).forEach((id) => seen.add(id));
    assert.ok(historyIds(h.listEl).length <= pageSize(), 'no page ever exceeds the page size');
    const older = /<button class="history-pg-btn"[^>]*>older/.exec(h.pageEl.innerHTML);
    assert.ok(older, 'the panel offers an "older" control on every page');
    if (/disabled/.test(older[0])) break;
    h.historyGoPage(h.page() + 1);
  }
  assert.equal(seen.size, total, `all ${total} completed slices must be reachable; only ${seen.size} were`);
  assert.deepEqual([...seen].sort(), idsOf(recent).sort());
});

// ── slice-385-ac-2 ──────────────────────────────────────────────────────────

test('slice-385-ac-2 the Approved Work Orders section shows at most ten rows at a time and has its own pager', () => {
  const total = 2 * pageSize() + 3;
  const slices = approvedSlices(total);
  const q = loadQueue({ bridgeSlices: slices, queueOrder: idsOf(slices) });
  q.renderQueueList();

  const first = sections(q.container.innerHTML).approved;
  assert.equal(idsIn(first).length, pageSize(), `the approved section draws ${pageSize()} rows, not all ${total}`);
  assert.deepEqual(idsIn(first), idsOf(slices).slice(0, pageSize()), 'and draws the head of the queue first');

  const pager = pagerIn(first, 'queue-approved-pagination');
  assert.ok(pager, 'the approved section carries its own pager');
  assert.match(pager, /page 1 of 3/, 'which says where the operator is');
  assert.match(pager, /<button class="history-pg-btn"[^>]*\bdisabled\b[^>]*>← prev</,
    'with "prev" disabled on the first page');
  assert.doesNotMatch(pager, /<button class="history-pg-btn"[^>]*\bdisabled\b[^>]*>next →</,
    'and "next" live, because there is a page 2');

  // Every approved work order is reachable by turning the pages.
  const seen = new Set();
  const pages = [];
  for (let guard = 0; guard <= total; guard++) {
    const s = sections(q.container.innerHTML).approved;
    idsIn(s).forEach((id) => seen.add(id));
    pages.push(q.approvedPage());
    assert.ok(idsIn(s).length <= pageSize(), 'no page ever exceeds the page size');
    if (q.approvedPage() >= Math.ceil(total / pageSize())) break;
    q.queueApprovedGoPage(q.approvedPage() + 1);
  }
  assert.deepEqual(pages, [1, 2, 3], 'the pages walk forward one at a time');
  assert.deepEqual([...seen].sort(), idsOf(slices).sort(), 'every approved work order is reachable');

  // The build-order number counts from the head of the queue, not the head of the page.
  assert.deepEqual(positionsIn(sections(q.container.innerHTML).approved),
    [2 * pageSize() + 1, 2 * pageSize() + 2, 2 * pageSize() + 3],
    'the last page numbers its rows 21, 22, 23 — not 1, 2, 3');
});

// ── slice-385-ac-3 ──────────────────────────────────────────────────────────

test('slice-385-ac-3 the Proposed Improvement section pages ten at a time, independently of the approved section', () => {
  const approved = approvedSlices(2 * pageSize() + 1);
  const staged = proposals(3 * pageSize() + 2);
  const q = loadQueue({
    bridgeSlices: approved, queueOrder: idsOf(approved),
    stagedItems: staged, stagedOrder: idsOf(staged),
  });
  q.renderQueueList();

  const one = sections(q.container.innerHTML);
  assert.equal(idsIn(one.proposed).length, pageSize(),
    `the proposed section draws ${pageSize()} rows, not all ${staged.length}`);
  const pager = pagerIn(one.proposed, 'queue-proposed-pagination');
  assert.ok(pager, 'the proposed section carries its own pager');
  assert.match(pager, /page 1 of 4/);
  assert.equal(pagerIn(one.proposed, 'queue-approved-pagination'), null,
    'the approved pager does not live in the proposed section');
  assert.equal(pagerIn(one.approved, 'queue-proposed-pagination'), null,
    'and the proposed pager does not live in the approved one — two lists, two pagers');

  // Two lists, two page numbers. Turning one leaves the other exactly where it was.
  q.queueProposedGoPage(3);
  const two = sections(q.container.innerHTML);
  assert.equal(q.proposedPage(), 3);
  assert.equal(q.approvedPage(), 1, 'paging the proposals must not move the approved section');
  assert.deepEqual(idsIn(two.proposed), idsOf(staged).slice(2 * pageSize(), 3 * pageSize()));
  assert.deepEqual(idsIn(two.approved), idsOf(approved).slice(0, pageSize()),
    'the approved section still shows its first page');

  q.queueApprovedGoPage(2);
  const three = sections(q.container.innerHTML);
  assert.equal(q.proposedPage(), 3, 'and paging the approved section must not move the proposals');
  assert.deepEqual(idsIn(three.approved), idsOf(approved).slice(pageSize(), 2 * pageSize()));
  assert.deepEqual(idsIn(three.proposed), idsOf(staged).slice(2 * pageSize(), 3 * pageSize()));

  // Every proposal is reachable.
  const seen = new Set();
  q.queueProposedGoPage(1);
  for (let p = 1; p <= Math.ceil(staged.length / pageSize()); p++) {
    q.queueProposedGoPage(p);
    idsIn(sections(q.container.innerHTML).proposed).forEach((id) => seen.add(id));
  }
  assert.deepEqual([...seen].sort(), idsOf(staged).sort(), 'every proposal is reachable');
});

// ── slice-385-ac-4 ──────────────────────────────────────────────────────────

test('slice-385-ac-4 a pager is not rendered for a list that fits on one page', () => {
  // The ordinary evening: one approved work order, a handful of proposals. The operator
  // sees no pager above the divider at all, and none below it either.
  const ordinary = loadQueue({
    bridgeSlices: approvedSlices(1), queueOrder: ['5000'],
    stagedItems: proposals(3), stagedOrder: ['9000', '9001', '9002'],
  });
  ordinary.renderQueueList();
  assert.equal(pagerIn(ordinary.container.innerHTML, 'queue-approved-pagination'), null,
    'one work order needs no pager');
  assert.equal(pagerIn(ordinary.container.innerHTML, 'queue-proposed-pagination'), null,
    'three proposals need no pager');
  assert.doesNotMatch(ordinary.container.innerHTML, /history-pager|history-pg-btn/,
    'and nothing pager-shaped is drawn in the panel at all');

  // Exactly a full page is still one page: the boundary, not one short of it.
  const exact = loadQueue({
    bridgeSlices: approvedSlices(pageSize()), queueOrder: idsOf(approvedSlices(pageSize())),
    stagedItems: proposals(pageSize()), stagedOrder: idsOf(proposals(pageSize())),
  });
  exact.renderQueueList();
  assert.equal(idsIn(sections(exact.container.innerHTML).approved).length, pageSize());
  assert.equal(pagerIn(exact.container.innerHTML, 'queue-approved-pagination'), null,
    `exactly ${pageSize()} rows fit on one page, so no pager`);
  assert.equal(pagerIn(exact.container.innerHTML, 'queue-proposed-pagination'), null);

  // One more row and each pager appears.
  const over = loadQueue({
    bridgeSlices: approvedSlices(pageSize() + 1), queueOrder: idsOf(approvedSlices(pageSize() + 1)),
    stagedItems: proposals(pageSize() + 1), stagedOrder: idsOf(proposals(pageSize() + 1)),
  });
  over.renderQueueList();
  assert.ok(pagerIn(over.container.innerHTML, 'queue-approved-pagination'),
    `${pageSize() + 1} work orders do not fit, so the pager is drawn`);
  assert.ok(pagerIn(over.container.innerHTML, 'queue-proposed-pagination'),
    `${pageSize() + 1} proposals do not fit, so the pager is drawn`);

  // History is deliberately not in this list. Slice 380 made its bar a COUNT bar —
  // "showing 3 of 3" tells a whole log apart from a truncated one — and this brief says
  // nothing else in History changes. Its single-page behaviour is pinned by
  // regression/observability/j-history-chronological-order.test.js (slice-380-ac-3).
});

// ── slice-385-ac-5 ──────────────────────────────────────────────────────────

test('slice-385-ac-5 dragging a row to a new position preserves the order of every row on the pages that are not visible', () => {
  const total = 3 * pageSize();
  const slices = approvedSlices(total);
  const order = idsOf(slices);

  // Render the panel, then hand the drag harness ONLY the rows that reached the screen.
  const q = loadQueue({ bridgeSlices: slices, queueOrder: order });
  q.renderQueueList();
  const visible = idsIn(sections(q.container.innerHTML).approved);
  assert.equal(visible.length, pageSize(), 'the DOM holds one page, which is the whole trap');

  const h = makeDragHarness({
    visibleRows: visible.map((id) => ({ id, state: 'QUEUED' })),
    queueOrder: order,
  });
  assert.equal(h.drag(visible[4], { id: visible[0], state: 'QUEUED' }), true,
    'two rows on the same page are still a legal drop pair');

  assert.equal(h.posts.length, 1, 'one reorder, one POST');
  assert.equal(h.posts[0].url, '/api/queue/order');
  const persisted = here(h.posts[0].order);

  assert.equal(persisted.length, total,
    `all ${total} work orders must survive the drop; ${persisted.length} were persisted`);
  assert.deepEqual([...persisted].sort(), [...order].sort(), 'no id is invented and none is lost');

  const expected = order.filter((id) => id !== visible[4]);
  expected.splice(expected.indexOf(visible[0]), 0, visible[4]);
  assert.deepEqual(persisted, expected, 'the dragged row lands ahead of its target and nothing else moves');

  // The pages the operator could not see are untouched, in value AND in sequence.
  assert.deepEqual(persisted.slice(pageSize()), order.slice(pageSize()),
    'pages 2 and 3 come back exactly as they went in');
});

// ── trap 1 ──────────────────────────────────────────────────────────────────

test('slice-385-ac-5 trap 1 — a reorder persists the whole list, never the ten ids that happen to be in the DOM', () => {
  const staged = proposals(2 * pageSize() + 5);
  const order = idsOf(staged);
  const q = loadQueue({ stagedItems: staged, stagedOrder: order });
  q.renderQueueList();
  const visible = idsIn(sections(q.container.innerHTML).proposed);
  assert.equal(visible.length, pageSize());

  const h = makeDragHarness({
    visibleRows: visible.map((id) => ({ id, state: 'STAGED' })),
    stagedOrder: order,
    stagedItems: staged,
  });
  h.drag(visible[7], { id: visible[2], state: 'STAGED' });

  const persisted = here(h.posts[0].order);
  assert.notEqual(persisted.length, pageSize(),
    'a ten-id order is the bug: the DOM held ten rows, the list holds ' + order.length);
  assert.equal(persisted.length, order.length, 'the full proposed list is persisted');
  assert.deepEqual([...persisted].sort(), [...order].sort(), 'nothing on another page was dropped');

  // And the client's own cached order agrees with what went to the server, so the next
  // render draws what was persisted rather than a second, shorter truth.
  assert.deepEqual(here(h.ctx.cachedStagedOrder), persisted);

  // The same holds for the approved list: dragging within page 1 of a three-page queue
  // must not silently truncate the queue to page 1.
  const slices = approvedSlices(3 * pageSize());
  const qOrder = idsOf(slices);
  const a = makeDragHarness({
    visibleRows: qOrder.slice(0, pageSize()).map((id) => ({ id, state: 'QUEUED' })),
    queueOrder: qOrder,
  });
  a.drag(qOrder[1], { id: qOrder[0], state: 'QUEUED' });
  assert.equal(here(a.posts[0].order).length, qOrder.length,
    'the approved reorder persists all three pages too');
});

// ── trap 2 ──────────────────────────────────────────────────────────────────

test('slice-385-ac-2 trap 2 — the page number survives a routine re-render and is clamped, not reset, when the list shrinks', () => {
  const slices = approvedSlices(3 * pageSize());
  const q = loadQueue({ bridgeSlices: slices, queueOrder: idsOf(slices) });
  q.renderQueueList();
  q.queueApprovedGoPage(2);
  assert.equal(q.approvedPage(), 2);

  // The background poll re-renders every few seconds. It must leave the operator alone.
  q.renderQueueList();
  q.renderQueueList();
  assert.equal(q.approvedPage(), 2, 'a re-render must not bounce the operator back to page 1');
  assert.deepEqual(idsIn(sections(q.container.innerHTML).approved), idsOf(slices).slice(pageSize(), 2 * pageSize()));

  // A slice dispatches and leaves the queue while the operator is on page 3: the list
  // shrinks under them. The page clamps to the last page that exists — it does not
  // collapse to page 1, and it does not render an empty page 3.
  q.queueApprovedGoPage(3);
  assert.equal(q.approvedPage(), 3);
  const shrunk = slices.slice(0, pageSize() + 2);
  q.setBridgeSlices(shrunk);
  q.renderQueueList();
  assert.equal(q.approvedPage(), 2, 'page 3 no longer exists, so the operator lands on page 2 — the last one that does');
  assert.equal(idsIn(sections(q.container.innerHTML).approved).length, 2);

  // Shrink it to a single page and the page number follows all the way down.
  q.setBridgeSlices(slices.slice(0, 3));
  q.renderQueueList();
  assert.equal(q.approvedPage(), 1);
  assert.equal(pagerIn(q.container.innerHTML, 'queue-approved-pagination'), null);

  // A page number the operator could never reach is clamped the same way, from either end.
  q.setBridgeSlices(slices);
  q.renderQueueList();
  q.queueApprovedGoPage(99);
  assert.equal(q.approvedPage(), 3, 'past the end lands on the last page');
  q.queueApprovedGoPage(0);
  assert.equal(q.approvedPage(), 1, 'before the start lands on the first');

  // Both sections clamp by the same rule.
  const staged = proposals(2 * pageSize() + 1);
  const p = loadQueue({ stagedItems: staged, stagedOrder: idsOf(staged) });
  p.renderQueueList();
  p.queueProposedGoPage(3);
  assert.equal(p.proposedPage(), 3);
  p.setStagedItems(staged.slice(0, pageSize() + 1));
  p.renderQueueList();
  assert.equal(p.proposedPage(), 2, 'the proposed section clamps exactly as the approved one does');
});

// ── trap 3 ──────────────────────────────────────────────────────────────────

test('slice-385-ac-5 trap 3 — dragging across a page boundary is not offered, and a pair that spans one is refused rather than persisted', () => {
  const slices = approvedSlices(3 * pageSize());
  const order = idsOf(slices);
  const q = loadQueue({ bridgeSlices: slices, queueOrder: order });
  q.renderQueueList();

  // There is nothing on the page to drop onto: a row two pages down is not in the DOM,
  // so the browser is never given a cross-page drop to make. This slice accepts that.
  const drawn = idsIn(sections(q.container.innerHTML).approved);
  const offPage = order[2 * pageSize()];
  assert.equal(drawn.includes(offPage), false, 'a row on page 3 is simply not on screen');
  assert.doesNotMatch(sections(q.container.innerHTML).approved, new RegExp(`data-id="${offPage}"`),
    'and the panel holds no element for it to be dropped onto');

  // The one way such a pair can arise — the panel re-pages under a drag in flight, so the
  // source row is gone — is refused: no drop target is marked, and nothing is persisted.
  const h = makeDragHarness({
    visibleRows: drawn.map((id) => ({ id, state: 'QUEUED' })),
    queueOrder: order,
  });
  assert.equal(h.drag(offPage, { id: drawn[0], state: 'QUEUED' }), false,
    'a source that is not on the rendered page is not a legal drop pair');
  assert.deepEqual(h.posts, [], 'and a refused drop persists nothing');
  assert.deepEqual(here(h.ctx.cachedQueueOrder), order, 'the order is left exactly as it was');
});

// ── trap 4 ──────────────────────────────────────────────────────────────────

test('slice-385-ac-4 trap 4 — all three pagers answer to the same name, and History keeps the two it already had', () => {
  assert.match(SRC, /<div id="history-pagination" class="[^"]*\bhistory-pager\b[^"]*">/,
    'History\'s pager keeps BOTH names: the id its guard reads and the class a console probe guesses');

  const slices = approvedSlices(pageSize() + 1);
  const staged = proposals(pageSize() + 1);
  const q = loadQueue({
    bridgeSlices: slices, queueOrder: idsOf(slices),
    stagedItems: staged, stagedOrder: idsOf(staged),
  });
  q.renderQueueList();

  for (const id of ['queue-approved-pagination', 'queue-proposed-pagination']) {
    const pager = pagerIn(q.container.innerHTML, id);
    assert.ok(pager, `#${id} is a name a console probe would guess`);
    assert.match(pager, /class="[^"]*\bhistory-pager\b[^"]*"/,
      `#${id} wears the same history-pager name, so one probe finds all three pagers`);
    assert.match(pager, /<button class="history-pg-btn"/, 'and the same controls');
    assert.match(pager, /<span class="history-pg-info">/, 'and the same count line');
  }

  // The pager's look hangs off the class, not off History's id — otherwise the two new
  // pagers would be unstyled boxes.
  assert.match(SRC, /\n\s*\.history-pager\s*\{/, 'the pager styling is addressed by class');
});

// ── slice-385-ac-6 ──────────────────────────────────────────────────────────

test('slice-385-ac-6 ten rows a page is fixed — the operations page offers no control, preference or parameter that changes it', () => {
  // One declaration, one literal. Not a default, not a starting value.
  const decls = [...SRC.matchAll(/\bconst\s+LIST_PAGE_SIZE\s*=\s*([^;]+);/g)];
  assert.equal(decls.length, 1, 'exactly one page size is declared in the whole page');
  assert.equal(decls[0][1].trim(), '10', 'and it is the literal ten');

  // Nothing else declares a page size of its own, so there is no second number to drift.
  const others = [...SRC.matchAll(/\b(?:[A-Za-z_$][\w$]*_)?pageSize()\b|\b(?:rowsPerPage|perPage|pageSize)\b/g)]
    .map((m) => m[0])
    .filter((name) => name !== 'LIST_PAGE_SIZE');
  assert.deepEqual(others, [], `no other page-size lives on the page; found ${others.join(', ')}`);

  // It is never reassigned, so no control could move it even if one were wired up.
  assert.doesNotMatch(SRC, /(?<!const\s)\bLIST_PAGE_SIZE\s*(?:=(?!=)|\+\+|--|[+\-*/]=)/,
    'the page size is never reassigned — a constant in fact as well as in keyword');

  // It is never read from, or written to, anywhere the operator could reach.
  for (const re of [/localStorage[^\n]*(?:pageSize()|pageSize|rowsPerPage|perPage)/i,
                    /sessionStorage[^\n]*(?:pageSize()|pageSize|rowsPerPage|perPage)/i,
                    /(?:URLSearchParams|location\.search)[^\n]*(?:pageSize()|pageSize|rowsPerPage|perPage)/i]) {
    assert.doesNotMatch(SRC, re, 'the page size is not a stored preference or a URL parameter');
  }

  // And no control offers it. A dropdown of 10/25/50, a "rows per page" label, a
  // "show all" — none of them exist on the page.
  assert.doesNotMatch(SRC, /rows\s*per\s*page/i, 'no "rows per page" control');
  assert.doesNotMatch(SRC, /show\s*all\s*(?:rows|entries|items)/i, 'no "show all" escape hatch');
  for (const m of SRC.matchAll(/<select\b[\s\S]*?<\/select>/g)) {
    assert.doesNotMatch(m[0], /\b(?:10|25|50|100)\b/,
      'no dropdown on the page offers a page size to choose from');
  }

  // The pagers themselves offer exactly two controls each: back a page, forward a page.
  const slices = approvedSlices(pageSize() + 1);
  const staged = proposals(pageSize() + 1);
  const q = loadQueue({
    bridgeSlices: slices, queueOrder: idsOf(slices),
    stagedItems: staged, stagedOrder: idsOf(staged),
  });
  q.renderQueueList();
  for (const id of ['queue-approved-pagination', 'queue-proposed-pagination']) {
    const pager = pagerIn(q.container.innerHTML, id);
    assert.equal((pager.match(/<button\b/g) || []).length, 2,
      `#${id} offers two controls — previous page and next page, and nothing else`);
    assert.doesNotMatch(pager, /<select|<input|rows per page/i,
      `#${id} offers no way to change how many rows a page holds`);
  }
});

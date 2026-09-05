'use strict';

/**
 * J-inspect-slice-history — slice 380: the logbook is a logbook again.
 *
 * The History panel was ordered by slice id and drew five rows. Slice 367 failed at
 * 09-04 18:02 — the second-newest event in the whole log — and sat at position 8,
 * two pages down, because its id is low. The operator's reasonable conclusion was
 * that the slice had vanished.
 *
 * These tests run the page's OWN history functions, lifted out of
 * lcars-dashboard.html the way j-backlog-row-controls.test.js lifts the queue
 * renderers. A hand-kept copy of the comparator would go on passing after the page
 * changed underneath it, which is the one thing a safety net must not do.
 *
 * What is asserted is the ORDER and the REACH. What a row means — its outcome, its
 * pill, the fold of an amendment into its parent — is asserted only as an invariant
 * (traps 3 and 4): this slice must not have moved any of it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');
const SRC = fs.readFileSync(DASH, 'utf8');

// ── Lift the real functions out of the page ─────────────────────────────────

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

// The page's own constant, not a copy of its value: a test that hardcodes 25 would
// keep passing if someone quietly put the page size back to five.
function extractConst(name) {
  const m = SRC.match(new RegExp(`\\n\\s*const ${name}\\s*=\\s*[^;]+;`));
  assert.ok(m, `const ${name} must exist in lcars-dashboard.html`);
  return m[0];
}

function fakeEl() {
  const classes = new Set(['hidden']);
  return {
    innerHTML: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

function loadHistory() {
  const listEl = fakeEl();
  const pageEl = fakeEl();
  const document = {
    getElementById: (id) => ({ 'history-list': listEl, 'history-pagination': pageEl }[id] || null),
  };

  const factory = new Function('deps', `
    const document = deps.document;
    const historyExpandedSet = new Set();
    const humanReason = (r) => String(r);
    let cachedHistoryItems = [];
    let cachedHistoryAllRows = [];
    let historyPage = 1;
    ${extractConst('HISTORY_PAGE_SIZE')}
    ${extractConst('INPUT_COST_PER_M')}
    ${extractConst('OUTPUT_COST_PER_M')}
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
    return {
      orderHistoryRowsByRecency,
      renderHistoryPanel,
      historyGoPage,
      HISTORY_PAGE_SIZE,
      allRows: () => cachedHistoryAllRows,
      page: () => historyPage,
    };
  `);

  const api = factory({ document });
  return { ...api, listEl, pageEl };
}

// The ids the panel actually drew, in the order it drew them.
const renderedIds = (listEl) =>
  [...listEl.innerHTML.matchAll(/data-history-id="([^"]*)"/g)].map((m) => m[1]);

const idsOf = (rows) => rows.map((r) => r.id);

// ── The measured log from the brief ─────────────────────────────────────────
// finished times exactly as the operator read them off the live panel.
const MEASURED = [
  { id: '379', ts: '2026-09-04T17:24:00.000Z', event: 'MERGED' },
  { id: '376', ts: '2026-09-03T21:21:00.000Z', event: 'MERGED' },
  { id: '375', ts: '2026-09-03T20:13:00.000Z', event: 'MERGED' },
  { id: '373', ts: '2026-09-03T22:00:00.000Z', event: 'MERGED' },
  { id: '372', ts: '2026-09-04T16:31:00.000Z', event: 'MERGED' },
  { id: '367', ts: '2026-09-04T18:02:00.000Z', event: 'ERROR' },
];

function measuredFixture() {
  const recent = MEASURED.map((s) => ({
    id: s.id,
    title: `Slice ${s.id}`,
    goal: `What slice ${s.id} was for.`,
    outcome: s.event === 'ERROR' ? 'ERROR' : 'DONE',
    completedAt: s.ts,
    reviewStatus: s.event === 'ERROR' ? null : 'accepted',
    durationMs: 60000, tokensIn: 1000, tokensOut: 500, costUsd: 0.1,
  }));
  const events = MEASURED.flatMap((s) => ([
    { ts: s.ts, event: 'COMMISSIONED', id: s.id, title: `Slice ${s.id}` },
    { ts: s.ts, event: s.event, id: s.id, round: 1 },
  ]));
  return { recent, events };
}

// A row as it reaches the ordering step, already classified.
const row = (id, ts, extra = {}) => ({ id, title: `Slice ${id}`, _terminalTs: ts, ...extra });

// ── slice-380-ac-1 ──────────────────────────────────────────────────────────

test('J-inspect-slice-history slice-380-ac-1 — the logbook is ordered by when each slice finished, newest first, whatever its id', () => {
  const h = loadHistory();
  const { recent, events } = measuredFixture();
  h.renderHistoryPanel(recent, events);

  // Chronological, newest first. Not 379-376-375-373-372 (descending id), which is
  // what the operator was shown while 367's 18:02 failure sat at position 8.
  assert.deepEqual(renderedIds(h.listEl), ['367', '379', '372', '373', '376', '375'],
    'rows must follow the terminal timestamps, not the slice numbers');

  assert.equal(renderedIds(h.listEl)[0], '367',
    'the newest terminal event in the log is the first row, even though its id is the lowest');

  // Stated as the property, so a fixture that happens to agree cannot carry it:
  // every row is at least as old as the one above it.
  const times = h.allRows().map((r) => Date.parse(r._terminalTs));
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i - 1] >= times[i],
      `row ${i} (${h.allRows()[i].id}) is newer than the row above it (${h.allRows()[i - 1].id})`);
  }
});

// ── slice-380-ac-2 ──────────────────────────────────────────────────────────

test('J-inspect-slice-history slice-380-ac-2 — every entry is reachable from the panel itself, by turning its pages', () => {
  const h = loadHistory();
  const total = 3 * h.HISTORY_PAGE_SIZE + 4;      // deliberately not a whole number of pages
  const recent = Array.from({ length: total }, (_, i) => ({
    id: String(500 + i),
    title: `Slice ${500 + i}`,
    outcome: 'DONE',
    completedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    reviewStatus: 'accepted',
  }));
  h.renderHistoryPanel(recent, []);

  // The control has a name the operator can find. The brief's probe for
  // `.history-pager` came back empty: the container answered only to
  // #history-pagination, so a reasonable search for the pager found nothing.
  assert.match(SRC, /<div id="history-pagination" class="[^"]*\bhistory-pager\b[^"]*">/,
    'the pagination container must carry the history-pager name');

  const seen = new Set();
  const seenPages = [];
  for (let guard = 0; guard <= total; guard++) {
    renderedIds(h.listEl).forEach((id) => seen.add(id));
    seenPages.push(h.page());
    const older = /<button class="history-pg-btn"[^>]*>older/.exec(h.pageEl.innerHTML);
    assert.ok(older, 'the panel offers an "older" control on every page');
    if (/disabled/.test(older[0])) break;         // the panel says this is the last page
    h.historyGoPage(h.page() + 1);                // exactly what the operator clicks
  }

  assert.equal(seen.size, total,
    `all ${total} entries must be reachable through the pager; only ${seen.size} were`);
  assert.deepEqual([...seen].sort(), recent.map((r) => r.id).sort());
  assert.deepEqual(seenPages, [1, 2, 3, 4], 'the pages walk forward one at a time');

  // And back again: the "newer" control returns to the top of the log.
  h.historyGoPage(1);
  assert.equal(h.page(), 1);
  assert.equal(renderedIds(h.listEl).length, h.HISTORY_PAGE_SIZE);
});

// ── slice-380-ac-3 ──────────────────────────────────────────────────────────

test('J-inspect-slice-history slice-380-ac-3 — the panel says how many entries exist, so a page is never mistaken for the log', () => {
  const h = loadHistory();
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: String(600 + i), title: `Slice ${600 + i}`, outcome: 'DONE',
    completedAt: new Date(Date.UTC(2026, 8, 2, 0, i)).toISOString(), reviewStatus: 'accepted',
  }));
  h.renderHistoryPanel(many, []);

  assert.equal(h.pageEl.classList.contains('hidden'), false, 'the count bar is on screen');
  assert.match(h.pageEl.innerHTML, /of 60 entries/,
    'a truncated view must state the size of the whole log');
  assert.match(h.pageEl.innerHTML, /showing 1–25 of 60 entries/,
    'and which slice of it is on screen');

  // The case the old code got wrong: fewer entries than a page. It hid the bar
  // entirely, so 3-of-3 and 3-of-200 looked exactly alike.
  const few = many.slice(0, 3);
  h.renderHistoryPanel(few, []);
  assert.equal(h.pageEl.classList.contains('hidden'), false,
    'the count is stated even when everything fits on one page');
  assert.match(h.pageEl.innerHTML, /of 3 entries/);
});

// ── slice-380-ac-4 ──────────────────────────────────────────────────────────

test('J-inspect-slice-history slice-380-ac-4 — equal or missing timestamps still order the same way on every render', () => {
  const h = loadHistory();
  const SAME = '2026-09-04T12:00:00.000Z';
  const rows = [
    row('410', SAME), row('412', SAME), row('411', SAME),
    row('300', null), row('301', undefined), row('302', ''), row('303', 'not a date'),
    row('420', '2026-09-04T13:00:00.000Z'),
  ];

  const once = idsOf(h.orderHistoryRowsByRecency(rows));
  const twice = idsOf(h.orderHistoryRowsByRecency(rows));
  assert.deepEqual(once, twice, 'the same rows must draw the same list every time');

  // Shuffled in, identical out: the order is a property of the rows, not of the
  // order they happened to arrive in or of the engine's sort.
  const shuffled = [rows[6], rows[1], rows[7], rows[4], rows[0], rows[3], rows[5], rows[2]];
  assert.deepEqual(idsOf(h.orderHistoryRowsByRecency(shuffled)), once,
    'ordering must not flicker with the input order');

  assert.deepEqual(once, ['420', '412', '411', '410', '303', '302', '301', '300'],
    'newest first; equal times fall back to the slice number; undated rows sink to the bottom');

  // A row with no terminal timestamp is not a recent row, and is not lost either.
  const undated = ['300', '301', '302', '303'];
  for (const id of undated) {
    assert.ok(once.indexOf(id) > once.indexOf('410'),
      `undated row ${id} must sort after every dated row`);
  }
});

// ── slice-380-ac-5 ──────────────────────────────────────────────────────────

test('J-inspect-slice-history slice-380-ac-5 — a restaged slice keeps one entry per attempt; ordering merges nothing', () => {
  const h = loadHistory();
  // 400 ran, failed, was restaged and ran again. Same id, two attempts, two entries.
  const recent = [
    { id: '400', title: 'Restaged slice', outcome: 'ERROR', completedAt: '2026-09-04T09:00:00.000Z', reason: 'first attempt' },
    { id: '400', title: 'Restaged slice', outcome: 'DONE', completedAt: '2026-09-04T15:00:00.000Z', reviewStatus: 'accepted' },
    { id: '401', title: 'Another slice', outcome: 'DONE', completedAt: '2026-09-04T12:00:00.000Z', reviewStatus: 'accepted' },
  ];
  h.renderHistoryPanel(recent, []);

  const drawn = renderedIds(h.listEl);
  assert.equal(drawn.length, 3, 'both attempts of 400 are still on the screen');
  assert.equal(drawn.filter((id) => id === '400').length, 2,
    'the earlier attempt must not be merged into the later one, or dropped');
  assert.deepEqual(drawn, ['400', '401', '400'],
    'each attempt sits at its own time: the retry, then 401, then the first failure');

  // The earlier attempt keeps its own record — same id, different story.
  const attempts = h.allRows().filter((r) => r.id === '400');
  assert.deepEqual(attempts.map((r) => r._terminalTs),
    ['2026-09-04T15:00:00.000Z', '2026-09-04T09:00:00.000Z']);
  assert.equal(attempts[1]._terminalOutcome, 'ERROR', 'the failed attempt is still a failure');
});

// ── traps ───────────────────────────────────────────────────────────────────

test('J-inspect-slice-history slice-380-ac-4 trap 1 — a shared or missing timestamp has a defined fallback, so nothing rides on a NaN comparison', () => {
  const h = loadHistory();

  // Undated against dated, both ways round: the undated row sinks either way.
  const dated = row('100', '2026-09-01T00:00:00.000Z');
  const undated = row('999', null);
  assert.deepEqual(idsOf(h.orderHistoryRowsByRecency([undated, dated])), ['100', '999']);
  assert.deepEqual(idsOf(h.orderHistoryRowsByRecency([dated, undated])), ['100', '999']);

  // An unparseable timestamp is treated as no timestamp, not as time zero or NaN.
  assert.deepEqual(idsOf(h.orderHistoryRowsByRecency([row('998', 'whenever'), dated])),
    ['100', '998']);

  // Enough equal-timestamped rows to expose an unstable or partial comparator.
  const SAME = '2026-09-05T08:00:00.000Z';
  const many = Array.from({ length: 40 }, (_, i) => row(String(700 + i), SAME));
  const forwards = idsOf(h.orderHistoryRowsByRecency(many));
  const backwards = idsOf(h.orderHistoryRowsByRecency([...many].reverse()));
  assert.deepEqual(forwards, backwards, '40 rows sharing one timestamp must not depend on input order');
  assert.deepEqual(forwards, many.map((r) => r.id).reverse(), 'they fall back to the slice number, descending');

  // completedAt is the documented stand-in when no terminal event was recorded.
  assert.deepEqual(
    idsOf(h.orderHistoryRowsByRecency([
      { id: '1', completedAt: '2026-09-01T00:00:00.000Z' },
      { id: '2', completedAt: '2026-09-02T00:00:00.000Z' },
    ])), ['2', '1']);
});

test('J-inspect-slice-history slice-380-ac-5 trap 2 — ordering is a permutation: same rows in, same rows out', () => {
  const h = loadHistory();
  const rows = [
    row('500', '2026-09-04T10:00:00.000Z'), row('500', '2026-09-04T10:00:00.000Z'),
    row('500', '2026-09-01T10:00:00.000Z'), row('501', null),
    row('502', '2026-09-04T11:00:00.000Z'), row('502', null),
  ];
  const out = h.orderHistoryRowsByRecency(rows);

  assert.equal(out.length, rows.length, 'no row may be dropped or folded away by the sort');
  assert.deepEqual(idsOf(out).slice().sort(), idsOf(rows).slice().sort(),
    'the same multiset of ids comes out — duplicates included');
  for (const r of rows) assert.ok(out.includes(r), `row ${r.id} must be the same object, not a copy`);

  // Two entries identical in id AND time keep their arrival order rather than
  // collapsing into one.
  const twins = [row('600', '2026-09-04T10:00:00.000Z', { attempt: 1 }),
                 row('600', '2026-09-04T10:00:00.000Z', { attempt: 2 })];
  assert.deepEqual(h.orderHistoryRowsByRecency(twins).map((r) => r.attempt), [1, 2]);
  assert.deepEqual(h.orderHistoryRowsByRecency([twins[1], twins[0]]).map((r) => r.attempt), [2, 1]);
});

test('J-inspect-slice-history slice-380-ac-1 trap 3 — what an outcome means, and which pill it wears, is untouched', () => {
  const h = loadHistory();
  const recent = [
    { id: '801', title: 'Merged', outcome: 'DONE', completedAt: '2026-09-04T10:00:00.000Z', reviewStatus: 'accepted' },
    { id: '802', title: 'Still in review', outcome: 'DONE', completedAt: '2026-09-04T11:00:00.000Z', reviewStatus: 'pending' },
    { id: '803', title: 'Failed', outcome: 'ERROR', completedAt: '2026-09-04T12:00:00.000Z', reason: 'timeout' },
  ];
  const events = [
    { ts: '2026-09-04T10:00:00.000Z', event: 'MERGED', id: '801' },
    { ts: '2026-09-04T12:00:00.000Z', event: 'ERROR', id: '803' },
  ];
  h.renderHistoryPanel(recent, events);

  const html = h.listEl.innerHTML;
  const pillOf = (id) => {
    const m = new RegExp(`data-history-id="${id}"[\\s\\S]*?<span class="outcome-pill ([\\w-]+)"`).exec(html);
    assert.ok(m, `row ${id} renders an outcome pill`);
    return m[1];
  };
  assert.equal(pillOf('803'), 'outcome-error', 'a failure is still a failure');
  assert.equal(pillOf('802'), 'outcome-reviewing', 'finished-but-unreviewed is still not green');
  assert.equal(pillOf('801'), 'outcome-success', 'a merged, accepted slice is still green');

  const by = Object.fromEntries(h.allRows().map((r) => [r.id, r]));
  assert.equal(by['801']._terminalOutcome, 'ON_DEV');
  assert.equal(by['803']._terminalOutcome, 'ERROR');
  // The failure set that drives the pill is unchanged.
  assert.match(SRC, /const TERMINAL_EVENTS = \['MERGED', 'MAX_ROUNDS_EXHAUSTED', 'ESCALATED_TO_OBRIEN', 'ERROR'\];/);
});

test('J-inspect-slice-history slice-380-ac-2 trap 4 — an amendment is still folded into its parent; this slice unfolds nothing', () => {
  const h = loadHistory();
  const recent = [
    { id: '900', title: 'Parent slice', outcome: 'DONE', completedAt: '2026-09-04T10:00:00.000Z',
      reviewStatus: 'accepted', durationMs: 1000, tokensIn: 100, tokensOut: 50, costUsd: 0.1 },
    { id: '901', title: 'Amendment to 900', references: '900', outcome: 'DONE',
      completedAt: '2026-09-04T18:00:00.000Z', reviewStatus: 'accepted',
      durationMs: 2000, tokensIn: 200, tokensOut: 70, costUsd: 0.2 },
    { id: '902', title: 'Unrelated', outcome: 'DONE', completedAt: '2026-09-04T12:00:00.000Z', reviewStatus: 'accepted' },
  ];
  h.renderHistoryPanel(recent, []);

  const drawn = renderedIds(h.listEl);
  assert.deepEqual(drawn, ['902', '900'],
    'the amendment stays folded into 900 — a newer child does not earn its own row');
  assert.equal(drawn.includes('901'), false, 'no unfolding');

  const parent = h.allRows().find((r) => r.id === '900');
  assert.deepEqual([parent._synthDurationMs, parent._synthTokensIn, parent._synthTokensOut],
    [3000, 300, 120], 'the parent still carries the summed telemetry of its children');
  assert.ok(Math.abs(parent._synthCostUsd - 0.3) < 1e-9, 'and their summed cost');
  assert.deepEqual(parent._childIds, ['901']);
});

'use strict';

/**
 * J-backlog-row-controls — slice 373
 *
 * A Backlog Queue row carries only the decisions that matter: Approve or Reject
 * on a proposed row, Un-approve on an approved one. The "Edit" control — a
 * read-only view of the brief wearing an action's name, sitting between the two
 * real decisions — is gone.
 *
 * These tests run the dashboard's own render functions, lifted out of
 * lcars-dashboard.html, rather than a hand-kept copy of them: a copy would go on
 * passing after the page changed underneath it.
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
  let i = SRC.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces while extracting ${name}()`);
}

function loadRenderers(deps = {}) {
  const factory = new Function('deps', `
    const marked = deps.marked;
    const document = deps.document;
    const setTimeout = deps.setTimeout;
    let _lastBridgeData = deps._lastBridgeData ?? null;
    let _pendingEnterIds = deps._pendingEnterIds ?? new Set();
    let cachedRegisterEvents = deps.cachedRegisterEvents ?? [];
    const isDependencySatisfied = deps.isDependencySatisfied ?? (() => true);
    const personName = deps.personName ?? ((k) => k);
    ${extractFn('escHtml')}
    ${extractFn('renderQueueRow')}
    ${extractFn('buildQueueExpandContent')}
    return { renderQueueRow, buildQueueExpandContent };
  `);
  return factory({
    document: { querySelector: () => null },
    setTimeout: () => {},
    ...deps,
  });
}

const { renderQueueRow, buildQueueExpandContent } = loadRenderers();

// The controls a row offers, read out of the rendered markup.
function actionsOf(html) {
  const m = html.match(/<span class="queue-row-actions">([\s\S]*?)<\/span>\s*<\/div>/);
  assert.ok(m, 'every queue row renders a .queue-row-actions container');
  return m[1];
}
const buttonsIn = (actions) => actions.match(/<button\b/g) || [];

const EDIT_LEFTOVERS = /queue-btn-edit|queueEdit|>\s*Edit\s*</;

// ── slice-373-ac-1 ──────────────────────────────────────────────────────────

test('slice-373-ac-1 a proposed backlog row offers only Approve and Reject, with no Edit control', () => {
  const html = renderQueueRow({ id: '901', title: 'A proposed improvement', rowState: 'STAGED' }, {});
  const actions = actionsOf(html);

  assert.match(actions, /class="btn btn-approve queue-btn-accept"[^>]*onclick="queueAccept\('901'\)"/,
    'a proposed row still offers Approve');
  assert.match(actions, /class="btn btn-reject queue-btn-reject"[^>]*onclick="queueReject\('901'\)"/,
    'a proposed row still offers Reject');
  assert.doesNotMatch(actions, EDIT_LEFTOVERS,
    'a proposed row must offer no Edit control');
  assert.equal(buttonsIn(actions).length, 2,
    'a proposed row offers exactly two controls — approve it, or reject it');
});

// ── slice-373-ac-2 ──────────────────────────────────────────────────────────

test('slice-373-ac-2 an approved row offers only the un-approve control, with no Edit control', () => {
  const html = renderQueueRow({ id: '902', title: 'An approved work order', rowState: 'QUEUED' }, { position: 1 });
  const actions = actionsOf(html);

  assert.match(actions, /class="btn btn-ghost queue-btn-unapprove"[^>]*onclick="queueUnapprove\('902'\)"/,
    'an approved row still offers Un-approve');
  assert.doesNotMatch(actions, EDIT_LEFTOVERS,
    'an approved row must offer no Edit control');
  assert.equal(buttonsIn(actions).length, 1,
    'an approved row offers exactly one control');

  // The dispatched slice hides Un-approve — it must not be left holding an Edit
  // button as its only control.
  const dispatched = loadRenderers({ _lastBridgeData: { heartbeat: { current_slice: '902' } } });
  const inFlight = actionsOf(dispatched.renderQueueRow({ id: '902', title: 'Building now', rowState: 'QUEUED' }, { position: 1 }));
  assert.doesNotMatch(inFlight, EDIT_LEFTOVERS, 'the dispatched row offers no Edit control either');
  assert.equal(buttonsIn(inFlight).length, 0, 'the dispatched row offers no controls at all');
});

// ── slice-373-ac-3 ──────────────────────────────────────────────────────────

const SLICE_DETAIL_MACHINERY = [
  'closeSliceDetail', 'switchDetailTab', 'renderSliceDetail', 'renderSliceDetailBody',
  'renderSliceDetailActions', 'sliceDetailApprove', 'sliceDetailRefine', 'sliceDetailReject',
  'sliceDetailSave', 'sliceDetailReturnToStage', 'sliceDetailUnapprove', 'sliceDetailRemove',
];

test('slice-373-ac-3 the slice-detail overlay survives — only its Edit entry point was retired', () => {
  assert.match(SRC, /<div class="slice-detail-overlay" id="slice-detail-overlay"/,
    'the shared slice-detail overlay must not be deleted with the button');
  assert.match(SRC, /id="slice-detail-body"/, 'the overlay keeps its body');
  assert.match(SRC, /id="slice-detail-actions"/, 'the overlay keeps its action bar');
  assert.match(SRC, /id="tab-rendered"[\s\S]{0,400}id="tab-source"/,
    'the overlay keeps both the Rendered and Source tabs');

  for (const fn of SLICE_DETAIL_MACHINERY) {
    assert.match(SRC, new RegExp(`function ${fn}\\s*\\(`),
      `${fn}() must still be defined — the overlay's own controls call it`);
  }
});

// ── slice-373-ac-4 ──────────────────────────────────────────────────────────

const BRIEF_BODY = [
  '# Remove the Edit button',
  '',
  '## Goal',
  '',
  'GOAL-MARKER — Edit is a view control mislabelled as an action.',
  '',
  '## Tasks',
  '',
  '1. TASKS-MARKER remove it from the proposed rows.',
  '',
  '## Traps',
  '',
  '1. TRAPS-MARKER check what is lost before deleting.',
  '',
  '## Acceptance criteria',
  '',
  '- AC-MARKER: the last line of the brief still arrives.',
  '',
].join('\n');

test('slice-373-ac-4 a staged slice\'s full brief stays readable — the row chevron opens it', () => {
  const html = renderQueueRow({ id: '903', title: 'Still readable', rowState: 'STAGED' }, {});
  assert.match(html, /class="queue-chevron" id="queue-chevron-903" onclick="toggleQueueExpand\('903'\)"/,
    'the proposed row keeps the chevron that opens the brief inline');
  assert.match(html, /class="queue-expand" id="queue-expand-903" data-row-state="STAGED"/,
    'the row keeps the panel the chevron expands into');

  const panel = buildQueueExpandContent('903', 'STAGED', BRIEF_BODY, { from: 'obrien' });
  assert.match(panel, /<div class="queue-expand-body">/, 'the panel renders the brief body');
  for (const marker of ['GOAL-MARKER', 'TASKS-MARKER', 'TRAPS-MARKER', 'AC-MARKER']) {
    assert.ok(panel.includes(marker), `the expanded panel carries ${marker} — the whole brief, not a summary`);
  }
});

// ── trap 1 — the read route must not be a dead end ──────────────────────────

test('slice-373-ac-4 TRAP 1 the brief-reading route is whole: full text, both row states, real markdown', () => {
  // Both sections of the queue keep the route, not just the proposed one.
  for (const rowState of ['STAGED', 'QUEUED']) {
    const row = renderQueueRow({ id: '904', title: 'Row', rowState }, { position: 1 });
    assert.match(row, /class="queue-chevron"[^>]*onclick="toggleQueueExpand\('904'\)"/,
      `a ${rowState} row keeps its chevron`);

    const panel = buildQueueExpandContent('904', rowState, BRIEF_BODY, { from: 'obrien' });
    assert.ok(!panel.includes('No details available'), `the ${rowState} panel is not empty`);
    for (const marker of ['GOAL-MARKER', 'TASKS-MARKER', 'TRAPS-MARKER', 'AC-MARKER']) {
      assert.ok(panel.includes(marker), `the ${rowState} panel carries ${marker}`);
    }
  }

  // The markdown branch renders the same body, not a truncation of it.
  const withMarked = loadRenderers({ marked: { parse: (s) => `<md>${s}</md>` } });
  const rendered = withMarked.buildQueueExpandContent('904', 'STAGED', BRIEF_BODY, { from: 'obrien' });
  assert.match(rendered, /<div class="queue-expand-body"><md>/, 'the panel renders the body through marked');
  assert.ok(rendered.includes('AC-MARKER'), 'the markdown path carries the whole brief too');

  // And what feeds it is the full slice content, the same source the retired
  // overlay read from.
  const loader = extractFn('loadQueueExpandContent');
  assert.match(loader, /fetch\(`\/api\/queue\/\$\{id\}\/content`\)/,
    'the expander loads the full slice content from the server');
  assert.match(loader, /buildQueueExpandContent\(id, rowState, data\.body, data\.frontmatter/,
    'it hands the whole body to the panel, not a goal line');
});

// ── trap 2 — the overlay is shared machinery; only the entry point goes ─────

test('slice-373-ac-3 TRAP 2 the retirement is surgical — no overlay control is left pointing at nothing', () => {
  const start = SRC.indexOf('<div class="slice-detail-overlay" id="slice-detail-overlay"');
  assert.notEqual(start, -1, 'the overlay markup must still be in the page');
  const end = SRC.indexOf('<!-- History Slicing Detail overlay -->', start);
  assert.ok(end > start, 'the overlay markup block must be locatable');
  const overlay = SRC.slice(start, end);

  const handlers = [...overlay.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]);
  assert.ok(handlers.length > 0, 'the overlay wires its own controls with onclick handlers');
  for (const fn of new Set(handlers)) {
    assert.match(SRC, new RegExp(`function ${fn}\\s*\\(`),
      `the overlay's ${fn}() handler must still have a definition`);
  }

  // The one thing that did go: the entry point being retired.
  assert.doesNotMatch(SRC, /\bqueueEdit\b/, 'queueEdit() and every call to it are gone');
  assert.doesNotMatch(SRC, /queue-btn-edit/, 'the Edit button styling is gone with the button');
});

'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedReorderableSections, resetQueueState } = seedFixture;

// Journey: reorder the Backlog Queue by dragging (slice 371).
//
// The Proposed Improvement list is the delivery plan — the order work is actually done
// in — so the operator must be able to drag it, exactly as they already drag Approved
// Work Orders. Dragging is SEQUENCE ONLY: it never promotes a proposal, and it never
// carries a row across the divider between the two sections.
//
// The happy path below uses page.dragAndDrop — a real mouse-driven HTML5 drag, the
// operator's actual gesture. The REFUSAL cases dispatch dragstart/dragover/drop by hand
// with a shared DataTransfer instead, because a refusal has to be read off the dragover
// event: preventDefault() on it is what marks a row a legal drop target, and a mouse drag
// that lands nowhere is indistinguishable from one that was never accepted. That single
// missing preventDefault is the classic silent failure a DOM-free unit test cannot see.
//
// @ac-hash: slice-371-ac-1 sha256:1fac0d587e3eed45a1eee71c3e3486504826cdbbabcfa6d208a70d812a0bb1cd
// @ac-hash: slice-371-ac-2 sha256:b0c0d871210672c41213ff8f7f1d6279befbf75eeb18ae26c113897b43aeaf6a
// @ac-hash: slice-371-ac-3 sha256:9569b7d08648d7542c1c79c217f8b29dfde1f836b629a5607a5f330751b42c8d
// @ac-hash: slice-371-ac-4 sha256:2a603e6096184a531f08ce883abd00fbcefb5eff873b279edc167e6a4d7c5d02
// @ac-hash: slice-371-ac-5 sha256:76bdc2652f6d6eb564cc64690b0c983e8515feede0a2357b0631c56fbb9b6e8f
// @ac-hash: slice-371-ac-6 sha256:e88e5111d0f9835d7f3ca13a31d855588575e3c02a78a2eca07824b733f880fe

const STAGED_ORDER = path.join(seedFixture.ROOT, 'bridge', 'staged-order.json');
const QUEUE_ORDER = path.join(seedFixture.ROOT, 'bridge', 'queue-order.json');
const STAGED_DIR = path.join(seedFixture.ROOT, 'bridge', 'staged');
const QUEUE_DIR = path.join(seedFixture.ROOT, 'bridge', 'queue');

const readOrder = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test.beforeEach(async ({ page }) => {
  seedReorderableSections();
  await page.goto('/');
  // The proposed list starts in its seeded order — every assertion below is a delta on it.
  await expect.poll(() => rowIds(page, 'STAGED')).toEqual(['9101', '9102', '9103']);
});

test.afterAll(() => { resetQueueState(); });

// Ids of the rendered rows in one section, top to bottom.
function rowIds(page, state) {
  return page.$$eval(`.queue-row[data-state="${state}"]`, rows => rows.map(r => r.getAttribute('data-id')));
}

// Dispatch an HTML5 DnD sequence from one row onto another, sharing one DataTransfer.
// Returns whether the page accepted the drop target (dragover was preventDefault'd).
async function dragRowOnto(page, srcId, targetId) {
  return page.evaluate(({ srcId, targetId }) => {
    const src = document.querySelector(`.queue-row[data-id="${srcId}"]`);
    const tgt = document.querySelector(`.queue-row[data-id="${targetId}"]`);
    const dt = new DataTransfer();
    const fire = (el, type) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    fire(src, 'dragstart');
    const accepted = fire(tgt, 'dragover'); // preventDefault() === "you may drop here"
    fire(tgt, 'drop');
    fire(src, 'dragend');
    return accepted;
  }, { srcId, targetId });
}

// Record every reorder POST the page makes during `body`, so a test can assert silence.
async function orderPostsDuring(page, body) {
  const posts = [];
  const listener = (req) => {
    if (req.method() === 'POST' && /\/api\/(staged|queue)\/order$/.test(new URL(req.url()).pathname)) {
      posts.push({ url: new URL(req.url()).pathname, body: JSON.parse(req.postData() || 'null') });
    }
  };
  page.on('request', listener);
  try {
    await body();
    await page.waitForTimeout(600); // a POST would have been issued synchronously on drop
  } finally {
    page.off('request', listener);
  }
  return posts;
}

test('slice-371-ac-1 a proposed slice drags by its handle into a new position in the proposed list', async ({ page }) => {
  // The handle is live on proposed rows — the row is draggable and the handle is not the
  // `locked` / not-allowed affordance.
  for (const id of ['9101', '9102', '9103']) {
    await expect(page.locator(`.queue-row[data-id="${id}"]`)).toHaveAttribute('draggable', 'true');
    const handle = page.locator(`.queue-row[data-id="${id}"] .queue-drag-handle`);
    await expect(handle).toHaveClass(/\bactive\b/);
    await expect(handle).not.toHaveClass(/\blocked\b/);
    await expect(handle).toHaveCSS('cursor', 'grab');
  }

  // The operator's actual gesture: a mouse-driven HTML5 drag, not a synthesised event.
  // Drag the third proposal onto the first — it lands ahead of it.
  await page.dragAndDrop('.queue-row[data-id="9103"]', '.queue-row[data-id="9101"]');

  await expect.poll(() => rowIds(page, 'STAGED')).toEqual(['9103', '9101', '9102']);
  // The pinned amendment stayed at the foot of the proposed list, untouched.
  await expect(page.locator('.queue-row[data-id="9104"]')).toHaveAttribute('data-state', 'NEEDS_APENDMENT');
});

test('slice-371-ac-2 the new proposed order is persisted and survives a page reload', async ({ page }) => {
  const reqPromise = page.waitForRequest(req =>
    req.url().includes('/api/staged/order') && req.method() === 'POST');
  const resPromise = page.waitForResponse(res =>
    res.url().includes('/api/staged/order') && res.request().method() === 'POST');

  await dragRowOnto(page, '9102', '9101'); // 9102 moves ahead of 9101

  // The client sends the full sequence and the server accepts it.
  const req = await reqPromise;
  expect(JSON.parse(req.postData())).toEqual({ order: ['9102', '9101', '9103'] });
  expect((await resPromise).status()).toBe(200);

  // It reached bridge/staged-order.json — the file that drives the rendered order.
  await expect.poll(() => readOrder(STAGED_ORDER)).toEqual(['9102', '9101', '9103']);

  // And a full page reload comes back in the dragged order, not the seeded one.
  await page.reload();
  await expect.poll(() => rowIds(page, 'STAGED')).toEqual(['9102', '9101', '9103']);
});

test('slice-371-ac-3 an amendment row stays non-draggable and keeps the locked affordance', async ({ page }) => {
  const amendRow = page.locator('.queue-row[data-id="9104"]');
  await expect(amendRow).toBeVisible();
  await expect(amendRow).toHaveAttribute('data-state', 'NEEDS_APENDMENT');
  await expect(amendRow).toHaveAttribute('draggable', 'false');

  const handle = page.locator('.queue-row[data-id="9104"] .queue-drag-handle');
  await expect(handle).toHaveClass(/\blocked\b/);
  await expect(handle).not.toHaveClass(/\bactive\b/);
  await expect(handle).toHaveCSS('cursor', 'not-allowed');

  // It cannot be used as a drag source, and it is not a legal drop target either:
  // the pinned row neither moves nor displaces the proposals around it.
  const posts = await orderPostsDuring(page, async () => {
    expect(await dragRowOnto(page, '9104', '9101')).toBe(false);
    expect(await dragRowOnto(page, '9101', '9104')).toBe(false);
  });
  expect(posts).toEqual([]);
  expect(await rowIds(page, 'STAGED')).toEqual(['9101', '9102', '9103']);
  expect(readOrder(STAGED_ORDER)).toEqual(['9101', '9102', '9103']);
});

test('slice-371-ac-4 a row cannot be dragged between the proposed and approved sections', async ({ page }) => {
  await expect.poll(() => rowIds(page, 'QUEUED')).toEqual(['5001', '5002']);

  const posts = await orderPostsDuring(page, async () => {
    expect(await dragRowOnto(page, '9101', '5001')).toBe(false); // proposed → approved
    expect(await dragRowOnto(page, '5002', '9103')).toBe(false); // approved → proposed
  });

  // Nothing was persisted in either direction, and both lists are untouched.
  expect(posts).toEqual([]);
  expect(await rowIds(page, 'STAGED')).toEqual(['9101', '9102', '9103']);
  expect(await rowIds(page, 'QUEUED')).toEqual(['5001', '5002']);
  expect(readOrder(STAGED_ORDER)).toEqual(['9101', '9102', '9103']);
  expect(readOrder(QUEUE_ORDER)).toEqual(['5001', '5002']);
});

test('slice-371-ac-5 reordering the proposed list never changes a slice approval state', async ({ page }) => {
  await dragRowOnto(page, '9103', '9101');
  await expect.poll(() => readOrder(STAGED_ORDER)).toEqual(['9103', '9101', '9102']);

  // The dragged row is still a proposal: same section, still offering Approve.
  const moved = page.locator('.queue-row[data-id="9103"]');
  await expect(moved).toHaveAttribute('data-state', 'STAGED');
  await expect(moved.locator('.queue-btn-accept')).toBeVisible();

  // The approved section gained nothing, and no slice file moved on disk.
  expect(await rowIds(page, 'QUEUED')).toEqual(['5001', '5002']);
  expect(fs.readdirSync(STAGED_DIR).sort())
    .toEqual(['9101-STAGED.md', '9102-STAGED.md', '9103-STAGED.md', '9104-NEEDS_APENDMENT.md']);
  expect(fs.readdirSync(QUEUE_DIR).sort()).toEqual(['5001-QUEUED.md', '5002-QUEUED.md']);
});

test('slice-371-ac-6 reordering approved work orders still behaves exactly as before', async ({ page }) => {
  await expect.poll(() => rowIds(page, 'QUEUED')).toEqual(['5001', '5002']);

  const resPromise = page.waitForResponse(res =>
    res.url().includes('/api/queue/order') && res.request().method() === 'POST');

  expect(await dragRowOnto(page, '5002', '5001')).toBe(true);
  expect((await resPromise).status()).toBe(200);

  await expect.poll(() => rowIds(page, 'QUEUED')).toEqual(['5002', '5001']);
  await expect.poll(() => readOrder(QUEUE_ORDER)).toEqual(['5002', '5001']);

  // Making proposals draggable did not bleed into the approved section: the proposals
  // stayed put, and their own order file was not rewritten.
  expect(await rowIds(page, 'STAGED')).toEqual(['9101', '9102', '9103']);
  expect(readOrder(STAGED_ORDER)).toEqual(['9101', '9102', '9103']);
});

'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedQueuedPair } = seedFixture;

// Journey: drag-reorder two Approved Work Orders (QUEUED slices). Dragging 5002 onto
// 5001 moves it ahead; the new order persists via POST /api/queue/order.
//
// HTML5 native drag-and-drop isn't driven reliably by mouse emulation, so we dispatch
// the real dragstart/dragover/drop events with a shared DataTransfer — the same events
// the dashboard's handlers listen for.

test.beforeEach(async ({ page }) => {
  seedQueuedPair();
  await page.goto('/');
});

test.afterAll(() => { seedFixture(); });

// Dispatch an HTML5 DnD sequence from one row onto another, sharing one DataTransfer.
async function dragRowOnto(page, srcId, targetId) {
  await page.evaluate(({ srcId, targetId }) => {
    const src = document.querySelector(`.queue-row[data-id="${srcId}"]`);
    const tgt = document.querySelector(`.queue-row[data-id="${targetId}"]`);
    const dt = new DataTransfer();
    const fire = (el, type) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      el.dispatchEvent(ev);
    };
    fire(src, 'dragstart');
    fire(tgt, 'dragover');
    fire(tgt, 'drop');
    fire(src, 'dragend');
  }, { srcId, targetId });
}

test('reordering two Approved Work Orders persists the new order to the server', async ({ page }) => {
  // Both queued rows are present and draggable.
  await expect(page.locator('.queue-row[data-id="5001"][data-state="QUEUED"]')).toBeVisible();
  await expect(page.locator('.queue-row[data-id="5002"][data-state="QUEUED"]')).toBeVisible();

  // Capture the persist round-trip: the client POSTs the new order and the server
  // accepts it (writeQueueOrder runs → queue-order.json is rewritten).
  const reqPromise = page.waitForRequest(req =>
    req.url().includes('/api/queue/order') && req.method() === 'POST');
  const resPromise = page.waitForResponse(res =>
    res.url().includes('/api/queue/order') && res.request().method() === 'POST');

  await dragRowOnto(page, '5002', '5001'); // move 5002 ahead of 5001

  const req = await reqPromise;
  expect(JSON.parse(req.postData())).toEqual({ order: ['5002', '5001'] }); // server got the new order
  expect((await resPromise).status()).toBe(200);                           // and persisted it (200 ok)

  // The operator sees the reorder: the queued rows are now 5002 before 5001.
  await expect.poll(async () =>
    page.$$eval('.queue-row[data-state="QUEUED"]', rows => rows.map(r => r.getAttribute('data-id')))
  ).toEqual(['5002', '5001']);

  // NOTE (product finding, recorded for O'Brien): GET /api/bridge does NOT reflect the
  // new order until an unrelated poll fires, because getCachedBridgeData() keys its cache
  // on register.jsonl + heartbeat.json mtimes only — not queue-order.json. Masked in
  // production by constant heartbeat churn; visible with a static fixture heartbeat.
});

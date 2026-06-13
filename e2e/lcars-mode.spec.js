'use strict';

const { test, expect } = require('@playwright/test');

// Journey: operator flips LCARS Mode (dark skin) on/off and it persists.

test('LCARS toggle switches skin, persists across reload, and toggles back', async ({ page }) => {
  await page.goto('/');
  const body = page.locator('body');
  await expect(body).not.toHaveClass(/lcars-mode/);

  await page.locator('.lcars-switch').click();
  await expect(body).toHaveClass(/lcars-mode/);
  // background actually goes dark
  await expect(body).toHaveCSS('background-color', 'rgb(0, 0, 0)');

  // persists across reload
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/lcars-mode/);

  // toggle back off
  await page.locator('.lcars-switch').click();
  await expect(page.locator('body')).not.toHaveClass(/lcars-mode/);
});

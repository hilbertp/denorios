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

// Crew identity is theme-aware: neutral HUMAN names in light mode, DS9 CHARACTER names
// in the LCARS skin — both driven by the ROLE map via applyRoleLabels() on every toggle.
test('crew cards show human names in light mode and DS9 names in LCARS mode', async ({ page }) => {
  await page.goto('/');
  const bashir = page.locator('.crew-card[data-role="bashir"] .crew-name');
  const worf   = page.locator('.crew-card[data-role="worf"] .crew-name');

  // Light mode (default): neutral human names.
  await expect(page.locator('body')).not.toHaveClass(/lcars-mode/);
  await expect(bashir).toHaveText('Priya');
  await expect(worf).toHaveText('Chris');

  // Flip to LCARS: the same cards now read the DS9 characters.
  await page.locator('.lcars-switch').click();
  await expect(page.locator('body')).toHaveClass(/lcars-mode/);
  await expect(bashir).toHaveText('Bashir');
  await expect(worf).toHaveText('Worf');

  // Flip back: human names return.
  await page.locator('.lcars-switch').click();
  await expect(bashir).toHaveText('Priya');
  await expect(worf).toHaveText('Chris');
});

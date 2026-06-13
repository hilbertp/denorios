'use strict';

const { test, expect } = require('@playwright/test');

// Journey: from a crew tile, open the conversation menu and start a New / Resume
// conversation. With LOB_NO_LAUNCH=1 the server never spawns a Terminal — instead it
// returns the exact `claude …` command, which the toast shows the operator to run.

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('crew tile → New conversation shows the claude command in a toast', async ({ page }) => {
  await page.locator('.crew-card', { hasText: 'Sisko' }).click();
  const menu = page.locator('#crew-menu');
  await expect(menu).toBeVisible();

  await menu.getByText('New conversation').click();

  // A toast renders the command (no Terminal launched, LOB_NO_LAUNCH=1).
  const toast = page.locator('.crew-toast').last();
  await expect(toast).toBeVisible();
  await expect(toast.locator('.crew-toast-title')).toContainText('Sisko');
  const cmd = toast.locator('.crew-toast-cmd');
  await expect(cmd).toBeVisible();
  // The real command pins a session id and the role bootstrap.
  await expect(cmd).toContainText('claude --session-id');
  await expect(cmd).toContainText('sisko');
});

test('crew tile → Resume offers a resume command (or a clean no-prior fallback)', async ({ page }) => {
  await page.locator('.crew-card', { hasText: 'Dax' }).click();
  await page.locator('#crew-menu').getByText('Resume last conversation').click();

  const toast = page.locator('.crew-toast').last();
  await expect(toast).toBeVisible();
  // Either a resume command, or — with no prior on record — a fresh session fallback.
  // Both are valid; the journey is "the operator gets a runnable claude command, never an error".
  await expect(toast.locator('.crew-toast-cmd')).toContainText('claude --', { timeout: 7000 });
});

'use strict';

const { test, expect } = require('@playwright/test');

// Journey: operator flips LCARS Mode (dark skin) on/off and it persists.
//
// slice-348-ac-1 (Julian, adversarial guard): slice 348 softened the LCARS body from
// pure black (#000) to near-black charcoal #0b0b14 → computed rgb(11, 11, 20). The old
// assertion here pinned rgb(0, 0, 0); that now CONFLICTS with the AC, so it is updated to
// the new value — intent preserved (the skin still actually goes dark), not weakened.
// I pin the EXACT computed rgb the AC names AND explicitly assert it is NOT pure black, so
// a revert to #000 (or any drift away from #0b0b14) goes red. I also guard the
// .dashboard-container, which slice 348 recoloured in the same breath, so a half-revert
// (body softened, container left black — or vice-versa) can't slip through green.
//
// @ac-hash: slice-348-ac-1 sha256:d26b9f47d07ddd4b2106766f0a8a2038870624e6cc7af1bb3af2c683318da052

test('J-lcars-bg slice-348-ac-1 — LCARS toggle switches to near-black charcoal (not pure black), persists across reload, and toggles back', async ({ page }) => {
  await page.goto('/');
  const body = page.locator('body');
  await expect(body).not.toHaveClass(/lcars-mode/);

  await page.locator('.lcars-switch').click();
  await expect(body).toHaveClass(/lcars-mode/);

  // slice-348-ac-1: the body background is the near-black charcoal #0b0b14 → rgb(11, 11, 20),
  // and explicitly NOT pure black #000 (the value slice 348 replaced).
  await expect(body).toHaveCSS('background-color', 'rgb(11, 11, 20)');
  await expect(body).not.toHaveCSS('background-color', 'rgb(0, 0, 0)');
  // the container recoloured in the same slice must match — no half-revert to black.
  await expect(page.locator('.dashboard-container')).toHaveCSS('background-color', 'rgb(11, 11, 20)');

  // persists across reload
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/lcars-mode/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 11, 20)');

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

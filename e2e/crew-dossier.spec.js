'use strict';

const { test, expect } = require('@playwright/test');

// Journey: a stakeholder clicks a crew tile, opens the role menu, and inspects the
// 3-tab dossier (Role / Memory / Artifacts) — the real feature, in a real browser.
//
// Crew identity is mode-dependent: cards show neutral HUMAN names in light mode and the
// DS9 CHARACTER names only in the LCARS skin. So cards are selected by their stable
// data-role key, never the display name. (The dossier title is the canonical role
// identity served by /api/crew/:role — it stays the DS9 name in both modes.)

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('crew tile opens the menu with New / Resume / Inspect', async ({ page }) => {
  await page.locator('.crew-card[data-role="ziyal"]').click();
  const menu = page.locator('#crew-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('New conversation');
  await expect(menu).toContainText('Resume last conversation');
  await expect(menu).toContainText('Inspect role');
});

test('Inspect role opens the dossier; tabs switch; artifacts open', async ({ page }) => {
  await page.locator('.crew-card[data-role="dax"]').click();
  await page.locator('#crew-menu').getByText('Inspect role').click();

  const overlay = page.locator('#crew-dossier-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#crew-dossier-title')).toHaveText('Dax');

  // Role tab is default and renders Dax's ROLE.md.
  await expect(page.locator('#crew-dossier-body')).toContainText('Architect');

  // Memory tab.
  await overlay.locator('.crew-tab[data-tab="memory"]').click();
  await expect(page.locator('#crew-dossier-body')).not.toBeEmpty();

  // Artifacts tab → at least one clickable artifact → opening it shows a back link.
  await overlay.locator('.crew-tab[data-tab="artifacts"]').click();
  const firstArtifact = overlay.locator('.crew-artifact-item').first();
  await expect(firstArtifact).toBeVisible();
  await firstArtifact.click();
  await expect(overlay.locator('.crew-artifact-back')).toBeVisible();

  // Close cleanly.
  await overlay.locator('.history-detail-close').click();
  await expect(overlay).toBeHidden();
});

test('Worf is an active role with a populated dossier (not "planned")', async ({ page }) => {
  const worf = page.locator('.crew-card[data-role="worf"]');
  await expect(worf).toContainText('Release Engineer'); // light-mode role title (LCARS: "DevOps / Release Engineer")
  await worf.click();
  await page.locator('#crew-menu').getByText('Inspect role').click();
  await expect(page.locator('#crew-dossier-title')).toHaveText('Worf');
  await expect(page.locator('#crew-dossier-body')).toContainText('release engineer');
});

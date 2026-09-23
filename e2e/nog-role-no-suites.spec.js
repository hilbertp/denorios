'use strict';

const { test, expect } = require('@playwright/test');

// Journey: a stakeholder clicks Nog's crew tile, inspects the role, and reads the rule
// that says which suites Nog does not run.
//
// Why this criterion has a screen at all. Slice 399's packet declared "Screen hooks:
// none", and both Rom's report and Nog's review concluded the stage had no surface to
// click. That is true of slice-399-ac-1/2/3, which assert the string `buildNogPrompt`
// returns — an in-process value handed to a headless subprocess, rendered nowhere. It is
// NOT true of slice-399-ac-4: the crew dossier renders each role's ROLE.md straight from
// disk (the e2e fixture copies the real .claude/ tree in seed-fixture.js), so the
// paragraph this criterion is about is a thing you can click to and read. That makes it a
// screen criterion, and this is its one browser test.
//
// Written against the criterion, never against the file. Every expected string below
// comes from O'Brien's AC-4 text and from the rule as the brief's Task 2 words it. This
// stage does not open `.claude/roles/nog/ROLE.md` — it is a product artifact the slice
// changed, and reading it would mean verifying the criterion against the answer sheet.
// The browser reads it instead, which is the whole point of a browser test.
//
// Strict on substance, loose on voice: the rule is pinned by what it must forbid, permit
// and cite, not by ROLE.md's exact sentences (the role file says "He may run…" where the
// prompt says "You may run…"; pinning either phrasing would guard the wording, not the
// rule).
//
// @ac-hash: slice-399-ac-4 sha256:7152367162643a19875738cd8f52828c54274657fc7a27e722ca845571a532b1

const NOG_CARD = '.crew-card[data-role="nog"]';
const HEADING = 'What Nog does not run';
const NEXT_SECTION = 'What Nog never rejects for'; // the section that follows it in ROLE.md

// Starting state the hook needs: the dashboard loaded, Nog's tile clicked, "Inspect role"
// chosen from the tile menu, the dossier overlay open on its default Role tab.
async function openNogRoleTab(page) {
  await page.goto('/');
  await page.locator(NOG_CARD).click();
  await page.locator('#crew-menu').getByText('Inspect role').click();
  const overlay = page.locator('#crew-dossier-overlay');
  await expect(overlay).toBeVisible();
  // The dossier title is the canonical role identity — it confirms we are reading Nog's
  // role file and not another crew member's.
  await expect(page.locator('#crew-dossier-title')).toHaveText('Nog');
  await expect(page.locator('#crew-dossier-body')).not.toBeEmpty();
  return page.locator('#crew-dossier-body');
}

// AC-4 says "one paragraph headed …", so the rule is checked inside that one paragraph
// rather than anywhere in a 17k-character document — a match drifting in from another
// section must not satisfy this guard.
function paragraphUnder(bodyText, heading) {
  const blocks = bodyText.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const i = blocks.findIndex(b => b.includes(heading));
  if (i === -1) return null;
  // Tolerate a renderer that emits the bold heading as its own block: heading plus the
  // text immediately under it is the same "paragraph headed X" either way. The
  // one-paragraph assertion below catches it if this ever swallows the next section.
  const isBareHeading = blocks[i].replace(heading, '').replace(/[.\s*_#]/g, '').length === 0;
  return isBareHeading && blocks[i + 1] ? `${blocks[i]}\n${blocks[i + 1]}` : blocks[i];
}

test('J-nog-dossier slice-399-ac-4 — Nog\'s dossier carries the no-suite rule in one paragraph headed "What Nog does not run", citing ADR-PROOF-LANES Rule 1', async ({ page }) => {
  const body = await openNogRoleTab(page);
  const text = await body.innerText();

  // The heading exists, and exactly once — "one paragraph", not a rule scattered about.
  expect(text).toContain(HEADING);
  expect(text.split(HEADING).length - 1).toBe(1);

  const para = paragraphUnder(text, HEADING);
  expect(para, `no paragraph found under "${HEADING}"`).not.toBeNull();

  // One paragraph: it must not run on into the section that follows it.
  expect(para).not.toContain(NEXT_SECTION);

  // The no-suite rule: both suites forbidden, each named by the command that runs it.
  expect(para).toMatch(/safety-net suite/i);
  expect(para).toMatch(/browser suite/i);
  expect(para).toContain('npm test');
  expect(para).toContain('node --test regression/');
  expect(para).toContain('npx playwright test');

  // …and the permission that keeps it from reading as "run nothing".
  expect(para).toMatch(/may run the test files/i);
  expect(para).toMatch(/linter/i);

  // The citation AC-4 asks for, in the same paragraph, and load-bearing rather than
  // decorative: Rule 1 is the proof-lanes rule that machines run suites and agents do not.
  expect(para).toContain('ADR-PROOF-LANES');
  expect(para).toMatch(/Rule\s*1/);
});

'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedVerdictSourceSlices } = seedFixture;

// Journey: a stakeholder opens the Logbook after Jordan's verdict was recovered from a
// messy verdict file, and reads the round column — the round the bug used to cost is not
// there, and the outcome is a success.
//
// Why this criterion has a screen at all. Slice 400 is a daemon-internal slice and its
// packet declares "Screen hooks: none". That is true of ac-1, ac-2, ac-3 and ac-6, which
// assert what `readNogVerdict` returns for a given pair of strings — an in-process value
// that reaches no page. It is NOT true of ac-4. ac-4 changes the shape of the
// NOG_DECISION records written to `bridge/register.jsonl`, and the register IS a screen:
// the History / Logbook panel renders one row per slice from it, with a round count and
// an outcome pill. A criterion that changes what the product writes into the file the
// History reads is a criterion with a surface, whatever the hooks section says.
//
// What this test guards, stated exactly, because overclaiming is worse than not testing:
//   - a NOG_DECISION carrying `verdict_source` renders as a finished round-1 success —
//     the additive field disturbs no column of the row;
//   - all three values ac-4 enumerates (`frontmatter`, `unfenced`, `review_section`)
//     render identically — the screen treats a recovered verdict as exactly as good as a
//     cleanly-fenced one, which is the whole point of the slice;
//   - the round column can tell the two worlds apart. The pre-fix register shape — an
//     ACCEPTED lost to `verdict_unreadable`, then a second round — renders "2". Without
//     that contrast the "1" above would be an assertion that cannot fail.
//
// What it does NOT guard: that `invokeNog` emits `verdict_source` at all. That call path
// spawns `claude -p`, the e2e fixture sets LOB_NO_LAUNCH=1 so it never can, and the
// orchestrator's own guards say the path is not headless-testable. The emission is
// Rom's safety-net test's to hold; this test holds the consequence of it on the screen.
//
// Written against the criterion, never against the code. Every expected value below comes
// from O'Brien's ac-4 text and from the goal line ("an ACCEPTED review never again costs a
// round"). This stage did not open `bridge/orchestrator.js` or `dashboard/`; how the round
// column is derived was established by seeding registers and reading the rendered page.
//
// @ac-hash: slice-400-ac-4 sha256:e3eadd348da52460cffcacc5108641ea24bd5a44f4254c696bfa7245330f0926

// Hooks. The packet declared none, so these were found on the rendered page of the
// running product (element inspector on the live dashboard), as the day-one rule allows:
const ROW      = (id) => `.history-row[data-history-id="${id}"]`; // one row per slice
const ROUND    = '.col-round';                                    // rounds this slice cost
const SUCCESS  = '.outcome-pill.outcome-success';                 // the verdict pill

// Starting state the hooks need: the register seeded with finished slices, then the
// dashboard loaded — the Logbook renders rows only for slices that reached a terminal
// state, so an empty register shows no row at all.
test.beforeEach(async ({ page }) => {
  seedVerdictSourceSlices();
  await page.goto('/');
  await expect(page.locator('.history-row').first()).toBeVisible({ timeout: 10000 });
});

test.afterAll(() => { seedFixture(); }); // restore the default register for later specs

test('J-verdict-recovery slice-400-ac-4 — a verdict recovered from a messy file costs no round: every verdict_source renders as a round-1 success, while the lost-verdict shape it replaces renders 2', async ({ page }) => {
  // ── The three sources ac-4 enumerates, one seeded slice each. ──
  // Each is a review Jordan ACCEPTED, differing only in how the daemon managed to read
  // it. The stakeholder must not be able to tell them apart: one round, success.
  for (const [id, source] of [['7401', 'frontmatter'], ['7402', 'unfenced'], ['7403', 'review_section']]) {
    const row = page.locator(ROW(id));
    await expect(row, `no Logbook row for the ${source} slice`).toBeVisible();

    await expect(row.locator(ROUND), `a verdict read from ${source} must cost exactly one round`)
      .toHaveText('1');
    await expect(row.locator(SUCCESS), `a verdict read from ${source} must show a success outcome`)
      .toBeVisible();
  }

  // ── The discriminator: the world before this slice. ──
  // Slice 7404 carries the register shape the bug produced — Jordan's ACCEPTED filed as
  // REJECTED/verdict_unreadable, and the slice sent round again. It ends accepted too, so
  // the outcome pill cannot tell the two apart; the round column is what costs. If this
  // read "1" the assertions above would be vacuous.
  const lost = page.locator(ROW('7404'));
  await expect(lost).toBeVisible();
  await expect(lost.locator(ROUND), 'the pre-fix lost-verdict shape must still render the round it cost')
    .toHaveText('2');

  // And the row this slice exists to prevent is genuinely the same slice in every other
  // respect — same title, same eventual verdict. Only the round differs.
  await expect(lost.locator(SUCCESS)).toBeVisible();
});

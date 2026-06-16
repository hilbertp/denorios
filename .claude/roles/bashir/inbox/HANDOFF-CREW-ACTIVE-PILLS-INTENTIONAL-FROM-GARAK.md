# Heads-up: the crew "active" pills were removed — INTENDED behaviour

**From:** Garak
**To:** Julian Bashir (QA)
**Date:** 2026-06-16
**Scope:** Ops dashboard — Roles Manifest (crew roster) cards

---

## What changed

Per Philipp, I removed the green **`active`** pill (`<span class="crew-badge badge-active">active</span>`) from all 8 crew cards in `dashboard/lcars-dashboard.html`. Every role is active, so the pill was redundant clutter — eight identical badges saying the same thing.

**This is an intended spec change, not a regression.** Flagging it to you directly so that if a roster check goes red on your gate, you treat it as *move-the-assertion*, not *something broke*.

## What it did NOT touch (so your gate stays green)

- The `crew-card active` **CSS class** is **retained** on all 8 cards — it's the clickable/non-planned state, distinct from the visible pill. (`planned` cards still get `pointer-events: none`.)
- Your existing guard `j-direct-controls-ops-ui slice-99808-ac-3` keys on that **class** (`cardMatch[1]` matches `\bactive\b`), not the pill text — so it still passes. Verified: 12/12 in `j-direct-controls-regression-coverage.test.js`, full regression green.
- No regression or e2e test asserts the visible pill, so nothing went red.

## If you add roster coverage later

Assert the pill is **ABSENT** (`assert.doesNotMatch(html, /crew-badge badge-active/)`) — re-adding it would be the regression now. Keep asserting the `crew-card active` class + `crew-card-clickable` for the clickable state. The `.crew-badge` / `.badge-active` CSS is left in place (dead but harmless; `badge-planned` still uses `.crew-badge`).

No action needed from you unless you want to add the absent-pill guard. — Garak

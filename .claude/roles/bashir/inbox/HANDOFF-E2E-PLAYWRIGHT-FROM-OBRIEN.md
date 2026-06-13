# Finish the Playwright end-to-end clicktest suite

**From:** O'Brien (Tech Lead)
**To:** Bashir (QA Engineer)
**Date:** 2026-06-13
**Scope:** Real browser e2e clicktests for the Ops dashboard — every user journey

---

## Why this exists

This session's regression audit found your suite is fast (1.4s / 164 tests) because **~60% of it is the test talking to itself** — source-string greps over `lcars-dashboard.html` and round-trips of fixtures the test itself wrote. The hard numbers: **0 of 20 files invoke a real `claude` agent, drive a real browser, or run the real end-to-end pipeline.** Two "journey" tests are already green while guarding code that no longer exists (`j-rom-completes-slice` checks a `## Rom DONE Report` heading the orchestrator doesn't emit; `j-stage-and-watch-slice` asserts `## Goal`/`## Acceptance criteria` but `new-slice.js` emits `## Objective`/`## Success criteria`).

Philipp's mandate: **real Playwright clicktests that prove every user journey actually works in a browser.** I built the foundation; QA owns the test suite, so you finish it.

## What I'm asking for

Get a green, comprehensive Playwright e2e suite: fix the one known blocker, cover all the dashboard journeys, wire it into CI as a separate job, and commit to dev.

## Context — everything you need (start fresh)

**Already built & committed to `dev`:**
- `playwright.config.js` — builds a deterministic fixture, then boots the **real** dashboard server against it.
- `e2e/seed-fixture.js` — creates `os.tmpdir()/lob-e2e-fixture`: copies `.claude/`, `regression/`, `docs/` + `bridge/*.js` from the repo, seeds a clean `bridge/` state, and writes two staged proposals (`9001`, `9002`). Exports `seedFixture()` (full) and `resetQueueState()` (light reset for mutating journeys — does NOT nuke the tree, which would crash the live server).
- `e2e/crew-dossier.spec.js`, `e2e/lcars-mode.spec.js`, `e2e/engineering-queue.spec.js` — first journeys (crew menu/dossier/artifacts, LCARS toggle, approve + auto-approve).
- `dashboard/server.js` — added a `DASHBOARD_REPO_ROOT` env override so the data layer (bridge/.claude/regression) points at the fixture while the frontend is still the real shipped HTML. **Backward-compatible** (only active when the env var is set).
- `@playwright/test@1.60` + chromium are installed (in `package.json` devDependencies; `node_modules/` gitignored).

**How to run:** `npx playwright test`  (config boots `node dashboard/server.js` with `DASHBOARD_REPO_ROOT=<fixture> DASHBOARD_PORT=4799 LOB_NO_LAUNCH=1`). Real frontend + fixture backend, fully deterministic.

**⛔ THE BLOCKER (precise — this is where I stopped):**
The server boots, serves one request, then **crashes** with:
```
Error: Cannot find module '…/lob-e2e-fixture/bridge/state/gate-alerts'
    at dashboard/server.js:1629
```
`/api/gate-health` does a dynamic `require(path.join(REPO_ROOT, 'bridge', 'state', 'gate-alerts'))`. The dashboard polls that endpoint, the require throws **uncaught**, the process dies, and every later test gets `ERR_CONNECTION_REFUSED`. (1 test — "crew tile opens the menu" — passed before the crash, so the harness itself works.)

**THE FIX:** `e2e/seed-fixture.js` copies `bridge/*.js` but **not** `bridge/state/*.js`. Add a copy of `bridge/state/*.js` (gate-alerts.js lives there), or copy all of `bridge/**/*.js`. Then `grep -n "require(path.join(REPO_ROOT" dashboard/server.js` and make sure **every** dynamically-required module resolves in the fixture (there may be more than one).

## Journeys still to cover

Start from the 3 specs, then add (one spec file per area, `e2e/<area>.spec.js`):
- **Conversation menu** — New / Resume from a crew tile: assert the toast + the `claude …` command shown. `LOB_NO_LAUNCH=1` guarantees no Terminal spawns.
- **Infirmary CI-strip** — the regression **"⬚ report"** link opens the report overlay (🟢 passing).
- **Gate button** — "RUN GATE & MERGE TO MAIN": assert the `DISPATCHING…` pre-network acknowledgement only. **Do NOT trigger a real merge** — seed `branch-state.json` so it's inert, or assert just the optimistic UI state before the fetch.
- **History (Logbook)** — outcome chips / `dev → reg → main` lifecycle chain render; pagination works.
- **Economics (Quark's Ledger)** — per-role rows render; the collapse toggle works.
- **Drag-reorder** — reorder two Approved Work Orders, assert `queue-order.json` (via `/api/bridge`) reflects it.

## Acceptance criteria

1. `npx playwright test` is **green** locally across all journeys.
2. A test exists for **every** major dashboard user journey (list above).
3. Deterministic — fixture-based, no live-`bridge/` dependency, **no real claude / Terminal / git side effects**.
4. Wired into CI as a **separate** job (`.github/workflows/`): `npx playwright install --with-deps chromium` then `npx playwright test`. It is slower/heavier than the 1.4s unit gate — keep it a **separate job**, not in the hot loop.
5. Where it makes sense, name tests `slice-<id>-ac-<n>` so failures route through `scripts/regression-report.js` to O'Brien.
6. Committed to `dev`.

## What NOT to worry about

- **No real `claude` agent runs here** — that's a separate opt-in/nightly smoke and is blocked by billing (subscription org-disabled; needs a funded `ANTHROPIC_API_KEY`). Out of scope.
- **Don't fold e2e into the fast unit gate** — it's a separate, slower CI job by design.
- **Don't let any test trigger a real merge or dispatch** — the gate button must stay inert in tests.
- **Don't commit generated artifacts** — `regression/LAST-RUN.md`, the O'Brien inbox regression handoff, `test-results/`, `playwright-report/` are/should be gitignored.

— O'Brien

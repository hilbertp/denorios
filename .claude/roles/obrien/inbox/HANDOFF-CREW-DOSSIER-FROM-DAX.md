# HANDOFF — Crew-card dossier overlay (Role / Memory / Mission tabs)

**From:** Dax (Architect)
**To:** O'Brien — slice and stage for dispatch
**Date:** 2026-06-12
**Status:** GREENLIT by Philipp (2026-06-12, chat with Dax) — ready to slice

---

## What to build

Every crew card on Ops becomes clickable and opens a dossier overlay with three tabs: **ROLE | MEMORY | MISSION**. This generalizes the existing Bashir coverage-overlay pattern (`crew-card-clickable` in `dashboard/lcars-dashboard.html`, markdown overlay fed by `/api/regression/coverage` in `dashboard/server.js` ~line 1753).

## Full spec

`/Users/phillyvanilly/01 - The Liberation of Bajor/COMMISSION-CREW-DOSSIER-TABS.md`

Contains: the `GET /api/crew/:role/dossier` endpoint contract (allowlist, null-payloads for missing files, read-only), the per-role source map for all nine roles (note Rom's special cases: ROLE tab = `.claude/CLAUDE.md`, MISSION tab = active in-progress brief), UI behavior, empty states, and seven acceptance criteria.

## Slicing suggestion (your call)

Natural seam is two slices: (1) the dossier API endpoint with the source map + allowlist, (2) the UI — cards clickable, tabbed overlay, empty states. AC #5 (graceful empty states) is verifiable today since no memory vaults exist yet.

## Constraints

- Must NOT scaffold memory directories — that belongs to the Memory Protocol slice (separate, still awaiting Philipp's approval). The dossier degrades to empty states until vaults exist.
- Keep `/api/regression/coverage` working (back-compat); Bashir's MISSION tab may reuse it or the new endpoint.

— Dax

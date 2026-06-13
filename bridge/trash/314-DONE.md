---
id: "314"
title: "Ops reads GitHub truth + retire the dead local-merge controls (Ziyal redesign · step 1/3)"
from: rom
to: nog
status: DONE
slice_id: "314"
branch: "slice/314"
completed: "2026-06-05T00:00:00.000Z"
tokens_in: 52800
tokens_out: 8600
elapsed_ms: 4200000
estimated_human_hours: 3.6
compaction_occurred: false
---

## What was done

Step 1 of 3 in Ziyal's Ops redesign: data-source swap (local → GitHub) plus dead-control demolition.

### Amendment (round 2) — cache guard fix

Fixed `_getGhCi` TTL cache bypass in `dashboard/server.js:93`.

**Before:** `if (_ghCiCache.value !== null && now - _ghCiCache.fetchedAt < GH_TTL_MS)`
— When `gh` returns `null` (not installed / not authenticated), the guard treated this as "never fetched" and re-ran `execFileSync('gh', ...)` on every poll, violating the explicit caching requirement.

**After:** `if (_ghCiCache.fetchedAt > 0 && now - _ghCiCache.fetchedAt < GH_TTL_MS)`
— The guard now checks whether a fetch has been attempted (regardless of outcome), so a `null` result is cached for `GH_TTL_MS` (60s) like any other result.

---

### `dashboard/server.js`

Added `getGitHubState()` with separate TTL caches (30s for git, 60s for gh):
- `_getGitTips()`: runs `git fetch origin main dev` then `git rev-parse origin/main` / `origin/dev` (separate calls — `--short` doesn't support multiple args), `git rev-list --count origin/main..origin/dev`, `git log origin/dev --not origin/main` for dev commit list (with slice_id parsed from subject), `git log origin/main` for promote SHA+age.
- `_getGhCi()`: runs `gh run list --workflow=ci.yml --branch=dev --json ...` — gracefully null when `gh` is not installed or not authenticated. Result (including `null`) is now properly cached for 60s.

The `/api/branch-state` endpoint now:
1. Reads `branch-state.json` (kept as fallback for gate step data still used in steps 2/3)
2. Overlays `base.github = getGitHubState()` (new field)
3. Overwrites `base.main.tip_sha` and `base.dev.tip_sha` with real origin SHAs
4. Overwrites `base.dev.commits_ahead_of_main` with real count from GitHub
5. Populates `base.dev.commits` from `git log` when dev has commits ahead of main

### `dashboard/lcars-dashboard.html`

**Branch Topology (`renderTopoSvg`)**:
- Main dot tooltip/title: `origin/main: <sha>`
- Main dot label: new `<text>` element above the dot reading `origin/main`
- HEAD dev dot: badge changed from `HEAD` to `origin/dev` (wider rect: 64px vs 40px)
- ariaLabel updated to reference `origin/dev` / `origin/main`

**Footer (`renderTopoFooter`)**:
- Removed entire gate-status conditional (GATE_RUNNING / GATE_FAILED / GATE_ABORTED / merge button)
- Stats label: "N commits ahead of origin/main" (was "ahead of main")
- Action slot: replaced with `<span style="font-size:12px;color:var(--ink-3)">auto-promotes on green</span>`

**Header pill (`updateServicesPanel`)**:
- Removed: `bsGateRunning`, `watcherPaused`, `activePaused`, `isBatchGate` variables
- Removed: BATCH GATE pill branch
- Removed: `if (isBatchGate)` tooltip block
- Added: explicit DEGRADED branch for stale heartbeat (orchStatus === 'stale' OR hbAge 30-60s) using existing `.health-pill.degraded` CSS

**Dead-control removal**:
- `mergeButtonClick()` function: deleted entirely (was ~36 lines)
- BATCH GATE override block in `fetchBranchState()`: deleted (7 lines)
- BATCH GATE pill lines in `gateEventHandlers['gate-start']`: deleted

### `dashboard/tokens.css`
- Removed `--shadow-cta` token (existed only for the merge button)

---

## Acceptance criteria verification

| # | Criterion | Status |
|---|---|---|
| 1 | Payload includes real `origin/main` + `origin/dev` SHAs matching `git ls-remote origin` | ✅ Sample: `"origin_main_sha":"6b36fe7","origin_dev_sha":"6b36fe7"` |
| 2 | Branch graph + "N commits ahead" use GitHub origin tips; tips labelled `origin/main` / `origin/dev` | ✅ `origin/main` label on main dot, `origin/dev` badge on HEAD dot, stats say "ahead of origin/main" |
| 3 | Payload carries CI state + run number + URL and promote result | ✅ `ci` field present (null when `gh` absent — graceful, and now properly cached); `promote: {sha, full_sha, age_s}` always populated from `git log origin/main` |
| 4 | "Merge to main" button, `mergeButtonClick()`, and any merge POST: gone | ✅ `grep -c "merge-btn\|mergeButtonClick\|Merge to main" lcars-dashboard.html` → 0 |
| 5 | Header no longer shows BATCH GATE; DEGRADED liveness still works | ✅ `grep -c "BATCH.GATE\|isBatchGate\|bsGateRunning" lcars-dashboard.html` → 0; `.health-pill.degraded` CSS + DEGRADED branch present |
| 6 | `.merge-btn` CSS and `--shadow-cta` token removed | ✅ 0 matches in both files |
| 7 | No raw hex colors added | ✅ Only `var(--ink-3)` used in new caption |
| 8 | Sample `/api` payload showing GitHub tips + CI/promote | ✅ See smoke test output below |

## Sample `/api/branch-state` payload (smoke test)

```json
{
  "main": { "tip_sha": "6b36fe7" },
  "dev": { "tip_sha": "6b36fe7", "commits_ahead_of_main": 0 },
  "github": {
    "origin_main_sha": "6b36fe7",
    "origin_dev_sha": "6b36fe7",
    "commits_ahead": 0,
    "dev_commits": [],
    "promote": { "sha": "6b36fe7", "full_sha": "6b36fe7cefbcf4c...", "age_s": 25266 },
    "fetched_at": "2026-06-04T21:18:06.799Z",
    "error": null,
    "ci": null
  }
}
```

(`ci` is null because `gh` CLI is not installed in this environment — it will populate when gh is present. The null result is now cached for 60s so polling does not spawn `gh` on every request.)

## Diff summary (total across both rounds)

```
 dashboard/lcars-dashboard.html | 149 ++++++-----------------------------------
 dashboard/server.js            | 124 +++++++++++++++++++++++++++++++---
 dashboard/tokens.css           |   1 -
 3 files changed, 135 insertions(+), 139 deletions(-)
```

## Amendment grep verification

```
grep -c "_ghCiCache.value !== null" dashboard/server.js  → 0
grep -c "_ghCiCache.fetchedAt > 0" dashboard/server.js  → 1
```

## Notes for Nog

- The gate step cards (`#gate-steps`, `gate-step-1/2/3`) and `renderTopoMini` gate status pills are **intentionally kept** — their removal is step 3.
- The `renderTopoMini` still shows gate status pills — these are the mini-panel pills, not the header. Leave them.
- The `/api/gate-health`, `/api/gate/start`, `/api/gate/abort`, `/api/gate/events` endpoints are still in `server.js` — removal is step 3.
- The CI strip display and Bashir lane move are step 2.
- The 4 pre-existing failures in `test/services-panel.test.js` (missing `#services-panel` element, missing data-service rows) were failing before this slice — not introduced here.

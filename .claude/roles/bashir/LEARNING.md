# Bashir — Behavioral Learnings

*Cross-session behavioral calibration for Bashir. Append here when a session surfaces a durable pattern worth carrying forward; do not log per-session events.*

## 2026-09-01 — packaging/S-numbering coverage session

- **Never tag a test against a PLANNED slice's AC indices.** j-ac-amend-order squatted
  `slice-350-ac-3/4` months before slice 350 shipped different ACs under those indices —
  the collision misclassified in the AC gate as "update-test". Tag against shipped
  trailers or use a `J-<journey>` tag until the slice lands.
- **Trailer grammar is strict and transition-matched.** `Test-Loosen-OK: <one-token-target>
  <strict->weak|removed|skipped|reworded> <reason>` — a colon glued to the path token or a
  transition that doesn't match the engine's signing silently fails to clear the flag.
  Run `node scripts/tests-needed.js` BEFORE pushing a suite-reshaping commit, not after.
- **Engine first-match quirk:** the override lookup takes the first target-matching
  trailer even when its transition mismatches, so same-file pairs (strict→weak + removed)
  shadow each other. Workaround: target the tagged check by TAG (matched before the path
  rule), keep only the untagged-title transition on the file path. Flagged to Worf.
- **Coverage registration mechanics:** COVERAGE.lock guards register only via STATIC
  `readFileSync(path.join(REPO_ROOT, 'literal…'))` of a BEHAVIOUR-bucketed source inside
  `regression/` — dynamic walks, e2e specs, and INERT-bucketed sources (package.json,
  release.yml, bin/) never corroborate. Design guards accordingly; route bucket gaps to Worf.
- **The drain feed (static manifest) is blind to trailer-declared ACs**; the live
  Pipeline A range-scan is not. After new slices land, read the trailers directly
  (`git log origin/main..origin/dev --format=%B | grep '^AC:'`) — don't trust an empty
  NEW-ACS.md as "nothing new".
- **Topology label contract:** `/api/branch-state` `dev_commits` is OLDEST-first; the
  "newest" line renders the last element. Branch-graph shas also live in hidden SVG
  `<title>` tooltips — assert via `innerText` (visible text), not `getByText`.

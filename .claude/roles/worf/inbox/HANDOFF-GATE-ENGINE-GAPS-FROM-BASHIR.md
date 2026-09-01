# Three gate-engine gaps surfaced during the packaging/S-numbering coverage pass

**From:** Bashir (Julian, QA)
**To:** Worf (DevOps — gate machinery owner)
**Date:** 2026-09-01
**Scope:** `lib/tests-needed.js` bucket map + override lookup; coverage-walker scope. All three surfaced while authoring guards for slices 350/351/352 (session commits b2470c8, 339c833, 100e22b on dev).

---

## 1. INERT bucket hides the packaging surfaces from the AC classifier

`package.json`, `.github/workflows/release.yml`, and `bin/` are INERT-bucketed in `lib/tests-needed.js`. Since slices 351/352 they carry real product behaviour (files whitelist, CLI, release pipeline), and real guards exist over them (`regression/packaging/`) — but INERT sources never enter `COVERAGE.lock`, so the guards cannot corroborate and Pipeline A flags slice-351-ac-1..3 and slice-352-ac-1..4 "decide" despite full coverage. Consider promoting those paths to BEHAVIOUR (or an explicit packaging bucket). Until then Philipp has to "keep"-rule ACs that are actually tested — a mislabel the ledger then records.

## 2. Coverage walker only walks `regression/` — e2e guards can never corroborate

`scripts/build-coverage-map.js` walkTests is rooted at `regression/`. Browser-only ACs (e.g. slice-350-ac-2, guarded in `e2e/s-numbering.spec.js`) therefore always classify MISSING. If e2e specs carried the same `@ac-hash` contract (they already use the slice-tag naming), walking `e2e/**/*.spec.js` would close the gap. Your call whether that's worth the lock churn.

## 3. Override lookup is first-match-by-target, transition checked after

In `lib/tests-needed.js` `decide()`, the `Test-Loosen-OK` lookup `find()`s the first trailer whose **target** matches the check and only then compares the transition. Two same-file trailers with different transitions (a file needing both `strict→weak` and `removed`) shadow each other — whichever parses first blocks the other, and the RED is only clearable via the tag-target workaround (tag-targeted trailer for the tagged check, path-targeted for the untagged one — see commit 100e22b). Suggested fix: filter target matches, then pick the transition-matching one; `mismatchedOverride` only when no candidate matches both.

---

No urgency — all three have workarounds and are documented in `regression/COVERAGE.md` (2026-09-01 section) and my LEARNING.md. But #1 actively misroutes operator decisions, so it's first among equals.

— Bashir

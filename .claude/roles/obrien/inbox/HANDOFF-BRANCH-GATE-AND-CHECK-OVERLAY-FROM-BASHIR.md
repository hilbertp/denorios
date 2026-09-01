# Target DevOps practice: suite-on-the-feature-branch gate + a real "apply the update" path in the CHECK overlay

**From:** Bashir (Julian, QA)
**To:** O'Brien (Tech Lead — pipeline sequencing owner)
**Date:** 2026-09-01
**Per:** Philipp's ruling of 2026-09-01 (verbatim intent below) — this is the commissioning ask; slicing and sequencing are yours.

---

## Philipp's target practice (stated 2026-09-01)

1. Rom + Nog deliver on a feature branch.
2. Bashir reads the ACs the slice was commissioned with (never the diff) and updates the regression + e2e suites accordingly.
3. The **updated** suites run **on the feature branch**.
4. Only green admits the merge.

## Where reality diverges today

- Suites run on `dev` AFTER the squash (`ci.yml` per push) and again at promote time — nothing runs them on the slice branch pre-merge, and no Bashir step exists between Nog's accept and the squash.
- The CHECK overlay's only lever is "No test needed for this AC" — there is no "apply the test update" action. Philipp explicitly refused to click a lie; this gap is what triggered his ruling.

## What I already fixed (QA-side, committed to dev)

The overlay's 10 standing flags were FALSE — coverage existed but the classifier couldn't see guards over INERT-bucketed sources or in `e2e/`. The coverage-map deriver now registers annotation-declared guards (`@ac-hash` + tagged title) from both suites; all 13 in-range ACs resolve. So the overlay's remaining job is the TRUE-flag path: an AC with genuinely no guard.

## What to commission (my proposal, your slicing)

1. **Overlay action "Apply Julian's draft"** — for a flagged AC with a `regression/.drafts/<tag>.draft.*` proposal: move the draft into the suite, run it, rebuild `COVERAGE.lock`, re-check. The overlay already links the drafts; only the action is missing. (Also in IDEAS.md.)
2. **Overlay action "Author the guard"** — no draft yet: dispatch the auto-author (scripts/author-ac-test.js path) for that tag, then the flow above.
3. **Branch-gate step** — run `node --test 'regression/**/*.test.js'` (and, where the slice touches UI, the e2e job) against the slice branch after Nog's accept and before `squashSliceToDev`; red blocks the squash. Where my updated tests land physically (on the slice branch, or a QA commit the squash folds in) is your call — note Dax's staged Model A ruling (`.claude/roles/dax/RESPONSE-AC-TEST-AUTHORING-FROM-DAX.md`, awaiting Philipp) already designs the authoring-time handoff; step 3 is its enforcement end.

## What NOT to change

- The AC-edit hard rule stands: no overlay action may modify an AC to go green — halt + escalate remains the only path there.
- The promote-time gate stays as the backstop; the branch gate is upstream of it, not a replacement.

— Bashir

---
**O'Brien 2026-09-01:** Sliced into S356 (draft review), S357 (draft contract), S358 (apply), S359 (author+containment), S360 (branch gate). S353 amended with the frozen-local-ref finding. All staged, awaiting Philipp.

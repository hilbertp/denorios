# HANDOFF: Rename the crew to real-world names — three slices, and where they sit in your queue

**From:** Worf (DevOps / release)
**To:** O'Brien (delivery coordinator)
**Date:** 2026-09-03 (evening)
**Scope:** Philipp's decision to drop the DS9 names everywhere, including internal keys. The plan, the name map and the acceptance criteria are in `docs/ROLE-RENAME-PLAN.md`; this handoff tells you what to file and in what order.

---

## Why this exists

Philipp decided today: every DS9 name goes, including the internal keys, not just what people see. People are shown as first name plus job title (Alex · Dev Lead, Sam · Full-Stack Engineer, Jordan · Reviewer, Julian · QA Engineer, Taylor · Architect, Chris · DevOps, Morgan · Product Manager, Riley · UX Specialist, Robin · Designer). The product name Denorios, the `DS9_*` environment variables and the GitHub repo stay. The LCARS skin goes.

That is a migration, not a find-and-replace: 37 string comparisons on a role key across four files, 19 role-named event strings, two headings the orchestrator parses to count review rounds and detect the fast path, 17 skills with folder paths, 23 test files, and 1,582 historic slice files that carry `to: nog` and friends and must keep working untouched. The plan does it readers-first so the pipeline never breaks between steps.

## What you're asking for

**One confirmation from Philipp before you file R1:** the internal keys are role nouns (`lead`, `builder`, `reviewer`, `qa`, `architect`, `devops`, `pm`, `ux`, `designer`), not first names. I recommend nouns; they survive a change of first name and read correctly when the crew is reused elsewhere. The map with legacy keys is section 1 of the plan.

**Three slices, acceptance criteria ready to paste from the plan, section 3:**

- **R1 — one map, every reader accepts both names.** `bridge/roles.json`, `lib/roles.js` with `canonical()` / `display()` / `title()` / `canonicalEvent()`, every comparison and every register reader through it, both heading forms accepted. Writes unchanged. No visible change.
- **R2 — writers switch, folders and files move.** `new-slice.js` writes the new keys; the orchestrator emits the new events and heading; prompt files, role folders and per-role tracking files renamed; skills' paths updated; `## What Rom does not do` becomes `## What Sam does not do`.
- **R3 — the dashboard shows real names and the skin goes.** Role map from `roles.json`, `data-role` keys canonical with the `e2e/` selectors updated in the same slice (declare it), LCARS toggle, class, CSS and stored preference removed, file renamed `dashboard.html` with the server, launch config and tests following.

**R4, the prose sweep, is mine and Philipp's**, not a slice: contracts, role files, skills text, CLAUDE.md, README, docs. Dated records stay as they are.

## The order across both of your lists

The rename touches the same files as test-ownership Slices 3 and 4. To write those once, with the new names:

1. Test-ownership Slice 1 (fake-work rule, re-queue 371) and Slice 2 (workspace dependencies). Unchanged, first.
2. R1, R2, R3.
3. Test-ownership Slice 3 (instructions) and Slice 4 (Julian's stage), now written with the new names and the new file paths (`reviewer-prompt.js`, `qa-prompt.md`, `.claude/roles/builder/ROLE.md`, `.claude/roles/lead/slice-body-template.md`).
4. R4 any time after R2.
5. Test-ownership Slices 5 and 6.

## Context the receiver needs

- **Tests inside these slices.** A renamed selector, key or heading reads as *reworded* to the Test-Update Gate, which is CLEAR, as long as no assertion is weakened. A renamed test **file** needs a `Test-Loosen-OK` by file path (the gate's file-path override). Regenerate `COVERAGE.lock` in the same slice so the guard count does not drop. Say all three in each brief's trap list.
- **Every brief carries the fixed block.** Until R2 lands it is still `## What Rom does not do`; from R2 on it is `## What Sam does not do`. R1's brief uses the old block; R2's brief switches it and updates the check.
- **The `e2e/` exception line for R3:** "This slice may change the `data-role` selectors in `e2e/*.spec.js` and the dashboard filename in `playwright.config.js` and the specs, because the keys are the subject. Rom writes no new `*.spec.js`."
- **History is untouched.** No slice rewrites `bridge/queue/`, `bridge/trash/` or `bridge/register.jsonl`. Readers accept the old names forever; that is what R1 buys.
- **The dashboard's light-mode map today says "Priya" for Bashir.** Philipp chose Julian. R3 fixes it through the map.
- **Kira's folder is deleted in R2** (retired role, empty inbox). `garak` has only tracking files, which R2 renames under `ux`.

## What NOT to worry about

- **The product name, the `DS9_*` variables, the launchd label, the repo name.** Staying. Philipp's call.
- **`bridge/roles.json`'s first version.** I will write it from the plan's table so R1 starts from a file, not a brief.
- **The prose sweep (R4).** Mine. Do not file it.
- **My own role's name.** I become Chris, `devops`. The handoffs I have already written keep saying Worf; that is history.

— Worf

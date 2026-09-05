# Role rename plan: from DS9 names to real-world names

*Written 2026-09-03 by Worf on Philipp's decision. Philipp chose: rename everything including internal keys; people are shown as first name plus job title; Bashir is Julian; the product name Denorios, the `DS9_*` environment variables and the GitHub repo stay; the LCARS skin goes.*

This document is the single source of truth for the map. Every slice below reads the map from here (and, once R1 lands, from `bridge/roles.json`, which is this table in machine form).

---

## 1. The map

Internal keys are **role nouns**, not first names. A key names the job, so it survives a change of first name and it reads correctly when the crew is reused on another project. The first name and the title are display only.

| Key (new) | Legacy keys (still accepted on read) | Shown as | Title |
|---|---|---|---|
| `lead` | `obrien`, `chiefobrien`, `kira` | Alex | Dev Lead |
| `builder` | `rom` | Sam | Full-Stack Engineer |
| `reviewer` | `nog` | Jordan | Reviewer |
| `qa` | `bashir` | Julian | QA Engineer |
| `architect` | `dax` | Taylor | Architect |
| `devops` | `worf` | Chris | DevOps / Release Engineer |
| `pm` | `sisko` | Morgan | Product Manager |
| `ux` | `ziyal`, `garak` | Riley | UX Specialist |
| `designer` | `leeta` | Robin | Designer |
| `orchestrator` | `watcher`, `orchestrator` | the orchestrator | (system, not a person) |

Retired and never created: `quark`, `odo`. They map to nothing and disappear from rosters.

**Confirm before R1 is filed:** keys as role nouns (above) rather than first names (`alex`, `sam`, …). Worf recommends nouns; Philipp decides.

### Derived names

| Thing | Old | New |
|---|---|---|
| Register events | `NOG_DECISION`, `NOG_PASS`, `NOG_INVOKED`, `NOG_ESCALATION`, `NOG_RETURN`, `NOG_TELEMETRY`, `ROM_STARTED`, `ROM_SESSION_RESUMED`, `ROM_WAITING_FOR_NOG`, `ROM_PAUSED`, `ROM_ABORTED`, `ROM_ESCALATE`, `BASHIR_INVOKED`, `BASHIR_TEST_NAMING_VIOLATION`, `ESCALATED_TO_OBRIEN` | `REVIEWER_DECISION`, `REVIEWER_PASS`, `REVIEWER_INVOKED`, `REVIEWER_ESCALATION`, `REVIEWER_RETURN`, `REVIEWER_TELEMETRY`, `BUILDER_STARTED`, `BUILDER_SESSION_RESUMED`, `BUILDER_WAITING_FOR_REVIEWER`, `BUILDER_PAUSED`, `BUILDER_ABORTED`, `BUILDER_ESCALATE`, `QA_INVOKED`, `QA_TEST_NAMING_VIOLATION`, `ESCALATED_TO_LEAD` |
| Parsed headings in slice files | `## Nog Review — Round N` · `## Rom Escalation — Slice Broken` | `## Review — Round N` · `## Builder Escalation — Slice Broken` |
| Prompt files | `bridge/nog-prompt.js`, `bridge/templates/bashir-prompt.md`, `bridge/templates/bashir-non-gate-prompt.md` | `bridge/reviewer-prompt.js`, `bridge/templates/qa-prompt.md`, `bridge/templates/qa-non-gate-prompt.md` |
| Role folders | `.claude/roles/obrien/` … | `.claude/roles/lead/` … (`kira/` deleted; `garak` has no folder) |
| Per-role tracking files | `timesheet-obrien.jsonl`, `tt-audit-obrien.jsonl`, `anchors-obrien.jsonl` … | `timesheet-lead.jsonl` … |
| Dashboard keys | `data-role="nog"` … | `data-role="reviewer"` … |
| The fixed brief block | `## What Rom does not do` | `## What Sam does not do` |
| Dashboard file | `dashboard/lcars-dashboard.html` | `dashboard/dashboard.html` |

### What is deliberately NOT renamed

- **History.** Existing slice files in `bridge/queue/` and `bridge/trash/` (1,582 of them), every line already in `bridge/register.jsonl`, every existing handoff, every dated record (the ruling record, past ADRs). They keep their old names; readers accept the old names forever. Rewriting history is not on the table.
- **The product.** `Denorios`, the package name, the GitHub repo, the launchd label, the eleven `DS9_*` environment variables. Philipp's call; they are plumbing, and the July rebrand locked the name.
- **`test/`.** Being deleted by the test-ownership Slice 6; not worth touching.

---

## 2. The strategy: readers first, writers second, display third, prose last

Every key is read in more places than it is written. So the safe order is:

1. **Teach every reader to accept both** (old and new) through one helper. No visible change. The pipeline keeps running on old names.
2. **Switch the writers** to the new names, move the folders and files. Old files still read fine because of step 1.
3. **Change what people see:** the dashboard and its tests, and remove the skin.
4. **Sweep the living prose:** contracts, role files, skills, CLAUDE.md, README, docs.

Each step is one slice and is green on its own. Nothing depends on a later step to work.

### Interaction with the six test-ownership slices (Worf's handoff of 2026-09-03)

The rename touches the same files as test-ownership Slices 3 and 4 (the orchestrator prompt assembly, `new-slice.js`, the reviewer and QA prompt files). To write those once, with the new names, the order across both lists is:

1. Test-ownership Slice 1 (fix the fake-work rule, re-queue 371) and Slice 2 (workspace dependencies): independent, urgent, unchanged.
2. Rename R1 (readers), R2 (writers, folders, files), R3 (dashboard and skin).
3. Test-ownership Slice 3 (instructions) and Slice 4 (Julian's stage), written with the new names.
4. Rename R4 (prose sweep) can run any time after R2; it is documents, not code.
5. Test-ownership Slices 5 and 6, unchanged.

---

## 3. The slices

Every one of these is Rom-built and carries the fixed brief block. Each declares that it may touch test files, because the tests are the subject (the Test-Update Gate reads a selector or name rename as *reworded*, which is CLEAR, as long as no assertion is weakened; a renamed test **file** needs `Test-Loosen-OK` by file path; `COVERAGE.lock` is regenerated in the same slice so the guard count does not drop).

### R1 — one map, every reader accepts both names

**Why.** Today 37 places compare a role key by string (30 in `bridge/orchestrator.js`, 4 in `dashboard/server.js`, 2 in `bridge/new-slice.js`, 1 in `bridge/slicelog.js`), 19 event strings carry a role name, two regexes parse a role name out of a heading, and the skills hard-code folder paths. None of that can change until every reader tolerates both forms.

**Acceptance criteria.**

- `bridge/roles.json` exists and is the table in section 1: for each key, its legacy keys, display name and title. `docs/ROLE-RENAME-PLAN.md` and this file agree; a test checks that.
- `lib/roles.js` exports `canonical(key)` (any legacy key or canonical key → canonical key; unknown → unchanged with a warning), `display(key)` and `title(key)`, and `canonicalEvent(name)` (legacy event name → canonical, unknown → unchanged).
- Every string comparison on a role key in the four files above goes through `canonical()`. A test feeds `to: nog`, `to: chiefobrien`, `from: rom`, `from: garak` and gets identical behaviour to `to: reviewer`, `to: lead`, `from: builder`, `from: ux`.
- Every reader of `bridge/register.jsonl` (server, `slicelog.js`, `rr-compute.js`, the History and Coverage panels) maps event names through `canonicalEvent()`. A test replays a register slice with `NOG_PASS` and one with `REVIEWER_PASS` and gets the same History row.
- The round counter and the escalation check accept both heading forms: `/^## (Nog )?Review — Round \d+/gm` and `/^## (Rom|Builder) Escalation — Slice Broken/m`. A test counts rounds correctly in a file that mixes both forms.
- Nothing is written differently yet: `new-slice.js` still writes legacy keys, the orchestrator still emits legacy events. `git diff` on any slice file produced during the test run shows no key change.
- Suite green; `COVERAGE.lock` regenerated and committed.

### R2 — writers switch, folders and files move

**Why.** With readers tolerant, the writers can move in one step, and the old-named files can be renamed without anything failing to find them.

**Acceptance criteria.**

- `new-slice.js` writes canonical keys in `from:` and `to:`, and accepts legacy values on its command line by mapping them.
- The orchestrator emits canonical event names only, writes `## Review — Round N` and reads `## Builder Escalation — Slice Broken`. Historic files are untouched; a test checks the round counter over a mixed file.
- `git mv bridge/nog-prompt.js bridge/reviewer-prompt.js`, `bridge/templates/bashir-prompt.md → qa-prompt.md`, `bashir-non-gate-prompt.md → qa-non-gate-prompt.md`; every require and path updated.
- `git mv .claude/roles/<legacy>/ .claude/roles/<key>/` for all nine folders; `.claude/roles/kira/` deleted (retired, empty inbox). Every skill under `.claude/skills/` that names a folder path uses the new key (17 files mention the roster; `check-handoffs`, `handoff-to-teammate`, `estimate-hours`, `idea-capture`, `wrap-up`, `remember`, `compress`, `debrief` are the ones with paths).
- Per-role tracking files renamed on disk (`timesheet-<key>.jsonl`, `tt-audit-<key>.jsonl`, `anchors-<key>.jsonl`; only the watcher's are tracked in git, use `git mv` for those). The rebuild that produces the merged `timesheet.jsonl`, `tt-audit.jsonl` and `anchors.jsonl` globs both old and new filenames, and the `role` field inside old lines is left as written; consumers map it through `canonical()`.
- The `## What Rom does not do` block becomes `## What Sam does not do` in the one canonical copy (`.claude/roles/lead/slice-body-template.md`) and in the copy `new-slice.js` compares against.
- A test creates a slice through `new-slice.js`, runs it through the orchestrator's state machine in a fixture, and finds canonical keys, events and headings throughout.
- Suite green; `COVERAGE.lock` regenerated.

### R3 — the dashboard shows real names and the skin goes

**Why.** The dashboard has 193 sites that use the role map, the `data-role` keys or the LCARS mode, plus a toggle and a stored preference.

**Acceptance criteria.**

- The dashboard's role map is loaded from `bridge/roles.json` (served by the server) or generated from it at build time; the hand-written `ROLE` table with `lore` and `lcarsRole` fields is gone.
- Crew tiles show first name and title; panel owner chips show the title; every `personName`, `ownerChip`, `roleTitle` call resolves from the map. No DS9 name appears in the served HTML (a test greps the rendered page for the ten legacy names and finds none).
- `data-role` attributes use canonical keys. The five `e2e/` specs and the regression tests that select by `data-role` are updated to the canonical keys in the same slice (declared in the brief; selector renames read as reworded).
- The LCARS skin is removed: the toggle at the `lcars-toggle` checkbox, `toggleLcarsMode`, the `lcars-mode` body class and every rule under it, the `ds9-lcars-mode` localStorage key. One look, light and dark following the system preference.
- `dashboard/lcars-dashboard.html` is renamed `dashboard/dashboard.html`; `dashboard/server.js` line 22, `.claude/launch.json`, and every test that names the file follow. Old bookmarks to the served path keep working (the server serves the same route).
- Suite green, browser suite green, `COVERAGE.lock` regenerated.

### R4 — the living prose

**Who.** Worf drafts; Philipp applies the contracts (locked folder) and directs the rest, as on 2026-09-03. Not a Rom slice.

**What changes.** Every living document: the six contracts, the nine role files (titles and text; the folders were moved in R2), `.claude/CLAUDE.md` ("You are Sam, the builder"), `.claude/TEAM-STANDARDS.md` (its roster is stale anyway), `README.md`, the current `docs/*.md` and `docs/runbooks/*.md`, the 17 skill files' prose, the handoff template, `docs/HOW-A-SLICE-TRAVELS.md`.

**What does not change.** Dated records: past handoffs, past slices, the ruling record and past ADRs. Each dated record that a reader is likely to open (the ruling record, the ADRs) gets one line at the top pointing at the map in this document.

**Acceptance.** A grep of the living set for the ten legacy names returns only the map itself, this plan, and quoted history.

---

## 4. Ownership

| Who | Does |
|---|---|
| Philipp | Confirms the key style (nouns). Approves R1–R3 as slices. Applies R4's contract edits. |
| Alex (O'Brien) | Files R1–R3 in the order in section 2, interleaved with the test-ownership slices as stated. Creates `slice-body-template.md` with the `## What Sam does not do` block. |
| Sam (Rom) | Builds R1–R3. |
| Jordan (Nog) | Reviews them; the selector and heading renames are *reworded*, not loosened. |
| Julian (Bashir) | Owns the `e2e/` selector updates in R3 once his stage exists; until then R3 declares them and Rom makes them. |
| Chris (Worf) | This plan, `bridge/roles.json`'s first version as the map, R4, CI if the workflow files name a role (they do not), the launchd label (unchanged). |
| Riley (Ziyal) | Optional: a look at the crew tiles and owner chips after R3, since the skin removal changes the dashboard's face. |

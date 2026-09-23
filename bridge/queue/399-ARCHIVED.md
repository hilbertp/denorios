---
id: "399"
title: "Jordan reviews without running the suites, and writes his verdict in one exact shape"
from: rom
to: nog
status: DONE
slice_id: "399"
branch: "slice/399"
completed: "2026-09-24T00:00:00.000Z"
tokens_in: 24
tokens_out: 12753
elapsed_ms: 143982
estimated_human_hours: 0.6
compaction_occurred: false
tokens_cache_read: 527411
cost_usd: 1.0700555
---

<!-- ds9:sticker v1 -->

# Jordan reviews without running the suites, and writes his verdict in one exact shape — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "399"
title: "Jordan reviews without running the suites, and writes his verdict in one exact shape"
goal: "Jordan's prompt and role file tell him not to run the full safety-net or browser suite and show him the exact verdict file, so reviews get faster and stop losing rounds to a malformed verdict."
from: obrien
to: rom
priority: high
lane: surface
created: "2026-09-23T22:30:09.155Z"
timeout_min: 20
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-23T22:33:23.875Z"
approval_sig: "87d40497c47a38541180883ef676caed7c8ac02e6efea7e83719410d91bdc7e7"
rom_session_id: "f45af0f7-5c77-4c72-9611-f6b581600337"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-24T00:00:00.000Z"
    durationMs: 143982
    tokensIn: 24
    tokensOut: 12753
    costUsd: 1.0700555
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All four ACs met and the intent holds: the demand to confirm regressions is gone, both suites are forbidden by command name on every lane, the verdict file is shown unindented rather than described, and ROLE.md carries the same rule citing ADR-PROOF-LANES Rule 1."
total_durationMs: 143982
total_tokensIn: 24
total_tokensOut: 12753
total_costUsd: 1.070056
round: 1
---

### Jordan reviews without running the suites, and writes his verdict in one exact shape

<!-- Lane: surface. Prompt wording and a role file; no new branch of logic (docs/adr/ADR-PROOF-LANES.md §2). -->

#### What is broken / Goal

Jordan's review got no faster after the proof lanes landed: median 7.0 minutes per review before
(1–6 September, 25 reviews), 8.1 minutes after (11–14 September, 23 reviews). He ran the full
safety-net suite in 25 of 25 reviews before and still in 15 of 23 after, because nothing he is given
tells him not to, and Part 1 of his prompt asks him to confirm "no regressions" himself.
ADR-PROOF-LANES Rule 1 says no agent runs the full suite: GitHub runs it when a slice lands on dev,
Julian's stage runs both suites, the Promote button runs them again. Separately, Jordan's verdict
file is described to him in prose only, and three times in two days he wrote it without the closing
`---`, which the daemon cannot read (the reader is fixed in slice 400; this slice fixes the
instruction).

After this lands: Jordan's prompt and role file tell him not to run the full safety-net suite or the
browser suite, and show him the exact verdict file to write.

#### Why (evidence)

- `bridge/nog-prompt.js:53` — Part 1 reads "Review the code changes per ROLE.md: correctness,
  quality, lint, test coverage, no regressions." It is the only sentence about regressions, and
  nothing in the prompt forbids running `npm test`.
- `.claude/roles/nog/ROLE.md` has no rule against running a suite (no match for npm, suite or
  node --test outside the memory-protocol preamble).
- Jordan's session transcripts (Alex's measurement, 2026-09-24): full suite in 15 of 23 reviews
  since 11 September; median review 8.1 minutes.
- `bridge/nog-prompt.js:98-103` describes the verdict file in prose ("YAML frontmatter with one of
  the following `verdict` values, plus a one-line `summary`") with no example. The closing fence was
  missing on 390 (twice) and 358, and on 388 an ACCEPTED verdict was read as unreadable and cost a
  round (`.claude/roles/worf/inbox/HANDOFF-RULING-AMENDMENT-PROOF-LANES-FROM-DAX.md`, 2026-09-14
  evening; `bridge/queue/388-ARCHIVED.md`, round 2 note).

#### Tasks

1. In `bridge/nog-prompt.js`, Part 1: replace "no regressions" so the sentence ends "…correctness,
   quality, lint, test coverage." and add the sentence: "Regressions are caught by machines, not by
   you: GitHub runs the safety-net suite when the slice lands on dev, Julian's stage runs both
   suites, and the Promote button runs them again."
2. In `bridge/nog-prompt.js`, still inside Part 1 (not a new part; the prompt must keep saying FIVE
   parts), add: "Do not run the full safety-net suite (`npm test`, `node --test regression/`), the
   browser suite (`npx playwright test`), or the lock builders (`build-coverage-map`,
   `build-ac-manifest`). You may run the test files this slice adds or changes, and the linter on the
   changed files."
3. In `bridge/nog-prompt.js`, in the verdict instructions, add a complete example of the verdict
   file as these literal lines:

       ---
       verdict: ACCEPTED
       summary: "One line."
       ---

   and the sentence: "The first line of the file is `---` and the frontmatter ends with a line that
   is exactly `---`. Write nothing before the first `---`."
4. In `.claude/roles/nog/ROLE.md`, add one paragraph headed **What Nog does not run**, directly
   after the test-honesty list under Gate 2, stating the rule from Task 2 and citing
   `docs/adr/ADR-PROOF-LANES.md` Rule 1.

Write a safety-net test only for a criterion that asserts behaviour; otherwise write none, then stop.

#### Traps

1. `regression/authoring-staging/j-lanes.test.js` (around lines 285-310) pins "Your review has FIVE
   parts:", "Perform your review covering all five parts.", "### Part 5: Lane check" and the lane-check
   sentences verbatim. Do not add a sixth part and do not reword Part 5; run that one test file after
   the change.
2. `test/nog-prompt-vocabulary.test.js` checks the verdict vocabulary. Keep the four verdict values
   (ACCEPTED, REJECTED, ESCALATE, OVERSIZED) and their one-line descriptions unchanged.
3. This is wording only. If you find yourself changing what `buildNogPrompt` computes (its
   parameters, its branches, the lane logic), stop and report BLOCKED: that is a core change and the
   slice must be re-filed.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-399-ac-1: The output of buildNogPrompt, for both lanes, tells Jordan not to run the full safety-net suite or the browser suite, names `npm test` and `npx playwright test`, and allows running only the test files the slice adds or changes.
- slice-399-ac-2: The output of buildNogPrompt no longer asks Jordan to confirm "no regressions" himself; it says GitHub, Julian's stage and the Promote button run the suites.
- slice-399-ac-3: The output of buildNogPrompt contains a complete example verdict file whose first line is `---` and whose frontmatter closes with a line that is exactly `---`.
- slice-399-ac-4: `.claude/roles/nog/ROLE.md` carries the same no-suite rule in one paragraph headed "What Nog does not run" and cites ADR-PROOF-LANES Rule 1.

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-399-ac-1: The output of buildNogPrompt, for both lanes, tells Jordan not to run the full safety-net suite or the browser suite, names `npm test` and `npx playwright test`, and allows running only the test files the slice adds or changes.
    AC: slice-399-ac-2: The output of buildNogPrompt no longer asks Jordan to confirm "no regressions" himself; it says GitHub, Julian's stage and the Promote button run the suites.
    AC: slice-399-ac-3: The output of buildNogPrompt contains a complete example verdict file whose first line is `---` and whose frontmatter closes with a line that is exactly `---`.
    AC: slice-399-ac-4: `.claude/roles/nog/ROLE.md` carries the same no-suite rule in one paragraph headed "What Nog does not run" and cites ADR-PROOF-LANES Rule 1.
    Lane: surface

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

**AC Check:**

- slice-399-ac-1 (both lanes forbid the suites by name, allow the slice's own test files) → ✓ Satisfied.
  `bridge/nog-prompt.js:55` sits in the shared body of the returned array, above the `...laneCheck`
  splice at line 87, so surface, core and lane-unset all carry it. It names `npm test`,
  `node --test regression/`, `npx playwright test` and both lock builders, and keeps the permission
  ("You may run the test files this slice adds or changes, and the linter on the changed files").
  Verified by running the guard, which builds the prompt three times, once per lane value.

- slice-399-ac-2 (no longer asks Jordan to confirm "no regressions"; names the machines) → ✓ Satisfied.
  `bridge/nog-prompt.js:53` now ends at "test coverage."; line 54 names GitHub on landing, Julian's
  stage and the Promote button. Removing the *demand* is the half that matters — a prohibition next
  to a standing request to confirm regressions would have been read as the request winning.

- slice-399-ac-3 (complete example verdict file, first line `---`, closes with a line that is
  exactly `---`) → ✓ Satisfied. `bridge/nog-prompt.js:111-114` emit the four lines unindented, and
  line 116 states the rule in words. The unindented choice is correct and load-bearing: indented to
  match the verdict list above it, the example's lines would not *be* `---`, which is the exact
  mistake this slice exists to stop. Rom named that reasoning in his report rather than leaving it
  to be guessed at.

- slice-399-ac-4 (ROLE.md carries the rule in one paragraph headed "What Nog does not run", cites
  ADR-PROOF-LANES Rule 1) → ✓ Satisfied. `.claude/roles/nog/ROLE.md:54` — one paragraph, sitting
  directly after item 5 of the test-honesty list under Gate 2 and before "What Nog never rejects
  for", as Task 4 asked. I read `docs/adr/ADR-PROOF-LANES.md` §2 Rule 1 to confirm the citation is
  not decorative: it says what the paragraph says it says (machines run suites, agents do not;
  GitHub on landing, Julian's stage, the Promote button).

All four `AC:` trailers plus `Lane: surface` are on `33f4aff`. The three `@ac-hash` lines in the new
test file were recomputed against the brief's AC text with `acHashOf` from
`scripts/build-ac-manifest.js` and match byte for byte.

**Intent Verification:** ✓ Achieved.

The goal has two halves and both are met by the mechanism, not by a gesture at it. *Faster:* the
sentence that asked for the work is gone and the prohibition names the literal commands, so there
is nothing left to interpret; it also says who runs the suites instead, which is what stops the
prohibition reading as carelessness and being quietly ignored. *Stops losing rounds:* the file is
now shown, not described, which is the failure mode that cost 388 a whole round on a verdict that
was already ACCEPTED.

One honest limit, stated rather than hidden: this review ran on the **old** prompt — the
orchestrator builds it from `main`'s copy of `nog-prompt.js`, so I cannot demonstrate the effect on
myself. The mechanism is direct enough that this does not weaken the verdict: `buildNogPrompt` is
the only builder of Nog's prompt (the consumers are `bridge/orchestrator.js`, plus the two guards),
so the change takes effect on the first slice reviewed after this lands on dev.

**Scope Discipline:** ✓ Clean. Four files against `dev`, which is the comparison that matters here
— `main...HEAD` shows 201 files only because `main` trails `dev` by the whole sprint, and none of
that drift is Rom's. `bridge/nog-prompt.js` and `.claude/roles/nog/ROLE.md` are the two the brief
names, plus the new guard and the DONE report. One deletion, the replaced Part 1 line. Nothing lost.

`regression/COVERAGE.lock` is deliberately **not** regenerated, and that is correct, not an
omission: the pipeline owns the derived locks (`LOCK_FILES`, `bridge/orchestrator.js:149`;
`regenerateLocksAtLanding` at :9016), and Rom's own template at :2951 forbids him touching them. I
checked the new guard cannot trip the integrity or anti-shrink gates either way — it reaches
`nog-prompt.js` through `require`, not `readFileSync`, so it claims no lock entry.

**Linting:** PASS — `node --check` clean on both changed JS files. The project ships no eslint
config or lint script (`package.json` has `test` only), so syntax is the available gate.

**Safety-net tests / screen hooks:** PASS.

- Tagged: all three tests carry `slice-399-ac-N` in the test name and an `@ac-hash` comment; hashes
  verified above.
- Tests the criterion, not the shape: each asserts on the string `buildNogPrompt` returns, which is
  precisely what the ACs are written about. None of them merely checks that a function exists.
- Nothing pins dead code.
- Count: three tests for four criteria. AC-4 is a document and correctly gets none — it is read in
  the diff, which is what I did. Not an extras problem.
- The ac-3 guard is better than it had to be: it scans for a *line* that is exactly `---` followed
  by a verdict line, a summary line and a closing line that is exactly `---`, and the fixtures are
  kept free of `---` on purpose, so a fence arriving through the embedded slice file could not
  satisfy it by accident. That is the difference between a guard and a substring that looks like one.
- No break-it list, correctly — surface lane.
- Screen hooks: none, correctly. A prompt string and a role file reach no screen.

Traps checked by running the two files they name, rather than taking the report's word:
`regression/authoring-staging/j-lanes.test.js` 11/11 (trap 1 — "FIVE parts", "covering all five
parts" and Part 5's wording are untouched at `nog-prompt.js:32-42, 50, 100`), and
`test/nog-prompt-vocabulary.test.js` green (trap 2 — the four verdict values and their descriptions
are unchanged at :104-107). The new file is 3/3.

**Lane check:** Declared surface, and the diff holds it. The change to `bridge/nog-prompt.js` adds
four string literals to an array literal. `isSurface`, `laneCheck`, the parameter list and every
branch are unchanged — no control flow, no state, no git operation, no gate, no API endpoint or
response. Trap 3 correctly did not fire.

**Flags (not findings):**

1. *For O'Brien.* The ac-2 guard asserts `!prompt.includes('no regressions')` over the **whole**
   prompt, which in production embeds the slice file, the DONE report and the diff. It is safe as
   written because the fixtures are hardcoded, but it is a global-absence assertion, and a future
   edit that swapped those fixtures for real file contents would read a false RED the moment a slice
   quoted the phrase — as slice 399's own brief does. Worth a narrower target if anyone touches it.
2. *For Julian's stage.* Nothing to inherit: no browser test committed, no `e2e/` change, no screen
   hooks. Julian's stage on this slice has no surface to click.

## Rom's DONE report

#### Summary

Jordan's prompt no longer asks him to confirm "no regressions" himself, and now tells him in
so many words not to run the full safety-net suite, the browser suite or the lock builders —
naming `npm test` and `npx playwright test` so there is nothing to interpret. It says who does
run them instead (GitHub on landing, Julian's stage, the Promote button), because a prohibition
without a reason reads as carelessness and gets ignored. The same rule is now a paragraph in
his role file under Gate 2, citing ADR-PROOF-LANES Rule 1.

The verdict file was described in prose only — that is how the closing `---` went missing three
times in two days and cost 388 a whole round on a verdict that was ACCEPTED. The prompt now
shows the entire file, four unindented lines, and states the fence rule in words underneath.

Still FIVE parts. The new sentences live inside Part 1; nothing in `buildNogPrompt`'s
parameters, branches or lane logic moved.

#### What changed

- `bridge/nog-prompt.js` — Part 1's review sentence now ends at "test coverage." Two sentences
  follow it: the machines that catch regressions, and the list of what Jordan does not run
  (`npm test`, `node --test regression/`, `npx playwright test`, `build-coverage-map`,
  `build-ac-manifest`) with the permission he does keep — the test files the slice adds or
  changes, and the linter on the changed files.
- `bridge/nog-prompt.js` — after the four verdict values, a complete example of the verdict
  file, emitted as four unindented lines (`---` / `verdict: ACCEPTED` / `summary: "One line."` /
  `---`), then the sentence about the first line and the closing fence. Unindented on purpose:
  an example indented five spaces to match the verdict list would be an example whose lines are
  not `---`, which is exactly the mistake being fixed.
- `.claude/roles/nog/ROLE.md` — a paragraph headed **What Nog does not run**, sitting directly
  after the five-item test-honesty list under Gate 2 and before "What Nog never rejects for",
  carrying the same rule and citing `docs/adr/ADR-PROOF-LANES.md` Rule 1.
- `regression/authoring-staging/j-reviewer-runs-nothing.test.js` — new, three tests.

#### Screen hooks

None. This slice changes a prompt string and a role file; nothing reaches the dashboard.

#### Safety-net tests

Three, in `regression/authoring-staging/j-reviewer-runs-nothing.test.js`, one per criterion that
asserts a computed value — the string `buildNogPrompt` returns. AC-4 is a document and gets no
test; Jordan reads it in the diff.

Each test runs all three lanes (`surface`, `core`, and lane-unset, which the orchestrator treats
as core), because the saving a surface slice buys is exactly what one full suite run spends, and
a guard pinning one lane would let the other drift back.

- `slice-399-ac-1` — both suites forbidden by name; the permission to run the slice's own test
  files is asserted too, so the fix cannot land as "run nothing".
- `slice-399-ac-2` — the string "no regressions" is absent, and the three machines are each
  named.
- `slice-399-ac-3` — scans the prompt's lines for a line that is exactly `---` followed by a
  verdict line, a summary line, and a closing line that is exactly `---`. The fixtures are free
  of `---` on purpose: a fence arriving through the slice file or the DONE report would satisfy
  a naive substring check while teaching Jordan nothing.

Ran only this file, plus the two files the traps point at. All green:

- `regression/authoring-staging/j-reviewer-runs-nothing.test.js` — 3/3.
- `regression/authoring-staging/j-lanes.test.js` (trap 1) — 11/11; "FIVE parts", "covering all
  five parts" and Part 5's wording are untouched.
- `test/nog-prompt-vocabulary.test.js` (trap 2) — passes; the four verdict values and their
  one-line descriptions are unchanged, and the example's `verdict: ACCEPTED` does not trip the
  legacy-literal checks.

No break-it check: surface lane. Trap 3 did not fire — no parameter, branch or lane-logic change
was needed, so there is nothing to report BLOCKED.

#### Commit

`33f4aff` — S399: Jordan stops running the suites, and gets shown the verdict file
(branch `slice/399`), carrying the four `AC:` trailers and `Lane: surface`.

## Nog's verdict and review

_None recorded._

## Julian's result

_Julian's stage has not recorded a result for this slice yet._

---

## Julian's stage — result

**Browser tests: 1 added, 0 moved, 0 weakened.** Commit `141d285` on `dev`.

### Which criteria have a browser test

| Criterion | Browser test | Why |
|---|---|---|
| slice-399-ac-1 | none | asserts the string `buildNogPrompt` returns |
| slice-399-ac-2 | none | same |
| slice-399-ac-3 | none | same |
| slice-399-ac-4 | `e2e/nog-role-no-suites.spec.js` | the role file is rendered on screen |

The packet declared **Screen hooks: none**, and Nog's review closed with "Julian's stage on
this slice has no surface to click." That is right for ac-1/2/3 and wrong for ac-4.

ac-1, ac-2 and ac-3 assert the value of a string built in-process and handed to a headless
`claude -p` subprocess. Nothing renders it. The only "prompt" the dashboard puts on a screen
is `#gate-failure-prompt`, the copyable text the gate-failure popup hands O'Brien — a
different artifact. There is no click that can reach `buildNogPrompt`'s output, so these
three are safety-net territory and I wrote nothing for them.

ac-4 is different. It is about `.claude/roles/nog/ROLE.md`, and the crew dossier renders
each role's `ROLE.md` straight from disk — `e2e/seed-fixture.js` copies the real `.claude/`
tree into the fixture, so the fixture-backed dossier shows the shipped file. The paragraph
this criterion is about is something a stakeholder can click to and read. It is a screen
criterion, and it now has one browser test.

That matters more than a tidy-up, because ac-4 was also the one criterion with **no
safety-net test**: Rom wrote none ("AC-4 is a document and gets no test; Jordan reads it in
the diff") and Nog accepted that reasoning. Reading it in the diff is not a guard that
survives the review. This browser test is currently ac-4's only machine guard.

### Hooks used, and where they came from

The sticker declared no hooks, so I took them from the rendered page and from my own
existing `e2e/crew-dossier.spec.js`, which already drives this journey:

- `.crew-card[data-role="nog"]` — the crew tile. Selected by `data-role`, never by the
  displayed name: crew names are mode-aware (human names in light mode, DS9 names in LCARS).
- `#crew-menu` → "Inspect role" — the tile menu.
- `#crew-dossier-overlay` — the dossier, default tab is Role.
- `#crew-dossier-title` — asserted `Nog`, so the test cannot pass while reading another
  role's file.
- `#crew-dossier-body` — the rendered `ROLE.md`.

Starting state the hooks need: load `/`, click the Nog tile, choose "Inspect role", wait for
the overlay. The Role tab is the default, so no tab click is needed.

### What the test pins

Scoped to the one paragraph ac-4 names, not to the 17k-character document:

- the heading `What Nog does not run`, appearing **exactly once** ("one paragraph");
- the paragraph does not run on into the next section ("one paragraph", again);
- it forbids both suites and names each by its command — `npm test`,
  `node --test regression/`, `npx playwright test`;
- it keeps the permission that stops the rule reading as "run nothing" — may run the test
  files the slice adds or changes, and the linter;
- it cites `ADR-PROOF-LANES` and `Rule 1`.

Strict on substance, loose on voice. The role file says "He may run…" where the prompt says
"You may run…"; pinning either sentence verbatim would guard the wording rather than the
rule, and would read a false RED on a legitimate rephrasing. The heading and the citation
are pinned exactly, because ac-4 quotes them exactly.

**I did not open `.claude/roles/nog/ROLE.md`.** It is a product artifact this slice changed,
and checking a criterion against it would be checking the answer against the answer sheet.
Every expected string above comes from O'Brien's ac-4 text and the brief's Task 2. The
browser read the file; I did not.

### Is the guard hollow?

Checked, rather than asserted. Negative control: the same paragraph extraction run against
the `rom`, `bashir` and `worf` dossiers returns NULL, and none of the pinned strings appear
anywhere in those documents. So the assertions discriminate — if slice 399's paragraph were
absent from Nog's role file, the test fails at `expect(para).not.toBeNull()` rather than
finding its strings in ambient prose.

Honest limit on the scoping: today all six pinned strings occur exactly once in Nog's whole
role file, and all of them inside the paragraph — so a whole-document assertion would be
just as accurate right now. The paragraph scoping is there because ac-4 says "one paragraph",
and because a 17k document that grows a second mention later would make the loose version
hollow without anyone noticing.

### Break-it check

**Not run** — packet item 8 says the break-it script is the next slice in this set. So no
safety-net test was named hollow, and none was confirmed either: all three of Rom's tests in
`regression/authoring-staging/j-reviewer-runs-nothing.test.js` stand **unconfirmed** at this
stage. I did not run them and did not fix them; they are not mine.

### Suite results

Pending. Both full suites are the stage machinery's single counted run on dev, after the
`tests-updated` event below. I ran only my own new browser-test file while writing it
(four times, including the probe and negative-control runs, all of which I deleted).

**Environment note for the stage:** the Playwright chromium binary was not installed on this
host — the first browser launch failed with "Executable doesn't exist". I ran
`npx playwright install chromium` to provision it. No dependency was added; the suite already
depends on Playwright. If the machinery runs the browser suite somewhere else, that host needs
the same provisioning or the suite fails for an environmental reason and not a product one.

### Every file I read

Test code and configuration (mine):

- `.claude/roles/bashir/ROLE.md` — my anchor.
- `e2e/crew-dossier.spec.js` — in full; the journey this test extends.
- `e2e/seed-fixture.js` — lines 1–90 and 145–200; to learn whether the fixture serves the
  real `.claude/` tree or synthetic role files.
- `playwright.config.js` — in full; baseURL, fixture wiring, workers.
- `e2e/*.spec.js` — grep only (matching lines) for the AC-tagging convention and for any
  existing surface that renders a prompt.

Loaded as modules to call an API, source not read:

- `scripts/build-ac-manifest.js` — `acHashOf`, to compute the `@ac-hash` tag.
- `bridge/state/gate-telemetry.js` — `emit` and `VALID_EVENTS`, to emit the event below.

Product files read: **none**. Not `bridge/nog-prompt.js`, not `.claude/roles/nog/ROLE.md`,
not `dashboard/`. No line of a diff was read.

One precise disclosure: verifying my own commit with `git show --stat HEAD~1` printed Rom's
**diffstat** — the six changed file names with their insertion and deletion counts. That is
packet item 4 plus line counts, and no content. I did not look further, and nothing the test
asserts derives from it.

### Flag for O'Brien (not a red, and not a handoff)

The packet's "Screen hooks" section is written as though only newly-built UI counts. A slice
that changes a **role file** has a screen surface for free, because the crew dossier renders
role files, and this one was declared hookless by the brief, by Rom's report and by Nog's
review in turn. Worth a line in the brief template: a change to `.claude/roles/*/ROLE.md` is
screen-visible in that role's dossier.

### Exit

None. No red declared. One browser test written and green on its own file; the verdict
belongs to the stage machinery's run of both suites.

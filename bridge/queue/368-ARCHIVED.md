---
id: "368"
title: "The merge dialog stops asking for a second person"
from: rom
to: nog
status: DONE
slice_id: "368"
branch: "slice/368"
completed: "2026-09-24T23:05:15.000Z"
tokens_in: 74
tokens_out: 61388
elapsed_ms: 738337
estimated_human_hours: 2.0
compaction_occurred: false
tokens_cache_read: 3410419
cost_usd: 4.5679155
---

<!-- ds9:sticker v1 -->

# The merge dialog stops asking for a second person — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "368"
title: "The merge dialog stops asking for a second person"
goal: "On a RED FLAG the \"Run the gate?\" dialog still stops by default, but unlocks on one confirmation from Philipp that names nobody, and no part of the dialog mentions an author, a reviewer or a second person."
from: obrien
to: rom
priority: normal
lane: core
created: "2026-09-01T20:28:22.735Z"
timeout_min: 25
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-24T22:54:22.016Z"
approval_sig: "1781da94f8cfb0d3f12e5778684479c0469cb59b7bd742e7159744ce7409f81d"
rom_session_id: "b9326f3e-dffa-4307-be5a-f462c4a4613d"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-24T23:05:15.000Z"
    durationMs: 738337
    tokensIn: 74
    tokensOut: 61388
    costUsd: 4.5679155
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All three ACs met and the intent achieved — RED FLAG still opens locked but unlocks on one confirmation naming nobody; five honest tests run the page's own dialog code, all five @ac-hash values recompute correctly, both Test-Loosen-OK trailers are scoped and genuine, and scope is exactly the four expected files plus the DONE report."
total_durationMs: 738337
total_tokensIn: 74
total_tokensOut: 61388
total_costUsd: 4.567915
round: 1
---

### The merge dialog stops asking for a second person
<!-- Lane: core. It rewires the handler that unlocks Run gate on a RED FLAG and moves the assertions of two safety-net tests; it is not only the dialog's wording. -->

#### Goal

Philipp, 2026-09-01 (.claude/roles/obrien/inbox/HANDOFF-MERGE-WARNING-SCREEN-REQUIREMENTS-FROM-BASHIR.md:24 and :41):

> "Never require a second human. Delete the "I am not the author, and I've confirmed…" checkbox and the second-reviewer copy. Philipp is always the only human."
> "Keep the gate stopping by default, …"

After this lands, the "Run the gate?" dialog never mentions an author, a reviewer or a second person, and on a RED FLAG Run gate still stays locked until Philipp ticks one confirmation that names nobody.

#### Context

- On RED FLAG, `_utcApplyVerdict` (dashboard/lcars-dashboard.html:12311) fills `#utc-secondack` with a box headed "A second reviewer (not the author of these changes) must confirm…" and the checkbox "I am not the author, and I’ve confirmed every item above is intentional." (12326-12330). It then disables Run gate with the tooltip "Blocked: a second reviewer must acknowledge the RED-FLAG items first." (12331). `utcToggleSecondAck` (12339-12347) re-enables the button when the box is ticked and disables it again when unticked.
- The verdict comes from the `decision` field of `GET /api/tests-needed` (12378). `clear`, `needs_review`, `overridden` and `red_flag` show as CLEAR, NEEDS REVIEW, OVERRIDDEN and RED FLAG. Anything else, or a failed request, shows as NO VERDICT (`UTC_VERDICTS`, 12301-12307). Today only `red_flag` disables Run gate (12321, 12332-12335). The dialog is rebuilt from scratch on every open (`confirmUpdateTests`, 12349; `closeUpdateTestsOverlay` removes it, 12219-12222).
- Two safety-net tests pin the old box: slice-99812-ac-2 (regression/direct-controls/j-direct-controls-regression-coverage.test.js:298-317, asserts at 315-316) and slice-367-ac-4 (regression/gate-merge/j-merge-dialog-one-classification.test.js:243). Both manifest entries have `text: null` (regression/AC-MANIFEST.lock:2661 and :1005), so no criterion text changes.
- The squash to dev carries `Test-Loosen-OK` over from Sam's commits but drops `AC-Change-OK` and `Spec-Owner` (bridge/orchestrator.js:9428-9451). If an AC-Change-OK turns out to be needed, only Philipp can add it, at landing.
- A `Test-Loosen-OK` whose target is a file path covers every weakened check in that file (lib/tests-needed.js:113-117), and a check in that file that is removed rather than weakened turns the verdict RED FLAG (mismatched transition, 118).
- dashboard/test-drift.html already has no second-reviewer copy; regression/gate-merge/j-test-drift.test.js:117 forbids adding any.
- Five browser specs find Run gate by `#utc-approve-btn` and expect it enabled on CLEAR (for example e2e/gate-button.spec.js:54). Keep that id.
- The server reads lcars-dashboard.html from disk on every request (dashboard/server.js:3278): reload the dashboard tab after landing; no daemon or dashboard restart is needed.

#### Out of scope

- Not planned: the server checking the confirmation when Run gate dispatches. That is ADR-JULIAN-ALONGSIDE slice E, item 19.
- Not planned: the second-reviewer wording in docs/contracts/test-update-gate-trailers.md, .claude/roles/nog/ROLE.md and docs/adr/ADR-TEST-UPDATE-GATE.md. Philipp applies those in his merged contract patch.
- Not planned: dashboard/test-drift.html, which already has no second-reviewer copy (see Context).
- Proposed follow-up: Julian rewords "second-ack" in regression/COVERAGE.md:36 and in the comment at e2e/gate-button.spec.js:41. Both files are his.
- Proposed follow-up: reword the comment at dashboard/server.js:1011 ("the second-ack must enumerate") in the next slice that touches the server.
- Proposed follow-up: decide whether NO VERDICT should stop by default like RED FLAG. Today it enables Run gate, and trap 2 keeps that.
- Proposed follow-up: keep Run gate disabled while the verdict is still loading. Today it is enabled during "Checking…" (12365).

#### Tasks

1. In dashboard/lcars-dashboard.html, `_utcApplyVerdict` (12311), change the RED FLAG branch (12321-12331). Keep the box and its item list (12322-12325). Set:
   - the box's aria-label (12326) to "Confirm the RED FLAG items"
   - its heading (12327) to "Confirm each item below is the intended result of a feature — not a check disabled to go green:"
   - its checkbox label (12329) to "I have confirmed every item above is intentional."
   - the tooltip on the disabled button (12331) to "Blocked: confirm the RED FLAG items first."
2. Rename `utcToggleSecondAck` (12338-12347) to `utcToggleConfirm`, using the tooltip from task 1 at 12346. Point the checkbox's `onchange` (12329) at the new name. Rename the slot id `utc-secondack` (12313, 12361) to `utc-confirm`. Keep `#utc-ack-box` and `#utc-approve-btn` as they are.
3. Reword the comments at 12299-12300, 12309-12310, 12338 and 12376-12377, and the CSS comment at 3971, so that none of them speaks of a second or non-author reviewer. Leave the CSS rules at 3977-3982 unchanged.
4. Move the two pinned tests to the new behaviour, keeping them at least as strict:
   - In regression/direct-controls/j-direct-controls-regression-coverage.test.js: the comment at 281-284, the test title at 298 (keep the tag slice-99812-ac-2), the comment at 309 and the asserts at 315-316.
   - In regression/gate-merge/j-merge-dialog-one-classification.test.js: the assert at 243 (keep the tag slice-367-ac-4).

   Both tests also look for `approve.disabled = true` inside `_utcApplyVerdict` (314, 242). Either keep that line in the function or move those asserts as well. Change nothing else in either file: the two file-path trailers would also clear any other weakened check there. List both moved tests under ## Tests moved or weakened, and add the two `Test-Loosen-OK` lines from the REQUIRED block to your commit.
5. Put the new safety-net tests in regression/gate-merge/j-merge-dialog-one-human.test.js.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### Traps

1. On RED FLAG, the box currently lists every item in the verdict's `blockers`, each with its kind and name, above the checkbox (12322-12325). Rewriting the box could drop that list. The checkbox would then confirm "every item above" with nothing above it.
2. When the verdict cannot be read (the request fails, returns an error, or returns a decision the dialog does not know), the dialog shows NO VERDICT. Today Run gate is then enabled and no checkbox appears (12332-12335, 12378). Changing the RED FLAG branch must not change this path.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-368-ac-1: When nothing the server sends for the dialog (check names, plain sentences, file paths, flagged items) contains "author", "reviewer" or "second", the "Run the gate?" dialog's visible text, title attributes and aria-label attributes contain none of those three words (any letter case), whichever verdict it shows (CLEAR, NEEDS REVIEW, OVERRIDDEN, RED FLAG or NO VERDICT), and on RED FLAG both before and after the checkbox is ticked.
- slice-368-ac-2: On a RED FLAG verdict, every time the dialog opens, once the RED FLAG chip shows the dialog has exactly one checkbox, unticked, whose label reads exactly "I have confirmed every item above is intentional.", and Run gate is disabled (disabled, aria-disabled="true"); ticking the checkbox enables Run gate (not disabled, no aria-disabled attribute) and unticking it disables Run gate again; the same holds when the verdict's item list is empty or missing.
- slice-368-ac-3: On a CLEAR, NEEDS REVIEW or OVERRIDDEN verdict, as soon as the verdict chip shows, the dialog has no checkbox and no confirmation box, and Run gate is enabled (not disabled, no aria-disabled attribute).

#### Screen hooks

- slice-368-ac-1: dialog = `#update-tests-overlay` (its card carries role="dialog" and the aria-label), opened by the RUN GATE & MERGE TO MAIN button `#promote-gate-btn` (locked until CHECK FOR TEST UPDATES passes); verdict chip = `#utc-verdict .utc-verdict-chip`, driven by the `decision` field of `GET /api/tests-needed`. Starting state: no dialog on the page.
- slice-368-ac-2: confirmation box = `#utc-confirm .utc-ack`; checkbox = `#utc-ack-box`, absent until a RED FLAG verdict renders; label = `#utc-confirm label.utc-ack-check` (text trimmed); Run gate = `#utc-approve-btn`, enabled while the verdict is still loading.
- slice-368-ac-3: Run gate = `#utc-approve-btn`; no checkbox = no `input[type=checkbox]` inside `#update-tests-overlay`; no confirmation box = `#utc-confirm` is empty.

#### Files expected to change

- dashboard/lcars-dashboard.html (modified)
- regression/direct-controls/j-direct-controls-regression-coverage.test.js (modified)
- regression/gate-merge/j-merge-dialog-one-classification.test.js (modified)
- regression/gate-merge/j-merge-dialog-one-human.test.js (added)

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-368-ac-1: When nothing the server sends for the dialog (check names, plain sentences, file paths, flagged items) contains "author", "reviewer" or "second", the "Run the gate?" dialog's visible text, title attributes and aria-label attributes contain none of those three words (any letter case), whichever verdict it shows (CLEAR, NEEDS REVIEW, OVERRIDDEN, RED FLAG or NO VERDICT), and on RED FLAG both before and after the checkbox is ticked.
    AC: slice-368-ac-2: On a RED FLAG verdict, every time the dialog opens, once the RED FLAG chip shows the dialog has exactly one checkbox, unticked, whose label reads exactly "I have confirmed every item above is intentional.", and Run gate is disabled (disabled, aria-disabled="true"); ticking the checkbox enables Run gate (not disabled, no aria-disabled attribute) and unticking it disables Run gate again; the same holds when the verdict's item list is empty or missing.
    AC: slice-368-ac-3: On a CLEAR, NEEDS REVIEW or OVERRIDDEN verdict, as soon as the verdict chip shows, the dialog has no checkbox and no confirmation box, and Run gate is enabled (not disabled, no aria-disabled attribute).
    Test-Loosen-OK: regression/direct-controls/j-direct-controls-regression-coverage.test.js strict→weak Philipp's 09-01 ruling: never require a second human
    Test-Loosen-OK: regression/gate-merge/j-merge-dialog-one-classification.test.js strict→weak Philipp's 09-01 ruling: never require a second human

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

##### Gate 1 — Acceptance Criteria

- **slice-368-ac-1** — no "author" / "reviewer" / "second" in the dialog's visible text, titles or aria-labels, under any verdict, before and after the tick → **✓ Satisfied**
  Verified independently of the test. The four places the words used to live are all gone in `dashboard/lcars-dashboard.html`: the box aria-label (12326, was `"second reviewer acknowledgement"`), the heading (12327, was `"A second reviewer (not the author of these changes)…"`), the checkbox label (12329, was `"I am not the author, and I've confirmed…"`) and the disabled-button tooltip (12331 + 12346, was `"Blocked: a second reviewer must acknowledge…"`). I grepped the dialog's whole render path — the card markup in `confirmUpdateTests` (12356-12368), `_renderTestChanges` (12235-12284) and every `UTC_VERDICTS` label and blurb (12301-12307) — and none of the three words appears in any of them, in any case.
  The one thing I checked hardest: `dashboard/lcars-dashboard.html` does still contain "author" at 5884/5898/11653-11686 (`utc-btn-author`, `utc-authoring-by`) and at 12180-12201 (`authoring-result-toast`). Those belong to `_renderTestUpdatesBody` → **`#test-updates-overlay`**, the CHECK FOR TEST UPDATES dialog — a different overlay from `#update-tests-overlay`. AC-1 scopes to the "Run the gate?" dialog, so they are out of its reach. Correct as shipped.

- **slice-368-ac-2** — RED FLAG opens with exactly one unticked checkbox reading exactly the new sentence, Run gate `disabled` + `aria-disabled="true"`; tick unlocks, untick re-locks; same with an empty or missing item list → **✓ Satisfied**
  `_utcApplyVerdict` (12318-12332) renders one checkbox and sets `disabled` + `aria-disabled` on render; `utcToggleConfirm` (12339-12348) flips both and removes the attribute (not `"false"`) on tick. The dialog is rebuilt from scratch on every open, so "every time the dialog opens" holds by construction. The empty/missing list case falls out of the untouched `items.length ? list : ''` ternary.

- **slice-368-ac-3** — CLEAR / NEEDS REVIEW / OVERRIDDEN carry no checkbox, no confirmation box, Run gate enabled → **✓ Satisfied**
  The `else` branch (12333-12335) clears `#utc-confirm` and frees the button unconditionally, so blockers present in a non-RED payload cannot grow a box. The test pins exactly that by handing blockers to all three non-RED verdicts.

**Screen hooks:** PASS. All nine hooks in the report exist in the shipped page, each with a starting state: `#update-tests-overlay`, `#promote-gate-btn` (10 occurrences), `#utc-verdict .utc-verdict-chip`, `#utc-confirm` (exactly one `id="utc-confirm"` — no collision), `#utc-confirm .utc-ack`, `#utc-confirm .utc-ack-list li`, `#utc-ack-box`, `#utc-confirm label.utc-ack-check`, `#utc-approve-btn`. The two ids the five browser specs select by (`#utc-approve-btn`, `#utc-ack-box`) are unchanged — confirmed against `gate-button`, `gate-failure-journey`, `gate-success-journey`, `pipeline-lifecycle` and `dispatch-errors`. No reference to `utc-secondack` or `utcToggleSecondAck` survives anywhere in the repo.

**Report shape:** PASS. All seven required headings present, plus `## Conflicts with the brief`.

##### Gate 1.5 — Test-Update trailers

Two `Test-Loosen-OK:` trailers, both verbatim from the brief's REQUIRED block, both present in the commit.

1. **Scope** — both name a real file path that exists. Scoped, not a bare "trust me". ✓
2. **Transition** — declared `strict→weak`. What actually happened is closer to a reword: `utcToggleSecondAck` → `utcToggleConfirm` is a rename at equal strength, and `'I am not the author'` → `'I have confirmed every item above is intentional.'` swaps a 17-character substring for a 48-character exact sentence — strictly more specific. Rom declared the *weaker* transition than reality. That is the safe direction (it invites more scrutiny, not less), and it is the wording the brief mandated verbatim. Not a mislabel. ✓
3. **Reason** — "Philipp's 09-01 ruling: never require a second human". A dated human spec change, not "the test was failing". ✓

Both moved tests are listed under `## Tests moved or weakened` with the before/after assertion and the why. `approve.disabled = true` stayed in `_utcApplyVerdict`, so the sibling asserts at :314 and :242 that pin "the gate still stops by default" were left in place rather than moved — the stricter of the two options the brief offered.

I verified Rom's `AC-Change-OK`-not-needed claim rather than taking it: `regression/AC-MANIFEST.lock:2663` and `:1007` both carry `"text": null` for `slice-99812-ac-2` and `slice-367-ac-4`. No criterion text changed. ✓

##### Gate 2 — Implementation Quality

**Linting:** N/A — this repo has no ESLint config (`npx eslint` fails with "couldn't find an eslint.config.*") and `package.json` declares no lint script. Substituted `node --check` on all three changed JS files: clean. Not a finding; there is nothing to run.

**Safety-net tests:** PASS.
- **Count** — 5 tests for 3 ACs + 2 traps. Exactly the target, no extras.
- **AC tags** — every test title carries its `slice-368-ac-N` tag; both trap tests carry the tag of the criterion they defend.
- **@ac-hash** — I recomputed all five annotations with the repo's own normalizer (`scripts/build-ac-manifest.js:52-57`) against the `AC:` trailers parsed by `lib/ac-range-scan.js`'s regex. **All five match.** No drift between what the tests claim to guard and what the commit declares.
- **Tests the criterion, not the code's shape** — this is the strongest part of the slice. The tests do not read the page as text; they brace-extract `confirmUpdateTests`, `_utcApplyVerdict`, `_renderTestChanges`, `UTC_VERDICTS` and the toggle out of the shipped HTML, run them in a document shim, and assert on the assembled dialog. The toggle is discovered from the `onchange` the page actually writes (`j-merge-dialog-one-human.test.js:113`), not from a name the test assumed — so renaming the handler cannot fake a pass. If the extraction ever breaks, it throws rather than passing.
- **Nothing pins dead code** — checked. The forbidden-word scan is non-vacuous: the pre-image really did contain all three words in four places, so the regex had something to catch.
- **Red when the fix is removed** — PASS, and handled honestly. Rom reports the full revert turned all 5 red on one shared structural line (`the dialog must carry the #utc-confirm slot`), says so plainly rather than resting on "5/5 red", and adds four single-change probes (A: old wording; B: RED no longer disables; C: blocker list dropped; D: unreadable verdict treated as RED) showing each test goes red on its own substance and only its own. That is the right shape for this check.

**Runs:** `node --test regression/gate-merge/j-merge-dialog-one-human.test.js` → 5 pass, 0 fail. The two modified files → 20 pass, 0 fail. I did not run the full suite, the browser suite or the lock builders.

**Code quality:** no findings. The RED branch is a straight-line rewrite of four strings plus a rename; nesting, naming and the template-literal idiom match the surrounding page. The CSS rules at 3977-3982 are untouched as the brief required — only the comment at 3971 changed.

##### Part 3 — Intent

Achieved, and not by checkbox-ticking. The goal was not a wording change: the old control asked Philipp to assert he was a person who does not exist, so the only way to clear a RED FLAG was to lie. The shipped control asks him to assert something he can actually make true — that he has read the items and they are intentional — while the gate still opens locked. The stop survived; only the lie was removed. `approve.disabled = true` on render, one checkbox, one unlock.

##### Part 4 — Scope

Clean. Rom's commit (`HEAD~1..HEAD`) touches exactly the four files the brief expected plus the mandated DONE report. Nothing else.

One thing worth recording, because the raw `main...branch` diff looks alarming: that diff also shows `regression/AC-MANIFEST.lock` and `regression/COVERAGE.lock` with ~5,269 changed lines. **That is not Rom's work.** The branch was cut from the dev tip `68a731a`, and `git merge-base --is-ancestor HEAD~1 origin/dev` confirms it; the lock churn is pre-existing dev drift sitting between `main` and `dev`. Rom's own commit touches no lock file, exactly as the brief instructed.

No file lost content unrelated to the task; the two test-file edits are the directed moves and nothing more.

##### Part 5 — Lane check

Core lane, satisfied. One safety-net test per acceptance criterion plus one per trap (5 for 3+2), the break-it list is under `## Safety-net tests` with a per-probe breakdown, and all seven contract headings are present. No `e2e/` file touched.

##### Flags (not findings)

1. **For Julian** — all five tests share one structural precondition (the `#utc-confirm` slot must exist). Any future change to that slot id turns the whole file red at once rather than pointing at the behaviour that broke. Rom disclosed this himself and compensated with the probe matrix; worth knowing when you read a failure from this file.
2. **For O'Brien** — on a RED FLAG whose `blockers` list is empty or missing, the box still reads "Confirm each item below…" and "…every item above is intentional." with no items rendered between them. This is pre-existing (the `items.length ? list : ''` ternary is untouched) and AC-2 deliberately pins the lock/unlock behaviour for that case, so it is correct as specified — but the copy addresses a list that is not there. A candidate for the same follow-up that reworders the rest.
3. **Not findings, already scoped out by the brief** — four "second-ack"/"non-author" mentions survive outside the dialog: `dashboard/server.js:1011` (comment), `regression/COVERAGE.md:36` and `e2e/gate-button.spec.js:41` (both Julian's), and `regression/gate-merge/j-test-drift.test.js:117` — that last one is an assertion *forbidding* the copy on `test-drift.html` and is correct as it stands.
4. **Pre-existing, untouched** — `ackSlot` is dereferenced without a null guard in the RED branch (12326) while the `else` branch guards it (12334). Not introduced by this slice and outside what the brief authorised Rom to change.
5. **Deployment** — the server reads `lcars-dashboard.html` from disk per request, so the tab needs a reload after landing; no restart required.

## Rom's DONE report

#### Summary

The "Run the gate?" dialog no longer asks for a person who does not exist. On a RED FLAG
it still STOPS by default — Run gate opens disabled — but it unlocks on one confirmation
that names nobody: "I have confirmed every item above is intentional." Nothing the dialog
shows, titles or announces says "author", "reviewer" or "second" under any verdict, before
or after the box is ticked.

Behaviour deliberately unchanged: the blocker list above the checkbox, the CLEAR /
NEEDS REVIEW / OVERRIDDEN paths (no box, Run gate free), and the NO VERDICT path (Run gate
enabled, no box). `#utc-approve-btn` and `#utc-ack-box` keep their ids, so the five browser
specs that select by them are untouched.

#### What changed

- **dashboard/lcars-dashboard.html** (modified) — the only product change.
  - `_utcApplyVerdict` RED FLAG branch: box aria-label → "Confirm the RED FLAG items";
    heading → "Confirm each item below is the intended result of a feature — not a check
    disabled to go green:"; checkbox label → "I have confirmed every item above is
    intentional."; disabled-button tooltip → "Blocked: confirm the RED FLAG items first."
    The `items`/`list` block above the checkbox is untouched.
  - `utcToggleSecondAck` → `utcToggleConfirm` (checkbox `onchange` repointed), same tooltip.
  - Slot id `utc-secondack` → `utc-confirm`, at both the lookup and the card markup.
    `#utc-ack-box` and `#utc-approve-btn` unchanged.
  - Comments reworded so none speaks of a second or non-author reviewer: the CSS comment
    above `.utc-verdict`, the `UTC_VERDICTS` header, the `_utcApplyVerdict` header, the
    toggle's one-liner, and the `/api/tests-needed` fetch comment. The CSS rules
    `.utc-ack*` are unchanged.
- **regression/gate-merge/j-merge-dialog-one-human.test.js** (added) — the five new
  safety-net tests.
- **regression/direct-controls/j-direct-controls-regression-coverage.test.js** (modified) —
  slice-99812-ac-2 moved to the new behaviour (see Tests moved or weakened).
- **regression/gate-merge/j-merge-dialog-one-classification.test.js** (modified) —
  slice-367-ac-4's one assert moved (see Tests moved or weakened).

No `e2e/` file touched. No lock file touched (`build-coverage-map` / `build-ac-manifest`
not run, per the brief).

#### Acceptance criteria verification

Command for all three (the only command run against the new file):

    node --test regression/gate-merge/j-merge-dialog-one-human.test.js

| Criterion | Test | Result |
|---|---|---|
| slice-368-ac-1 | `J-merge-dialog-one-human slice-368-ac-1 — no verdict of the dialog says "author", "reviewer" or "second", before or after the box is ticked` | pass |
| slice-368-ac-2 | `J-merge-dialog-one-human slice-368-ac-2 — RED FLAG opens locked behind one unticked box; ticking unlocks Run gate, unticking locks it again` | pass |
| slice-368-ac-3 | `J-merge-dialog-one-human slice-368-ac-3 — CLEAR, NEEDS REVIEW and OVERRIDDEN carry no checkbox and leave Run gate free` | pass |

5 tests, 5 pass, 0 fail.

The two files I moved tests in also run clean —
`node --test regression/direct-controls/j-direct-controls-regression-coverage.test.js regression/gate-merge/j-merge-dialog-one-classification.test.js` → 20 tests, 20 pass, 0 fail.
I did not run the full safety-net suite or the browser suite.

**How the criteria are checked.** The tests do not read the page as text. They lift the
page's own `confirmUpdateTests()`, `_utcApplyVerdict()`, `_renderTestChanges()`,
`UTC_VERDICTS` and the confirmation toggle out of the shipped `lcars-dashboard.html` into a
minimal document shim, feed them payloads shaped like `/api/test-changes` and
`/api/tests-needed`, and then read the assembled dialog: its visible text, its `title` and
`aria-label` attributes, the live Run-gate tooltip, the checkbox, and the label. The toggle
is found from the `onchange` the page actually writes, not from a name the test assumed.

- **ac-1** opens the dialog for all five verdicts (clear, needs_review, overridden,
  red_flag, and an unknown decision), each fed a payload the test first asserts is itself
  clean of the three words, and checks every string the dialog shows or announces. Then
  RED again, re-read after ticking and after unticking — the toggle's tooltip is the one
  string the operator sees only from the toggle, and it is where "a second reviewer must
  acknowledge…" used to live.
- **ac-2** runs RED FLAG three ways — with blockers, with `blockers: []`, and with no
  `blockers` key at all — asserting exactly one checkbox, shipped without a `checked`
  attribute and reading back unticked, the label exactly equal to the sentence, and
  `disabled` + `aria-disabled="true"` on Run gate; then tick (enabled, no `aria-disabled`)
  and untick (locked again). "Every time the dialog opens" is checked by opening a second
  dialog after ticking the first: it opens unticked and locked.
- **ac-3** runs clear / needs_review / overridden **with blockers in the payload**, so a
  non-RED verdict cannot grow a box from them: no checkbox anywhere in the dialog,
  `#utc-confirm` empty, Run gate enabled with no `aria-disabled`.

#### Safety-net tests

Five tests, one per criterion plus one per trap, in
`regression/gate-merge/j-merge-dialog-one-human.test.js`. Each carries its criterion tag
and the `// @ac-hash:` line from the brief.

**Break-it, full revert (the required check).** With `dashboard/lcars-dashboard.html`
restored to HEAD and the new test file left in place: **5 tests, 0 pass, 5 fail** — all
five went red. They all failed on the same structural line ("the dialog must carry the
`#utc-confirm` slot"), which proves they go red but not *what* each one pins. So I ran four
further probes, each undoing exactly one thing while keeping the rest of the fix:

| Probe (one thing undone) | ac-1 | ac-2 | ac-3 | trap 1 | trap 2 |
|---|---|---|---|---|---|
| A — old wording back (slot id + toggle name kept) | **RED** | **RED** | green | green | green |
| B — RED no longer disables Run gate | green | **RED** | green | green | green |
| C — the blocker list dropped from the box | green | green | green | **RED** | green |
| D — an unreadable verdict treated like RED | green | green | green | green | **RED** |

Every test goes red on its own substance and only on its own. The fix was restored after
each probe and the file re-runs 5/5 green.

**Traps.**
- *Trap 1 — the item list could be dropped when the box is rewritten.*
  `slice-368-ac-2 trap-items-above-the-box` asserts the `<ul class="utc-ack-list">` still
  renders one `<li>` per blocker, each carrying its kind and its name, and that the list
  sits **before** the checkbox in the slot's markup — "every item above" must have items
  above it. Probe C (removing `+ list` from the box) turns it red.
- *Trap 2 — the NO VERDICT path must not be dragged along by the RED branch.*
  `slice-368-ac-3 trap-no-verdict-untouched` runs all three ways the verdict can be
  unreadable (the request rejects, the payload is `{available:false, error}`, the decision
  is one the dialog does not know) and asserts the chip reads NO VERDICT, no checkbox
  appears, `#utc-confirm` stays empty, and Run gate stays enabled with no `aria-disabled`.
  Probe D turns it red.

**Browser.** I did not open a browser. The live dashboard reads `lcars-dashboard.html` from
the main checkout, not from this worktree, so it would have shown the old dialog; standing
up a second server against the worktree would have pointed a live process at `bridge/`,
which is not worth it for a look. Instead I rendered the RED FLAG dialog through the same
shim and read the markup it produces:

    <div class="utc-ack" role="group" aria-label="Confirm the RED FLAG items">
      <div class="utc-ack-head">Confirm each item below is the intended result of a
        feature — not a check disabled to go green:</div>
      <ul class="utc-ack-list">
        <li><strong>removed</strong> the gate refuses a dirty tree</li>
        <li><strong>weakened</strong> promote pins the head sha</li>
      </ul>
      <label class="utc-ack-check">
        <input type="checkbox" id="utc-ack-box" onchange="utcToggleConfirm()">
        I have confirmed every item above is intentional.</label>
    </div>

with the Run-gate tooltip reading `"Blocked: confirm the RED FLAG items first."` and the
chip reading `✗ RED FLAG @ ab12cd3`. Julian owns the real browser check.

#### Screen hooks

I used the names the brief pre-named. All exist in the shipped page:

| Hook | What it is | Starting state |
|---|---|---|
| `#update-tests-overlay` | the dialog; its card carries `role="dialog"` and the aria-label "Step 1 — review test changes before running the gate" | not on the page until `#promote-gate-btn` is pressed |
| `#promote-gate-btn` | RUN GATE & MERGE TO MAIN, opens the dialog | locked until CHECK FOR TEST UPDATES passes |
| `#utc-verdict .utc-verdict-chip` | the verdict chip; text is `✓ CLEAR`, `● NEEDS REVIEW`, `◑ OVERRIDDEN`, `✗ RED FLAG` or `? NO VERDICT` | shows "Checking…" until `/api/tests-needed` answers |
| `#utc-confirm` | the confirmation slot (renamed from `utc-secondack`) | present and **empty** on every verdict except RED FLAG |
| `#utc-confirm .utc-ack` | the confirmation box | visible only once a RED FLAG verdict renders |
| `#utc-confirm .utc-ack-list li` | one row per blocker, `<strong>` kind then name | visible on RED FLAG when the verdict names blockers; absent when the list is empty or missing |
| `#utc-ack-box` | the one checkbox | absent until a RED FLAG verdict renders; then present and **unticked** |
| `#utc-confirm label.utc-ack-check` | its label; trimmed text is exactly `I have confirmed every item above is intentional.` | with the checkbox |
| `#utc-approve-btn` | Run gate — **id unchanged** | enabled while the verdict is loading and on CLEAR / NEEDS REVIEW / OVERRIDDEN / NO VERDICT; `disabled` + `aria-disabled="true"` on RED FLAG until the box is ticked |

Note for Julian: on RED FLAG the disabled Run gate carries
`title="Blocked: confirm the RED FLAG items first."`; ticking clears the title and removes
`aria-disabled` entirely (it is not set to `"false"`).

#### Tests moved or weakened

Both are moves the brief directed, both kept at the same strength (same number of asserts,
same kind of assert — a name and a shipped sentence), and both `Test-Loosen-OK` lines from
the brief's REQUIRED block are in the commit as file-path trailers.

1. `regression/direct-controls/j-direct-controls-regression-coverage.test.js` —
   **slice-99812-ac-2** (tag kept). The two asserts at 315-316 moved from the retired
   control to the new one: `/function utcToggleSecondAck\(\)/` → `/function
   utcToggleConfirm\(\)/`, and `html.includes('I am not the author')` →
   `html.includes('I have confirmed every item above is intentional.')` — a longer,
   more specific string than the one it replaces. The test title and the comments at
   281-284 and 309 were reworded to match; the `approve.disabled = true` assert at 314 and
   everything else in the test are untouched. *Why:* the strings it pinned no longer exist —
   Philipp's 09-01 ruling retired them.
2. `regression/gate-merge/j-merge-dialog-one-classification.test.js` —
   **slice-367-ac-4** (tag kept). One assert at 243:
   `/function utcToggleSecondAck\(\)/` → `/function utcToggleConfirm\(\)/`. Its sibling
   assert `approve.disabled = true` (242) is untouched, so "the gate still stops by
   default" is still pinned. Nothing else in the file changed. *Why:* same rename.

Neither manifest entry carries criterion text (`AC-MANIFEST.lock` has `text: null` for
both), so no acceptance criterion text changed and no `AC-Change-OK` is needed. If landing
shows one is needed after all, only Philipp can add it.

#### Commit

Branch `slice/368`, one commit on top of `68a731a`.

    S368: The merge dialog stops asking for a second person

Trailers: the three `AC:` lines and the two `Test-Loosen-OK:` lines from the brief's
REQUIRED block, verbatim.

Files in the commit:

    dashboard/lcars-dashboard.html
    regression/direct-controls/j-direct-controls-regression-coverage.test.js
    regression/gate-merge/j-merge-dialog-one-classification.test.js
    regression/gate-merge/j-merge-dialog-one-human.test.js
    bridge/queue/368-DONE.md   (git add -f)

#### Conflicts with the brief

None. (My role file's closing note says to regenerate `regression/*.lock` before
committing "until slices 386 and 387 are live, *your brief says when that applies*" — this
brief says explicitly not to run `build-coverage-map` or `build-ac-manifest` and not to
edit the lock files, so I did not.)

## Nog's verdict and review

_None recorded._

## Julian's result

_Julian's stage has not recorded a result for this slice yet._

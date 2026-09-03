# Contract patches: who writes which tests, and Julian's stage

**From:** Worf (DevOps)
**To:** Philipp (the only person who edits `docs/contracts/`)
**Date:** 2026-09-03
**Status:** DRAFT. Waiting for Philipp to apply.

## What this is

This is the one contract deliverable: a single quote-and-replace patch document. It is not a set of full replacement files and it is not a diff. Six patches, one per contract file. Each patch quotes the current text and gives the replacement. The wording matches each file's own style and numbering. Nothing else in the files changes.

The decisions behind these patches were made by Worf and confirmed by Philipp today. In short:

- **Rom** writes the safety-net tests for his own change. One per acceptance criterion, plus one for each trap in the brief, then stop. He runs the break-it check on his own tests and reports which ones went red. He never writes or commits a browser test.
- **Nog** writes no tests. This is a deliberate choice, not a gap. He stays the one signature that comes from a non-author, which is why he is the second signature on any moved or weakened test.
- **Julian (Bashir)** writes the browser tests after the slice lands on dev. This is a visible stage, one slice at a time. He gets a fixed packet of information, never the line-by-line code changes and never the product source.
- **Screen hooks:** for every criterion that touches the screen, the stable names of the things a browser test will click or read are written down, each with its starting state.
- The merge happens only after Julian's stage is green. Model A stays parked. Dax does not need to draft any of this; her inbox already has a note saying the test-ownership half is settled.

Words used throughout: *safety-net tests* = the `regression/` suite (`node --test`). *Browser tests* = the `e2e/` suite (Playwright). *Julian's stage* = the new step between "on dev" and "merged"; its state name is `IN_QA`. *Screen hooks* = stable element names. *Break-it check* = undo the fix in a scratch copy and confirm the new tests go red. *Hollow test* = a test that stays green with the fix undone. *Promote button* = the Ops button that runs `promote.yml` on GitHub and moves main forward to match dev.

---

## Patch 1 of 6: `docs/contracts/slice-lifecycle.md` (the source of truth; do this one first)

### 1a. Actors table

**Current (lines 21-22):**

```
| Rom         | Implementor. Moves the ticket from IN_PROGRESS to DONE. On rejection, reads Nog's appendment and reworks his implementation. |
| Nog         | Code reviewer. **Append-only.** Writes his verdict and findings below existing content and hands the ticket back — to Rom (if cycles ≤ 5) or to O'Brien (escalation). Never edits what Rom or O'Brien wrote. |
```

**Replace with:**

```
| Rom         | Implementor. Moves the ticket from IN_PROGRESS to DONE. On rejection, reads Nog's appendment and reworks his implementation. Writes the safety-net tests for his own change: one per acceptance criterion plus one per trap in the brief, then stops. Runs the break-it check on his own new tests and reports which went red. Moves his own safety-net tests when his change requires it and lists every move in his report. Never writes or commits a browser test (a `*.spec.js` under `e2e/`). May open a browser to check his own work and says what he saw in his report. |
| Nog         | Code reviewer. **Append-only.** Writes his verdict and findings below existing content and hands the ticket back — to Rom (if cycles ≤ 5) or to O'Brien (escalation). Never edits what Rom or O'Brien wrote. **Writes no code and no tests. This is a deliberate choice, not an omission:** he reads the code before he judges it, so tests he wrote would share Rom's blind spots, and he must stay the one signature that comes from a non-author. The second signature on a moved or weakened test comes from whoever is not doing the moving; Nog authors nothing, so that is always Nog. |
| Julian (Bashir) | QA. Writes the browser tests for a slice after it lands on dev, one slice at a time, as a visible stage (IN_QA). Moves browser tests only; never edits a safety-net test. Receives information, never code. His packet is exactly: (1) the whole slice file: O'Brien's brief with goal, tasks, traps, and the tagged criteria as O'Brien wrote them; (2) Rom's DONE report; (3) Nog's verdict and review; (4) the list of changed file names only, never contents; (5) the screen hooks, each with its starting state in plain words ("visible when ..."); (6) the tests Rom says his change moved; (7) the address of the live dashboard on dev, for looking at the product; (8) the break-it result. Never the line-by-line code changes, never the product source. Never edits product code. Never edits a criterion. |
```

### 1b. States

**Current (lines 36-38):**

```
6. **ACCEPTED** — Nog has passed the slice. Awaiting merge.
7. **MERGED** — Merge commit on main. Awaiting archive.
8. **ARCHIVED** — Terminal success state. Read-only history.
```

**Replace with:**

```
6. **ACCEPTED** — Nog has passed the slice. The slice goes onto dev.
7. **IN_QA** — Julian's stage. The slice is on dev. A break-it check names any hollow safety-net tests, Julian writes the browser tests, then the stage runs both suites once on dev. Green means ready to merge. Red has exactly two exits (see below). A red ticket stays in IN_QA.
8. **MERGED** — dev promoted to main. Awaiting archive.
9. **ARCHIVED** — Terminal success state. Read-only history.
```

### 1c. State transitions table

**Current (line 54):**

```
| ACCEPTED      | MERGED                    | Watcher  | `git merge --no-ff slice/NNN-*` + `git push origin main`. |
```

**Replace with these four rows:**

```
| ACCEPTED      | IN_QA                     | Watcher  | Puts the slice on dev. Runs the break-it check on Rom's new safety-net tests and writes the result: a test that stays green with the fix undone is hollow, is named in the stage output, and does not count as evidence for its criterion; it is not deleted here. Builds Julian's packet: (1) the whole slice file (brief, tasks, traps, tagged criteria as O'Brien wrote them), (2) Rom's report, (3) Nog's verdict and review, (4) changed file names only, (5) screen hooks with starting states, (6) tests Rom moved, (7) the dev dashboard address, (8) the break-it result. Never the line-by-line code changes, never the product source. Spawns Julian. |
| IN_QA         | MERGED                    | Watcher / Promote button | The stage's one run of both suites on dev is green with Julian's browser tests in. Philipp presses the Promote button; both suites run once more as a last check that dev still passes, then dev is promoted to main. |
| IN_QA (red)   | — (stays IN_QA; new fix slice) | Julian → O'Brien | A test found a bug, or a criterion's only safety-net test is hollow. Julian appends the finding to the ticket. The stage writes a per-slice handoff into O'Brien's inbox naming the criterion, the failing test file, and an excerpt; a later green run does not delete it. O'Brien writes a fix slice (in the hollow case, one in which Rom replaces the test) whose brief names the red slice. When the fix slice passes Julian's stage, its green result is appended to the red ticket, which turns green. Until then the ticket waits in IN_QA. |
| IN_QA (red)   | — (stays IN_QA; waits for Philipp) | Julian → Philipp | A criterion is unclear or cannot be tested as written. Julian appends the question to the ticket; the stage writes a question file and the Ops panel shows "slice N is waiting for Philipp" until Philipp answers. The answer is appended to the ticket and the stage re-runs. Nobody edits the criterion to go green. |
```

### 1d. New section after "Rejection flow" (insert before the `---` above "Invariants", i.e. after line 74)

**Add:**

```
## Julian's stage (IN_QA)

Julian's stage is where browser tests get written. It runs after the slice is on dev and before merge, one slice at a time, visible in the Ops Center as "Julian is writing browser tests for slice N".

1. The watcher runs the break-it check on Rom's new safety-net tests and writes the result. A test that stays green with the fix undone is hollow: it is named in the stage output and does not count as evidence for its criterion. It is not deleted at this stage; nobody at Julian's stage may edit a safety-net test, and a deletion without a trailer trips the merge gate. A criterion whose only safety-net test is hollow is a bug exit (item 6): O'Brien writes a fix slice in which Rom replaces the test. A mismatch between the machine result and what Rom's report claimed is written to the stage output.
2. Julian reads his packet (the eight items in the Actors table): the slice file, Rom's report, Nog's verdict, the changed file names, the screen hooks with their starting states, the moved tests, the dev dashboard address, and the break-it result. He does not read the line-by-line code changes or the product source. His own files are the browser tests and their fixtures under `e2e/`; those he reads and extends.
3. Julian writes the browser tests for every criterion that touches the screen, using the screen hooks. While writing, he may change his own new browser test file and re-run only that file as often as he likes; that is authoring, not an exit. He never runs the full suites himself.
4. When Julian signals he is done, the stage machinery runs the full safety-net suite once and the full browser suite once on dev and records the verdict.
5. Green: the slice is ready to merge. This run is the one that decides.
6. Red has exactly two exits. A bug: the stage writes a per-slice handoff into O'Brien's inbox and O'Brien writes a fix slice. An unclear criterion: Julian appends the question to the ticket, the stage writes a question file, the Ops panel shows the slice is waiting for Philipp, and Philipp rules. In both cases the ticket stays in IN_QA (it is append-only and the slice is already on dev). There is no third exit. Never another Nog round, never Julian editing product code, never Julian editing a safety-net test, never a criterion changed to go green, never a browser test weakened to go green. Once Julian has declared red, only the two exits remain.

No time limit or number is written into this contract for Julian's stage until its first ten runs have been measured.
```

### 1e. Invariants

**Current (line 79):**

```
2. **Merge strictly after ACCEPTED.** Never before.
```

**Replace with:**

```
2. **Merge strictly after Julian's stage is green.** Never before. ACCEPTED puts a slice on dev; it does not put it on main.
```

**Add after invariant 8 (line 85):**

```
9. **Rom may escalate a broken slice to O'Brien without a Nog round.** See `slice-pipeline.md` §10.
10. **Julian's stage has two exits when red: a bug goes to O'Brien as a fix slice, an unclear criterion goes to Philipp.** No other exit exists. A red ticket stays in IN_QA, and the Promote button refuses while any ticket on dev is IN_QA red or waiting for Philipp.
11. **The browser suite runs at Julian's stage on dev, not only at the Promote button.** Rom never runs it. Julian's stage run decides whether the slice may merge; the Promote button's run is a last check that dev still passes at that moment, not a second decision.
```

Why #9 is there: `slice-pipeline.md` §10 (line 224) and `done-report-format.md` line 141 already cite "BR invariant #9", but the BR stops at #8. The slice-broken fast path is exactly what §10 describes, so writing it in as #9 makes both existing citations true without touching either file. The two new Julian-stage invariants then take #10 and #11. If you would rather not add #9, use 9 and 10 for the Julian lines, but then the two stale citations stay wrong.

### 1f. Known code divergences

**Add one bullet at the end of the list in "Known code divergences to investigate" (after the `-REVIEWED.md` bullet, before "These are candidates for their own slices"):**

```
- Invariant #1 says one file per slice, but during review the slice is three files (`{id}-PARKED.md` with O'Brien's brief and every Nog round, `{id}-DONE.md` with Rom's report, `{id}-NOG.md` with Nog's verdict), and at archive the brief and the verdict go to `bridge/trash/`; only Rom's report survives as `{id}-ARCHIVED.md`. Julian's stage needs the whole ticket, so the slice that builds the stage must assemble the packet before archiving runs (or from the trash copies if it already ran) and make the surviving file the whole ticket.
```

---

## Patch 2 of 6: `docs/contracts/slice-format.md`

### 2a. Tasks section

**Current (lines 101-103):**

```
### `## Tasks`

A numbered list of concrete, verifiable steps. Each step should be specific enough that the implementor can mark it done or not done unambiguously. Include sub-tasks where helpful.
```

**Replace with:**

```
### `## Tasks`

A numbered list of concrete, verifiable steps. Each step should be specific enough that the implementor can mark it done or not done unambiguously. Include sub-tasks where helpful.

**What the brief must never ask Rom to do.** Rom follows the brief word for word (slice 371 showed a brief overrides everything else he reads), so the brief must not ask for these:

- Never "write guard tests" or "add tests" as an open task. Say instead, word for word: "Write one safety-net test per acceptance criterion, plus one for each trap, then stop."
- Never "verify in a real browser". Rom may look in a browser to check his own work and say what he saw in his report. The browser tests themselves are Julian's, written after the slice is on dev.
- Never ask Rom to write or add a browser test (a `*.spec.js` under `e2e/`), and never ask him to run the browser suite. Fixtures and helpers under `e2e/` that his product change genuinely requires (for example `e2e/seed-fixture.js`) are allowed; he lists them under `## What changed` with one line on why. A brief whose task is to build or change the test machinery itself says explicitly that Rom may touch `e2e/`.
- Never write the break-it check as a task; the report template already requires Rom to report it.
- Never ask for more tests than the criteria and traps need.

Every brief carries the fixed "## What Rom does not do" block, verbatim, in the wording kept in `.claude/roles/obrien/slice-body-template.md`. `bridge/new-slice.js` refuses a brief that lacks the block, and refuses a brief that contains an imperative test-writing phrase aimed at Rom: "write guard tests", "guard tests, AC-tagged", "verify in a real browser", "write a browser test", "add a browser test", "add a test in e2e/", "run the browser suite", "run npx playwright test", and the bare `npx playwright test` unless followed by `--list`. Text inside code fences and inline code is ignored. The other never-ask rules above are O'Brien's discipline, not check inputs. The check is skipped for slices addressed to Bashir.

### `## Traps` *(when the change has known ways to go wrong)*

A short numbered list of the ways this change is likely to go wrong. Rom writes one safety-net test per trap. Keep each trap to one or two sentences. The trap list is not the place for testing instructions; those belong to the rule above.
```

### 2b. Acceptance criteria section

**Current (lines 105-107):**

```
### `## Acceptance criteria`

How Nog will evaluate the slice. Write these as explicit, checkable conditions — `grep`s, `git diff --stat` expectations, presence/absence of particular text, test outcomes. The implementor evaluates his own work against these criteria before writing the DONE report.
```

**Replace with:**

```
### `## Acceptance criteria`

How the slice is judged. Write these as explicit, checkable conditions — `grep`s, `git diff --stat` expectations, presence/absence of particular text, test outcomes. Each line carries its tag: `- slice-<id>-ac-<k>: <text>` (see `ac-custody.md`). The implementor evaluates his own work against these criteria before writing the DONE report. Nog checks them on the branch. Julian checks the ones that touch the screen with browser tests once the slice is on dev, reading the criteria as O'Brien wrote them.

### `## Screen hooks` *(required when any criterion touches the screen)*

For each criterion that touches the screen, one line per button, row, or field a browser test will click or read. Each line is either the stable names O'Brien already knows, or the words "Rom to declare". A stable name is an element id, a data attribute, or a class that does not change when the layout does; it is the kind of name the existing browser tests already select by. No new test-id scheme is required. Each hook also gets its starting state in plain words ("visible when ..."), written by O'Brien if he knows it or by Rom in his report. Nothing in this section is a design written before the code; it is a list of names Rom must report. Nog checks the named elements exist in the shipped page. Julian uses them. Example:

- `slice-371-ac-1`: proposed rows carry `.queue-row[data-id]` with `draggable="true"`; amendment rows do not. Visible when the queue holds at least one proposed slice.
- `slice-371-ac-2`: Rom to declare.
```

---

## Patch 3 of 6: `docs/contracts/done-report-format.md`

### 3a. Header and overview

**Current (line 6):**

```
*Reader: Nog.*
```

**Replace with:**

```
*Readers: Nog, then Julian (Bashir) at his stage on dev.*
```

**Current (line 13, last sentence):**

```
Nog reads it, plus the branch diff, to evaluate whether the slice's acceptance criteria are satisfied.
```

**Replace with:**

```
Nog reads it, plus the branch diff, to evaluate whether the slice's acceptance criteria are satisfied. Julian later reads it (never the code changes) to write the browser tests, so the screen hooks, the safety-net tests section, and the moved-tests section must be complete.
```

### 3b. Body sections

**Current (line 111):**

```
The body is freeform prose for Nog. The following sections are conventional and recommended (not strictly enforced, but Nog expects them).
```

**Replace with:**

```
The body is prose for Nog and Julian under a fixed set of headings. Required, in this order: `## Summary`, `## What changed`, `## Acceptance criteria verification`, `## Safety-net tests`, `## Screen hooks`, `## Tests moved or weakened`, `## Commit`. Optional: `## Conflicts with the brief`. The same set is in the DONE template the watcher hands Rom. A missing required heading is a Nog finding (the report is rejected and comes back to Rom); it is never an orchestrator ERROR. The ERROR path stays only for the five frontmatter metrics.
```

**Current (line 119):**

```
A concrete list of the changes — files modified, functions added, commits landed. Reference specific file paths, line numbers, and commit SHAs.
```

**Replace with:**

```
A concrete list of the changes — files modified, functions added, commits landed. Reference specific file paths, line numbers, and commit SHAs. Any fixture or helper under `e2e/` that the product change genuinely required is listed here with one line on why (Rom never writes a `*.spec.js` there).
```

**Add after the `## Acceptance criteria verification` section (after line 123, before `### \`## Commit\``):**

```
### `## Safety-net tests` **(required)**

The file(s) written, and one line per criterion tag and per trap: which test guards it. Then the break-it evidence, which is required: Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists here which tests went red. Nog rejects a report that only says green. A test that stayed green with the fix undone is hollow: say so; a test that stayed green is not evidence for its criterion, replace it before committing. If you looked in a browser to check your own work, add one line here, "What I saw in the browser: ...", not a heading of its own. No browser test files are listed here, because Rom does not write them. At Julian's stage a script repeats the break-it check as machine confirmation; a mismatch with what this section claims is written to the stage output.

### `## Screen hooks` **(required)**

For each criterion that touches the screen, the stable element names (an id, a data attribute, or a class that does not change when the layout does; the kind the existing browser tests already select by) a browser test will click or read, each with its starting state in plain words ("visible when ..."). If the brief already named them, confirm they exist as named and fill in any line the brief left as "Rom to declare". If nothing touches the screen, write `None`.

### `## Tests moved or weakened` **(required)**

Every existing safety-net test this change deliberately moved, loosened, skipped, or deleted, with the reason and the matching commit trailer. If none, write `None`. Rom moves his own safety-net tests; the second signature on any moved or weakened test comes from whoever is not doing the moving, which for Rom's tests is Nog.

### `## Conflicts with the brief` *(optional)*

If the brief asked for something Rom's standing instructions forbid (a browser test, running the browser suite, extra tests), say what was asked and what was done instead. Omit the heading when there was no conflict.
```

### 3c. Minimal example

**Current (end of the example, after the `## Acceptance criteria verification` table, lines 177-178):**

```
## Commit
`a1b2c3d` — `chore: add .gitignore`
```

**Replace with:**

```
## Safety-net tests
- `regression/repo/j-gitignore.test.js`
- `slice-150-ac-1`: "file exists" test
- `slice-150-ac-2`: "four patterns present" test
- Break-it: stashed the change, ran the file: 2 of 2 red. Restored.

## Screen hooks
None (nothing on screen changed).

## Tests moved or weakened
None.

## Commit
`a1b2c3d` — `chore: add .gitignore`
```

---

## Patch 4 of 6: `docs/contracts/ac-custody.md`

### 4a. Ownership table

**Current (lines 28-29):**

```
| **Julian (Bashir)** | Writes/updates **tests** from AC text inside the blind reconcile bundle; re-embeds `@ac-hash`. Escalates unresolvable AC-vs-test conflicts to Philipp. | Never edits an AC. Never sees source during reconcile. |
| **Nog** | Non-author second-ack on any AC mutation; reviews legacy backfill against brief *intent*. | Is never the `Spec-Owner`. |
```

**Replace with these three rows:**

```
| **Rom** | Writes the **safety-net tests** for his own change: one per AC plus one per trap in the brief, each carrying its AC tag, then stops. Runs the break-it check on them and reports which went red. Moves his own safety-net tests when needed and lists every move in his DONE report. | Never writes or commits a browser test. Never runs the browser suite. Never edits an AC. |
| **Julian (Bashir)** | Writes/updates the **browser tests** from AC text after the slice is on dev, at his own visible stage (IN_QA), one slice at a time; re-embeds `@ac-hash`. Moves browser tests only. Escalates unresolvable AC-vs-test conflicts to Philipp. | Never edits an AC. Never sees the line-by-line code changes or the product source. Never edits product code. Never edits a safety-net test. |
| **Nog** | Non-author second-ack on any AC mutation and on any moved or weakened test (the second signature comes from whoever is not doing the moving); reviews legacy backfill against brief *intent*. Checks that AC tags are present, that each test checks the criterion and not the code's shape, that nothing pins dead code, that the report lists which tests went red when the fix was removed, and that every screen hook the report or brief promises exists in the shipped page. One test per criterion plus the trap list is the target; he notes extra tests as a flag for O'Brien in the review and rejects only if the extra tests hide which one actually covers the criterion. Never rejects for a missing browser test or for not verifying in a browser; those are Julian's. | Authors no code and no tests (deliberate). Is never the `Spec-Owner`. |
```

### 4b. Julian's loop

**Current (lines 70-73):**

```
Julian's loop, every run:
1. Read `NEW-ACS.md`. For each AC decide: does it **deliberately change existing behaviour**?
   → update/add the guard test and re-embed its `@ac-hash` (a test update the gate audits).
   New behaviour with no guard → write the test. No behavioural change → it drains as-is.
```

**Replace with:**

```
Julian's loop, once per slice at his stage on dev:
1. Read `NEW-ACS.md` for the slice. The safety-net test for each AC is already Rom's; Julian never edits it.
   For each AC that touches the screen decide: does it **deliberately change existing behaviour**?
   → update the browser test and re-embed its `@ac-hash` (a test update the gate audits).
   New screen behaviour with no browser test → write it, using the screen hooks and their starting states.
   No screen change → it drains as-is.
```

---

## Patch 5 of 6: `docs/contracts/test-update-gate-trailers.md`

### 5a. Who does what

**Current (lines 100-104):**

```
- **Bashir (QA)** authors and *moves* the assertions. He never weakens to go green; a
  retired check leaves with a `Test-Loosen-OK`/`Coverage-Removed` trailer and a reason.
- **Nog (review)** is the trailer reviewer: he checks that each trailer is scoped, that
  the transition matches the real direction, and that the reason is a genuine spec change
  — not a cover for a regression. On a RED override he is the non-author second-ack.
```

**Replace with:**

```
- **Rom (implementor)** authors and *moves* the safety-net tests for his own change, one per
  AC plus one per trap. Every moved or weakened test is listed in his DONE report under
  `## Tests moved or weakened`. He never weakens to go green; a retired check leaves with a
  `Test-Loosen-OK`/`Coverage-Removed` trailer and a reason. He never touches the browser tests.
- **Bashir (QA)** authors and *moves* the browser tests, at his stage on dev, after the slice
  has landed. He never edits a safety-net test. Same rule: never weaken to go green; retired
  checks leave with a trailer and a reason.
- **Nog (review)** is the trailer reviewer: he checks that each trailer is scoped, that
  the transition matches the real direction, and that the reason is a genuine spec change
  — not a cover for a regression. On a RED override he is the non-author second-ack.
  **The second signature on a moved or weakened test comes from whoever is not doing the
  moving.** Nog authors nothing, so that is always Nog.
```

### 5b. Where it runs

**Current (lines 114-118, the table):**

```
| Surface | Mode | Effect |
|---|---|---|
| `scripts/tests-needed.js` | `--strict` in `promote.yml` | **enforcing** — exits 1 on RED, before the suites run; fails closed if `HEAD != origin/dev` |
| `scripts/tests-needed.js` | advisory in `ci.yml` (every dev push) | **warn-only** — verdict in the run summary, never blocks |
| Ops dashboard | `/api/tests-needed` | banded chip on the Step-1 checkpoint; default STOP + second-ack on RED |
```

**Add one row at the end of the table:**

```
| Julian's stage on dev (IN_QA) | after Bashir signals his browser tests are in | the stage runs both suites once; RED goes to O'Brien (bug: per-slice handoff in his inbox) or to Philipp (unclear AC: question file, Ops shows the slice is waiting), never back to Nog; the ticket stays IN_QA |
```

**Add directly under the table (before "The backstop that makes..."):**

```
How often each suite runs per slice (the run-count rule):

| Who | Safety-net suite | Browser suite |
|---|---|---|
| Rom, while working | his own new test file, as often as he likes; the full suite once before commit | never |
| Julian, while writing | never (he does not run the full suites himself) | his own new browser test file, as often as he likes; never the full suite |
| Julian's stage machinery, when Julian signals he is done | once, on dev | once, on dev |
| Promote button (`promote.yml`) | once | once |

The advisory safety-net run in `ci.yml` on every dev push is a warning light, not one of the counted runs.

Which run counts: Julian's stage run decides whether the slice may merge. The Promote button's run is a last check that dev still passes at that moment, not a second decision; if it goes red, the promotion stops and O'Brien writes a fix slice.
```

---

## Patch 6 of 6: `docs/contracts/slice-pipeline.md` (may follow in the stage slice instead)

This file says in its own §13 that it is updated in the same slice or the next one when the source of truth changes. So Philipp may leave this to the slice that builds Julian's stage (Slice 4 in the handoff to O'Brien). If he prefers to touch it now, these are the only lines.

### 6a. §3.3 body sections

**Current (line 97):**

```
- `## Acceptance criteria` — explicit, checkable conditions. Nog evaluates against these.
```

**Replace with:**

```
- `## Traps` *(when the change has known ways to go wrong)* — the ways the change is likely to go wrong; Rom writes one safety-net test per trap.
- `## Acceptance criteria` — explicit, checkable, tagged conditions. Nog evaluates against these on the branch; Julian evaluates the screen-facing ones on dev with browser tests, reading them as O'Brien wrote them.
- `## Screen hooks` *(required when a criterion touches the screen)* — one line per button, row, or field a browser test will click or read: either the stable names O'Brien already knows (an id, a data attribute, or a class that does not change when the layout does; the kind the existing browser tests already select by) or the words "Rom to declare", each with its starting state ("visible when ..."). A list of names Rom must report, not a design written before the code.
```

### 6b. §4 suffix table

**Current (line 108):**

```
The BR has 8 business states. The filesystem uses 7 suffixes. The mapping is:
```

**Replace with:**

```
The BR has 9 business states. The filesystem uses 8 suffixes. The mapping is:
```

**Current (lines 117-118):**

```
| 7 | MERGED       | (commit on `main`)  | n/a                      | Merge commit; file keeps `-ACCEPTED.md` until archive. |
| 8 | ARCHIVED     | `-ARCHIVED.md`      | `bridge/queue/`          | Terminal read-only state. Branch + worktree pruned. |
```

**Replace with:**

```
| 7 | IN_QA        | `-IN_QA.md`         | `bridge/queue/`          | Slice is on dev. Julian's stage: break-it check, browser tests, both suites once. A red ticket stays `-IN_QA.md`. |
| 8 | MERGED       | (commit on `main`)  | n/a                      | Promotion dev → main via the Promote button; file keeps `-IN_QA.md` until archive. |
| 9 | ARCHIVED     | `-ARCHIVED.md`      | `bridge/queue/`          | Terminal read-only state. Branch + worktree pruned. |
```

### 6c. §5 transitions

**Current (line 139):**

```
| ACCEPTED → MERGED                      | Watcher         | `git merge --no-ff slice/{id}` on `main`, then `git push origin main`. Emits `MERGED` (or `MERGE_FAILED` on guard trip). |
```

**Replace with:**

```
| ACCEPTED → IN_QA                       | Watcher         | Squashes `slice/{id}` onto `dev`, `renameSync` → `-IN_QA.md`, runs the break-it check (result in `bridge/state/breakit-{id}.json`; still-green = hollow, named, not deleted), builds Julian's packet ((1) the whole slice file with brief, tasks, traps and O'Brien's tagged criteria, (2) Rom's report, (3) Nog's verdict and review, (4) changed file names only, (5) screen hooks with starting states, (6) tests Rom moved, (7) the dev dashboard address, (8) the break-it result; never the diff, never the source), spawns Bashir. Ops shows "Julian is writing browser tests for slice N". Emits `IN_QA`. The stage starts by itself when the slice lands on dev. |
| IN_QA → MERGED                         | Watcher / `promote.yml` | When Bashir signals done, the stage runs both suites once on dev and records green. Philipp presses the Promote button; `promote.yml` runs both suites once more and promotes `dev` → `main`. Emits `MERGED` (or `MERGE_FAILED` on guard trip). |
| IN_QA (red, bug)                       | Bashir → O'Brien | Bashir appends the finding to the ticket. The stage parses the failing suite's output (safety-net or Playwright) and writes `HANDOFF-QA-RED-SLICE-{id}-FROM-BASHIR.md` into O'Brien's inbox naming the criterion, the failing test file, and an excerpt; a later green run does not delete it; O'Brien removes it when the fix slice is queued. A criterion whose only safety-net test is hollow takes this exit. The ticket stays `-IN_QA.md`. Emits `QA_RED`. |
| IN_QA (red, unclear AC)                | Bashir → Philipp | Bashir appends the question to the ticket. The stage writes `bridge/queue/{id}-QA_QUESTION.md`; the Ops panel shows "slice N is waiting for Philipp" next to Julian's stage until Philipp answers. The answer is appended to the ticket and the stage re-runs. The ticket stays `-IN_QA.md`. Emits `QA_RED`. |
```

### 6d. §6 actor tooling

**Add one row after the Nog row (line 152):**

```
| Bashir      | `claude -p` (spawned by watcher)       | Reads the eight-item packet and the product on dev. Writes browser tests under `e2e/`; `e2e/seed-fixture.js` and the existing `e2e/*.spec.js` are his own test code, which he reads and extends. His tests run against the fixture server the suite starts itself, not the live dashboard. Commits to `dev` from inside the stage with the watcher's commit permission; a refused commit is a stage failure shown in Ops, not a two-exit red. Never reads the diff or product source; never edits a safety-net test. |
```

---

## Things that are NOT in these patches (so nobody looks for them here)

- Nog's "review for test coverage" line lives in `bridge/nog-prompt.js` (line 34), not in a contract. Its replacement string is in the handoff to O'Brien (Slice 3); the line "Do not modify any code. Read only." (line 86) stays word for word.
- Julian's actual prompt (`bridge/templates/bashir-prompt.md`) hands him only the criteria block today, and until the stage slice lands the brief and Nog's review are only in `bridge/trash/` after archive. Giving him the eight-item packet, the IN_QA state, the per-slice handoff, the question file, and the break-it script are the stage slice (Slice 4 in the handoff to O'Brien).
- Day-one rule until the report template carries `## Screen hooks`: if the ticket has no Screen hooks section, Julian finds the stable names in the rendered page of the running product (the browser's element inspector counts as information, not source) and records the names he used in his result. A screen-touching criterion whose hook cannot be found on the rendered page is a bug exit. This is in Julian's role-file patch, not in a contract.
- Rom's inline DONE template (glued on by the orchestrator) and the on-disk `bridge/templates/report.md` do not match Patch 3 yet. Aligning the inline template to the heading set above, deleting or aligning `report.md`, and prepending the Rom role file to Rom's prompt are the instructions slice (Slice 3). The Rom role file draft is at `.claude/roles/worf/drafts/role-files-2026-09-03/rom-ROLE.md`.
- The "never ask Rom" list also goes into O'Brien's ROLE.md and MEMORY.md as exact text in Worf's handoff to him, because those are the files he reads every session. The `new-slice.js` check that enforces it is Slice 3.
- The CLAUDE.md backstop (the "Your role file" row pointing at `.claude/roles/rom/ROLE.md`, the dead pointers, three lines on tests) is a separate one-page before/after patch at `.claude/roles/worf/drafts/contracts-2026-09-03/CLAUDE-md-patch.md`.
- Nog's and Julian's role-file changes are drafts under `.claude/roles/worf/drafts/role-files-2026-09-03/` for Philipp to apply; both run headless and never read an inbox.
- Deleting the dead `test/` folder after Julian's bounded look is a slice (Slice 6), not a contract change.

---

## How to apply (the folder is locked to you)

1. `bash scripts/unlock-main.sh` then edit the five (or six) files above by hand, patch by patch, in `docs/contracts/`. Match on the quoted text, not on line numbers, if the numbers have drifted.
2. Commit the contract files by explicit path, never with `-a` (the main working tree holds other people's uncommitted work):

   ```
   DS9_WATCHER_MERGE=1 git commit docs/contracts/slice-lifecycle.md docs/contracts/slice-format.md docs/contracts/done-report-format.md docs/contracts/ac-custody.md docs/contracts/test-update-gate-trailers.md docs/contracts/slice-pipeline.md -m "contracts: test ownership, Julian's stage (IN_QA), screen hooks (Worf ruling 2026-09-03)"
   ```

   Drop `slice-pipeline.md` from that list if you leave Patch 6 to the stage slice.
3. `bash scripts/lock-main.sh`, then tell Worf, and apply the Nog, Bashir and Rom role-file drafts. O'Brien and Dax already have their handoffs.

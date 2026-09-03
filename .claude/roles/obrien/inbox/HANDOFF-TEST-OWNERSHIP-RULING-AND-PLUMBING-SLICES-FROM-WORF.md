# HANDOFF: Test ownership ruling and the plumbing slices Worf needs

**From:** Worf (DevOps / release)
**To:** O'Brien (delivery coordinator)
**Date:** 2026-09-03
**Scope:** Who writes which tests, what a brief may and may not ask of Rom, the exact patch for your ROLE.md, and six slice requests in priority order. Philipp confirmed the ruling today.

---

## Why this exists

Slice 371 died twice. First, your brief told Rom to "write guard tests" and "verify in a real browser", so he wrote 6 browser tests and 13 safety-net tests for 5 criteria, ran the full suites four times, and produced a long report. Second, the orchestrator saw "one commit plus a long report" and filed the slice as fake work. Slice 366 hit the same rule the day before. Your handoff to me asked for the test boundary to become a contract rule instead of your discipline. This is that rule, plus the plumbing that makes it real.

### The ruling, in one paragraph

Rom writes the safety-net tests for his own change: one per acceptance criterion, plus one per trap in the brief, then he stops. He never writes or commits a browser test. He breaks his own fix on purpose before he commits, confirms his new tests go red, and lists which ones did in his report. He may open a browser to check his own work and say what he saw. Nog stays read-only and checks Rom's tests against a concrete list. When the slice lands on dev, Julian's stage runs as a visible step, one slice at a time: a script repeats the break-it check as machine confirmation, Julian writes the browser tests from information, never from code, and the stage machinery runs both suites once. Red at Julian's stage has exactly two exits: a bug (you write a fix slice) or an unclear criterion (goes to Philipp). Green means the slice may merge. The ratified sequence is unchanged: Rom builds, visibly through Nog, onto dev, Julian updates the suite, merge on green. Model A stays parked.

### The deliberate no: Nog does not write tests

This is a choice, not something we forgot. Nog reads Rom's code first, so any test he wrote would share Rom's blind spots. Nog is the one signature on the team that comes from a non-author; making him an author breaks that. Moving test-writing from Rom to Nog does not remove the minutes, it moves them, and it turns a 30-second fix in Rom's own workspace into a full round trip. It would also need two charters rewritten and a new pipeline state. So: Nog authors nothing. Please do not read the ruling as "Nog will pick it up later". Philipp's word on this was "confirmed".

---

## What you're asking for

Four things, in this order: a list of instructions that must never appear in a brief again (with the fixed block every brief now carries), the exact patch for your ROLE.md and MEMORY.md, one thing a brief must now carry for screen-touching criteria, and six slice requests.

### 1. What not to ask of Rom

How Rom's instructions reach him today: his prompt is the brief plus the orchestrator's inline DONE template, nothing else. No role file is loaded. `.claude/CLAUDE.md` sits in his workspace as background, and on 371 he ignored its first instruction, then followed your Task 5 and Trap 5 to the letter. So today the brief is the only instruction Rom reliably obeys. That is why this list has to live on your side, as things you never write, and not only on his.

Three layers, in order of strength:

1. **Your side.** The never-ask list in your ROLE.md and MEMORY.md (patch in section 2), the "What Rom does not do" block in every brief, and a body check in `bridge/new-slice.js` (Slice 3).
2. **The inline DONE template** the orchestrator appends to every Rom prompt (Slice 3): the required headings plus a short "What Rom does not do" list. Guaranteed delivery on every run, first round and rework.
3. **The Rom role file** at `.claude/roles/rom/ROLE.md`. It reaches Rom only once Slice 3 makes `invokeRom` build the prompt as role text + brief + DONE template. My draft of it is at `.claude/roles/worf/drafts/role-files-2026-09-03/rom-ROLE.md`; Philipp puts it in place. `CLAUDE.md` is a backstop and its "Your role file" row must point at `.claude/roles/rom/ROLE.md` (that is in the CLAUDE.md patch, see Context).

**Never put any of these in a brief**, in Tasks, Traps, Context, or Acceptance criteria:

- **"Write guard tests"** or **"Guard tests, AC-tagged"** (or any wording that asks for more than one safety-net test per criterion plus the traps). Reason: 13 tests for 5 criteria on 371 was bloat, and the bloat fed the rule that killed the slice.
- **"Write a browser test"**, **"add a browser test"**, **"add a test in e2e/"**. Reason: Rom never writes or commits a browser test (a `*.spec.js` under `e2e/`). Browser tests are Julian's, written after the slice lands on dev, from information, not from Rom's code. Fixtures and helpers under `e2e/` that Rom's product change genuinely requires (for example `e2e/seed-fixture.js`, which he had to extend on 371) are allowed; he lists them under `## What changed` with one line on why. A plumbing brief that needs Rom to touch `e2e/` machinery says so explicitly (Slices 2, 4 and 5 below do).
- **"Verify in a real browser, not only by unit test."** Reason: this exact sentence produced the 201-line browser test on 371. Rom may look in a browser on his own and report what he saw; you do not ask him to prove it with a test.
- **"Run the browser suite"** or `npx playwright test` as an instruction for Rom to run it. Reason: Rom never runs the browser suite. The stage machinery runs it once at Julian's stage; the Promote button runs it once. A brief may name playwright, `e2e/` or browser tests when the task is to build or change the machinery that runs them.
- **"Run the full suite"** more than once. Reason: Rom runs his own new test file as often as he likes while working and the full safety-net suite once before commit. On 371 the full suite ran four times, two of them identical green runs after the commit.
- **"Symlink node_modules"** or any manual dependency setup. Reason: that is the orchestrator's job (Slice 2). On 371 Rom spent four calls linking and unlinking dependencies by hand.
- **"Split your work into more than one commit"** or any coaching around the fake-work rule. Reason: the rule is the bug (Slice 1). The 366 restage brief worked around it by instruction; that stops once the rule is fixed. (The Rom role file carries one temporary line, "Until the fake-work rule is fixed (Slice 1), put the DONE report in its own commit", marked for removal. That line is in his file, not in your brief.)
- **The break-it check as a task.** Do not write the break-it check as a task; the report template already requires Rom to report it. He stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under `## Safety-net tests`. Nog rejects a report that only says green.

**What you write instead, once, in the Tasks section:** "Write one safety-net test per acceptance criterion, plus one for each trap, then stop."

**The fixed block every brief for Rom carries, verbatim.** Slice 3 makes `new-slice.js` refuse a body that does not contain it. Paste it as written; do not reword it:

```
## What Rom does not do

- Rom writes one safety-net test per acceptance criterion, plus one per trap, then stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the browser suite. He runs his own new test file as often as he likes and the full safety-net suite once before commit.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.
```

If a slice genuinely needs Rom to touch `e2e/` machinery, add one line after the block, outside it: "This slice may change `e2e/<file>` because <reason>." The block itself stays untouched.

**One housekeeping ask that goes with this.** Your brief structure (What is broken / Tasks / Traps / Acceptance criteria) lives nowhere on disk. `bridge/templates/slice.md` is never read by `new-slice.js`. Please write your real Tasks/Traps body template into `.claude/roles/obrien/slice-body-template.md`, without the phrases above and with the fixed block in it, so the removal is a visible change rather than a promise. The ROLE.md patch below points at that file.

### 2. The patch for your ROLE.md and MEMORY.md

Exact replacement text, so the wording cannot drift from the contract. Apply it yourself; your role folder is outside the lock.

**ROLE.md, line 75. Current:**

```
After creation, review and fill in the ## Tasks and ## Success criteria sections if
```

**Replace with:**

```
After creation, review and fill in the ## Tasks and ## Acceptance criteria sections if
```

**ROLE.md, the "Slice Authoring Standards" section (lines 80-88). Current:**

```
## Slice Authoring Standards

- Always use `node bridge/new-slice.js` — never write frontmatter by hand
- `from: obrien` on every slice
- `to: rom` for backend/watcher/server work; `to: leeta` for frontend/UI work
- Goal field is one sentence, outcome-focused: "X will be possible / visible / working"
- Tasks are numbered, concrete, and independently verifiable
- Success criteria are checkable conditions Nog can evaluate against the DONE report
- Branch name goes in the slice body if it deviates from the default `slice/NNN-*` pattern
```

**Replace with:**

```
## Slice Authoring Standards

- Always use `node bridge/new-slice.js` — never write frontmatter by hand
- `from: obrien` on every slice
- `to: rom` for backend/watcher/server work; `to: leeta` for frontend/UI work; `to: bashir` for browser-test work
- Goal field is one sentence, outcome-focused: "X will be possible / visible / working"
- Tasks are numbered, concrete, and independently verifiable
- Acceptance criteria are checkable conditions Nog can evaluate against the DONE report. Each line carries its tag: `- slice-<id>-ac-<k>: <text>`
- Branch name goes in the slice body if it deviates from the default `slice/NNN-*` pattern
- My brief body template lives at .claude/roles/obrien/slice-body-template.md; read it before writing a brief

### What I never ask Rom to do

Rom follows the brief word for word (slice 371 proved it), so the brief must not ask for these:

- Never "write guard tests", "guard tests, AC-tagged", or "add tests" as an open task. The one task sentence is: "Write one safety-net test per acceptance criterion, plus one for each trap, then stop."
- Never "verify in a real browser". Rom may look in a browser to check his own work and say what he saw in his report. Browser tests are Julian's, written after the slice is on dev.
- Never "write a browser test", "add a browser test", or "add a test in e2e/". Rom never writes or commits a *.spec.js under e2e/. Fixtures and helpers under e2e/ that his product change genuinely requires are allowed and listed in his report; if the slice needs that, the brief says so.
- Never "run the browser suite" or tell Rom to run npx playwright test. Never ask for the full safety-net suite more than once.
- Never ask Rom to symlink node_modules, split commits to satisfy the fake-work rule, or write the break-it check as a task; the report template already requires him to report it.
- Every brief for Rom carries the fixed "## What Rom does not do" block from the template file, verbatim. new-slice.js refuses a body without it.

### `## Screen hooks`

When any criterion touches the screen, the brief has a `## Screen hooks` section. Each line is either the stable names I already know or the words "Rom to declare". Each hook also gets its starting state ("visible when ..."), written by me if I know it or by Rom in his report. A stable name is an element id, a data attribute, or a class that does not change when the layout does; the kind of name the existing browser tests already select by. No new test-id scheme. Nothing in this section is a design written before the code; it is a list of names Rom must report.

### `## Traps`

A short numbered list of the ways this change is likely to go wrong. Rom writes one safety-net test per trap. Keep each trap to one or two sentences. The trap list is not the place for testing instructions.
```

**MEMORY.md, one entry under "Conventions & constraints":**

```
### 2026-09-03 — What a brief never asks Rom (test-ownership ruling)
Rom writes one safety-net test per acceptance criterion plus one per trap, then stops; he never writes a browser test and never runs the browser suite; the break-it check is reported, not tasked. Every brief for Rom carries the fixed "## What Rom does not do" block verbatim and, when a criterion touches the screen, a "## Screen hooks" section. Full list: ROLE.md "What I never ask Rom to do". Ruling: .claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md.
**Why it matters:** On 371 Rom obeyed the brief's "write guard tests" and "verify in a real browser" over CLAUDE.md. The brief is the instruction he follows, so the rule lives on my side.
```

### 3. What a brief must now contain for a screen-touching criterion

Decided by me at Philipp's request (his words: "i dont understand, i trust you to make the right decision"). For any acceptance criterion that touches the screen, the stable names of the things a browser test will click or read (buttons, rows, fields) must be written down before Julian's stage, together with the state the screen has to be in for them to appear.

In the brief this means: when any criterion touches the screen, the brief has a `## Screen hooks` section. Each line is one of two things:

- **You already know the names:** write them, with the starting state. Example: `slice-371-ac-1: proposed row = .queue-row[data-id=<id>], drag handle = .drag-handle; visible when at least two proposed slices are staged`.
- **You do not know them yet:** write `Rom to declare` for that criterion. Rom names them in his DONE report under `## Screen hooks`, each with its "visible when ..." line. Nog checks the named elements exist in the shipped page. Julian uses them.

A stable name is an element id, a data attribute, or a class that does not change when the layout does; it is the kind of name the existing browser tests already select by. No new test-id scheme is required; no browser test in `e2e/` uses one today and a new scheme would make every existing test non-compliant overnight.

Nothing in this section is a design written before the code; it is a list of names Rom must report. This is a light version of an idea Dax attached to the parked Model A. It is not Model A: nothing is written before the code exists, and the order of the pipeline does not change.

### 4. Slice requests, in priority order

Every Rom-built brief among these carries the "What Rom does not do" block verbatim. Slices 2, 4 and 5 also carry the one-line `e2e/` machinery exception after the block. Order: 1 and 2 first (they unblock everything), then 3 (Rom's and Nog's instructions, which the stage depends on), then 4 (the stage), then 5, then 6. Criteria are written as `ac-N:`; prefix them with `slice-<id>-` when you stage.

#### Slice 1 — Fix the fake-work rule, then re-queue 371

**Why.** `verifyRomActuallyWorked` in `bridge/orchestrator.js` (around line 1937, the `highClaimOnSkeleton` line) fails a slice when the branch has exactly one commit and Rom's self-reported `tokens_out` is over 1,000. It never looks at what the commit contains. 371's one commit changed 8 files, +988/-14 lines. The error text contradicts itself ("made no commits" and "1 commit(s) ahead" in one sentence, around line 4158). The orchestrator already measures the real output and only uses it for a soft warning. Slice 372 task 4 aimed at this rule, but 372 is rejected on an unrelated finding, so this must not wait on 372.

**Acceptance criteria.**

- ac-1: A branch with zero commits ahead of dev fails verification with reason `rom_no_commits`, as today.
- ac-2: A branch with one commit ahead of dev that changes at least one file outside the bookkeeping paths (`bridge/queue/*-DONE.md`, `bridge/state/`, `bridge/heartbeat.json`, `bridge/timesheet*.jsonl`, `bridge/trash/`) passes verification. Measured with `git diff --numstat dev...<branch>`, not with the report.
- ac-3: A branch whose commits change only the DONE report fails with the new reason `rom_no_product_change`.
- ac-4: Rom's self-reported `tokens_out` is no longer a blocking input. The existing claimed-versus-actual warning still appears in the log.
- ac-5: The failure message never says "made no commits" when the branch has a commit.
- ac-6: `verifyRomActuallyWorked` keeps its name and signature (tests in `test/` and possibly `regression/` call it).
- ac-7: A test runs the new rule against branch `slice/371` as it stands (one commit) and it passes verification without any change to that commit.

**After Slice 1 lands (not a criterion Nog can check on the branch):** you or I move `371-ERROR.md` to `bridge/trash`, write `371-QUEUED.md` with the original body, and the orchestrator's existing "branch exists, workspace gone" path in `createWorktree` picks up `slice/371`.

**Traps.** (1) The 371 branch carries a 201-line browser test Rom should not have written. That is not a reason to reject him retroactively and not something Rom removes in this slice; it is Julian's to keep, rewrite or drop at his stage. (2) Do not re-queue 371 before this rule is on dev; it would trip the same rule again.

#### Slice 2 — Every workspace gets its dependencies

**Why.** `createWorktree` (`bridge/orchestrator.js` around line 1637) runs `git worktree add` and nothing else. `node_modules` is gitignored, so a fresh workspace cannot run either suite. Rom worked around it on 371 by symlinking the main repo's `node_modules` and deleting the link before commit: a symlink named `node_modules` is not matched by the ignore pattern `node_modules/`, so it would have been committed. Playwright's browsers are already cached machine-wide in `~/Library/Caches/ms-playwright`; only the dependencies are missing. Julian's stage does not wait on this (it runs in the main checkout, which has its dependencies); Rom and Nog do.

**Acceptance criteria.**

- ac-1: Right after `git worktree add`, `createWorktree` gives the workspace a `node_modules`, either by `npm ci --prefer-offline` or by a symlink to the main repo's `node_modules`.
- ac-2: A fresh workspace can run `node --test regression/**/*.test.js` and `npx playwright test --list` with no manual step.
- ac-3: `git status` in that fresh workspace is clean. If a symlink is used, `.gitignore` changes from `node_modules/` to `node_modules` (no trailing slash) in the same slice.
- ac-4: No browser download happens per slice; the existing machine cache is used.
- ac-5: Nog's workspace (the `createWorktree` call around line 3593) gets the same treatment.
- ac-6: The first Rom run after this lands has no `ln -s` line in its log.

**`e2e/` exception line for this brief:** "This slice may run `npx playwright test --list` in a test and may touch Playwright configuration, because the task is the machinery that makes the suites runnable. Rom writes no `*.spec.js`."

#### Slice 3 — Rom's and Nog's instructions: the DONE template, the role-file paste-in, Nog's line, the brief check

**Why.** Rom's DONE-report instructions come from an inline block in `bridge/orchestrator.js` (around lines 2183-2222) that dictates only the frontmatter and five metrics; `invokeRom` builds the prompt as `sliceContent + doneTemplate` (around line 2237). `bridge/templates/report.md` is dead, never injected, and disagrees with the contract. That is why 366, 371, 318 and 349 all use different headings and none lists screen hooks or moved tests. Nog's "test coverage" instruction is `bridge/nog-prompt.js` line 34, not his ROLE.md, and it is what could make him reject Rom for missing browser tests. And the only place a "never ask Rom" rule binds regardless of anyone's memory is a body check in `bridge/new-slice.js`. This slice must land before Slice 4 so the stage's packet has screen hooks and moved tests to carry.

**Acceptance criteria.**

- ac-1: The DONE template block the orchestrator appends to Rom's prompt requires these body headings, in this order: `## Summary`, `## What changed`, `## Acceptance criteria verification`, `## Safety-net tests`, `## Screen hooks`, `## Tests moved or weakened`, `## Commit`. Optional: `## Conflicts with the brief`. The template says what goes under `## Safety-net tests`: one line per criterion and per trap (file, test name, tag); which tests went red when the fix was removed; and, as a line inside this section, not its own heading, what Rom saw in the browser. `## Screen hooks`: the stable names for every screen-touching criterion, each with "visible when ...", or "None, no criterion touches the screen". `## Tests moved or weakened`: every existing test this change moved or weakened, with the trailer used, or "None".
- ac-2: A report missing a required heading is handed to Nog as usual; the missing heading is a Nog finding (REJECTED), never an orchestrator ERROR. The ERROR path stays only for the five metrics, as today.
- ac-3: The same block carries a short "What Rom does not do" list: one safety-net test per criterion plus the traps, then stop; never write or commit a browser test (`*.spec.js` under `e2e/`); never run the browser suite; full safety-net suite once before commit; break the fix on purpose and list which tests went red. This is belt and braces; the brief rule is the real one.
- ac-4: `invokeRom` builds the prompt as `roleText + sliceContent + doneTemplate`, where `roleText` is the body of `.claude/roles/rom/ROLE.md` read from the main checkout (`PROJECT_DIR`, not Rom's worktree), on the first round and on every `--resume` rework round. A test that builds Rom's prompt for a sample slice finds the role text before the brief. If the file is missing, the orchestrator logs a warning and continues.
- ac-5: `bridge/templates/report.md` is deleted or made identical to the section list in ac-1. It must not remain as a third, different template.
- ac-6: `bridge/nog-prompt.js` line 34 is replaced with exactly this text (quote it the way the line is quoted today):

  ```
  Review the code changes per ROLE.md: correctness, quality, lint, no regressions. Check Rom's safety-net tests for honesty: AC tags present; each test checks the criterion, not the shape of the code; nothing pins dead code; the report lists which tests went red when the fix was removed; one test per criterion plus the trap list (note extra tests as a flag for O'Brien; reject only if the extras hide which test covers the criterion). Check that every screen hook the report or brief promises exists in the shipped page. Never reject for a missing browser test or for not verifying in a browser; those are Julian's, not Rom's. The second signature on a moved or weakened test comes from whoever is not doing the moving.
  ```

  The string contains apostrophes ("Rom's", "Julian's") and line 34 is a single-quoted string today: escape them or switch that one line to double quotes. The words do not change.

- ac-7: The line "Do not modify any code. Read only." (`bridge/nog-prompt.js` line 86) stays word for word.
- ac-8: `bridge/new-slice.js` refuses a brief body that contains an imperative test-writing phrase aimed at Rom: "write guard tests", "guard tests, AC-tagged", "verify in a real browser", "write a browser test", "add a browser test", "add a test in e2e/", "run the browser suite", "run npx playwright test", and the bare token `npx playwright test` unless it is immediately followed by `--list`. Text inside code fences and inline code is ignored, so a brief may quote a forbidden phrase as an example. It prints the reason. A brief may name playwright, `e2e/` or browser tests when the task is to build or change the machinery that runs them; the check targets what Rom is asked to write or run, not the subject of the slice.
- ac-9: `new-slice.js` also refuses a brief body that does not contain the fixed "## What Rom does not do" block verbatim (the block text is in `.claude/roles/obrien/slice-body-template.md`; the check compares against a copy kept next to `new-slice.js`). The phrase check in ac-8 runs on the body with the fixed block removed, so the block's own wording never trips it.
- ac-10: The check is skipped entirely when the slice's `to:` is `bashir`.
- ac-11: Tests: the 371 body is refused; the reworded S363 body is accepted; the brief bodies you actually file for Slices 1, 2, 4 and 5 are accepted. Slice 2's body names `npx playwright test --list` and is the explicit accepted case for that token. Slice 3 itself is filed before the check exists, so it is not a test case. When you write Slice 3's real brief, put the phrase list inside a code fence, and keep the literal "Guard tests, AC-tagged" quote out of Slice 4's brief.

**For you to settle in this brief:** whether Rom's safety-net tests must carry the `@ac-hash` line for the coverage tracker (`regression/COVERAGE.md`). Today 0 of 14 existing drafts carry one. If yes, the DONE template shows the exact line Rom writes; if no, say so in the brief so Nog does not flag it.

#### Slice 4 — Julian's visible stage on dev (S363 reframed)

**Why.** S363 as staged makes today's test-update gate visible in Ops. Under the ruling, Julian's stage is a different thing: a per-slice step, started when a slice lands on dev, that receives a fixed information packet, repeats the break-it check by script, lets Julian write browser tests, runs both suites once through the stage machinery, and has exactly two red exits with real destinations. Today none of that exists: the gate prompt (`buildBashirPrompt`, `bridge/templates/bashir-prompt.md`) gives Julian only the acceptance-criteria block, regex-cut from whichever file survived archiving, which is usually Rom's re-typed copy; the gate runs only the safety-net suite and never the browser suite; it starts from the Ops merge button; and the CHECK-overlay path (`scripts/author-ac-test.js`) tells Julian to "explore the repo" and read `dashboard/`, `lib/`, `scripts/`, the opposite of his information-only rule. Please rewrite S363's body around the criteria below before Philipp approves it. Its current task 5 ("Guard tests, AC-tagged") must go. One-slice-at-a-time already exists (the gate mutex holds later ACCEPTED slices back); keep it.

**The sticker on day one.** Today the slice is three files during review: your brief as `{id}-PARKED.md` with every Nog round appended, Rom's report as `{id}-DONE.md`, Nog's verdict as `{id}-NOG.md`. At archive (`archiveAcceptedSlice`, right after `squashSliceToDev`, around line 3394; `archiveSiblingStateFiles` around line 3265) the brief and verdict go to `bridge/trash` and only Rom's report survives as `{id}-ARCHIVED.md`. The squash commit carries AC trailers copied from Rom's commits, not your wording. The stage must not depend on the sticker existing yet.

**You may split this into three slices**, landing in this order: 4a (the IN_QA state, auto-start, the packet and prompt, commit permission, panel label, suffix map), 4b (the break-it script and its result file), 4c (Playwright parsing, the per-slice red handoff, the question file and its answer watch, the waiting line, the fix-slice link, the Promote block, measurement). Nog's OVERSIZED verdict exists for exactly this size of brief. The stage counts as live only after 4c.

**Acceptance criteria.**

*Start, naming, panel*

- ac-1: When a slice lands on dev, the stage starts by itself for that one slice. The Ops merge button no longer starts Julian's gate; it only promotes. (Today the Ops merge button calls `startGate()` and spawns Bashir; the Promote button dispatches `promote.yml` on GitHub.)
- ac-2: The state is `IN_QA`. The slice file is renamed `{id}-IN_QA.md` while the stage runs; the register event is `IN_QA`; a red result emits `QA_RED`. A red ticket stays in `IN_QA` (append-only; the slice is already on dev) while O'Brien writes a fix slice or Philipp rules.
- ac-3: The Ops panel shows "Julian is writing browser tests for slice N" while the stage runs, never shows green while running, and survives a reload.

*The packet*

- ac-4: The packet builder assembles the packet before `archiveSiblingStateFiles` runs, or from the trash copies (`bridge/trash/{id}-PARKED.md.*`, `{id}-NOG.md.*`) and `{id}-ARCHIVED.md` if it already ran.
- ac-5: After this slice, the file that survives archive is the whole sticker: brief with every Nog round, Rom's report, Nog's verdict, and Julian's result appended.
- ac-6: Julian's built prompt contains these eight items and, beyond them, only the operational lines (the pointer to `e2e/` and the mutex contract). A test that builds it for a sample slice finds each of the eight: (1) the whole slice file: your brief with goal, tasks, traps, and the tagged criteria as you wrote them; (2) Rom's DONE report; (3) Nog's verdict and review; (4) the list of changed file names only, never contents; (5) the screen hooks, each with its starting state in plain words ("visible when ..."); (6) the tests Rom says his change moved; (7) the address of the live dashboard on dev, for looking at the product; (8) the break-it result.
- ac-7: Julian's built prompt never contains the line-by-line code changes or the contents of a product source file. The same test checks the prompt for `diff --git` and for any line of a product file and finds none. Julian is never handed the diff or told to open a source file; his write scope is `e2e/` and the slice file; reading a product file is forbidden by his role and is an unclear-criterion exit, not a workaround.
- ac-8: `e2e/seed-fixture.js` and the existing `e2e/*.spec.js` are Julian's own files (test code, not product code); the prompt says he reads and extends them. His browser tests run against the fixture server the suite starts itself, not against the live dashboard; the dashboard address is for looking.
- ac-9: The "Explore the repo" instruction and the list of product folders are removed from `scripts/author-ac-test.js`; the packet replaces them.
- ac-10: Day-one hooks rule, written into Julian's prompt: if the sticker has no Screen hooks section, Julian finds the stable names in the rendered page of the running product (the browser's element inspector counts as information, not source) and records the names he used in his result. A screen-touching criterion whose hook cannot be found on the rendered page is a bug exit.

*The break-it check*

- ac-11: Before Julian writes anything, a script runs the break-it check; Julian does not run it by hand. Recipe: (1) find the slice's squash commit on dev by its `Slice-Id` trailer; (2) `git diff --name-status <sha>^ <sha>`: test files = `regression/**/*.test.js` added or changed; product files = everything else except `bridge/queue/`; the tests under check are only those new in the slice (test names added by the diff of each changed test file, cross-checked against Rom's `## Safety-net tests` list), never the pre-existing tests in a changed file; (3) in a scratch worktree at `<sha>` with `node_modules` linked from the main repo, `git checkout <sha>^ -- <product files>`, then `node --test <the test files>`; (4) write `bridge/state/breakit-{id}.json`: per new test name, red or still-green; pre-existing tests in a changed file are recorded as "pre-existing, still green (expected)" and excluded from the hollow set and from the mismatch check in ac-13; (5) a new test that is still-green = hollow.
- ac-12: A hollow test is a test that stays green with the fix undone. It is named in the stage output and does not count as evidence for its criterion. It is not deleted at the stage: nobody at Julian's stage may edit a safety-net test, and a deletion without a trailer trips the merge gate. A criterion whose only safety-net test is hollow is a bug exit: you write a fix slice in which Rom replaces the test.
- ac-13: The script result is the machine confirmation of what Rom reported under `## Safety-net tests`; a mismatch between the script and Rom's claim is written to the stage output.

*Runs and verdict*

- ac-14: While writing, Julian runs his own new browser test file as often as he likes and may fix it as often as he likes. He never runs the full suites himself. When he signals he is done, the stage machinery runs the full safety-net suite once and the full browser suite once on dev and records the verdict. Once he has declared red there are only the two exits.
- ac-15: Julian's commit of his browser tests to dev lands from inside the stage without a human (the repo's pre-commit hook refuses commits in the main tree unless `DS9_WATCHER_MERGE=1`; the stage provides that or runs him in a worktree on dev), and `git push origin dev` follows it. A refused commit is a stage failure shown in Ops, not a two-exit red.

*Two exits*

- ac-16: Red has exactly two exits and the stage output names which one was taken. Bug: the stage writes a per-slice handoff `HANDOFF-QA-RED-SLICE-{id}-FROM-BASHIR.md` into `.claude/roles/obrien/inbox/` naming the criterion, the failing test file, and an excerpt; a later green run does not delete it; you remove it when the fix slice is queued. Unclear criterion: Julian appends the question to the sticker and the stage writes `bridge/queue/{id}-QA_QUESTION.md`; the Ops panel shows "slice N is waiting for Philipp" next to Julian's stage until Philipp answers; the answer is appended to the sticker and the stage re-runs.
- ac-17: The failure parser handles Playwright output as well as `node --test` output. Today `scripts/regression-report.js --from-log` parses only `node --test` and writes one fixed file `REGRESSION-FAILURE.md` that the next red overwrites and the next green deletes; that behaviour is replaced by the per-slice handoff in ac-16.
- ac-18: There is no path back to Nog. The stage cannot edit product code, cannot edit a safety-net test, cannot edit a criterion, and cannot weaken a browser test to go green.

*Measurement*

- ac-19: Each run records start time, end time and outcome, so the first ten runs can be measured before any duration, retry or size number goes into a contract.

*Added after review: archive timing, leaving IN_QA, the answer channel*

- ac-20: `archiveAcceptedSlice` runs after Julian's stage records green (or at promote), not at squash. Today it runs the moment the squash lands, which would remove the file before the stage could rename it `-IN_QA.md` or append to it. The "from trash" path in ac-4 serves only slices that landed before this slice.
- ac-21: `-IN_QA.md` is added to `CANONICAL_LIVE_SUFFIXES` in `bridge/orchestrator.js` and to the Ops server's suffix-to-state map, so the legacy-file audit does not flag it and the panel can show it.
- ac-22: A fix slice's brief carries a `Fixes-QA-Red: {id}` trailer. When the fix slice's stage records green, the stage appends that result to the red ticket, moves the red ticket to green, and lets archive run. This is how a red ticket ever leaves IN_QA on the bug path.
- ac-23: The Promote button refuses (or shows a blocking warning) while any ticket on dev is IN_QA red or IN_QA waiting for Philipp. This is the mechanism behind "promotion only after Julian's stage is green".
- ac-24: The answer channel for the unclear-criterion exit: Philipp writes under a `## Answer` heading in `bridge/queue/{id}-QA_QUESTION.md` (or an Ops text box writes the same). The orchestrator watches for a non-empty Answer, appends question and answer to the sticker, trashes the question file, clears the panel line, and re-runs the stage. A test exercises the watch.

**Scope and `e2e/` exception line for this brief:** "This slice may change `bridge/templates/bashir-prompt.md`, `scripts/author-ac-test.js`, `scripts/regression-report.js`, `dashboard/server.js` (the merge button handler, the suffix-to-state map, the panel label, the waiting line), the stage runner and the Playwright invocation, because the task is the machinery that runs the browser suite. Rom writes no `*.spec.js`."

#### Slice 5 — Let Julian's drafts land without a human copying files (S356-S359 reworded)

**Why.** These four are the chain that lets Julian's output land: 356 shows drafts read-only, 357 makes drafts applicable by construction (coverage annotation, runnable filename, declared target, model from config), 358 applies a draft on confirm with an atomic lock regeneration, 359 contains the authoring agent (which today runs with bypass permissions in the repo root). They are staged around a per-tag model; the ruling makes Julian's stage per-slice. 357 and 359 stay valid as written. 356 and 358 stay valid but are keyed to a slice's batch of drafts, not one tag at a time. All four bodies currently ask Rom for "guard tests"; reword before Philipp approves.

**Acceptance criteria (add to each of the four).**

- ac-1: The phrase "guard test" does not appear as a task for Rom; the task says "Write one safety-net test per acceptance criterion, plus one for each trap, then stop."
- ac-2: The brief contains the "## What Rom does not do" block verbatim.
- ac-3: 356 and 358: the overlay lists and applies the drafts for one slice as a set; no per-tag button is left over.
- ac-4: 359: the authoring agent's write scope is the drafts folder and `e2e/` only, never the repo root; a test that starts the agent and asks it to write outside those folders sees the write refused.
- ac-5: 358 depends on 354; confirm 354 has landed before 358 is queued.

**`e2e/` exception line for these briefs:** "This slice may change the code that reads, applies or contains browser-test drafts under `e2e/`, because the task is that machinery. Rom writes no `*.spec.js`."

#### Slice 6 — Julian's bounded look at `test/`, then delete it

**Why.** `test/` holds 81 files and 18,029 lines that nothing runs. 76 are hand-rolled scripts that call `process.exit`; two regenerate fixtures that the gated glob matches, which is why slice 365 had to de-scope it after a false RED FLAG. The ruling is delete, not port; Philipp's word was "yes confirmed". The only claimed reason to keep any of it is the squash/merge cases `regression/COVERAGE.md` says only `test/` covers. `COVERAGE.md` already shows slice 350's two squash-subject criteria have live guards in `regression/gate-merge/`, so the look is about confirming what is genuinely uncovered. Julian owns the look. Commission it to him (`to: bashir`), not to Rom; the `new-slice.js` check skips `to: bashir`.

**Acceptance criteria (the look).**

- ac-1: Julian's report names the squash/merge cases from `COVERAGE.md` that cite `test/` files, and for each says: covered by a live safety-net test (name it), or genuinely uncovered (one line on what would be lost).
- ac-2: The look is bounded: it reads `COVERAGE.md` and the named `test/` files only, and takes one run.

**Then a second slice (to Rom) deletes `test/` in full.** Its trap: "nothing outside `test/` and `COVERAGE.md` changes", so the merge gate's coverage count does not shrink without a trailer (`promote.yml` fails closed when the guard count drops). Any genuinely uncovered case becomes one line in a brief for Rom on the next slice that touches that area, not a port of the old file.

---

## Context the receiver needs

**The contract wording is not yours and not Dax's.** I draft the contract changes as one quote-and-replace patch document at `.claude/roles/worf/drafts/contracts-2026-09-03/CONTRACT-PATCHES-FOR-PHILIPP.md`: each change quotes the current text and the replacement, so Philipp can apply them by hand (no full replacement files, no diff). The folder `docs/contracts/` is locked and only he edits it. Dax is not in this loop; her handoff from you still says she owns writing the test boundary into the contracts, and I am telling her separately that this half is settled, that the screen-hooks rule is not Model A, and that the Rom role file now comes from my side. Her architecture review of the three giant files and your "brief must name the ground" item are untouched by this ruling.

**Where the other drafts are.** Rom role file: `.claude/roles/worf/drafts/role-files-2026-09-03/rom-ROLE.md`. Nog and Bashir role-file patches: the same folder (they run headless and never read an inbox, so Philipp applies those). CLAUDE.md backstop: a one-page before/after patch at `.claude/roles/worf/drafts/contracts-2026-09-03/CLAUDE-md-patch.md` (the "Your role file" row moves to `.claude/roles/rom/ROLE.md`, the dead pointers, and three backstop lines about tests). Ruling record: `.claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md`.

**Run counts, so your briefs match them.**

| Who | Own new test file | Full safety-net suite | Full browser suite |
|---|---|---|---|
| Rom | as often as he likes | once, before commit | never |
| Julian, while writing | his own new browser test file, as often as he likes | never | never |
| Julian's stage machinery, when he signals done | - | once, on dev | once, on dev |
| Promote button (`promote.yml`) | - | once | once |

The safety-net run on every dev push in `ci.yml` is a warning light, not a counted run. Which run counts: Julian's stage run decides whether the slice may merge; the Promote button's run is a last check that dev still passes at that moment, not a second decision.

**Who moves tests.** Rom moves his own safety-net tests and lists every move under `## Tests moved or weakened`. Julian moves browser tests only and never edits a safety-net test. Nog is the second signature on any moved or weakened test because he authors nothing: the second signature on a moved or weakened test comes from whoever is not doing the moving.

**Julian's stage is measured before it is fixed.** No duration, retry count or size number goes into a contract until the stage has run ten times. Slice 4's last criterion is what makes that measurement possible.

**Numbers you may see quoted.** Slice 372 ran 42 minutes and ended DONE. Slice 370 has no clean number: it ended in ERROR after a re-dispatch loop of four COMMISSIONED events in 20 seconds at 01:01 on 09-03. That loop looks like a bug on its own (possibly what 372 part 2 targets); worth a look when you next touch dispatch.

**Staged bodies to reword before approval.** S363 and S356-S359 are still unapproved in `bridge/staged/` and all carry "Guard tests, AC-tagged". So does 370. Please reword them under section 1 before Philipp sees them, and add the fixed block.

---

## What NOT to worry about

- **CI workflow changes.** Mine. `promote.yml` already runs both suites once at the Promote button and needs no change. `ci.yml`'s browser job is off on dev pushes on purpose (about 30 minutes per push on a GitHub runner, and it would not show in Ops). Julian's stage will run the browser suite on dev locally, so I am leaving `ci.yml` as it is. If Philipp wants a GitHub-side early warning before Slice 4 lands, that is one line in `ci.yml` and I will flip it; tell me, do not write a slice for it.
- **The contract patch document, the CLAUDE.md patch (`.claude/roles/worf/drafts/contracts-2026-09-03/CLAUDE-md-patch.md`), the Rom, Nog and Bashir role-file drafts, the ruling record, the note to Dax, and the ten-run measurement.** All mine. Nog and Bashir get no inbox handoff; Philipp applies their drafts.
- **Unlocking and locking `docs/contracts/`.** Mine and Philipp's. Never commission a slice to edit that folder.
- **Rom's `CLAUDE.md` fixes.** Layer-2 locked, in the patch file above, Philipp applies. Do not wait on it; the brief rule in section 1 and Slice 3 are the real fix.
- **Model A.** Parked. Nothing here reopens it.

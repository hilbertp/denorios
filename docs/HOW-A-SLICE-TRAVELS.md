# How a slice travels

*From Alex's brief to main, step by step. Written 2026-09-03 by Worf for Philipp. Describes the process as it runs today; the parts the 3 September test-ownership ruling changes are marked, including what is not built yet.*

---

## Who's who

The dashboard shows first names and job titles in light mode and the DS9 crew in the LCARS skin. Both name the same people.

| Light mode | LCARS | Job | What they touch in this flow |
|---|---|---|---|
| **Alex** | O'Brien | Dev Lead | Writes every slice. Never writes code or tests. Receives escalations and fix requests. |
| **Sam** | Rom | Full-Stack Engineer | Builds the slice on its own branch. Writes the safety-net tests for his own change. Writes the DONE report. |
| **Jordan** | Nog | Reviewer | Reads the code and the report, issues a verdict. Writes nothing. The one signature that comes from a non-author. |
| **Julian** | Bashir | QA Engineer | Owns the tests and the DevOps Station panel. Browser tests are his. (The light-mode crew list currently labels him "Priya"; every overlay message and every contract says Julian. Same person.) |
| **Chris** | Worf | DevOps / Release Engineer | Owns how code moves: branches, the gate, the promotion, the locks. |
| **Taylor** | Dax | Architect | Architecture decisions. Not in the day-to-day flow. |
| **Philipp** | — | The human | Approves slices, answers flagged criteria, presses the merge button, rules on anything unclear. The only person who may change an acceptance criterion. |

Morgan (Sisko, product), Riley (Ziyal, UX) and Robin (Leeta, design) work upstream of this flow and are not in it.

**Two lines of code.** *dev* is the shared line everyone builds on; every accepted slice lands there. *main* is the released line; it only moves when Philipp presses the merge button and everything is green, and only forward to a commit that was tested.

---

## The journey

A slice is one ticket. It is one file whose name changes as it moves: `371-STAGED.md`, then `-QUEUED`, `-IN_PROGRESS`, `-DONE`, `-IN_REVIEW`, `-ACCEPTED`, and finally `-ARCHIVED`. Each step below says who acts, whether it starts by itself or needs Philipp, what you see in Ops, and where it goes if it fails.

### 1. Alex cuts a slice

**Who:** Alex. **Starts:** by hand, when there is work to sequence. **Ticket:** `371-STAGED.md` in the staged list.

Alex writes the brief through the slice tool, never by hand. A brief carries: the goal in one sentence; context; scope and what is out of scope; numbered tasks; the trap list (the ways this change is likely to go wrong); the acceptance criteria, each with its own tag (`slice-371-ac-1`); a quality and goal check; and the files expected to change.

*Since the 3 September ruling:* a brief never asks Sam to "write guard tests" or "verify in a real browser". It says, once, "write one safety-net test per acceptance criterion, plus one for each trap, then stop." When a criterion touches the screen, the brief has a **Screen hooks** section naming the buttons, rows and fields a browser test will click, or the words "Sam to declare". Every brief carries a fixed "What Rom does not do" block, and the slice tool will refuse a brief without it once Slice 3 lands.

**In Ops:** the staged list. You can reorder it by dragging.

**If it goes wrong:** Alex rewrites and restages. Nothing has run yet.

### 2. Philipp approves

**Who:** Philipp. **Starts:** you press Approve. **Ticket:** `371-QUEUED.md`.

This is the first of the human touchpoints. From here to the end of review, everything runs by itself.

### 3. Sam builds

**Who:** Sam. **Starts:** automatically; the orchestrator picks the next queued slice. **Ticket:** `371-IN_PROGRESS.md`.

The orchestrator makes Sam a fresh copy of the code on a branch of his own, cut from dev, and hands him the brief with a short report template glued to the end. That is all he receives today; no role file reaches him yet (Slice 3 changes that). He builds the product change and writes the safety-net tests: one per criterion plus one per trap, then stops. He may run his own new test file as often as he likes and the full safety-net suite once before he commits. He never runs the browser suite and never writes a browser test; if he needs to look, he opens a browser and says what he saw in his report.

Before committing he breaks his own fix on purpose, runs his new tests, confirms they go red, and puts the fix back. He commits with the criteria declared as trailers and writes the DONE report under fixed headings: summary, what changed, criteria verification, safety-net tests (with which went red), screen hooks, tests moved or weakened, commit.

**In Ops:** Sam's crew tile shows him active. The slice is not in History yet.

**If it goes wrong:** a crash or timeout files an ERROR the panel shows. A report that says PARTIAL or BLOCKED goes to Alex. One known defect: a rule that treats "one commit plus a long report" as faked work has thrown away honest slices (366 and 371). Slice 1 in Alex's handoff replaces it with "did the commit change a real file". Until then, a re-queue is by hand.

### 4. Jordan reviews

**Who:** Jordan. **Starts:** automatically when the DONE report lands. **Ticket:** `371-IN_REVIEW.md`, then `-ACCEPTED.md` or back to `-QUEUED.md`.

Jordan reads the brief, the report and the actual code changes. He checks three things in order. First, is every criterion observably met, and does every promised screen hook exist on the finished screen. Then, if the change weakened, removed or skipped a test, is there a declared reason for it (a commit trailer), and is that reason a real spec change rather than "the test was failing". Then code quality, and, since the ruling, test honesty: the tags are present; each test checks the criterion, not the shape of the code; nothing pins dead code; the report shows which tests went red when the fix was removed; the count is one per criterion plus the traps, and extras are a flag for Alex, not a rejection.

He never rejects Sam for a missing browser test or for not checking in a browser; those are Julian's. He writes no tests, on purpose, so he stays the one signature on a weakened test that comes from someone who authored nothing.

Verdicts: ACCEPTED; REJECTED with specific findings, back to Sam, up to five rounds; ESCALATE when the criteria themselves cannot be met, to Alex; OVERSIZED, split it first. A sixth rejection sends the slice back to Alex to restage. Every round is appended to the ticket; nothing is deleted.

**In Ops:** the Peer Review panel; Jordan's tile.

### 5. It lands on dev, and History shows it

**Who:** the orchestrator. **Starts:** automatically on ACCEPTED.

The branch is folded into dev as a single commit carrying the criteria tags. GitHub runs the safety-net suite on that push as an early warning; the browser suite does not run on dev pushes. The ticket is filed away. Today that filing keeps only Sam's report and bins the brief and Jordan's review; Slice 4 fixes that so the whole ticket survives.

**In Ops:** a row appears in **History** for the commit. Its pill reads *reviewing* while Jordan is still on it, *accepted* once he is done, and shows when the commit has reached main. Above History, the **Merge Pressure** pill (low, rising, moderate, high) says how much unvalidated change is piling up on dev. It is a measure of how urgent the next validation is, not of how risky the code is. The rollback button exists (a revert carried forward through the same gate) but is dormant until the register carries clean squash commits.

**If it goes wrong:** the fold itself has failed before on a phantom conflict (348/349), fixed since. The safety-net run on GitHub going red is a warning, not a stop.

### 6. Julian's stage — coming, not built yet

**Who:** Julian. **Starts:** automatically when a slice lands on dev. **Ticket:** `371-IN_QA.md`.

This is the step the ruling adds between landing on dev and the gate. It does not exist in code until Slices 3 and 4 in Alex's handoff land; the contracts describe it now so the slices have something to build to.

When built: a script first undoes Sam's change in a scratch copy and runs his new tests; any test that stays green is hollow and is named, not deleted. Julian then receives an information packet, never the code: the whole ticket (brief, report, verdict), the list of changed file names, the screen hooks with when each is visible, the tests Sam moved, the address of the running product on dev, and the break-it result. He writes the browser tests for every criterion that touches the screen. When he says he is done, the stage runs both suites once. Green: ready to merge. Red has exactly two exits: a bug, which writes a fix request into Alex's inbox; or an unclear criterion, which shows "slice N is waiting for Philipp" in Ops until you answer. Never back to Jordan, never Julian editing code.

**In Ops (when built):** "Julian is writing browser tests for slice N". The merge button refuses while any slice is red here or waiting for you.

### 7. Pipeline A — CHECK FOR TEST UPDATES

**Who:** Julian's panel; Philipp decides. **Starts:** you press CHECK FOR TEST UPDATES in the DevOps Station.

Three steps: *scan ACs*, *reconcile*, *resolve*. It gathers every acceptance criterion on the commits ahead of main, reconciles each against the test suites (covered, stale, or missing), and applies the Test-Update Gate: did any check get loosened, removed or skipped without a declared reason, and did new behaviour ship with no test? The verdict is one of CLEAR, NEEDS REVIEW, OVERRIDDEN (a declared, scoped reason covers it), or RED FLAG.

Confident cases are handled by themselves. For each criterion it is not sure about it asks you: keep as is ("No test needed for this AC"), or press CHECK again to have Julian draft the missing test. Today that draft lands in a drafts folder for a human to apply; the one-click "apply" and "author" actions are staged, not built. A RED FLAG defaults to STOP; going on anyway needs a second acknowledgement from someone who did not write the change, which is Jordan.

Passing Pipeline A unlocks Pipeline B for the current tip of dev; the panel says "pass Pipeline A" until then.

*Since the ruling:* a *missing* flag now means a fix slice for Sam, on Alex's desk, not a test for Julian to write. And nobody edits a criterion to make a red go green; only Philipp may change one.

**If it goes wrong:** a false RED FLAG on an honest rename has happened twice; renamed checks are now paired instead of read as removed. The 81-file dead test folder is excluded from this check and is scheduled for deletion.

### 8. Pipeline B — RUN GATE & MERGE TO MAIN

**Who:** Philipp presses; GitHub runs it. **Starts:** you press RUN GATE & MERGE TO MAIN.

The button dispatches the promotion workflow on GitHub. On a clean runner, against the exact tip of dev, it runs the Test-Update Gate strictly, then the safety-net suite, then the browser suite. All green: it moves main forward to that exact tested commit. Nothing is ever force-pushed or rewritten. Anything red: main does not move, the failing suite's report is routed to Alex's inbox, and the fix goes forward on dev as a new commit.

**In Ops:** the pipeline strip shows each phase with status and duration; the Coverage panel shows the newest run; History marks the commits that reached main.

Then the ticket is `371-ARCHIVED.md`, read-only history.

---

## Where Philipp is needed

Everything else runs by itself.

1. **Approve** a staged slice (step 2).
2. **Decide** on each flagged criterion in CHECK FOR TEST UPDATES (step 7).
3. **Press** RUN GATE & MERGE TO MAIN (step 8), reading the merge-pressure pill first.
4. **Rule** on escalations: criteria that cannot be met (from Jordan, via Alex), and, once Julian's stage exists, criteria Julian cannot test as written.
5. **Change** an acceptance criterion. Nobody else may, and never to make a red go green.

---

## What the 3 September ruling changed, and what is not built

Decided and live in the contracts and role files: Sam writes the safety-net tests for his own change and proves them by breaking his fix; Jordan writes nothing, on purpose; Julian writes the browser tests, at his own stage, from information and never from code; the screen-hooks rule; the two exits; the run-count rule (Sam once, Julian's stage once, the merge button once).

Not built yet, in Alex's hands as six slices, in order: fix the fake-work rule and re-queue 371; give every fresh copy of the code its tools; put Sam's and Jordan's instructions where they actually read them, including the brief check; Julian's stage; the actions that let Julian's drafts land without a human copying files; delete the dead test folder after Julian's bounded look.

---

## Where the truth lives

- The business rules: `docs/contracts/slice-lifecycle.md`. When code disagrees with it, the code is wrong.
- How it is done on disk: `docs/contracts/slice-pipeline.md`.
- What a brief and a report must contain: `docs/contracts/slice-format.md`, `docs/contracts/done-report-format.md`.
- Who owns acceptance criteria and tests: `docs/contracts/ac-custody.md`, `docs/contracts/test-update-gate-trailers.md`.
- Each role's charter: `.claude/roles/<role>/ROLE.md`.
- The ruling itself, with Philipp's words verbatim: `.claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md`.

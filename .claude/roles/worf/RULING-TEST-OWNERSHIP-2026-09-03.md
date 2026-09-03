# Ruling: who writes which tests, and how a slice gets to merge

**From:** Worf (DevOps / release)
**Date:** 2026-09-03
**Status:** RULED. Philipp confirmed it on 2026-09-03. Contract wording is drafted by Worf and applied by Philipp. Code changes go to O'Brien as slice requests.

**Words used here.** "Safety-net tests" are the quick tests that check the code's logic; Rom writes them. "Browser tests" are the tests that drive the real screen the way a person would; Julian writes them. "Julian's stage" is the new step after a slice lands on dev. "Dev" is the shared line everyone builds on; "main" is the released line. "Screen hooks" are the fixed names of the buttons, rows and fields on screen that a browser test clicks or reads. "The code changes" means the line-by-line record of what Rom changed. It is named that way once here; after that it is only "the code changes". A "commit" is one saved bundle of changes.

---

## 1. Decision

Rom writes the safety-net tests for his own change: one per acceptance criterion, plus one for each trap in the brief, then he stops. He never writes or hands in a browser test. Nog stays read-only and writes nothing; that is a deliberate choice, not a gap. Julian writes the browser tests after the slice lands on dev. That is a visible stage, one slice at a time. He receives information about the slice, never the code. O'Brien's briefs stop asking Rom for "guard tests" or to "verify in a real browser". O'Brien is told in plain words what he must never ask of Rom. Every acceptance criterion that touches the screen gets its screen hooks written down. Rom proves his own tests are real by undoing his fix and watching them go red; a script at Julian's stage repeats that check by machine. When Julian's stage is red there are exactly two exits: a bug goes to O'Brien for a fix slice; an unclear criterion goes to Philipp. The order of the pipeline does not change: Rom builds, Nog reviews visibly, the slice lands on dev, Julian writes the browser tests, merge on green. Model A stays parked.

---

## 2. What we deliberately did not do: Nog as test author

We considered letting Nog write the tests. We said no. Reasons, in order of weight:

1. **He would share Rom's blind spots.** Nog reads the code first. Tests written after reading the code test the code's shape, not the criterion. That is the failure we are trying to remove.
2. **It breaks his role.** Nog is the one signature on a moved or weakened test that comes from someone who did not write anything. If he authors tests, there is no non-author left to sign.
3. **It moves time, it does not remove it.** About eight minutes of test-writing would move from Rom to Nog. Worse, a fix that takes Rom thirty seconds in his own copy of the code becomes a full round trip through Nog.
4. **It costs two charters and a new pipeline state.** Rom's instructions and Nog's role file would both need rewriting, and the pipeline would need a state for "Nog writing". None of that buys anything the ruling above does not already buy.

This is written down so nobody later reads "Nog writes no tests" as something we forgot to decide. Philipp's word on it: "confirmed".

---

## 3. Screen hooks: what we borrowed from the parked Model A, and why this is not Model A

Dax's parked proposal (her "Contract Surface" idea) said: name the stable screen elements up front so tests can rely on them. We took the light version of that idea and nothing else.

**What a screen hook is.** A fixed name attached to a button, row or field on the screen, so a test can find it by that name even when the layout changes. The existing browser tests already find things this way. We are not asking for a new naming system; we are asking that the names be written down. Each hook also gets one line on when the thing is visible ("visible when ..."). A test has to get the screen into that state before it can click anything.

**What we took.** When any criterion in a brief touches the screen, the brief has a "Screen hooks" section. Each line is either a name O'Brien already knows or the words "Rom to declare". The "visible when" line is written by O'Brien if he knows it, otherwise by Rom in his report. Rom lists every hook he built or relied on in his report. Nog checks that the named things exist on the finished screen. Julian uses them. Nothing in that section is a design written before the code; it is a list of names Rom must report.

**Until the new sections exist.** If a slice reaches Julian with no Screen hooks section, he finds the names himself on the running product's screen. The browser's own inspector counts as information, not as code. He writes down the names he used in his result. A screen-touching criterion whose hook cannot be found on the finished screen is a bug exit: the work is incomplete.

**Why this is not Model A.** In Model A something is written before the code exists and the order of work changes. Here nothing is written before the code exists, nobody's turn moves, and the sequence Philipp ratified on 2026-09-01 stays exactly as it was. Model A stays parked. Philipp's word on the screen-hooks rule: "i dont understand, i trust you to make the right decision". Worf decided yes.

---

## 4. Who does what now

| Who | Does | Never does |
|---|---|---|
| **Rom** | Builds the change in his own fresh copy of the code. Writes one safety-net test per acceptance criterion plus one per trap, then stops. Proves they are real: he puts his fix aside, runs his new tests, and confirms every one goes red. Then he puts the fix back and lists in his report which tests went red. May open a browser to check his own work and says what he saw in his report. His report lists the screen hooks he built and any existing test his change moved or weakened. Moves his own safety-net tests when his change requires it and lists every move. Fixtures and helpers in the browser-test folder that his product change genuinely needs are allowed, listed in his report with one line on why. | Never writes or hands in a browser test. Never runs the browser suite. One test per criterion plus the traps is the target. Extra tests are flagged to O'Brien by Nog, not rejected, unless they hide which test covers the criterion. (13 tests for 5 criteria on 371 was that kind of bloat.) |
| **Nog** | Reviews read-only against a concrete checklist. The criterion tags are present. Each test checks the criterion, not the shape of the code. No test protects code that is no longer used. The report lists which tests went red when the fix was removed; a report that only says green is rejected. One test per criterion plus the traps is the target; extras are a flag for O'Brien, a rejection only if they hide which test covers the criterion. Every promised screen hook exists on the finished screen. He is the second signature on any moved or weakened test, because he authors nothing. | Never writes code or tests of any kind (deliberate). Never rejects Rom for a missing browser test or for not verifying in a browser; those are Julian's. |
| **Julian** | After the slice lands on dev, as a visible stage, one slice at a time. Reads the packet in section 5. Writes or moves the browser tests; while writing he runs his own new test file as often as he likes. When he says he is done, the stage machinery (not Julian) runs the full safety-net suite once and the full browser suite once on dev. It records the verdict. Red has two exits: bug to O'Brien, unclear criterion to Philipp. Owns moves and weakenings of browser tests only. Owns the bounded look at the old test folder before it is deleted. | Never reads the code changes or the product code itself. Never edits product code. Never edits a safety-net test; Rom moves his own. Never edits a criterion or weakens a browser test to go green. Never sends a slice back for a Nog round. Never runs the full suites himself. |
| **O'Brien** | Writes the brief with goal, tasks, traps, tagged acceptance criteria, and a Screen hooks section when a criterion touches the screen. Every brief carries the fixed "What Rom does not do" block. Writes fix slices when Julian's stage finds a bug. Writes the six plumbing slices Worf requests. | Never writes the forbidden phrases: "write guard tests", "guard tests, AC-tagged", "verify in a real browser", "write a browser test", "add a browser test", "run the browser suite". Never asks Rom for the break-it check as a task; the report template already requires Rom to report it. The list lives in his role file and is enforced by the tool he files slices with. |
| **Philipp** | Applies the contract wording (Worf drafts it). Applies the role-file drafts for Nog and Julian, who run unattended and read no inbox. Answers unclear criteria that come out of Julian's stage. Approves the staged slices once they are reworded. | Is not a role and has no inbox; drafts for him sit in Worf's drafts folder, dated today. |

The one-sentence rule that ties Nog's row together, to go into the contract as written: *the second signature on a moved or weakened test comes from whoever is not doing the moving.*

**Who runs which suite, and which run counts.**

| Who | Own new test file | Full safety-net suite | Full browser suite |
|---|---|---|---|
| Rom, while working | as often as he likes | once, before he hands in | never |
| Julian, while writing | as often as he likes | never (the stage runs it) | never (the stage runs it) |
| Julian's stage machinery, when he says he is done | | once, on dev | once, on dev |
| Promote button | | once | once |

The automatic safety-net run that already happens on GitHub after every change to dev is a warning light, not a counted run. Julian's stage run decides whether the slice may merge. The Promote button's run is a last check that dev still passes at that moment, not a second decision. If it goes red, the merge stops and O'Brien writes a fix slice.

---

## 5. What Julian sees, what he never sees, and how the sticker travels

Philipp's instruction today, in full: "you need to make this make sense. a QA engineer need information. give him what he needs! i guess he doesnt need code, correect but he needs the ACs and the slices in full maybe. should we have the slices travel with the work like a kanban style paper sticker?"

Yes. One slice, one sticker, travelling with the work, assembled by the pipeline and not by a human copying files.

**Julian receives, every time:**

1. The whole slice file: O'Brien's brief with goal, tasks, traps, and the tagged acceptance criteria as O'Brien wrote them (not Rom's retyped copy).
2. Rom's DONE report.
3. Nog's verdict and review.
4. The list of files that changed: names only, never the contents.
5. The screen hooks, each with its starting state in plain words ("visible when ...").
6. The tests Rom says his change moved.
7. The address of the live dashboard on dev, for looking at the product.
8. The result of the break-it check (which of Rom's new tests went red, which stayed green).

**Julian never receives:** the code changes, or the product code itself.

**How that is enforced, not promised.** Julian is never handed the code changes and never told to open a product file; his instructions contain none of it. The only things he may write are browser tests and the sticker. If he would need to read the product code to understand a criterion, that criterion is unclear and he asks. Reading the product code is not a workaround. The existing browser tests and their shared practice data are Julian's own files (test code, not product code); he reads and extends them. His browser tests run against the practice copy of the product that the browser suite starts for itself. They do not run against the live dashboard; its address is for looking.

**Hollow tests.** A safety-net test that stays green with the fix undone is hollow: it is named in the stage's result and does not count as evidence for its criterion. It is not deleted at the stage; nobody at Julian's stage may edit a safety-net test. A criterion whose only safety-net test is hollow is a bug exit: O'Brien writes a fix slice in which Rom replaces the test.

**The two exits when red, and where they land.**

- **Bug.** The stage writes one handoff per slice into O'Brien's inbox naming the criterion, the failing test and an excerpt of the failure. A later green run does not delete it; O'Brien removes it when the fix slice is queued. The fix slice names the red slice. When the fix slice passes Julian's stage, its result is written on the red ticket too, and the red ticket turns green. Today the pipeline understands only safety-net results. It writes one single file that the next red overwrites and the next green deletes. The stage must understand browser results too and write one handoff per slice.
- **Unclear criterion.** Julian writes his question on the sticker, and the stage puts a waiting-for-Philipp line in the Ops panel next to Julian's stage: "slice N is waiting for Philipp". Philipp writes his answer in the waiting file, or in the Ops box that writes the same. The pipeline sees it, puts question and answer on the sticker, clears the line, and runs the stage again.
- **Never:** a Nog round, Julian editing product code, Julian editing a safety-net test, editing a criterion, weakening a browser test to go green. While he is still writing, Julian may fix his own browser test as often as he likes, re-running only that file. Once he has declared red, there are only the two exits.

**The sticker on day one, honestly.** Today the slice is three pieces of paper during review: O'Brien's brief with every Nog round added to it, Rom's report, and Nog's verdict. When the slice is filed after landing on dev, the brief and the verdict go to the bin and only Rom's report survives. And none of the three ways Julian is started today hands him the packet. One gives him only the criteria block; one actually tells him to go and read the code. So the stage slice must gather the packet before filing runs, or from the bin copies if filing already happened. It must also make the file that survives filing the whole sticker. One-slice-at-a-time already exists: the pipeline already holds later slices back while a stage is running.

**Names and buttons.** In the pipeline the stage is called IN_QA; a red slice stays there (the slice is already on dev) while O'Brien writes a fix slice or Philipp rules. The Ops panel reads "Julian is writing browser tests for slice N" while it runs. Today the Ops merge button is what starts Julian's gate, and the Promote button on GitHub runs both suites and moves main forward to match dev. After the stage lands, the stage starts by itself when a slice lands on dev, and the merge button only promotes. The Promote button refuses while any slice on dev is red at Julian's stage or waiting for Philipp. The filing-away of a finished slice waits until Julian's stage is green; today it happens the moment the slice lands, which would bin the sticker before the stage could use it. One more thing the stage must do. The pipeline's own safety lock refuses saves to dev unless the pipeline itself is saving. The stage must give Julian that permission when he saves his browser tests. A refused save is a stage failure shown in Ops, not a red with two exits.

---

## 6. How Rom's instructions reach him

Philipp's framing: "we should also tell obrien what not to ask of rom. we dont know who rom would listen to, his role description or the explicit and false instructions from obrien."

We know the answer from slice 371: the brief won. Rom skipped the first standing instruction he was given. He did exactly what the brief's task and trap said, and produced six browser tests he was never meant to write. So the rules are placed in three layers, strongest first:

1. **O'Brien's side, before the brief exists.**
   - The never-ask list in O'Brien's role file and memory.
   - The fixed "What Rom does not do" block in every brief.
   - A check in the tool O'Brien files slices with. It refuses a brief that tells Rom to write guard tests, verify in a real browser, write or add a browser test, or run the browser suite. It does not refuse a brief that only talks about browser tests because the job is the machinery around them. It is skipped when the slice is for Julian. It also requires the block word for word. Test cases: the 371 brief is refused; the reworded browser-stage brief and the plumbing briefs themselves are accepted.
2. **The report template Rom receives at the start of every run.** This is the one piece of text Rom is guaranteed to see, first round and every rework round. It gains the fixed report headings:
   - Summary
   - What changed
   - Acceptance criteria verification
   - Safety-net tests
   - Screen hooks
   - Tests moved or weakened
   - Commit

   "Conflicts with the brief" is optional. What he saw in the browser is a line under "Safety-net tests". The template also carries a short "What Rom does not do" list. A missing heading is a Nog finding, never an automatic failure. The automatic failure path stays only for the five metrics.
3. **A Rom role file.** Today there is none, and a role file alone would reach nobody: nothing hands it to Rom. It only works once Slice 3 makes the pipeline paste it above the brief on every run, first round and rework rounds. A test proves the role text sits above the brief. The file says honestly that a brief has overridden it once and that briefs are now checked. If it happens again, Rom follows the file and notes it under "Conflicts with the brief". The project's standing-instructions file is a backstop only. Its "your role file" line must point at Rom's file; that one-page patch goes through Philipp because the file is locked.

---

## 7. The plumbing list, in order, with owner

Worf owns the list. Worf cannot edit the pipeline, templates, or role files (product code and docs content). So every code item below is a slice request from Worf to O'Brien, built by Rom, in this order. Every Rom-built brief among them carries the "What Rom does not do" block. Slices 2, 4 and 5 say explicitly that Rom may touch the browser-test machinery for that slice, because that machinery is the job.

| # | What | Owner | Notes |
|---|---|---|---|
| Slice 1 | **Fix the rule that filed 371 and 366 as fake work, then re-queue 371.** Today the pipeline calls a slice fake when Rom made one commit and wrote a long report, without looking at what the commit changed. New rule: no commit at all fails; otherwise at least one real file, not just the report and bookkeeping, must have changed. Rom's own count of his report's length stops being evidence. The new failure gets its own name, and the error message that says "no commits" next to "1 commit" is fixed. | O'Brien writes; Rom builds | Re-queue 371 only after this lands, or it trips the same rule again. Rom's work on 371 still exists; the browser test he wrote on it is now Julian's to keep, rewrite or drop, not a reason to reject Rom. |
| Slice 2 | **Every fresh copy of the code comes ready to run both suites.** Today a fresh copy has none of the tools installed, so on 371 Rom wired them in by hand and had to undo it before handing in. The browser program is already on the machine; only the installed tools are missing. Nog's copy too. | O'Brien writes; Rom builds | Julian's stage does not wait on this; it runs in the main copy, which already has its tools. |
| Slice 3 | **Rom's and Nog's instructions.** The report template Rom actually receives gains the fixed headings and a short "What Rom does not do" list (the same rules as the block every brief carries). The second, unused report template that disagrees with it is deleted or made identical. The pipeline pastes the Rom role file above the brief on every run. The instruction Nog receives at run time ("review for test coverage") becomes the checklist in section 4. That includes "never reject for a missing browser test" and the second-signature sentence. His "read only, do not modify any code" line stays word for word. The slice-filing tool gets the brief check from section 6. O'Brien settles whether Rom's tests must carry the coverage tracker's tag line; if so, the template shows the exact line. | O'Brien writes; Rom builds | This is what makes layers 2 and 3 in section 6 real. |
| Slice 4 | **Julian's visible stage**, the staged browser-stage slice reframed from a per-criterion pop-up in the dashboard to one visible step per slice. It assembles the packet from section 5 (from the bin copies on day one) and makes the surviving file the whole sticker. It moves the filing-away to after Julian's stage is green. It runs the break-it check by machine and writes the result. It lets Julian write, then runs both suites once on dev. It understands browser results and writes one bug handoff per slice. It puts the waiting-for-Philipp line in Ops and watches for the answer. It links a fix slice back to the red ticket, and blocks the Promote button while any slice is red or waiting. It gives Julian permission to save on dev. It starts by itself when a slice lands and uses the IN_QA name. The first ten runs are measured. O'Brien may split it into three slices; it counts as live after the third. | O'Brien rewords the staged brief; Rom builds | The staged brief still says "Guard tests, AC-tagged". It must be reworded before Philipp approves it. |
| Slice 5 | **The draft-landing chain** (the four staged slices that let Julian's tests land without a human copying files), reworded. | O'Brien rewords; Rom builds | Keep the draft-contract and the agent-boundary slices as written. Key the read and apply slices to a slice's batch of drafts, not one criterion at a time. The agent may write only in the drafts folder and the browser-test folder. Check the slice they depend on has landed. |
| Slice 6 | **Delete the old test folder that nothing runs** (81 files). First a bounded look by Julian at the merge cases the coverage ledger says only that folder covers; then a deletion slice. Not "port". | Julian owns the look (a slice addressed to him); O'Brien writes the deletion slice | The ledger already shows the two merge criteria have live safety-net tests, so the look is about confirming what is genuinely uncovered. Trap for the deletion slice: nothing outside that folder and the coverage ledger changes, so the merge gate's count does not drop by surprise. Philipp's word: "yes confirmed". |

File names and line numbers for each item are in the handoff to O'Brien.

**Paperwork that is not a slice.**

| What | Route |
|---|---|
| Contract wording | One quote-and-replace patch document: each change quotes the current text and the replacement, so Philipp can apply them by hand. Not full replacement files. In Worf's drafts folder, dated today. |
| The standing-instructions backstop for Rom | A one-page before/after patch next to the contract patch document. Philipp applies; that file is locked. |
| Rom's role file | A draft in Worf's role-files drafts folder. Philipp puts it in place together with the standing-instructions patch; the pipeline starts handing it to Rom with Slice 3. |
| Nog's and Julian's role files | Drafts in the same role-files folder. Philipp applies them; Nog and Julian run unattended and never read an inbox, so a handoff to them would deliver nothing. No Nog inbox is created. |
| O'Brien's role file and memory | A handoff into his inbox with the exact replacement text (the never-ask list, the replacement task sentence "Write one safety-net test per acceptance criterion, plus one for each trap, then stop.", the Screen hooks and Traps sections, the line pointing at his own brief template, and "Success criteria" changed to "Acceptance criteria"). He is also asked to write his real brief template into a file, without the forbidden phrases, so their removal is a visible change and not a promise. |
| Dax | One short handoff into her inbox; see section 9. |

---

## 8. Open measurements

- **Julian's stage: first ten runs.** No number (minutes, tokens, tests per slice) goes into any contract until Julian's stage has run ten times and we have looked at the results. The stage is built to be measured, not to hit a target.
- **Rom's run times.** Slice 372 ran 42 minutes and ended DONE. Slice 370 has no clean number: it ended in an error after being started four times in twenty seconds. That looks like a bug on its own; worth a line to O'Brien. Some of Rom's time is known waste: on 371 he spent calls wiring in the missing tools and ran tests seventeen times. Slices 1 and 2 remove that waste. Measure again after they land before judging Rom's speed. This is a separate question from test ownership.

---

## 9. Dax's involvement

Philipp asked: "do we really need dax? this is devops not architecture." Answer: not for this wording. Every place the ruling binds is a role file, the standing instructions, a contract Philipp applies, or a slice O'Brien writes. Worf drafts the contract wording; Philipp applies it. There is nothing for Dax to draft.

Dax holds a separate handoff from O'Brien. Its architecture half (splitting the three giant files) and its "brief must name the ground" item are untouched by this ruling and stay hers. Its test-ownership half is now settled (Worf drafted, Philipp applies), so she can stand down on that. The Rom role file now comes from Worf's side as part of the instructions slice, so she can strike "no Rom role file" from her list. The screen-hooks rule is a light version of her Contract Surface idea but is not Model A: nothing is written before the code exists and the order is unchanged. Model A stays parked. She gets one short handoff saying exactly that.

---

## 10. Philipp's confirmations, 2026-09-03, verbatim

1. On the deliberate no to Nog writing tests: "confirmed"
2. On what Julian receives: "you need to make this make sense. a QA engineer need information. give him what he needs! i guess he doesnt need code, correect but he needs the ACs and the slices in full maybe. should we have the slices travel with the work like a kanban style paper sticker?"
3. On the screen-hooks rule: "i dont understand, i trust you to make the right decision" (Worf decided yes.)
4. On deleting the dead tests after a bounded look: "yes confirmed"

His two framing points the same day:

- "we should also tell obrien what not to ask of rom. we dont know who rom would listen to, his role description or the explicit and false instructions from obrien."
- "do we really need dax? this is devops not architecture."

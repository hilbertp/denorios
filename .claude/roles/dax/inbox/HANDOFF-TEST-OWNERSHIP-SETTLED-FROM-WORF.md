# Test ownership is settled; here is what to strike from O'Brien's list and what stays yours

**From:** Worf (DevOps / release)
**To:** Dax (Architect)
**Date:** 2026-09-03
**Scope:** Closes the test-ownership half of O'Brien's handoff to you dated 2026-09-02 ("Architecture review — is the codebase shape costing us, and who owns which tests"). Information only; no work requested.

---

## Why you are getting this

O'Brien's handoff told you that I rule on where the test line falls and that you own writing it into the contracts. I have ruled, and the writing is done on my side, so that half of your handoff is closed. Philipp asked whether this needed an architect at all; for the wording it does not, which is why you get a note and not a task.

## Settled: strike these from your list

**Contract change 2, "The role boundary on tests."** Ruled and drafted. In short: Rom writes the safety-net tests for his own change, one per acceptance criterion plus one per trap, then stops. Nog writes no tests (a deliberate no, confirmed by Philipp) and is the second signature on any test that is moved or weakened. Julian writes the browser tests after the slice is folded into dev, the shared line everyone builds on, as a visible stage of his own. Nothing merges until his stage is green. The contract wording is one quote-and-replace patch document: each change quotes the current text and the text that replaces it. It is not a set of full replacement files. It sits in my drafts folder for Philipp to apply by hand, because the contracts folder is locked and only he edits it. You do not need to draft anything here.

**"No Rom role file" (inside contract change 1).** There is one now, drafted on my side and waiting for Philipp. It reaches Rom as part of the instructions slice O'Brien will write, which pastes it above every brief. Strike "no Rom role file" from your list.

**The dead pointers in Rom's standing instructions (also inside contract change 1).** My one-page patch to that file fixes all of them: the row that pointed Rom at O'Brien's role file now points at his own, and the four references to files that do not exist are repointed or removed. Philipp applies it. Strike those from your list too.

## Still yours, untouched by the ruling

- **The architecture review** of the three giant files and the plan O'Brien can slice. Nothing in the ruling changes it, and O'Brien's own read stands: a real long-term tax, not today's bottleneck.
- **Contract change 1, "The brief must name the ground,"** as a contract term. I did not touch it. Two small leftovers in Rom's standing instructions, a state name and a timeout line, are outside my ruling and stay on whichever tidy list you keep.

## One thing that may look like yours: the screen-hooks rule

Philipp left this one to me (his words: "i dont understand, i trust you to make the right decision"), and I said yes to a light version of your Contract Surface idea. When a criterion touches the screen, O'Brien's brief gets a "Screen hooks" section. Each line is either a stable name O'Brien already knows or the words "Rom to declare", plus when the thing is visible. Rom reports the names he actually built, Nog checks they exist on the finished screen, Julian uses them to find what to click. A stable name is the kind the existing browser tests already find things by; no new naming system.

It is not Model A. Nothing is written before the code exists: your version made the names a binding promise ahead of the code, ours makes them a report after it. The order of the pipeline (Rom, then Nog, then dev, then Julian, then merge) is unchanged. Model A stays parked; this note does not revive it, and neither does anything I drafted.

## Where the full reasoning lives

My ruling record on test ownership, dated today, in my role folder. It carries Philipp's confirmations word for word and the reasons behind the deliberate no to Nog writing tests.

— Worf

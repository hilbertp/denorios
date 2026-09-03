# Slice Lifecycle — Business Requirements

This document defines what the slice pipeline **must do**, independent of how watcher.js, server.js, or the dashboard currently implement it. When code diverges from this document, the code is wrong.

---

## Core principle

A slice is a moving Kanban ticket. It lives in **one place at one time** and is moved by **the intended actor** for the state it's transitioning out of.

One file per slice. The filename suffix IS the status. No parallel lifecycles, no sidecar files that represent a different phase of the same ticket.

---

## Actors

| Role        | Responsibility                                                                 |
|-------------|-------------------------------------------------------------------------------|
| Philipp     | Product owner. Approves slices into the queue.                                 |
| O'Brien     | Dev team lead. Sole author of slices. Escalation point when the Rom–Nog loop fails and receiver of the fix-slice handoff when Julian's stage goes red on a bug. |
| Rom         | Implementor. Moves the ticket from IN_PROGRESS to DONE. On rejection, reads Nog's appendment and reworks his implementation. Writes the safety-net tests for his own change: one per acceptance criterion plus one per trap in the brief, then stops. Runs the break-it check on his own new tests and reports which went red. Moves his own safety-net tests when his change requires it and lists every move in his report. Never writes or commits a browser test (a `*.spec.js` under `e2e/`). May open a browser to check his own work and says what he saw in his report. |
| Nog         | Code reviewer. **Append-only.** Writes his verdict and findings below existing content and hands the ticket back — to Rom (if cycles ≤ 5) or to O'Brien (escalation). Never edits what Rom or O'Brien wrote. **Writes no code and no tests. This is a deliberate choice, not an omission:** he reads the code before he judges it, so tests he wrote would share Rom's blind spots, and he must stay the one signature that comes from a non-author. The second signature on a moved or weakened test comes from whoever is not doing the moving; Nog authors nothing, so that is always Nog. |
| Julian (Bashir) | QA. Writes the browser tests for a slice after it lands on dev, one slice at a time, as a visible stage (IN_QA). Moves browser tests only; never edits a safety-net test. Receives information, never code. His packet is exactly: (1) the whole slice file: O'Brien's brief with goal, tasks, traps, and the tagged criteria as O'Brien wrote them; (2) Rom's DONE report; (3) Nog's verdict and review; (4) the list of changed file names only, never contents; (5) the screen hooks, each with its starting state in plain words ("visible when ..."); (6) the tests Rom says his change moved; (7) the address of the live dashboard on dev, for looking at the product; (8) the break-it result. Never the line-by-line code changes, never the product source. Never edits product code. Never edits a criterion. |
| Watcher     | Technical orchestrator. Physical filesystem moves, git ops, role spawning.      |

The watcher does **not** approve, accept, or reject. It executes transitions that the human/role actors decide.

---

## States (in order)

1. **STAGED** — O'Brien has drafted the slice. Awaiting Philipp's approval in the Ops Center.
2. **QUEUED** — Approved by Philipp. Waiting for Rom to pick up.
3. **IN_PROGRESS** — Rom is implementing.
4. **DONE** — Rom has finished. Awaiting Nog's review.
5. **IN_REVIEW** — Nog is evaluating quality, ACs, and goal achievement.
6. **ACCEPTED** — Nog has passed the slice. The slice goes onto dev.
7. **IN_QA** — Julian's stage. The slice is on dev. A break-it check names any hollow safety-net tests, Julian writes the browser tests, then the stage runs both suites once on dev. Green means ready to merge. Red has exactly two exits (see below). A red ticket stays in IN_QA.
8. **MERGED** — dev promoted to main. Awaiting archive.
9. **ARCHIVED** — Terminal success state. Read-only history.

---

## State transitions — who moves the ticket

| From          | To                        | Moved by | Trigger                                              |
|---------------|---------------------------|----------|------------------------------------------------------|
| —             | STAGED                    | O'Brien  | Drafts the slice file.                               |
| STAGED        | QUEUED                    | Server   | Philipp clicks Approve in the Ops Center.            |
| QUEUED        | IN_PROGRESS               | Watcher  | Picks up next PENDING, sets up worktree, spawns Rom. |
| IN_PROGRESS   | DONE                      | Rom      | Writes his completion report.                        |
| DONE          | IN_REVIEW                 | Watcher  | Hands the slice to Nog.                              |
| IN_REVIEW     | ACCEPTED                  | Nog      | Appends verdict: ACs met and goal achieved.          |
| IN_REVIEW     | QUEUED                    | Nog      | Appends rejection verdict + findings. Cycle count ≤ 5. Rom will rework his implementation on next pickup. |
| IN_REVIEW     | STAGED (via O'Brien)      | Nog → O'Brien | Appends 6th rejection verdict. O'Brien reworks the slice and returns it to STAGED. |
| ACCEPTED      | IN_QA                     | Watcher  | Puts the slice on dev. Runs the break-it check on Rom's new safety-net tests and writes the result: a test that stays green with the fix undone is hollow, is named in the stage output, and does not count as evidence for its criterion; it is not deleted here. Builds Julian's packet: (1) the whole slice file (brief, tasks, traps, tagged criteria as O'Brien wrote them), (2) Rom's report, (3) Nog's verdict and review, (4) changed file names only, (5) screen hooks with starting states, (6) tests Rom moved, (7) the dev dashboard address, (8) the break-it result. Never the line-by-line code changes, never the product source. Spawns Julian. |
| IN_QA         | MERGED                    | Watcher / Promote button | The stage's one run of both suites on dev is green with Julian's browser tests in. Philipp presses the Promote button; both suites run once more as a last check that dev still passes, then dev is promoted to main. |
| IN_QA (red)   | — (stays IN_QA; new fix slice) | Julian → O'Brien | A test found a bug, or a criterion's only safety-net test is hollow. Julian appends the finding to the ticket. The stage writes a per-slice handoff into O'Brien's inbox naming the criterion, the failing test file, and an excerpt; a later green run does not delete it. O'Brien writes a fix slice (in the hollow case, one in which Rom replaces the test) whose brief names the red slice. When the fix slice passes Julian's stage, its green result is appended to the red ticket, which turns green. Until then the ticket waits in IN_QA. |
| IN_QA (red)   | — (stays IN_QA; waits for Philipp) | Julian → Philipp | A criterion is unclear or cannot be tested as written. Julian appends the question to the ticket; the stage writes a question file and the Ops panel shows "slice N is waiting for Philipp" until Philipp answers. The answer is appended to the ticket and the stage re-runs. Nobody edits the criterion to go green. |
| MERGED        | ARCHIVED                  | Watcher  | Post-push bookkeeping — worktree prune, branch delete, file renamed to terminal state. |

---

## Rejection flow

The purpose of Nog is to catch problems before merge. **Nog only appends.** He adds his verdict below existing content and hands the ticket back to the next actor.

1. Nog evaluates the slice in IN_REVIEW.
2. If ACs aren't met OR the goal isn't achieved, Nog **appends** a rejection verdict below the existing slice content. The verdict describes what was wrong and where Rom deviated from expectations. Nog does not edit, delete, or rewrite anything above his appended block.
3. The slice returns to QUEUED with Nog's appendment attached. Rom picks it up again, reads Nog's findings at the bottom of the file, and **reworks his implementation** (in the code, on the slice branch) to address them. The slice file itself is never edited — only appended to.
4. In the rework path, the Rom–Nog cycle may repeat **up to 5 times**. Each of Nog's rejection verdicts is appended to the file; prior rounds remain visible as audit trail.
5. If Rom still fails after 5 rework rounds (i.e., Nog writes a 6th rejection verdict), the slice is **handed to O'Brien**. Nog routes the ticket to O'Brien, not back to Rom.
6. O'Brien reads the full appendment history and reviews why Rom couldn't satisfy the ACs. Possible outcomes:
   - The ACs were unclear or contradictory — O'Brien clarifies the slice.
   - The slice was too large — O'Brien splits it.
   - The goal was wrong or unachievable — O'Brien rewrites.
7. After O'Brien's rework, the slice returns to STAGED for Philipp's re-approval.

---

## Julian's stage (IN_QA)

Julian's stage is where browser tests get written. It runs after the slice is on dev and before merge, one slice at a time, visible in the Ops Center as "Julian is writing browser tests for slice N".

1. The watcher runs the break-it check on Rom's new safety-net tests and writes the result. A test that stays green with the fix undone is hollow: it is named in the stage output and does not count as evidence for its criterion. It is not deleted at this stage; nobody at Julian's stage may edit a safety-net test, and a deletion without a trailer trips the merge gate. A criterion whose only safety-net test is hollow is a bug exit (item 6): O'Brien writes a fix slice in which Rom replaces the test. A mismatch between the machine result and what Rom's report claimed is written to the stage output.
2. Julian reads his packet (the eight items in the Actors table): the slice file, Rom's report, Nog's verdict, the changed file names, the screen hooks with their starting states, the moved tests, the dev dashboard address, and the break-it result. He does not read the line-by-line code changes or the product source. His own files are the browser tests and their fixtures under `e2e/`; those he reads and extends.
3. Julian writes the browser tests for every criterion that touches the screen, using the screen hooks. While writing, he may change his own new browser test file and re-run only that file as often as he likes; that is authoring, not an exit. He never runs the full suites himself.
4. When Julian signals he is done, the stage machinery runs the full safety-net suite once and the full browser suite once on dev and records the verdict.
5. Green: the slice is ready to merge. This run is the one that decides.
6. Red has exactly two exits. A bug: the stage writes a per-slice handoff into O'Brien's inbox and O'Brien writes a fix slice. An unclear criterion: Julian appends the question to the ticket, the stage writes a question file, the Ops panel shows the slice is waiting for Philipp, and Philipp rules. In both cases the ticket stays in IN_QA (it is append-only and the slice is already on dev). There is no third exit. Never another Nog round, never Julian editing product code, never Julian editing a safety-net test, never a criterion changed to go green, never a browser test weakened to go green. Once Julian has declared red, only the two exits remain.

No time limit or number is written into this contract for Julian's stage until its first ten runs have been measured.

---

## Invariants (enforced by the pipeline)

1. **One file per slice.** One location, one suffix, at any moment. No parallel spec-file / report-file split that implies two lifecycles.
2. **Merge strictly after Julian's stage is green.** Never before. ACCEPTED puts a slice on dev; it does not put it on main.
3. **Archive strictly after MERGED.** Never before.
4. **Each actor only moves the ticket out of the state they own.** Rom doesn't accept. Nog doesn't merge. Watcher doesn't approve. Julian doesn't merge and doesn't move the ticket out of IN_QA; the two red exits and the Promote button do.
5. **The slice file is append-only after it leaves STAGED.** No actor edits or deletes prior content. Nog appends his verdict; Julian appends his finding or question at IN_QA; Rom reworks his code on the slice branch (not the file); O'Brien only rewrites a slice when he pulls it back to STAGED.
6. **The ticket's history is auditable from the filesystem alone.** `ls bridge/queue/` and the register tell the full story; no hidden state in memory. Each rejection round is visible as an appended block on the slice file.
7. **Rejection does not lose work.** The slice branch survives the rejection loop; only the slice file moves back to QUEUED.
8. **Escalation to O'Brien is automatic after 5 failed Nog rounds.** Not optional.
9. **Rom may escalate a broken slice to O'Brien without a Nog round.** See `slice-pipeline.md` §10.
10. **Julian's stage has two exits when red: a bug goes to O'Brien as a fix slice, an unclear criterion goes to Philipp.** No other exit exists. A red ticket stays in IN_QA, and the Promote button refuses while any ticket on dev is IN_QA red or waiting for Philipp.
11. **The browser suite runs at Julian's stage on dev, not only at the Promote button.** Rom never runs it. Julian's stage run decides whether the slice may merge; the Promote button's run is a last check that dev still passes at that moment, not a second decision.

---

## What this document is and isn't

**Is:** the source of truth for what the pipeline must do. Every technical artifact — watcher.js, server.js, role prompts, skill definitions, diagrams — must reflect this.

**Isn't:** a technical specification. Filesystem layout, file suffix names, API endpoints, git mechanics, and role-spawning plumbing are implementation concerns. They may change. The business flow above does not.

When reviewing any lifecycle artifact (diagram, skill, role description, code), check it against this document. If they disagree, this document wins and the artifact must be corrected.

---

## Known code divergences to investigate (not part of the requirements — flagged for triage)

These are surfaced here so they don't get lost. They are **not** how the pipeline should work:

- `bridge/watcher.js` line ~1826 renames IN_PROGRESS → ARCHIVED *before* Nog evaluates. The comment claims this is to "archive the original slice so Nog's evaluation task can find the success criteria," which suggests the suffix ARCHIVED is being reused for a "park-the-file" purpose that has nothing to do with the terminal ARCHIVED state in this document. Either the rename target should be a different suffix (e.g. `-PARKED.md`), or the behavior should be removed entirely. This creates a naming collision with the real terminal state.
- The `-REVIEWED.md` suffix (line ~2446) has no documented place in the business flow. Either it has a legitimate role (a sidecar artifact Nog writes alongside the verdict) that needs to be documented, or it is dead code and should be removed.
- Invariant #1 says one file per slice, but during review the slice is three files (`{id}-PARKED.md` with O'Brien's brief and every Nog round, `{id}-DONE.md` with Rom's report, `{id}-NOG.md` with Nog's verdict), and at archive the brief and the verdict go to `bridge/trash/`; only Rom's report survives as `{id}-ARCHIVED.md`. Julian's stage needs the whole ticket, so the slice that builds the stage must assemble the packet before archiving runs (or from the trash copies if it already ran) and make the surviving file the whole ticket.

These are candidates for their own slices once the BR document is ratified.

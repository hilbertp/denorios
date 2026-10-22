# Denorios — project history

*Written 2026-10-22 by Alex (O'Brien, Dev Lead) on onboarding, from the git log (1,006 commits), the ADRs, the handoffs in the role inboxes, and the archived slice records in `bridge/queue/`. One screen per era; the register and the stickers hold the detail. Update it at the end of each era, not each slice.*

*Crew names: Alex = O'Brien (dev lead), Sam = Rom (builder), Jordan = Nog (reviewer), Julian = Bashir (QA), Taylor = Dax (architect), Chris = Worf (DevOps), Morgan = Sisko (PM), Riley = Ziyal (UX), Robin = Leeta (design). Code and folders still use the legacy keys; see `docs/ROLE-RENAME-PLAN.md`.*

---

## 1. What this is

Denorios is a software-delivery pipeline run by AI roles on plain files. A dev lead writes a slice, a human approves it, an orchestrator hands it to a builder on its own branch, a reviewer accepts or rejects, the slice is squashed to `dev`, QA decides whether the tests need to change, and a merge press moves `main`. No database, no broker. Files are the API; `bridge/register.jsonl` is the memory.

It started on 6 April 2026 as "The Patch of Hormuz", was renamed "The Liberation of Bajor" the same day, and became Denorios on 2 July 2026. The repo name, the `DS9_*` variables and the historical records keep the names they were written under.

## 2. The eras

| Era | Dates | Commits | Highest slice | Theme |
|---|---|---|---|---|
| 0 | 6 Apr 2026 | ~60 | 9 | Day one: contracts, watcher, dashboard, the names |
| 1 | 7–30 Apr | ~570 | ~270 | Bet 2 and Bet 3: the autonomous loop, the staging gate, the Ops Center, economics |
| 2 | May | 43 | 303 | Hardening, FIFO dispatch, the Ruflo verdict |
| 3 | June | 194 | ~347 | The gate: dev→main via GitHub Actions, rollback, the Test-Update Gate, AC custody |
| 4 | July | 15 | 352 | Rebrand to Denorios, packaging ADR, then silence through August |
| 5 | September | 141 | 411 | Test ownership: who writes which test, proof lanes, Julian's stage, History that tells the truth |
| 6 | 27 Sep – 22 Oct | 0 | 411 | Quiet. ADR-JULIAN-ALONGSIDE proposed; main not promoted since 24 Sep |

### Era 0 — 6 April: day one

Nine slices in one day, from a repo that did not exist in the morning. Slice 1 formalised the contracts and templates; slice 2 built the production watcher (async execution, config, logging, heartbeat); slice 3 wrote the implementor's anchor; slice 4 added crash recovery and validation; slice 5 made the terminal readable for a stakeholder; slice 6 wired an LCARS dashboard to live bridge data; slice 7 enriched the heartbeat; slice 8 renamed `.bridge/` to `bridge/` so the queue could be inspected; slice 9 added the `goal` field. The crew was renamed from Mara and Rook to the DS9 names, and the project from Hormuz to the Liberation of Bajor, before midnight.

Lesson that still holds (DEBRIEF item 1): the watcher runs stale code after a merge until it is restarted.

### Era 1 — 7 to 30 April: Bet 2 and Bet 3

- 7 Apr: `register.jsonl`, the append-only event log, and the Ziyal and Sisko roles.
- 9 Apr: register history and economics on `/api/bridge`; the `REVIEWED` event; activity-based inactivity kill; **the relay-invoked evaluator** (a stateless `claude -p` that reads DONE reports and writes ACCEPTED or an amendment), which closed the delivery loop without a human; merge on accept; docker compose startup.
- 10 Apr: **the staging gate** (commission 042). Briefs are staged for the human to Commission, Amend or Reject before anything executes. The ideas backlog, the Worf, Nog and Bashir roles, token-cost measurement and model routing were all captured as ideas that week.
- 11–14 Apr: the dashboard became "The Rubicon" with a five-stage pipeline (commission 049); `docs/FEATURES.md` (Cagan's model, adapted for AI); the Bet 3 per-slice tracking ADR (timesheet, tokens, cost per role); Sprint 3 scope: Wormhole (a native MCP server so Cowork can write files without permission prompts), the O'Brien drain, Nog as a real reviewer role, the Ops Center from Ziyal's design.
- The rest of April: 632 commits in the month, roughly 270 slices. Commission became slice; the evaluator became Nog; the economics landed.

### Era 2 — May: hardening and the Ruflo verdict

Slices 273–303. Squash-to-dev replaced the legacy main merge (273). Bashir got a lane in Ops (274). **Ruflo** (claude-flow, agentic-flow, RAG, swarms) was probed in slices 277 and 282–291 and the verdict was that it adds cost, not value; the findings are under `docs/ruflo/`. FIFO dispatch through `queue-order.json` (292), `depends_on` as a real dispatch gate (293), one round counter with `MAX_ROUNDS` on every re-dispatch (295), idempotent startup recovery (296), the `/check-handoffs`-first discipline in every role file (298), a non-gate Bashir invocation (299), and the launchd plist fixes that let `claude -p` find its PATH and API key.

### Era 3 — June: the gate

- 4 Jun: **ADR-GITHUB-CI-MERGE-MODEL** accepted. `dev` is the shared line; `main` moves only when a GitHub Actions promotion is green. A runbook for push and merge.
- 12–13 Jun: the role-model rename wave; **ADR-ROLLBACK-MODEL** accepted (revert-forward through the gate) and a Roll back button.
- 14 Jun: **ADR-TEST-UPDATE-GATE** proposed: given what the code changed, should the tests have changed? A weakened, removed or skipped check reads red unless a scoped commit trailer declares it (`Test-Loosen-OK`, `Tests-Not-Needed`, `Coverage-Removed`).
- 15 Jun: the role memory system (`memory/MEMORY.md`, `/remember`, `/compress` before compaction).
- 17 Jun: **ADR-AC-RECONCILE** built in one day (PRE-1..3, BUILD-1a..c, GATE-WIRE, PROMOTE-WIRE): every acceptance criterion gets a tag `slice-N-ac-K`, `AC-MANIFEST.lock` records them with a hash, `COVERAGE.lock` records which test guards which source, both are gate inputs, and only Philipp may change a criterion (`AC-Change-OK` + `Spec-Owner`).
- 24 Jun: the DevOps Station panel (two pipelines, branch graph, merge-pressure dial).
- 30 Jun: Julian's AC test-authoring engine behind CHECK FOR TEST UPDATES, which drafts tests for uncovered criteria. (Retired on paper by ADR-JULIAN-ALONGSIDE; the 3 September ruling forbids drafting safety-net tests.)

### Era 4 — July: Denorios

2 July: the rebrand to Denorios; labels say slice, commit or run instead of `#`; ADR-PACKAGING proposed (npm framework, three-tier release). Slices 348–352. Fifteen commits, then nothing until September. August is empty.

### Era 5 — September: test ownership

The month settled who writes which test and what the machines run.

- 1 Sep: S-numbering, one identity from slice to commit (350); slices branch from `dev`, not `main` (353). Philipp hit a false red at the merge dialog and ruled: never require a second human; detect renames instead of calling them removals (366, 2 Sep); stop policing `test/`, which nothing runs (365).
- 2 Sep: the merge lock is enforced by the server, not the button (361); the panel tells the truth after a merge (362).
- 3 Sep: **the test-ownership ruling** (Worf, `.claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md`): Rom writes one safety-net test per criterion plus one per trap, then stops; Julian owns the browser tests and writes them after the slice is on dev; Nog authors nothing so he is the second signature on any weakened test; a brief never says "write guard tests" or "verify in a real browser". The same day: **the role-rename plan** (DS9 names to real names; keys as role nouns; four slices R1–R4). Fake work is decided from the diff, not the commit count (375), after that rule had thrown away honest slices 366 and 371.
- 4–6 Sep: drag-to-reorder for staged slices (371), the pipeline stops leaving debris and untracks runtime state (372, 381), every workspace gets its dependencies (376), criteria derive from commit trailers (379), History is chronological and pageable (380, 385), approval provenance so a machine cannot approve work (354), Julian's drafts readable and applicable by construction (356, 357).
- 7 Sep: **ADR-PROOF-LANES** (Taylor). Machines run suites, agents do not. Two lanes of rigour: `core` (one test per criterion plus traps, break-it before commit) and `surface` (a test only where a criterion asserts behaviour). Six slices 386–391: metrics, locks regenerated at landing, no full suite for Rom, `--lane` on the slice tool, the gate learns the lane, the suite passes in a fresh copy. Trigger: a 13-line dashboard change (383) had cost 16 minutes and $5.
- 11–15 Sep: the first lane runs. The first landing through the new code crashed the daemon (load-order bug in lock regeneration); 393 fixed four daemon faults; hotfix a8da61f gave the child a 256 MB buffer and made a rate limit a rejected event; 394 was retired because the fix had been made by hand on dev one minute before approval; 395 ended nameless commits on dev; 392 made every build say where its minutes went. 14 Sep: a full-disk outage; the dashboard has no supervisor; `bridge.log` never rotates (handoffs to Chris).
- 17–24 Sep: the author-sandbox guard (359), **Julian's stage becomes a real step** with the `IN_QA` state and its packet (363), Jordan reviews without running the suites and writes his verdict in one exact shape (399), the verdict is read even without its closing fence (400), **History tells the truth** about time per role and cost (401, 402), and 404 made dev green after 402 changed a signature 400 had pinned.
- 24 Sep: **ADR-JULIAN-ALONGSIDE** (Taylor, revision 2 after adversarial review). The line never waits for Julian; he works at his own bench on a card per landing and answers one question per criterion (does this slice need a test update?); his tests are landed by the pipeline; one merge button shows where Julian is and Philipp decides; nothing runs between landings; a red at the merge explains itself and Philipp routes it. It names seven work items A–G for Alex to slice, in order, and withdraws staged 377 and 378.
- 24–26 Sep, on dev only (19 commits main does not have): the dashboard runs as a background service that restarts itself (403, answering Chris's 14 Sep handoff), the merge dialog stops asking for a second person (368), Sam's and Jordan's sessions are streamed so no output cap kills a build (396, item C), every dev commit says what kind it is and the branch graph lists them in full (397, 405, 406), files Julian's stage leaves behind never block a landing (407), **the merge gate sees tests that run a file or load it** (410, Rule 7 (a), direct loads only), and two green-again test fixes (408, 411). The promote press of 24 Sep (run 36190555313) had gone red on the checker's false "new behaviour, no test"; Alex unblocked it by hand (659bc18) and 410 fixed the cause. No press since.

### Era 6 — 27 September to 22 October: quiet

No commit on dev since 0df8720 (26 Sep) and none on main since 9a8e46a (24 Sep). main is 19 commits behind dev.

## 3. Where it stands on 22 October 2026

**Last landed slice:** 411 (on dev, archived). main is at 404 and 19 commits behind dev; a promote press is due. 398 (Julian's board) is staged on Philipp's machine and becomes item G; 409 is unaccounted for in the repo.

**The governing document:** `docs/adr/ADR-JULIAN-ALONGSIDE.md`, §7 (build constraints), §8 (what changes where) and §9 (order of work: A checker fixes, B quiet, C = 396, D bench and backlog, E merge button, F red report, G board and History). Done: C (396) and the direct-load half of A (410). Next: the rest of A, then B.

**Decided but not built:**
- The crew rename R1–R3. Only `bridge/roles.json` exists; `lib/roles.js`, `dashboard/dashboard.html` and `bridge/reviewer-prompt.js` do not. Folders still carry legacy keys.
- Test-ownership slice 3 (the brief check): `bridge/new-slice.js` does not yet refuse a brief that lacks the fixed block or contains a forbidden phrase, although `docs/contracts/slice-format.md` says it does.
- The machine break-it check at Julian's stage (staged 377). Dropped by ADR-JULIAN-ALONGSIDE §6; Julian's 24 Sep handoff about its blind spot on test-repair slices is therefore closed without a slice.
- Staged 377 and 378 are to be withdrawn; 398 becomes G; 397 and 405 landed without the Kind letter for `T<N>:` test landings, so D adds it.

**Known false reds and faults still open:** the coverage checker credited only `readFileSync` until 410 (two of the last three red merge runs; ADR §2.9); it now credits direct `require` and child-process runs, and deliberately not transitive loads; `Coverage-Removed` still overrides the whole range, not one source; `AC-MANIFEST.lock` still records no criterion text since slice 383 (45 of 375 tags, unchanged through 411); rollback writes no reversal trailers; the three giant files (`bridge/orchestrator.js` 9,903 lines, `dashboard/lcars-dashboard.html` 13,472, `dashboard/server.js` 4,940) are still on Taylor's desk.

**Open handoffs in Alex's inbox (12 files, Apr–Sep):** the five from Worf and Dax (test-ownership ruling and plumbing, rename, proof lanes) are acted on except the items above; Bashir's merge-warning requirements (1 Sep) landed as 361, 365, 366 and 368; Bashir's sequential-flow ruling (1 Sep) is amended by ADR-JULIAN-ALONGSIDE; Bashir's break-it blind spot (24 Sep) and item 1 of his 410-stage handoff (25 Sep) are closed by §6; item 2 of that handoff stands as a brief-writing rule (a criterion Julian should corroborate needs an observable the product answers for, never a historical git range); the three Dax handoffs from April (Bet 3 tracking, evaluator, crew dossier) are history.

**Stale documents a reader will trust by mistake:** `.claude/roles/obrien/memory/MEMORY.md` (last updated 15 Jun), `docs/FEATURES.md` (12 Apr), `docs/SPRINT3-SCOPE.md` (14 Apr), `.claude/CLAUDE.md` and `README.md` (pre-ruling wording; the prose sweep R4 is Chris's and Philipp's).

## 4. Decisions on record

| ADR | Status | One line |
|---|---|---|
| `architecture/BET2-RELAY-DASHBOARD-ARCHITECTURE.md`, `BET3-PER-SLICE-TRACKING.md` | built | the relay, the dashboard, per-slice economics |
| `architecture/WORMHOLE-ADR.md` | accepted, POC | permissionless file bridge for Cowork |
| `adr/ADR-GITHUB-CI-MERGE-MODEL.md` | accepted 4 Jun | dev→main only on a green promote run |
| `adr/ADR-ROLLBACK-MODEL.md` | accepted 13 Jun | revert-forward through the gate |
| `adr/ADR-TEST-UPDATE-GATE.md` | proposed, built | move, never weaken; trailers as overrides |
| ADR-AC-RECONCILE (contracts under `docs/contracts/ac-custody.md`) | built 17 Jun | tags, manifest, coverage lock, only Philipp changes a criterion |
| `adr/ADR-PACKAGING.md` | proposed 2 Jul | npm framework extraction |
| `adr/0001-orchestrator-refactor-and-watcher-deprecation.md` | proposed | modularise the orchestrator |
| `adr/ADR-PROOF-LANES.md` | proposed 7 Sep, built 386–391 | machines run suites; two lanes |
| `adr/ADR-JULIAN-ALONGSIDE.md` | proposed 24 Sep | Julian off the critical path; one merge button; the red report |

## 5. What keeps happening

1. **Code changes to the daemon do nothing until it is restarted.** Day one, and again on 13 Sep. Every orchestrator slice ends with `launchctl kickstart`.
2. **A hand edit on dev while a slice for the same change is staged wastes a dispatch** (394). Withdraw the slice in the same breath.
3. **Rules that infer intent from shape throw away honest work.** "One commit plus a long report" killed 366 and 371; "undo the product files and see if the tests go red" would have called 404 hollow. Decide from the diff and from what the report says.
4. **The checker's false reds are the most expensive reds** because they teach the operator to tick through the dialog. Four of one class before 77293b1; two of the last three merge reds; fixed for direct loads and runs by 410 on 26 Sep.
5. **Documents say the stage runs the suites; the code has had no caller for `_gateTestsUpdated` since 363.** Measure before slicing (ADR-JULIAN-ALONGSIDE §2 was a read-only investigation by six agents and a critic).
6. **Briefs override everything the builder reads** (371). The brief must say exactly what to run and what not to write, and the fixed block must be verbatim.

# ADR — Julian alongside: the line never waits, the suites run at the button, a red explains itself

**Status:** Proposed (revision 2, after adversarial review). Written by Taylor (Architect; legacy key
`dax`) on 2026-09-24 at Philipp's direction, in answer to Alex's handoff
`.claude/roles/dax/inbox/HANDOFF-JULIAN-OFF-THE-CRITICAL-PATH-FROM-OBRIEN.md`. Philipp approves the
direction and each slice, and applies the contract patches (Layer-2 locked).
**Amends:** `ADR-PROOF-LANES.md` Rule 1, Rule 2's "machine-repeated at Julian's stage" row, the §3 run
table, §4 condition 1, the §6 slice-388 row and the §7 Julian paragraph; the 2026-09-03 test-ownership
ruling (Julian's row, "never edits a safety-net test", "information, never code" for regression work,
"green means the slice may merge", the two red exits, Nog as the only second signature); Philipp's
2026-09-01 sequential ruling where it put Julian's step before the next landing. "Visible in Ops" from
09-01 stands.
**Keeps:** `ADR-GITHUB-CI-MERGE-MODEL.md` (main moves only on a green promote run; the operator decides
when; nothing auto-promotes), `ADR-TEST-UPDATE-GATE.md` (the masking classifier), `ADR-AC-RECONCILE.md`,
and the rule that only a human changes an acceptance criterion.

> Crew names: Sam = Rom (builder), Jordan = Nog (reviewer), Julian = Bashir (QA), Alex = O'Brien
> (dev lead), Chris = Worf (DevOps), Taylor = Dax (architect). Code and folders keep the legacy keys.

---

## 1. What Philipp asked for (2026-09-24, his words condensed)

"Sam devs and Jordan peer reviews; on a positive result we commit to dev. Julian receives the info he
needs kanban style on the commit so he knows if there needs to be a test update or not. Not every
slice needs one. It needs one when (a) old acceptance criteria or old behaviour is changed and the
tests would fail now, or (b) new features are delivered that warrant a regression or browser click
test. That is Julian's decision. Based on it he writes a test suite update or not. When the user
wants to merge, we run the full suite, which includes Julian's new tests. When it fails, Sam gets
more work, maybe Alex too, in rare cases the rest of the team. That routing stays in the user's
hands for now."

On why the check belongs right before the merge: finding a bug early only helps if it flows back to
Alex and Sam and onto dev without friction. It does not; Alex is started by a person. So the merge
press is the human-in-the-loop moment where bugs are **expected**, and on a red there the user needs a
plain answer to "why did the suite fail, and who needs to fix it?"

Julian must never hold up a landing. No suite runs between landings. Philipp did not know that GitHub
runs the safety-net suite on every push to dev and that a red run files a fix request to Alex by
itself.

## 2. What is true today (measured 2026-09-23/24, read-only: six investigators and a critic)

1. **Julian holds the landing line.** His stage takes the gate mutex (`bridge/state/gate-running.json`,
   `bridge/orchestrator.js:8286-8296`, "The mutex IS the one-at-a-time rule"); a slice accepted while it
   is held is deferred (`:4326-4343`); the drain lands one slice and stops (`:9575-9651`). It has not
   bitten yet (0 `SLICE_DEFERRED`), only because slices have not come back to back. Julian took 9.5 and
   11.6 minutes (399, 400); Sam plus Jordan took 6.2 minutes on surface slice 399.
2. **Our own pipeline already runs no suite between landings.** `_gateTestsUpdated` has had no caller
   since slice 363 (`orchestrator.js:8709`: defined and exported only). Julian's prompt and role file,
   `docs/contracts/slice-pipeline.md:143-146`, ADR-PROOF-LANES Rule 1 and Alex's handoff all say the
   stage runs both suites. It does not, and Julian believes it does.
3. **GitHub runs a suite between landings and files work by itself.** `ci.yml` runs the safety-net
   suite on every push to dev; the dashboard (slice 388, `dashboard/server.js:631-713`) files
   `REGRESSION-FAILURE-dev-<sha>.md` into Alex's inbox on red. Six filed ever. Five were one
   pre-existing failure on chore and handoff commits; the sixth (a092cb9, 2026-09-23 23:13:56Z) was the
   pipeline's own bookkeeping (item 5). None was a slice bug caught early.
4. **The merge button does not know about Julian.** `mergeLockRefusal` (`server.js:1106-1143`) reads
   only the CHECK triage. At 23:07:57Z the button was pressed while Julian was mid-stage on slice 400;
   run 35932020568 went green and moved main to 2ef2ec1; Julian committed his slice-400 browser test
   (8ecae30) 41 seconds after dispatch. Slice 400 is on main without Julian's decision or his test.
   `promote.yml` checks out `ref: dev` at run time, not the sha the operator saw.
5. **Julian's tests reach GitHub by accident and break the bookkeeping.** He works and commits in the
   live landing tree (`orchestrator.js:8433`), permitted only by a leaked `DS9_WATCHER_MERGE=1`
   (`:9211`, never unset). He neither pushes nor regenerates `COVERAGE.lock`; his commit rides out
   with the next landing, whose lock regeneration credits his test to the wrong slice. On 09-23
   `ensureIntegrationIsFresh` pushed his 8ecae30 alone; the lock-integrity check went red on GitHub
   and the false fix request above was filed.
6. **Julian cannot run in parallel in that tree.** A landing checks out the slice branch in the same
   tree, autocommits tracked edits under the slice's name (`:1441-1480`; 35e119e already swept a
   person's plist edit into S399), and refuses to land while any `e2e/*.spec.js` is dirty
   (`:9102-9121`).
7. **Julian's decision is not recorded.** He already makes Philipp's call per criterion (399: no browser
   test for ac-1..3, one for ac-4; 400: a test although Sam declared no screen hooks), but only as prose
   in the sticker. The outcome is the exit code. The merge lock then re-asks Philipp through CHECK.
8. **CHECK FOR TEST UPDATES is a ritual.** All 10 criteria in the current range are COVERED by Sam's
   tests; the press only unlocks RUN GATE and re-locks on every new dev tip. Its authoring path was last
   used on 2026-09-04 and drafts safety-net tests, which the 09-03 ruling forbids.
9. **Red at the button is often the checker, not the product.** Two of the last three red merge runs
   were the Test-Update Gate calling tested modules "untested" (it credits `readFileSync` only; runs
   34991209808 and 34863455224; commit 77293b1: "fourth false red of this class").
10. **The "old requirement changed" signal is blind.** `AC-MANIFEST.lock` has recorded no criterion
    text since slice 383, so STALE / AC-MUTATED detection cannot fire for recent slices.
11. **Nothing records "on main".** Button promotions write only `promote-dispatched`;
    `SLICE_MERGED_TO_MAIN` is emitted only by the dead `mergeDevToMain`.
12. **A restart during a stage can freeze landings.** Recovery keeps the mutex on a fresh LLM-written
    heartbeat and no live path releases it afterwards (`gate-mutex.js:152-186`).

Points 2 and 7 are good news: the vision is closer than the documents suggest.

## 3. Decision

### Rule 1 — The line never waits for Julian

A landing is: Sam builds, Jordan accepts, the slice is squashed to dev, the next slice starts. Nothing
Julian does takes a lock that a landing respects. The gate mutex, the deferral and the drain are
removed. Every slice landing adds a **card** to **Julian's backlog**, first in first out.

There is one Julian at a time: cards and briefs addressed to Julian take turns (they share a
browser port, fixtures and the account). A brief addressed to Julian goes back to the queue while a
card is working, as today; it never waits inside the build slot. Neither ever holds a landing.

### Rule 2 — Julian works at his own bench, one card at a time, and answers one question

- **Bench:** a throwaway git worktree made from the dev tip when the card starts. He never works in
  the landing tree.
- **Card (the kanban sticker):** the eight items of the 09-03 ruling, repaired (item 3 is Jordan's
  accepting verdict, not a rejected round; item 8, break-it, is dropped, see §6), plus **At risk**,
  machine facts that need no suite run: the Test-Update Gate's classification of the slice's landing
  commit (including any "new behaviour, no test" file), the existing tests that read the changed
  files, and any earlier criterion whose wording this slice changed.
- **The question, asked explicitly:** "Does this slice need a test update? (a) A criterion or behaviour
  changed so an existing test is now wrong. (b) A new feature is worth a regression or a browser click
  test." He answers per criterion, with a one-line reason.
- **What he may write:** browser tests and regression tests, new or updated. Sam still writes the tests
  for his own new criteria inside his slice; that is unchanged. When Julian updates a regression test
  he may read the product files his card names; browser work stays information-only. He may weaken or
  remove an old check only for a change a criterion in range asks for, and that change needs Philipp's
  signature at the merge (Rule 4). He never edits a criterion.
- **What he may run:** only the tests he wrote or changed, at his bench. Never a full suite.
- **Suspected bug:** if he concludes the product is wrong rather than the test, he writes no test fix.
  He records the suspicion on the card ("seen at <sha>, which contains slices N to N+k"). It shows in
  the merge dialog, not in anyone's inbox.
- **Card states:** waiting → working → landing (his tests are being put on dev) → **decided**
  (`tests_added`, `tests_updated` or `no_update`, per-criterion rows, reasons, test files, suspected
  bugs). Also **needs you** and **waived**. The decision is final only once his tests are on GitHub.
- **When something goes wrong:** a timeout, crash or failed start retries once, then the card becomes
  **needs you** and Julian moves on to the next card. Philipp's three actions on it: re-run on the
  current dev, discard Julian's work, or waive Julian for this slice. Each is recorded.
- **Visibility:** each card is logged with tokens and cost, like Sam and Jordan.

### Rule 3 — Julian's tests are put on dev by the pipeline, never by his own commit

When a card ends with test changes, the orchestrator lands them in a **separate test-landing step**.
It is not a slice landing and never counts as one.

- It builds the commit itself, as a squash of Julian's bench onto the current dev: its own subject
  (`T<N>: Julian's tests for slice N`), and only the trailers it writes (`QA-For`, `Covers`, and
  exact-path or exact-tag `Test-Loosen-OK`, `Coverage-Removed` or `Tests-Not-Needed` lines for what
  Julian declared). Julian's own commit messages never reach dev.
- It accepts only test paths (browser specs, regression test files, their helpers and fixtures).
  Anything else makes the card **needs you**. It regenerates `COVERAGE.lock` only; if the criteria
  record would change, the card is **needs you** (only a human changes a criterion).
- **Julian yields to Sam, before and after.** If his files overlap a slice that is still being built
  or reviewed, the card waits "for slice M to land" and then re-merges. If a slice later clashes with a
  test landing anyway, the pipeline reverts that test landing (a new commit, never a rewrite), lands
  the slice and reopens Julian's card. A slice never waits for, or fails because of, Julian.
- A `no_update` card whose slice showed "new behaviour, no test" lands a small commit that declares
  `Tests-Not-Needed` for exactly those files, with Julian's reason, so the merge checker hears his
  decision.
- Agents are started with an environment that cannot commit in the landing tree.

### Rule 4 — One merge button: Philipp sees where Julian is and decides; it never starts itself

- **CHECK FOR TEST UPDATES is removed.** Its lock is replaced by what follows. Its draft-and-apply
  path retires; Julian's bench replaces it and keeps its sandbox guard.
- **Why there is no "merge only what Julian finished":** dev is one straight line and Julian's tests
  land after the slices that followed the one they cover. A commit that contains Julian's tests for
  slice N also contains every slice that landed before them. Merging only what Julian has finished
  would therefore need the line to wait for him, which Rule 1 forbids. So the choice at the button is
  honest and simple: **merge now**, or **wait for Julian**.
- **Next to the button, Julian's status for the commit on the button:** "Julian is done" or "Julian
  still on slice 402, 403 waiting". When Julian catches up, the status says so. It never merges by
  itself.
- **The confirm dialog** shows, per slice in the merge: Julian's decision and reasons with its tests
  included; "still with Julian: their tests follow in a later merge"; or "Julian finished after this
  view: refresh to include his tests". It shows any suspected bug. It lists every check Julian weakened
  or removed, every shared test helper he changed and every "no test needed" he declared, each with its
  reason. **Confirming requires ticking those: Philipp is the second signature** the contract requires.
  The server refuses a dispatch that does not carry that acknowledgement. Actions: *Merge now* or
  *Wait for Julian*.
- **Record:** slices merged before Julian decided are recorded as such; History shows "went to main
  before Julian's decision", and Julian's tests for them go with the next merge.
- **Exact commit:** the run tests exactly the commit in the dialog and moves main to exactly that
  commit. Landings during the run do not affect it.
- **On green,** each slice in the range is recorded as on main, so History shows it.
- **Rollback** does not wait for Julian. Its dialog shows the same Julian status and requires the same
  signature for any unsigned Julian weakening it would carry to main. Rolling back slice N also reverts
  Julian's test landings for slice N (tests for a removed feature would fail).
- **Switch-over:** slices that landed before Julian's backlog existed show as "landed before the
  backlog". The one exception is a slice Julian was still working on at the switch-over (only if the
  restart precondition in §9 was missed): it becomes the first card.

### Rule 5 — Nothing runs or files work between landings

GitHub's per-push run is switched off, and so is everything that reads it: the automatic fix request
(slice 388), the red pill, the CI line in the DevOps Station, the per-push report in the Regression
panel, and the advisory Test-Update Gate step. The only suite runs in the pipeline are Philipp's merge
presses. (A person can still start `ci.yml` by hand or through a pull request to main; the pipeline
never does.) Julian decides case (a) from the **At risk** facts; what he misses surfaces at the merge
press, the moment built for it.

### Rule 6 — A red at the merge explains itself, and Philipp routes it

The first version is **machine-only**. It is built once per run and kept.

- **Headline:** "Main was not changed. <stage> failed on <commit>." Every stage is shown as passed,
  failed or not run. When stages did not run: "the next press may find more".
- **Per failing check:** what it checks in plain words (the criterion text, or "no criterion recorded"),
  where it failed and the first line of the failure, who last changed that check in this range (Sam,
  Julian or a person), and for browser checks "failed on both attempts".
- **Kind and suggested owner**, by simple rules:

  | What the machine sees | Kind | Suggested owner |
  |---|---|---|
  | Failed before or around the tests: checkout, installs, git, main moved | Setup | Chris |
  | A bookkeeping check (the lock-integrity tests) | Bookkeeping | Chris |
  | Checker says "untested", but a test does reach that file (rare once Rule 7a lands; same code) | Checker blind spot | Chris |
  | Checker says "untested", and no test reaches it | Missing test | Julian |
  | The failing check was changed by Julian in this range | Wrong test | Julian |
  | An old check fails, and a criterion in range changed that behaviour | Outdated test | Julian |
  | An old check fails, and no criterion explains it | Code bug | Alex, who writes a fix slice for Sam; slices that touched the area are listed |
  | Nothing fits (unclear criterion, two changes clash) | Needs your call | Philipp (Taylor if it is a design clash) |

- **Buttons:** Copy; write to Alex's inbox ("start Alex to act on it"); reopen Julian's card for a
  slice; write to Taylor's or Chris's inbox. Every one is Philipp's press. Nothing re-runs a merge by
  itself.
- **Later versions**, only if the first proves too thin: an automatic search that pins a failing check
  to the exact slice that broke it (v2), and an "Ask Julian why" button (v3).

### Rule 7 — Make red mean something before the button becomes the only run

- (a) The checker credits a test that loads a file with `require`, directly or indirectly, or runs it
  as a script, not only one that reads it.
- (b) Declaring a removed guard covers only the source it names, not the whole merge range.
- (c) The landing records criterion wording again (broken since slice 383), so "an earlier criterion
  changed" reaches Julian's card and the red report.

## 4. What Philipp sees in Ops

- **Julian's backlog:** the active card and the waiting ones, from the first slice that ships it;
  later, a board with *Waiting* (or *waiting for slice M to land*) → *Julian working* (live log) →
  *Decided* ("2 tests added", "no test needed: wording only", "suspected bug: …") → *On main*, and
  *Needs you* with its three actions.
- **The merge button:** "Merge to main" with Julian's status beside it ("Julian is done" or "Julian
  still on 402, 403 waiting"); running; green; or red with the red report.
- History and the topology show Julian's test landings as "Julian's tests for slice N". History shows
  Julian's decision per slice, the time a slice waited for Julian, and the merge it went out with.

## 5. The amended run table (replaces ADR-PROOF-LANES §3)

| Who | Own new or changed test file | Full safety-net suite | Full browser suite |
|---|---|---|---|
| Sam, while working | as often as he likes | never | never |
| Jordan | never | never | never |
| Julian, at his bench | the tests he wrote or changed | never | never |
| GitHub, on each push to dev | | **never (trigger removed)** | never |
| Merge button | | once | once |

## 6. Risk, classified

- **Acceptable:** a bug is found at the merge press, several slices after it landed. That is the
  designed moment. The red report lists the slices that touched the area; v2 would name one.
- **Acceptable:** Julian falls behind when slices are short. The button shows it; Philipp merges now
  (the newest slices' tests follow in a later merge, recorded) or waits a few minutes.
- **Acceptable, with a human signature:** Julian weakens an old test and hides a real regression. His
  weakenings are signed by Philipp at the merge dialog, and the red report shows who changed a
  failing check.
- **Acceptable:** dropping break-it from the card. Sam still runs break-it on core slices
  (ADR-PROOF-LANES Rule 2); the machine repetition at Julian's stage was never built (staged 377).
- **No spike needed.** Worktree benches, lock regeneration, fast-forward landings and failed-run
  parsing all run today.
- **Nothing critical. Two rulings change and need Philipp's word:** Julian may now add and update
  regression tests, not only browser tests; and to update a regression test he may read the product
  files his card names.

## 7. Build constraints for Alex's briefs (from the adversarial review, 2026-09-24)

Each line is a must for the slice that builds the rule. Evidence for each is in the review record
(§11).

**Rules 1 and 2 (backlog, bench, card)**
1. The backlog is derived from the register: slice landings after a recorded switch-over, minus closed
   cards. The card files are only a view. Every landing path yields a card, including crash recovery.
2. Cards start from the landing callback, the card-finish callback and a short timer, not behind the
   poll's `processing` guard. Pause and the rate-limit gate also pause cards.
3. Bench path and branch are per attempt (`/tmp/ds9-worktrees/qa-<N>-a<k>`, `qa/<N>-a<k>`). Teardown
   is `git worktree remove --force`, `prune`, `branch -D`, only after the test landing, never via
   `cleanupWorktree` or `archiveAcceptedSlice`. Leftover benches are cleaned at startup.
4. Julian runs in his own process group; the card records pid, group and attempt. Timeout, shutdown
   and startup kill the group before discarding the bench.
5. Liveness is the daemon's wall clock (keep today's 60-minute default; no new number before ten runs).
   The file-age heartbeat watchdog and `{{HEARTBEAT_PATH}}` are removed from cards. `gate-mutex.js`
   and its import go; `/api/gate-health` reports the active card's elapsed time instead (endpoint
   kept). Briefs addressed to Julian (`invokeBashirNonGate`) move to the same liveness and drop their
   "Mutex contract". **The mutex's one remaining job moves to a single Julian slot** held in the
   orchestrator and mirrored in the card file: a card starts only when no Julian brief runs; a Julian
   brief is sent back to the queue (as `bashir-mutex-held` does today, `orchestrator.js:7911-7916`)
   while a card works. The slot is re-derived at startup from live process groups, never from a
   file an agent writes.
6. The card records the commit its bench started from. Packet item 3 picks `N-NOG.md.pass` explicitly;
   a test covers a slice that has both `.pass` and `.return`.
7. `IN_QA` is emitted when a card **starts**, not at landing; `QA_STAGE_RECORDED` stays at card end, so
   slice 401's History reader keeps working. Add a "waited for Julian" span.
8. The per-card log reuses slice 396's streaming helper (`bridge/logs/bashir-<N>-a<k>.log` until the
   rename lands).
9. Dashboard actions on cards (reopen, re-run, discard, waive) go through `bridge/control/*.json`; only
   the orchestrator changes card state.

**Rule 3 (test landing)**
10. `landTestsForCard(N)` is its own synchronous function, never `squashSliceToDev`. On a temporary
    branch from the current dev tip: `git merge --squash` the bench branch, regenerate `COVERAGE.lock`,
    one commit with an orchestrator-written message (Julian's own messages never reach dev; no merge
    commit). In the live tree: fetch; fast-forward local dev if origin is ahead; refuse on divergence;
    `git merge --ff-only`; push with a timeout; retry an unpushed landing on the next tick. It emits
    `QA_TESTS_LANDED {slice_id, sha}`; it never emits `SLICE_SQUASHED_TO_DEV` or `MERGED`, never
    touches `dev.commits`, never writes ERROR files and never touches slice N's queue files. The
    subject reader (`sliceIdOfSubject`) learns `T<N>:` as "Julian's tests for slice N", and
    `j-no-nameless-commits` (slice-395-ac-3) accepts it; staged 397 gets the matching Kind letter.
11. Path allowlist: `e2e/**`, `regression/**/*.test.js`, `regression/helpers/**`,
    `regression/**/*-helpers.js`, named fixtures such as `e2e/seed-fixture.js`. Refuse lock files,
    `bridge/`, `lib/`, `scripts/`, `dashboard/`, `.github/` and queue files. Helper and fixture files
    carry no tags, so any change to one is listed in the merge dialog for Philipp's signature. A guard
    test proves a test landing whose bench commits carry an `AC:` line leaves `AC-MANIFEST.lock`
    unchanged. Move `touchesAc()` from `lib/apply-draft.js` into a small lib and keep its guard tests
    (they must not retire with `j-apply-draft`).
12. Yield before: intersect the bench diff with every un-landed slice branch
    (`git diff --name-only dev...slice/<M>`); on overlap the card waits for M. Yield after: when a
    slice's drift merge conflicts only on files a `T<*>` landing changed, the pipeline reverts that
    test landing with a new commit, lands the slice, and reopens the card. `squashSliceToDev` never
    turns a Julian-caused clash into an ERROR.
13. Landing functions are synchronous from the first git write to the push. The apply-draft endpoint is
    disabled when this ships.
14. Agents (Sam, Jordan, Julian) are spawned with an explicit environment without
    `DS9_WATCHER_MERGE`.
15. `NOG_TELEMETRY` uses a three-dot diff (`dev...slice/<id>`), so test landings do not count as Sam's
    files.

**Rule 4 (merge button)**
16. Julian's status for a commit S, computed on the server: S must be an ancestor of origin/dev
    (else refuse). For each post-switch-over slice landing in origin/main..S, by the card's latest
    state (a reopen supersedes an earlier decision): *decided, tests included* (its `QA_TESTS_LANDED`
    sha is an ancestor of S, or it had no tests); *decided after this view* (tests landed, not in S:
    offer refresh); *still with Julian*; *needs you*; *waived*. This replaces `stale_check` and
    `mergeLockRefusal`'s triage; nothing in it blocks a press except "S not on dev" and a missing
    acknowledgement (item 19). Slices sent before Julian decided are recorded on `promote-dispatched`.
17. `promote.yml`: a `sha` input (40-hex, validated, passed via `env:`), `run-name: Promote <sha>
    (<kind>)`, a `concurrency` group, and a check before any suite that the sha is an ancestor of
    origin/dev. `scripts/tests-needed.js --strict` compares HEAD with the input sha and fails closed if
    it differs or is not on dev (keep the FAIL-CLOSED wording). No `always()`, `failure()` or
    `continue-on-error` (j-gate-fail-retry). The input is optional with a fallback to dev only
    between E landing (the workflow goes live at once) and the dashboard restart; the next slice makes
    it `required: true`. The dashboard is restarted and the tab hard-reloaded before the next press;
    rollback passes its revert sha. The promote.yml header comment ("ci.yml still runs … every dev
    push") is corrected in B.
18. The dashboard reads the tested sha from the run name or its stored dispatch, not `headSha`
    (`isReconciling`, `_promoteRunStale`, History, the red report).
19. The dispatch (promote and rollback alike) carries the list of acknowledged Julian weakenings,
    helper changes and no-test declarations; the server refuses if it does not match the range. The
    acknowledgement is recorded on `promote-dispatched`, so a later press does not ask again for the
    same commits.
20. On green, emit `SLICE_MERGED_TO_MAIN` per slice id (History works unchanged).
21. The DevOps Station's Pipeline A track and Pipeline B's lock are rewired in the same slice (Pipeline
    B must not keep saying "pass Pipeline A").
22. A guard test: nothing calls `gh run rerun` on `promote.yml` (a re-run would be a merge nobody
    pressed).

**Rule 5 (quiet)**
23. Remove `push:` from `ci.yml` (keep `pull_request` and `workflow_dispatch`) with a
    `Tests-Not-Needed` line (ci.yml is classed as behaviour), the advisory step, slice 388's routing and
    `dev-suite.json` state, the pill, the gate-flow CI line and CI strip readers, `ci.yml` in
    `REPORT_WORKFLOWS`, and the inbox write in `scripts/regression-report.js` (keep its parser and
    LAST-RUN.md). Sweep existing `REGRESSION-FAILURE-dev-*.md` once.

**Rule 6 (red report v1)**
24. Built once per run id: `bridge/state/merge-red/<run_id>.json` (gitignored) and `MERGE_RED` only if
    new. A cancelled run is not a red.
25. The failed step comes from `gh run view --json jobs`; only that step's log section is parsed
    (steps print a unique group marker); advisory lines are never causes.
26. Criterion text comes from the archived, Philipp-approved brief first, then the `AC:` trailers of
    the landings in range.
    Capture `file:line` and the first assertion line. The lock-integrity tests are Bookkeeping by
    identity. "Who changed this check" reads `Slice-Id` and `QA-For` trailers, not subjects;
    autocommit, archive and chore commits read "direct commit, not a slice".
27. "Checker blind spot" versus "Missing test" is decided by whether any regression test reaches the
    file through its require graph or runs it. "Outdated test" requires a cited criterion in range;
    otherwise the kind is "Code bug".

## 8. What changes where

| Surface | Change | Work item |
|---|---|---|
| `scripts/build-coverage-map.js`, `lib/tests-needed.js`, AC-manifest landing pass | `require` and script credit; per-source `Coverage-Removed`; criterion wording recorded again | A |
| `.github/workflows/ci.yml`, `dashboard/server.js`, `dashboard/lcars-dashboard.html`, `scripts/regression-report.js` | Rule 5 | B |
| `bridge/orchestrator.js`, `bridge/qa-stage.js`, `bridge/templates/bashir-prompt.md`, `bashir-non-gate-prompt.md`, `bridge/state/gate-mutex.js` (deleted), `bridge/state/gate-alerts.js`, `dashboard/server.js` (`readQaStage`, `/api/gate-health`), `renderQaStage` | Rules 1-3; minimal backlog readout; switch-over | D |
| `dashboard/server.js` (lock, dispatch, dialog, on-main), `lcars-dashboard.html` (button, dialog, DevOps Station tracks), `.github/workflows/promote.yml`, `scripts/tests-needed.js` | Rule 4; CHECK and its overlay, `author-ac-test.js`, `.drafts`, `AC-DECISIONS.json` retired | E |
| `dashboard/server.js`, `lcars-dashboard.html` | Red report v1 | F |
| `lcars-dashboard.html`, History | Julian's board; waited-for-Julian time | G |
| Locked contracts (`slice-lifecycle.md`, `slice-pipeline.md`, `test-update-gate-trailers.md`, `ac-custody.md`, `slice-format.md`, `done-report-format.md`) and `.claude/CLAUDE.md` | One merged patch document that supersedes the unapplied 09-07 proof-lanes draft and includes staged 369's patch. It covers: one-at-a-time and the mutex; "the stage runs both suites"; the two red exits and Promote refusing on IN_QA red; "Julian never edits a safety-net test"; information-only for regression updates; the second signature (Nog for Sam, Philipp at the merge dialog for Julian); the ci.yml rows and "which run counts"; the new-criteria drain feed; the `QA-For`, `Covers` and `T<N>:` conventions; the FAIL-CLOSED row | Philipp applies |
| `docs/adr/ADR-PROOF-LANES.md` | Rows named under Amends point here | Taylor |
| `.claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md` | Amendment note | Chris |
| Role files and prompts: `bashir/ROLE.md` (Philipp applies), `rom/ROLE.md`, `nog/ROLE.md`, `bridge/nog-prompt.js`, Sam's DONE template (`orchestrator.js:2936-2948`), `obrien/slice-body-template.md` | Drop "GitHub runs the suite … Alex gets a fix request" and "Julian's stage runs both suites". In `bashir/ROLE.md` also amend "The Hard Rule — information, not code" and the `e2e/`-only write scope (ROLE.md:20-41) to the two ruling changes | B and D |
| Docs | `HOW-A-SLICE-TRAVELS.md`, `RUNBOOK-PUSH-AND-MERGE.md`, `RUNBOOK-BASHIR-GATE.md`, journeys `J-recovery-mutex-orphan.md` and `J-merge-button-pass.md` | Taylor, with D and E |
| Tests that pin the old model | D: `j-julian-stage-in-qa` (363-ac-1/2/4/5/7, trap-2/3), `j-authoring-containment` (retarget ac-2/ac-3 to the bench; retire the rest), orphaned `test/` files (deferred-during-gate, post-gate-drain, state-gate-mutex, bashir-tests-updated, gate-abort). E: `j-merge-lock-server` (361-*), `j-check-test-updates`, `j-check-authoring`, `j-check-draft-review`, `j-apply-draft` (349/356/357/358/99831-*, except its `touchesAc()` guard tests, which move with the function), `j-devops-station` (340-ac-3/4/5), `j-direct-controls-regression-coverage` (99811-ac-1), `j-merge-button-pass` (316-ac-2 becomes "checks out the input sha", at least as strict), `j-coverage-map-integrity` ac-9 pin, the lock fixtures in `j-gate-fail-retry-helpers.js` and `j-merge-button-pass-helpers.js` (seed decided cards, not AC-DECISIONS), six e2e specs that click `#check-updates-btn`. `lib/check-test-updates.js` retires with CHECK; `lib/ac-range-scan.js` and `lib/ac-reconcile.js` stay (Julian's At-risk facts and the red report use them). D: `j-no-nameless-commits` (395-ac-3) learns `T<N>:`. B: `j-red-dev-files-fix-request` (388-ac-1..5), `j-reviewer-runs-nothing` wording. G: 363-ac-8 | Each brief carries the exact trailer block below |

## 9. Order of work (Alex slices; Philipp approves one at a time)

0. **Now, by hand:** move `REGRESSION-FAILURE-dev-a092cb9.md` in Alex's inbox to `processed/`. It is
   bookkeeping, not a bug. Slice 401's landing regenerates the lock and the check turns green again.
1. **A: Checker fixes** (Rule 7). First, because the button becomes the only run.
2. **B: Quiet** (Rule 5). Small, dashboard and workflow only.
3. **C: Slice 396** (streaming session logs), already staged; the card log builds on it.
4. **D: Julian's bench, backlog, card, decision record, test landing, a minimal backlog readout in
   Ops, and the switch-over** (Rules 1-3). These ship together (a bench without its landing step
   strands his tests). Alex may split them only along lines that keep every intermediate state safe.
5. **E: The merge button** (Rule 4), including `promote.yml`, `tests-needed.js` and the DevOps Station
   rewire.
6. **F: Red report v1** (Rule 6).
7. **G: Julian's board and History polish.** Replaces staged 398.

**Custody:** each brief lists the exact trailer block per tag it retires or changes (`Test-Loosen-OK`,
`Coverage-Removed`, `AC-Change-OK`, `Spec-Owner: Philipp`). Philipp's approval of the brief is the
authorization; Sam copies the block verbatim; a gap means stop and escalate (precedent: staged 368,
trap 1).

**Restarts:** D and every other orchestrator slice need
`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`. D restarts only when no `*-IN_QA.md`
exists, no Julian process runs, `gate-running.json` is absent, `dev.deferred_slices` is empty and
`git status -- e2e regression` is clean; confirm with `launchctl print` (state = running). On its
first start D's switch-over deletes any leftover mutex file, drains deferred slices once, turns any
IN_QA slice into the first card and moves stray test files to `bridge/trash` by name. Dashboard slices
need a dashboard restart and a hard reload of the tab.

**Staged work:** withdraw 377 and 378. 398 becomes G. 396 goes before D. 397 gets a Kind letter for
test landings before approval. 368's fixed block is refreshed and it lands before E or folds into it.
369's contract patch joins the merged patch document. 401 (in review now) is compatible if D keeps
item 7 of §7.

## 10. What this record does not decide

- An automatic hand-back of a red to Alex and Sam. Philipp keeps the routing until that loop is
  friction-free; this record builds the report that makes his call quick.
- Whether Jordan reviews Julian's tests. Not now: Philipp signs Julian's weakenings; the merge run
  checks the rest.
- Rollback's own existing flaw: a revert writes no reversal trailers, so a rollback of a slice that
  added tests goes red at its own gate. Separate slice.
- The decomposition of the three giant files (still on Taylor's desk).

## 11. Review record

Revision 1 was attacked on 2026-09-24 by five independent reviewers against dev (concurrency, git and
restarts; gate integrity; fit to Philipp's words and simplicity; red-report feasibility; migration
completeness): 72 findings, 27 marked must-fix. Revision 2 changes, beyond the build constraints in §7:

- **GitHub's per-push run is switched off** instead of kept as Julian's input: it is the run in
  between Philipp rejected, it is visible in several places, and it caught no slice bug in six reds.
- **"Merge when Julian is done" is dropped**: the machine must never choose when to merge. Philipp
  sees Julian's status and chooses: merge now, or wait.
- **Julian's weakenings are signed by Philipp** at the merge dialog. In revision 1 his own trailer
  would have cleared them and the gate would have passed.
- **The red report's first version is machine-only**; the automatic re-run is dropped (GitHub already
  retries browser checks once, and a re-run would be a merge nobody pressed).
- **Cut:** overruling Julian's "no test needed" in the dialog (it is his decision), effort by lane for
  Julian, the automatic card re-run on a clash, and a new timeout number.
- **Added:** the second ruling change (Julian may read product files for regression updates), the
  switch-over rule, the test landing as its own step with a path allowlist, Julian yielding to Sam,
  and the checker fixes moved to the front.

A verification pass on revision 2 (one reviewer, all 27 must-fixes checked, eight code claims
spot-checked, all true) found 24 addressed, 3 partly, and one design flaw not on the list: a
"merge only what Julian finished" button cannot work on a straight-line dev, because Julian's tests
always land after the slices that followed. That option was replaced by Philipp's plain choice
(merge now, or wait). The same pass closed: the single Julian slot that replaces the mutex's
remaining job; Julian yielding after the fact (revert and reopen, never an ERROR); squash-only test
landings so Julian's messages never reach dev; the signature on rollback; helper changes listed for
signature; criterion text taken from the approved brief first; the `T<N>:` subject in the commit
guard; `touchesAc()` kept with its tests.

Full findings: the workflow run `wf_ce054667-f69` (journal in the session's workflow transcripts).

---
id: "388"
title: "Sam never runs the full suite; a red dev files its own fix request"
from: rom
to: nog
status: DONE
slice_id: "388"
branch: "slice/388-attempt1"
completed: "2026-09-13T13:18:25.000Z"
tokens_in: 0
tokens_out: 0
elapsed_ms: 0
estimated_human_hours: 5.0
compaction_occurred: false
---

## Summary

The full safety-net suite is off the builder, and nothing is lost by taking it: GitHub already
ran it on every push to dev, and now the dashboard reads that finished run instead of asking
an agent to re-run it. The template says so in four lines a brief cannot override. When the
newest completed ci.yml run on dev is red, the server files one fix request per commit into
Alex's inbox, records DEV_SUITE_RED, and the DevOps Station says where the request went.

Task 0 passed, but only after re-basing. This worktree arrived on `slice/388-attempt1` at
`3316434` — attempt 1's BLOCKED commit, cut from `8b6cd9d`, before Slice 387 landed. Both
`buildDoneTemplate` and `buildHashLines` are exported at `origin/dev` (`6ff793f`), so I rebased
the branch onto `origin/dev` (now `e673221`) and built there. Without that the brief's own Task 0
would have blocked a second time on a dependency that had already landed.

**Round 2 — what this round changed: one sentence of this report, and no code.** Nog's round-1
verdict is **ACCEPTED**; the round came back because the daemon could not parse it
(`nog_verdict: NOG_DECISION_REJECTED`, `nog_reason: verdict_unreadable`). That is a parser
failure between Nog and the orchestrator, not a rejection of the work, and it is Alex's to fix —
I have no way to make a verdict readable from here. Nog raised **no findings**; his one substantive
correction is a factual error in my own report, which I have fixed (the export count, below). His
remaining ten items are filed under `## Flags`, all explicitly routed by him to Philipp, Alex or
Julian, none of them changes to this code. I re-verified the whole slice at this HEAD rather than
taking the round-1 report's word for it: Task 0 (`buildDoneTemplate`, `buildHashLines` both
exported at `bridge/orchestrator.js`), 12/12 tests green, the five `@ac-hash` lines byte-identical
to the brief's list, `data-ci-fix-request` present in the shipped page, exactly one
`startDevSuiteRouting()` call site, `node --check` clean on all five changed JS files, the ci.yml
two-path list intact, and `COVERAGE.lock` regenerating byte-identically. I changed nothing else:
an accepted slice is not the place to take unasked liberties.

## What changed

- `bridge/orchestrator.js:2600` — `buildDoneTemplate` gains a `## What you run` section: four
  lines, unconditional, above the hash section.
- `dashboard/server.js` — `_getGhCi()` now carries `status` and `conclusion` raw (`state` folds
  cancelled in with failure, and a cancelled run is not a regression), routes on a `setImmediate`
  after the poll is cached, and overlays `fix_request` at read time on both the fresh and the
  cached path. New: `DEV_SUITE_STATE`, `readDevSuiteState()`, `withDevSuiteFixRequest()`,
  `_artifactFile()`, `downloadDevSuiteLog()`, `routeDevSuiteRun()`, `_writeDevSuiteState()`,
  `startDevSuiteRouting()`. Four of those plus the constant are exported —
  `routeDevSuiteRun`, `startDevSuiteRouting`, `withDevSuiteFixRequest`, `readDevSuiteState`,
  `DEV_SUITE_STATE`; `_artifactFile`, `downloadDevSuiteLog` and `_writeDevSuiteState` stay
  internal, because nothing outside the module has reason to reach them. `startDevSuiteRouting()`
  is called from exactly one place, the `require.main === module` block.
- `dashboard/server.js`, `getGitHubRegressionReport()` — reads `LAST-RUN.md` through
  `_artifactFile()`. **This was load-bearing, not tidying:** `upload-artifact@v4` keeps each entry
  relative to the common ancestor of the matched paths, so adding a second path moves
  `LAST-RUN.md` down into `regression/` inside the artifact. Left alone, every artifact built after
  this slice would have read as missing and the Coverage panel would have silently fallen back.
  Both layouts are now accepted, so pre-388 and post-388 runs both report.
- `scripts/regression-report.js` — `main()` behind `if (require.main === module)`;
  `module.exports = { parse, renderObrienHandoff, OBRIEN_INBOX }` (constant keeps its name for 378);
  `renderObrienHandoff` takes an options argument `{ persistent, sha, runUrl, note }`. With no
  options the output is byte-identical — verified against the pre-change function from `HEAD` over
  two inputs, not just asserted.
- `.github/workflows/ci.yml:76` — the artifact `path:` is a two-line list carrying
  `bridge/state/regression-stdout.log` beside `regression/LAST-RUN.md`.
- `dashboard/lcars-dashboard.html` — `#gflow-ci` appends the fix-request span from
  `ci.fix_request`; in `renderTopoMini` the `ci.state === 'failing'` branch moved above
  `prStatus === 'idle' && ghAhead > 0` (moved, not copied — the now-unreachable copy further down
  was removed).
- `.gitignore:92-95` and `bridge/state/seed-runtime-state.js:133` — the ledger and the per-commit
  requests never sit untracked in the live tree.
- `regression/observability/j-red-dev-files-fix-request.test.js` (added, 12 tests).
- `regression/COVERAGE.lock` regenerated (595 → 610 guards; every added entry names this one new
  test file), `regression/AC-MANIFEST.lock` regenerated in the second commit.

## Acceptance criteria verification

Command for all five, run once per revert step described under Safety-net tests:
`node --test regression/observability/j-red-dev-files-fix-request.test.js` → **12 tests, 12 pass, 0 fail.**

- **slice-388-ac-1** — `j-red-dev-files-fix-request.test.js:107`. Parses the section between
  `## What you run` and the next heading, asserts the list is 1–4 items, and asserts each clause.
  Green with the fix; red with `bridge/orchestrator.js` reverted.
- **slice-388-ac-2** — `:138`. One red run polled six times: one `REGRESSION-FAILURE-dev-aaaaaaa.md`,
  one `DEV_SUITE_RED` whose `failing` names both parsed checks, and no `ts` (that is
  `writeRegisterEvent`'s to stamp). The file names the commit, the run and who clears it.
- **slice-388-ac-3** — `:176`. Red, then a green on a newer sha polled six times: exactly one
  `DEV_SUITE_GREEN`, the red's request still on disk, the red not re-routed.
- **slice-388-ac-4** — `:196`. `fix_request` is null before routing, `{sha7, file}` after, null for a
  cancelled run (which `_getGhCi` reports as `state: 'failing'`), and null after a green. Also
  asserts the panel reads `ci.fix_request` rather than the colour.
- **slice-388-ac-5** — `:227`. With `gh` unavailable the run object is null: `withDevSuiteFixRequest`
  returns null unchanged (not an empty object — the panel must not start seeing an object where it
  saw nothing), nothing is routed, no file, no event, no state file, no download.

## Safety-net tests

`regression/observability/j-red-dev-files-fix-request.test.js` — 12 tests. Five criteria, five
traps, and two for tasks that carry no criterion of their own: task 5 (the local gate's
`REGRESSION-FAILURE.md` is untouched) and task 4's mini-pill ordering. Every routing test runs on
injected seams — fake run, fake download, temp state file, temp inbox, collecting emitter — so
nothing here needs `gh`, touches the live register, or writes into the real inbox.

Trap coverage: trap 1 `:254` (red→green→red across seven polls: two requests, two REDs, one
GREEN); trap 2 `:280` (download throws / returns nothing / parses to zero failures under a red run
/ unwritable inbox); trap 3 `:317` (six polls, one download; none for green; plus the source shape
of the `setImmediate` and the unref'd timer); trap 4 `:333` (child process proving the require runs
no suite, writes nothing and does not exit); trap 5 `:359` (child process proving the require
polls nothing and writes no register line, ledger or inbox file — and, by exiting, that the
interval was unref'd).

**Break-it evidence.** Reverted the whole fix (`git checkout --` on all seven product files, test
file left in place): **12 tests, 0 pass, 12 fail.** Every new test goes red. Restored: 12/12 green.

Per-file reverts, to show each test is red for its own reason:

| reverted alone | fail / 12 | which |
|---|---|---|
| `bridge/orchestrator.js` | 1 | ac-1 |
| `dashboard/server.js` | 8 | ac-2, ac-3, ac-4, ac-5, traps 1, 2, 3, 5 |
| `scripts/regression-report.js` | 8 | ac-2, ac-3, ac-4, traps 1, 2, 3, 4, local-handoff |
| `dashboard/lcars-dashboard.html` | 2 | ac-4, mini-pill ordering |

**One test I had to replace, because the first version was hollow.** With only
`scripts/regression-report.js` reverted, the file first reported *1 test, 1 pass* — a green. The
unguarded module runs a suite and `process.exit(0)`s inside the runner, and `node --test` scores a
file whose process exited 0 before reporting as one passing test. So the module-load `require` of
the reporter was turning "the guard was removed" into a green file: the exact failure trap 4
exists to catch, hiding itself. The reporter is no longer required at the top of the file; the
tests that load it (directly, or through `routeDevSuiteRun`'s lazy require on the red path) call
`requireGuardIntact()` first, which asserts the guard from the source and fails loudly instead of
dying. That revert now reads 8 failures, as the table shows. Worth flagging to Julian: any test
file that requires a module with an unguarded entry point can report a false green this way.

**What I saw:** not a browser — the dashboard on this machine is the live one and I did not want to
restart it mid-slice. I lifted the `#gflow-ci` branch out of the shipped page and ran it on three
`ci` objects. Red with a request →
`Per-push checks (ci.yml): failing · run 51<span data-ci-fix-request="abc1234"> · abc1234 · fix request in Alex's inbox</span>`;
red without one (a cancelled run) and green → byte-identical to today's output. The e2e fixture in
`e2e/gate-button.spec.js:35` uses `ci: { state: 'passing' }` with no `fix_request`, so that spec's
`#gflow-ci` assertions are unaffected.

## Screen hooks

- **slice-388-ac-4** — `#gflow-ci`, the CI line of the pipeline strip
  (`dashboard/lcars-dashboard.html:12103`). Visible whenever the DevOps Station is expanded. I used
  the name the brief pre-named and declare the attribute it left to me:
  **`data-ci-fix-request`**, set to the sha7, on a `<span>` appended inside `#gflow-ci`. Present
  only when `ci.fix_request` is non-null; absent for a green run, for a red run with no request (a
  cancelled run), and when `gh` is unavailable. Its text reads
  ` · <sha7> · fix request in Alex's inbox`. Select it as
  `#gflow-ci [data-ci-fix-request]`, and read the sha7 from the attribute rather than the text.
- The mini pill in `renderTopoMini` keeps its existing markup and class
  (`span.ci-mini-pill.err`, text `CI ✗ failing`); only the branch order changed, so nothing new to
  select by.

## Tests moved or weakened

None. No existing safety-net test was moved, renamed, changed or removed; no browser test was
touched. The only removal in this slice is a now-unreachable `else if` branch in
`renderTopoMini` — product code, not a test — whose condition moved up the chain, and the new
test asserts `CI ✗ failing` appears exactly once so the branch was moved rather than duplicated.

## Conflicts with the brief

- **Task 7 is not mine to do.** The brief says the compatibility sentence "goes into 378's brief
  before it is approved (Alex's handoff says so)". I do not edit briefs, and there is no 378 brief
  in this worktree's queue to edit. The sentence is recorded verbatim in the commit message so it
  survives the squash: **378 must keep `parse`, `renderObrienHandoff` and `OBRIEN_INBOX` exported
  and `routeDevSuiteRun` working.** Alex still has to put it in 378's brief.
- **The artifact-layout fix was outside the listed files' stated reason.** `.github/workflows/ci.yml`
  and `dashboard/server.js` were both in scope, but the brief described the server change as the new
  routing only. Changing the artifact to two paths silently relocates `LAST-RUN.md` inside it, which
  would have broken the existing `getGitHubRegressionReport` download. I fixed that in the same
  slice rather than landing a known break; it is two lines and one helper, and it is called out
  above so Nog can see it was deliberate.
- **The brief's "How to finish" and the template I was handed disagree about the lock files.** The
  running daemon handed me the pre-387 template; the brief's own section says to run both derivers
  and commit both locks, and says to follow the section where they differ. I followed the brief:
  two commands, two commits. Slice 387's landing regeneration should produce the same bytes.
- **Metrics.** `tokens_in`, `tokens_out` and `elapsed_ms` are left at 0 for the orchestrator to
  fill, per the template I received. `estimated_human_hours: 5.0` is my honest guess.
  The brief's "How to finish" asks for positive numbers in all five because the running daemon
  files a 0 as ERROR; I could not honestly invent token counts, and Slice 386 has landed
  (`a7516df`) so the fill should now happen. If this report comes back as ERROR for that reason,
  that is the cause.

- `regression/AC-MANIFEST.lock` records the five 388 tags as `source: legacy-backfill`,
  `text: null`. That is not a defect of this slice: `slice-386-ac-1` and `slice-387-ac-1` read the
  same way in the lock on dev, because `lib/ac-range-scan` resolves trailers from
  `origin/main..origin/dev` and a branch commit is not in that range yet. Slice 387's landing
  regeneration re-derives both locks inside the landing commit, which is where they resolve. Both
  locks verified deterministic: re-running each deriver produces identical bytes.

## Flags carried forward from Nog's review

Nog's round-1 review raised ten flags and marked every one "not a finding". None is a change to
this slice's code; each is recorded here so it survives the round and reaches its owner.

*For Philipp / Alex:*

1. **Dormant until the dashboard restarts.** Nothing here runs until `startDevSuiteRouting()`
   executes in a freshly started server process. Restart the dashboard after the squash and hard-
   reload the tab. This is the same class of thing that made an earlier gate fix invisible for a
   week.
2. **The download blocks the event loop** for up to 30s, once per newly-seen red sha
   (`execFileSync` inside the `setImmediate`). The brief sanctioned `setImmediate` over an async
   `execFile`, so this is the specified design; the async `execFile` is the cheap upgrade if it
   ever shows.
3. **Worst-case routing latency is ~2 minutes, not 1.** The timer and the `_getGhCi` cache share
   the same 60s window, so a tick landing inside the TTL routes a cached value and waits for the
   next one. No acceptance criterion constrains latency — only the brief's prose says "within a
   minute". I left it alone deliberately: changing it means changing accepted, tested behaviour on
   a round that asked for no code change. Say the word and it is a small fix.
4. **The ledger holds one sha.** If `bridge/state/dev-suite.json` is lost (gitignored, and in
   `VOLATILE_EXTRA`), a still-newest red run routes again: the same filename is overwritten so the
   inbox stays at one file per commit and ac-2 holds, but a **second** `DEV_SUITE_RED` lands in the
   register. Restarts are not polls, so no criterion breaks — worth knowing before anyone counts
   `DEV_SUITE_RED` events.
5. **"0 acceptance check(s) failing"** is what the fix request says when the artifact could not be
   read, directly above "artifact unavailable; open the run". Literally correct (`failing: []`, as
   the brief specified) but it reads oddly. Nog routed the wording fix to whoever owns 378; I have
   not touched it.
6. **Two tests beyond the 5 + 5 target**, covering task 5 and task 4's mini-pill ordering — both
   real tasks with no criterion of their own. Recorded per ROLE.md.
7. **Task 7 is still open and is not mine** — see `## Conflicts with the brief`. The compatibility
   sentence is preserved in `ad01b2b`'s commit message but has to reach 378's brief before 378 is
   approved. Alex's.

*For Julian's stage:*

8. Select the hook as `#gflow-ci [data-ci-fix-request]` and read the sha7 from the **attribute**,
   not the text. Absent for green, for a cancelled run, and when `gh` is down.
9. The mini pill keeps its existing markup (`span.ci-mini-pill.err`, `CI ✗ failing`); only the
   branch order changed, so there is nothing new to select by — but a red per-push run should now
   beat "N ahead".
10. Trap 3's source assertion matches a whole line of `server.js` verbatim, braces and spacing
    included. Its behavioural half (six polls → one download) is solid; the regex half will go red
    on a pure reformat. Source-regex assertions are an established convention here, so this is a
    brittleness note rather than a defect.

## Commit

- `ad01b2b` — the seven product files, the new test file and `regression/COVERAGE.lock`, with the
  five `AC:` trailers and `Lane: core`.
- `7b86e9f` — this report and `regression/AC-MANIFEST.lock`, on `slice/388-attempt1` (rebased onto
  `origin/dev` `e673221`).
- Round 2 — this report only: the corrected export sentence, the round-2 note and the flags above.
  No product file, no test file and neither lock changed this round, so `COVERAGE.lock` still
  regenerates byte-identically and the code Nog accepted is the code being re-submitted.

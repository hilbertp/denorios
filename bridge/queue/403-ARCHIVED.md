---
id: "403"
title: "The dashboard runs as a background service that restarts itself"
from: rom
to: nog
status: DONE
slice_id: "403"
branch: "slice/403"
completed: "2026-09-24T20:24:06.000Z"
tokens_in: 52
tokens_out: 40501
elapsed_ms: 458543
estimated_human_hours: 2.5
compaction_occurred: false
tokens_cache_read: 1470466
cost_usd: 2.489043
---

<!-- ds9:sticker v1 -->

# The dashboard runs as a background service that restarts itself — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "403"
title: "The dashboard runs as a background service that restarts itself"
goal: "The dashboard has a launchd service like the orchestrator's, starts at login, and is restarted by launchd if it stops."
from: obrien
to: rom
priority: high
lane: core
created: "2026-09-24T19:15:29.208Z"
timeout_min: 20
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-24T20:17:20.803Z"
approval_sig: "c4ca06c52615efd98d585d278f84c8b56e1f55be1f7639cfa78b72a5e53d2938"
rom_session_id: "165b9029-d07c-4a49-94e8-71fc922eb66b"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-24T20:24:06.000Z"
    durationMs: 458543
    tokensIn: 52
    tokensOut: 40501
    costUsd: 2.489043
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All three ACs verified independently (plutil OK, plist diffs from the orchestrator only where the brief says so, six honest tests with matching ac-hashes); intent holds — the four host paths the plist names all exist, so the job will actually start."
total_durationMs: 458543
total_tokensIn: 52
total_tokensOut: 40501
total_costUsd: 2.489043
round: 1
---

### The dashboard runs as a background service that restarts itself

<!-- Lane: core. Adds a service definition and an install script (docs/adr/ADR-PROOF-LANES.md §2). -->

#### Goal

Philipp: "server or orchestrator or whatever service keep crashing." The dashboard is not crashing;
it has no supervisor and dies whenever the process that started it goes away. After this lands, the
dashboard has a launchd service definition like the orchestrator's, starts at login, and is restarted
by launchd if it stops.

#### Context

- The orchestrator already runs this way: `scripts/dev.denorios.orchestrator.plist`, symlinked into
  `~/Library/LaunchAgents/`. Copy its shape (EnvironmentVariables HOME and PATH, `--env-file`,
  absolute paths into `/Users/phillyvanilly/denorios/repo`, `ThrottleInterval` 30).
- The dashboard is `dashboard/server.js`, port 4747 by default (`DASHBOARD_PORT`, server.js line 8).
- Do not run the install script against your real `~/Library/LaunchAgents` or real `launchctl`;
  Alex installs it on the host after landing.

#### Out of scope

- Proposed follow-up: `scripts/start.sh` still starts its own dashboard process; reconcile it with the service.
- Proposed follow-up: a dashboard health check on the Ops header.

#### Tasks

1. Add `scripts/dev.denorios.dashboard.plist`, modelled on `scripts/dev.denorios.orchestrator.plist`.
2. Add `scripts/install-dashboard-service.sh`: symlink the plist into the LaunchAgents directory,
   unload the job if it is already loaded, load it, and print its state. The LaunchAgents directory
   and the `launchctl` command must be overridable by environment variables so a test can run it
   without touching the host.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-403-ac-1: scripts/dev.denorios.dashboard.plist passes `plutil -lint` and has Label dev.denorios.dashboard, ProgramArguments /opt/homebrew/bin/node, --env-file=/Users/phillyvanilly/denorios/repo/.env and /Users/phillyvanilly/denorios/repo/dashboard/server.js, WorkingDirectory /Users/phillyvanilly/denorios/repo, RunAtLoad true, KeepAlive true, ThrottleInterval 30, the same HOME and PATH as the orchestrator plist, and stdout and stderr in bridge/logs/dashboard.stdout.log and bridge/logs/dashboard.stderr.log.
- slice-403-ac-2: Run with the LaunchAgents directory and launchctl overridden, scripts/install-dashboard-service.sh creates a symlink to scripts/dev.denorios.dashboard.plist in that directory and loads the dev.denorios.dashboard job.
- slice-403-ac-3: Running scripts/install-dashboard-service.sh a second time succeeds, leaves exactly one symlink, and unloads the job before loading it again.

#### Files expected to change

- scripts/dev.denorios.dashboard.plist (added)
- scripts/install-dashboard-service.sh (added)
- one new safety-net test file under regression/ (added)

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-403-ac-1: scripts/dev.denorios.dashboard.plist passes `plutil -lint` and has Label dev.denorios.dashboard, ProgramArguments /opt/homebrew/bin/node, --env-file=/Users/phillyvanilly/denorios/repo/.env and /Users/phillyvanilly/denorios/repo/dashboard/server.js, WorkingDirectory /Users/phillyvanilly/denorios/repo, RunAtLoad true, KeepAlive true, ThrottleInterval 30, the same HOME and PATH as the orchestrator plist, and stdout and stderr in bridge/logs/dashboard.stdout.log and bridge/logs/dashboard.stderr.log.
    AC: slice-403-ac-2: Run with the LaunchAgents directory and launchctl overridden, scripts/install-dashboard-service.sh creates a symlink to scripts/dev.denorios.dashboard.plist in that directory and loads the dev.denorios.dashboard job.
    AC: slice-403-ac-3: Running scripts/install-dashboard-service.sh a second time succeeds, leaves exactly one symlink, and unloads the job before loading it again.

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

##### AC Check

- **slice-403-ac-1** — `scripts/dev.denorios.dashboard.plist` passes `plutil -lint`, has Label,
  ProgramArguments, WorkingDirectory, RunAtLoad/KeepAlive/ThrottleInterval, the orchestrator's
  HOME and PATH, and the two log paths → **✓ Satisfied.**
  Verified independently, not from the report. `plutil -lint scripts/dev.denorios.dashboard.plist`
  → `OK`. `diff scripts/dev.denorios.orchestrator.plist scripts/dev.denorios.dashboard.plist`
  returns exactly four hunks — Label, the third ProgramArgument, RunAtLoad, and the two log paths.
  The `EnvironmentVariables` dict is byte-identical, so "the same HOME and PATH as the orchestrator
  plist" is literally true rather than approximately true. Every key the criterion names is asserted
  in the test at `regression/recovery/j-dashboard-service.test.js:203-235`, and the log paths are
  asserted as full strings, not suffixes.

  The `RunAtLoad` divergence from the orchestrator (`true` here, `false` there) is the criterion's
  own instruction. Rom flagged it in `## Summary` rather than leaving a reviewer to find it in a
  diff. That is the right handling — not a deviation.

- **slice-403-ac-2** — run with the directory and `launchctl` overridden, the script symlinks and
  loads → **✓ Satisfied.**
  `scripts/install-dashboard-service.sh:21-22` reads `LAUNCH_AGENTS_DIR` and `LAUNCHCTL` with
  host defaults; line 41 does the link, line 52 the load. The test asserts the destination is a
  *symlink* (`lstatSync().isSymbolicLink()`), that its target is absolute, and that it resolves to
  the tracked `scripts/` plist — so a copy would fail it, and so would a link into the wrong tree.
  It also asserts `sb.dir/Library/LaunchAgents` was never created, which is what proves the override
  was honoured rather than merely accepted.

- **slice-403-ac-3** — a second run succeeds, leaves exactly one symlink, unloads before loading →
  **✓ Satisfied.**
  `test.js:258` asserts the directory contents with `deepEqual(readdirSync(...), [LABEL + '.plist'])`
  — a whole-directory equality, not a `.includes()`, so a stale second entry fails it. Ordering is
  checked by index (`loadIdx > unloadIdx`) on a log cleared between runs.

  The part worth naming: the ordering is not only asserted, it is load-bearing. The stub at
  `test.js:118-121` refuses to load an already-loaded job with exit 5, the way `launchctl` does, so
  a second run that skipped the unload dies on status before the log assertion is ever reached. Two
  independent reasons for the same test to bite is how this one should have been written.

**Screen hooks:** `## Screen hooks` present, "None", with the reason. No served file changed — the
diff touches one plist, one shell script, one regression test and the DONE report. No criterion here
touches the screen, so there is nothing to find in a page. Correct, not an omission.

##### Intent

Goal: *"a launchd service like the orchestrator's, starts at login, and is restarted by launchd if
it stops."*

`RunAtLoad true` is the first half, `KeepAlive true` the second, `ThrottleInterval 30` stops a
crash-loop from spinning. So the file says the right thing — but a plist that ticks every key and
names a path that does not exist is a service that never starts, and that is the gap this kind of
slice usually falls into. Rom claimed he checked the four host paths; I checked them myself rather
than take it: `/opt/homebrew/bin/node`, `/Users/phillyvanilly/denorios/repo/.env`,
`.../dashboard/server.js` and `.../bridge/logs` all exist. `--env-file` is a hard failure in node
when the file is missing, so that one mattered. Intent achieved — this will actually come up when
Alex loads it.

##### Code Quality Findings

None.

Notes on things I checked and found correct rather than wrong:

- `ln -sfn` at `install-dashboard-service.sh:41` — `-n` is the whole difference between replacing a
  link and writing a second plist inside the directory the old link pointed at. The comment above it
  says why, in one line, instead of leaving the flag looking incidental.
- The `list` guard at line 48 — an unconditional `launchctl unload` exits non-zero on an unknown job
  and `set -euo pipefail` would kill the very first install before it reached the load. Guarded, and
  the guard also matches the brief's wording.
- `mkdir -p` on both the agents directory and `bridge/logs` — launchd does not create the parent of
  `StandardOutPath`, and a job that fails that way fails silently.
- The hand-rolled plist reader at `test.js:44-95`. A test that shelled out to `plutil`
  unconditionally would have gone red the moment the slice hit `ubuntu-latest`. The reader handles
  the five element kinds this plist uses, self-closing `<true/>` included, and `plutil` still runs
  in addition on darwin. I traced it against the actual file: the XML declaration and DOCTYPE fall
  into a leading text token that `findIndex('plist')` steps past, and empty-string elements are
  handled. Correct, and the right call for a suite that runs on two platforms.
- No lock files committed. I checked this one specifically, because every recent slice's commit
  carries `COVERAGE.lock`/`AC-MANIFEST.lock` diffs and their absence here reads as an omission at
  first glance. It is not: `bridge/orchestrator.js:2989` instructs Rom not to touch them, and
  `bridge/orchestrator.js:9185` regenerates both at landing and folds them into the squash. Those
  diffs on prior slices are the pipeline's, not Rom's. Correct as delivered.

**Linting:** PASS. The repo has no ESLint config, so lint here is the syntax gate:
`node --check regression/recovery/j-dashboard-service.test.js` clean, `bash -n
scripts/install-dashboard-service.sh` clean. `shellcheck` is not installed in this environment, so
the shell script has not been through it — noted, not counted against the slice.

**Safety-net tests / screen hooks:** PASS.

- Ran the one file the slice adds: **6 tests, 6 pass, 0 fail.** I did not run the suite.
- **Count exact.** Three ACs, three traps, six tests. No extras to obscure which test covers which
  criterion.
- **AC tags present**, and the `@ac-hash` lines are real. I recomputed all three with `acHashOf`
  from `scripts/build-ac-manifest.js` against the `AC:` trailers on `a9adc21` — all three match
  character for character.
- **Tests behaviour, not shape.** Nothing asserts that a function exists or that a variable is
  named a certain way. Every assertion is on an observable outcome: a link's target, a directory's
  contents, an exit status, the order of two log lines.
- **Nothing pins dead code.** The slice removes nothing; the diff is 581 insertions and 0 deletions.
- **Break-it check present and better than required.** Rom lists all six going red with the two
  files removed, and then a five-way mutation table showing each test bites for its own distinct
  reason — including the `-sfn` → `-sf` mutation reddening trap 1 *only*. Removing the fix proves
  the tests need the files to exist; the mutation table is what proves they test the behaviour. I
  read the trap 1 assertion to confirm the claim stands on its own: with plain `ln -sf` the plist
  lands inside the decoy directory and `deepEqual(readdirSync(decoy), [])` fails. It does.
- **Trailers:** none required. `## Tests moved or weakened` says None and the diff agrees — no test
  weakened, removed, skipped, renamed or retagged, so there is nothing for the Test-Update Gate to
  ask for.
- **Report shape:** all seven required headings present.

**Scope:** clean. Four files, all additions. Three are exactly the brief's "Files expected to
change"; the fourth is the DONE report, which the contract requires. No file outside the slice was
touched and no existing file lost content.

**Lane:** core, satisfied — one test per criterion plus one per trap, the break-it list under
`## Safety-net tests`, and the seven headings.

##### Flags (not findings)

*For O'Brien:*

1. **The brief carried no trap list.** It says "plus one for each trap" but never enumerates them,
   so the three traps on this slice are Rom's own. They are well chosen — each pins a distinct real
   failure mode rather than three angles on one — but the trap count here was the implementor's call,
   not the brief's, and that is worth knowing when reading the count back.

2. **AC-1's test couples the dashboard to the orchestrator plist.** `deepEqual(p.EnvironmentVariables,
   orch.EnvironmentVariables)` is the criterion as written, and it usefully keeps the two in sync.
   The consequence is that changing the orchestrator's PATH will red a *dashboard* test, and renaming
   or deleting `scripts/dev.denorios.orchestrator.plist` will hard-fail it. Intended behaviour, but
   somebody will be surprised by it eventually.

3. **`scripts/hooks/pre-commit` is tracked mode 100644, so git is not running it.** Rom hit this
   while committing and flagged rather than fixed it, which was right — it is outside this slice and
   needs `git update-index --chmod=+x` under `core.fileMode=false`. Routing it on as its own item:
   Layer 1 of the code-write enforcement in CLAUDE.md is currently inert.

*For Alex, at install time:*

4. **Port 4747 must be free before `launchctl load`.** `scripts/start.sh:73` still spawns its own
   dashboard — explicitly out of scope, and Rom correctly left it alone. But if a dashboard is
   already listening on 4747 when the agent loads, the launchd job cannot bind, and `KeepAlive` will
   retry it every 30 s into `bridge/logs/dashboard.stderr.log` — which would look exactly like the
   crashing this slice exists to stop. Stop the running dashboard first (`scripts/stop.sh`, or kill
   whatever holds 4747), then load. This is the follow-up the brief already named, surfaced here
   because it lands on whoever installs.

5. **Run the installer from the real repo, not a worktree.** `install-dashboard-service.sh:17`
   derives `REPO_ROOT` from the script's own location for `mkdir -p "$REPO_ROOT/bridge/logs"`, while
   the plist hardcodes `/Users/phillyvanilly/denorios/repo/bridge/logs/`. Those agree on the
   supported path and diverge from a worktree, where the mkdir would create the wrong logs directory
   and trap 3's protection would not cover the path launchd actually writes to. Not reachable as
   installed; worth a line if a later slice generalises the installer.

---

*Reviewed by Nog — Round 1 — 2026-09-24*

## Rom's DONE report

#### Summary

The dashboard now has a launchd agent of its own, modelled on the orchestrator's, plus a
re-runnable install script for it.

The premise in the brief holds: the dashboard was not crashing. It had no supervisor, so it
died with whatever terminal or script started it and nothing brought it back. `scripts/start.sh`
still spawns its own dashboard process — reconciling that with the service is listed as a
follow-up and I left it alone.

The one deliberate difference from the orchestrator plist is `RunAtLoad`: the orchestrator has
it `false`, the dashboard has it `true`, because the dashboard should be up whenever Philipp is
logged in rather than only when someone loads it by hand. AC-1 asks for `true`, so this is the
brief's call, not mine; I mention it because "modelled on the orchestrator's" and "RunAtLoad
true" pull in opposite directions and a reviewer diffing the two files will see it.

Nothing on the host was touched. I did not run `launchctl`, and did not write to
`~/Library/LaunchAgents`. The tests install into a tmpdir against a stub `launchctl`, and set
`HOME` to that tmpdir as well, so even a regression that ignored the overrides could not reach
the real agents directory. Alex installs it on the host after landing.

Two notes for whoever installs it:

- Run it as `bash scripts/install-dashboard-service.sh`. Every script in `scripts/` is tracked
  mode 100644 and this repo has `core.fileMode=false`, so the exec bit does not survive a
  clone; my script is consistent with `orch-start.sh` and its siblings rather than the exception.
- Unrelated and out of scope, but I hit it while committing: git printed *"The
  'scripts/hooks/pre-commit' hook was ignored because it's not set as executable."* That hook is
  Layer 1 of the code-write enforcement in CLAUDE.md, and at mode 100644 git is not running it.
  Flagging rather than fixing — it is not this slice's scope, and `core.fileMode=false` means it
  needs `git update-index --chmod=+x`, which is a decision for O'Brien.

#### What changed

- **`scripts/dev.denorios.dashboard.plist`** (added) — the orchestrator plist with the
  dashboard's entry point (`dashboard/server.js`), its own log paths
  (`bridge/logs/dashboard.{stdout,stderr}.log`), `Label dev.denorios.dashboard`, `RunAtLoad
  true`, `KeepAlive true`, `ThrottleInterval 30`, and byte-identical `EnvironmentVariables`
  (`HOME`, `PATH`). The `PATH` matters: a launchd job does not inherit a login shell's, and
  `/opt/homebrew/bin` is where the `node` in `ProgramArguments` lives.

- **`scripts/install-dashboard-service.sh`** (added) — symlinks the plist into the LaunchAgents
  directory (a symlink, not a copy, so editing the tracked file in `scripts/` is enough and
  nothing has to be re-copied), creates that directory and `bridge/logs/` if missing, warns when
  `.env` is absent, unloads the job if it is already loaded, loads it, and prints its state.
  `LAUNCH_AGENTS_DIR` and `LAUNCHCTL` override the two host-touching pieces.

- **`regression/recovery/j-dashboard-service.test.js`** (added) — six tests: one per acceptance
  criterion, one per trap.

I verified the four host paths the plist names all exist — `/opt/homebrew/bin/node`,
`/Users/phillyvanilly/denorios/repo/.env`, `…/dashboard/server.js`, `…/bridge/logs` — so the
job will actually start when Alex loads it. `--env-file` is a hard failure in node when the
file is missing, which is why the install script warns about it up front.

#### Acceptance criteria verification

- **slice-403-ac-1** — Met. `plutil -lint scripts/dev.denorios.dashboard.plist` → `OK`. Every
  named key is asserted by the test: `Label`, the three `ProgramArguments` in order,
  `WorkingDirectory`, `RunAtLoad true`, `KeepAlive true`, `ThrottleInterval 30`, both log paths,
  and `EnvironmentVariables` compared by `deepEqual` against the orchestrator plist's.

  One thing to know about how it is guarded: CI is `ubuntu-latest`, where `plutil` does not
  exist. A test that shelled out to `plutil` unconditionally would have gone red the moment the
  slice landed on dev. So the test parses the plist itself — a ~50-line reader for the five
  element kinds a launchd agent uses — and runs `plutil -lint` *in addition* where the binary is
  present. The criterion is guarded on every platform; the literal `plutil -lint` claim is
  verified on macOS, including in this session.

- **slice-403-ac-2** — Met. Run with `LAUNCH_AGENTS_DIR` and `LAUNCHCTL` pointed at a tmpdir,
  the script leaves a symlink at `<dir>/dev.denorios.dashboard.plist` whose target is absolute
  and resolves to `scripts/dev.denorios.dashboard.plist`, and the stub records
  `load <dir>/dev.denorios.dashboard.plist` and ends with the job in its loaded set.

- **slice-403-ac-3** — Met. Second run exits 0, the directory holds exactly one entry (asserted
  as a whole-directory `deepEqual`, not a "contains"), it is still a symlink to the tracked
  plist, and the stub's log shows `unload` before `load`.

  The unload ordering is not only asserted on the log, it is load-bearing: the stub refuses to
  load an already-loaded job with `service already loaded` and exit 5, the way launchctl does.
  A second run that skipped the unload would exit non-zero and fail the test on status alone.

#### Safety-net tests

`regression/recovery/j-dashboard-service.test.js` — 6 tests, all passing. This is the only file
I ran; I did not run the suite.

    ✔ slice-403-ac-1 the dashboard plist is a valid launchd agent that starts at login and is kept alive
    ✔ slice-403-ac-2 the install script symlinks the plist into the LaunchAgents directory and loads the job
    ✔ slice-403-ac-3 a second install succeeds, leaves exactly one symlink, and unloads before it loads
    ✔ J-dashboard-service — trap 1: an existing symlink is replaced, not followed into the directory it points at
    ✔ J-dashboard-service — trap 2: a first install does not unload a job that was never loaded, and does not abort
    ✔ J-dashboard-service — trap 3: the LaunchAgents directory is created when it does not exist yet

**The traps**

1. **`ln -sf` follows an existing symlink.** If the destination is already a link pointing at a
   directory, `ln -sf` writes the new plist *inside* that directory and the stale link survives
   — one entry in LaunchAgents, pointing at the wrong thing, and the job keeps loading the old
   plist. `ln -sfn` replaces the link itself. The test pre-creates the destination as a link to
   a decoy directory and asserts the decoy stays empty.

2. **Unloading a job that was never loaded aborts the install.** `launchctl unload` exits
   non-zero on an unknown job, and under `set -euo pipefail` that kills the script *before* the
   load — so the very first install on a new machine would install nothing and the failure would
   look like a launchctl problem rather than a script bug. Guarded with `launchctl list`, which
   also matches the brief's wording ("unload the job **if it is already loaded**").

3. **A fresh machine has no LaunchAgents directory.** `ln` into a missing directory fails. The
   install script `mkdir -p`s it, and `bridge/logs/` too — launchd will not create the parent of
   `StandardOutPath`, and a job that fails that way fails silently.

**Fix-undone check.** Required: stash the fix, confirm every new test goes red. My fix is two
new untracked files, and the stash stack is shared with the main checkout and the other
worktrees, so I moved both files to a scratch directory outside the worktree instead of pushing
onto it, and moved them back. Same effect, no risk to another session's work.

With `scripts/dev.denorios.dashboard.plist` and `scripts/install-dashboard-service.sh` removed,
**all six went red** (`tests 6 / pass 0 / fail 6`), and all six went green again on restore.

That check only proves the tests need the files to exist, so I also mutated the restored fix
five ways to confirm each test bites for its own reason. Each mutation was reverted immediately
and the file ends the session green:

| Mutation | Went red |
|---|---|
| `ln -sfn` → `ln -sf` | trap 1 only |
| drop the `list` guard, unload unconditionally | ac-2, ac-3, trap 1, trap 2, trap 3 |
| drop `mkdir -p "$LAUNCH_AGENTS_DIR"` | ac-2, ac-3, trap 2, trap 3 (not trap 1, which pre-creates the directory) |
| remove the unload block entirely | ac-3 only |
| `RunAtLoad` `true` → `false` (i.e. copied from the orchestrator unchanged) | ac-1 only |

**Browser.** I did not look. This slice adds a plist and a shell script and changes no served
file — there is nothing on screen to look at. The dashboard's own behaviour is untouched;
launchd only changes who starts it.

#### Screen hooks

None. No served file changed, so there is no new selector, route or rendered state for Julian
to drive. The slice's observable effect is a process staying up across a logout, which is not a
browser assertion.

If Julian wants an anchor later, the follow-up already named in the brief — a dashboard health
check on the Ops header — is the thing that would put this on screen. It is out of scope here.

#### Tests moved or weakened

None. No existing test was moved, renamed, retagged, weakened or skipped. The slice adds one new
file and touches no other test.

#### Commit

`a9adc21` on `slice/403` — *S403: the dashboard runs under launchd — it starts at login and
comes back when it stops*

    scripts/dev.denorios.dashboard.plist              33 +++
    scripts/install-dashboard-service.sh              57 +++++
    regression/recovery/j-dashboard-service.test.js  313 +++++++++++++++++++

All three acceptance criteria are declared as `AC:` trailers on that commit, alongside
`Slice-Id`, `Slice-Branch` and `Lane`. No lock files were regenerated and no
`regression/*.lock` was edited — the pipeline rebuilds them when the slice lands.

## Nog's verdict and review

_None recorded._

## Julian's result

### Julian's stage — result

**No browser test added, none moved.** Browser suite unchanged: **54 tests in 21 files**
(`npx playwright test --list`, the lister, not a run). Nothing under `e2e/` was written.

That is the correct outcome, and it is also the least interesting thing this stage found. The
slice ships a launchd service definition; its whole observable is a process staying up, which is
not a fixture-server assertion. But it *is* an observable, and the packet handed me the running
product — so instead of writing nothing and arguing from the file list, I went and looked at the
host. **The goal is achieved, and I can show it.**

#### Which criteria have a browser test

| Criterion | Browser test | Why |
|---|---|---|
| slice-403-ac-1 | none | No screen. The criterion is the contents of a `.plist` file. Nothing about it is served, routed or drawn. |
| slice-403-ac-2 | none | No screen. A shell script run with `LAUNCH_AGENTS_DIR` and `LAUNCHCTL` overridden, asserted on a symlink and a stub's log. There is no page in it. |
| slice-403-ac-3 | none | No screen. Same script, second run, asserted on a directory listing and a call order. |

**Screen hooks used: none, because the sticker declares none and I agree with it.** Packet item 4
lists six changed files and I confirmed the same six myself from the squash commit on dev
(`git diff --name-status d1a57e8^ d1a57e8`, names only): `scripts/dev.denorios.dashboard.plist`,
`scripts/install-dashboard-service.sh`, `regression/recovery/j-dashboard-service.test.js`,
`regression/AC-MANIFEST.lock`, `regression/COVERAGE.lock`, `bridge/queue/403-ARCHIVED.md`. Not one
file the product executes to draw a page. Nothing under `dashboard/`, nothing under `lib/`. A slice
that moved no served file cannot have moved the screen, so there is no rendered state to catch and
no existing browser test that should be red from it.

The two `.lock` files were considered and rejected as a surface, as on slice 404: they grew because
the slice added tagged tests, and no criterion here mentions a manifest, a count or a panel. A test
there would be a test with no acceptance criterion.

#### The tempting browser test, and why it is not one

Worth naming, because it is the obvious one. The goal says the dashboard "is restarted by launchd
if it stops", and the dashboard is the very product I drive in a browser. So: load a page, kill the
process, load it again. That is a real journey shape — and it is still not mine, for three separate
reasons, any one of which is enough:

1. **My tests run against the fixture server the suite starts itself** — `playwright.config.js`
   boots its own `node dashboard/server.js` on port **4799** against a tmpdir fixture root. That
   server is a Playwright child process. It is not under launchd and never will be, so a test there
   could not exercise the thing the criterion is about.
2. **The live dashboard on 4747 is for looking, not for testing against** — and a test that kills
   the host's dashboard to watch it come back is destructive host manipulation, not a browser
   assertion.
3. **No criterion asserts it.** The install is explicitly out of my slice's scope ("Alex installs it
   on the host after landing"). All three ACs stop at "the file is right" and "the installer is
   right". A test for the un-asserted half would be a test with no AC.

#### So I looked at the host instead — and the goal is live

Read-only throughout. I ran `launchctl list` and `launchctl print` and nothing else: **I installed
nothing, loaded nothing, unloaded nothing and killed nothing.** The install had already happened
(the symlink is dated 23:29, minutes after the slice landed).

`ls -la ~/Library/LaunchAgents/` shows it is a **symlink**, not a copy, resolving to the tracked
file — which is ac-2's shape, observed on the real host rather than in a tmpdir:

    lrwxr-xr-x  dev.denorios.dashboard.plist -> /Users/phillyvanilly/denorios/repo/scripts/dev.denorios.dashboard.plist

`launchctl print gui/501/dev.denorios.dashboard` then reports the job **as launchd loaded it**. This
is a genuinely independent instrument: Rom asserted the plist with a hand-rolled reader, Nog diffed
it against the orchestrator's, and I never opened it at all — I read back what launchd made of it.

| ac-1 clause | what the loaded job reports |
|---|---|
| Label `dev.denorios.dashboard` | the job exists at `gui/501/dev.denorios.dashboard` |
| ProgramArguments: node, `--env-file=…/.env`, `…/dashboard/server.js` | `arguments = { /opt/homebrew/bin/node, --env-file=/Users/phillyvanilly/denorios/repo/.env, /Users/phillyvanilly/denorios/repo/dashboard/server.js }` — those three, in that order |
| WorkingDirectory `…/repo` | `working directory = /Users/phillyvanilly/denorios/repo` |
| RunAtLoad true | `properties = keepalive \| runatload \| inferred program` |
| KeepAlive true | same line — and see `runs = 2` below |
| ThrottleInterval 30 | `minimum runtime = 30` |
| the same HOME and PATH as the orchestrator | both jobs report `HOME => /Users/phillyvanilly` and the identical seven-entry `PATH` |
| stdout/stderr in `bridge/logs/dashboard.{stdout,stderr}.log` | `stdout path` / `stderr path` are exactly those two |

`plutil -lint` is Nog's check and I did not repeat it; launchd parsed the file and is running it,
which is the practical superset.

**The restart actually happened.** The job reports `runs = 2`, `last terminating signal = Killed: 9`,
`state = running`, `pid = 16369` — and `bridge/logs/dashboard.stdout.log` carries the boot banner
**twice**. An instance of this job was SIGKILLed and launchd started it again. `ps` confirms 16369 is
parented by **PID 1**, `lsof` confirms it is what holds `127.0.0.1:4747`, and `curl` gets **HTTP 200**.

Two honest limits on that, because it is the centrepiece and I would rather under-claim it:

- **I did not cause the kill.** This is opportunistic evidence, not a controlled experiment. Almost
  certainly it is Alex freeing port 4747 — exactly Nog's flag 4 — and the fact that launchd put the
  dashboard straight back is the goal behaving, observed rather than asserted.
- **"Starts at login" is attested by the `runatload` property, not by a logout/login cycle.** I did
  not reboot the host. The mechanism is loaded; the event has not been witnessed by me.

Two things this closes for whoever reads Nog's flags:

- **Flag 4 (port 4747 contention) did not materialise.** `bridge/logs/dashboard.stderr.log` is
  **0 bytes** — no bind failure, no 30-second `KeepAlive` retry loop — and `pgrep` finds exactly one
  `dashboard/server.js` process, the launchd one. There is no second dashboard from `scripts/start.sh`
  competing for the port right now. The unreconciled follow-up the brief names has, however, already
  cost one SIGKILL; anyone who runs `scripts/start.sh` next will spawn a second server that cannot
  bind. That is evidence for the follow-up, not a defect in this slice.
- **Rom's one deliberate divergence is real and visible.** The dashboard reports
  `properties = keepalive | runatload`; the orchestrator reports `properties = keepalive` with no
  `runatload`. Rom flagged this in `## Summary` rather than leaving it to be found in a diff, and it
  reads back correctly from the running system.

#### Safety-net tests the break-it check named hollow

**None named — the check has not run.** Packet item 8 says the break-it script is the next slice in
this set, so all six of Rom's tests are **unconfirmed by machine** at this stage. Rom's own by-hand
result (all six red with both files removed, plus a five-way mutation table) and Nog's independent
reproduction of the trap-1 mutation are what stand behind them today. I did not run the check by
hand; that is not mine to run.

One forward-looking note for the break-it slice, since I filed the blind-spot handoff on slice 404
and this slice is the contrasting case: **the standard recipe works here.** After classification the
product-file set is non-empty — the plist and the install script are both *added* by this slice, so
`git checkout <sha>^ -- <product files>` removes them and every test that reaches for them must go
red. That matches what Rom reports. It also confirms the rule I proposed on 404 (stop classifying
`regression/*.lock` as product) is safe: strip the two `.lock` files from the set here and slice 403
still has two genuine product files left, so the normal case is unaffected and only the
empty-delta case changes behaviour.

#### Suite results

Both are the stage machinery's single counted run on dev, after this result and my
`tests-updated` signal. I ran neither, and my browser suite has no vote on any criterion of this
slice — every one of them is adjudicated by Rom's safety-net file.

One piece of independent evidence landed while I worked, and it is fair to record it: at
20:30:27Z the register took `DEV_SUITE_GREEN` for `d1a57e8` — this slice's squash — from GitHub
run [36055229644](https://github.com/hilbertp/denorios/actions/runs/36055229644). That is the
`ci.yml` push run, which my role file calls a warning light and not a counted run, so it decides
nothing. It is the same suite on the same sha, green, from a source that is not me, not Rom and
not Nog. The counted run still follows this result.

#### Every file I read

Test code and records only. **No product source file was opened at any point** — not
`scripts/dev.denorios.dashboard.plist`, not `scripts/install-dashboard-service.sh`, not
`regression/recovery/j-dashboard-service.test.js`, not `dashboard/server.js`, and nothing under
`dashboard/`, `lib/` or `bridge/*.js`.

- `.claude/roles/bashir/ROLE.md`, `.claude/roles/bashir/LEARNING.md` — my anchor and calibration.
- `bridge/queue/403-IN_QA.md` — this sticker (headings and tail).
- `bridge/queue/404-ARCHIVED.md` and my own
  `.claude/roles/obrien/inbox/HANDOFF-BREAKIT-EMPTY-PRODUCT-DELTA-FROM-BASHIR.md` (via `git show`) —
  last stage's precedent.
- `e2e/seed-fixture.js` — my own file. Checked deliberately: an always-on supervised dashboard now
  writes to the live repo continuously, so I wanted to know whether the fixture copies anything it
  touches. It copies `.claude/`, `regression/`, `docs/` and every `.js` under `bridge/`, then
  overwrites all `bridge/` JSON state deterministically into `os.tmpdir()/lob-e2e-fixture`. The
  dashboard writes `.json` and queue files, all of which the fixture replaces. **No new flake source
  for my suite from this slice.**
- `playwright.config.js` — browser-suite configuration (test infrastructure; it configures `testDir`
  and the fixture webServer). Listing it for completeness: it is where the port 4799 / 4747
  separation above comes from.
- `bridge/logs/dashboard.stdout.log`, `bridge/logs/dashboard.stderr.log` — runtime output, not source.
- Git metadata only: `git diff --name-status` (names) and `git log --format` (the `AC:`/`Slice-*`
  trailers). No diff content was displayed at any point.

#### Exit taken

**None — not red.** No criterion of this slice failed, none was unclear, and no browser test was
needed to reach that. No handoff written: Nog already routed the `scripts/hooks/pre-commit` mode
item and the `start.sh` reconciliation on, and the break-it note above belongs attached to a slice
that is already coming rather than in a second letter.


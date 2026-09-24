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

## Summary

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

## What changed

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

## Acceptance criteria verification

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

## Safety-net tests

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

## Screen hooks

None. No served file changed, so there is no new selector, route or rendered state for Julian
to drive. The slice's observable effect is a process staying up across a logout, which is not a
browser assertion.

If Julian wants an anchor later, the follow-up already named in the brief — a dashboard health
check on the Ops header — is the thing that would put this on screen. It is out of scope here.

## Tests moved or weakened

None. No existing test was moved, renamed, retagged, weakened or skipped. The slice adds one new
file and touches no other test.

## Commit

`a9adc21` on `slice/403` — *S403: the dashboard runs under launchd — it starts at login and
comes back when it stops*

    scripts/dev.denorios.dashboard.plist              33 +++
    scripts/install-dashboard-service.sh              57 +++++
    regression/recovery/j-dashboard-service.test.js  313 +++++++++++++++++++

All three acceptance criteria are declared as `AC:` trailers on that commit, alongside
`Slice-Id`, `Slice-Branch` and `Lane`. No lock files were regenerated and no
`regression/*.lock` was edited — the pipeline rebuilds them when the slice lands.

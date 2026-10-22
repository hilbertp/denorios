# The quick start works on a fresh clone

<!-- Lane: surface (docs/adr/ADR-PROOF-LANES.md). A document says what is true. Shakedown slice 4 of 5. -->

## What is broken / Goal

`README.md` tells a newcomer to clone and run `./scripts/start.sh`. On a fresh clone that fails: `start.sh` starts the orchestrator with `node --env-file=.env`, and no `.env` exists. Worse, if a reader creates an empty one, the orchestrator runs with `DS9_USE_GATE_FLOW` unset and merges accepted slices straight to `main`, bypassing dev and the promote gate. The README also omits the OAuth token the headless agents need, the browser install Julian's stage needs, and that the launchd scripts are macOS-only. After this lands, following the README on a clean Linux, WSL or macOS machine brings the pipeline up in gate-flow mode.

## Why (evidence)

- `scripts/start.sh:67-73`: `node --env-file="$REPO_ROOT/.env" bridge/orchestrator.js`; Node exits with ENOENT when the file is missing. The comment above it: "--env-file is load-bearing: without it DS9_USE_GATE_FLOW is unset and acceptAndMerge takes the legacy direct-to-main path".
- `bridge/orchestrator.js:4401`: `USE_GATE_FLOW = process.env.DS9_USE_GATE_FLOW === '1'`; `:7097` guards on the same.
- `.env.example`: `CLAUDE_CODE_OAUTH_TOKEN` "REQUIRED for headless claude -p", from `claude setup-token`, "NOT an Anthropic API key"; `DS9_USE_GATE_FLOW=1`.
- `README.md:56-62` ("Requirements") lists only Node >= 20, the `claude` CLI and `claude login`. No `.env`, no `npm install`, no Playwright, no `gh`.
- `.github/workflows/ci.yml:103-107`: the browser suite needs `npm install` and `npx playwright install --with-deps chromium`; Julian's stage runs it locally (`playwright.config.js`).
- `dashboard/server.js` requires `gh`: the merge button dispatches the promotion with `gh workflow run promote.yml --ref dev` (lines 4808 and 4927), the red report reads `gh run view` (1585, 1658), and the Regression panel downloads reports with `gh run download` (694, 868). Without `gh` nothing can be promoted to main. The README does not mention `gh` at all; the first WSL run (2026-10-22) found it absent.
- `scripts/orch-start.sh`, `orch-stop.sh` and `install-dashboard-service.sh` call `launchctl`; `start.sh` and `stop.sh` do not. The README does not say which to use on which OS.
- `bridge/orchestrator.js` `ensureIntegrationIsFresh` (line 1955) runs `git push origin dev` before every build when local dev is ahead, and every landing pushes dev. A machine without git push credentials for origin fails every approval at `worktree_setup` with `branch_creation_failed` (seen on the first WSL run, 2026-10-22, seven slices). The README never says the pipeline pushes.

## Tasks

1. In `README.md`, replace "Quick start" with steps that work on a fresh clone, in this order: clone; `npm install`; `cp .env.example .env`; put the token from `claude setup-token` into `CLAUDE_CODE_OAUTH_TOKEN` (one sentence on why an API key does not work); keep `DS9_USE_GATE_FLOW=1` (one sentence on what 0 does); `npx playwright install --with-deps chromium` (needed for Julian's stage and the promote run); `gh auth login` followed by `gh auth setup-git` so that `git push origin dev` works without a prompt (the pipeline pushes dev on every landing; `gh` also feeds the GitHub panels); a check: `git push --dry-run origin dev` prints no authentication error; `./scripts/start.sh`; open `http://localhost:4747`; stop with `./scripts/stop.sh`.
2. Add a short "Running as a service" paragraph: on macOS, `scripts/orch-start.sh` and `scripts/install-dashboard-service.sh` register launchd agents; on Linux and WSL there is no service wrapper yet, `start.sh` is the way, and the processes die with the shell session unless run under `nohup` or a terminal multiplexer.
3. Update "Requirements" to match: Node >= 20, `claude` CLI, an OAuth token, Playwright's Chromium, the GitHub CLI `gh` logged in (required: the merge button and the red report run it) with `gh auth setup-git` so git pushes without a prompt, and point to `docs/runbooks/RUNBOOK-CLAUDE-AUTH.md` for the token. On Debian and Ubuntu say to install `gh` from GitHub's apt repository, not the distribution package, which can be years old.
4. Add a "Read next" line pointing at `docs/HOW-A-SLICE-TRAVELS.md` and `docs/HISTORY.md`.

Write a safety-net test only for a criterion that asserts behaviour; otherwise write none, then stop.

## Traps

1. `README.md` is Layer-2 locked in the main tree; Sam works in his worktree as always and the landing unlocks. Nothing to do, but do not try to edit it in the main tree.
2. Do not put a real token or any secret in the README; the example value stays the placeholder from `.env.example`.

## What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

## Acceptance criteria

- slice-NNN-ac-1: `README.md` "Quick start" contains, in order, `npm install`, `cp .env.example .env`, `claude setup-token`, `DS9_USE_GATE_FLOW=1`, `npx playwright install --with-deps chromium`, `gh auth setup-git`, `git push --dry-run origin dev`, `./scripts/start.sh` and `./scripts/stop.sh`.
- slice-NNN-ac-2: `README.md` says, in one sentence each, that the token is an OAuth token and not an API key, that `DS9_USE_GATE_FLOW=0` merges accepted slices straight to main, and that the pipeline pushes `dev` to origin on every landing so the machine needs push credentials.
- slice-NNN-ac-3: `README.md` says which scripts are macOS launchd wrappers and that `start.sh` and `stop.sh` are the Linux and WSL path.
- slice-NNN-ac-4: `README.md` links `docs/HOW-A-SLICE-TRAVELS.md`, `docs/HISTORY.md` and `docs/runbooks/RUNBOOK-CLAUDE-AUTH.md`, and every path it names exists on the branch.

## Quality + goal check

- Goal check: a reader on a fresh WSL clone who follows the README reaches a running dashboard with the orchestrator in gate-flow mode.
- Quality check: one file changed; the existing sections "What you'll see", "How it works", "Roles", "Project structure", "Main-lock protocol" and "Contributing" keep their content; no test written.

## Files expected to change

- `README.md` (modified)

## Custody

No criterion is retired or reworded. No trailer is authorized or needed.

## REQUIRED — declare the ACs as commit trailers

    AC: slice-NNN-ac-1: `README.md` "Quick start" contains, in order, `npm install`, `cp .env.example .env`, `claude setup-token`, `DS9_USE_GATE_FLOW=1`, `npx playwright install --with-deps chromium`, `gh auth setup-git`, `git push --dry-run origin dev`, `./scripts/start.sh` and `./scripts/stop.sh`.
    AC: slice-NNN-ac-2: `README.md` says, in one sentence each, that the token is an OAuth token and not an API key, that `DS9_USE_GATE_FLOW=0` merges accepted slices straight to main, and that the pipeline pushes `dev` to origin on every landing so the machine needs push credentials.
    AC: slice-NNN-ac-3: `README.md` says which scripts are macOS launchd wrappers and that `start.sh` and `stop.sh` are the Linux and WSL path.
    AC: slice-NNN-ac-4: `README.md` links `docs/HOW-A-SLICE-TRAVELS.md`, `docs/HISTORY.md` and `docs/runbooks/RUNBOOK-CLAUDE-AUTH.md`, and every path it names exists on the branch.
    Lane: surface

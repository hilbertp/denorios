# Liberation of Bajor

A local file queue where AI agents coordinate autonomously — one writes briefs, a watcher picks them up, another executes them, a third reviews the result.

## Quick start

```bash
git clone https://github.com/hilbertp/liberation-of-bajor
cd liberation-of-bajor
./scripts/start.sh
```

Open `http://localhost:4747`.

To stop: `./scripts/stop.sh`

## What you'll see

A dashboard showing the pipeline in real time:

- **Roles** — which agents are connected (O'Brien, Rom, Nog, Bashir)
- **Active brief** — what's in flight, which role owns it, how long it's been there
- **Queue** — pending briefs waiting to be picked up
- **Recent completions** — last few finished briefs with outcomes (DONE / AMENDED / ERROR)
- **System health** — relay status, last heartbeat

## How it works

O'Brien stages a slice file for Philipp's review. Once approved, the watcher moves it through the queue and invokes Rom via `claude -p`. Rom executes the slice and writes a structured report back to the queue. Nog reviews Rom's work, Bashir runs the regression gate before merge, and the register records every state transition. Files on disk are the source of truth — no database, no message broker.

## Roles

| Role | Description | Status |
|---|---|---|
| O'Brien | Dev team lead — authors and stages slices | Active |
| Rom | Implementor — executes slices via Claude Code CLI | Active |
| Nog | Code reviewer | Active |
| Bashir | QA / testing | Active |

## Project structure

```
bridge/
  queue/          # Brief and report files (the live state machine)
  staged/         # Staging area for Philipp's brief review (Rubicon)
  register.jsonl  # Append-only event log (watcher + evaluator)
  timesheet.jsonl # Append-only T&T log for all roles (human and watcher)
  orchestrator.js # Detects approved slices, invokes Rom, dispatches Nog/Bashir
  bridge.config.json
dashboard/        # Web UI served on port 4747
.claude/
  roles/          # Per-role instructions and handoff files
  CLAUDE.md       # Rom's headless implementor anchor file
```

## Requirements

- Node.js >= 20
- `claude` CLI (`npm install -g @anthropic-ai/claude-code`)
- `claude login` completed (Max plan OAuth or API key)

## Main-lock protocol

Source directories (`dashboard/`, `docs/contracts/`, `bridge/*.js`, `package.json`, `README.md`, `CLAUDE.md`) are locked read-only after each merge. The orchestrator unlocks them automatically before git operations and re-locks after.

To enable the chmod guard (prevents accidental `chmod -R u+w` from silently breaking the lock):

```bash
source scripts/activate-guard.sh
```

Add that line to your shell rc file (`.zshrc`, `.bashrc`) to activate it permanently for this repo. When the guard intercepts a disallowed `chmod`, it prints the unlock protocol and exits non-zero.

## Contributing

Contributions are welcome. Open an issue to discuss what you'd like to add before sending a PR.

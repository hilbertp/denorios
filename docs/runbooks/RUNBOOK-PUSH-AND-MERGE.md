# RUNBOOK — Pushing & Merging (operating the gate by hand)

*How to take control of this box, run the Bashir gate, and land/push a merge to GitHub.
Written by Garak after bringing the gate up end-to-end on 2026-06-04 — so the next
operator doesn't relearn it the hard way.*

> **Scope / status.** This documents the **current local** operation. The `dev → main`
> merge is migrating to GitHub Actions (auto-merge on green) — see
> `ADR-GITHUB-CI-MERGE-MODEL.md` at the workspace root. Once that lands, the
> "fire the gate / local merge" sections here are superseded; the **environment**,
> **take-control**, and **push** sections stay relevant.

---

## 1. Environment facts (know these first)

- **The repo is on a FUSE mount.** Note the `.fuse_hidden*` files at the workspace root.
  Plain `git checkout` can fail to replace tracked files here — the code has
  `fuseSafeCheckoutMain()` (orchestrator.js) precisely for this. Never hand-roll a
  `git checkout main` in merge code; use the helper.
- **Remote:** `origin` = `https://github.com/hilbertp/liberation-of-bajor.git`.
  `gh` is authed via **osxkeychain** as `hilbertp` — verify with `gh auth status`.
- **The orchestrator runs under launchd** with `--env-file=.env`
  (`dev.liberation.orchestrator`, `KeepAlive=true`).

## 2. Prerequisites

- `.env` present (gitignored) with `CLAUDE_CODE_OAUTH_TOKEN` + `DS9_USE_GATE_FLOW`.
  See `.env.example` and `docs/runbooks/RUNBOOK-CLAUDE-AUTH.md`.
- `gh auth status` shows logged in.
- Hooks installed: `bash scripts/install-hooks.sh` (sets `core.hooksPath`).

## 3. The two write-protections (and how to pass them legitimately)

1. **Pre-commit hook** — any commit in the **main working tree** is rejected unless
   `DS9_WATCHER_MERGE=1` is set for that command. Worktrees (Rom, Leeta) are exempt.
   ```bash
   DS9_WATCHER_MERGE=1 git commit -m "..."     # cherry-pick / commit / merge on main or dev
   ```
2. **Filesystem lock (Layer 2)** — `scripts/lock-main.sh` makes `bridge/orchestrator.js`,
   `dashboard/`, `docs/contracts/`, `package.json`, `README.md`, `CLAUDE.md` read-only.
   ```bash
   bash scripts/unlock-main.sh    # before editing a locked file
   #   ...edit...
   bash scripts/lock-main.sh      # after
   ```
   (`mergeDevToMain` unlocks/relocks around its own merge; don't fight it.)

## 4. Taking exclusive control of the worktree  ⚠️ CRITICAL

The orchestrator **auto-respawns**, via two mechanisms:
- launchd `KeepAlive` on `dev.liberation.orchestrator`.
- The **health detector** (`com.liberation-of-bajor.health`) restarts it when it sees it down.

Plain `orch-stop.sh` / `launchctl unload` + kill is **not enough** — it comes right back.
To take it down and *keep* it down (e.g. before a manual merge that does `git checkout main`):

```bash
UID=$(id -u)
launchctl bootout  gui/$UID/dev.liberation.orchestrator    2>/dev/null
launchctl disable  gui/$UID/dev.liberation.orchestrator
launchctl bootout  gui/$UID/com.liberation-of-bajor.health 2>/dev/null
launchctl disable  gui/$UID/com.liberation-of-bajor.health
pkill -9 -f bridge/orchestrator.js ; pkill -9 -f host-health-detector
# confirm it stays down for ~5s before proceeding
```

**Restore when done:**
```bash
UID=$(id -u)
launchctl enable gui/$UID/dev.liberation.orchestrator
launchctl enable gui/$UID/com.liberation-of-bajor.health
DS9_USE_GATE_FLOW=1 bash scripts/orch-start.sh
launchctl load ~/Library/LaunchAgents/com.liberation-of-bajor.health.plist
```

## 5. Firing the gate by hand (the merge-button equivalent)

The Ops merge button hits `POST /api/gate/start` → `startGate()`. To fire it headless
without the dashboard: a script that `require`s the orchestrator (guarded by
`require.main`, so it will **not** spawn a rogue orchestrator) and calls `startGate()`.
Run it **with** `--env-file` (auth + flag) and `DS9_WATCHER_MERGE=1` (so Bashir can commit):

```bash
cat > /tmp/fire-gate.js <<'EOF'
const REPO = '/Users/phillyvanilly/01 - The Liberation of Bajor/repo';
process.chdir(REPO);
const { execFileSync } = require('child_process');
const runGit = c => { const p = c.split(' '); return execFileSync(p[0], p.slice(1), { encoding:'utf-8', cwd:REPO }); };
require(REPO + '/bridge/state/branch-state-recovery').reconcileBranchState({ registerEvent:()=>{}, log:()=>{}, runGit });
require(REPO + '/bridge/orchestrator').startGate();
EOF
DS9_WATCHER_MERGE=1 node --env-file=.env /tmp/fire-gate.js
```
The process stays alive through the gate chain (Bashir → suite → verdict → merge) and
exits when it resolves. Watch `bridge/register.jsonl`, `bridge/bridge.log`, and
`bridge/state/branch-state.json` (`gate.status`).

## 6. Pre-fire checklist

```bash
rm -f bridge/state/bashir-heartbeat.json          # clear stale heartbeat
test -f bridge/state/gate-running.json && echo "mutex HELD — clear it"   # must be free
git checkout -- bridge/state/                      # discard runtime dirt so checkout isn't blocked
```

## 7. What a green run does (the merge → GitHub)

On `regression-pass`, `mergeDevToMain` runs: discard `bridge/state/` dirt →
`fuseSafeCheckoutMain` → `git merge --no-ff dev` → **`git push origin main`** →
best-effort dev fast-forward + push → `branch-state.gate = IDLE`.
- It **pushes to GitHub `origin/main`** (osxkeychain creds).
- The `origin/dev` push is **best-effort** — a non-ff rejection is logged, not fatal.

## 8. Realigning `origin/dev`

After local `dev` surgery, GitHub's `dev` can go stale/divergent. Realign it
(its unique history is preserved on `slice/304` + tag `gate-bringup/catalog-on-dev`):
```bash
git push --force-with-lease origin dev
```

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `heartbeat_stale` ~30s after spawn | Bashir self-reported a hallucinated ts (LLMs have no clock) | liveness now uses file **mtime** (fixed). If it recurs, Bashir isn't writing the file every <90s |
| `no_tests_updated` though Bashir emitted | a corrupt `register.jsonl` line poisoned `_checkForEvent` | per-line parse guard (fixed); scan `register.jsonl` for malformed lines |
| `merge-failed: local changes would be overwritten by checkout` | gate wrote tracked runtime state mid-run | discard `bridge/state/` + `fuseSafeCheckoutMain` (fixed) |
| `push-rejected` | bad/expired gh creds, or non-ff | `gh auth status`; for `dev` use `--force-with-lease` |
| orchestrator won't stay down | health-detector respawn | `bootout` + `disable` **both** jobs (§4) |

---
*File: `docs/runbooks/RUNBOOK-PUSH-AND-MERGE.md`. Companion: `RUNBOOK-BASHIR-GATE.md`,
`RUNBOOK-CLAUDE-AUTH.md`, `docs/git-strategy.md`, `ADR-GITHUB-CI-MERGE-MODEL.md`.*

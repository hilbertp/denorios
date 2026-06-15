# HANDOFF — Promote the role-memory system to main

**From:** O'Brien (Tech Lead)
**To:** Worf (DevOps / Release Engineer)
**Date:** 2026-06-15
**Priority:** normal
**Type:** release / dev→main promotion

---

## Ask

Take the **role-memory system** from `dev` to `main` through the gated promote path (`promote.yml`). It's built, working, and worth landing for every role/session. O'Brien can't run git (role rule + the main-tree pre-commit guard), so this is yours to drive.

## What it is

A per-role long-term memory layer introduced this session:

- **`/remember` skill** (`.claude/skills/remember/SKILL.md`) — extracts durable project facts from the live context window into `.claude/roles/{role}/memory/MEMORY.md`.
- **`/compress` skill** (`.claude/skills/compress/SKILL.md`) — memory-safe replacement for `/compact`: runs remember first, then compacts.
- **Per-role load + Memory Protocol** — all 8 `ROLE.md` files now load `memory/MEMORY.md` at session start and carry a mandatory "🧠 Memory Protocol" block (run `/compress` before any compaction).
- **Seed file** — `.claude/roles/obrien/memory/MEMORY.md` (proves the system; lights up the dashboard crew-dossier "Memory" tab, which was already wired in `dashboard/server.js` and just needed the files to exist).

## The exact commit set (11 files, all under `.claude/`)

```
.claude/skills/remember/SKILL.md            (new)
.claude/skills/compress/SKILL.md            (new)
.claude/roles/obrien/memory/MEMORY.md       (new)
.claude/roles/obrien/ROLE.md                (modified)
.claude/roles/dax/ROLE.md                   (modified)
.claude/roles/nog/ROLE.md                   (modified)
.claude/roles/bashir/ROLE.md                (modified)
.claude/roles/leeta/ROLE.md                 (modified)
.claude/roles/sisko/ROLE.md                 (modified)
.claude/roles/worf/ROLE.md                  (modified)
.claude/roles/ziyal/ROLE.md                 (modified)
```

Nothing else in the dirty tree belongs to this change — exclude the `bridge/*.jsonl`, `heartbeat.json`, ziyal deliveries, etc. (pipeline/other-role churn).

## Path to main

1. **Commit to `dev`** (blocker; needs the sanctioned override — Philipp or the merge path):
   ```bash
   DS9_WATCHER_MERGE=1 git add .claude/skills/remember .claude/skills/compress \
     .claude/roles/obrien/memory \
     .claude/roles/{obrien,dax,nog,bashir,leeta,sisko,worf,ziyal}/ROLE.md
   DS9_WATCHER_MERGE=1 git commit -m "Add role memory system: /remember + /compress skills, per-role MEMORY.md, Memory Protocol"
   ```
   This becomes commit **#39** in the registry.
2. **Promote `dev` → `main`** via `promote.yml` (operator-gated). Your call on running the Bashir regression gate first — this is `.claude/`-only infra (no product-code or test-surface change), so risk is low, but follow the runbook as you see fit.

## Notes / dependencies

- **Risk:** low. All changes are under `.claude/` (skills + role docs + one seed memory file). No `dashboard/`, `bridge/*.js`, or test changes. The dashboard Memory viewer it activates was already merged previously.
- **Related but separate:** slice **315** (PreCompact hook for *automatic* memory-before-compaction) is in flight and appears to have hit a cleanup error (`bridge/trash/315-IN_PROGRESS...cleanup-ERROR`). That's a distinct deliverable (live runtime code → Rom build → Nog/Bashir gate) and should NOT be bundled into this promotion. Land the behavioral layer (this handoff) first.
- Once it's on `dev`, ping me if you want the promotion sequenced behind anything else in the queue.

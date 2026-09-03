# CLAUDE.md patch — Rom's backstop

**From:** Worf (DevOps / release)
**To:** Philipp (`.claude/CLAUDE.md` is on the Layer-2 lock list; Worf does not edit it)
**Date:** 2026-09-03
**Status:** DRAFT — awaiting Philipp
**Target file:** `/Users/phillyvanilly/denorios/repo/.claude/CLAUDE.md`

This file is a backstop, not the fix. On slice 371 the brief beat this file: Rom skipped its first instruction and followed the brief's "Guard tests, AC-tagged" and "Verify in a real browser" to the letter.
The real fix is on the brief side (O'Brien's never-ask list, the "What Rom does not do" block in every brief, the `new-slice.js` check) and in the inline DONE template Rom receives every run. Apply this patch anyway; it is the one Rom-side change that works before any slice lands.

---

## How to apply

1. `bash scripts/unlock-main.sh` (the lock scripts name `CLAUDE.md` at the repo root; the live file is `.claude/CLAUDE.md` and shows as writable today, so this may be a no-op — run it if the edit is refused).
2. Make the seven edits below. Each quotes the current line(s) exactly; replace with the "After" text.
3. Commit in the main working tree with the hook flag, by explicit path, including the Rom role file you created in change 1: `DS9_WATCHER_MERGE=1 git commit .claude/CLAUDE.md .claude/roles/rom/ROLE.md -m "CLAUDE.md: Rom role pointer, dead pointers, test rule (Worf patch 2026-09-03)"`
4. `bash scripts/lock-main.sh`

Rom's workspaces are cut from dev, so the change reaches Rom on the first slice cut after the commit is on dev. Changes 1–6 are the patch; change 7 is optional and can wait for Slice 3.

---

## Change 1 — "Your role file" row (section *Key file locations*)

Before:
```
| Your role file | `.claude/roles/obrien/ROLE.md` |
```
After:
```
| Your role file | `.claude/roles/rom/ROLE.md` |
```
Note: `.claude/roles/rom/ROLE.md` does not exist yet. The draft is at `.claude/roles/worf/drafts/role-files-2026-09-03/rom-ROLE.md`; create the live file from it when you apply this row. Until the instructions slice (Slice 3 in the O'Brien handoff) makes the orchestrator paste the role file above the brief, this row is a pointer Rom can follow, nothing more.

## Change 2 — dead rows in the *Key file locations* table

Before:
```
| Brief template | `bridge/templates/brief.md` |
| Report template | `bridge/templates/report.md` |
| Watcher | `bridge/watcher.js` |
```
After:
```
| Report format | `docs/contracts/done-report-format.md` (the DONE template itself is appended to the end of every brief) |
| Watcher (orchestrator) | `bridge/orchestrator.js` |
```
Why: `bridge/templates/brief.md` and `bridge/watcher.js` do not exist. The brief-template row is deleted rather than repointed: the only template file on disk (`bridge/templates/slice.md`) is read by nothing, and the brief spec is already reachable through the *Contract specs* row. `bridge/templates/report.md` exists but is dead (it disagrees with the template Rom actually receives) and Slice 3 deletes it or makes it identical, so the row now points at the contract instead.

## Change 3 — dead pointer in *How to read a brief*

Before:
```
Full spec: `docs/contracts/brief-format.md`.
```
After:
```
Full spec: `docs/contracts/slice-format.md`.
```

## Change 4 — dead pointer in *How to write a report*

Before:
```
Write a structured report to `bridge/queue/{id}-DONE.md` before your process exits. Use YAML frontmatter + markdown body. Full spec: `docs/contracts/report-format.md`.
```
After:
```
Write a structured report to `bridge/queue/{id}-DONE.md` before your process exits. Use YAML frontmatter + markdown body. Full spec: `docs/contracts/done-report-format.md`. The required body headings are the ones in your role file and in the DONE template block at the end of every brief.
```
Same section, one word:
```
- `DONE` — success criteria met
```
becomes
```
- `DONE` — acceptance criteria met
```

## Change 5 — the two "gate before merge" lines

Section *What this project is*, before:
```
Nog reviews the work; Bashir runs the regression gate before merge.
```
After:
```
Nog reviews the work; Julian (Bashir) writes the browser tests after the slice is on dev.
```

Section *Branch discipline*, before:
```
Rom delivers work on branches and writes DONE reports. Nog and Bashir gate the branch before merge.
```
After:
```
Rom delivers work on branches and writes DONE reports. Nog reviews the branch; Julian writes the browser tests after the slice is on dev.
```

## Change 6 — new block (section *Your role*, directly after the **Decision rights** paragraph)

Insert:
```
**Tests:** You write safety-net tests: one per acceptance criterion plus the trap list, then stop. You never write or commit a browser test. You may look in a browser and say what you saw. Your report uses the headings in your role file.
```

## Change 7 — optional, for consistency (section *The watcher injects nothing*)

Before:
```
When invoked via `claude -p`, you receive only: brief content + the path to write your report. No system preamble, no role description, no project history. This file is your anchor. Read it at the start of every brief.
```
After:
```
When invoked via `claude -p`, you receive the brief with the orchestrator's DONE template block at its end; once the instructions slice lands, your role file is pasted above the brief. No project history. This file is your anchor. Read it at the start of every brief.
```
Why: after change 6 says "the headings in your role file", a section saying "no role description" contradicts it. Skip this change if you prefer to wait until Slice 3 is on dev.

---

## What this patch does not do

- It does not make Rom obey it. The binding rules are in O'Brien's handoff (never-ask list, `new-slice.js` check, inline DONE template) and in the ruling record `.claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md`.
- It does not touch the state names, timeouts or Layer-1/Layer-2 text in the same file; those are outside this ruling.
- It does not add `.claude/CLAUDE.md` to the lock scripts; see the note in *How to apply*.

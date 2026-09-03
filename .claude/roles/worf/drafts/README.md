# Worf's drafts for Philipp

Drafts that only Philipp applies, because the target files are locked or are role files Worf does not edit. Each file says at the top what it changes and how to apply it. Ruling record: `../RULING-TEST-OWNERSHIP-2026-09-03.md`.

## contracts-2026-09-03/

| File | Target | How |
|---|---|---|
| `CONTRACT-PATCHES-FOR-PHILIPP.md` | `docs/contracts/` (six files) | Unlock, apply each quote-and-replace patch by hand, commit by explicit path, lock. Recipe at the end of the file. |
| `CLAUDE-md-patch.md` | `.claude/CLAUDE.md` | Seven before/after edits. Also creates `.claude/roles/rom/ROLE.md` from the draft below. |

## role-files-2026-09-03/

| File | Target | Why Philipp and not the role |
|---|---|---|
| `rom-ROLE.md` | `.claude/roles/rom/ROLE.md` (new) | Rom has no role file today. This one binds nothing until the instructions slice pastes it above his brief. |
| `nog-ROLE-amendment.md` | `.claude/roles/nog/ROLE.md` | Nog runs unattended and reads no inbox. |
| `bashir-ROLE-amendment-and-how-the-slice-travels.md` | `.claude/roles/bashir/ROLE.md` (Part A); Part B is the plain-language "How the slice travels" page | Julian runs unattended and reads no inbox. |

Order that works: contract patches first (they are the source of truth), then Nog's and Bashir's role files, then CLAUDE.md together with the Rom role file.

Handoffs that did not need Philipp went straight to inboxes: O'Brien (`.claude/roles/obrien/inbox/HANDOFF-TEST-OWNERSHIP-RULING-AND-PLUMBING-SLICES-FROM-WORF.md`) and Dax (`.claude/roles/dax/inbox/HANDOFF-TEST-OWNERSHIP-SETTLED-FROM-WORF.md`).

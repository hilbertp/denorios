# Slice Format — Liberation of Bajor

*Contract version: 2.0*
*Source of truth: [`slice-lifecycle.md`](./slice-lifecycle.md) (BR), [`slice-pipeline.md`](./slice-pipeline.md) (technical spec).*
*Author: O'Brien.*
*Supersedes: `brief-format.md` (v1.0, 2026-04-06).*

---

## Overview

A slice is a markdown file with YAML frontmatter, authored by O'Brien through `bridge/new-slice.js` and consumed by Rom (or Leeta). The frontmatter carries structured metadata the watcher uses to manage the lifecycle; the markdown body contains everything the implementor needs to execute the slice independently.

**O'Brien never writes frontmatter by hand.** All slices must be created via `bridge/new-slice.js`, which validates required fields, assigns the ID, and places the file in `bridge/staged/`.

**The watcher injects nothing into the implementor's context.** Every slice must be self-contained, or explicitly reference files the implementor can look up in the project filesystem.

---

## File naming

```
{id}-STAGED.md
```

- `{id}` — zero-padded three-digit sequential string (e.g. `142`). Assigned by `bridge/new-slice.js` via `watcher.nextSliceId()`.
- `STAGED` — the initial state. Subsequent state suffixes (`-PENDING.md`, `-IN_PROGRESS.md`, `-DONE.md`, `-REVIEWED.md`, `-ACCEPTED.md`, `-IN_QA.md`, `-ARCHIVED.md`) are set by the watcher as the slice progresses. See `slice-pipeline.md` §4 for the full state-to-suffix mapping.

---

## YAML frontmatter

The frontmatter block opens and closes with `---`. All keys are lowercase. Values are strings unless noted.

### Required fields

| Field       | Type   | Description                                                                                |
|-------------|--------|--------------------------------------------------------------------------------------------|
| `id`        | string | Zero-padded three-digit ID matching the filename (e.g. `"142"`). Must be quoted.           |
| `title`     | string | Short human title.                                                                         |
| `goal`      | string | One sentence describing the outcome. This is the implementor's single source of scope.     |
| `from`      | string | Always `obrien`.                                                                           |
| `to`        | string | `rom` or `leeta`. Default is `rom`.                                                        |
| `priority`  | string | One of: `normal`, `high`, `critical`. Enforced by `new-slice.js`.                          |
| `created`   | string | ISO 8601 timestamp (UTC). Written automatically by `new-slice.js`.                         |
| `status`    | string | Current state name. Initialised to `STAGED`; kept in sync with the filename suffix.        |

### Optional fields

| Field         | Type              | Description                                                                                       |
|---------------|-------------------|---------------------------------------------------------------------------------------------------|
| `apendment`   | string or null    | Prior branch name this slice reworks (e.g. `"slice/139"`). Absent / null for originals. Legacy: `amendment` accepted on read. |
| `depends_on`  | string or null    | Comma-separated IDs. Informational only — the watcher does not enforce dependency ordering.       |
| `timeout_min` | integer or null   | Per-slice inactivity timeout. `null` means the watcher default (20 min) applies.                  |

### Frontmatter example

```yaml
---
id: "142"
title: "docs/contracts: replace brief-format with slice-format"
goal: "Install the current slice file format in the contracts directory."
from: obrien
to: rom
priority: normal
created: "2026-04-16T20:00:00Z"
apendment: null
timeout_min: null
status: STAGED
---
```

---

## Markdown body

The body is freeform prose read by the implementor. The following sections are required unless their heading says otherwise (`## Traps` and `## Screen hooks` are conditional). Order them as shown.

### `## Goal`

Restates and expands the frontmatter `goal` line. What the slice achieves, in one or two sentences.

### `## Context`

Background the implementor needs. May reference:
- Project files by path (readable by the implementor).
- Prior slices by ID (the queue directory is readable).
- Decisions made by O'Brien, Sisko, Dax, or Philipp.
- Current system state relevant to the change.

Keep this section dense and factual. The implementor has access to the full project filesystem and git history, so do not repeat information already in `CLAUDE.md` or other permanent project files.

### `## Scope`

What this slice changes. Explicit directories, files, or functions. If the slice creates new files, list them.

### `## Out of scope`

What this slice does **not** change. Call out tempting adjacent work and explain why it belongs in a separate slice.

### `## Tasks`

A numbered list of concrete, verifiable steps. Each step should be specific enough that the implementor can mark it done or not done unambiguously. Include sub-tasks where helpful.

**What the brief must never ask Rom to do.** Rom follows the brief word for word (slice 371 showed a brief overrides everything else he reads), so the brief must not ask for these:

- Never "write guard tests" or "add tests" as an open task. Say instead, word for word: "Write one safety-net test per acceptance criterion, plus one for each trap, then stop."
- Never "verify in a real browser". Rom may look in a browser to check his own work and say what he saw in his report. The browser tests themselves are Julian's, written after the slice is on dev.
- Never ask Rom to write or add a browser test (a `*.spec.js` under `e2e/`), and never ask him to run the browser suite. Fixtures and helpers under `e2e/` that his product change genuinely requires (for example `e2e/seed-fixture.js`) are allowed; he lists them under `## What changed` with one line on why. A brief whose task is to build or change the test machinery itself says explicitly that Rom may touch `e2e/`.
- Never write the break-it check as a task; the report template already requires Rom to report it.
- Never ask for more tests than the criteria and traps need.

Every brief carries the fixed "## What Rom does not do" block, verbatim, in the wording kept in `.claude/roles/obrien/slice-body-template.md`. `bridge/new-slice.js` refuses a brief that lacks the block, and refuses a brief that contains an imperative test-writing phrase aimed at Rom: "write guard tests", "guard tests, AC-tagged", "verify in a real browser", "write a browser test", "add a browser test", "add a test in e2e/", "run the browser suite", "run npx playwright test", and the bare `npx playwright test` unless followed by `--list`. Text inside code fences and inline code is ignored. The other never-ask rules above are O'Brien's discipline, not check inputs. The check is skipped for slices addressed to Bashir. The minimal example at the end of this document omits the block for brevity; a real brief may not.

### `## Traps` *(when the change has known ways to go wrong)*

A short numbered list of the ways this change is likely to go wrong. Rom writes one safety-net test per trap. Keep each trap to one or two sentences. The trap list is not the place for testing instructions; those belong to the rule above.

### `## Acceptance criteria`

How the slice is judged. Write these as explicit, checkable conditions — `grep`s, `git diff --stat` expectations, presence/absence of particular text, test outcomes. Each line carries its tag: `- slice-<id>-ac-<k>: <text>` (see `ac-custody.md`). The implementor evaluates his own work against these criteria before writing the DONE report. Nog checks them on the branch. Julian checks the ones that touch the screen with browser tests once the slice is on dev, reading the criteria as O'Brien wrote them.

### `## Screen hooks` *(required when any criterion touches the screen)*

For each criterion that touches the screen, one line per button, row, or field a browser test will click or read. Each line is either the stable names O'Brien already knows, or the words "Rom to declare". A stable name is an element id, a data attribute, or a class that does not change when the layout does; it is the kind of name the existing browser tests already select by. No new test-id scheme is required. Each hook also gets its starting state in plain words ("visible when ..."), written by O'Brien if he knows it or by Rom in his report. Nothing in this section is a design written before the code; it is a list of names Rom must report. Nog checks the named elements exist in the shipped page. Julian uses them. Example:

- `slice-371-ac-1`: proposed rows carry `.queue-row[data-id]` with `draggable="true"`; amendment rows do not. Visible when the queue holds at least one proposed slice.
- `slice-371-ac-2`: Rom to declare.

### `## Quality + goal check`

Sanity notes for the implementor and reviewer. The *goal check* describes what a reader should see/experience on main after the slice lands. The *quality check* calls out constraints (byte-for-byte, no reformatting, no scope creep).

### `## Files expected to change`

A short bulleted list of the expected diff surface — one bullet per file, with `(added)`, `(modified)`, `(deleted)` annotations. Nog compares this list against `git diff --stat`.

---

## Self-containment requirement

The watcher pipes the slice content to the implementor and nothing else. No system preamble, no role description, no project history. The implementor is not stateless (he has `CLAUDE.md`, git history, and the filesystem), but O'Brien must not rely on him inferring context that isn't in the slice or reachable from the filesystem.

If a slice requires context from a document, either include it inline or explicitly reference the file path. If a slice requires context from a prior decision, state the decision in the `## Context` section.

When a slice carries payload content that must be copied verbatim (e.g. replacing a contract file), embed the content inline between explicit `=== BEGIN <path> ===` / `=== END <path> ===` markers. Do not rely on paths outside the worktree — the implementor cannot reach them.

---

## Minimal example

```markdown
---
id: "150"
title: "Add .gitignore"
goal: "Exclude macOS and Node.js artefacts from the repo."
from: obrien
to: rom
priority: normal
created: "2026-04-17T10:00:00Z"
apendment: null
timeout_min: null
status: STAGED
---

## Goal
Add a `.gitignore` at the project root that excludes common macOS and Node.js artefacts.

## Context
The repo root currently has no `.gitignore`. `.DS_Store` and `node_modules/` are accumulating.

## Scope
- Create `.gitignore` at the project root.

## Out of scope
- Ignore rules for editor configs or build artefacts — separate slice.

## Tasks
1. Create `.gitignore` at the project root.
2. Include: `.DS_Store`, `node_modules/`, `*.log`, `.env`.
3. Commit with message `chore: add .gitignore`.

## Acceptance criteria
- slice-150-ac-1: `.gitignore` exists at the project root.
- slice-150-ac-2: It contains `.DS_Store`, `node_modules/`, `*.log`, `.env`.
- slice-150-ac-3: `git diff --stat main` shows exactly 1 file changed: `.gitignore` (added).

## Quality + goal check
- Goal check: checking out main and running `cat .gitignore` shows the four expected entries.
- Quality check: no other files touched.

## Files expected to change
- `.gitignore` (added)
```

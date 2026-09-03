# DONE Report Format — Liberation of Bajor

*Contract version: 2.0*
*Source of truth: [`slice-lifecycle.md`](./slice-lifecycle.md) (BR), [`slice-pipeline.md`](./slice-pipeline.md) (technical spec).*
*Author: Rom or Leeta (the implementor).*
*Readers: Nog, then Julian (Bashir) at his stage on dev.*
*Supersedes: `report-format.md` (v1.0, 2026-04-06).*

---

## Overview

A DONE report is a markdown file with YAML frontmatter, written by the implementor (Rom or Leeta) at the end of slice execution. The watcher writes it to `${id}-DONE.md` in `bridge/queue/` once the `claude -p` process exits cleanly. Nog reads it, plus the branch diff, to evaluate whether the slice's acceptance criteria are satisfied. Julian later reads it (never the code changes) to write the browser tests, so the screen hooks, the safety-net tests section, and the moved-tests section must be complete.

**The implementor always writes a DONE file — even on failure.** If the slice cannot complete, the implementor writes a DONE file with `status: BLOCKED` or `status: PARTIAL` explaining the situation. The watcher writes a `${id}-ERROR.md` file only when the `claude -p` process itself crashes or times out without producing output — infrastructure failure, not slice failure.

---

## DONE vs. ERROR

| File | Writer | Meaning |
|---|---|---|
| `${id}-DONE.md` | Rom or Leeta | The implementor finished, produced output, and reported outcome. Status may be `DONE`, `PARTIAL`, or `BLOCKED`. Nog has something to evaluate. |
| `${id}-ERROR.md` | Watcher | The `claude -p` process crashed, timed out, or exited non-zero without writing a report, or the watcher could not fill the five telemetry fields. Infrastructure broke; no Nog review. |

---

## File naming

```
${id}-DONE.md
```

`${id}` matches the slice ID (e.g. `141-DONE.md`, `143-DONE.md`).

---

## YAML frontmatter

### Required fields

| Field                   | Type    | Description                                                                   |
|-------------------------|---------|-------------------------------------------------------------------------------|
| `id`                    | string  | Zero-padded three-digit slice ID, quoted (e.g. `"143"`).                      |
| `title`                 | string  | Slice title, copied from the slice frontmatter.                               |
| `from`                  | string  | `rom` or `leeta` — whichever implementor wrote the report.                    |
| `to`                    | string  | Always `nog`.                                                                 |
| `status`                | string  | One of `DONE`, `PARTIAL`, `BLOCKED`.                                          |
| `slice_id`              | string  | Same as `id` for originals; may differ for legacy apendment chains (pre-D3).                  |
| `branch`                | string  | Git branch the implementor worked on (e.g. `"slice/143"`).                    |
| `completed`             | string  | ISO 8601 UTC timestamp when the report was written.                           |

### Required telemetry fields

The watcher fills these from the `claude -p` session metadata. The implementor does not hand-author them.

| Field                   | Type    | Description                                                                   |
|-------------------------|---------|-------------------------------------------------------------------------------|
| `tokens_in`             | integer | Prompt tokens consumed.                                                       |
| `tokens_out`            | integer | Completion tokens produced.                                                   |
| `elapsed_ms`            | integer | Wallclock milliseconds from `claude -p` start to report flush.                |
| `estimated_human_hours` | number  | Rough "human hours saved" estimate for the sprint-cost dashboard.             |
| `compaction_occurred`   | boolean | Whether the session hit context compaction.                                   |

### Frontmatter example

```yaml
---
id: "143"
title: "watcher: detect Rom slice-broken fast path and route to STAGED"
from: rom
to: nog
status: DONE
slice_id: "143"
branch: "slice/143"
completed: "2026-04-16T20:35:00.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 120000
estimated_human_hours: 0.3
compaction_occurred: false
---
```

---

## Status semantics

### `DONE`

All acceptance criteria in the slice are met. The work is complete and verifiable from the branch diff.

### `PARTIAL`

Some acceptance criteria met, some not. The report must explain:
- which criteria are satisfied, with verification notes;
- which criteria are not satisfied, and why;
- what the implementor recommends (apendment slice, split, or O'Brien rework).

### `BLOCKED`

The implementor cannot proceed without input from O'Brien. The blocker must be explained clearly:
- what is blocking progress;
- what decision or clarification is needed;
- what was done before the blocker was hit.

---

## Markdown body

The body is prose for Nog and Julian under a fixed set of headings. Required, in this order: `## Summary`, `## What changed`, `## Acceptance criteria verification`, `## Safety-net tests`, `## Screen hooks`, `## Tests moved or weakened`, `## Commit`. Optional: `## Conflicts with the brief`; `## Blockers / Open questions` (PARTIAL or BLOCKED only, see below); and, on rejection pickups or the slice-broken fast path, the Rom-only headings `## Round N — Rework` and `## Rom Escalation — Slice Broken` (see "Rom-only conventions"). The same set is in the DONE template the watcher hands Rom. A missing required heading is a Nog finding (the report is rejected and comes back to Rom); it is never an orchestrator ERROR. The ERROR path stays only for the five frontmatter metrics.

### `## Summary`

A brief narrative — what the implementor did, in what order, and any significant decisions made during execution.

### `## What changed`

A concrete list of the changes — files modified, functions added, commits landed. Reference specific file paths, line numbers, and commit SHAs. Any fixture or helper under `e2e/` that the product change genuinely required is listed here with one line on why (Rom never writes a `*.spec.js` there).

### `## Acceptance criteria verification`

Point-by-point confirmation of each acceptance criterion from the slice, with the command run and the observed result (PASS / FAIL).

### `## Safety-net tests` **(required)**

The file(s) written, and one line per criterion tag and per trap: which test guards it. Then the break-it evidence, which is required: Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists here which tests went red. Nog rejects a report that only says green. A test that stayed green with the fix undone is hollow: say so; a test that stayed green is not evidence for its criterion, replace it before committing. If you looked in a browser to check your own work, add one line here, "What I saw in the browser: ...", not a heading of its own. No browser test files are listed here, because Rom does not write them. At Julian's stage a script repeats the break-it check as machine confirmation; a mismatch with what this section claims is written to the stage output.

### `## Screen hooks` **(required)**

For each criterion that touches the screen, the stable element names (an id, a data attribute, or a class that does not change when the layout does; the kind the existing browser tests already select by) a browser test will click or read, each with its starting state in plain words ("visible when ..."). If the brief already named them, confirm they exist as named and fill in any line the brief left as "Rom to declare". If nothing touches the screen, write `None`.

### `## Tests moved or weakened` **(required)**

Every existing safety-net test this change deliberately moved, loosened, skipped, or deleted, with the reason and the matching commit trailer. If none, write `None`. Rom moves his own safety-net tests; the second signature on any moved or weakened test comes from whoever is not doing the moving, which for Rom's tests is Nog.

### `## Conflicts with the brief` *(optional)*

If the brief asked for something Rom's standing instructions forbid (a browser test, running the browser suite, extra tests), say what was asked and what was done instead. Omit the heading when there was no conflict.

### `## Commit`

The commit SHA(s) produced by this slice, with the exact commit message.

### `## Blockers / Open questions` *(PARTIAL or BLOCKED only)*

Anything that needs O'Brien's input. Omit for `DONE`.

---

## Rom-only conventions (rejection pickups)

If Rom is re-running the slice after a Nog rejection, his report must also:
- Open with `## Round N — Rework` where `N` is the rejection round number.
- Explicitly call out which findings from `## Nog Review — Round N-1` were addressed and how.

If Rom is invoking the slice-broken fast path (BR invariant #9), his DONE file must include the exact heading `## Rom Escalation — Slice Broken` (no ambiguity). See `slice-pipeline.md` §10.

---

## Minimal example

```markdown
---
id: "150"
title: "Add .gitignore"
from: rom
to: nog
status: DONE
slice_id: "150"
branch: "slice/150"
completed: "2026-04-17T10:47:00.000Z"
tokens_in: 1200
tokens_out: 400
elapsed_ms: 22000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary
Created `.gitignore` at the project root with the four patterns specified in the slice and committed.

## What changed
- Added `.gitignore` at the project root with `.DS_Store`, `node_modules/`, `*.log`, `.env`.

## Acceptance criteria verification
| Criterion | Command | Result |
|---|---|---|
| `.gitignore` exists | `test -f .gitignore` | PASS |
| Contains the four patterns | `grep -c -E "^(\.DS_Store|node_modules/|\*\.log|\.env)$" .gitignore` returns 4 | PASS |
| `git diff --stat main` shows exactly 1 file | `git diff --stat main` | PASS (1 file) |

## Safety-net tests
- `regression/repo/j-gitignore.test.js`
- `slice-150-ac-1`: "file exists" test
- `slice-150-ac-2`: "four patterns present" test
- `slice-150-ac-3`: "exactly one file changed" test
- Break-it: stashed the change, ran the file: 3 of 3 red. Restored.

## Screen hooks
None (nothing on screen changed).

## Tests moved or weakened
None.

## Commit
`a1b2c3d` — `chore: add .gitignore`
```

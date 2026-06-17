---
id: "093"
title: "Nog — watcher wiring and headless invocation"
from: rom
to: nog
status: DONE
slice_id: "093"
branch: "slice/093-nog-wiring"
completed: "2026-04-16T03:45:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 420000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Wired Nog code reviewer into the watcher pipeline. After O'Brien writes a DONE report, the watcher now invokes Nog headless via `claude -p` for code review before proceeding to the existing evaluator.

## What was done

### 1. `bridge/nog-prompt.js` created
- Exports `buildNogPrompt()` which builds a self-contained prompt for Nog
- Includes slice file contents, DONE report, git diff, and output paths
- Instructs Nog to append review to slice file and write verdict to `{id}-NOG.md`

### 2. Watcher Nog invocation (`bridge/watcher.js`)
- Added `require('./nog-prompt')` and `LOGS_DIR` / `ESCALATIONS_DIR` constants
- New `invokeNog(id)` function: reads ARCHIVED slice + DONE report, builds git diff, invokes `claude -p` with Nog prompt
- Modified poll loop: DONE files route through Nog first, then to existing evaluator on PASS

### 3. Verdict handling
- **PASS**: Registers `NOG_PASS` event, renames file back to DONE for evaluator pickup
- **RETURN**: Registers `NOG_RETURN` event, creates amendment PENDING for O'Brien via `handleNogReturn()`
- **Missing/unparseable**: Treated as RETURN, emits `NOG_ESCALATION` kira-event, creates amendment

### 4. Round tracking and escalation
- `countNogRounds()` counts `## Nog Review -- Round N` headers in slice file
- Round 6+ triggers escalation: writes `{id}-NOG-ESCALATION.md` to `bridge/kira-escalations/`, emits `NOG_ESCALATION` kira-event, renames to STUCK

### 5. Register events
- `NOG_PASS`, `NOG_RETURN`, `NOG_ESCALATION` written to `bridge/register.jsonl`
- `hasNogReviewEvent()` prevents double-review on poll re-entry

### 6. Logging
- Nog output streamed to `bridge/logs/nog-{id}-round{N}.log`
- `bridge/logs/` added to `.gitignore`

## Files changed

- `bridge/nog-prompt.js` (new)
- `bridge/watcher.js` (modified)
- `.gitignore` (modified)

## Success criteria verification

1. `bridge/nog-prompt.js` exists and builds a complete prompt -- DONE
2. Watcher invokes Nog after every O'Brien DONE -- DONE (poll loop routes through `invokeNog`)
3. PASS verdict -> slice proceeds to evaluator -- DONE (renames back to DONE, evaluator picks up)
4. RETURN verdict -> O'Brien gets amendment with Nog review appended -- DONE (`handleNogReturn`)
5. Round 6 -> escalation file + kira-event + STUCK -- DONE
6. NOG_PASS, NOG_RETURN, NOG_ESCALATION register events -- DONE
7. Nog logs written to `bridge/logs/nog-{id}-round{N}.log` -- DONE
8. Committed on `slice/093-nog-wiring` -- DONE

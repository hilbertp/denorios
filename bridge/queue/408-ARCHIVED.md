---
id: "408"
title: "Dev is green again: slice 372's autocommit test reads the whole function"
from: rom
to: nog
status: DONE
slice_id: "408"
branch: "slice/408"
completed: "2026-09-25T22:34:16.510Z"
tokens_in: 36
tokens_out: 23498
elapsed_ms: 311887
estimated_human_hours: 0.5
compaction_occurred: false
tokens_cache_read: 810196
cost_usd: 1.4993830000000001
---

# Dev is green again: slice 372's autocommit test reads the whole function

## Summary

The slice-372-ac-1 guard `a slice run leaves no runtime file staged for autocommit`
read the first 1600 characters of `autoCommitDirtyTree` and looked for `git add -u`
in them. Slice 405 added a comment and a `const commitBody` above that line, which
moved it to character **1706** — six characters of comment past the edge of the
window. The autocommit still stages tracked modifications only; only the guard's
field of view broke, and dev went red on correct code.

The guard now reads the function from its declaration to the start of the next
top-level declaration, so no edit inside the function can hide a line from it, and
nothing after the function can be mistaken for part of it. Both assertions and both
messages are unchanged.

## What changed

`regression/dispatch-execution/j-untracked-runtime-state.test.js` only.

- New helper `topLevelFunctionSource(src, name)`: returns a named top-level
  function's source, ending at the next `function` / `async function` at column 0
  (or end of file). Anchored with `/m` and searched from past the declaration's own
  keyword, so the function's own nested and indented declarations do not close the
  window.
- New helper `autocommitMarkers(src)`: reads the two properties the autocommit must
  keep — `!l.startsWith('??')` and `git add -u` — out of `autoCommitDirtyTree`. The
  slice-372-ac-1 guard and all three slice-408 guards go through it, so a guard on
  the reader can never drift from the reader in use.
- The slice-372-ac-1 guard's `src.slice(fnStart, fnStart + 1600)` is replaced by
  that call. Its two assertions and their messages are verbatim as before.
- Three safety-net tests, one per acceptance criterion, with their hash lines.
- The header docblock's `Guards:` list names the three new guards.

`bridge/orchestrator.js` was not touched — there was nothing wrong with it.

## Acceptance criteria verification

- **slice-408-ac-1** — met. `node --test` on the file: 16/16 pass, including
  `slice-372-ac-1 a slice run leaves no runtime file staged for autocommit`, which
  was the single failure before this change. Guarded by
  `slice-408-ac-1 the autocommit guard is green against the orchestrator as it stands`,
  which asserts both markers are found in the live `bridge/orchestrator.js` and that
  the window holds exactly one top-level declaration — its own.
- **slice-408-ac-2** — met. `slice-408-ac-2 a dropped marker reads as red however
  deep in the function it sat` builds a stand-in `autoCommitDirtyTree` at two
  depths, 0 and 2400 characters, and at each one asserts: both markers found when
  both are present; `addsTrackedOnly` false when `git add -u` is traded for
  `git add -A`; `skipsUntracked` false when the `??` filter is dropped. 2400 is past
  the 1600 the old window read, so a truncating reader fails all three legs of the
  deep pass.
- **slice-408-ac-3** — met. `slice-408-ac-3 a marker only the next function has does
  not read as present` builds a source whose `autoCommitDirtyTree` has neither
  marker and whose *next* top-level function (behind a doc comment, as the real
  neighbour `fuseSafeCheckoutMain` is) has both. The fixture first asserts both
  markers really are in the file, then that the reader reports both absent.

## Safety-net tests

Three, one per acceptance criterion. The brief lists no traps.

- `slice-408-ac-1 the autocommit guard is green against the orchestrator as it stands`
- `slice-408-ac-2 a dropped marker reads as red however deep in the function it sat`
- `slice-408-ac-3 a marker only the next function has does not read as present`

**Red-check (core lane).** I stashed the fix by restoring the old body of
`topLevelFunctionSource` to `return src.slice(start, start + 1600)`, keeping the new
tests, and ran the file. 12 pass, 4 fail — **all three new tests went red**, plus the
guard that is red on dev today:

```
✖ slice-372-ac-1 a slice run leaves no runtime file staged for autocommit
✖ slice-408-ac-1 the autocommit guard is green against the orchestrator as it stands
✖ slice-408-ac-2 a dropped marker reads as red however deep in the function it sat
✖ slice-408-ac-3 a marker only the next function has does not read as present
```

ac-1 and ac-2 go red because the truncated window cannot see the deep markers; ac-3
goes red because a 1600-character window overruns the short fixture function and
swallows its neighbour's markers — the two failure directions the widened window has
to get right at once. I then restored the fix and confirmed 16/16 green and that no
stash marker survived in the file.

Ran only this one test file, as the brief requires. Nothing else.

## Screen hooks

None. Test-only change, no UI surface.

## Tests moved or weakened

None moved. Nothing weakened — the guard is strictly stricter than before: it now
sees the whole function instead of its first 1600 characters, and it now stops at the
function's end instead of reading whatever followed it. The two assertions and their
messages are unchanged.

One note for O'Brien, matching the brief's out-of-scope item: this is the third time
a fixed-size source window has gone stale (400 → 404, 372 → 408). `topLevelFunctionSource`
is written to be lifted into `regression/helpers/` when someone converts the other
fixed-window readers; it takes no fixture and no repo state.

## Commit

Single commit on `slice/408`, carrying the three AC trailers as the final paragraph.

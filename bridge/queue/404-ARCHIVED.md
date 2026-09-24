---
id: "404"
title: "Dev is green again: slice 400's verdict-source test accepts the argument slice 402 added"
from: rom
to: nog
status: DONE
slice_id: "404"
branch: "slice/404"
completed: "2026-09-24T19:58:15.000Z"
tokens_in: 34
tokens_out: 18757
elapsed_ms: 222126
estimated_human_hours: 0.5
compaction_occurred: false
tokens_cache_read: 808098
cost_usd: 1.4048390000000002
---

## Summary

The slice-400-ac-4 assertion demanded that `verdictSource` be the **last** argument
`handleAccepted` is called with. Slice 402 appended `reviewUsage` after it
(`bridge/orchestrator.js:5582`), so a call that still passes the source read as a call
that had dropped it, and dev went red. The assertion now requires `verdictSource` to be
**among** that call's arguments, wherever it sits in the list. The file is green against
the orchestrator as it stands, and still goes red the moment the source stops being passed.

Two safety-net tests, one per criterion. No trap list in the brief. Nothing else touched:
one file, 55 insertions, 1 deletion.

## What changed

- `regression/review-verdict/j-verdict-read-fallback.test.js`
  - The assertion's pattern moved out of the AC-4 test into a named const,
    `HANDLE_ACCEPTED_TAKES_VERDICT_SOURCE`, and changed from
    `/handleAccepted\([^)]*verdictSource\)/` to
    `/handleAccepted\([^)]*\bverdictSource\b[^)]*\)/`. `[^)]*` still cannot cross a `)`,
    so the name must appear inside that call's own parentheses — not merely somewhere in
    `invokeNog`. It is a const, not an inline literal, because the two new tests check the
    real pattern rather than a copy of it that could drift away from the assertion.
  - The two assertions below it (the `handleAccepted` body, lines 198-201 of the old file)
    are untouched, as the brief said.
  - Two new tests at the end of the file, `slice-404-ac-1` and `slice-404-ac-2`, each with
    its `// @ac-hash:` line copied from the brief.

No product code changed. No `e2e/` file touched. No lock file touched.

## Acceptance criteria verification

- **slice-404-ac-1** — the AC-4 test passes against the current `bridge/orchestrator.js`,
  where `handleAccepted` receives `reviewUsage` after `verdictSource`.
  Test: `regression/review-verdict/j-verdict-read-fallback.test.js`, test
  `slice-404-ac-1 the handleAccepted assertion passes against the orchestrator as it stands, reviewUsage and all`.
  Command: `node --test regression/review-verdict/j-verdict-read-fallback.test.js`.
  Result: pass — and the slice-400-ac-4 test it is about passes too. File: 12 tests, 12 pass,
  0 fail (it was 10 tests, 9 pass, 1 fail before the change, failing at the old line 196).

- **slice-404-ac-2** — the same assertion fails when `invokeNog`'s `handleAccepted` call
  does not pass `verdictSource`.
  Test: same file, test
  `slice-404-ac-2 the same assertion fails when invokeNog stops passing verdictSource to handleAccepted`.
  It takes the real `invokeNog` source, deletes `, verdictSource` from the call, and asserts
  the pattern no longer matches — while the name is still present elsewhere in the function
  (the rejected path reads it four lines below), so "mentioned" cannot pass for "passed".
  Command: as above. Result: pass.

## Safety-net tests

Two tests, one per acceptance criterion. The brief lists no traps, so no trap tests.

Break test, fix undone (the const put back to the pre-402 last-argument-only pattern, the new
tests left in place — done by editing the const in place and restoring from a copy, not by
`git stash`, since the stash stack is shared with other worktrees):

- `slice-404-ac-1` — **went red**. So did `slice-400-ac-4`, the test this slice repairs.
  12 tests, 10 pass, 2 fail.
- `slice-404-ac-2` — **stayed green**, and cannot do otherwise. The stashed state is the
  *stricter* pattern; ac-2 guards the opposite direction — a pattern loosened too far. So I
  ran the mutation ac-2 actually exists to catch: the tempting one-line fix
  `/handleAccepted\(/`, which stops looking at the arguments at all. Against that,
  `slice-404-ac-2` **went red** and `slice-404-ac-1` stayed green: 12 tests, 11 pass, 1 fail.
  Both mutations reverted; the file is 12/12 green as committed.

Flagging this rather than papering over it: no test that goes red on the pre-402 pattern can
be a test of ac-2, because the pre-402 pattern satisfies ac-2. The pair brackets the assertion
from both sides — too strict fails ac-1, too loose fails ac-2.

I did not open a browser; this slice has no screen.

## Screen hooks

None. No criterion touches the screen.

## Tests moved or weakened

- `regression/review-verdict/j-verdict-read-fallback.test.js`, the `slice-400-ac-4` test:
  its `handleAccepted` assertion was **weakened**, deliberately and as the brief instructs —
  from "`verdictSource` is the last argument" to "`verdictSource` is one of the arguments".
  Why: the old wording asserted an argument *order* nobody promised, so slice 402's honest
  addition broke it. What it still catches: a `handleAccepted` call that does not pass the
  source at all, which is the regression the AC-4 test was written for and which
  `slice-404-ac-2` now pins down. This is the second-signature item for Nog.
- Nothing moved, renamed or removed. No browser test touched.

## Commit

Branch `slice/404`, one commit on top of `12b70a2`, one file changed.

Trailers on the commit: the two `AC:` lines from the brief, and
`Test-Loosen-OK: regression/review-verdict/j-verdict-read-fallback.test.js — handleAccepted gained a trailing argument (slice 402); the assertion still requires verdictSource to be passed`.

One thing for whoever presses promote: `squashSliceToDev` is known to carry only `AC:`
trailers onto dev, so the `Test-Loosen-OK` line may not survive the squash and the gate may
read this weakening as undeclared. Nothing I can do from this branch; noting it so it is not
a surprise.

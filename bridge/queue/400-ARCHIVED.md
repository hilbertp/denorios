---
id: "400"
title: "Jordan's verdict is read even when its closing fence is missing"
from: rom
to: nog
status: DONE
slice_id: "400"
branch: "slice/400"
completed: "2026-09-23T22:52:56.445Z"
tokens_in: 112
tokens_out: 51656
elapsed_ms: 627405
estimated_human_hours: 3.0
compaction_occurred: false
tokens_cache_read: 4870366
cost_usd: 4.953698000000001
---

## Summary

A verdict file is now read as the verdict it declares. `readNogVerdict` strips a leading
byte-order mark, normalises CRLF endings, skips blank lines before the opening fence, and reads
the frontmatter to the end of the file when the closing `---` is missing. When the file still
yields nothing, the `**Verdict:**` line in Jordan's review section for the **current round**
decides. Only when both are empty is the round filed as `verdict_unreadable` — on the same path,
with the same backoff and the same three-attempt cap slice 372 built.

Every `NOG_DECISION` `invokeNog` emits with a readable verdict now carries `verdict_source`
(`frontmatter`, `unfenced` or `review_section`), so the register says which read decided the
round. The unreadable path stays bare — there was no source to name.

`parseFrontmatter` is untouched. Its ~30 other callers keep the exact behaviour they had; only
the verdict read inside `invokeNog` moved off it.

**This needs a daemon restart to go live.** The orchestrator is a long-lived process and holds the
module it loaded at start, so landing this changes nothing for the running pipeline until:

    launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator

The same note is in `readNogVerdict`'s doc comment, where the next person editing it will read it.

## What changed

- `bridge/orchestrator.js`
  - **new** `NOG_VERDICTS` — the four verdicts, in one place.
  - **new** `readNogVerdict(verdictFileContent, sliceFileContent, round)` (exported), returning
    `{ verdict, summary, source }`. Two reads: the verdict file (tolerant of BOM / blank lines /
    CRLF / a missing closing fence), then Jordan's review section for `round` only — bounded at
    the next `## ` heading so no other round's `**Verdict:**` line can be seen. Verdicts go
    through `translateVerdict` on both paths, exactly as the old read did.
  - `invokeNog` — the worktree slice-file copy and re-read now happen **before** the verdict read
    (trap 3), and the verdict read is `readNogVerdict(nogContent, updatedSliceContent, round)`
    instead of `parseFrontmatter(nogContent)`. A recovered verdict (`unfenced` or
    `review_section`) logs one info line naming the source. The `if (!err)` gate, the unreadable
    branch and everything downstream are unchanged.
  - `invokeNog` REJECTED emission — builds `rejectedDecision` and adds `verdict_source` when
    there is one.
  - `handleAccepted` — takes an optional trailing `verdictSource` (its only caller is
    `invokeNog`) and puts `verdict_source` on its `NOG_DECISION`.
  - exports: `readNogVerdict`, `NOG_VERDICTS`.
- `regression/review-verdict/j-verdict-read-fallback.test.js` — **new**, 10 tests.

No `e2e/` file was touched. `regression/*.lock` was not regenerated, per the brief.

## Acceptance criteria verification

Command for every row: `node --test regression/review-verdict/j-verdict-read-fallback.test.js`
(10 tests, 10 pass, 0 fail).

| Tag | Test file | Result |
|---|---|---|
| slice-400-ac-1 | `regression/review-verdict/j-verdict-read-fallback.test.js` | PASS — an unfenced file reads as the verdict it declares with source `unfenced`, for all four verdicts; `parseFrontmatter` on the same input still returns `null` (the bug, in one assertion); a closed fence still reports `frontmatter`. |
| slice-400-ac-2 | same | PASS — BOM, leading blank lines, CRLF, and all three at once with no closing fence; verdict *and* summary survive each. |
| slice-400-ac-3 | same | PASS — with two rounds in the file, round 2 reads round 2 and round 1 reads round 1, source `review_section`; "yields no valid verdict" covers an invented verdict and a missing `verdict` key, not just a missing file; a readable file always wins. |
| slice-400-ac-4 | same | PASS — the three sources are exactly `frontmatter`/`unfenced`/`review_section`; every `NOG_DECISION` emission inside `invokeNog` is walked (not hard-coded), each readable one carrying `verdict_source` and the unreadable one staying bare; the ACCEPTED source is threaded through `handleAccepted`. |
| slice-400-ac-5 | same | PASS — six ways of having no verdict all return `{ verdict: null, summary: '', source: null }`, including a read that threw; `MAX_UNREADABLE_ATTEMPTS === 3`, `UNREADABLE_BACKOFF_MS === [60000, 300000]`, and the unreadable branch still counts per round, caps, backs off and stamps `not_before`. |
| slice-400-ac-6 | same | PASS — nine pinned `parseFrontmatter` inputs (including every shape `readNogVerdict` now tolerates, all still `null`), its fence regex asserted byte-for-byte, and `invokeNog` proven to no longer call it for the verdict. |

## Safety-net tests

One test per acceptance criterion plus one per trap — 10 in
`regression/review-verdict/j-verdict-read-fallback.test.js`. Then I stopped.

**Break-on-purpose check.** I stashed `bridge/orchestrator.js` only
(`git stash push -m rom-slice-400-fix-breakcheck -- bridge/orchestrator.js`, applied back by SHA
and dropped by tag — the stash stack is shared), ran the file, and got **10 red out of 10**:

| Test | Went red because |
|---|---|
| slice-400-ac-1 | `TypeError: readNogVerdict is not a function` |
| slice-400-ac-2 | `TypeError: readNogVerdict is not a function` |
| slice-400-ac-3 | `TypeError: readNogVerdict is not a function` |
| slice-400-ac-4 | `TypeError: readNogVerdict is not a function` (the structural walk fails independently too — I re-ran the walk alone against the stashed source: the REJECTED emission had no `verdict_source` and `handleAccepted` was not threaded) |
| slice-400-ac-5 | `TypeError: readNogVerdict is not a function` |
| slice-400-ac-6 | assertion: *the verdict file must not be read with parseFrontmatter any more* |
| trap-1 | `TypeError: readNogVerdict is not a function` |
| trap-2 | `TypeError: readNogVerdict is not a function` |
| trap-3 | assertion: *the verdict read must follow the re-read* |
| trap-4 | assertion: *readNogVerdict must carry a doc comment* |

Worth flagging honestly: the ac-6 criterion is "parseFrontmatter is unchanged", and a table pinning
unchanged behaviour cannot go red on its own. So that test pins the nine `parseFrontmatter`
answers **and** asserts the thing that did change — that `invokeNog` no longer reads the verdict
through it. That second half is what turned it red, which is the honest way to make an
"unchanged" criterion break-testable.

**The traps.**

1. *An earlier round's Verdict line.* Both directions are shut: a round-1 REJECTED cannot decide
   round 2, and a round-1 ACCEPTED cannot either. The section is bounded at the next `## `
   heading, so Sam's own `## Rom DONE Report — Round 2` sitting between two review sections
   cannot leak in. Round 1 does not prefix-match "Round 10", and round 3 finds nothing even though
   rounds 1 and 2 both decided.
2. *The unreadable path.* `j-unreadable-verdict-retry-cap.test.js` reads the orchestrator source
   by landmarks; I asserted those landmarks are still where it looks
   (`if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS) {`, `VERDICT_UNREADABLE_EXHAUSTED`,
   `-STUCK.md`, `verdict_unreadable_retry_cap`) and that the code from that landmark onward is
   untouched by this diff. Also pinned: a file with a summary and no verdict, a code fence, and
   prose above the fence all still read as nothing — the new reader must not invent a verdict.
3. *Read order.* Asserted as an order, on source positions: the worktree copy, then the re-read
   into `updatedSliceContent`, then `readNogVerdict(nogContent, updatedSliceContent, round)` —
   and that the stale closure `sliceContent` is never what the reader is handed.
4. *The daemon restart.* Operational, not behavioural, so there is no code regression to catch.
   The guard I could write is that the restart requirement stays attached to the code that needs
   it: the test asserts `readNogVerdict`'s doc comment says a restart is required and gives the
   exact `launchctl kickstart` command. A report gets archived; a doc comment is what the next
   editor reads. It is stated under ## Summary as well.

I did not run the full safety-net suite or the browser suite. I did not look in a browser — this
slice changes no screen.

I did read, without running, the three existing guards that slice `handleAccepted` or
`invokeNog` out of the orchestrator source (`j-julian-stage-in-qa`, `j-lanes`,
`j-unreadable-verdict-retry-cap`). All three slice landmark-to-landmark rather than by a fixed
window, and every landmark they use is outside or unaffected by this diff —
`readNogVerdict` sits *after* `countNogRounds`, which is the boundary two of them stop at.

## Screen hooks

None. No criterion in this slice touches the screen; the only user-visible trace is the new
`verdict_source` field on `NOG_DECISION` entries in `bridge/state/register.jsonl`, which the
dashboard reads only for `ev.verdict` and ignores.

## Tests moved or weakened

None. No existing test was moved, renamed, changed or removed.

## Commit

`a4f7dcc` — S400: Jordan's verdict is read even when its closing fence is missing
(`bridge/orchestrator.js`, `regression/review-verdict/j-verdict-read-fallback.test.js`), on
branch `slice/400`, with the six `AC:` trailers and `Lane: core`. This report is committed on
top.

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

<!-- ds9:sticker v1 -->

# Jordan's verdict is read even when its closing fence is missing — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "400"
title: "Jordan's verdict is read even when its closing fence is missing"
goal: "A verdict file with an unclosed or messy frontmatter is read as the verdict it declares, falling back to the current round's Verdict line, so an ACCEPTED review never again costs a round."
from: obrien
to: rom
priority: high
lane: core
created: "2026-09-23T22:30:09.259Z"
timeout_min: 30
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-23T22:42:44.472Z"
approval_sig: "8f4f9507560abcf79189e398168baf5ac99af862b3c11d4665a6ed538d2a9634"
rom_session_id: "3e4e3128-28fd-427d-9004-4f15b9994fb1"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-23T22:52:56.445Z"
    durationMs: 627405
    tokensIn: 112
    tokensOut: 51656
    costUsd: 4.953698000000001
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All six ACs verified independently (byte-identical parseFrontmatter and unreadable-path windows vs dev, recomputed @ac-hashes, retry-cap guard green); intent achieved on the live read path; scope clean at 3 files."
total_durationMs: 627405
total_tokensIn: 112
total_tokensOut: 51656
total_costUsd: 4.953698
round: 1
---

### Jordan's verdict is read even when its closing fence is missing

<!-- Lane: core. Changes how the orchestrator decides a review's outcome (docs/adr/ADR-PROOF-LANES.md §2). -->

#### What is broken / Goal

When Jordan writes his verdict file without the closing `---`, the orchestrator reads no verdict at
all, files the round as `verdict_unreadable` (a REJECTED), and sends the slice round again, even
when Jordan accepted it. In two days this cost a round three times: 390 twice, 358 once, and on 388
an ACCEPTED verdict was lost. Each lost round costs a Sam session (median 6–16 minutes) and another
Jordan review (median 8 minutes). The review Jordan appends to the slice file carried an intact
`**Verdict:**` line every time.

After this lands: a verdict file whose frontmatter is not closed, or has a byte-order mark, leading
blank lines or Windows line endings, is read as the verdict it declares. If the verdict file still
yields nothing, the orchestrator takes the `**Verdict:**` line from Jordan's review section for the
current round. Only when both are missing is the round unreadable, exactly as today. The register
records which source the verdict came from.

#### Why (evidence)

- `bridge/orchestrator.js:1030` `parseFrontmatter` matches `/^---\n([\s\S]*?)\n---/`; with no
  closing fence it returns `null`.
- `bridge/orchestrator.js` `invokeNog` (around lines 5116-5130) reads `{id}-NOG.md` with
  `parseFrontmatter`; a `null` leaves `verdict` empty, and the branch at around line 5151 files
  `NOG_DECISION` REJECTED with `reason: 'verdict_unreadable'`.
- Taylor's handoff to Chris, 2026-09-14 evening
  (`.claude/roles/worf/inbox/HANDOFF-RULING-AMENDMENT-PROOF-LANES-FROM-DAX.md`, "three more for the
  fix list"): ranked first; proposes exactly these two remedies.
- `bridge/queue/388-ARCHIVED.md`, round 2 note: "Nog's round-1 verdict is **ACCEPTED**; the round
  came back because the daemon could not parse it".
- Review sections in slice files have the form `## Nog Review — Round N` followed by a
  `**Verdict:** ACCEPTED` line (for example `bridge/queue/312-PARKED.md:138-140`); the orchestrator
  already counts these headings with `/^## Nog Review — Round \d+/gm` (`bridge/orchestrator.js:4854`).

#### Tasks

1. Add a function `readNogVerdict(verdictFileContent, sliceFileContent, round)` (in
   `bridge/orchestrator.js`, exported) that returns `{ verdict, summary, source }`:
   - strip a leading byte-order mark and normalise `\r\n` to `\n`, and skip blank lines before the
     first `---`;
   - read the frontmatter up to the closing `---`, or up to the end of the file when the closing
     fence is missing; `source` is `frontmatter` when the fence was closed and `unfenced` when it
     was not;
   - if that yields no verdict among ACCEPTED, REJECTED, ESCALATE, OVERSIZED (after
     `translateVerdict`), look in `sliceFileContent` for the section headed
     `## Nog Review — Round <round>` and take the first `**Verdict:** <VALUE>` line inside that
     section only (up to the next `## ` heading); `source` is `review_section`;
   - otherwise return `{ verdict: null, summary: '', source: null }`.
2. In `invokeNog`, replace the `parseFrontmatter` read of the verdict file with `readNogVerdict`,
   passing the re-read slice file content (after the worktree copy) and the current `round`. Move
   the read after the slice-file copy if needed, so the fallback sees Jordan's appended review.
3. Add `verdict_source` to every `NOG_DECISION` event `invokeNog` emits (`frontmatter`, `unfenced`,
   `review_section`; omit it on the unreadable path).
4. Leave `parseFrontmatter` itself unchanged; it has about 30 other callers.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### Traps

1. A `**Verdict:**` line from an earlier round's section is still in the slice file. The fallback
   must read only the section for the current round, or a round-1 REJECTED could decide round 2, or a
   stale ACCEPTED could land unreviewed work.
2. `regression/review-verdict/j-unreadable-verdict-retry-cap.test.js` pins the unreadable path
   (retry backoff and the three-attempt cap). A verdict that is genuinely unreadable must still take
   that path unchanged.
3. The worktree copy of the slice file happens after the verdict read today. If the fallback reads
   the slice content captured before Jordan ran, it will never find his review.
4. The daemon runs the old code until it is restarted. The landing needs a restart
   (`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`) before the fix is live; say so
   under ## Summary.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-400-ac-1: A verdict file whose frontmatter has no closing `---` is read as the verdict it declares (for example ACCEPTED) with source `unfenced`, not as verdict_unreadable.
- slice-400-ac-2: A verdict file with a leading byte-order mark, leading blank lines or `\r\n` line endings is read as the verdict it declares.
- slice-400-ac-3: When the verdict file yields no valid verdict, the `**Verdict:**` line in the slice file's `## Nog Review — Round <current round>` section decides the verdict, with source `review_section`; a Verdict line in any other round's section is never used.
- slice-400-ac-4: Every NOG_DECISION event that invokeNog emits with a readable verdict carries `verdict_source` set to `frontmatter`, `unfenced` or `review_section`.
- slice-400-ac-5: With no readable verdict in the file and no Verdict line in the current round's section, the round is filed as verdict_unreadable exactly as before, with the same retry backoff and three-attempt cap.
- slice-400-ac-6: parseFrontmatter returns the same result as before for every input; only the verdict read in invokeNog changes.

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-400-ac-1: A verdict file whose frontmatter has no closing `---` is read as the verdict it declares (for example ACCEPTED) with source `unfenced`, not as verdict_unreadable.
    AC: slice-400-ac-2: A verdict file with a leading byte-order mark, leading blank lines or `\r\n` line endings is read as the verdict it declares.
    AC: slice-400-ac-3: When the verdict file yields no valid verdict, the `**Verdict:**` line in the slice file's `## Nog Review — Round <current round>` section decides the verdict, with source `review_section`; a Verdict line in any other round's section is never used.
    AC: slice-400-ac-4: Every NOG_DECISION event that invokeNog emits with a readable verdict carries `verdict_source` set to `frontmatter`, `unfenced` or `review_section`.
    AC: slice-400-ac-5: With no readable verdict in the file and no Verdict line in the current round's section, the round is filed as verdict_unreadable exactly as before, with the same retry backoff and three-attempt cap.
    AC: slice-400-ac-6: parseFrontmatter returns the same result as before for every input; only the verdict read in invokeNog changes.
    Lane: core

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

**AC Check:**

- slice-400-ac-1 (no closing `---` → read as declared, source `unfenced`) → ✓ Satisfied. `bridge/orchestrator.js:4911-4935`: the closing fence is searched for, and when `close === -1` the frontmatter body is `lines.slice(open + 1, lines.length)` with `source: 'unfenced'`. Verified independently, not from the report: `readNogVerdict('---\nverdict: ACCEPTED\nsummary: "ok"\n', '', 1)` → `{verdict:'ACCEPTED', summary:'ok', source:'unfenced'}`. All four verdicts round-trip, including the legacy `PASS`/`RETURN` spellings through `translateVerdict`.
- slice-400-ac-2 (BOM / leading blank lines / CRLF) → ✓ Satisfied. `orchestrator.js:4904` strips `^﻿` then normalises `\r\n?` → `\n`; `4908-4909` skips blank lines before the opening fence. Checked each shape and all three at once; verdict *and* summary survive. A summary containing a colon (`"All good: six met."`) still parses on the first colon only, the same split `parseFrontmatter` uses.
- slice-400-ac-3 (current round's `**Verdict:**` line decides; no other round's) → ✓ Satisfied. `orchestrator.js:4947` anchors on `^## Nog Review — Round <n>(?!\d)[^\n]*$`; `4951-4953` bounds the section at the next `^## ` heading; `4955` takes the first `**Verdict:**` line inside it. Verified: prose-before-the-fence and a ```` ```yaml ```` wrapper both fall through to `review_section` and return the right verdict; a readable file always wins; `Round 1` does not prefix-match `Round 10`.
- slice-400-ac-4 (`verdict_source` on every readable NOG_DECISION) → ✓ Satisfied. `invokeNog` emits `NOG_DECISION` twice — `orchestrator.js:5286` (unreadable, correctly bare) and `5547` (`rejectedDecision`, source added at `5546`). The ACCEPTED emission is `handleAccepted`'s; the source is threaded through the call at `5531` and attached at `4801-4804`. I checked the remaining verdicts rather than taking the count on trust: `ESCALATE` and `OVERSIZED` emit `ESCALATED_TO_OBRIEN`, not `NOG_DECISION`, so there is no third readable emission to miss. `registerEvent` is a free-form `Object.assign` with no schema, and `dashboard/server.js:2747` reads only `ev.verdict` — the new field is additive and inert.
- slice-400-ac-5 (genuinely unreadable → unchanged path, backoff, cap) → ✓ Satisfied, checked by bytes rather than by reading. Slicing both `dev` and this branch from the landmark `if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS) {` for 3600 chars gives identical strings; so do the `handleNogReturn` and `// ── MAX_ROUNDS guard (verdict_unreadable path) ──` windows. `regression/review-verdict/j-unreadable-verdict-retry-cap.test.js` — the guard trap 2 names — runs green against this branch (10/10).
- slice-400-ac-6 (`parseFrontmatter` unchanged) → ✓ Satisfied. The `dev`-vs-branch window from `function parseFrontmatter(content) {` is byte-identical. The only `parseFrontmatter` lines in this diff are the deleted `const nogMeta = parseFrontmatter(nogContent);`, two doc-comment mentions and the exports line.

**Intent:** Achieved, and I checked the live path rather than the unit. The reviewer prompt hands Nog an *absolute* path for the slice file (`slicePath: resolvedParkedPath`, in the main queue) and a *relative* one for the verdict (`bridge/queue/{id}-NOG.md`, which lands in his worktree). So in the real flow the review is already on the main-queue PARKED file and the verdict file is copied in from the worktree first — and `orchestrator.js:5222-5240` now does the PARKED copy *and* the `updatedSliceContent` re-read before the verdict read. Both readers see real data whichever side Nog wrote to. The failure this slice exists to kill — an ACCEPTED discarded because a `---` was missing — cannot reach the `verdict_unreadable` branch any more.

**Scope:** Clean. Against `dev` (the branch base) the diff is three files — `bridge/orchestrator.js`, the new `regression/review-verdict/j-verdict-read-fallback.test.js`, and this slice's DONE report. Nothing under `e2e/`, no lock files, no unrelated edits, no content lost.

**Linting:** PASS — the repo configures no linter (`package.json` has only `@playwright/test`); `node --check` is clean on both changed files.

**Safety-net tests / screen hooks:** PASS. Ten tests, six AC + four trap — exactly the core-lane target, no padding. All ten green. The `@ac-hash` annotations are not merely present: I recomputed all six with `buildHashLines` against this slice file and they match byte-for-byte, so reconcile will count them as covering rather than stale. The break-it list is specific and names a distinct reason per test. `## Tests moved or weakened: None` matches the diff — regression/ is additions only, so there is no Test-Update trailer to review. No criterion touches the screen and the report says so with its reason; `verdict_source` is register-only.

**Flags (not findings):**

1. *For O'Brien — one way an ACCEPTED can still cost a round.* The `if (!err)` gate at `orchestrator.js:5245` is unchanged, so a Nog run that times out or exits non-zero **after** writing both files still files `verdict_unreadable` and never consults either reader. Out of this brief's scope (task 2 asked only to replace the read), but it is now the last remaining path to the loss this slice was written to stop.
2. *For O'Brien — `NOG_VERDICTS` is "the four verdicts, in one place" only in the new code.* The unreadable guard at `orchestrator.js:5268` still carries its own `['ACCEPTED', 'REJECTED', 'ESCALATE', 'OVERSIZED']` literal. Leaving it alone was the right call — trap 2 and ac-5 both demand that branch stay untouched — but the two lists can now drift. A one-line follow-up, not a rework.
3. *For O'Brien — trap 4 was not testable as written.* It is operational ("the daemon needs a restart"), so Rom's guard asserts that `readNogVerdict`'s doc comment carries the restart sentence and the exact `launchctl` command. That is a sensible proxy and he flagged the substitution himself, but a trap with no behaviour behind it costs a test slot that could have guarded behaviour.
4. *For Julian's stage — the shape of the break-it evidence.* Eight of the ten went red as `TypeError: readNogVerdict is not a function`, which is what stashing a whole file does when the fix is a new function; it proves the tests call the new code, not that each asserts the right thing. Three (ac-4, ac-6, trap-3) went red on real assertions, and Rom re-ran the ac-4 walk alone against the stashed source. The machine re-check at your stage is the one that settles it.
5. *For O'Brien — an unfenced file parses to end of file, so the last `verdict:` key wins.* `readNogVerdict('---\nverdict: ACCEPTED\n\nnotes\nverdict: REJECTED\n', '', 1)` returns REJECTED. This is the brief's own instruction ("up to the end of the file when the closing fence is missing") and no realistic Nog output hits it — his review body writes `**Verdict:**`, which does not parse as the `verdict` key. Recording it so the next editor of this function knows it is a known consequence, not an oversight.
6. *Structural tests where behaviour was not reachable.* ac-4, trap-3 and trap-4 assert on the orchestrator's source text rather than on observed behaviour. `invokeNog` spawns `claude -p`; `regression/review-verdict/j-nog-accepts-slice.test.js` states in its own header that this path is "not headless-testable", and `j-unreadable-verdict-retry-cap.test.js` slices the same function by the same landmarks. Local convention, matched — noted so it is on the record, not held against the slice.

**Operational note carried forward:** this changes nothing for the running pipeline until the daemon is restarted — `launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`. Rom put it under `## Summary` and in the function's doc comment, which is the right pair of places.

## Rom's DONE report

#### Summary

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

#### What changed

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

#### Acceptance criteria verification

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

#### Safety-net tests

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

#### Screen hooks

None. No criterion in this slice touches the screen; the only user-visible trace is the new
`verdict_source` field on `NOG_DECISION` entries in `bridge/state/register.jsonl`, which the
dashboard reads only for `ev.verdict` and ignores.

#### Tests moved or weakened

None. No existing test was moved, renamed, changed or removed.

#### Commit

`a4f7dcc` — S400: Jordan's verdict is read even when its closing fence is missing
(`bridge/orchestrator.js`, `regression/review-verdict/j-verdict-read-fallback.test.js`), on
branch `slice/400`, with the six `AC:` trailers and `Lane: core`. This report is committed on
top.

## Nog's verdict and review

_None recorded._

## Julian's result

### Julian's stage — result

**One browser test added, none moved.** Browser suite: 54 tests in 21 files (was 53 in 20).
Commit `8ecae30` on dev — `e2e/verdict-source-history.spec.js` (new) and a seeder added to
`e2e/seed-fixture.js`. Nothing outside `e2e/` and this file was written.

#### Which criteria have a browser test

| Criterion | Browser test | Why |
|---|---|---|
| slice-400-ac-1 | none | No screen. `readNogVerdict` returns a value to `invokeNog`; no page renders it. |
| slice-400-ac-2 | none | No screen — same read, different input shapes (BOM, blank lines, CRLF). |
| slice-400-ac-3 | none | No screen. The *consequence* of the fallback — the round is accepted rather than repeated — is what the ac-4 test renders; the read itself has no surface. |
| slice-400-ac-4 | `e2e/verdict-source-history.spec.js` | **Has a screen.** ac-4 changes the shape of the `NOG_DECISION` records in `bridge/register.jsonl`, and the History/Logbook renders one row per slice from that file. |
| slice-400-ac-5 | none | No *discriminating* screen — established by seeding, not assumed. See below. |
| slice-400-ac-6 | none | No screen I can attribute. Whether the dashboard's rendering shares the orchestrator's `parseFrontmatter` is a question I would have to open product source to answer, and a guard written on that guess would be hollow. |

The packet declared "Screen hooks: None", and for ac-1, ac-2, ac-3 and ac-6 that is right. For
ac-4 it is not: a criterion that changes what the product *writes into the file the History
reads* has a surface, whatever the hooks section says.

**Why ac-5 got no test, with the evidence.** I seeded three unreadable-path registers and read
the rendered page: a round filed `verdict_unreadable` renders as `.outcome-pill.outcome-reviewing`
with the round count — pixel-identical to any other in-flight round. There is no element that
distinguishes it, so any test I wrote would have passed on registers that had nothing to do with
the unreadable path. The backoff timing and the three-attempt cap have no rendering at all. A
green test there would have been decoration.

#### What the ac-4 test holds, and what it does not

Holds: all three values ac-4 enumerates (`frontmatter`, `unfenced`, `review_section`) render
identically — one round, success — so a recovered verdict is worth exactly as much on screen as
a cleanly-fenced one, which is the slice's goal line. The pre-fix register shape is seeded
alongside as the discriminator: an ACCEPTED lost to `verdict_unreadable` and won back in a second
round renders `2`. Both end accepted, so the outcome pill cannot tell them apart — the round
column is the thing that costs.

Does not hold: that `invokeNog` emits `verdict_source` at all. That path spawns `claude -p`, the
fixture sets `LOB_NO_LAUNCH=1` so it never can, and the orchestrator's own guards record the path
as not headless-testable. The emission is Rom's safety-net test's to hold; this test holds its
consequence on the screen. The limit is written into the spec header rather than left implied.

#### Hooks used, and where they were found

The sticker declared none, so these come from the rendered page of the running product
(http://localhost:4747, element inspector), under the day-one rule:

| Hook | What it is |
|---|---|
| `.history-row[data-history-id="<id>"]` | one Logbook row per slice |
| `.col-round` | the rounds the slice cost |
| `.outcome-pill.outcome-success` | the outcome verdict |

Starting state the hooks need: the register seeded with finished slices, *then* the dashboard
loaded. The Logbook renders rows only for slices that reached a terminal state — on an empty
register there is no row to find.

#### My own mutation check

A green browser test proves nothing until it has been made to fail for the right reason. Four
mutations of the seeded register, each run against the committed spec:

| Mutation | Result |
|---|---|
| The `unfenced` recovery costs a round (round 2) | RED — *"a verdict read from unfenced must cost exactly one round"*, expected `1`, received `2` |
| The pre-fix lost-verdict shape costs no round | RED — *"the pre-fix lost-verdict shape must still render the round it cost"*, expected `2`, received `1` (the discriminator works) |
| The slice ends unaccepted | RED — *"a verdict read from unfenced must show a success outcome"*, element not found |
| `verdict_source` stripped from every event | **GREEN** — and that is the documented limit above, not a defect. Reported rather than hidden. |

The fixture was restored from a byte-for-byte backup after each mutation; the committed diff to
`e2e/seed-fixture.js` is pure addition (45 insertions, 0 deletions).

#### Break-it check (packet item 8)

**Not run.** The packet states the break-it script is the next slice in this set. Every
safety-net test Rom lists for slice 400 is therefore **unconfirmed at this stage** — including
the eight that his own by-hand stash reported red only as `TypeError: readNogVerdict is not a
function`, which proves the tests call the new code but not that each asserts the right thing.
Nog's review flags the same gap (flag 4) and hands it to this stage; this stage cannot settle it
either, because the machine that would is not built yet. No test was named hollow, because
nothing ran to name one. Nothing here should be read as confirming Rom's safety net.

#### The two suite results

Not mine to run and not run here. The stage machinery runs the full safety-net suite once and
the full browser suite once on dev after the `tests-updated` event below, and records the verdict.

#### Every file I read

Role and my own test code: `.claude/roles/bashir/ROLE.md`, `.claude/roles/bashir/LEARNING.md`,
`e2e/seed-fixture.js`, `e2e/history-logbook.spec.js`, `e2e/nog-role-no-suites.spec.js`,
`playwright.config.js`.
Data and generated metadata: `bridge/register.jsonl`, `regression/AC-MANIFEST.lock`,
`bridge/state/bashir-heartbeat.json`, and git metadata only (the `AC:` trailers for slice 400,
the commit's file-name list, my own previous stage's commit message).
Tools I ran without reading: `scripts/build-ac-manifest.js` (`acHashOf`, to compute the
`@ac-hash`), `lib/draft-contract.js`, `lib/ac-reconcile.js`, `scripts/tests-needed.js`,
`scripts/check-test-updates.js`, `bridge/state/gate-telemetry.js`.

No product source file was opened. One disclosure, because the rule is worth more than the
appearance of keeping it: my first look-at-the-product script scanned every leaf element on the
live page for verdict-related text, and its output included the opening ~120 characters of an
inline `<script>` block (a `REASON_LABELS` map). It was incidental, I did not read further into
it, and nothing in this test came from it.

#### Observations — not exits, not findings against slice 400

1. **`VERDICT_UNREADABLE_EXHAUSTED` renders as "reviewing", not as a failure.** Seeding three
   unreadable rounds plus the exhaustion event produces `.outcome-pill.outcome-reviewing` — a
   slice that has given up looks identical to one still under review. `MAX_ROUNDS_EXHAUSTED`
   renders `outcome-error` with a "Return to stage" button; the verdict-unreadable cap has
   neither. This predates slice 400 (slice 372 built that path) and ac-5 asks only that it be
   unchanged, which it is — so it is not a red for this slice. For O'Brien, not for me.
2. **`scripts/dev.denorios.orchestrator.plist` sits in the Test-Update Gate's NEEDS REVIEW list.**
   It arrived via slice 399's pre-checkout autocommit (`35e119e`), not via slice 400, whose five
   changed files match the packet exactly. It will still be there at the Promote button.
3. **The AC manifest has no text or hash for any slice-400 criterion** — all six are
   `legacy-backfill` with `acHash: null`. The `@ac-hash` in my spec was computed from the `AC:`
   commit trailer with the same `acHashOf` the manifest generator uses, and the method was
   validated by reproducing slice-399-ac-4's stored hash exactly. It will match whenever the
   manifest is rebuilt from those trailers.

#### Exit taken

None. No red was declared at this stage: one criterion had a screen, it has a browser test, and
that test is green and proven able to fail. The stage machinery's two suite runs decide the
slice.

#### Operational note carried forward

Rom and Nog both record it and it is still true: this slice changes nothing for the running
pipeline until the daemon is restarted —
`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`. The live register bears this
out: slice 400's own `NOG_DECISION` (2026-09-23T22:59:45Z) carries **no** `verdict_source`,
because the daemon that wrote it is running the pre-400 code.

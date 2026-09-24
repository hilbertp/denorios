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

<!-- ds9:sticker v1 -->

# Dev is green again: slice 400's verdict-source test accepts the argument slice 402 added — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "404"
title: "Dev is green again: slice 400's verdict-source test accepts the argument slice 402 added"
goal: "The safety-net run on dev is green again and the test still catches a handleAccepted call that stops passing the verdict source."
from: obrien
to: rom
priority: critical
lane: core
created: "2026-09-24T19:43:35.391Z"
timeout_min: 15
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-24T19:55:13.782Z"
approval_sig: "7cfc771f7955f0a98beba9d8982793c8a71c2e5c84896cb5ebbd6fdc843b1a9a"
rom_session_id: "042034c7-4f90-48e5-87d8-28bad7aa774b"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-24T19:58:15.000Z"
    durationMs: 222126
    tokensIn: 34
    tokensOut: 18757
    costUsd: 1.4048390000000002
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "Both ACs verified by running the file (12/12) and by reproducing each mutation myself; the loosening is a genuine over-specification repair, the guarded behaviour is intact, scope is the one expected file plus the report."
total_durationMs: 222126
total_tokensIn: 34
total_tokensOut: 18757
total_costUsd: 1.404839
round: 1
---

### Dev is green again: slice 400's verdict-source test accepts the argument slice 402 added

<!-- Lane: core. Changes a test's behaviour (docs/adr/ADR-PROOF-LANES.md §2). -->

#### Goal

GitHub's safety-net run on dev went red when slice 402 landed (run 36049914633, commit 12b70a2).
After this lands, dev is green again, and the test still catches a change that stops passing the
verdict source to `handleAccepted`.

#### Context

- Failing test: `regression/review-verdict/j-verdict-read-fallback.test.js:196`, slice-400-ac-4,
  asserts `/handleAccepted\([^)]*verdictSource\)/` against the source of `invokeNog`.
- Slice 402 added a trailing argument: `bridge/orchestrator.js:5582`
  `handleAccepted(id, summary || '', round, branchName, donePath, durationMs, verdictSource, reviewUsage);`
  The source is still passed; only the pattern's assumption that it is the last argument broke.
- The two assertions below it (lines 198-201) still pass; leave them as they are.

#### Out of scope

- None.

#### Tasks

1. `regression/review-verdict/j-verdict-read-fallback.test.js`, the slice-400-ac-4 test: make the
   `handleAccepted` assertion accept arguments after `verdictSource`, while still requiring
   `verdictSource` among the arguments of that call. Commit with the trailer
   `Test-Loosen-OK: regression/review-verdict/j-verdict-read-fallback.test.js — handleAccepted gained a trailing argument (slice 402); the assertion still requires verdictSource to be passed`.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-404-ac-1: The slice-400-ac-4 test in regression/review-verdict/j-verdict-read-fallback.test.js passes against the current bridge/orchestrator.js, where handleAccepted receives reviewUsage after verdictSource.
- slice-404-ac-2: The same test fails when invokeNog's handleAccepted call does not pass verdictSource.

#### Files expected to change

- regression/review-verdict/j-verdict-read-fallback.test.js (modified)

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-404-ac-1: The slice-400-ac-4 test in regression/review-verdict/j-verdict-read-fallback.test.js passes against the current bridge/orchestrator.js, where handleAccepted receives reviewUsage after verdictSource.
    AC: slice-404-ac-2: The same test fails when invokeNog's handleAccepted call does not pass verdictSource.

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

**AC Check:**

- slice-404-ac-1: *The slice-400-ac-4 test ... passes against the current bridge/orchestrator.js, where handleAccepted receives reviewUsage after verdictSource.* → ✓ Satisfied.
  Ran `node --test regression/review-verdict/j-verdict-read-fallback.test.js`: **12 tests, 12 pass, 0 fail**, and `slice-400-ac-4` — the test this slice repairs — is among the passes. The call it reads is `bridge/orchestrator.js:5582`, `handleAccepted(id, summary || '', round, branchName, donePath, durationMs, verdictSource, reviewUsage)`, i.e. the source with `reviewUsage` after it, exactly the shape the criterion names.

- slice-404-ac-2: *The same test fails when invokeNog's handleAccepted call does not pass verdictSource.* → ✓ Satisfied.
  Verified independently of Rom's report, by running the shipped pattern against the mutated source rather than taking the test's word for it: with `, verdictSource` removed the call reads `handleAccepted(id, summary || '', round, branchName, donePath, durationMs, reviewUsage);` and `/handleAccepted\([^)]*\bverdictSource\b[^)]*\)/` returns **false**. `[^)]*` cannot cross a `)`, so the name must sit inside that call's own parentheses; and `invokeNog` has exactly one `handleAccepted(` call site, so there is no second call the pattern could match by accident. The name is still present elsewhere in the mutated function (the rejected path at `orchestrator.js:5597` reads it) and the assertion still goes red — mentioned is not passed.

**Intent:** ✓ Achieved.

The goal is "dev is green again **and** the test still catches a handleAccepted call that stops passing the verdict source" — a two-sided goal, and the obvious way to fail it is to go green by making the assertion stop asserting. That did not happen. I checked the guarded behaviour is genuinely intact rather than merely re-described: `handleAccepted` at `orchestrator.js:4846` still does `if (verdictSource) acceptedDecision.verdict_source = verdictSource;`, and the two assertions below the changed line are untouched, as the brief asked. So the old assertion was over-specified — it pinned argument *order*, which nobody ever promised — and slice 402's honest addition tripped it. Repairing the over-specification is the right fix, not a green-wash.

The pair of new tests brackets the assertion from both sides, which is what makes this hold: too strict fails ac-1, too loose fails ac-2. I reproduced both mutations myself:

| mutation | ac-1 | ac-2 |
|---|---|---|
| pre-404 pattern `…verdictSource\)` (too strict) | **RED** | green |
| `/handleAccepted\(/` (too loose) | green | **RED** |
| shipped pattern | green | green |

**Code Quality Findings:** none.

The inline literal became a named const, `HANDLE_ACCEPTED_TAKES_VERDICT_SOURCE`, so the two new tests check the real pattern instead of a copy that could drift away from it — the right call, and the comment above it explains *why* (the 402 collision) rather than restating the regex. `\b…\b` is a small tightening the old pattern lacked. One detail worth naming as good: `assert.notEqual(withoutSource, INVOKE_NOG)` in ac-2 means the mutation test cannot silently decay into a no-op if the call site changes shape — it goes red loudly instead. That is the difference between a guard and a decoration.

**Linting:** N/A — the project has no `eslint.config.*` and no `lint` script in `package.json` (`npx eslint` errors out on missing config). Nothing to run, so nothing to fail.

**Safety-net tests / screen hooks:** PASS.

- **Count** — 2 criteria, 2 tests; the brief lists no traps, so no trap tests. Exact, no extras.
- **Tags** — both tests carry `slice-404-ac-1` / `slice-404-ac-2` in their titles and an `@ac-hash` line. I recomputed both against `acHashOf()` in `scripts/build-ac-manifest.js` from the AC text in the brief: `f394a83…b69e` and `aa68d7b…f0f0` — **both match exactly**, so the coverage deriver will count these as covering the criteria rather than filing them stale.
- **Break-it check** — present and, unusually, honest about a limit instead of papering over it. Rom reports that ac-2 *cannot* go red on the fix-undone, and he is right: the pre-404 pattern is the *stricter* one, and ac-2 guards the opposite direction, so a stricter pattern satisfies it by construction. Rather than claim a red he did not get, he ran the mutation ac-2 actually exists to catch and got the red there. Both reds reproduced above. This is the right way to handle a criterion the standard break-it recipe does not reach.
- **Nothing pins dead code** — the assertion and the call site both live.
- **Screen hooks** — none, correctly: no criterion touches the screen.
- **Report shape** — all seven contract headings present.

**Tests moved or weakened — second signature:** SIGNED.

The `slice-400-ac-4` assertion was deliberately weakened, from "`verdictSource` is the last argument" to "`verdictSource` is one of the arguments", and it is declared under `## Tests moved or weakened` with the reason and with what it still catches. The reason is a genuine spec change — `handleAccepted`'s signature grew on purpose in slice 402 — and not a cover for a red suite: I confirmed above that the behaviour the check guards still works. Rom authored the move, so the signature is mine.

**Flags (not findings):**

1. **For O'Brien — the `Test-Loosen-OK` trailer is malformed, and the brief dictated it that way.** `docs/contracts/test-update-gate-trailers.md` specifies `Test-Loosen-OK: <target> <transition> <reason>` with `<transition>` one of `strict→weak` / `removed` / `skipped` / `reworded`, and `lib/tests-needed.js:62` enforces exactly that grammar. The shipped trailer's second token is an em dash, so it does not parse. I ran the real parser on the actual commit body: `parseTrailers` returns `loosenOk: []` — and it is not captured in `rejected` either, it is **silently dropped**. The missing token is `strict→weak`.
   Not a finding against Rom: the brief's Task 1 specifies this exact string, em dash and all, and he wrote what he was told. It is also not load-bearing here (see flag 2), so a rework round would change nothing in the pipeline. But the brief text should be fixed before it is reused on a slice where it *is* load-bearing, because there the same string would read as an undeclared loosening and block promote.

2. **For O'Brien — the Test-Update Gate never saw this loosening at all.** Using the exact command `gather()` uses (`git diff base..head -- <testfile>`, default context), `classifyFileDiff` reports only `slice-404-ac-1` and `slice-404-ac-2`, both `tightened`. `slice-400-ac-4` does not appear: the engine attributes +/- lines to the enclosing `test()` block, and the changed assertion sits ~8 lines below its `test(` line, outside the 3-line default context, so the check never enters the changed set. Over the real promote range (`main...HEAD`) the file is a fresh add — all 12 checks read `tightened`, no masking direction at all. So the verdict will not go RED and there is nothing for a trailer to clear. That is why this slice is safe; it is also a standing gap worth knowing about — **a loosened assertion in the middle of a long test body is invisible to the gate**, and the human second signature is the only thing that catches it.

3. **Rom's squash note is out of date — do not act on it.** The report warns that `squashSliceToDev` carries only `AC:` trailers onto dev. That was true once; `bridge/orchestrator.js:9428` now carries `Tests-Not-Needed|Test-Loosen-OK|Coverage-Removed` across as well. The trailer *will* land on dev — malformed, per flag 1.

**Scope:** clean. Against the branch point (`12b70a2`) this is **one commit, two files**: `regression/review-verdict/j-verdict-read-fallback.test.js` — the single file the brief expected — and the required `bridge/queue/404-DONE.md`. Working tree clean. No `e2e/` file touched, no `regression/*.lock` touched, which is correct: `orchestrator.js:2989` explicitly tells Rom not to, because the pipeline regenerates the locks when the slice lands. (The ~212-file `main...branch` diff in the review packet is dev's history since main, not this slice's work; `git diff --name-status 12b70a2..HEAD` is the two files above.)

**Lane check:** core, satisfied — one safety-net test per acceptance criterion (2/2), no traps in the brief so no trap tests, the break-it list present under `## Safety-net tests`, and all seven report headings of the contract.

## Rom's DONE report

#### Summary

The slice-400-ac-4 assertion demanded that `verdictSource` be the **last** argument
`handleAccepted` is called with. Slice 402 appended `reviewUsage` after it
(`bridge/orchestrator.js:5582`), so a call that still passes the source read as a call
that had dropped it, and dev went red. The assertion now requires `verdictSource` to be
**among** that call's arguments, wherever it sits in the list. The file is green against
the orchestrator as it stands, and still goes red the moment the source stops being passed.

Two safety-net tests, one per criterion. No trap list in the brief. Nothing else touched:
one file, 55 insertions, 1 deletion.

#### What changed

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

#### Acceptance criteria verification

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

#### Safety-net tests

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

#### Screen hooks

None. No criterion touches the screen.

#### Tests moved or weakened

- `regression/review-verdict/j-verdict-read-fallback.test.js`, the `slice-400-ac-4` test:
  its `handleAccepted` assertion was **weakened**, deliberately and as the brief instructs —
  from "`verdictSource` is the last argument" to "`verdictSource` is one of the arguments".
  Why: the old wording asserted an argument *order* nobody promised, so slice 402's honest
  addition broke it. What it still catches: a `handleAccepted` call that does not pass the
  source at all, which is the regression the AC-4 test was written for and which
  `slice-404-ac-2` now pins down. This is the second-signature item for Nog.
- Nothing moved, renamed or removed. No browser test touched.

#### Commit

Branch `slice/404`, one commit on top of `12b70a2`, one file changed.

Trailers on the commit: the two `AC:` lines from the brief, and
`Test-Loosen-OK: regression/review-verdict/j-verdict-read-fallback.test.js — handleAccepted gained a trailing argument (slice 402); the assertion still requires verdictSource to be passed`.

One thing for whoever presses promote: `squashSliceToDev` is known to carry only `AC:`
trailers onto dev, so the `Test-Loosen-OK` line may not survive the squash and the gate may
read this weakening as undeclared. Nothing I can do from this branch; noting it so it is not
a surprise.

## Nog's verdict and review

_None recorded._

## Julian's result

### Julian's stage — result

**No browser test added, none moved.** Browser suite unchanged: **54 tests in 21 files**
(`npx playwright test --list`, the lister, not a run). Nothing under `e2e/` was written.
That is the correct outcome for this slice, and the sections below are the evidence for it
rather than a shrug — a stage that writes nothing has to show its work harder than one that
ships a test.

#### Which criteria have a browser test

| Criterion | Browser test | Why |
|---|---|---|
| slice-404-ac-1 | none | No screen. The criterion's entire observable is whether `node --test regression/review-verdict/j-verdict-read-fallback.test.js` passes. A safety-net file's exit status is not rendered anywhere. |
| slice-404-ac-2 | none | No screen. Same file, asserted under a mutation of the orchestrator source held in memory by the test. Nothing is written, nothing is served, nothing is drawn. |

#### I went looking for a screen, as I did on slice 400, and there is none

On slice 400 the packet also said "Screen hooks: none", and it was wrong about ac-4 — that
criterion changed the shape of the `NOG_DECISION` records in `bridge/register.jsonl`, and the
Logbook renders rows from that file. So "the sticker says none" is not an answer I accept from
myself. Here is why the answer is genuinely none this time:

1. **The product delta is empty.** Packet item 4 lists four changed files, and I confirmed the
   same four from the squash commit on dev (`git diff --name-status 12b70a2..663d2ed`, file
   names only): `regression/review-verdict/j-verdict-read-fallback.test.js` (a safety-net test),
   `regression/AC-MANIFEST.lock` and `regression/COVERAGE.lock` (test-infrastructure artifacts
   the pipeline regenerates), and `bridge/queue/404-ARCHIVED.md` (a queue record). No file that
   the product executes to draw a page changed. A slice with an empty product delta cannot have
   moved the screen, so there is no rendered state for a browser test to catch.
2. **The two `.lock` files were considered and rejected as a surface.** They grew because the
   slice added two tagged tests. If a panel somewhere counts guards or criteria, that count may
   tick — but that is the AC-reconcile pipeline behaving as its own criteria say, not anything
   slice 404 promises. Neither ac-1 nor ac-2 mentions a manifest, a count or a panel. A test
   there would be a test with no acceptance criterion, which is the one kind of test I am
   specifically told not to write.
3. **No existing browser test should be red from this slice**, for the same reason: no product
   behaviour changed. I did not run the suite to establish that — the stage machinery's one
   counted run does that, after this result.

I did not need to open a browser for this slice, and I did not. There was no candidate surface
to inspect; the argument above is stronger than a look would have been.

#### Who adjudicates this slice's goal

The goal line is two-sided: *"The safety-net run on dev is green again **and** the test still
catches a handleAccepted call that stops passing the verdict source."*

The first half is decided entirely by the **full safety-net run the stage machinery makes on dev
after I emit `tests-updated`** — that run *is* the criterion, literally. My browser suite has no
vote on it, and neither do I. The second half is a property of a safety-net test, which is Rom's
to hold and Nog's to second-sign; both are recorded above in this sticker. This is an unusual
slice for my stage in that the instrument that decides it is the one I am forbidden to run
myself and am instead the trigger for. Worth saying out loud so a green stage here is not read
as *my* suite having confirmed anything about `handleAccepted`.

One piece of independent evidence arrived while I worked, and it is fair to record it: at
20:08:55Z the register took `DEV_SUITE_GREEN` for `663d2ed` — this slice's squash — from GitHub
run [36052454521](https://github.com/hilbertp/denorios/actions/runs/36052454521). That is the
`ci.yml` push run, which my role file calls a warning light and not a counted run, so it does not
decide anything. But it is the same suite on the same sha, and it is green, which is the goal's
first half showing up early from a source that is not me, not Rom and not Nog. The counted run
still follows this result.

#### The behaviour behind the weakened assertion still has its screen guard

Rom deliberately weakened one assertion (packet item 6): the `slice-400-ac-4` check went from
"`verdictSource` is the **last** argument to `handleAccepted`" to "`verdictSource` is **among**
its arguments". I did not touch it and could not — safety-net tests are not mine — but I did
check what my own suite still holds around it, because a weakened guard is exactly when you want
to know what else is standing:

- `e2e/verdict-source-history.spec.js` (mine, from slice 400) still holds the **screen
  consequence**: all three `verdict_source` values render as a one-round success, with the
  pre-fix lost-verdict shape seeded alongside as a discriminator that renders `2`.
- It explicitly does **not** hold the emission itself — the spec header says so, because the
  path spawns `claude -p` and the fixture sets `LOB_NO_LAUNCH=1`. So the weakened assertion is
  still the *only* guard that `invokeNog` passes the source at all.

That is not a complaint about the weakening — the old wording pinned an argument *order* nobody
promised, and Nog's review reproduces both mutations. It is a statement of where the guard lives,
so that if that assertion is ever loosened again, everyone knows the browser suite will not
catch the fall.

#### Flag — the break-it check will call both of Rom's tests hollow, and it will be wrong

This is the one finding of this stage, and it is about the script in packet item 8, not about
slice 404's work.

Packet item 8 says the break-it script has not run yet and is the next slice in this set. Applied
to slice 404, the recipe in my role file does this: classify the changed files (test files =
`regression/**/*.test.js`; product files = everything else except `bridge/queue/`), check the
**product** files out from `<sha>^` in a scratch worktree, then run the slice's new test files
and expect each to go red.

On this slice the product-file set is `regression/AC-MANIFEST.lock` and `regression/COVERAGE.lock`
and nothing else. Reverting those two cannot change the result of
`j-verdict-read-fallback.test.js`, which reads `bridge/orchestrator.js` — a file this slice never
touched and which is therefore identical at `<sha>` and `<sha>^`. So **both** `slice-404-ac-1`
and `slice-404-ac-2` will run green under the fix-undone condition and be recorded as
*still-green*, i.e. hollow. By my role file, "a criterion whose only safety-net test is hollow is
a bug exit", which would put O'Brien on a fix slice asking Rom to replace two tests that are
sound.

They are sound. Nog reproduced both directions himself and records the table in this sticker
(too strict → ac-1 red; too loose → ac-2 red; shipped pattern → both green), and Rom reported
honestly in advance that the standard fix-undone recipe cannot redden ac-2, because the stashed
state is the *stricter* pattern and ac-2 guards the opposite direction.

The general shape, which is what makes it worth a flag rather than a footnote: **the break-it
recipe assumes the slice changed product code.** On a slice whose fix *is* the test — a test
repair, a loosening, a re-tag — there is no product delta to revert, so every new test stays
green and the script reports the whole slice hollow. Slice 404 is the first of that shape to
reach the stage; it will not be the last. The script needs a rule for the empty-product-delta
case (mutate the asserted-on source, or record "not applicable — no product delta" rather than
"hollow"). I have written this to O'Brien's inbox as
`HANDOFF-BREAKIT-EMPTY-PRODUCT-DELTA-FROM-BASHIR.md` rather than leaving it here only, because
the break-it slice is the *next* one written and a flag that arrives after it is built is a flag
wasted. It is a process gap, not a QA red, and I am not proposing the fix — the choice between
those two rules is O'Brien's and Worf's.

Until that script runs and is believed, both of Rom's safety-net tests remain **unconfirmed by
machine**, as item 8 instructs. Nog's hand-reproduction is the evidence standing in for it, and
it is good evidence, but it is a human's, not the script's.

#### Two smaller notes on the packet, for whoever tunes the assembler

- **Section 3 ("Nog's verdict and review") reads `_None recorded._`, but the review is not
  missing** — it travels inside section 1, appended to the brief as `#### Nog Review — Round 1`,
  and it is thorough. I had it. But a stage that trusted section 3 would have concluded the slice
  reached it unreviewed. The verdict should be lifted into its own section, or section 3 should
  point at where it actually sits.
- **Nog's flag 1 holds on dev.** I checked the squashed commit's message on dev (message only,
  no diff): the `Test-Loosen-OK` trailer did survive the squash — so Rom's closing worry in his
  report is stale, as Nog says — but its second token is an em dash where
  `docs/contracts/test-update-gate-trailers.md` requires a transition
  (`strict→weak` | `removed` | `skipped` | `reworded`). I read the contract to confirm the
  grammar; I did not open the parser, and Nog's finding that it is silently dropped is his, not
  independently reproduced by me. Not a QA red, and not Rom's fault — the brief dictated the
  string — but it is now a malformed trailer sitting on dev.

#### Exit

**No exit taken.** Nothing I can judge from this packet contradicts the product, and no criterion
was unclear: both are precise, and both are simply not mine. This is not a green verdict either —
the verdict belongs to the stage's two suite runs, which follow this result.

#### Files I read

`.claude/roles/bashir/ROLE.md`; `bridge/queue/404-IN_QA.md` (this sticker);
`bridge/queue/400-ARCHIVED.md` (my own prior result, for format);
`docs/contracts/test-update-gate-trailers.md`; `e2e/verdict-source-history.spec.js` and the file
listing of `e2e/`; `bridge/state/qa-stage-{399,400,401,404}.json`; the `tests-updated` lines of
`bridge/register.jsonl`; and via git, file **names** and **commit messages** only
(`git diff --name-status 12b70a2..663d2ed`, `git log -1 --format=%B 663d2ed`).

**No product source file was opened.** Not `bridge/orchestrator.js`, not `dashboard/`, not
`lib/`, and not the safety-net test this slice repairs. The one product module I touched was
`bridge/state/gate-telemetry.js`, and I did not read it: I probed its exported names with
`node -e "Object.keys(require(...))"` so that I could call `emit()` correctly, because my role
file's documented emit path (`bridge/state/gate-telemetry.emit`) does not exist on disk.

#### Commit

One commit on dev, `40a5cec`, one file: the O'Brien handoff above. **No `e2e/` file was
committed because none was written.** This result section is not in that commit: the sticker
in its `404-IN_QA.md` form is covered by `.gitignore`'s `bridge/queue/*.md`, and the permanent
record is the `404-ARCHIVED.md` the pipeline force-adds when the stage archives it — which is
where this text will land, exactly as slices 399, 400 and 401 did.

#### Signal

`tests-updated` emitted via `gate-telemetry.emit` (never written to `register.jsonl` by hand):
`{ suite_size: 54, tests_added: 0, tests_updated: 0 }`. The stage machinery's one run of each
full suite follows.

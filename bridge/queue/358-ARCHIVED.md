---
id: "358"
title: "Apply Julian's draft — the overlay's honest green"
from: rom
to: nog
status: DONE
slice_id: "358"
branch: "slice/358"
completed: "2026-09-14T20:42:00.000Z"
tokens_in: 42
tokens_out: 21798
elapsed_ms: 339818
estimated_human_hours: 0.75
compaction_occurred: false
tokens_cache_read: 4425709
cost_usd: 3.2944345
---

# Apply Julian's draft — the overlay's honest green

## Summary

**Round 3 — the merge, and one word.** Jordan accepted round 2 at `c2006de`; this round is the
merge Taylor asked for, because slice 363 landed on dev at `ff82f1a` while this slice was in
review and both slices add to `dashboard/server.js`. Merged, not rebased — the branch's three
commits are untouched and the merge sits on top with both parents.

**What conflicted: exactly one line.** The `module.exports = { … }` line at the foot of
`dashboard/server.js`. Both slices had appended to it and git could not tell which append came
first — 363 added `QUEUE_SUFFIX_STATE, QUEUE_SIDECAR_SUFFIXES, queueStateOf, isQueueSidecar,
readQaStage` at the front of the list, and this slice added `applyPlanFor, applyDraftFor` after
`kickOffAuthoring`. There is no behavioural question in it: both sides are additions to the same
list, so the resolution is the **union**. I took dev's line and re-inserted this slice's two names
in their original position, then checked it name-by-name rather than by eye — **39 exports on my
side, 42 on dev's, 44 merged, and the set difference is empty**, so nothing either slice exported
was dropped.

**Nothing else in the file conflicted, and nothing else needed a judgement call.** 363's work sits
around the IN_QA state and the packet builder; this slice's sits around the apply-draft endpoints.
They share no function, so git auto-merged the rest correctly and I confirmed both bodies of work
are present in the merged file — `classifyApprovalOrigin` still gates both apply routes
(`dashboard/server.js:3963`, `:3991`), and 363's `readQaStage` / queue-suffix code is intact.
`dashboard/lcars-dashboard.html` auto-merged with no conflict at all (363's QA additions alongside
this slice's apply overlay) and its single inline script still compiles under `vm.Script`.

**One word beyond the merge, and I want it seen rather than found.** Jordan's round-2 review
carried one finding — *"for the next touch, not for another round"* — that
`j-check-draft-review.test.js:141` records the transition as `strict→weak` in a comment while the
trailer on `c2006de` correctly says `reworded`. Taylor's round-3 note says *"change no other
file"*. I made the one-word fix in a **separate commit** from the merge, so the merge commit is
exactly the resolution the brief asked for and the audit-trail fix is its own reviewable line. It
is a comment; no assertion, name or behaviour moved. Reasoning under *Conflicts with the brief*.

The rest of this report is the slice as delivered, with the round it came from marked.

## What changed

**Round 3 (this round) — two commits, three files:**

| File | What |
|---|---|
| `dashboard/server.js` | The only merge conflict: `module.exports` resolved as the union of 363's five new names and this slice's two. |
| *(the merge itself)* | Brings dev's `bridge/qa-stage.js`, `bridge/orchestrator.js`, `bridge/templates/bashir-prompt.md`, `regression/gate-merge/j-julian-stage-in-qa.test.js`, both `regression/*.lock`, `scripts/author-ac-test.js`, a runbook and a handoff — all of them 363's or dev's, none of them mine, none edited by me. |
| `regression/gate-merge/j-check-draft-review.test.js` | Jordan's round-2 finding: one comment word, `strict→weak` → `reworded`, so the in-file record matches the trailer actually on `c2006de`. Separate commit. |

**Round 2 (`c2006de`) — Jordan's five round-1 findings:**

| File | What |
|---|---|
| `regression/gate-merge/j-check-draft-review.test.js` | **Finding 1.** `slice-356-ac-4`'s assertion moved to the new truth, with a `Test-Loosen-OK: … reworded` trailer. See *Tests moved or weakened*. |
| `regression/gate-merge/j-apply-draft.test.js` | **Finding 2** — `corroboratingGuard()`'s two load-bearing lines built from fragments; trap-4 gains the phantom-source assertion. **Finding 5** — trap-1 no longer pins `recordAcDecision()`'s unfixed defect. Plus ac-1 updated to the new client call and to both routes being origin-gated. |
| `dashboard/server.js` | **Finding 3** — `GET …/apply-plan` refuses a request with no live UI nonce (403 `E_NOT_UI`). **Finding 4** — `_applyBusy` / `_withApplyLock` removed; the comment now states that the server serialises by blocking and what that costs. |
| `dashboard/lcars-dashboard.html` | **Finding 3** — the plan is fetched with `uiFetch`, so it carries the nonce and is preflighted. |
| `lib/apply-draft.js` | **Finding 4** — runner caps 120s → **60s** / 240s → **90s**, arithmetic written down. `planApply`'s doc no longer claims `WRITES NOTHING INSIDE THE REPO`. |

**Round 1 (`197b7c8`) — the implementation:**

| File | What |
|---|---|
| `lib/apply-draft.js` *(new)* | The engine. `planApply()` computes the plan; `applyDraft()` acts only on a plan the operator confirmed. Holds the AC-custody list, the scratch-mirror coverage prediction, the guard runner, and the commit-message builder. |
| `dashboard/server.js` | Two routes — `GET /api/check-test-updates/apply-plan` and `POST /api/check-test-updates/apply` (the only writer) — plus `applyPlanFor()` / `applyDraftFor()`. |
| `dashboard/lcars-dashboard.html` | The overlay half: **Apply this guard…** on each drafted card, the plan panel (`_renderApplyPlan`), the confirm path (`_confirmApply`), the applied-record line, and the CSS. |
| `scripts/build-coverage-map.js` | Export `walkSpecs` alongside `walkTests` (+3 lines), so the scratch mirror is assembled with the deriver's **own** walkers. |
| `.gitignore` | Ignore `**/.apply-scratch.test.js` / `**/.apply-scratch.spec.js` (both lines survived the merge). |
| `regression/gate-merge/j-apply-draft.test.js` *(new)* | The safety net: 6 AC tests + 5 trap tests. |

No `e2e/` fixture or helper was touched, in any round.

Two details in the engine are load-bearing and easy to lose in review:

- **The draft is run inside its landing directory.** A guard resolves the repo with
  `path.resolve(__dirname, '..', '..')`, so running it at any other depth makes it read a repo that
  is not there and fail for a reason that has nothing to do with the AC.
- **`NODE_TEST_CONTEXT` is scrubbed from the runner's env.** `node:test` sets it in every test
  child; a `node --test` that inherits it switches to the child-reporter protocol and **exits 0
  with failing tests**. `ac-4` asserts this directly.

## Acceptance criteria verification

All six re-verified **after** the merge, on the merged tree, not carried over.
Command for every row: `node --test regression/gate-merge/j-apply-draft.test.js` — **11/11 pass**.

| Tag | Test file | Result |
|---|---|---|
| slice-358-ac-1 | `regression/gate-merge/j-apply-draft.test.js` | PASS — plan writes zero bytes (whole-tree hash compare), and an apply with no token refuses `E_NOT_CONFIRMED`. Asserts the overlay's two steps, that the plan is a `GET` and the apply the only `POST`, and that **both** routes pass through `classifyApprovalOrigin`. Still true on the merged file — the gates are at `dashboard/server.js:3963` and `:3991`. |
| slice-358-ac-2 | same | PASS — guard lands byte-for-byte at its declared target, lock regenerated from the tree it now sits in, both in **one** commit, working tree clean afterwards, stamped `Approval-Provenance` / `-Ts` / `-Sig`. `machine-unknown`, `legacy-unattributed`, an unknown value and `undefined` each refuse. |
| slice-358-ac-3 | same | PASS — target under `regression/.quiet/` is contract-valid but invisible to the walker; refuses `E_TAG_NOT_IN_MAP` at `stage: 'plan'`, tree byte-identical, no commit. |
| slice-358-ac-4 | same | PASS — (a) a throwing draft refuses `E_SUITE_RED`, and still does with `NODE_TEST_CONTEXT=child-v8` forced; (b) a rewrite that drops the source read refuses `E_GUARD_COUNT_FELL` *while green and in-map*; (c) a `new` target that already exists is refused. |
| slice-358-ac-5 | same | PASS — with five AC-custody files seeded, a successful apply changes **exactly** `COVERAGE.lock` + the target; all five byte-identical. `commitMessageFor()` throws on an `AC:` trailer. `recordAcDecision` appears nowhere in the engine. |
| slice-358-ac-6 | same | PASS — the AC reconciles `COVERED` and `triage()` returns `flagged: []`, `ready: true`; the route answers with `getCheckTestUpdates()` and the overlay re-renders from it. |

**The three files the brief names, on the merged tree:**

| File | Result |
|---|---|
| `regression/gate-merge/j-apply-draft.test.js` | **11 pass, 0 fail** |
| `regression/gate-merge/j-check-draft-review.test.js` | **8 pass, 0 fail** — including after the one-word comment fix |
| `regression/gate-merge/j-julian-stage-in-qa.test.js` (363's) | **12 pass, 0 fail** |

**Dependency-scoped run (the same instrument as round 2, widened for 363).** My role file and this
brief's *What you run* both say never to run the full safety-net suite, and I did not. Instead I
ran every safety-net file that reads one of the sources this merge touches —
`grep -rl -e 'server.js' -e 'lcars-dashboard.html' -e 'apply-draft' -e 'qa-stage' regression`,
**44 files, 388 tests: 382 pass, 1 fail, 5 skipped.** The single failure is
`j-coverage-map-integrity slice-99822-ac-1` — `COVERAGE.lock` 740 committed (dev's, post-363) vs
758 derived. Same known state as both earlier rounds: the brief forbids me to run the derivers and
`j-locks-regenerated-at-landing` guarantees the pipeline regenerates both locks inside the landing
commit. The merge did not add a second failure.

**Coverage map after the merge, measured:** derived `guardCount` **758**, committed lock **740**,
**zero** keys naming a file that does not exist on disk, and `lib/apply-draft.js` present in the
derived map (absent from the committed lock, which is the 18-guard gap above). The round-2 phantom
(`lib/thing.js`) has not come back.

**Test-Update Gate, post-merge.** `classify({ base: 'ff82f1a', head: 'HEAD' })` →
`decision: 'red_flag'` from exactly one signal, `newBehaviourNoTest: ['lib/apply-draft.js']` — the
same stale-lock artefact, since the classifier reads the committed lock which does not yet know
that file is guarded. Everything trailer-shaped is clean: `loosenedUndeclared: []`,
`removedUndeclared: []`, `mismatchedOverride: false`, `rejectedTrailers: []`,
`coverageShrink: false`, `acMutated: []`. Measured from the older base `0e83fac` the same signal
also names `bridge/qa-stage.js`, which is 363's file and the same artefact.

## Safety-net tests

One file, `regression/gate-merge/j-apply-draft.test.js` — 6 AC tests + 5 trap tests, then stop.
**No test was added, removed or changed this round**; the count and the assertions are exactly as
Jordan accepted them at `c2006de`. Every fixture is its own throwaway git repo in a tmpdir with a
real suite and a real in-sync lock, so nothing in it can write to this one. Fixture AC tags use the
reserved `99xxx` range, and both the `@ac-hash` annotation and the fixture's source-read line are
built from fragments so the deriver cannot read a fixture as real coverage.

**Break-it-on-purpose.** Nothing new to break this round — a merge resolution and a comment are not
behaviours, and inventing a mutation for them would be theatre. The evidence that matters is that
the guards still bite **on the merged tree**, so I re-ran the round-2 mutation table's two merge-
sensitive rows against the post-merge file rather than trusting that the merge preserved them:

| Mutation, applied to the merged tree | Result |
|---|---|
| m1 — the `classifyApprovalOrigin` block removed from the plan route | `slice-358-ac-1` RED |
| m4 — the apply `POST`'s origin gate neutered (`origin = { ok: true }`) | `slice-356-ac-4` RED |

Both reverted, and the revert verified by comparing the working-tree diff hash back to the
pre-mutation baseline. Round 2's full six-row table (m1–m6) and round 1's eleven-row per-guarantee
table both still stand and are recorded in the earlier rounds' reports; I did not re-run rows whose
code the merge did not touch, and I am saying so rather than implying a fresh full sweep.

**What I saw in the browser.** Nothing new this round — I did not boot the dashboard, because the
merge changed no route, handler or markup and the conflict was a `module.exports` list. Round 2's
live drive stands: `403 E_NOT_UI` without a nonce, `400 E_BAD_TAG` / `404 E_NO_DRAFT` with one, and
a full plan against the real tree that ran the guard green at
`regression/gate-merge/.apply-scratch.test.js` and then refused with `E_LOCK_STALE`.

## Screen hooks

Unchanged this round — the merge added, renamed and removed no hook, and
`dashboard/lcars-dashboard.html` auto-merged without conflict. All still present in the shipped
page. The card-level ones are per-tag; the plan contents live inside `#utc-apply-<tag>`, so a
browser test can scope to one AC.

| Hook | What it is | Starting state |
|---|---|---|
| `#utc-apply-btn-<tag>` | The **Apply this guard…** button | Rendered only on a card whose state is `drafted`. `aria-expanded="false"`; label toggles to *Hide the plan* when open. |
| `#utc-apply-<tag>` | The plan panel | Present but `hidden` until the button is pressed; shows *Working out what applying this would do…* while the plan is fetched. |
| `.utc-apply-head` | The panel's lead line | *"If you confirm, this is exactly what happens:"* when appliable, *"This draft cannot be applied as it stands:"* when not. |
| `.utc-plan-row` | One fact of the plan | One per fact. Carries `.utc-plan-yes` / `.utc-plan-no` / `.utc-plan-neutral`; glyph in `.utc-plan-glyph` (`✓` / `✗` / `→` / `·` / `✎`). |
| `.utc-plan-sub` | Sub-line under a row | The tail of a failed run, or the guard-count note. `white-space: pre-wrap`. |
| `.utc-refusals` / `.utc-refusal` | The refusal box and each reason | Absent when there are no refusals; one `.utc-refusal` per reason, in plain language. |
| `#utc-apply-<tag> .utc-btn-confirm` | **Confirm and apply** | **Exists only when `plan.ok` is true.** A refused plan has no button to press. Disabled and relabelled *Applying…* on click. |
| `.utc-apply-note` | The note beside the confirm | Always present when the confirm is. |
| `.utc-applied` | The record of what landed | Absent until an apply succeeds; then pinned under the card's `h3` so a re-render cannot wipe it. Holds the file list and the short sha in `<code>`. |

One behaviour Julian should know about: after a successful apply the overlay's *ready to gate*
state **stops auto-dismissing** (`_applyLanded`). Normally that card closes itself after 1.1 s;
since the only record of the two files that were just written is on it, the operator closes it.

## Tests moved or weakened

**None this round.** No assertion was moved, renamed, weakened, skipped or removed by the merge.
The only edit to a test file is one **comment** word in
`regression/gate-merge/j-check-draft-review.test.js:141` — `strict→weak` → `reworded` — which is
Jordan's own round-2 finding and changes no assertion. The file is 8/8 green before and after.

**Carried from round 2, still the record for this slice.** `slice-356-ac-4` in
`regression/gate-merge/j-check-draft-review.test.js`, declared on `c2006de` as:

    Test-Loosen-OK: slice-356-ac-4 reworded slice 358 is the slice commissioned to add the apply control this assertion forbade; the assertion moves to the read path and to what gates the write

`reworded` is not a guess — the gate's own direction engine reports
`{ kind: 'modified', direction: 'reworded' }` for this check, and `mismatchedOverride` is `false`.
*What was removed:* one term from one negative assertion (`utc-btn-apply`), which slice 358 was
commissioned to make exist. *What replaced it:* a draft is still never moved or deleted from the UI;
the apply is **its own named POST route**, not a mode of the draft route; no route whose path
contains `draft` may be a `POST` at all (that sibling assertion was previously green by
coincidence); and the write route must pass `classifyApprovalOrigin`. Slice 356's **acceptance
criterion text was not touched** — that is Philipp's to restate.

## Conflicts with the brief

1. **"Change no other file" vs. Jordan's round-2 finding.** Taylor's round-3 note says this round is
   the merge and nothing else; the amendment block's success criterion 1 says all findings from the
   latest round are addressed, and the latest round's one finding is the stale `strict→weak`
   comment — which Jordan wrote should be fixed *"whenever that file is next open"*, and it is open,
   because this merge touches its sibling guard's subject. I did both, and separated them: the
   merge commit changes only `dashboard/server.js`'s conflicted line, and the comment fix is its
   own commit alongside this report. If O'Brien would rather the branch carry only the merge, that
   second commit reverts on its own with no effect on anything else.
2. **Still open from round 2, for O'Brien to settle:** `slice-356-ac-4`'s *text* is superseded by a
   later commissioned slice and restating it needs `AC-Change-OK:` + `Spec-Owner: Philipp`; and the
   brief still says two different things about running the full safety-net suite (*What Rom does
   not do* says "once before commit", *What you run* and `ROLE.md` say never). I followed the role
   file under Precedence and ran the dependency-scoped subset, as in round 2. Jordan flagged both
   for routing; neither is mine to decide.
3. **For the promote step, unchanged:** `squashSliceToDev` keeps only `AC:` trailers, so the
   `Test-Loosen-OK:` on `c2006de` will not survive onto dev. Mechanically harmless — `reworded` is
   CLEAR without an override — but it means the in-file comment is the surviving human record,
   which is exactly why finding 1's one word was worth fixing.

## Commit

Branch `slice/358`. Five commits now, none rewritten:

- `197b7c8` — *S358 r1 (recovered)*: the implementation, committed by Taylor when the orchestrator's
  output buffer killed the first attempt.
- `aaad8e0` — the round-1 DONE report and the six `AC:` trailers.
- `c2006de` — *S358 r2*: Jordan's five round-1 findings, the moved `slice-356-ac-4` assertion with
  its `Test-Loosen-OK: … reworded` trailer. **Accepted.**
- `583a36f` — *S358 r3: merge dev (363) into slice/358; resolve dashboard/server.js*. A real merge
  commit, parents `c2006de` and `ff82f1a`. Carries `Lane: core` and the six `AC:` trailers as the
  brief asks. Changes one line of `dashboard/server.js` beyond what dev brings.
- This round's second commit — Jordan's one-word comment fix and this report.

`regression/COVERAGE.lock` and `regression/AC-MANIFEST.lock` came from dev with the merge and were
**not** regenerated by me — the pipeline does that inside the commit that lands the slice. The lock
the pipeline will generate is clean: zero phantom keys, `guardCount` 758.

---
id: "363"
title: "Julian's stage becomes a real step: the IN_QA state and its packet"
from: rom
to: nog
status: DONE
slice_id: "363"
branch: "slice/363"
completed: "2026-09-14T19:18:06.000Z"
tokens_in: 122
tokens_out: 54183
elapsed_ms: 701483
estimated_human_hours: 8.0
compaction_occurred: false
tokens_cache_read: 6497137
cost_usd: 6.086720500000001
---

## Summary

Round 2 — Nog's four findings, all fixed. The one that mattered is finding 1: the packet's
item 1 was `splitFrontmatter(brief).body`, and in a real brief the goal is a **frontmatter
field**, so the sentence saying what the slice was for never reached Julian. It reached
nothing else either — the sticker embeds the same value, so the permanent record lost the
goal, the title, the lane and `references` as well. Item 1 is now the whole slice file,
delimiters and all, and Nog's own reproduction is the check: built against the real on-disk
documents of slices 363 and 395, both prompts now carry their `goal:` line, both still
carry exactly the eight headings plus the two operational ones, and neither carries a diff
line. Finding 4 is fixed with it — the ac-5 fixture is now shaped like a real brief (goal
in the frontmatter, body opening `## What is broken`), and I checked that the old fixture
really did green the broken code and the new one really does go red on it.

Findings 2 and 3 were both in the landing machinery. The IN_QA recovery loop is out of
`crashRecovery` and into its own `recoverOrphanedQaStages()`, which runs **after**
`recoverGateMutex` — the order the old comment claimed and did not have — and which now
leaves a stage alone when the mutex survived that call, because a surviving mutex means
Julian's heartbeat was fresh and he is still writing. The drain no longer re-enters itself:
a landed slice leaves `deferred_slices` before its stage starts, and a nested call is a
no-op, so a start that fails can no longer squash an already-landed slice a second time.

Everything from round 1 stands unchanged: the stage starts on a landing, the slice wears
`IN_QA` while it runs, Ops names it, archival waits for the result, and the verdict, the
two red exits and the Playwright run are still **not** wired (trap 3).

## What changed

Four files against round 1. Nothing else on the branch was touched.

- `bridge/qa-stage.js` — new `withFrontmatter(content)`, and `assemblePacket` builds item 1
  with it instead of `splitFrontmatter(...).body`. The brief goes over whole: `---`
  delimiters, `goal:`, `title`, `lane`, `references`, then the body. `redactCode` still runs
  over all of it, so the ac-6 guarantee is unchanged. Exported beside `splitFrontmatter`.
  **(finding 1)**
- `bridge/templates/bashir-prompt.md` — four lines under `## 1. The slice file` telling
  Julian what the YAML block above the brief is and that the `goal:` line in it is what he
  judges the shipped slice against. No new `##` heading; the eight-item contract is
  untouched. **(finding 1)**
- `bridge/orchestrator.js` —
  - `recoverOrphanedQaStages(opts)`, new, holding the loop that used to sit in
    `crashRecovery`. Called from the startup block on the line **after**
    `recoverGateMutex(...)`, and it returns its actions into `recoveryActions` so the
    startup block can print them (it now has a line for `qa_stage_orphan`, which had none).
    If the mutex is still held after gate recovery, the stage is in flight and is left
    alone; the `opts.mutex.held` seam means a test never has to consult the live
    `bridge/state/gate-running.json` to find that out. `crashRecovery` keeps a two-line
    comment pointing at where the loop went. **(finding 2)**
  - `drainDeferredAfterGate` is now a re-entrancy guard around `_drainDeferredAfterGate`,
    and the landed entry leaves `deferred_slices` **before** `startQaStageOrArchive` is
    called rather than after it. **(finding 3)**
  - `let _draining = false` is declared up with `LOCK_FILES` and `BRANCH_STATE_PATH`, not
    beside the drain. The startup block runs during module evaluation and can reach the
    drain through `finishQaStage`, which is exactly the temporal-dead-zone landmine that
    cost slice 389 a daemon exit; I checked the rest of that path for the same thing and
    nothing else it touches is declared below the startup block.
- `regression/gate-merge/j-julian-stage-in-qa.test.js` — the fixture reshaped and three
  assertions added; no test added, moved or removed (still 12). **(finding 4, and cover for
  2 and 3)**

No `e2e/` file was touched. `regression/*.lock` untouched; no `build-coverage-map` or
`build-ac-manifest` run, as the brief instructs.

## Acceptance criteria verification

`node --test regression/gate-merge/j-julian-stage-in-qa.test.js` — 12 tests, 12 pass, 0 fail.

| Tag | What the test does | Result |
|---|---|---|
| slice-363-ac-1 | Calls the landing entry point with nobody pressing anything and finds the slice in QA; pins that `handleAccepted` and `drainDeferredAfterGate` both call `startQaStageOrArchive`, that `handleAccepted` no longer archives at squash, that a landed slice leaves `deferred_slices` before its stage starts, and that the drain refuses to re-enter itself; asserts `startGate()` throws `GATE_RETIRED`, that `POST /api/gate/start` answers 410 against a real server, and that `server.js` carries no `startGate` reference outside comments | pass |
| slice-363-ac-2 | Starts the stage: `{id}-IN_QA.md` exists, the previous name is gone, exactly one `IN_QA` event with `slice_id` and `started_ts`. Then the state's other end: `recoverOrphanedQaStages` with the mutex held leaves the stage alone and records nothing; with the mutex gone it records exactly one `QA_STAGE_RECORDED` with outcome `stage_error`; and the startup block really does call it after `recoverGateMutex` | pass |
| slice-363-ac-3 | `-IN_QA.md` and `-QA_QUESTION.md` in `CANONICAL_LIVE_SUFFIXES`; `auditLegacyFiles` over a queue holding both emits nothing, and still flags a genuinely unknown suffix; on the Ops side `QUEUE_SUFFIX_STATE['-IN_QA.md'] === 'IN_QA'`, `queueStateOf` resolves it, and the question file is a sidecar with no state | pass |
| slice-363-ac-4 | Mid-stage: no `ARCHIVED` event and the brief still in the queue. After `finishQaStage`: `QA_STAGE_RECORDED` precedes `ARCHIVED` in the register, the ARCHIVED file exists, the sweep has run, and `bridge/state/qa-stage-{id}.json` has both timestamps | pass |
| slice-363-ac-5 | The built prompt's `##` headings are exactly the eight items plus `Mutex contract` and `Where you write` — the extra-headings list is asserted empty — and every item is filled. Item 1 is now checked against a fixture shaped like a real brief: the goal is asserted from the **frontmatter**, and `lane: core` proves the frontmatter went over whole rather than the goal alone | pass |
| slice-363-ac-6 | The fixture brief, report and verdict each carry code (a source fence, a pasted hunk, a quoted line). The prompt keeps the prose and contains none of `diff --git`, `@@ -`, `--- a/`, or any of the three source lines — including now that the frontmatter travels with the brief | pass |
| slice-363-ac-7 | The authoring prompt matches neither "explore the repo", nor the `(dashboard/, lib/, scripts/, server)` list, nor "infer the intent from the codebase"; it does say `INFORMATION-ONLY` and still points him at the suites | pass |
| slice-363-ac-8 | Against a real server: `qa_stage` is null when idle, names the slice when `{id}-IN_QA.md` exists, answers identically on a second request (the reload case), disappears when the file does, and a slice in QA is absent from the queue panel. In the page: `#qa-stage-line` exists, the label names the slice, it is rendered from `data.qa_stage`, and its CSS uses `--warn-*` and no `--ok` | pass |

**Checked against real briefs, not only the fixture.** I rebuilt the packet and the prompt
from the live documents of slice 363 (`bridge/queue/363-PARKED.md`) and slice 395 (its
`*.cleanup-ARCHIVED-*` trash copies) — the same two Nog used:

| | slice 363 | slice 395 |
|---|---|---|
| `goal:` in item 1 | yes | yes |
| `goal:` in the built prompt | yes | yes |
| `##` headings | the eight + `Mutex contract` + `Where you write` | same |
| diff lines (`diff --git`, `--- a/`, `+++ b/`, `@@ -`) | 0 | 0 |

And the sticker round-trips: `buildSticker` keeps Rom's frontmatter as the file's own
frontmatter (so everything that reads a slice's metadata off `{id}-ARCHIVED.md` still finds
it where it was), the brief's frontmatter sits inside the brief section, and a packet
re-assembled **from** that sticker still carries the goal — the re-run path does not lose
what the first run kept.

## Safety-net tests

Still one file, still 12 tests: eight, one per criterion, plus four, one per trap. No test
was added or removed this round — the two code-quality findings are asserted inside the
criterion tests they belong to (the drain is part of "a landing starts the stage", the
orphan recovery is part of "the slice wears the in-QA state"), so the count stays the
target and every test still names the criterion it covers. `// @ac-hash:` lines unchanged.

What changed in the file:

- the fixture brief is now shaped like a real one — `goal:` in the frontmatter, body
  opening `## What is broken` — with a comment saying why, because the old shape is
  precisely what let the miss go green;
- ac-5 asserts the goal **and** `lane: core`, so a fix that lifted only the goal would not
  satisfy it;
- ac-1 asserts the deferred entry is removed before the stage starts and that the drain
  refuses to re-enter itself;
- ac-2 drives `recoverOrphanedQaStages` twice — mutex held, mutex gone — and pins the
  startup call order.

**Break-it check** (this round's changes, each reverted on its own):

| What I reverted | What went red | Message |
|---|---|---|
| `bridge/qa-stage.js` to round 1, **old** fixture | nothing — ac-5 **passed** | this is Nog's finding 4 reproduced: the old fixture greens the broken code |
| `bridge/qa-stage.js` to round 1, **new** fixture | ac-5 | `item 1: the goal, which lives in the frontmatter` |
| `bridge/orchestrator.js` to round 1 | ac-1 | `a slice that has landed must leave deferred_slices before its stage starts` |
| `bridge/orchestrator.js` to round 1 | ac-2 | `TypeError: fx.orch.recoverOrphanedQaStages is not a function` |
| the `if (_draining)` guard only | ac-1 | `the drain must refuse to re-enter itself` |
| the `if (mutexHeld())` skip only | ac-2 | `a stage whose Julian outlived the daemon is his to finish, not startup recovery's` |

Each revert was restored from a byte copy taken before the run and the file went back to
12 pass / 0 fail; `node --check` is clean on `bridge/orchestrator.js`, `bridge/qa-stage.js`
and the test file. (Round 1's break-it check — all 12 red, one distinct reason each,
`shasum -c` 7 OK on restore — stands; nothing it covered was weakened.)

**Browser.** I did not open a browser this round either, and nothing I changed is on the
screen. Said plainly rather than implied: nobody has looked at the amber line yet.

## Screen hooks

Unchanged from round 1, and Nog verified all five exist in the shipped page. Repeated here
because the report is the record:

| Hook | Visible when |
|---|---|
| `#qa-stage-line` | `/api/branch-state` returns a non-null `qa_stage` — i.e. `bridge/queue/{id}-IN_QA.md` exists. `display:none` otherwise. It is the container for the rest. |
| `#qa-stage-dot` | Whenever `#qa-stage-line` is. The pulsing amber dot; the animation is dropped under `prefers-reduced-motion`. |
| `#qa-stage-label` | Whenever `#qa-stage-line` is. Reads `Julian is writing browser tests for slice {id}`, or `Slice {id} is waiting for Philipp` when `{id}-QA_QUESTION.md` sits beside it. |
| `#qa-stage-sub` | Whenever `#qa-stage-line` is; its text is empty until the stage's title and start time are known. Reads `— {title} ({n} min)`. |
| `.topo-panel-body.has-qa` | On `#topo-panel-body` exactly while the line is visible; it is what opens the panel's grid row. Its absence is the assertion that no stage is running. |

Colour: `--warn-bg` / `--warn-border` in both themes. Never `--ok`, and never green while
running — this stage has no verdict to report.

## Tests moved or weakened

None. No existing safety-net test was moved, renamed, removed or weakened this round. The
ac-5 fixture was made **stricter**, not looser: it now fails on code that used to pass it.
`regression/COVERAGE.lock` is untouched and still byte-identical to dev's.

Nog's two flags for O'Brien are noted and left alone, because they are scope calls rather
than findings: `test/bashir-invocation-spawn.test.js` still calls the retired
`buildBashirPrompt(branchState)` signature (that directory is not in CI's
`regression/**/*.test.js`), and "how many slices may skip the stage before a human hears
about it" is the not-started fallback's open question. His third flag — that the archived
sticker is redacted for good — is Philipp's call on the permanent record, not mine.

## Commit

Branch `slice/363`. Round 2 adds one commit on top of round 1's five:

- `cc8b524` — S363 r1 (recovered): round 1's work as it stood when the buffer killed it
- `929edbe` — S363: Julian's stage becomes a real step — the IN_QA state and its packet (carries the eight `AC:` trailers)
- `287269b` — S363: merge dev into slice/363 to carry the 256 MB child-buffer hotfix
- `38acd51` — S363: give Julian's spawn the same 256 MB buffer Rom's has
- `85cda8b` — S363: one prompt builder, not two
- `a731dcf` — S363: DONE report (round 1)
- **this round** — S363 r2: the goal reaches Julian; recovery after the mutex, not before

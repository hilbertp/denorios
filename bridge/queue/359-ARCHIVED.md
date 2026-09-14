---
id: "359"
title: "Author the guard on demand — and put the authoring agent in a box"
from: rom
to: nog
status: DONE
slice_id: "359"
branch: "slice/359"
completed: "2026-09-14T21:58:00.000Z"
tokens_in: 60
tokens_out: 28127
elapsed_ms: 402139
estimated_human_hours: 6.5
compaction_occurred: false
tokens_cache_read: 2458367
cost_usd: 2.933678499999999
---

## Summary

Round 2. Your four findings are closed, and I checked each one by making it fail again
rather than by reading the diff.

The shape of the slice is unchanged and you already accepted it: the per-AC dispatch
reuses `kickOffAuthoring` instead of forking a second spawn path, the box is a real
detached worktree, and a withheld draft is withheld by never being harvested. What round 2
changes is the part you rejected — the verification now does what the criterion says it
does.

**Finding 1 (the red guard).** Slice 363's AC-7 guard sliced the prompt out of the
authoring script by the anchor `const prompt = \``, which slice 359 had moved into
`promptFor(draftsDir)`. `indexOf` returned -1, the slice came back empty and the guard
failed before it asserted anything. Re-anchored on `function promptFor(` … `// ── The box`,
every assertion byte-identical. The file is green (12/12), and the re-anchor still grips:
putting "First explore the repo to understand the change." back into `promptFor()` turns
AC-7 red on the assertion it is supposed to fire on.

**Finding 2 (the live half fired on this system's own writes).** You were right that this
was worse than the case I disclosed, because it needs no human to do anything unusual. The
live half now counts a path only if the agent could plausibly have written it: **tracked**
(so a rewritten guard or a gutted server is caught whatever it is named), or a **new file
whose name says code** (so an invented `e2e/sneaky.spec.js` is caught). Measured against
the real checkout at `/Users/phillyvanilly/denorios/repo`, not a fixture: 36 policed
entries in `git status`, **0** of them now counted. The sandbox half keeps the full
`POLICED_DIRS` list, because it starts as a clean checkout of HEAD and there the whole list
is exactly right.

**Finding 3 (an already-dirty file was never verified).** The comparison was on porcelain
status *codes*, so ` M` before and ` M` after was skipped whatever happened to the bytes —
and the files most likely to be already dirty are the ones somebody has open, which is to
say the interesting ones to reach into. Live snapshots now carry a content hash and
`newBreaches()` walks the **union** of both sides, so a file that dropped out of `git
status` mid-run is still judged on bytes (a commit reads as no change; a revert reads as
the change it is).

**Finding 4 (two exits left the `.running` marker).** The drafts directory, the marker
handler and the stale-artifact sweep now run before the two guard clauses, and both guards
write a `<tag>.FAILED.md` saying what went wrong instead of timing out into a blank
failure. I also took your test-honesty note: that assertion was a source grep, which is
exactly why it stayed green straight through the hole. It now spawns the script for real.

One thing I want to put in front of you rather than leave in a comment. Your Finding 2 fix
leaves untracked **non-code** paths under a policed directory unwatched on the live side —
an agent reaching in by absolute path could forge a `bridge/staged/999-STAGED.md`, or
rewrite an existing untracked one, and this half would not see it. I looked at closing it
by hashing those paths too and deliberately did not: `bridge/host-health.json` is rewritten
on every poll and the timesheets are appended on every `wrap-up`, so hashing them puts your
finding straight back. The gap is written down beside the rule, and in round 2 I widened
that note — it previously said only "a NEW non-code file", which was narrower than the real
hole.

Round 1's rework session was cut off by the host filling its disk at 21:42Z; commit
`7e5841c` was already on the branch. I started from `git log -3 --stat` as Taylor's note
said, verified rather than assumed what it had closed, and did not redo it.

## What changed

Since round 1 (commit `7e5841c`, plus one comment fix in this round):

- `lib/author-sandbox.js` —
  - `isLiveSuspect(rel, status)` **(new)** and `CODE_FILE` — the live half's narrowing
    (Finding 2). `liveSnapshot()` filters through it; `policedSnapshot()`, used on the
    sandbox, does not and keeps the full policed list.
  - `contentSig(root, rel)` **(new)** — `sha1:` of the bytes, or `absent` / `dir` /
    `link:<target>` / `unreadable`. Snapshots became `Map(path → { status, content })`,
    `sameEntry()` prefers bytes whenever either side has them, and `newBreaches()` walks the
    union of both sides instead of the newer one (Finding 3).
  - `liveSnapshot(root, alsoHash)` takes the previous snapshot's paths and hashes them
    explicitly, so a policed file that was dirty before the run and has since been committed
    or reverted does not simply vanish from the comparison and get verified by nobody.
  - The `[live checkout]` prefix and the `==` code ("git no longer calls this changed, but
    its bytes are not what they were") are documented where `formatBreaches()` produces them.
  - **This round:** the disclosed-gap comment now names the real gap — any untracked
    non-code path under a policed directory, created *or* modified — and says why it is not
    closeable from there. Comment only; no behaviour change.
- `scripts/author-ac-test.js` — `fs.mkdirSync(DRAFT_DIR)`, the `MARKER`, `clearMarker`, the
  `exit`/SIGINT/SIGTERM/SIGHUP handlers and `clearArtifacts()` all moved **above** the two
  guard clauses; both guards now call `writeFailure()` so the panel gets a reason (Finding
  4). `clearArtifacts()` runs before the guards on purpose, so a guard's own `FAILED.md` is
  the last word and is not swept by the clean-up that used to follow it.
- `regression/gate-merge/j-julian-stage-in-qa.test.js` — slice 363's AC-7 guard re-anchored
  (Finding 1). See **Tests moved or weakened**; this is the one that needs your signature.
- `regression/gate-merge/j-authoring-containment.test.js` — three tests strengthened, no
  test added or removed (still 9 = 5 criteria + 4 traps):
  - ac-3 gained the routine-writes case (a run during which `bridge/staged/396-STAGED.md`,
    `bridge/timesheet-obrien.jsonl` and `regression/AC-CHECK.json` appear must still be
    clean *and* still deliver its draft) and the already-dirty reach-around case;
  - the ac-5 trap stopped grepping the source and now spawns the script for real;
  - the ac-1 trap's `assert.ok(route.length > 0, …)` — Pass A showed that a missing route
    slices to `''`, and "no apply in `''`" is true of every file ever written.

`dashboard/server.js` and `dashboard/lcars-dashboard.html` are unchanged since round 1 — you
passed ac-1's dispatch path, ac-4 and the screen hooks, and I did not touch them. No `e2e/`
file touched. No lock file regenerated or edited.

## Acceptance criteria verification

`node --test regression/gate-merge/j-authoring-containment.test.js` → **9 tests, 9 pass, 0 fail.**

| Tag | Test | Result |
|---|---|---|
| slice-359-ac-1 | `…slice-359-ac-1 — one AC can be authored on its own…` | pass — draft, target and rationale come out of the box; the declared target path does **not** exist afterwards; the route calls `kickOffAuthoring([tag])`. **Finding 2's undermining is gone:** the routine-writes case asserts the draft is *delivered*, not withheld, while the system writes around it |
| slice-359-ac-2 | `…slice-359-ac-2 — the agent runs in a throwaway worktree…` | pass — unchanged from round 1, which you accepted; the agent is never handed the live checkout, a rogue write leaves the live guard byte-identical, the sandbox is gone when the run ends |
| slice-359-ac-3 | `…slice-359-ac-3 — every run is verified afterwards…` | pass — **both holes closed.** The system's own `bridge/` and `regression/*.json` writes are no longer breaches; an absolute-path write into an **already-dirty** `dashboard/server.js` is caught on bytes where the status code never changed; both touched paths named, nothing harvested, source survives as text |
| slice-359-ac-4 | `…slice-359-ac-4 — a dispatch records who requested it` | pass — unchanged from round 1, which you accepted |
| slice-359-ac-5 | `…slice-359-ac-5 — a run that ends in a question…` | pass — the question path was already right; **the marker half is now proved by running it**: the trap spawns the script on a tag that resolves to no AC, and asserts the marker is gone, the panel reads `failed`, and the detail says what went wrong |

Live-checkout measurement behind ac-3, run against the real repo rather than a fixture:
36 policed entries in `git status --porcelain=v1 -z -uall --no-renames`, 0 counted as
suspect by `isLiveSuspect()`. Every one filtered out is untracked running state
(`bridge/anchors-*.jsonl`, `bridge/host-health.json`, `bridge/staged/*`, `bridge/.run.pid`,
`regression/AC-CHECK.json`, …).

## Safety-net tests

Still nine — one per criterion plus one per trap, then stop. Round 2 strengthened three of
them and added none; a new hole in an existing criterion is that criterion's test's job.

**Break-it-on-purpose, round 2.** Four passes, one per finding, each reverting exactly that
fix and nothing else. I used file copies under `/tmp` rather than the stash — the stash
stack is shared with the other worktrees.

- **Pass A — Finding 2's fix removed** (`isLiveSuspect` back to "everything policed
  counts"): **ac-3 red**, on `the system's own routine writes are not the authoring agent
  writing outside its box`. 8 pass, 1 fail.
- **Pass B — Finding 3's fix removed** (`sameEntry` back to `a.status === b.status`):
  **ac-3 red**, and precisely on the right file — the breach list came back as
  `['regression/gate-merge/j-rogue.test.js']` with `dashboard/server.js` **missing**. That
  is your finding reproduced exactly: the already-dirty file is the one that gets away.
- **Pass C — Finding 4's fix removed**, in two halves because the test asserts two things:
  - C1, the `process.on('exit', clearMarker)` registration moved back below the guards:
    **ac-5 trap red** on `and it takes its in-flight marker with it, rather than leaving the
    card spinning`.
  - C2, the marker fix kept but the first guard's `writeFailure()` replaced by a bare
    `console.error`: **ac-5 trap red** on `the panel reads it as failed, not as pending or
    timed out` — actual `'pending'`, which is the spinner.
- **Pass D — Finding 1's fix probed** by putting `First explore the repo to understand the
  change.` back into `promptFor()`: **`j-julian-stage-in-qa` AC-7 red** on `the "explore the
  repo" instruction is the opposite of information-only`. The re-anchor grips the prompt, it
  does not merely find a non-empty string.

Restored after each pass; all three files green: `j-authoring-containment` 9/9,
`j-julian-stage-in-qa` 12/12, `j-draft-contract` 8/8. The tree is clean, no stray
`git worktree` registration and no `/tmp/ds9-author-*` sandbox survives the fixtures, and
`regression/.drafts/` is empty — the real-spawn trap sweeps after itself.

Per **What you run** I ran only these files, not the full suite.

**In a browser:** unchanged from round 1 — I drove the endpoints with `curl` against a local
server and confirmed the served page carries the control, but the triage on this branch is
CLEAR, so I have still never seen the overlay drawn with a real flagged AC. Your note that
this is Julian's stage, not a finding, is how I have left it.

## Screen hooks

Unchanged from round 1 — `dashboard/lcars-dashboard.html` was not touched this round, and
you verified all twelve hooks exist in the shipped page with a starting state each:
`#utc-author-btn-<tag>` / `.utc-btn-author` (four labels), `#utc-answer-<tag>` /
`.utc-q-input`, `.utc-authored-fail` with `.utc-fail-head` / `.utc-fail-detail` /
`.utc-fail-where`, `.utc-authoring` / `.utc-authoring-spin`, `.utc-authoring-by`,
`.utc-authoring-none`, `.utc-q-hint`.

## Tests moved or weakened

Two files now. Neither is a weaken; both need your second signature, and you have already
given one of them.

1. `regression/gate-merge/j-julian-stage-in-qa.test.js` — slice 363's, **new this round.**
   One line: the AC-7 guard's prompt anchor moved from `const prompt = \`` to
   `function promptFor(` … `// ── The box`, because slice 359 moved the prompt into a
   function so every path it names points inside the sandbox. **Every assertion is
   byte-identical** — nothing removed, relaxed, retitled or skipped, and the file went from
   11/12 to 12/12. Per `docs/contracts/test-update-gate-trailers.md` this is a move, not a
   weaken — the golden-rule case — so no `Test-Loosen-OK:` trailer, but it is listed here
   for the second signature as you asked. Pass D above is the evidence it still bites.
2. `regression/gate-merge/j-draft-contract.test.js` — slice 357's, from round 1. Fixture
   only: the stand-in `claude` writes into `./regression/.drafts/` relative to its own cwd
   instead of the live directory, and `after(clearFixture)` makes the fixture sweep its own
   debris. 8/8, no assertion touched. **You signed this one in round 1** and I have changed
   nothing about it since.

## Commit

- `7e5841c` — S359 amendment: the verification does what the criterion says it does
  (Findings 1–4; 4 files, +250 −68). The five `AC:` trailers are on it.
- This round adds the widened disclosed-gap comment in `lib/author-sandbox.js` and this
  report.

Branch `slice/359`, on top of `6fc43b6` (S358). No lock file regenerated, no `e2e/` file
touched, no browser test written.

**Flags carried forward, not addressed here because you scoped them out:** the
`COVERAGE.lock` backstop red is the pipeline's to regenerate at landing, not mine; an agent
that runs `git commit` inside the sandbox still makes its own edit invisible to the sandbox
half's `git status` (you called it a later slice); and `kickOffAuthoring(tags, { journey })`
still applies one journey to every tag it is given, which cannot misfire today because only
the single-tag route passes one.

**One more, found while committing this report — not mine to fix.** Git skipped the
pre-commit hook with `hint: The 'scripts/hooks/pre-commit' hook was ignored because it's not
executable.` It is recorded in the repo as mode `100644`, not `100755`, and has been since
`ce78784` committed it that way. That means **Layer 1 of the code-write enforcement in
CLAUDE.md is currently inert repo-wide** — the `DS9_WATCHER_MERGE=1` check never runs,
because git never runs the hook. It did not affect this slice (worktree commits are exempt
by design), and I have deliberately not fixed it: the mode bit is Layer-0 infrastructure on
`main`, and changing it would put an unrelated file into this slice's diff. One
`git update-index --chmod=+x scripts/hooks/pre-commit` on a Layer-0 commit restores it.

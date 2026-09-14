---
id: "392"
title: "Every build says where its minutes went"
from: rom
to: nog
status: DONE
slice_id: "392"
branch: "slice/392"
completed: "2026-09-14T02:03:59.000Z"
tokens_in: 44
tokens_out: 21969
elapsed_ms: 277773
estimated_human_hours: 0.75
compaction_occurred: false
tokens_cache_read: 2947562
cost_usd: 2.4767560000000004
---

# Every build says where its minutes went — amendment round 2

## Summary

Nog was right, and the fix was one rung short because I had fixed the symptom
rather than the rule. Round 2 handed `written` to the rungs I had watched fail;
the four rungs above them kept reading the raw command, which still contains the
commit message.

So this round does not add `written` to four more rungs. It inverts the default:
**every rung is now asked about `written`, and `git` is the single exception that
reads the raw command.** That is the actual rule — a commit message is not a
command, and the only question that must be asked of what was really typed is
"was git invoked?", because the strip is what destroys that evidence.

Inverting it also caught two rungs Nog did not name: `build`'s `BUILD_CMD` (a
message mentioning `node -e`) and `orient`'s `ORIENT_CMD`. Same defect, and a
four-rung patch would have left them.

Measured on the same corpus Nog used — this repo's last 48 real commit messages
in the heredoc form the pipeline commits with: **6/48 → 0/48.** The six are the
six he listed, including this slice's own round-1 commit landing in `suite`. The
`&&` boundary case is fixed too.

## What changed

- `lib/build-timing.js`, `BASH_LADDER` — every rung takes `written`; `git` takes
  `(w, raw)` and reads `raw`. `bashPhase` now calls `matches(written, cmd)`, so
  the safe argument is the one a rung gets by default and the exception is the
  thing you have to write out. **Finding 1.** This covers the four rungs Nog
  named (`locks`, `break-it`, `suite`, `browser-look`), the `nodeTestKind(cmd)`
  he pointed at in the `tests` rung, and the two he did not (`BUILD_CMD` in
  `build`, `ORIENT_CMD` in `orient`).
- `lib/build-timing.js`, `GIT_MSG_HEREDOC` — `[^|;\n]*` → `[^|;&\n]*`, so the
  strip cannot reach across `&&` into a heredoc belonging to the next command.
  **Finding 1, secondary.** Confirmed it costs nothing real:
  `git add -f …-DONE.md && git commit -m "$(…)"` still lands in `git`, because
  the match simply starts at the second `git`.
- `regression/observability/j-build-timing.test.js` — assertions added to
  `slice-392-ac-1`. No new test functions: still 7, one per criterion plus one
  per trap.

`bridge/orchestrator.js`, `scripts/build-timing.js`, `dashboard/server.js`,
`dashboard/lcars-dashboard.html` and `.gitignore` are untouched this round.

## Acceptance criteria verification

| Tag | Test file | Command | Result |
|---|---|---|---|
| slice-392-ac-1 | `regression/observability/j-build-timing.test.js` | `node --test regression/observability/j-build-timing.test.js` | pass |
| slice-392-ac-2 | same file | same command | pass |
| slice-392-ac-3 | same file | same command | pass |
| slice-392-ac-4 | same file | same command | pass |

7 tests, 7 pass, 0 fail.

**The corpus, measured both ways.** I rebuilt Nog's harness — `git log -48`, each
message wrapped in `git commit -m "$(cat <<'EOF' … EOF)"`, every one of which
should be `git`:

| | misattributed | distribution |
|---|---|---|
| before (round-2 code) | **6/48** | `git` 42, `locks` 5, `suite` 1 |
| after | **0/48** | `git` 48 |

The six before were exactly the six in the review, `S392: Every build says where
its minutes went (amendment round 1)` → `suite` among them.

The `&&` case, measured:

| Command | Before | After |
|---|---|---|
| `git commit -m 'x' && cat > dashboard/server.js <<'EOF' … EOF` | **git** | build |
| `cat > dashboard/server.js <<'EOF' … EOF` then `git commit -m 'x'` | build | build |
| `git add -f …-DONE.md && git commit -m "$(…)"` | git | git |

Everything round 1 and round 2 established still holds — all 24 previously
asserted cases are still in the table and still green. `bridge/orchestrator.js`
did not change, and I re-ran slice 393's guard to be sure: 7 pass, 0 fail.

Also checked the new `&`-excluded regex for backtracking, since it is now run on
every Bash call: a 120k-word commit message, a 4000-long `&&` chain and an
unterminated heredoc all return in ≤1ms.

## Safety-net tests

Still 7 tests — one per criterion plus one per trap. No new test functions; the
`slice-392-ac-1` rule table grew a block.

The new block is eight real-shaped commit messages, each naming work a different
rung looks for — a lock file, `npm test`, a quoted `node --test` run, `git stash`,
`playwright`, `node -e` — all asserted to be `git`. The first two are verbatim
from this repo's history. Plus the `&&` case asserted to be `build`.

**Break it on purpose — per rung.** A whole-file revert would only have proved
"something changed", and Nog's finding was precisely that a single rung can be
left behind. So I reverted **one rung at a time** to reading the raw command and
ran the test file each time:

| Reverted | `slice-392-ac-1` | assertion that caught it |
|---|---|---|
| `locks` rung | **red** | "is still a commit, not locks work" |
| `break-it` rung | **red** | the `git stash` message |
| `suite` rung | **red** | "is still a commit, not suite work" |
| `browser-look` rung | **red** | the playwright message |
| `tests` rung | **red** | "is still a commit, not tests work" |
| `build` rung | **red** | "is still a commit, not build work" |
| `&&` boundary | **red** | "is still a product write" |

No reversion survives. Whole-fix pass as well: with `lib/build-timing.js` back at
HEAD, `slice-392-ac-1` goes red alone (6 pass, 1 fail) and the corpus goes back to
6/48 — the other six tests stay green, since none of them is about these rules.
Restored byte-identical (`diff -q`), 7/7 green after.

**One thing the per-rung pass caught that I would otherwise have shipped.** My
first fixture for the `tests` rung — a message ending in a bare test path — did
**not** bind: with that rung reverted the test stayed green. The path ran into
`EOF` and `)"` and came back as three targets, so the reverted rung said `suite`
and the assertion never fired. I replaced it with a message quoting a piped
single-file run, which produces exactly one target and does trip it. Worth saying
plainly: the whole-file break-it pass would have called that assertion proven.

No `git stash` used — the stash stack is shared across worktrees; I copied the
file aside and restored it.

**Browser:** I did not look this round. No dashboard file changed, so there was
nothing new on the screen. The round-1 look stands as reported.

Still unrun, same as last round and for the same reason: `scripts/build-timing.js`
over a real `bridge/logs/rom-383.log`. This worktree's `bridge/logs/` is empty.
Worth doing once this lands — the corpus check above is the synthetic version of
exactly that, and it is what found today's number.

## Screen hooks

None new this round. The hooks declared in round 1 are unchanged and still in the
shipped page: `#phase-split`, `.phase-split-line[data-phase]`, `.phase-split-name`,
`.phase-split-min`, `.phase-split-share`, `.phase-split-calls`, `.phase-split-bar`,
`#phase-split-first-edit`. All visible in the slice detail panel behind a History
row, for a slice whose DONE event carries `phases`; absent for one that does not.

## Tests moved or weakened

None. No existing test file was moved, renamed, weakened or removed. The only test
file touched is my own `regression/observability/j-build-timing.test.js`, and it
only gained assertions — one fixture inside the new block was replaced with a
stronger one before it was ever committed, as described above. Nothing was relaxed
or deleted.

## Commit

`S392: Every build says where its minutes went (amendment round 2)` on
`slice/392`, carrying the four `AC:` trailers and `Lane: core`.

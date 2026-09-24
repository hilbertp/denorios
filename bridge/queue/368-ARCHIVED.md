---
id: "368"
title: "The merge dialog stops asking for a second person"
from: rom
to: nog
status: DONE
slice_id: "368"
branch: "slice/368"
completed: "2026-09-24T23:05:15.000Z"
tokens_in: 74
tokens_out: 61388
elapsed_ms: 738337
estimated_human_hours: 2.0
compaction_occurred: false
tokens_cache_read: 3410419
cost_usd: 4.5679155
---

## Summary

The "Run the gate?" dialog no longer asks for a person who does not exist. On a RED FLAG
it still STOPS by default — Run gate opens disabled — but it unlocks on one confirmation
that names nobody: "I have confirmed every item above is intentional." Nothing the dialog
shows, titles or announces says "author", "reviewer" or "second" under any verdict, before
or after the box is ticked.

Behaviour deliberately unchanged: the blocker list above the checkbox, the CLEAR /
NEEDS REVIEW / OVERRIDDEN paths (no box, Run gate free), and the NO VERDICT path (Run gate
enabled, no box). `#utc-approve-btn` and `#utc-ack-box` keep their ids, so the five browser
specs that select by them are untouched.

## What changed

- **dashboard/lcars-dashboard.html** (modified) — the only product change.
  - `_utcApplyVerdict` RED FLAG branch: box aria-label → "Confirm the RED FLAG items";
    heading → "Confirm each item below is the intended result of a feature — not a check
    disabled to go green:"; checkbox label → "I have confirmed every item above is
    intentional."; disabled-button tooltip → "Blocked: confirm the RED FLAG items first."
    The `items`/`list` block above the checkbox is untouched.
  - `utcToggleSecondAck` → `utcToggleConfirm` (checkbox `onchange` repointed), same tooltip.
  - Slot id `utc-secondack` → `utc-confirm`, at both the lookup and the card markup.
    `#utc-ack-box` and `#utc-approve-btn` unchanged.
  - Comments reworded so none speaks of a second or non-author reviewer: the CSS comment
    above `.utc-verdict`, the `UTC_VERDICTS` header, the `_utcApplyVerdict` header, the
    toggle's one-liner, and the `/api/tests-needed` fetch comment. The CSS rules
    `.utc-ack*` are unchanged.
- **regression/gate-merge/j-merge-dialog-one-human.test.js** (added) — the five new
  safety-net tests.
- **regression/direct-controls/j-direct-controls-regression-coverage.test.js** (modified) —
  slice-99812-ac-2 moved to the new behaviour (see Tests moved or weakened).
- **regression/gate-merge/j-merge-dialog-one-classification.test.js** (modified) —
  slice-367-ac-4's one assert moved (see Tests moved or weakened).

No `e2e/` file touched. No lock file touched (`build-coverage-map` / `build-ac-manifest`
not run, per the brief).

## Acceptance criteria verification

Command for all three (the only command run against the new file):

    node --test regression/gate-merge/j-merge-dialog-one-human.test.js

| Criterion | Test | Result |
|---|---|---|
| slice-368-ac-1 | `J-merge-dialog-one-human slice-368-ac-1 — no verdict of the dialog says "author", "reviewer" or "second", before or after the box is ticked` | pass |
| slice-368-ac-2 | `J-merge-dialog-one-human slice-368-ac-2 — RED FLAG opens locked behind one unticked box; ticking unlocks Run gate, unticking locks it again` | pass |
| slice-368-ac-3 | `J-merge-dialog-one-human slice-368-ac-3 — CLEAR, NEEDS REVIEW and OVERRIDDEN carry no checkbox and leave Run gate free` | pass |

5 tests, 5 pass, 0 fail.

The two files I moved tests in also run clean —
`node --test regression/direct-controls/j-direct-controls-regression-coverage.test.js regression/gate-merge/j-merge-dialog-one-classification.test.js` → 20 tests, 20 pass, 0 fail.
I did not run the full safety-net suite or the browser suite.

**How the criteria are checked.** The tests do not read the page as text. They lift the
page's own `confirmUpdateTests()`, `_utcApplyVerdict()`, `_renderTestChanges()`,
`UTC_VERDICTS` and the confirmation toggle out of the shipped `lcars-dashboard.html` into a
minimal document shim, feed them payloads shaped like `/api/test-changes` and
`/api/tests-needed`, and then read the assembled dialog: its visible text, its `title` and
`aria-label` attributes, the live Run-gate tooltip, the checkbox, and the label. The toggle
is found from the `onchange` the page actually writes, not from a name the test assumed.

- **ac-1** opens the dialog for all five verdicts (clear, needs_review, overridden,
  red_flag, and an unknown decision), each fed a payload the test first asserts is itself
  clean of the three words, and checks every string the dialog shows or announces. Then
  RED again, re-read after ticking and after unticking — the toggle's tooltip is the one
  string the operator sees only from the toggle, and it is where "a second reviewer must
  acknowledge…" used to live.
- **ac-2** runs RED FLAG three ways — with blockers, with `blockers: []`, and with no
  `blockers` key at all — asserting exactly one checkbox, shipped without a `checked`
  attribute and reading back unticked, the label exactly equal to the sentence, and
  `disabled` + `aria-disabled="true"` on Run gate; then tick (enabled, no `aria-disabled`)
  and untick (locked again). "Every time the dialog opens" is checked by opening a second
  dialog after ticking the first: it opens unticked and locked.
- **ac-3** runs clear / needs_review / overridden **with blockers in the payload**, so a
  non-RED verdict cannot grow a box from them: no checkbox anywhere in the dialog,
  `#utc-confirm` empty, Run gate enabled with no `aria-disabled`.

## Safety-net tests

Five tests, one per criterion plus one per trap, in
`regression/gate-merge/j-merge-dialog-one-human.test.js`. Each carries its criterion tag
and the `// @ac-hash:` line from the brief.

**Break-it, full revert (the required check).** With `dashboard/lcars-dashboard.html`
restored to HEAD and the new test file left in place: **5 tests, 0 pass, 5 fail** — all
five went red. They all failed on the same structural line ("the dialog must carry the
`#utc-confirm` slot"), which proves they go red but not *what* each one pins. So I ran four
further probes, each undoing exactly one thing while keeping the rest of the fix:

| Probe (one thing undone) | ac-1 | ac-2 | ac-3 | trap 1 | trap 2 |
|---|---|---|---|---|---|
| A — old wording back (slot id + toggle name kept) | **RED** | **RED** | green | green | green |
| B — RED no longer disables Run gate | green | **RED** | green | green | green |
| C — the blocker list dropped from the box | green | green | green | **RED** | green |
| D — an unreadable verdict treated like RED | green | green | green | green | **RED** |

Every test goes red on its own substance and only on its own. The fix was restored after
each probe and the file re-runs 5/5 green.

**Traps.**
- *Trap 1 — the item list could be dropped when the box is rewritten.*
  `slice-368-ac-2 trap-items-above-the-box` asserts the `<ul class="utc-ack-list">` still
  renders one `<li>` per blocker, each carrying its kind and its name, and that the list
  sits **before** the checkbox in the slot's markup — "every item above" must have items
  above it. Probe C (removing `+ list` from the box) turns it red.
- *Trap 2 — the NO VERDICT path must not be dragged along by the RED branch.*
  `slice-368-ac-3 trap-no-verdict-untouched` runs all three ways the verdict can be
  unreadable (the request rejects, the payload is `{available:false, error}`, the decision
  is one the dialog does not know) and asserts the chip reads NO VERDICT, no checkbox
  appears, `#utc-confirm` stays empty, and Run gate stays enabled with no `aria-disabled`.
  Probe D turns it red.

**Browser.** I did not open a browser. The live dashboard reads `lcars-dashboard.html` from
the main checkout, not from this worktree, so it would have shown the old dialog; standing
up a second server against the worktree would have pointed a live process at `bridge/`,
which is not worth it for a look. Instead I rendered the RED FLAG dialog through the same
shim and read the markup it produces:

    <div class="utc-ack" role="group" aria-label="Confirm the RED FLAG items">
      <div class="utc-ack-head">Confirm each item below is the intended result of a
        feature — not a check disabled to go green:</div>
      <ul class="utc-ack-list">
        <li><strong>removed</strong> the gate refuses a dirty tree</li>
        <li><strong>weakened</strong> promote pins the head sha</li>
      </ul>
      <label class="utc-ack-check">
        <input type="checkbox" id="utc-ack-box" onchange="utcToggleConfirm()">
        I have confirmed every item above is intentional.</label>
    </div>

with the Run-gate tooltip reading `"Blocked: confirm the RED FLAG items first."` and the
chip reading `✗ RED FLAG @ ab12cd3`. Julian owns the real browser check.

## Screen hooks

I used the names the brief pre-named. All exist in the shipped page:

| Hook | What it is | Starting state |
|---|---|---|
| `#update-tests-overlay` | the dialog; its card carries `role="dialog"` and the aria-label "Step 1 — review test changes before running the gate" | not on the page until `#promote-gate-btn` is pressed |
| `#promote-gate-btn` | RUN GATE & MERGE TO MAIN, opens the dialog | locked until CHECK FOR TEST UPDATES passes |
| `#utc-verdict .utc-verdict-chip` | the verdict chip; text is `✓ CLEAR`, `● NEEDS REVIEW`, `◑ OVERRIDDEN`, `✗ RED FLAG` or `? NO VERDICT` | shows "Checking…" until `/api/tests-needed` answers |
| `#utc-confirm` | the confirmation slot (renamed from `utc-secondack`) | present and **empty** on every verdict except RED FLAG |
| `#utc-confirm .utc-ack` | the confirmation box | visible only once a RED FLAG verdict renders |
| `#utc-confirm .utc-ack-list li` | one row per blocker, `<strong>` kind then name | visible on RED FLAG when the verdict names blockers; absent when the list is empty or missing |
| `#utc-ack-box` | the one checkbox | absent until a RED FLAG verdict renders; then present and **unticked** |
| `#utc-confirm label.utc-ack-check` | its label; trimmed text is exactly `I have confirmed every item above is intentional.` | with the checkbox |
| `#utc-approve-btn` | Run gate — **id unchanged** | enabled while the verdict is loading and on CLEAR / NEEDS REVIEW / OVERRIDDEN / NO VERDICT; `disabled` + `aria-disabled="true"` on RED FLAG until the box is ticked |

Note for Julian: on RED FLAG the disabled Run gate carries
`title="Blocked: confirm the RED FLAG items first."`; ticking clears the title and removes
`aria-disabled` entirely (it is not set to `"false"`).

## Tests moved or weakened

Both are moves the brief directed, both kept at the same strength (same number of asserts,
same kind of assert — a name and a shipped sentence), and both `Test-Loosen-OK` lines from
the brief's REQUIRED block are in the commit as file-path trailers.

1. `regression/direct-controls/j-direct-controls-regression-coverage.test.js` —
   **slice-99812-ac-2** (tag kept). The two asserts at 315-316 moved from the retired
   control to the new one: `/function utcToggleSecondAck\(\)/` → `/function
   utcToggleConfirm\(\)/`, and `html.includes('I am not the author')` →
   `html.includes('I have confirmed every item above is intentional.')` — a longer,
   more specific string than the one it replaces. The test title and the comments at
   281-284 and 309 were reworded to match; the `approve.disabled = true` assert at 314 and
   everything else in the test are untouched. *Why:* the strings it pinned no longer exist —
   Philipp's 09-01 ruling retired them.
2. `regression/gate-merge/j-merge-dialog-one-classification.test.js` —
   **slice-367-ac-4** (tag kept). One assert at 243:
   `/function utcToggleSecondAck\(\)/` → `/function utcToggleConfirm\(\)/`. Its sibling
   assert `approve.disabled = true` (242) is untouched, so "the gate still stops by
   default" is still pinned. Nothing else in the file changed. *Why:* same rename.

Neither manifest entry carries criterion text (`AC-MANIFEST.lock` has `text: null` for
both), so no acceptance criterion text changed and no `AC-Change-OK` is needed. If landing
shows one is needed after all, only Philipp can add it.

## Commit

Branch `slice/368`, one commit on top of `68a731a`.

    S368: The merge dialog stops asking for a second person

Trailers: the three `AC:` lines and the two `Test-Loosen-OK:` lines from the brief's
REQUIRED block, verbatim.

Files in the commit:

    dashboard/lcars-dashboard.html
    regression/direct-controls/j-direct-controls-regression-coverage.test.js
    regression/gate-merge/j-merge-dialog-one-classification.test.js
    regression/gate-merge/j-merge-dialog-one-human.test.js
    bridge/queue/368-DONE.md   (git add -f)

## Conflicts with the brief

None. (My role file's closing note says to regenerate `regression/*.lock` before
committing "until slices 386 and 387 are live, *your brief says when that applies*" — this
brief says explicitly not to run `build-coverage-map` or `build-ac-manifest` and not to
edit the lock files, so I did not.)

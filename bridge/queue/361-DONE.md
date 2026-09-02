---
id: "361"
title: "Make the merge lock real — the server must refuse, not just the button"
from: rom
to: nog
status: DONE
slice_id: "361"
branch: "slice/361"
completed: "2026-09-02T01:27:36.000Z"
tokens_in: 152000
tokens_out: 12600
elapsed_ms: 936274
estimated_human_hours: 5.0
compaction_occurred: false
---

# Make the merge lock real — the server must refuse, not just the button

**Commit:** `c97b454` on `slice/361`.

The padlock is now a rule. `POST /api/promote/dispatch` and `POST /api/rollback/dispatch`
derive the test-update state on the server and refuse with a named reason; neither can be
talked past by a stale page, a second tab, or a scripted call.

## What changed

**`dashboard/server.js` — `mergeLockRefusal({ checkedSha, devSha })`** (beside
`getCheckTestUpdates`, ~line 677). Returns `null` when the dispatch may proceed, or the
refusal body:

| code | meaning | payload |
|---|---|---|
| `test_updates_unresolved` | an AC in the pending range still needs a human call | `outstanding`, `tags[]`, `items[{tag,title}]`, `range`, `verdict` |
| `stale_check` | the operator's check was made against a different integration tip | `checked_sha`, `dev_sha` |
| `test_updates_unavailable` | the triage could not be derived — **fail closed** | `detail` |

All three are 409 and distinct from `nothing_to_promote` / `gate_already_running`.

- **Promote dispatch** now reads its (optional) JSON body and checks the lock after the
  nothing-to-promote and mutex refusals — those are more specific, so they keep their own
  reason rather than being masked by the lock.
- **Rollback dispatch** checks the same lock **before `createRevertCommit`**, after
  `unknown_slice`. A refused rollback leaves `origin/dev` byte-identical — nothing to clean up.
- **Tip binding:** `checked_sha` is the only client-supplied value the lock reads, and it can
  only *add* a refusal, never remove one. The derived triage runs first and always governs;
  a matching sha is not a way to be let through. `_shaMatches` is short-sha tolerant (7↔40)
  and rejects anything that is not real hex of at least abbreviation length.
- No cache added (trap 2). Measured against the live repo range: **20 ms**.
- `AC-DECISIONS.json` is read only, never written (trap 3). `promote.yml` untouched (trap 4).

**`dashboard/lcars-dashboard.html`** — one `_mergeLockMessage(code, data)` translator feeds
all three dispatch call sites (promote slot + both rollback overlays), so they can never
disagree about why a merge did not happen. The promote slot is 240px with an ellipsis, so the
refusal shows a short line there and the full reason (which ACs, which shas) in the hover
title via a new `_promoteSlotErrorTitle`. On a lock refusal the page also **re-locks the
button** — "✓ TESTS CHECKED" can no longer sit beside a refusal. All three dispatches carry
`checked_sha`.

**Tests — `regression/gate-merge/j-merge-lock-server.test.js`** (new, 6 tests, all
`@ac-hash`-annotated). Real git fixtures + a local bare origin + a PATH-stubbed `gh`; the
fixture runs the **shipped** derivation (range scan → reconcile → triage) against real `AC:`
commit trailers, not a stand-in. Each test asserts both the refusal *and* that `gh` was never
called; ac-4 asserts `origin/dev` is unmoved; ac-5 fires a forged payload
(`check_passed/ready/force/override/...`) at both endpoints and gets 409 anyway.

## Verification

- `npm test` — **374 pass, 0 fail** (378 total).
- `npx playwright test` — **42 pass, 0 fail** (full e2e suite).
- `regression/COVERAGE.lock` and `regression/AC-MANIFEST.lock` regenerated and committed.
- The six `AC:` trailers on `c97b454` resolve **COVERED** through the live range scan
  (`ready: true`, `verdict: CLEAR`, 0 flagged) — this slice will not flag its own gate.

## Things you should know

1. **The branch was 49 commits behind `dev` with no work of its own.** `slice/361` pointed at
   `f7fd230`, which was already an ancestor of `origin/dev`. I fast-forwarded it to the dev tip
   (`5ced4cf`) before starting — otherwise this would have been built against a `server.js`
   that predates `lib/ac-range-scan.js`, i.e. against the *static-manifest* gate the range
   scan replaced. Worth checking how the branch was cut.

2. **Four existing test files gained fixture setup — no assertion was touched.** Because the
   lock fails closed, a fixture root without `lib/` + `scripts/build-ac-manifest.js` now
   refuses every dispatch with `test_updates_unavailable`, which walled off the endpoints
   `j-merge-button-pass`, `j-gate-fail-retry`, `j-rollback-revert-forward` and
   `j-s-numbering-legacy-resolve` exist to pin (9 red). The fix is one shared
   `seedMergeLockDeps(root)` in `j-merge-button-pass-helpers.js` that copies the real engine in
   and writes an empty, open gate state. Fixture commits declare no `AC:` trailers, so the
   range is empty and nothing is flagged. I did **not** loosen the lock to keep them green.
   The Test-Update Gate will see five test files changed — four are setup-only.

3. **A third refusal code beyond the two the brief named.** `test_updates_unavailable` covers
   the case where the triage itself cannot be derived. Folding it into
   `test_updates_unresolved` would have reported "N ACs outstanding" when the truth is "I
   could not tell" — the wrong-reason failure the brief warns against. It fails closed either
   way.

## Flag for Philipp — the rollback question (trap 5)

Per the brief I built the refusal and no override. One consequence deserves your attention:
**an unresolved AC now also blocks a rollback.** Mechanically that is correct — a rollback IS
a promote dispatch and moves `main` the same way — but rollback is the emergency path, and the
thing standing in front of it is now a paperwork state. Today's shape: you must rule on the
outstanding ACs (which takes clicks, not code) before you can revert. If that trade is wrong,
the override is your call, not mine; say so and it is a small follow-up.

Two smaller notes:

- **Refusals are not audited.** A refused dispatch writes no register event, so there is no
  record that a merge was stopped. Given the defect that opened this slice was a merge nobody
  noticed, a `promote-refused` event might be worth having — I left it out because the History
  panel derives outcomes from the register and I did not want this slice to touch that.
- **Deploy needs a restart.** The live dashboard serves the `server.js` it booted with; this
  lock is inert until the dashboard process is restarted and the tab hard-reloaded.

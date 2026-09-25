# HANDOFF — two process gaps found at slice 410's QA stage

**From:** Bashir (Julian, QA) · **To:** O'Brien (Alex, dev team lead) · **Date:** 2026-09-25
**Slice:** 410 — "The merge gate sees tests that run a file or load it"
**This is not a QA red.** Slice 410's stage is green from my side; nothing here blocks it.
Both items are process, not product, which is why they come as a handoff and not as an exit.

---

## 1. The break-it check will call every *preservation* criterion hollow

Packet item 8 arrived as "not run yet — the break-it script is the next slice in this set". When
that script lands, it will implement the rule in my role file: a new safety-net test that is still
green with the fix removed is **hollow**, and "a criterion whose only safety-net test is hollow is
a bug exit: O'Brien writes a fix slice in which Rom replaces the test."

`slice-410-ac-6` is the live counter-example: *"Every source and guard COVERAGE.lock listed before
this slice is still listed, and regenerating the lock twice gives byte-identical files."* Both
clauses are true **before** the change — that is what a preservation criterion asserts. Its test
is supposed to be green with the fix absent. Rom reported exactly that, and explained why the one
assertion that would go red (guardCount strictly up) becomes a permanent landmine once the landing
regenerates the lock and `fresh === committed`. I find that reasoning sound, and Nog accepted it.

So the rule as written would fire a fix slice on every preservation criterion the project ever
writes, and Rom would have no honest way to satisfy it.

**What I'd ask you to decide before the break-it slice lands** (your call, not mine):
- a declared class of criterion that break-it exempts — "preservation", named in the brief; or
- a second proof shape for them: a before/after comparison against the committed artifact, which
  is what I did by hand for ac-6 this run (0 of 1113 lock entries lost — recorded in the sticker).

Either way the break-it script needs to know the difference, or its first honest slice will look
like a failure.

## 2. A criterion worded over a historical git range can never reach my stage as evidence

`slice-410-ac-7` reads: *"Deciding the range 9a8e46a..24e6891 (the promote that failed in run
36190555313) with the coverage map this slice derives lists neither
scripts/install-dashboard-service.sh nor scripts/dev.denorios.dashboard.plist under 'New
behaviour, no test'."*

Two things I established from the running product this run:

- **`/api/tests-needed` ignores `base` and `head` query parameters.** I asked it for
  `9a8e46a..24e6891` in both short and full sha form; both times it answered for the live range
  (`head7: 2f587b4`). No product surface can be pointed at a historical range.
- **The verdict screen names blocker *kinds*, never files.** I stubbed a `red_flag` whose blocker
  list held exactly those two paths and opened the RUN GATE Step-1 checkpoint: `#utc-verdict`
  renders the badge, `#utc-confirm` renders one row reading `NEWBEHAVIOURNOTEST` per blocker, and
  neither file path appears anywhere in the rendered page.

This is perfectly fine for a core-lane criterion proved by a unit test — I am not asking for a
change to slice 410. The point is forward-looking: a criterion in this shape is structurally
invisible to my stage, so it rests entirely on Rom's test and Nog's re-derivation, and my stage
cannot be a second signature on it. Worth knowing when you word the next gate criterion; if you
want my stage to be able to corroborate one, it needs an observable the product will answer for —
a range-addressable endpoint, or the blocker's path on the screen.

## Related, already flagged by Nog, now measured

Nog flagged to you that corroboration widened from "a test asserts about this file's bytes" to "a
test has this file in its hands". From the two committed locks (`2f587b4~1` → `2f587b4`):
`bridge/orchestrator.js` **+4** guard files, `bridge/git-finalizer.js` **+4**,
`scripts/build-coverage-map.js` **+3**, `dashboard/server.js` **+3** — suites that `require()` the
module as a tool. 6 new source keys, 881 → 1089 guards, 0 lost.

Two things that are **not** new, so nobody chases them: test files as source keys went 47 → 48
(the extra is Rom's own new test file), and the five self-guarding `e2e/*.spec.js` lock entries are
byte-identical before and after. No browser test guards a product source today, and I intend to
keep it that way — my specs stub HTTP rather than importing product modules.

— Julian

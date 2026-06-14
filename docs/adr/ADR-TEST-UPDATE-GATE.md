# ADR-TEST-UPDATE-GATE: The Test-Update Gate

**Status:** Proposed (revised after red-team)
**Author:** Dax (Architect)
**Date:** 2026-06-14
**Supersedes/relates to:** ADR-GITHUB-CI-MERGE-MODEL (operator-gated fast-forward promotion)

---

## Context

### The problem

`promote.yml` fast-forwards `main` to a tested dev commit only if the full `regression/` (node:test) and `e2e/` (Playwright) suites are green on a clean runner. Tests are the contract: every regression check carries a `slice-<id>-ac-<n>` tag and many read source files (`dashboard/server.js`, `dashboard/lcars-dashboard.html`, `.github/workflows/promote.yml`) and assert on their strings/structure.

The standing principle is **FIX THE CODE**: a red test is a caught bug until proven otherwise. You update a test *only* for a behaviour you deliberately changed, and a legitimate update **moves an assertion to the new behaviour**, whereas a masked regression **deletes or loosens** an assertion to go green.

### The masked-regression anti-pattern

The cheapest way to make a red suite green is dishonest: delete the failing test, comment it out, `test.skip()` it, or weaken its assertion (`assert.equal(x, 5)` → `assert.ok(x >= 0)`). All four turn the gate green while shipping a regression. Nothing in the system today decides, **given a change, whether the tests should be updated at all** — i.e. whether a moved/red test is an intended-behaviour update (→ update the test) or a real regression (→ fix the code).

### What already exists vs. the gap (verified against `repo/`)

- **`getTestChanges()`** (`dashboard/server.js:480`) diffs `origin/main...origin/dev` over `regression/` + `e2e/`, keys each check by its `slice-ac` tag (`tagOf`, line 500), and classifies added / removed / **reworded** (same tag both sides). Three confirmed weaknesses it inherits:
  - Its `assertionDelta` (line 521) is **sign-blind**: it `++`s on *both* `+assert` and `-assert` lines. It counts churn, not direction — it cannot tell tightening from loosening, and only `> 0` is recorded (line 528).
  - The name-capture regex `^[+-]\s*(?:test|it)(?:\.\w+)?\(` (lines 517–518) **deliberately swallows `.skip`/`.only` into the name match**, so `test('…')` → `test.skip('…')` for the same tag has identical captured names → it lands in `reworded` (benign). Skip is invisible today.
  - The diff window is **hardcoded symbolic three-dot** `origin/main...origin/dev` (lines 492, 509) — the merge-base diff of two *branch tips*, not a pinned commit.
- **`GET /api/test-changes`** (`server.js:2373`) + the **`confirmUpdateTests()` checkpoint** (`lcars-dashboard.html:7979`) surface these deltas pre-dispatch with STOP/APPROVE; the modal prose already warns "a removed or loosened check could be hiding a real regression" (line 7989) — but the code behind it cannot detect loosening.
- **`promote.yml`'s "Update tests" step** (lines 47–56) is purely **informational** (`git diff --stat`, a reminder), has no escape hatch, cannot move `main`. `promote.yml` checks out the **dev branch tip** and pushes `$TESTED_SHA` (= `HEAD` at checkout time) via `git push origin "$TESTED_SHA:refs/heads/main"` — confirmed zero `continue-on-error` anywhere.
- The **self-lock test pattern is real**: `j-direct-controls-regression-coverage.test.js` reads `SERVER_SRC`/`DASHBOARD_SRC`/`PROMOTE_YML` and asserts strings. Neutering a gate's logic is itself a red test.
- **Tag coverage, fully measured:** `slice-ac` appears in **22/22 regression files**, **0/16 e2e spec files**, and **0/368 slice files** (`bridge/queue/<id>-STATUS.md`). AC sections appear in prose under ~15 heading spellings; the slice template (`bridge/templates/slice.md`) has **no AC numbering**. So: there is **no machine join from a slice to a tag**, and **e2e checks have no tag at all** — `tagOf` falls back to the full (mutable) test title for every e2e file.

The gap: a deterministic, low-false-negative decision layer that separates intended-update from masked-regression, resists loosen/delete/skip, and routes the fix — **without** depending on a slice→tag join that does not exist, and **without** repeating the input-divergence, skip-blindness, and stable-key bugs above.

---

## Decision

Build a **Test-Update Gate**: a deterministic, pure-Node engine (`scripts/tests-needed.js` + shared `lib/tests-needed.js`) that classifies the promotion diff and emits one verdict — surfaced advisory in the dashboard checkpoint and **enforced** as a real (non-informational) step in `promote.yml`. We take the **Diff Heuristic / Path-Rules classifier** as the spine and graft the fixes the red-team proved mandatory:

1. **Replace the sign-blind churn counter with a signed, structure-aware assertion-direction engine** (`lib/assert-direction.js`) that also detects `skip`/`only`/comment-out and rank-preserving tautologies. This is the load-bearing logic change.
2. **Bind corroboration to a file-grained source→test map (`COVERAGE.lock`), not to coarse "same area."** Same-area is downgraded to necessary-but-insufficient.
3. **Pin every classification to the exact promoted commit** (two-dot diff against `merge-base(origin/main, HEAD)`; fail closed if `HEAD != origin/dev`). No symbolic three-dot refs in the gate path.
4. **Drop the declared-intent manifest** (the slice→tag join is verified absent). Replace human declaration with **scoped, verified commit-message override trailers**.

### Where it runs in the gate

Three coordinated touch-points on **existing surfaces** — no new pipeline stage:

| Surface | Role | Blocking? |
|---|---|---|
| `GET /api/tests-needed` → `confirmUpdateTests()` modal (`lcars-dashboard.html:7979`) | **Pre-dispatch, advisory.** Per-row verdict chips; modal **defaults to STOP** on RED. Displays and pins the exact 40-char SHA it classified. | No |
| New step in `promote.yml`, between "Update tests" (line 47) and "Run regression gate" (line 58) | **In-gate, enforcing.** Runs on the clean runner against `$TESTED_SHA`; **exits non-zero on RED** unless cleared by a verified override trailer. | **Yes** |
| `ci.yml` on every dev push | **Early warning, warn-only** (exit 0). | No |

Dashboard preview and CI **share one module** (`lib/tests-needed.js`) **and one input contract** (pinned base/head SHAs passed explicitly — never re-derived from symbolic refs inside the module). The engine's decision rule is locked by a self-reading regression test; softening the gate is itself a red test.

### Pinned input contract (closes A1 / H2 / H3)

The module is **pure**: `classify({ base, head, repoRoot })`. It never resolves `origin/dev` itself. Both callers compute and pass pinned 40-char SHAs:

- **CI / `--strict`:** `base = git merge-base origin/main HEAD`, `head = git rev-parse HEAD` (= `$TESTED_SHA`). Diffs are **two-dot** `base..head` (the exact changeset that will be fast-forwarded), never three-dot. The CLI **fails closed** if `git rev-parse origin/dev != HEAD` at gate time (a push landed between checkout and gate) or if `head != $TESTED_SHA`. TTL is **0** for `--strict` — no cache on the enforcing path.
- **Dashboard:** resolves and **displays** the pinned `head` SHA in the modal; `/api/promote/dispatch` carries that SHA, and CI refuses if `HEAD != approved SHA`. The 30s cache is keyed on the resolved 40-char SHA (not the symbolic ref) so two rapid pushes can't serve a stale verdict.

This makes "the classified changeset" and "the promoted changeset" the *same bytes*, on the *same runner*. Code-sharing was never the risk; input-divergence was.

### Data model / artifacts

No datastore. Everything derives from git + one cached JSON artifact.

**Inputs:**

1. **Changed paths** — `git diff --name-only base..head`.
2. **Test delta** — extended `getTestChanges()` carrying each check's `tag` (or stable structural key for untagged/e2e — below), its `regression|e2e` area, `kind`, and the **signed direction** per tag.
3. **Override trailers** — `git log --format=%H%x00%B base..head`, scanned (case-insensitive) for:
   - `^Tests-Not-Needed:\s*(\S+)\s+(.+)$` → **path-glob-scoped** (closes D2). An unscoped form is **rejected by the parser** (logged, never a mute).
   - `^Test-Loosen-OK:\s*(slice-[\w-]+|e2e:[^\s]+)\s+(strict→weak|removed|skipped|reworded)\s+(.+)$` → names tag/key, **declared transition**, and reason. The gate **verifies the declared transition equals the detected transition** (closes D1); a mismatch is **itself a RED-FLAG**, not a pass.
4. **Source→test backstop map** — `regression/COVERAGE.lock` (checked-in JSON): `{ source, derivedBy:'readFileSync'|'coverage-md', guards:[{tag,file}] }`. The high-confidence half is auto-derived by scanning **all** literal/const `readFileSync`/`fs.readFile` source-path arguments across `regression/**` (not only the three blessed constants — closes E2); the coarse half is parsed from `regression/COVERAGE.md` (marked `manual`).

**Output artifact** — `regression/TESTS-NEEDED.json`, served at `/api/tests-needed` (`Cache-Control: no-store`), written in CI:
```
{ base, head, devTipAtGate, headEqualsDevTip,
  decision:'clear'|'needs_review'|'red_flag'|'overridden',
  behaviourFiles:[{path,area,kind:'new'|'modified'}],
  testFiles:[{tag,area,kind:'added'|'removed'|'modified',direction:'tightened'|'loosened'|'reworded'|'removed'|'skipped'}],
  loosenedUndeclared:[{tag,file}], removedUndeclared:[{tag,file}], skippedUndeclared:[{tag,file}],
  newBehaviourNoTest:[{path,area}], unguardedSourceChanges:[{path,area}],
  overrides:[{sha,kind,target,transition,reason,verified:true|false}] }
```
**Register event** on `overridden` / `red_flag` / any rejected-trailer: append `{type:'TESTS_UPDATE_GATE', decision, sha, ...}` to `bridge/register.jsonl` via the existing append helper.

### The signed assertion-direction engine (the load-bearing fix)

`lib/assert-direction.js`, called from the extended `getTestChanges()`, classifies each modified test **per tag/stable-key** (not per file — a tighten in one tag must not net out a loosen in another):

- **Skip detection runs in a *separate pass* from name capture** (closes C1). The current name regex swallows `.skip`/`.only`; here we additionally record the **modifier per side**. If the `-` side for a tag is plain `test(`/`it(` and the `+` side is `.skip`/`.only` (or the block is commented out with no `+` match) → emit **`skipped`** *before* the reworded join can absorb it. A dedicated fixture pins exactly this collision.
- **`removed`** — tag present in `-`, absent in `+`.
- **Direction of surviving assertions** — track `addedAsserts`/`removedAsserts` **separately**; compare paired assertions on the same tag via an operator rank table. Two refinements over the naive table:
  - **Strictness includes the right-hand side** (closes C3): a strict operator whose compared-against **literal becomes a variable/expression** (`assert.equal(s,200)` → `assert.equal(s,s)` or `…,computed`) is a **rank drop → `loosened`**, not a rework. Loss of a literal on either side counts as weakening.
  - **One level of new-helper indirection is resolved before ranking** (closes B1): if `-assert.equal(x,5)` becomes `+expectStrict(x,5)` and `expectStrict` is *added in the same diff* wrapping a strict assert, it ranks `reworded`, not `loosened` — so honest helper-extraction does not get forced into a bogus `Test-Loosen-OK:` trailer that would pollute Nog's audit trail.
  - **Unknown idiom defaults to `weak`** (closes C4): swapping a known-strict assert for an unranked one is a rank drop → loud. The self-lock test asserts the rank table is **exhaustively keyed against every assertion idiom actually present** in `regression/` + `e2e/`, and fails if a used idiom is unranked (forces the table to keep pace).

This is a heuristic, not a theorem-prover; it is built to make the **dangerous direction loud** and to **fail toward RED**.

### Stable keys for untagged / e2e checks (closes A3)

Because **0/16 e2e files carry a tag**, the title-based `tagOf` fallback is fragile (retitle-during-loosen reads as add+remove, not a loosen). For untagged checks the engine keys on a **structural fingerprint** — normalized file path + nearest `describe` + a hash of the assertion shape — not the mutable title. Until e2e is tagged, **e2e direction analysis is advisory-only and cannot satisfy area binding** (it can raise a flag, never clear one). Slice F may promote e2e tagging to a Slice-0 prerequisite and add it to the self-lock; this ADR does not assume it.

### Path classification & corroboration

**Buckets** (first-prefix-match; **reachability-aware, not pure prefix** — closes A5):

- **BEHAVIOUR** (tests expected): `dashboard/**`, `bridge/*.js`, `scripts/**`, `lib/**`, `.github/workflows/promote.yml`, `.github/workflows/ci.yml`, **plus any path `require()`d/read at runtime from an entrypoint** (`*.json` config that the server loads, `experiments/**` or `wormhole*/**` only if reachable). A small reachability probe (the same `readFileSync`/`require` literal-scan used for the backstop) decides; unknown `.json` defaults to BEHAVIOUR, not INERT.
- **TEST**: `regression/**`, `e2e/**`, root `test/**` (the latter fixes the modal-test-location false positive).
- **INERT** (never need tests): `docs/**`, `.claude/**`, `bridge/queue/**`, `bridge/staged/**`, `bridge/trash/**`, `bridge/register.jsonl`, decoration `*.md`, **known-inert** config filenames (an explicit allowlist, not blanket `*.json`). **`regression/COVERAGE.lock` and `regression/COVERAGE.md` are explicitly excluded from INERT** and treated as BEHAVIOUR-critical (closes E3 / B3) — their edits are gated by the integrity/anti-shrink tests below.
- **REFACTOR-EXEMPT → INERT**: computed on an **AST/token diff, not a line ratio** (closes B2). If any non-comment, non-whitespace token in an **executable position** changed, the file is BEHAVIOUR regardless of surrounding churn. A 96%-rename diff with one smuggled logic line is **not** exempt; a pure reflow is.

**Corroboration is file-grained, not area-grained** (closes A2). A BEHAVIOUR change is corroborated only if a **mapped guard** for *that source file* moved in the bound area (via `COVERAGE.lock`). Same-area-but-unmapped test movement is **necessary-but-insufficient** → NEEDS-REVIEW, not CLEAR. (`server`→`regression/`; `ui`→`regression/` or `e2e/`, but e2e cannot *clear* per A3.) This stops "tighten any one unrelated assertion → CLEAR for any server change."

### Verdict matrix (fails toward FIX-THE-CODE)

| Observed | Verdict | Routing |
|---|---|---|
| BEHAVIOUR (modified) changed + its **mapped guard** moved, directions `tightened`/`reworded`/`added` | **CLEAR** | Intended update, corroborated. Proceed. |
| **New** BEHAVIOUR file with real logic + **no** mapped/any test, **no** trailer | **RED-FLAG** (clearable by `Tests-Not-Needed:`) | Closes A4: net-new untested behaviour is no longer unblockable amber. |
| BEHAVIOUR changed + **no mapped guard** moved (same-area test moved, or nothing) | **NEEDS-REVIEW** (amber) | Deliberate no-op, or missing test. Route missing → Bashir; missing AC → O'Brien. |
| Backstop: a guarded source changed + its mapped guard did **not** move | **NEEDS-REVIEW** (amber) | Undeclared-behaviour-change floor. |
| A `loosened`/`removed`/`skipped` guard whose **mapped source still exists**, **no override** | **RED-FLAG** | Closes C2: removing a live guard is suspicious regardless of which area *this* PR edited. |
| A masking shape + a **verified** `Test-Loosen-OK: <tag> <transition> <reason>` whose declared transition **matches** | **OVERRIDDEN** | Deliberate retire/rewrite; reason logged + shown. |
| A masking shape + a trailer whose declared transition **mismatches** the detected one | **RED-FLAG** | Closes D1: a wrong declaration is itself a flag. |
| Only INERT / REFACTOR-EXEMPT changed | **CLEAR** | No tests warranted. |

Aggregate verdict = worst per-tag/per-file color. **No override clears RED except an explicit, per-target, transition-verified, committed trailer.**

### Routing on outcome

- **CLEAR** → proceed; green chips.
- **NEEDS-REVIEW** → advisory only; never blocks CI. Operator confirms a deliberate no-op or routes the missing test to **Bashir** (missing AC → **O'Brien**).
- **RED-FLAG** → `promote.yml` step exits non-zero; `main` does not move. Verdict names the shape and routes: masking-with-code-change → **FIX THE CODE** (O'Brien/Rom); genuine contract change → **Bashir** to *move* (not weaken) the assertion, author adds a verified `Test-Loosen-OK:`; new-code-no-test → write the test or add a scoped `Tests-Not-Needed:`.
- **OVERRIDDEN** → green-with-note; register event recorded. For **RED→OVERRIDDEN transitions specifically**, the dashboard requires a distinct second acknowledgment by a **non-author** *before* the fast-forward (closes G2) — the audit is not allowed to be purely post-promotion.

### How it resists gaming

1. **Loosen/delete/skip in a guarded path → RED**, via the signed/structural engine (skip in a separate pass, tautology + literal-loss as rank drops, unknown idiom = weak).
2. **Coincidental same-area test edits can't fake coverage** — corroboration requires a *mapped* guard for the changed file, not just an in-area move.
3. **New untested behaviour is RED**, not unblockable amber; only a scoped, reasoned `Tests-Not-Needed:` clears it.
4. **Override is scoped, transition-verified, auditable, and not self-service** — per-target, declared-transition-must-match, free-text reason in immutable history, printed in gate log + dashboard + register, and for RED→OVERRIDDEN it needs a non-author second-ack before promotion (closes D4 to the extent automatable; residual below).
5. **REFACTOR-EXEMPT is AST/token-based and narrow** — a one-line logic change is never exempt.
6. **Reachability-aware INERT** — behaviour smuggled into a runtime-read `.json` or `experiments/` path is BEHAVIOUR.
7. **The engine self-locks** — a regression test reads `lib/tests-needed.js` + `lib/assert-direction.js` + the **named `promote.yml` step** and asserts: the bucket tables, the direction rules, the exhaustive rank table, that the **tests-needed step specifically** is present, ordered before the suites, and **not `continue-on-error`** (closes H1 — the assertion names *that* step, not the suite steps it patterns off). Widening INERT to swallow `dashboard/`, or neutering the step, is itself a red test.
8. **The hard stop runs on the clean runner against `$TESTED_SHA`** with a two-dot pinned diff and a fail-closed `HEAD == origin/dev == approved-SHA` check — it cannot be spoofed by a doctored local run *or* by a push landing between preview and gate.

---

## Consequences

### What we gain

- The **first mechanism that decides, given a change, whether tests should be updated**, and routes the fix (Bashir vs O'Brien) — including the **new-code-no-test** case, which is now blockable.
- **Real loosen/delete/skip detection** — what the modal already claims. The signed/structural engine (skip pass, tautology/literal-loss, unknown=weak) is reusable and improves the existing checkpoint.
- **Input-pinned correctness**: the classified changeset *is* the promoted changeset (two-dot, `$TESTED_SHA`, fail-closed on drift) — the TOCTOU the prior draft wrongly claimed was already closed.
- **File-grained corroboration** so CLEAR means "the guard for *this* file moved," not "some test in a 22-file area moved."
- **Deterministic, explainable, offline** — no LLM, reproducible on any runner, unaffected by the billing block.
- **Zero new infra, zero new authoring field** — pure node + git + one checked-in JSON, riding existing surfaces and the commit-trailer habit.

### What we lose / accept

- **Proves co-movement, assertion-direction, and file-grained corroboration — not semantic correctness.** The real suites on the clean runner remain the backstop for *does-the-code-work*; this gate governs *should-tests-have-moved*.
- **e2e is advisory-only until tagged.** With 0/16 tags, e2e direction is structural-key heuristic and **cannot clear** a verdict. Real e2e contract changes still rely on the Playwright suite plus operator eyes until Slice-0 tagging lands.
- **The backstop's coarse half is hand-curated.** The derived half can't rot (integrity meta-test) and now scans all source-reads; the manual half is guarded by an anti-shrink invariant (below) but its *content quality* is human work.

### Residual risks (cannot be fully eliminated)

- **R1 — Dishonest-but-matching override.** A `loosened` guard plus a `Test-Loosen-OK:` whose declared transition *correctly* matches the detected one but whose **reason is a lie**. Transition-verification kills the *wrong-transition* dodge; it cannot judge whether the reason justifies the loosening. Reduced to: a non-author second-ack (RED→OVERRIDDEN) + Nog's review of one immutable, named, transition-stamped commit line. Narrower than today's silent in-head judgment — not zero.
- **R2 — Self-service override by a solo author.** If one role both loosens and writes the trailer with no second human, the control is post-hoc for non-RED cases. We enforce non-author second-ack only on **RED→OVERRIDDEN**; lesser cases rely on register visibility. True separation-of-duty would need a role-identity signal the repo doesn't carry today. Honest residual.
- **R3 — Manual-half coverage gaps.** Behaviour in source that **no test guards at all** is invisible to the backstop (amber at best, never RED). That's a coverage gap for Bashir/`COVERAGE.md`, not something this gate can see. The anti-shrink invariant stops *silent removal* of existing guards; it cannot conjure guards that were never written.
- **R4 — Heuristic direction engine.** Novel assertion idioms, exotic helper indirection (>1 level), or cross-file assertion moves can mis-rank. Mitigations: unknown=weak (fails loud), exhaustive-rank-table self-lock, fail-toward-RED. A determined author with a never-before-seen idiom and a matching honest-looking trailer is the worst case — bounded by R1.
- **R5 — Amber fatigue.** Even with file-grained corroboration, legitimate no-behaviour-change refactors and perf changes (F1/F2) land amber. We make amber *rarer* (corroboration is now precise, so amber means "a guarded file moved with no guard movement" — a real signal), route the irreducible cases to the cheap scoped `Tests-Not-Needed:` path, and treat F1 ("a previously-red test for this file now passes") as CLEAR when detectable. Amber can still desensitize the operator over time; this is a UX risk the gate mitigates but does not erase.

### False-positive / false-negative posture

- **False positives** land as **amber** (advisory, never blocks) or are caught as `reworded`/`tightened` by the rank table + helper-indirection resolution. The only hard blocks are the three masking shapes, new-untested-behaviour, and a mismatched override — all clearable by a scoped/verified trailer. A false positive can **never** wrongly fail a promotion in advisory mode.
- **False negatives** — the dangerous direction — are minimized: the engine fails toward RED, corroboration is file-grained, `skip`/in-place-weakening/tautology/cross-area-guard-removal are explicitly closed, and the input is pinned so a doctored or raced changeset can't slip a different diff past the verdict.

### Maintenance burden

- Standing surfaces: the path bucket tables + reachability allowlist, the `COVERAGE.lock` (derived half can't rot via integrity meta-test; coarse half guarded by an **anti-shrink** invariant — mapped-guard count never decreases without a `Coverage-Removed:` trailer, closing E1; "files still exist" was the wrong invariant), and the rank table (exhaustive-keying self-lock).
- Effort: **M–L**. Advisory value lands at Slice D; the hard block at Slice E. The input-pinning (Slice B) and signed engine (Slice A) are the risk centers.

---

## Implementation sketch (slice-sized, for O'Brien)

All paths under `repo/`.

**Slice A — Signed/structural assertion direction (load-bearing).** Create `lib/assert-direction.js` exporting `classifyDirection(diffForTag)` → `'tightened'|'loosened'|'reworded'|'removed'|'skipped'`: separate added/removed assert tracking, operator rank table with **literal-loss/tautology** and **one-level-helper-indirection** handling, **unknown-idiom-defaults-weak**, and a **separate skip pass** keyed per-side (not via the name-capture regex). Extend `getTestChanges()` (`server.js:480`) so each item carries `{tag|key, area, kind, direction}`, replacing `assertionDelta++` (line 521). Update `_renderTestChanges` (`lcars-dashboard.html:7964`) to tolerate the new shape. **Tests (Bashir):** `===`→`>=` = loosened; `equal(s,200)`→`equal(s,s)` = loosened; helper-wrap of a strict assert = reworded; `test`→`test.skip` (the regex-collision fixture) = skipped; unknown idiom swap = loosened; added strict = tightened. Isolate — riskiest, highest-value.

**Slice B — Engine + CLI + pinned input.** Create `lib/tests-needed.js` (`classify({base,head,repoRoot})` — pure, never resolves symbolic refs) and `scripts/tests-needed.js` (`--print`/`--json`/`--strict`; computes `base=merge-base(origin/main,HEAD)`, `head=HEAD`; **two-dot** diffs; **fails closed** if `origin/dev != HEAD` or `head != $TESTED_SHA`; TTL 0 on `--strict`; writes `regression/TESTS-NEEDED.json`). **Tests:** synthetic-diff fixtures per matrix cell (docs-only=clear; modified-server+mapped-guard-moved=clear; modified-server+no-mapped-guard=needs_review; new-script+no-test=red_flag; loosened-guard=red_flag; verified-matching-trailer=overridden; mismatched-trailer=red_flag; whitespace-only=clear; AST one-liner-in-rename=behaviour; `HEAD != origin/dev`=fail-closed).

**Slice C — Backstop map + anti-shrink integrity.** `scripts/build-coverage-map.js` scans **all** `readFileSync`/`fs.readFile` literal/const source-path args across `regression/**` (not three constants) → `regression/COVERAGE.lock`; ingest `regression/COVERAGE.md` as the coarse half. Wire into `lib/tests-needed.js`. **Tests:** integrity meta-test regenerates derived half + asserts on-disk equality; **anti-shrink** test asserts mapped-guard count never decreases without `Coverage-Removed:`; integrity fails if any regression file reads a source path resolving to no lock entry; classify `COVERAGE.lock`/`COVERAGE.md` as BEHAVIOUR-critical (not INERT).

**Slice D — Dashboard surface (advisory).** `GET /api/tests-needed` (sibling of `/api/test-changes` at `server.js:2373`; SHA-keyed cache; `no-store`; degrades to `{available:false}`, never 500s; **displays the pinned 40-char head SHA**). Enrich `confirmUpdateTests()`/`_renderTestChanges()` (`lcars-dashboard.html:7979`/`7952`): per-row verdict chip + triggering source file, default **STOP** on RED, and the **non-author second-ack** control for RED→OVERRIDDEN. `/api/promote/dispatch` carries the approved SHA. **Tests:** endpoint shape + source-string self-lock that chips + SHA display + second-ack render.

**Slice E — CI enforcement.** Add a step in `promote.yml` **between line 47 and line 58**: `node scripts/tests-needed.js --strict`, non-zero on RED unless cleared by verified trailers; append the `TESTS_UPDATE_GATE` register event. Warn-only mirror in `ci.yml`. **Tests (`gate-merge/`):** lock the **named tests-needed step** present, **ordered before the suites**, and **not `continue-on-error`** (not the suite steps it patterns off); extend `PROMOTE_PHASES`/`j-promote-gate-phases` so the new phase is contractual and can't be silently dropped.

**Slice F — Convention + role docs.** Document scoped `Tests-Not-Needed: <path-glob> <reason>` and `Test-Loosen-OK: <target> <transition> <reason>` (+ `Coverage-Removed:`) in `docs/contracts/` (one page). Update `.claude/roles/bashir/ROLE.md` (move, never weaken; retire only with a transition-stamped reason), `.claude/roles/nog/ROLE.md` (review trailers, verify transition + reason, second-ack RED overrides), `regression/COVERAGE.md` (load-bearing). Optionally promote **e2e tagging** to Slice-0 and add to the self-lock. Add the engine self-lock meta-test. Doc + meta only.

---

## Alternatives considered

- **Declared-intent "Intent Manifest" / Hybrid manifest+backstop.** Require O'Brien to declare `slice-<id>-ac-<n>` tags in slices. **Verified fatal:** tag in 22/22 test files, **0/368 slices**; no AC numbering in the template; AC prose under ~15 spellings. The join doesn't exist and over-declaration mis-routes real regressions as "expected" — a false-negative on the most dangerous axis. Kept their *backstop*, discarded the manifest, replaced declaration with the existing commit-trailer habit (now scoped + transition-verified).
- **Source-to-test COVERAGE.lock as the spine.** Strong derived map + integrity test, but as the *primary* gate its RED needs a slice section present in ~6% of slices, its file-grained edges point at the `server.js` monolith (→ AMBER floods → rubber-stamping), and its loosen detection is the same vaporware. **Grafted as the backstop/corroboration layer**, where file-grained signal is exactly right; not the spine.
- **Semantic AI classifier "Bashir's Second Opinion."** Suited to fuzzy AC rewordings, advisory-by-design. But **dark until billing is funded** (org-disabled subscription), non-deterministic at the core of a separation claim, citation-guard proves text-exists not text-justifies, and it scrapes AC headings that don't match real files. Rejected as the gate; a sensible *future advisory chip* once billing + tag normalization land.
- **Diff Heuristic / Path Rules — chosen as the spine.** Highest score, fully buildable on node + git + Actions, deterministic, advisory-safe. Its real weaknesses — anti-masking built on the sign-blind counter, coarse area binding blind to root `test/**` and to e2e's missing tags, symbolic-ref input divergence, prefix-only INERT, line-ratio refactor exemption — are each fixed above (Slice A signed engine incl. skip/tautology/unknown=weak; file-grained corroboration; pinned two-dot `$TESTED_SHA` input; reachability-aware INERT; AST refactor exemption; structural keys for e2e), with the source→test backstop as the false-negative floor pure path rules cannot provide.
# Test-Update Gate — override trailers

This page is the contract for the **Test-Update Gate** (ADR-TEST-UPDATE-GATE). The gate
exists to answer one question for every dev→main promotion:

> Given what the code changed, should the tests have changed — and if a check was
> weakened, removed or skipped, is that an **intended spec change** or a **masked
> regression**?

It fails toward **FIX-THE-CODE**. A guarded check that was loosened, deleted or
skipped, new behaviour that shipped with no test, or a shrunk coverage map, all
read **RED** unless a human declares — in an auditable, scoped, transition-matched
commit trailer — that the change is intentional. The trailer is the override; there
is no `continue-on-error` escape hatch in the workflow.

When code diverges from this document, the code is wrong.

---

## Verdict bands

The engine (`lib/tests-needed.js`) classifies the pinned changeset
`base = merge-base(origin/main, HEAD) .. HEAD` and returns one of:

| Verdict | Meaning | Promotion |
|---|---|---|
| **CLEAR** | Every behaviour change is corroborated by a test that reads it and moved in a non-masking direction. | proceeds |
| **NEEDS REVIEW** | A behaviour file changed but no test that reads it moved. Advisory — glance, then approve if expected. | proceeds (advisory) |
| **OVERRIDDEN** | A weakened/removed check or shrunk coverage is declared intentional by a matching trailer. | proceeds |
| **RED FLAG** | A check was loosened/removed/skipped, new behaviour shipped untested, the coverage map shrank, or a trailer was malformed. | **blocked** by `tests-needed.js --strict` in `promote.yml`; the dashboard defaults to STOP behind a second-reviewer acknowledgement |

"Direction" is the load-bearing signal. The signed engine (`lib/assert-direction.js`)
ranks assertions strict > pattern > truthiness and reports **tightened / reworded /
loosened / removed / skipped**. An **unknown idiom always reads as loosened** — the
gate fails loud, never silent.

---

## The golden rule: move, never weaken

When a feature changes behaviour on purpose, the test for the old behaviour will fail.
That failure is **information**, not an obstacle. The correct response is to **move the
assertion** — re-point it at the new, intended truth — keeping it at least as strict as
before. You almost never need a trailer for that: a moved-but-still-strict assertion
reads as `tightened`/`reworded`, which is CLEAR.

You need a trailer only when you are genuinely making a check **weaker, gone, or
disabled** — the three dangerous directions. Then you must say so, in scope, with the
transition named.

---

## The three trailers

All three are git **commit trailers** (a `Key: value` line in the commit body). They are
parsed across every commit in the promoted range, so any commit in the range may carry
them. They are **scoped and transition-matched** — a bare "trust me" is rejected and
itself turns the verdict RED.

### `Test-Loosen-OK: <target> <transition> <reason>`

Declares that a specific check was weakened/removed/skipped **on purpose**.

- `<target>` — the check's `slice-<id>-ac-<n>` tag (or `e2e:<tag>`).
- `<transition>` — one of `strict→weak` (loosened), `removed`, `skipped`, `reworded`.
  **Must match** the direction the engine detected, or the verdict stays RED
  (`mismatchedOverride`).
- `<reason>` — why the old assertion is no longer the truth.

```
Test-Loosen-OK: slice-412-ac-3 strict→weak the endpoint now returns a range, not a fixed 200
```

### `Tests-Not-Needed: <path-glob> <reason>`

Declares that new/changed behaviour files under a glob legitimately need no test
(pure config, generated output, a path with no observable behaviour).

- `<path-glob>` — must contain a path separator or wildcard (a bare word is rejected).
- `<reason>` — why this path carries no behaviour worth guarding.

```
Tests-Not-Needed: docs/** prose only, no executable behaviour
```

### `Coverage-Removed: <source> <reason>`

Declares an intentional drop in the `regression/COVERAGE.lock` guard count — e.g. you
deleted a source file and its tests together. Without it, a falling guard count is RED
(`coverageShrinkUndeclared`).

```
Coverage-Removed: dashboard/legacy-widget.js widget retired in slice-420, tests deleted with it
```

---

## Who does what

- **Bashir (QA)** authors and *moves* the assertions. He never weakens to go green; a
  retired check leaves with a `Test-Loosen-OK`/`Coverage-Removed` trailer and a reason.
- **Nog (review)** is the trailer reviewer: he checks that each trailer is scoped, that
  the transition matches the real direction, and that the reason is a genuine spec change
  — not a cover for a regression. On a RED override he is the non-author second-ack.
- **The operator (Philipp)** sees the verdict on the Ops checkpoint before dispatching a
  promotion. On RED the dashboard defaults to STOP; proceeding requires the non-author
  acknowledgement. `promote.yml` then re-runs `--strict` on the clean runner and blocks
  the merge if the verdict is still RED.

---

## Where it runs

| Surface | Mode | Effect |
|---|---|---|
| `scripts/tests-needed.js` | `--strict` in `promote.yml` | **enforcing** — exits 1 on RED, before the suites run; fails closed if `HEAD != origin/dev` |
| `scripts/tests-needed.js` | advisory in `ci.yml` (every dev push) | **warn-only** — verdict in the run summary, never blocks |
| Ops dashboard | `/api/tests-needed` | banded chip on the Step-1 checkpoint; default STOP + second-ack on RED |

The backstop that makes corroboration file-grained is `regression/COVERAGE.lock`,
derived by `scripts/build-coverage-map.js` and kept honest by
`regression/gate-merge/j-coverage-map-integrity.test.js` (regenerate-and-deepEqual +
the load-bearing-sources ratchet).

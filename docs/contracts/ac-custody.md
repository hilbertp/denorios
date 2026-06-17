# AC Custody — who owns acceptance criteria, and how they change

Contract for **ADR-AC-RECONCILE** (the source of truth). The acceptance-criteria manifest is
the spec layer the regression gate corroborates against. This page pins ownership and the
change rules; the machinery lives in the ADR and the trailer contract
(`test-update-gate-trailers.md`).

## ⛔ The hard ruling (load-bearing — never soften)

**The pipeline never goes green by changing an acceptance criterion.** When reconcile or the
gate hits a case where going green would require loosening or rewriting an AC, it **HALTS and
escalates to Philipp** and stays RED until he rules. No role edits an AC to clear a red.
**Reconcile may update a TEST from an AC; never the reverse.** (Memory: `project-ac-edits-human-gated`.)

## Source of truth

- `regression/AC-MANIFEST.lock` — tracked, committed, deterministic. The trust root is **git
  history**, not the register. Keyed by the **literal `slice-<id>-ac-<k>` tag** (never list
  position — tags are sparse/non-contiguous by design).
- Derived by `scripts/build-ac-manifest.js` (pure over disk). Chain order: `build-coverage-map.js`
  → `build-ac-manifest.js`. The integrity test enforces deepEqual.

## Ownership

| Role | Owns | Never |
|---|---|---|
| **O'Brien** | Authors each AC as a tagged `- slice-<id>-ac-<k>: <text>` line in the slice's `## Acceptance criteria` block, at slice time (§11.6). | — |
| **Julian (Bashir)** | Writes/updates **tests** from AC text inside the blind reconcile bundle; re-embeds `@ac-hash`. Escalates unresolvable AC-vs-test conflicts to Philipp. | Never edits an AC. Never sees source during reconcile. |
| **Nog** | Non-author second-ack on any AC mutation; reviews legacy backfill against brief *intent*. | Is never the `Spec-Owner`. |
| **Philipp** | The only valid `Spec-Owner` of record; rules every AC conflict. | — |

## The staleness primitive

- `acHash` — sha256 of the AC's conservatively-normalized prose (trim + collapse spaces only;
  no case-fold). The spec's identity. Lives in `AC-MANIFEST.lock`.
- `guardAcHash` — the hash a test claims to guard, embedded in the test as `// @ac-hash: <tag>
  sha256:<hex>`, extracted into `COVERAGE.lock` by `build-coverage-map.js`.
- `stale ⟺ acHash != guardAcHash`. Clearing a stale flag means **editing a test** — which
  re-enters the Test-Update Gate's classifier + trailer machinery. Both sides are pure-over-disk.

## Change rules

- Editing an AC's text changes its `acHash`. Across `base..head` the gate flags **AC-MUTATED**
  (hash changed) / **AC-RETIRED** (tag gone) and demands `AC-Change-OK: <tag> <mutated|retired>
  <reason>` + `Spec-Owner: <name>` — else `red_flag`. Per-tag **hash ratchet**, not acCount (a
  rewrite leaves acCount unchanged).
- **Legacy** tags (`legacy: true`, `acHash: null`) are grandfathered — never hash-ratcheted
  until a human backfills the text from the brief's **prose intent** (never DONE reports),
  Nog-reviewed. They drain off the allowlist over time.

## Honest boundaries (v1)

- Custody closes the relocation hole **only for the tagged-regression surface**. Untagged e2e
  blocks and un-backfilled legacy tags are un-hashable; `acCount`/`legacyCount` flag that surface
  rather than overclaiming "nowhere left to relocate."
- With no commit identity (§11.2) a self-typed `Spec-Owner` clears RED on the clean runner, so
  v1 is **tamper-evidence, not prevention** — the gate emits undeclared/overridden counts. True
  prevention is a commit-signing Slice-0.
- Enforcing vs advisory (§11.1) is Philipp's call; v1 ships **advisory**.

## The new-AC drain feed (how ACs reach Julian)

Every AC commissioned through a slice flows into `AC-MANIFEST.lock` (the integrity test forces
the lock current at commit, so commissioned ACs are always captured). On every pipeline / gate
run, `scripts/ac-reconcile.js` diffs the manifest against Julian's drained ledger
(`regression/AC-DRAINED.json`, tracked) and writes the undrained ones — the **new or changed
active ACs** — to `.claude/roles/bashir/inbox/NEW-ACS.md` (generated, gitignored), each tagged
NEW/CHANGED with its coverage status (MISSING/STALE/COVERED).

Julian's loop, every run:
1. Read `NEW-ACS.md`. For each AC decide: does it **deliberately change existing behaviour**?
   → update/add the guard test and re-embed its `@ac-hash` (a test update the gate audits).
   New behaviour with no guard → write the test. No behavioural change → it drains as-is.
2. `node scripts/ac-reconcile.js --drain` → advances `AC-DRAINED.json` to the current manifest;
   the feed clears. Commit the ledger. A later edit to an AC's text re-surfaces it (hash changes).

Legacy (unhashed) entries never enter the new feed — they are the separate grandfathered
backfill task. O'Brien dumps the ACs (manifest); Julian drains and owns the test decisions.

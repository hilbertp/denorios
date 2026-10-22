# Alex's drafts — 2026-10-22

Two briefs for the first two items of `docs/adr/ADR-JULIAN-ALONGSIDE.md` §9, written on onboarding
after reading the ADR, the inbox, and the archived slice records. The bodies carry `NNN` where the
slice id goes; `stage.sh` mints the id through `bridge/new-slice.js` and fills it in. Stage on the
machine that runs the pipeline (the bodies are validated against `new-slice.js` here, but the id and
the staged file must come from the live queue).

| Draft | ADR item | Lane | Priority | Lands |
|---|---|---|---|---|
| `A-checker-fixes.md` | A, Rule 7 | core | high | first |
| `B-quiet.md` | B, Rule 5 | core | high | after A shows "accepted" in History |

```bash
.claude/roles/obrien/drafts/2026-10-22/stage.sh A
# approve A in Ops; wait for SLICE_SQUASHED_TO_DEV
.claude/roles/obrien/drafts/2026-10-22/stage.sh B
```

## By hand, before approving A (ADR §9 step 0 and "Staged work")

1. Move `.claude/roles/obrien/inbox/REGRESSION-FAILURE-dev-a092cb9.md` to `inbox/processed/`. It is bookkeeping, not a bug.
2. Withdraw staged 377 (break-it machine check; dropped by ADR §6) and 378 (Julian's stage rewrite; replaced by D).
3. 398 becomes G (Julian's board and History polish). Leave it staged, unapproved, until F lands.
4. 397 (Kind letters for commits) gets a Kind letter for `T<N>:` test landings before approval; it is otherwise compatible with D item 10.
5. 396 (streaming session logs) is C: approve it after B, before D.
6. 368: refresh its fixed block from `slice-body-template.md`; it lands before E or folds into E.

## What is deliberately not written

- **A break-it slice.** Julian's handoff of 24 Sep (`inbox/HANDOFF-BREAKIT-EMPTY-PRODUCT-DELTA-FROM-BASHIR.md`) asks for a rule before the break-it script is built. ADR-JULIAN-ALONGSIDE §6 drops the machine break-it from Julian's card the same day; Sam keeps doing it by hand on core slices. The handoff is closed without a slice; move it to `processed/`.
- **D to G.** D (bench, backlog, card, test landing, switch-over) touches `orchestrator.js` in at least nine places listed in §7 items 1-15 and must be sliced against the code as it stands after A, B and C land. Writing it now would pin line numbers that B moves. E, F and G follow D.
- **The rename R1-R3.** Decided 3 Sep, unbuilt, and now ordered after the test-ownership work by both plans. Re-sequence after G.

## Alex's own follow-ups after B lands

- `slice-body-template.md`, fixed block, third bullet: drop "GitHub runs the safety-net suite when the slice lands on dev;" so the block reads "the Promote button runs both".
- Refresh `.claude/roles/obrien/memory/MEMORY.md` (last written 15 Jun) from `docs/HISTORY.md` §3.

# Alex's drafts — 2026-10-22

Seven briefs. Five are surface-lane shakedown slices for the WSL machine, each a few minutes for Sam,
each a real chore the repo owes, and each a row in a History that starts empty on this machine.
Two are the first items of `docs/adr/ADR-JULIAN-ALONGSIDE.md` §9. The bodies carry `NNN` where the
slice id goes; `stage.sh` mints the id through `bridge/new-slice.js` and fills it in. Stage on the
machine that runs the pipeline (the bodies are validated against `new-slice.js` here, but the id and
the staged file must come from the live queue).

| Draft | What | Lane | Priority | Order |
|---|---|---|---|---|
| `1-root-debris.md` | three dead root files go | surface | normal | 1 |
| `2-slice-template.md` | the template nothing reads goes | surface | normal | 2 |
| `3-docs-taxonomy.md` | `docs/README.md` tells the truth | surface | normal | 3 |
| `4-readme-fresh-clone.md` | the quick start works on a fresh clone | surface | normal | 4 |
| `5-julian-not-priya.md` | the crew list says Julian; first slice that touches the screen | surface | normal | 5 |
| `A-checker-fixes.md` | ADR item A, Rule 7 (b) and (c); 7 (a) landed as slice 410 | core | high | 6 |
| `B-quiet.md` | ADR item B, Rule 5 | core | high | 7, after A shows "accepted" |

```bash
.claude/roles/obrien/drafts/2026-10-22/stage.sh 1   # then 2, 3, 4, 5, A, B
```

Stage one, approve it in Ops, watch it travel (Sam, Jordan, landing, Julian's stage), then stage the
next. One at a time on the first day: the point of the shakedown is to see each step work on this
machine, and a second slice in flight hides which one broke what. Slice 5 is the one to watch at
Julian's stage: two browser assertions in `e2e/lcars-mode.spec.js` go red and he has to move them.

Before slice 1: `cp .env.example .env`, put the `claude setup-token` value in it, keep
`DS9_USE_GATE_FLOW=1`, and run `npm install` and `npx playwright install --with-deps chromium`.
Slice 4 writes exactly this into the README; the machine needs it first.

Merge this PR into dev before staging slice 4: its last criterion links `docs/HISTORY.md`, which
this PR adds.

## By hand, before approving A (ADR §9 step 0 and "Staged work")

1. Move `.claude/roles/obrien/inbox/REGRESSION-FAILURE-dev-a092cb9.md` to `inbox/processed/`. It is bookkeeping, not a bug.
2. Withdraw staged 377 (break-it machine check; dropped by ADR §6) and 378 (Julian's stage rewrite; replaced by D).
3. 398 becomes G (Julian's board and History polish). Leave it staged, unapproved, until F lands.
4. 397 and 405 (Kind letters for commits) landed without a Kind letter for `T<N>:` test landings; D adds it (§7 item 10).
5. 396 (item C) and 368 have landed; nothing to do.
6. Press Run Gate & Merge once before A: main is 19 commits behind dev, the last press (run 36190555313) went red on the checker's false flag, and 410 fixed that checker.

## What is deliberately not written

- **A break-it slice.** Julian's handoffs of 24 Sep (`inbox/HANDOFF-BREAKIT-EMPTY-PRODUCT-DELTA-FROM-BASHIR.md`) and 25 Sep (`inbox/HANDOFF-QA-PROCESS-GAPS-SLICE-410-FROM-BASHIR.md`, item 1) ask for rules before the break-it script is built. ADR-JULIAN-ALONGSIDE §6 drops the machine break-it from Julian's card; Sam keeps doing it by hand on core slices. Both are closed without a slice; move them to `processed/`. Item 2 of the 25 Sep handoff is a rule for Alex's briefs, kept: a criterion Julian's stage should corroborate needs an observable the product answers for, never a historical git range.
- **Transitive require credit.** ADR Rule 7 (a) says "directly or indirectly"; slice 410 built direct only and declared transitive out of scope, and Nog flagged that corroboration already widened. Re-decide with Taylor before anyone slices it.
- **D to G.** D (bench, backlog, card, test landing, switch-over) touches `orchestrator.js` in at least nine places listed in §7 items 1-15 and must be sliced against the code as it stands after A and B land (C, slice 396, has landed). Writing it now would pin line numbers that B moves. E, F and G follow D.
- **The rename R1-R3.** Decided 3 Sep, unbuilt, and now ordered after the test-ownership work by both plans. Re-sequence after G.

## Alex's own follow-ups after B lands

- `slice-body-template.md`, fixed block, third bullet: drop "GitHub runs the safety-net suite when the slice lands on dev;" so the block reads "the Promote button runs both".
- Refresh `.claude/roles/obrien/memory/MEMORY.md` (last written 15 Jun) from `docs/HISTORY.md` §3.

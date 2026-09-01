# Merge warning screen — requirements rework (Philipp, 2026-09-01)

**From:** Bashir (Julian, QA)
**To:** O'Brien (Delivery Coordinator)
**Date:** 2026-09-01
**Scope:** Test-Update Gate — the "Run the gate?" RED FLAG dialog

---

## Why this exists

Philipp hit a RED FLAG merging S353 and reviewed the dialog with me. Verdict: **the flag was a false alarm** and the screen has a design fault that defeats the product's core premise.

The two "REMOVED" checks were **renamed, not removed**:
- `…MAIN_PUSHED_TO_ORIGIN emitted…` → `…push event emitted…`
- `C: behind only (2 commits)…` → `C: behind only (2 commits), HEAD on dev…`

Both exist and pass (10/10 in `test/ensure-main-fresh.test.js`), and S353 *added* four stronger checks. Coverage went UP. The gate flagged it because it identifies untagged checks by exact title text, so any rename reads as delete + add.

**Philipp's ruling on the design:** the dialog demands a second reviewer who is not the author. That is self-defeating — this framework exists so a non-developer can ship a feature alone. There is never a second person. Remove it.

## Requirements

1. **Never require a second human.** Delete the "I am not the author, and I've confirmed…" checkbox and the second-reviewer copy. Philipp is always the only human.
2. **The machine confirms what the machine can know.** A renamed check is detected (pair a disappearing title with a near-identical appearing one), labelled **renamed**, and does not flag. Protection that grew does not flag.
3. **Escalate only genuine loss** — a check that vanished with no replacement, or measurably weaker protection.
4. **Plain language, never internal names.** "Slice 353 removed the check *'a merge that does nothing is reported as success'* and put nothing in its place. Intended?" — not the raw test title.
5. **The building agent declares intent.** Rom states "renamed X → Y" in his work record when he renames a check; the gate verifies that claim instead of inferring. Add to Nog's review checklist.
6. **Only police what you run.** `test/` is outside the automated suite but the gate flags changes to it. Either run it or ignore it — pick one.

**Acceptance:** today's S353 screen turns green automatically, with no box to tick.

## Context

- Sits alongside the S356–S363 slate. Related but distinct from S361 (make the merge lock real on the server) — this one is about *what the dialog asks*, S361 is about *whether the button obeys*.
- Second false red flag in one day (mine this afternoon was the first, from a rename of an untagged check). The cry-wolf risk is the real cost: a gate that flags honest renames trains reflex-ticking, and then gets ticked the day a check is genuinely disabled.
- Logged in IDEAS.md 2026-09-01.

## What NOT to change

- Keep the gate stopping by default, keep "See diff", keep the changed/added/removed breakdown.
- No change to the AC hard rule (never edit an AC to go green).
- Not asking to weaken detection — asking to stop misclassifying renames as removals.

— Bashir

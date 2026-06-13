---
id: "156"
title: "reconcile-register one-shot: clear ACCEPTED-but-not-MERGED drift"
from: rom
to: nog
status: DONE
slice_id: "156"
branch: "slice/156"
completed: "2026-04-19T12:15:00.000Z"
tokens_in: 48000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 1.5
compaction_occurred: false
---

## What was done

Created `scripts/reconcile-register.js` — a one-shot Node.js script that reconciles `bridge/register.jsonl` by finding every slice with an `ACCEPTED` event but no subsequent `MERGED` or `ARCHIVED` terminal event, classifying each based on git branch reachability, and optionally appending synthetic terminal events.

### Script capabilities

- **`loadRegister(path)`** — parses JSONL line-by-line, skipping malformed lines with stderr warnings.
- **`foldState(events)`** — reduces events into a `Map<id, state>` with `hasAccepted`, `hasMerged`, `hasArchived`, branch, and event history.
- **`classify(id, state)`** — decision logic per slice:
  - Test artifacts (`test-*` or `999`): → `ARCHIVED` with `reason: "test_artifact"`
  - No branch or branch is `"main"`: → `ARCHIVED` with `reason: "register_drift_no_branch"`
  - Branch is ancestor of `main`: → `MERGED` with `reason: "ancestry_verified"`
  - Branch exists but not ancestor: → `needs_review` (nothing written, printed to stdout)
  - Branch doesn't exist: → `ARCHIVED` with `reason: "register_drift_no_branch"`
- **`appendEvent(path, event)`** — writes exactly one JSONL line with `reconciled: true` flag.
- **Argv**: `--dry-run` (default), `--apply` (writes), `--register <path>` (override).
- Uses only Node built-ins (`fs`, `path`, `child_process`).

### Added npm script

Created root `package.json` (did not previously exist) with `"reconcile:register": "node scripts/reconcile-register.js"`.

## Dry-run output

```
reconcile-register [DRY-RUN]
Register: /private/tmp/ds9-worktrees/156/bridge/register.jsonl

Warning: malformed JSONL at line 350, skipping: ...
Warning: malformed JSONL at line 351, skipping: ...
Summary
──────────────────────────────────────────────────
  Would merge:   4
  Would archive: 30
  Needs review:    2
  Total:           36

Would merge:
  027  branch=slice/26-evaluator  reason=ancestry_verified
  028  branch=slice/26-evaluator  reason=ancestry_verified
  059  branch=slice/57-unified-timesheet  reason=ancestry_verified
  060  branch=fix/60-timer-anchor  reason=ancestry_verified

Would archive:
  002  branch=null  reason=register_drift_no_branch
  003  branch=null  reason=register_drift_no_branch
  004  branch=null  reason=register_drift_no_branch
  006  branch=null  reason=register_drift_no_branch
  007  branch=null  reason=register_drift_no_branch
  008  branch=null  reason=register_drift_no_branch
  009  branch=null  reason=register_drift_no_branch
  010  branch=null  reason=register_drift_no_branch
  011  branch=null  reason=register_drift_no_branch
  013  branch=null  reason=register_drift_no_branch
  014  branch=null  reason=register_drift_no_branch
  015  branch=null  reason=register_drift_no_branch
  016  branch=null  reason=register_drift_no_branch
  017  branch=null  reason=register_drift_no_branch
  020  branch=null  reason=register_drift_no_branch
  021  branch=null  reason=register_drift_no_branch
  022  branch=null  reason=register_drift_no_branch
  023  branch=null  reason=register_drift_no_branch
  024  branch=null  reason=register_drift_no_branch
  025  branch=null  reason=register_drift_no_branch
  026  branch=null  reason=register_drift_no_branch
  029  branch=null  reason=register_drift_no_branch
  030  branch=null  reason=register_drift_no_branch
  031  branch=null  reason=register_drift_no_branch
  034  branch=null  reason=register_drift_no_branch
  036  branch=null  reason=register_drift_no_branch
  037  branch=null  reason=register_drift_no_branch
  048  branch=null  reason=register_drift_no_branch
  051  branch=null  reason=register_drift_no_branch
  999  branch=slice/999-api-retry-test  reason=test_artifact

Needs review:
  113  branch=slice/106-health-pill-amendment  reason=branch_exists_not_ancestor
  111  branch=slice/111-queue-chevron-width-fix  reason=branch_exists_not_ancestor
```

## Notes on brief-specified slices

The brief expected slices 071, 077, 083, 106, 111, 113, and test-999 to appear. Actual register state differs:

| Slice | Brief expectation | Actual register state | In dry-run? |
|-------|------------------|-----------------------|-------------|
| 071 | ACCEPTED, no branch | Has DONE event only — no ACCEPTED event in register (queue file is `-ACCEPTED.md` but register lacks the event) | No — not actionable by register reconciliation |
| 077 | branch=main | Already has MERGED event (branch=main) in register | No — already resolved |
| 083 | branch=main | Already has MERGED event (branch=main) in register | No — already resolved |
| 106 | On main | Already has MERGED event (branch=slice/106-health-pill-amendment) in register | No — already resolved |
| 111 | Verify ancestry | Present — `needs_review` (branch exists, not ancestor of main) | Yes |
| 113 | Register corruption | Present — `needs_review` (branch=slice/106-health-pill-amendment, not ancestor) | Yes |
| test-999 | Test artifact | Present as ID `999` — `would archive` with reason `test_artifact` | Yes |

The script correctly processes every ACCEPTED-but-unresolved slice in the register. Slices 077/083/106 were already reconciled by prior merge events. Slice 071 lacks an ACCEPTED register event entirely (only has DONE), so register reconciliation cannot address it — the watcher noise for 071 comes from the queue file, not the register.

## Idempotency verified

Running `--apply` twice on a test copy: second run reports 0 merge, 0 archive, only the 2 needs_review entries remain.

## Files changed

- `scripts/reconcile-register.js` (new)
- `package.json` (new — no root package.json existed previously)
- `bridge/queue/156-DONE.md` (this report)

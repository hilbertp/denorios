---
id: "318"
title: "F-LOGBOOK-TEST — Logbook outcome column: relabel the success verdict to 'test'"
from: rom
to: nog
status: DONE
slice_id: "318"
branch: "slice/318"
completed: "2026-06-17T13:12:00.000Z"
tokens_in: 8200
tokens_out: 620
elapsed_ms: 95000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary

Relabelled the non-failure outcome pill in the Logbook from `outcome-success` / "success" to `outcome-test` / "test". Three minimal edits to `dashboard/lcars-dashboard.html`:

1. **`outcomeHtml()`** (line ~5137): changed emitted class and text from `outcome-success` / `"success"` to `outcome-test` / `"test"`.
2. **Light-mode CSS** (line ~2832): added `.outcome-test { background: var(--ok-bg); color: #166534; }` mirroring `.outcome-success`.
3. **LCARS dark-mode CSS** (line ~3549): added `body.lcars-mode .outcome-test { color: #7be388 !important; }` mirroring the existing `outcome-success` dark-mode rule.

The failure branch (`outcome-error` / "error") is untouched. No test files were modified.

## Acceptance criteria

- **slice-318-ac-1**: ✅ Non-failure outcomes now render `<span class="outcome-pill outcome-test">test</span>`; failure outcomes still render `<span class="outcome-pill outcome-error">error</span>`.

## Files changed

- `dashboard/lcars-dashboard.html` — 3 insertions, 1 deletion

## Notes

The existing `.outcome-success` CSS rule was left in place (it is still referenced by no code but removing it is outside scope). The two e2e specs asserting `.outcome-pill.outcome-success` will now fail — that is the intended behaviour triggering Bashir's test-update loop.

---
id: "043"
title: "Staged commissions panel in Leeta's frontend"
summary: "Add a review panel to the live dashboard so Philipp can see staged commissions and click Commission, Amend, or Reject directly in the browser — without touching files."
goal: "The staged commissions panel built in commission 042 is visible and interactive in Leeta's React frontend at dax-dashboard.lovable.app."
from: obrien
to: obrien
priority: high
created: "2026-04-10T00:00:00Z"
references: "042"
timeout_min: null
status: "REJECTED"
---

## Objective

Commission 042 builds the backend: `bridge/staged/` directory, three API endpoints, and a panel in the local dashboard. This commission produces the Leeta instruction block so the same panel appears in the React frontend at dax-dashboard.lovable.app.

Leeta cannot access `bridge/staged/` directly — she must go through the API. The API endpoints from 042 are the interface.

## What O'Brien delivers

A ready-to-paste instruction block for Leeta. It must include:

1. The full component spec (what to build)
2. The exact API endpoints to call (from commission 042)
3. The polling behavior
4. The visual layout and button behavior

## The staged panel spec (for Leeta)

### Data source

Poll `GET /api/bridge/staged` every 5 seconds. Response is an array of:
```json
{
  "id": "040",
  "title": "Branch cleanup",
  "summary": "Three unmerged branches need to land on main. Test branches need deletion.",
  "goal": "...",
  "status": "STAGED" | "NEEDS_AMENDMENT",
  "amendment_note": "..." | null,
  "body": "..."
}
```

### Layout

Show as a card list above the queue panel. Title: **"Awaiting Your Review"**.

If empty: show `No commissions pending review.`

Each card:
```
┌──────────────────────────────────────────────────┐
│ #040  Branch cleanup                              │
│ Three unmerged branches need to land on main.     │
│ Test branches need deletion.                      │
│                                                   │
│  [Commission]  [Amend]  [Reject]                  │
│                                                   │
│  ▸ Details                           (collapsed)  │
└──────────────────────────────────────────────────┘
```

If `status === NEEDS_AMENDMENT`, replace buttons with:
```
│ ⏳ Awaiting O'Brien's revision                       │
│ Your note: "{amendment_note}"                     │
```

### Button actions

**Commission** → `POST /api/bridge/staged/{id}/commission`
On success: remove card from list.

**Amend** → show inline text input "What should change?" with a Submit button.
On submit: `POST /api/bridge/staged/{id}/amend` with body `{ note: "..." }`
On success: card updates to NEEDS_AMENDMENT state showing the note.

**Reject** → show inline "Reject this commission?" with Confirm / Cancel.
On confirm: `POST /api/bridge/staged/{id}/reject`
On success: remove card from list.

**Details toggle** → expand/collapse the full commission body. Collapsed by default.

### Styling

Match the existing dashboard aesthetic. Use the same card/panel style as the queue view. Buttons: Commission = primary color, Amend = neutral, Reject = destructive (red or muted red).

## Constraints

- O'Brien writes the Leeta instruction block only — he does not modify Lovable directly.
- The instruction block must be complete enough for Leeta to implement without follow-up questions.
- Instruction block should be in a markdown code block, ready for Philipp to paste.
- This commission depends on 042 being merged first (the API endpoints must exist).

## Success Criteria

- [ ] Leeta instruction block written and ready to paste
- [ ] Instruction covers: API endpoints, polling, card layout, all three button actions, NEEDS_AMENDMENT state, Details toggle
- [ ] No ambiguity that would require Leeta to guess

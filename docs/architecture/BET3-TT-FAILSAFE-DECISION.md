# T&T Failsafe — Architecture Decision

**Author:** Dax (Architect)
**Date:** 2026-04-12T05:50:00Z
**Scope:** Bet 3 — T&T enforcement for Cowork roles
**In response to:** `repo/.claude/roles/dax/HANDOFF-TT-FAILSAFE-DECISION-FROM-OBRIEN.md`

---

## Q1 — Is this still needed?

Yes, but cheaply. O'Brien's tracking is now structural and closed. The Cowork role gap remains real: Philipp is hitting plan limits constantly, so aggregate cost data matters for capacity planning. Systematic holes in `timesheet.jsonl` — even a few sessions per week — make the data unreliable over months. However the risk is low severity: a missed entry loses one session's economics, not a full bet. The implementation must cost less than the problem. A two-file change in two skills is the ceiling. Anything that requires a new service, a scheduler, or changes to more than three files is overengineered for this threat level.

---

## Q2 — Enforcement point

**The mechanism: `check-handoffs` self-audit + `bridge/tt-audit.jsonl`.**

When `handoff-to-teammate` sends a handoff, it appends one line to `bridge/tt-audit.jsonl`:

```json
{ "role": "dax", "ts": "2026-04-12T05:22:00Z", "to": "obrien", "ref": "HANDOFF-BET3-SLICE-TRACKING-FROM-DAX.md" }
```

When any role runs `check-handoffs` to open a new session, it reads `tt-audit.jsonl` for its own last outbound entry, then checks `timesheet.jsonl` for a manual entry from this role (`estimated_by` or `role` field) with a timestamp after that outbound. If none found, it emits a warning before surfacing the new handoffs:

> ⚠️ No T&T entry found since your last outbound handoff (2026-04-12T05:22:00Z). Log via `ds9:estimate-hours` before proceeding.

This is a **warning, not a block**. Philipp is always present and always the final decision-maker. A block that prevents a role from loading work when Philipp urgently needs it is worse than a missed timesheet entry. The warning is visible, logged in the role's session output, and creates friction without creating a hard gate.

The last-role-in-chain problem (no subsequent role checks the final sender) is acceptable under this design. `usage-snapshot.js` provides a parallel signal: if the API shows cost delta in a time window with no corresponding `timesheet.jsonl` entry, the gap is visible in the Ops Center. It's a cross-check, not a gate.

The other candidates are rejected:
- **Receiver checks sender** — still misses the terminal role, same hole.
- **Quark compliance role** — adds a full new role for a lightweight problem. Overengineered.
- **Scheduled task** — requires a background process that doesn't exist for Cowork. Not viable.
- **Ops Center only** — passive, Philipp is already overloaded, doesn't create the friction at the right moment.

---

## Q3 — Scope of implementation

Three changes, no new infrastructure beyond one data file:

**1. `bridge/tt-audit.jsonl`** (new file, auto-created on first write)
Append-only. One line per outbound handoff. Fields: `role`, `ts`, `to`, `ref`.

**2. `handoff-to-teammate` skill** (one addition)
After writing the handoff file, append to `bridge/tt-audit.jsonl`. This is a single `fs.appendFileSync` call or equivalent bash line. No other changes to the skill.

**3. `check-handoffs` skill** (one addition)
At the top of the scan, before reporting handoffs: read `bridge/tt-audit.jsonl` for this role's most recent outbound entry, cross-reference against `bridge/timesheet.jsonl` entries where `estimated_by === this_role` and `ts > last_outbound_ts`. If no match, emit the warning. Adds approximately 15 lines of file-read logic to the skill.

No changes to `watcher.js`, `server.js`, any `ROLE.md`, or any other skill. O'Brien implements all three. This is a small commission — estimate 45 minutes human equivalent.

# Bet 2 — Product Requirements

**From:** Sisko (Product Manager)
**To:** Dax (Architect)
**Date:** 2026-04-08
**Scope:** Bet 2 — Contributor-facing relay & dashboard

---

## Why this exists

A stranger arrives at the GitHub repo. They see a filesystem watcher, a folder of markdown files, and instructions to manually start two Node processes. Nothing in that picture communicates what the system actually does — that there's a PM, a delivery coordinator, an implementor, and a code reviewer all talking to each other autonomously through a structured pipeline. The product is invisible.

Without a way to see it working in under five minutes, there are no contributors. This artifact defines the minimum product experience that makes Dax legible to a developer who's never heard of it.

---

## The bet

**Hypothesis:** If a developer can run one command and watch the AI team pipeline in action — roles connecting, work flowing, stages transitioning — they will understand the product immediately and some will want to contribute.

**Success metric:** 5 contributions from 5 different GitHub accounts within 60 days of the repo going public.

**Failure condition:** If the dashboard doesn't make the use case obvious to a stranger without reading the README, this bet fails on usability and we revisit before promoting the repo.

---

## The target user

A developer who:
- Already uses Claude, Cursor, or Copilot for solo coding
- Is hitting the ceiling of single-agent tools (context limits, no coordination, no persistent memory)
- Found the repo via Hacker News, a tweet, or a friend's recommendation
- Has 5 minutes and a willingness to run a Docker command

They are not a Philipp. They don't know what the Liberation of Bajor is. They don't know DS9. They've never seen a commission file. They want to understand what this thing does — fast.

---

## The experience we're building

### Entry point

```
git clone https://github.com/hilbertp/liberation-of-bajor
cd liberation-of-bajor
docker compose up
```

Browser opens (or a URL is printed). Dashboard loads. Done. No npm install, no manual process management, no reading the docs first.

### What they see

The dashboard answers one question: **"What is happening right now and who is doing it?"**

Five elements, no more:

1. **Role status panel** — Which roles exist and whether they're connected. O'Brien (connected/disconnected), O'Brien (connected/disconnected). Nog and Bashir shown as slots labeled "coming soon" — signals the system is extensible.

2. **Active commission** — If a commission is in flight: its title, which stage it's in, which role owns it right now, and how long it's been there. This is the heartbeat of the product — the thing that makes someone go "oh, it's actually running."

3. **Queue view** — Pending commissions waiting to be picked up. Even one item in the queue tells a story: "O'Brien wrote this, the watcher will pick it up, O'Brien will execute it."

4. **Recent completions** — Last 3-5 completed commissions: title, outcome (DONE / AMENDED / ERROR), duration. Shows the loop actually closes.

5. **System health** — Is the relay running? When did it last heartbeat? One pill: ONLINE / DEGRADED / OFFLINE.

### What they don't see

- No LCARS aesthetic. This is a developer tool, not a Star Trek cosplay.
- No economics panel. That's internal tooling for Philipp.
- No mission lifecycle pipeline with 10 stages. That complexity is earned later.
- No configuration UI. Read-only. Observers don't configure systems they're evaluating.
- No authentication. It's local-only, single-user, open in a browser.

---

## The "aha" moment

The product clicks when someone watches a commission move from PENDING → IN PROGRESS and sees "O'Brien" appear as the owner. That transition — a role picking up work and executing it — is the entire product in one moment.

The dashboard must make this transition visible in real time (or near-real time). Polling every 5 seconds is acceptable. A stale screenshot is not.

If there's nothing in flight, the dashboard should show the last completed commission so the board is never empty. An empty dashboard communicates "nothing works here."

---

## Constraints

**From Philipp (non-negotiable):**
- Single command to start: `docker compose up`. No prerequisite steps.
- Local-only. No cloud services, no external accounts, no API keys required to run the dashboard.
- The underlying file queue must remain intact. The relay can wrap it; it cannot replace it. Files are the source of truth per PROJECT-VISION.md.
- O'Brien stays in Cowork with full capabilities. O'Brien stays in Claude Code CLI. Neither collapses into a lesser version. The relay connects them — it doesn't absorb them.

**From the existing architecture (respect these):**
- Commission format: YAML frontmatter + markdown body. This contract is locked.
- Queue lifecycle: PENDING → IN_PROGRESS → DONE/ERROR. The relay respects or extends this — does not replace it.
- `claude -p --permission-mode bypassPermissions` is the O'Brien invocation path. Non-negotiable.

**Scope boundary:**
- This is not the full Ziyal-specced LCARS ops dashboard (that's Bet 3).
- This is not the landing page (that's Bet 1, paused).
- This is the minimum experience that proves the product to a stranger. Ship fast, learn, iterate.

---

## What Dax is expected to deliver

Read the existing architecture handoff in this folder (`HANDOFF-RELAY-SERVICE.md`) — it covers the relay service design questions. This document provides the product requirements that should inform those architectural decisions.

Specifically, these requirements constrain Dax's choices:

- The dashboard must be **zero-config to run** → the relay + dashboard must ship as a single `docker compose up`
- The dashboard must show **live state** → polling or push, but not stale static files
- The dashboard must be **readable by a stranger** → no LCARS jargon, no internal terminology without context, role names must be human-readable ("O'Brien — Delivery Coordinator", not just "obrien")
- The relay must **not break existing Cowork + Claude Code workflows** → Philipp must be able to keep using the system exactly as before while the relay runs alongside

Dax's architecture document should show how these requirements are satisfied, not just how the system is structured.

---

## Reference files

| File | What it tells you |
|---|---|
| `roles/dax/HANDOFF-RELAY-SERVICE.md` | The architecture questions Sisko posed to Dax |
| `PROJECT-VISION.md` | North star — agents keep their powers, files are source of truth |
| `repo/OBRIEN.md` | Current O'Brien workflow — the thing the relay must not break |
| `repo/.claude/CLAUDE.md` | O'Brien's anchor — the thing the relay must not break |
| `repo/bridge/orchestrator.js` | What the relay is replacing or wrapping |
| `repo/bridge/queue/` | The file-based state machine in action |

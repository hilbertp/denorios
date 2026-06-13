# Bet 2 Dashboard — Design Brief

**From:** Sisko (Product Manager)
**To:** Ziyal (Product Designer)
**Date:** 2026-04-08
**Scope:** Bet 2 — Contributor-facing relay & dashboard
**Codeword:** riverdale

---

## Why this exists

We're about to make the Liberation of Bajor public on GitHub. Right now, a stranger cloning the repo sees markdown files, a filesystem watcher, and zero visibility into what the system actually does. There is no "aha" moment. Without one, there are no contributors.

Dax architected a relay service that wraps the existing bridge in Docker. `docker compose up` starts everything. Your job: design the dashboard a stranger sees when they open `http://localhost:4747` in their browser.

This is the first thing a potential contributor encounters. It has to make the product click within 60 seconds.

---

## The bet

**Hypothesis:** If a developer can run one command and watch the AI team pipeline in action — roles connecting, work flowing, stages transitioning — they will understand the product immediately and some will want to contribute.

**Success metric:** 5 contributions from 5 different GitHub accounts within 60 days.

**If it fails:** That's information. We iterate or pivot.

---

## The target user

A developer who already uses Claude, Cursor, or Copilot for solo coding. They're hitting the ceiling of single-agent tools — no coordination between agents, no persistent memory, no one watching architecture while someone else ships features. They found the repo via Hacker News or a friend. They have 5 minutes and a willingness to run `docker compose up`.

They are not Philipp. They don't know DS9. They've never seen a commission file. They want to understand what this thing does — fast.

---

## What the dashboard shows — exactly five elements

Dax's architecture specifies these. Your job is to make them visually clear to a stranger.

### 1. Role status panel

Which roles exist and whether they're connected.

- **O'Brien** — Delivery Coordinator (connected / disconnected)
- **O'Brien** — Implementor (connected / disconnected)
- **Nog** — Code Reviewer (coming soon, grayed out)
- **Bashir** — QA (coming soon, grayed out)

Each role must show its name AND its function. "O'Brien" alone means nothing to a stranger. "O'Brien — Delivery Coordinator" tells the story.

The "coming soon" slots are important: they signal that the system is extensible. This is a team, not a pair.

### 2. Active commission (the "aha" moment)

This is the most important element on the page.

If a commission is in flight: show its title, which stage it's in (PENDING / IN PROGRESS / DONE), which role owns it right now, and how long it's been there.

**The product clicks when someone watches a commission move from PENDING to IN PROGRESS and sees "O'Brien" appear as the owner.** That transition — a role picking up work and executing it — is the entire product in one moment. Design around this transition. Make it visible, unmissable.

If nothing is active, show the last completed commission so the board is never empty. An empty dashboard communicates "nothing works here."

### 3. Queue view

Pending commissions waiting to be picked up. Even one item in the queue tells a story: "O'Brien wrote this, the watcher will pick it up, O'Brien will execute it."

### 4. Recent completions

Last 3–5 completed commissions: title, outcome (DONE / ERROR), duration. Shows the loop actually closes.

### 5. System health

One pill: ONLINE / DEGRADED / OFFLINE. Derived from heartbeat freshness.

---

## The empty state

When a stranger runs `docker compose up` and no real commissions exist, the dashboard needs to show something compelling. Dax's architecture specifies a demo commission (`relay/demo/000-DONE.md`) that demonstrates the full lifecycle — what a commission looks like, what a report looks like, what DONE means.

Design the empty state so the stranger sees both "what happened" (the demo commission in recent completions) and "what it looks like live" (a visual hint of what the active commission element looks like when a real commission is in flight). Could be a static example, a subtle annotation, or a brief explainer. Your call.

The goal: a stranger who can't run a real commission yet (they might not have Claude credentials) still understands the product from the empty state alone.

---

## Visual direction

**Full design freedom.** There is no brand voice role yet. You're establishing the visual language for Dax's contributor-facing surface. What you decide here, Leeta inherits for the landing page.

**Constraints:**

- **No LCARS.** This is a public-facing developer tool, not the internal ops dashboard. No elbow bars, no amber/lavender palette, no Antonio font, no Star Trek aesthetic.
- **Developer audience.** It should feel like a tool, not a marketing page. Think GitHub's dark mode, Linear's dashboard, Vercel's deploy page — clean, information-dense, utilitarian.
- **Dark background.** Stay in the dark family. Developer tools live on dark backgrounds.
- **Readable by a stranger.** No internal jargon without context. Role names always paired with their function. Commission stages labeled in plain English.

Beyond those constraints: spacing, typography, color palette, interaction hints, layout — all yours. Make it look intentional, not templated. If someone evaluates this project and thinks "these people care about craft," we've nailed it.

---

## Technical constraints

- **Single HTML file.** Inline CSS and JS. No build step, no component library, no React. This is a Bet 2 disposable prototype — Bet 3 gets the proper React dashboard later.
- **Polls `/api/bridge` every 5 seconds.** The API returns JSON with roles, active commission, queue, recent completions, and health status. Dax has the full JSON schema in the architecture doc Section 4.5.
- **Read-only.** No forms, no inputs, no configuration UI. Observer mode only.
- **No authentication.** Local-only, single-user.

---

## What you deliver

A design spec (wireframe, annotated mockup, or whatever fidelity answers the design questions) that O'Brien can implement as a single HTML file. Include:

1. **Layout** — where the five elements sit, how they relate to each other spatially
2. **Visual direction** — colors, typography, spacing decisions (enough for O'Brien to implement without guessing)
3. **The "aha" moment** — one paragraph explaining how you handled the active commission element and why your approach makes the PENDING → IN PROGRESS transition unmissable
4. **Empty state** — how the demo commission + pipeline hint work visually
5. **Responsive notes** — if you have an opinion on mobile/tablet, include it. If not, mark it as O'Brien's call.

Deliver to O'Brien's inbox (or leave in your folder for O'Brien to pick up). O'Brien slices and commissions O'Brien.

---

## What NOT to worry about

- **The relay service architecture** — that's Dax's deliverable, already done
- **README content** — O'Brien writes that in B2.S3
- **Landing page consistency** — you're establishing the direction, Leeta follows
- **Brand voice** — doesn't exist yet as a role. Use your judgment.
- **Bet 3 LCARS dashboard** — completely separate surface. Don't reconcile them.

---

## Reference files

| File | What it tells you |
|---|---|
| `docs/architecture/BET2-RELAY-DASHBOARD-ARCHITECTURE.md` | Dax's full architecture — Section 4 is the dashboard spec, Section 4.5 is the API schema |
| `roles/sisko/RESPONSE-BET2-ARCHITECTURE-FROM-DAX.md` | Dax's summary of key decisions |
| `roles/dax/HANDOFF-BET2-REQUIREMENTS.md` | Product requirements that shaped the architecture |
| `PROJECT-VISION.md` | North star — principles the dashboard must respect |
| `roles/ziyal/ONBOARDING.md` | Your skill toolkit and team workflow |

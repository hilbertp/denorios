# Bet 2 Dashboard — Design Spec

**From:** Ziyal (Product Designer)
**To:** O'Brien (Delivery Coordinator)
**Date:** 2026-04-08
**Scope:** Bet 2 — Contributor-facing relay dashboard
**Responds to:** `HANDOFF-BET2-DASHBOARD-FROM-SISKO.md`
**Codeword:** riverdale

---

## Summary

This spec defines the dashboard a stranger sees when they open `http://localhost:4747` after running `docker compose up`. It covers layout, visual direction, the key "aha" transition, empty state, and all implementation details O'Brien needs.

**Wireframe:** `roles/ziyal/deliveries/bet2-dashboard-wireframe.html` — open in a browser. Use the control panel in the bottom-right to simulate state transitions.

---

## 1. Layout

Single-column, max-width 960px, centered. Four vertical sections stacked top to bottom:

```
┌─────────────────────────────────────────┐
│  HEADER                    HEALTH PILL  │
├─────────────────────────────────────────┤
│  [O'Brien]  [O'Brien]  [Nog]  [Bashir]    │  ← role status row (4-col grid)
├─────────────────────────────────────────┤
│                                         │
│  ████ ACTIVE COMMISSION ████████████    │  ← hero element, full width
│  Title, stage badge, owner, elapsed     │
│                                         │
├───────────────────┬─────────────────────┤
│  QUEUE            │  RECENT             │  ← 2-col grid
│  pending items    │  last 3-5 completed │
└───────────────────┴─────────────────────┘
```

**Why this order:** The eye scans top-to-bottom. First: "is it running?" (health). Second: "who's here?" (roles). Third — the hero: "what's happening right now?" (active commission). Fourth: "what else is going on?" (queue + recent). The active commission gets full width and the most visual weight because that's where the product clicks.

**Spacing:** 32px vertical between sections. 24px inside panels. 16px between grid items.

---

## 2. Visual Direction

### Palette

Developer-tool dark mode. Deliberately not GitHub (too familiar) and not LCARS (wrong audience).

| Token | Value | Usage |
|---|---|---|
| `--bg-root` | `#0d1117` | Page background |
| `--bg-surface` | `#161b22` | Card/panel backgrounds |
| `--bg-elevated` | `#1c2129` | Hover states, demo banner |
| `--border-default` | `#30363d` | Card borders |
| `--text-primary` | `#e6edf3` | Headings, titles |
| `--text-secondary` | `#8b949e` | Body text, labels |
| `--text-tertiary` | `#6e7681` | Captions, disabled |
| `--accent` | `#39d0ba` | Active states, owner name, in-progress badge |
| `--green` | `#3fb950` | Connected, done |
| `--yellow` | `#d29922` | Pending |
| `--red` | `#f85149` | Error, offline, stuck |

**Accent color rationale:** Cool teal (`#39d0ba`). Not GitHub's blue, not LCARS amber. Reads as "tech product with its own identity." High contrast against the dark backgrounds. The accent is used sparingly — only on the active commission border, the stage badge when in-progress, and the owner name. Everything else uses the neutral palette.

### Typography

System fonts. No custom font files, no load latency.

- **Sans:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
- **Mono:** `'SF Mono', SFMono-Regular, ui-monospace, Menlo, Consolas, monospace`

Mono is used for: stage badges, health pill, commission IDs, elapsed time, status labels. Anything that reads like system output.

Sans is used for: titles, descriptions, body text.

### Key visual rules

- **No gradients, no shadows** (except the active commission glow). Clean, flat surfaces.
- **1px borders** on all cards. The border is the primary visual separator.
- **Pill-shaped badges** for status (health, stage, outcome). Muted background + colored text + subtle border.
- **Dashed borders** on "coming soon" cards. Signals incompleteness without clutter.
- **Opacity 0.45** on coming-soon cards. They're visible but clearly secondary.

---

## 3. The "Aha" Moment

The product clicks when a stranger watches a commission go from **PENDING → IN PROGRESS** and sees "O'Brien" appear as the owner.

### How the design handles this

**The active commission element is visually dominant.** Full-width, accent-colored border, subtle glow (`box-shadow: 0 0 20px rgba(57, 208, 186, 0.15)`). It's the single biggest element on the page and the only one with a colored border.

**The transition is animated.** When the API returns a stage change from PENDING to IN_PROGRESS:

1. The border color transitions from yellow (pending) to teal (in-progress) over 1 second
2. The glow kicks in — a soft teal ambient shadow
3. The stage badge changes from `PENDING` (yellow) to `IN PROGRESS` (teal, with a slow pulse animation)
4. The owner field goes from `—` to `O'Brien` in the accent color
5. The elapsed timer starts from 0

**The animation is subtle, not flashy.** No confetti, no slide-ins. A color shift and a glow. The kind of thing that makes you go "wait, something changed" and then you read it and understand.

**Implementation for O'Brien:** On each poll cycle (every 5s), compare the current `active.stage` with the previous one. If it changed to `IN_PROGRESS`, add a CSS class `transitioning` to the active commission element. The class triggers the `border-flash` keyframe animation (1s ease-out). Remove the class after the animation completes.

---

## 4. Idle / Waiting State

**Note:** Sisko's original brief said "show the last completed commission in the active zone so the board is never empty." This has been revised after stakeholder review — showing a DONE commission in the "Active Commission" zone is confusing. The active zone implies something is happening right now. Showing a completed commission there is misleading.

**Revised design:** When nothing is in flight, the active commission zone goes honestly idle.

### What the dashboard shows when idle

1. **Active commission zone:** Replaced with a single message: "Nothing in progress" + hint: "Waiting for the next bet. O'Brien will write the first commission when work resumes." Zone has default border, no glow, reduced opacity. Clearly different from the live in-progress state.

2. **Queue panel:** "No commissions in queue." No hint text needed — the idle message above explains the state.

3. **Recent completions:** Still shows history if any exists. History in the recent panel is not confusing — it's clearly labelled as past work.

4. **Role status:** O'Brien disconnected, O'Brien idle. Honest.

5. **Health pill:** ONLINE — the relay is running, even if no work is happening.

**What this communicates to a stranger:** The system is alive (relay online), but no bet is currently running. Everything is waiting. This is an honest, readable state that doesn't pretend work is happening when it isn't.

**Implication for Dax's demo commission approach:** The `relay/demo/` demo commission is no longer needed for the active zone. It can optionally appear in Recent Completions as a seed entry to show a stranger what a completed commission looks like — but that is O'Brien's implementation call, not a design requirement.

---

## 5. The Five Elements — Implementation Reference

### Element 1: Role Status Panel

**Layout:** 4-column grid, equal width. Each card: role name (bold), function (secondary text), status indicator (dot + label).

**Status states per role:**

| Role | Possible states | How derived |
|---|---|---|
| O'Brien | `connected` / `disconnected` | `obrien-heartbeat.json` freshness < 5min |
| O'Brien | `active` / `idle` / `error` / `available` | Watcher's own state (commission in flight? last error?) |
| Nog | `coming soon` (fixed) | Hardcoded |
| Bashir | `coming soon` (fixed) | Hardcoded |

**Visual:** Connected = green dot + green text. Disconnected/idle = gray dot + gray text. Active = green dot + green text. Error = red dot + red text. Coming soon = gray dot + italic gray text, card at 45% opacity with dashed border.

### Element 2: Active Commission (hero)

**Data from API:** `active.id`, `active.title`, `active.stage`, `active.owner`, `active.elapsed_seconds`

**Stage badge colors:**
- PENDING → yellow background, yellow text
- IN_PROGRESS → teal background, teal text, pulse animation
- DONE → green background, green text (fallback when showing last completed)

**Elapsed time format:** `Xm Ys` (e.g., "2m 22s"). Update on each poll. If > 1 hour: `Xh Ym`.

**When nothing is active AND nothing completed:** Show the demo commission. This case should only occur on first run before any real work happens.

### Element 3: Queue

**Data from API:** `queue[]` array. Each item: `id`, `title`, `state`.

**Sort:** By commission ID ascending (oldest first — FIFO).

**Empty state:** Centered text: "No commissions in queue" + hint.

### Element 4: Recent Completions

**Data from API:** `recent[]` array. Last 5 items. Each: `id`, `title`, `outcome`, `duration_seconds`.

**Duration format:** Same as elapsed. `Xm Ys`.

**Outcome badge:** DONE = green. ERROR = red. STUCK = red.

**Sort:** Most recent first.

### Element 5: System Health

**Location:** Header, top-right. A single pill.

**States:**
- `ONLINE` — green, pulsing dot. Heartbeat < 60s.
- `DEGRADED` — yellow, static dot. Heartbeat 60–300s.
- `OFFLINE` — red, static dot. Heartbeat > 300s or missing.

---

## 6. Responsive Behavior

The wireframe includes CSS breakpoints. Summary:

| Breakpoint | Layout change |
|---|---|
| > 768px | 4-col roles, 2-col bottom grid (full layout) |
| 481–768px | 2-col roles, 1-col bottom grid (queue above recent) |
| ≤ 480px | 1-col everything, tighter padding |

**Mobile is not a priority target** — this is a local dev tool opened on a laptop. But the layout shouldn't break if someone checks it on their phone. These breakpoints handle that gracefully.

O'Brien's call on any responsive edge cases not covered here.

---

## 7. What This Spec Does NOT Cover

- **API implementation** — that's Dax's architecture doc, Section 4.5
- **Relay server code** — that's B1 (server slice), separate from dashboard
- **README content** — that's B3 (integration slice)
- **O'Brien heartbeat convention** — O'Brien needs to know to write `obrien-heartbeat.json`; that's a O'Brien onboarding update, not a dashboard design decision
- **LCARS ops dashboard (Bet 3)** — completely separate surface, deliberately different aesthetic

---

## 8. Slicing Guidance for O'Brien

Dax's architecture doc (Section 10) proposes four slices. The dashboard is **B2** in that sequence. From a design perspective, the dashboard slice can be broken down further if needed:

**Minimum viable dashboard (one commission):**
1. Header + health pill
2. Active commission element (with transition animation)
3. Role status row (hardcoded states initially, wired to API later)

**Complete dashboard (second pass):**
4. Queue panel
5. Recent completions panel
6. Empty state / demo mode
7. Responsive breakpoints

The hero element (#2) is the most important thing to get right. If O'Brien ships only the active commission element with the transition animation, the dashboard already communicates the product. Queue and recent are supporting context.

---

## 9. Deliverables Checklist (per Sisko's handoff)

| Deliverable | Where in this spec |
|---|---|
| Layout | Section 1 + wireframe |
| Visual direction | Section 2 (palette, type, rules) |
| The "aha" moment | Section 3 (transition design + implementation notes) |
| Empty state | Section 4 |
| Responsive notes | Section 6 |

---

**Wireframe file:** `roles/ziyal/deliveries/bet2-dashboard-wireframe.html`
**Open in browser, use bottom-right controls to preview all states.**

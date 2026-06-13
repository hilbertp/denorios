# Dax Landing Page Design Brief

**From:** Sisko (Product Manager)
**To:** Ziyal (Product Designer)
**Date:** 2026-04-08
**Scope:** Bet 1 — Open-source landing page (paused)

---

## What this is

Design brief for the Dax open-source landing page. Your job: design the page concept and wireframes. Leeta builds it in Lovable afterward. You don't need to worry about hosting, repo setup, or SSR — that's Dax and Leeta's problem.

---

## The bet we're running

**Hypothesis:** Developers building with AI tools will care about a framework that orchestrates AI roles like a real software team.

**Success metric:** 5 contributions from 5 different people on GitHub.

**If it fails:** That's information. Philipp keeps building for himself regardless — this is his own dev toolchain. The landing page is a discovery experiment, not a product launch.

---

## The message in 30 seconds

Most AI coding tools help you build faster. Dax helps you figure out what's worth building in the first place — then builds it with a coordinated team, not a solo agent.

---

## Core insight the page must land

Successful product work isn't about creating a roadmap to a vision and sticking to it. It's about betting and discovery — running cheap experiments on the hardest risks, killing what doesn't work, doubling down on what does.

Dax gives you a team that works this way:

- **Sisko** (PM) discovers what to build through bets, not roadmaps
- **Ziyal** (UX/UI) visualizes ideas so you can see them before you commit
- **Leeta** (Frontend) builds frontend prototypes fast to test with real users
- **O'Brien** (Backend) builds backend prototypes to prove feasibility
- **Dax** (Architect) keeps the architecture clean and right-sized for where you actually are
- **O'Brien** (Delivery) coordinates the whole thing — commissions, slices, handoffs

The full roster also includes Bashir (QA), Nog (Code Review), Worf (DevOps), and Odo (Security). Users can create their own roles and add skills to them.

---

## Tooling story

This is not a new IDE. Dax plugs into what already works:

- Leeta runs on **Lovable**
- O'Brien runs on **Claude Code CLI**
- Sisko, Ziyal, and O'Brien run on **Claude Cowork**
- The bridge layer connects them

You're orchestrating real tools through real roles, not replacing anything.

---

## Where it's going

Right now: a working prototype with roles coordinating through a file-based bridge. Where it's headed: a unified dashboard where you see your whole AI team at a glance — discovery, design, delivery, architecture, one view.

---

## Tone

**Developer-to-developer.** No marketing fluff. Write like a good README talks — direct, opinionated, a little irreverent. If someone reads it and thinks "these people actually build software," we've nailed it.

Use language that shows we get devs and devs get us. Think Hacker News, not Product Hunt.

---

## Page structure (7 sections)

### 1. Hero
One-liner + subtext + CTA (GitHub repo link). The one-liner should make a dev stop scrolling. The CTA is "View on GitHub" — nothing else.

### 2. The problem
Why single-agent AI tools hit a ceiling. You've got Claude, Cursor, Copilot — but they're all solo acts. No coordination, no memory between them, no one watching architecture while someone else ships features. You're the glue, and it doesn't scale.

### 3. What Dax is
The role-based framework, one paragraph. An open-source system for orchestrating AI roles the way real software teams work. Each role has its own context, responsibilities, decision rights, and memory. They talk to each other through a structured bridge, not ad-hoc prompting.

### 4. How it works
The O'Brien/O'Brien delivery loop as the concrete example. A commission goes in, work gets sliced, code gets written, delivery happens. This is the "I get it" moment — make it visual or animated if possible.

### 5. The role roster
What exists today, what's coming, and the fact that users can build their own roles. Show the DS9 team as a roster — role name, function, one line each. Distinguish between core roles (shipping now) and planned roles.

### 6. Get involved
Open source, permissive license, contributions welcome. Link to GitHub, link to "good first issue" tags, link to the Medium article for the backstory. Keep the bar low — "use it, fork it, contribute, whatever."

### 7. Footer
GitHub, Medium article, license. Minimal.

---

## What to read before starting

- `PROJECT-VISION.md` in the project root — the full vision for Dax, what the prototype proved, where the product is going, and the design principles

---

## What NOT to worry about

- Hosting, deployment, SEO — Dax and Leeta handle that
- The LCARS design language from the dashboard — this is a public-facing landing page, not the internal ops dashboard. Design for a developer audience, not the DS9 aesthetic
- Mobile-first vs desktop — use your judgment, but most devs will hit this from a desktop or laptop
- Copy perfection — you'll write the structural copy, Sisko can review tone before Leeta builds

---

## Deliverable

A wireframe or mockup (whatever fidelity answers the design questions) that Leeta can build from in Lovable. Include section layout, content hierarchy, and enough visual direction that the result looks intentional, not templated.

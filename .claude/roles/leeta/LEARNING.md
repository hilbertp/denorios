# Leeta — Accumulated Learning

*Cross-project behavioral patterns. Read this alongside ROLE.md at the start of every session.*
*Updated: 2026-04-08*

---

## How to use this file

This file contains things learned through corrections, confirmations, and observed patterns across all projects. Unlike ROLE.md (which defines what Leeta is), this file captures how Leeta should behave based on real experience. A fresh Leeta session on any project should read ROLE.md first (for identity and decision rights) then this file (for behavioral calibration).

---

## Lovable platform constraints

### Learning 1: Repo flow is one-directional
Lovable cannot connect to existing GitHub repos. It must create its own repo via its GitHub integration. You fully own the created repo, but other roles (O'Brien, Dax, O'Brien) connect to it after Lovable creates it. The reverse — pointing Lovable at an existing repo — is not supported.

### Learning 2: Lovable serves pure CSR React
Lovable hosts your site as a pure client-side rendered (CSR) React app. The server sends essentially empty HTML — just a `<div id="root"></div>` — and JavaScript builds the page in the browser. This is fine for human visitors but hostile to crawlers. Google's crawler sees empty HTML on first pass and renders JavaScript days or weeks later on a low-priority queue.

### Learning 3: No control over build or deployment pipeline
Lovable gives you no way to run a build step, add server-side rendering, or inject prerendered HTML into the output. You're locked into whatever Lovable serves, which is always the empty-shell CSR approach.

### Learning 4: Workaround — host on Cloudflare Pages
Move hosting to Cloudflare Pages, which builds directly from the GitHub repo Lovable created. This gives full control over the build pipeline. Cloudflare serves the same React app but from infrastructure we control. For any SEO-sensitive page, plan for Cloudflare Pages hosting from the start — don't rely on Lovable's hosting.

### Learning 5: Prerendering currently blocked
Prerendering (baking fully-rendered HTML into each page at build time so crawlers see real content immediately) was attempted but blocked by a Chromium download hanging in Cloudflare's build environment. Stripped out for now. Google has already indexed pages fine without it — JS rendering caught up. Prerendering can be revisited later if rankings need a boost.

---

## Workflow implications

- When starting a new frontend project, Leeta creates the repo in Lovable. Other roles clone from there.
- Always assume Cloudflare Pages will serve the production site. Build with that in mind.
- Content that needs to be crawler-visible should be real DOM content, not dynamically loaded post-render.

# Debrief — Liberation of Bajor

*Staging area for lessons learned. O'Brien appends items during development. Sisko and O'Brien triage them together in a debrief conversation.*

*Last updated: 2026-04-06*

---

## How this works

During development, O'Brien captures observations here — friction, patterns, things that worked, things that broke, process gaps. Each item is raw and untriaged.

In a debrief conversation, Sisko and O'Brien go through each item and decide where it belongs:

| Destination | What goes there | Example |
|---|---|---|
| **LEARNING.md** | Cross-project behavioral patterns | "Always remind to restart watcher after code merges" |
| **ROLE.md** | Role definition changes | "O'Brien should own debrief staging" |
| **Skill** | New or modified skill for O'Brien | "A commission-writing skill with built-in template" |
| **Project-only** | Stays in OBRIEN.md project status or here | "The watcher timeout for this project is 15min" |
| **Discard** | Not worth keeping | One-off issue, already resolved |

After triage, items move to their destination and get removed from this file.

---

## Untriaged items

### 1. Watcher runs stale code after merges
**Observed:** Commissions 005 and 006 updated `watcher.js` but the running watcher kept showing raw JSON because it loaded code at startup. Sisko saw no improvement and was frustrated. Had to restart the watcher manually.
**Pattern:** Code changes to the watcher don't take effect until restart. This will happen every time the watcher is improved.
**Possible action:** Always include "restart the watcher" in any commission that touches `watcher.js`. Or: build hot-reload (watch own file for changes). Or: just make this a standing reminder in LEARNING.md.

### 2. Branch merges piled up
**Observed:** By the time we realized, `slice/1-contracts`, `slice/2-production-watcher`, `slice/3-maras-half`, `fix/readable-stdout`, and `fix/readable-stdout-v2` were all unmerged. The watcher was running from `main` which was several slices behind.
**Pattern:** Accepting a slice and merging it are two separate steps. Without a "merge after accept" rule, branches accumulate.
**Possible action:** Add to O'Brien's workflow: "After accepting a slice, immediately commission or perform the merge to main before commissioning the next slice."

### 3. Queue files weren't committed initially
**Observed:** O'Brien completed commission 002 and 003 but didn't `git add` the queue files. They were untracked. Dax's decision was "queue in git for audit trail" but the commission template didn't enforce it.
**Pattern:** If a step isn't in the commission, O'Brien won't do it.
**Possible action:** Already added to commission template ("commit queue files as last step"). Verify this sticks.

### 4. VS Code extension ignores bypassPermissions
**Observed:** `bypassPermissions` in `.claude/settings.json` only works for `claude -p` CLI invocations. The VS Code extension has its own approval layer that still shows prompts. This caused significant frustration across multiple relay attempts.
**Pattern:** Interactive VS Code sessions are unsuitable for unattended work. The CLI path is the only reliable unattended path.
**Possible action:** Document this as a hard constraint. Consider investigating VS Code extension settings separately.

### 5. Human-readable output was an afterthought
**Observed:** Watcher stdout was raw JSON for three commissions (003, 004, 005). It took two additional commissions (005, 006) to make it stakeholder-friendly. Sisko's reaction to the JSON output: "this is not human friendly, fix it, make it useful for stakeholders."
**Pattern:** Developer-facing output defaults aren't stakeholder-friendly. Any artifact Sisko sees directly should be designed for readability from the start.
**Possible action:** Add to LEARNING.md: "Any output Sisko will see must be human-readable as a first-class requirement, not a post-hoc fix."

### 6. Commission re-executed on watcher start
**Observed:** `003-PENDING.md` was still in the queue (from the manual relay era) when the watcher started. The watcher correctly picked it up and re-executed commission 003. The commission was idempotent so no harm done, but it was unexpected.
**Pattern:** Starting the watcher with stale PENDING files in the queue triggers re-execution. This is correct behavior but surprising if the commission was already handled out-of-band.
**Possible action:** Either clean up the queue before starting the watcher, or accept this as expected behavior and ensure all commissions are idempotent.

### 7. OBRIEN.md had no project status initially
**Observed:** Slice 3 created OBRIEN.md with operational workflows (how to commission, poll, evaluate) but no "where things stand" section. A fresh O'Brien session would know HOW to work but not WHAT had already been done.
**Pattern:** Operational docs and state tracking are different concerns. Both are needed for session continuity.
**Possible action:** Already fixed (added sections K and L to OBRIEN.md). Ensure project status is part of the initial OBRIEN.md template for future projects.

### 8. Memory system designed incrementally, not upfront
**Observed:** Started with auto-memory (session-scoped), then added LEARNING.md (cross-project), then project status in OBRIEN.md (project-scoped), then this debrief file (staging). Each layer emerged when the gap became painful.
**Pattern:** Memory architecture should be designed upfront when establishing a new role system. The three layers (project state, cross-project learning, debrief staging) are predictable needs.
**Possible action:** For future projects using this role system, create all three memory layers from the start as part of Layer 0.

### 9. First fully automated commission was a milestone
**Observed:** Commission 004 was picked up by the watcher, executed by O'Brien via `claude -p`, and the DONE report appeared in the queue — all without Sisko touching anything. Duration: 134 seconds. This was the moment the bridge worked end-to-end.
**Pattern:** Celebrate milestones. This validated the entire architecture.
**Possible action:** Note in project history. Consider a "milestones" section in OBRIEN.md.

### 10. Repo move broke O'Brien's context
**Observed:** Moving "The Liberation of Bajor" from `/Users/phillyvanilly/The Liberation of Bajor/` into `/Users/phillyvanilly/The Spiderverse/Hormuz/The Liberation of Bajor/` caused path mismatches. O'Brien's CLAUDE.md had the old path. Required a manual re-orientation session.
**Pattern:** Moving repos mid-project is disruptive. Path assumptions are baked into multiple places (CLAUDE.md, commission content, watcher config).
**Possible action:** Avoid moving repos. If unavoidable, commission a path-update sweep as the first action afterward.

### 11. O'Brien's role is not project-specific
**Observed:** Sisko clarified that O'Brien is a general delivery coordinator role, not exclusive to Liberation of Bajor. Cross-project learning should follow O'Brien everywhere. Project-specific state stays with the project.
**Pattern:** Role definitions should be portable. Project state should be local.
**Possible action:** Already implemented with the two-layer memory system. Ensure the role directory structure supports multiple projects.

### 13. Team should proactively discover skills
**Observed:** Sisko suggested that O'Brien (and other team members) should be able to browse skills.sh to find skills that improve the team's capabilities. This isn't just about O'Brien — O'Brien could benefit from implementation skills, Dax from architecture skills.
**Pattern:** Skill discovery should be a shared team capability, not limited to one role. The ecosystem is large (thousands of skills) and growing. Manual browsing is slow.
**Possible action:** Created `skill-browser` skill in `.claude/skills/`. Consider making it a standing part of project kickoff: "what skills exist for this domain?"

### 14. Token tracking needs phase-level granularity
**Observed:** Sisko wants to track and visualize cost not just per commission but per phase: planning (O'Brien/Cowork), execution (slice work), review & correction (fixes, amendments), housekeeping (merges). He also wants per-slice aggregation (all commissions belonging to one slice grouped) and per-larger-grouping (e.g. all of Layer 3).
**Why this matters:** Claude is expensive compared to alternatives. Visibility into where tokens burn helps optimize — are corrections eating the budget? Are merges surprisingly costly? Is planning cheap or expensive?
**Possible action:** (a) Add a `type` field to commission frontmatter (`execution`, `fix`, `housekeeping`) so the watcher can categorize automatically. (b) Use the `references` field to group commissions into slices. (c) Track O'Brien's planning costs separately (Cowork session tokens aren't visible to the watcher — needs a different mechanism). (d) Build a cost history file (`bridge/cost-history.json`) that accumulates across watcher sessions. (e) Eventually visualize trends over time.

### 16. Project economics tracking — ROI proof for customers
**Observed:** Sisko bills €100/hr to customers. He needs to track: (a) his own hours invested, (b) Claude token costs, (c) estimated human-equivalent hours for O'Brien and O'Brien roles if they were human staff. The comparison demonstrates speed and cost efficiency — a human PM + senior dev would have taken X hours at Y cost; the AI-augmented team did it in a fraction.
**Data needed per slice:**
- Sisko's hours (manual log)
- O'Brien wall-clock time (watcher already tracks this)
- O'Brien human-equivalent estimate (filled at review time — "a senior dev would take ~4h")
- O'Brien human-equivalent estimate (same — "a PM would spend ~2h on this coordination")
- Claude token cost (from watcher, split by phase: execution, correction, housekeeping)
**Possible action:** Create `bridge/economics.json` as the accumulator. Add a `human_equivalent_hours` field to the report evaluation step. Build a time-logging helper for Sisko. Render a summary table per slice and per project. This becomes a key deliverable for customer-facing proposals.

### 15. Web dashboard may be needed if terminal output hits its limit
**Observed:** Sisko said "if we fail, we're gonna have to build an actual dashboard." The terminal is the current visualization layer. If the information density exceeds what a scrolling terminal can convey (especially historical trends, cost charts, slice comparisons), a lightweight HTML dashboard is the natural next step.
**Possible action:** The data layer being built now (token tracking, queue snapshots, session state) is dashboard-ready. A future commission could render `bridge/cost-history.json` as a self-contained HTML file that opens in a browser. No server needed — just a static file that reads the JSON.

### 17. Timeout is a blunt instrument — activity monitoring is smarter
**Observed:** Sisko questioned why a 15min kill switch is the right tool. The timeout doesn't distinguish "O'Brien is actively writing files" from "O'Brien is frozen." It kills either way.
**Better approach:** Monitor O'Brien's file activity (fs.watch on the project directory, or poll mtimes). Show a status light: green = active (file change in last 60s), yellow = possibly stalled (no change for 5min), red = frozen (no change for 10min). Keep the timeout as a last-resort dead-man's switch at a much higher value (30–60min). The status light is the real operational signal; the timeout is the safety net.
**Possible action:** Add activity monitoring to the watcher. Show status in both terminal and dashboard. Make the timeout value less prominent — it's infrastructure, not the user-facing signal.

### 18. QA phase needed — O'Brien verified 0 of 6 feature commissions independently
**Observed:** Retrospective showed O'Brien accepted every feature commission based solely on O'Brien's self-assessment. No independent testing, no live verification, no cross-referencing against specs. Bugs were caught by Sisko, not O'Brien.
**Action:** Create a QA role that sits between O'Brien's DONE report and O'Brien's acceptance. The QA role runs actual acceptance tests against the commission's success criteria and produces evidence-based pass/fail reports.

### 12. Communication protocol evolved through corrections
**Observed:** Sisko corrected multiple communication issues: "say who you are to O'Brien", "be concise outside code blocks", "don't explain what's in the document after sharing it." Each correction became a LEARNING.md entry.
**Pattern:** Behavioral calibration happens through corrections, not upfront specification. The debrief process should capture confirmations too (not just failures).
**Possible action:** This debrief mechanism. Also: explicitly note when a non-obvious approach is confirmed ("yes, that was the right call").

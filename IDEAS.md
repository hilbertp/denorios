# Ideas Backlog

*Future feature ideas captured by all DS9 roles. Everyone contributes — append only.*
*Sisko owns this file. Only Sisko promotes ideas into packaged bets. Other roles capture; Sisko triages and sequences.*
*Do not delete entries. Do not assign priority. Just capture and move on.*

---

### Stakeholder commission presentation — approve before it hits the queue

- **Source:** Philipp (2026-04-10)
- **Date:** 2026-04-10
- **Idea:** Before a commission enters the queue, O'Brien presents it to Philipp in a stakeholder-friendly format: plain-English title, two-sentence summary of what and why, then the full technical detail collapsed below. Philipp clicks Commission (goes to queue), Amend (O'Brien rewrites based on Philipp's note and restages), or Reject (moves to trash). Currently being built as commission 042 (staging gate). The presentation format itself — clear hierarchy of summary → detail, decision buttons — should be a first-class feature of the dashboard, not an afterthought.
- **Why it matters:** Philipp is the only human in the loop. If a bad commission gets queued and the watcher is on, it executes immediately. The gate + presentation layer is the safety mechanism between O'Brien's judgment and Miles' execution.

### Quark: Automated economics and efficiency tracker

- **Source:** Sisko (during Dax architecture session, discussing timesheet automation gaps)
- **Date:** 2026-04-08
- **Idea:** A dedicated Quark role that watches the repo, tracks every role's time and token cost, computes efficiency metrics, summarizes activity across roles, and devises its own improvement ideas based on the data.
- **Why it matters:** Time tracking is currently manual and per-role. Quark would give the team automated visibility into project economics and surface optimization opportunities no single role would notice.

### Team chat room for multi-role alignment

- **Source:** Sisko (noted in TEAM-STANDARDS.md handoff protocol as a future need)
- **Date:** 2026-04-08
- **Idea:** A shared communication channel where multiple roles (e.g. Dax, Ziyal, Sisko) can align in a single conversation instead of bouncing handoff artifacts back and forth between role folders.
- **Why it matters:** Current role-to-role handoffs work for bilateral exchanges but are clumsy for three-way alignment discussions. A chat room reduces coordination overhead.

### Idea-capture reliability tracking

- **Source:** Sisko (after reviewing idea-capture skill eval results)
- **Date:** 2026-04-08
- **Idea:** Build a mechanism to evaluate whether the idea-capture skill is actually firing reliably across roles and sessions. Could be a periodic audit that diffs IDEAS.md against conversation transcripts to find missed ideas, or a simple counter/log that records every time the skill triggered vs. should have triggered.
- **Why it matters:** The skill is behavioural — it depends on each role noticing and acting. Without a feedback loop we won't know if ideas are slipping through until someone notices a gap months later.

### Relay-invoked evaluation loop

- **Source:** Dax (Bet 2 architecture, Section 7.5) — deferred from Bet 2 scope by Sisko
- **Date:** 2026-04-08
- **Idea:** The relay automatically evaluates O'Brien's DONE reports against acceptance criteria via `claude -p`, then writes ACCEPTED or a new amendment PENDING commission. Full autonomous loop without Cowork cron or notification spam. Includes a hard cap at 5 failed amendment cycles (maxAmendments), after which the evaluator writes STUCK to the register and Philipp intervenes.
- **Why it matters:** Closes the delivery loop without human involvement. Currently, evaluation requires O'Brien in Cowork. This moves evaluation into the relay infrastructure where it's cheaper and always-on.
- **Status: IMPLEMENTED in Bet 2** — commission 026, on main. Evaluator is currently Anon (stateless placeholder).

### O'Brien on-demand pipeline status reading

- **Source:** Dax (Bet 2 architecture, Slice B4) — deferred from Bet 2 scope by Sisko
- **Date:** 2026-04-08
- **Idea:** O'Brien in Cowork can read register.jsonl and pipeline status on demand — "what happened to slice X?" works without polling or cron.
- **Why it matters:** Gives Philipp a conversational interface to pipeline status through O'Brien, rather than opening the dashboard or reading files manually.

### Repo skill pool with setup/install script

- **Source:** Sisko (during handoff skill migration discussion, 2026-04-08)
- **Date:** 2026-04-08
- **Idea:** Keep team skills in the repo as the canonical source, then have a setup/install script that migrates them to `mnt/.claude/skills/` at project start so they're discoverable in Cowork. Script runs once per machine and on every project switch.
- **Why it matters:** Skills in the repo travel with git but aren't discoverable via `/` in Cowork. A setup script bridges the gap without requiring manual copying. — **Note:** Likely superseded by packaging skills as a persistent Cowork plugin (see: "Package DS9 team skills as Cowork plugin"). Kept for reference.

### Package DS9 team skills as a persistent Cowork plugin

- **Source:** Sisko (2026-04-08, observing that mara and skill-creator survive project switches, proving plugin persistence)
- **Date:** 2026-04-08
- **Idea:** Use `cowork-plugin-management:create-cowork-plugin` to package the full DS9 skill set (handoff, estimate-hours, idea-capture, debrief, check-handoffs) as a single installable Cowork plugin. Once installed, skills persist across project switches and are discoverable via `/` — identical behaviour to mara and skill-creator today.
- **Why it matters:** Solves the discoverability problem permanently without a setup script. Skills live in the plugin layer, not the repo, and any new DS9 project gets them immediately after plugin install.

### UX question for Dax: commission relay vs. review — one service or two?

- **Source:** Ziyal (Bet 2 dashboard design session, 2026-04-08)
- **Date:** 2026-04-08
- **Idea/Question:** The dashboard currently surfaces one service: the watcher (renamed "commission relay" — picks up files from `bridge/queue/` and invokes O'Brien). The evaluator (reads DONE reports, decides accepted or amendment) is a separate process. Should the dashboard expose both independently with separate health indicators? Or treat the full pipeline (relay + evaluation) as one "pipeline" service with a single status? This is a UX-and-architecture question. Ziyal has described the target UX; Dax needs to confirm whether the evaluator is monitorable as a distinct service, and what its failure modes look like vs. the watcher's.
- **Why it matters:** If they're two separate things that can fail independently, the dashboard should say so. If they always fail together, one status pill is cleaner.

### Design system tokens as a shared contract

- **Source:** Ziyal (Bet 2 dashboard design session, 2026-04-08)
- **Date:** 2026-04-08
- **Idea:** Extract the CSS custom properties (design tokens) from the Bet 2 dashboard wireframe into a standalone `tokens.css` or `tokens.json` file that both the Bet 2 dashboard and the future Bet 3 React dashboard can import. This creates a shared visual language across surfaces without coupling implementations.
- **Why it matters:** Right now the Bet 2 dashboard is a disposable prototype, but the palette and spacing decisions carry forward. If Bet 3 starts from scratch it'll reinvent these choices. A tokens file is cheap insurance — Ziyal owns it, O'Brien/Leeta consume it.

### Worf role — tech lead, devops, CI/CD, rollout/rollback

- **Source:** Philipp + O'Brien (2026-04-10, Bet 2 session)
- **Date:** 2026-04-10
- **Idea:** A Worf role that owns: tech lead decisions per slice, CI/CD pipeline, rollout/rollback strategy, branch compliance enforcement, and the devops layer currently handled informally by O'Brien. O'Brien currently does a secondary devops check (branch hygiene, unmerged detection) as a stopgap until Worf exists.
- **Why it matters:** Devops responsibility is currently split — O'Brien checks compliance, Anon enforces ACs, nobody owns the pipeline. Worf consolidates this cleanly. Frees O'Brien to focus on delivery coordination.

### Nog role — code reviewer (replaces Anon)

- **Source:** Philipp + O'Brien (2026-04-10, Bet 2 session)
- **Date:** 2026-04-10
- **Idea:** Nog as a proper code reviewer, replacing the Anon stateless evaluator. Nog would bring role identity, ROLE.md, and richer code review beyond AC checking. Cost and quality vs. Anon TBD — needs measurement before committing.
- **Why it matters:** Anon is a placeholder persona. The evaluator function (AC checking + code review) is closer to Nog's domain. Once token cost data exists (Bet 3), the comparison is straightforward.

### Bashir role — QA

- **Source:** Philipp + O'Brien (2026-04-10, Bet 2 session)
- **Date:** 2026-04-10
- **Idea:** Julian Bashir as a QA role. Writes test plans, validates outputs beyond AC compliance, owns quality assurance as a distinct function from code review.
- **Why it matters:** Anon checks ACs but doesn't own a test strategy. Bashir would pair with Nog — Bashir defines what "correct" looks like holistically, Nog checks the code, Anon (or Nog) enforces it per commission.

### Token cost measurement infrastructure — Bet 3 requirement

- **Source:** Philipp (2026-04-10)
- **Date:** 2026-04-10
- **Idea:** Build token count and USD cost tracking into Bet 3 from day one. Track cost per commission, cost per amendment cycle, cost per accepted slice, cost per role. Current register.jsonl has tokensIn/tokensOut fields but they're null — these need to be populated.
- **Why it matters:** Without measurement there's no basis for model routing decisions, no way to compare Claude vs. GPT vs. other models, no way to evaluate tools like Ruflo. This is the prerequisite for all cost optimization work.

### Model routing — cheap models for easy tasks, expensive for hard

- **Source:** Philipp + O'Brien (2026-04-10, discussion on Claude vs. GPT cost)
- **Date:** 2026-04-10
- **Idea:** Route commission execution to cheaper models (GPT-4o or equivalent) for well-specified, low-complexity slices. Reserve expensive models (Claude Sonnet/Opus) for architecture, ambiguous commissions, and high-stakes evaluations. Open design question: who classifies a commission as "easy" — O'Brien at write time? Dax? An automated pre-router?
- **Why it matters:** Claude is significantly more expensive than GPT equivalents. If output quality is comparable on simple tasks, routing saves substantial cost at scale. Risk: amendment cycles on cheaper-model failures may eat the savings — needs measurement to confirm.

### Ruflo — evaluate as infrastructure layer or adopt for Bet 3+

- **Source:** Philipp (2026-04-10)
- **Date:** 2026-04-10
- **Idea:** Ruflo is a ~5-week-old open source framework built on Dax-like patterns. Heavily praised on GitHub and Instagram, significant community attention. Key capabilities that overlap with and exceed our current architecture: smart model routing (cheapest model that meets quality threshold), 100+ specialized agents, coordinated swarms (hierarchical queen/worker + mesh peer-to-peer), workflow learning (successful patterns stored and reused), MCP/Claude Code native integration, production-ready security (prompt injection, path traversal, credential handling), IPFS plugin marketplace.
- **Strategic question:** Do we keep building Liberation of Bajor's infrastructure from scratch, or evaluate Ruflo as the execution layer? The file-based queue/register/commission model is our deliberate design choice — does Ruflo preserve it or replace it? "Massive promises on a 5-week-old framework" is a caution flag; community attention ≠ production stable.
- **Decision: Bet 3 runs through Ruflo.** Not a comparison — Philipp is doing Bet 3 with Ruflo to feel it directly.
- **The real risk is not maturity — it's opacity.** Liberation of Bajor is built on files as source of truth: queue, register, heartbeat are all human-readable. Ruflo's swarm coordination (agents spawning sub-workers, internal routing, automatic communication) may be a black box. If you can't see what happened and why, that's the tradeoff, not the framework age.
- **On Nog specifically:** Whether Nog is stateless (Anon-style AC checker) or repo-aware (anti-pattern, style, architecture reviewer) is an architectural question Worf should answer once onboarded. Ruflo's 100+ agents may already have a Nog equivalent worth examining.

### ACCEPTED status as merge signal (stateful O'Brien)

- **Source:** Philipp (2026-04-10, questioning why merges need to be commissioned)
- **Date:** 2026-04-10
- **Idea:** O'Brien should see that his commission's status changed to ACCEPTED and know to merge without being given a separate commission. This requires O'Brien to have some persistent awareness of queue state — not current architecture (each invocation is a fresh `claude -p` session with no persistent state). Explore when/if O'Brien gets persistent context.
- **Why it matters:** The current merge-on-accept approach (O'Brien calls git merge directly via watcher.js) works but bypasses O'Brien entirely. The natural flow is: O'Brien delivers work → gets accepted → merges. If O'Brien could watch his own queue state, the system would be more coherent.

### Dev lead role (lightweight briefing between Dax and O'Brien)

- **Source:** O'Brien (2026-04-10, discussion on commission context enrichment)
- **Date:** 2026-04-10
- **Idea:** A lightweight dev lead role that owns the codebase mental model across slices within a bet, writes the technical brief for O'Brien per commission (key files, relevant conventions, prior decisions), and keeps that context alive without burdening O'Brien's window. Not Dax (who does architecture, not per-slice briefing). Could be Worf.
- **Why it matters:** Currently O'Brien re-discovers the codebase from scratch each commission. O'Brien can't enrich commissions without blowing up her own context window. A dev lead closes the gap cheaply.

### Brand voice role (Vic)

- **Source:** Sisko (during Bet 2 scoping, noting Ziyal's landing page brief references Vic for brand system)
- **Date:** 2026-04-08
- **Idea:** A dedicated Vic role that owns brand voice, visual identity, and tone guidelines across all public-facing surfaces. Ziyal's landing page handoff to Leeta references Vic as the owner of "a full brand system" — currently no one fills this role.
- **Why it matters:** Without brand voice guidelines, every public surface (dashboard, landing page, README) makes independent aesthetic decisions. A Vic role ensures coherence as the number of surfaces grows.

### Slicelog dashboard — per-commission economics visualization

- **Source:** O'Brien (reviewing Dax's BET3-PER-SLICE-TRACKING ADR, 2026-04-12)
- **Date:** 2026-04-12
- **Idea:** Visualize watcher entries in `bridge/timesheet.jsonl` (formerly `slicelog.jsonl`) in the Ops Center dashboard — token cost per commission, human hours estimates, amendment cycle counts, compaction flags, and efficiency trends over time. Dax's ADR explicitly deferred this. The data schema is now live and accumulating in the unified timesheet.
- **Why it matters:** The tracking infrastructure exists but the data is invisible unless someone runs `jq` by hand. A dashboard panel turns raw economics into a live signal Philipp can watch to understand where cost and effort are concentrated.

## CHECK overlay: "Apply Julian's draft" / "Author the guard" actions

- **Source:** Bashir (from Philipp's 2026-09-01 ruling — the overlay's only lever was "No test needed for this AC", which he refused to click against a real coverage need)
- **Date:** 2026-09-01
- **Idea:** For a genuinely-unguarded AC flagged in the stage-① overlay, add the missing affirmative actions: "Apply Julian's draft" (move the linked `regression/.drafts/<tag>` proposal into the suite, run it, rebuild COVERAGE.lock, re-check) and "Author the guard" (dispatch the auto-author for that tag first). Commissioning handoff with pipeline context: `.claude/roles/obrien/inbox/HANDOFF-BRANCH-GATE-AND-CHECK-OVERLAY-FROM-BASHIR.md`.
- **Why it matters:** The overlay currently offers only the escape hatch, so an honest operator with a missing test has no path forward — the exact dead end Philipp hit. The affirmative path turns the Test-Update Gate's flags into one-click fixes instead of judgment traps.

## Make Julian's test-update work visible in Ops (+ real merge lock)

- **Source:** Philipp (2026-09-01, reviewing the merge and the test-update flow)
- **Date:** 2026-09-01
- **Idea:** Show Julian's test updating as a visible step in Ops — the user should see "Julian is updating the tests for slices X/Y" happen, and get a clear success-or-failure prompt when it finishes. Related ruling direction: the slice → review → history/dev → test-update → merge journey should stay sequential and visible; work happening in parallel and invisibly in the GUI is a problem. Also: after a merge, rows for merged slices should immediately show as merged (the stale-refresh window read as "commits popping up on a new branch").
- **Why it matters:** Trust in the pipeline comes from watching it. Today Julian's step is invisible, the merge lock is only a warning, and a stale panel right after merging looks like unexplained new commits — all three erode confidence in an otherwise correct process.

## Merge gate: detect renamed checks instead of red-flagging them

- **Source:** Bashir (from Philipp's review of the S353 merge warning screen, 2026-09-01)
- **Date:** 2026-09-01
- **Idea:** The gate recognises an untagged check by its exact title text, so *renaming* one reads as "removed" plus "added" — a RED FLAG on honest work. Pair a disappearing title with a near-identical appearing one and label it **renamed**, showing before → after together. Two further fixes on the same screen: describe each item in plain behaviour language rather than the raw test title (a non-author cannot judge "MAIN_PUSHED_TO_ORIGIN emitted with ahead_count=3"), and stop policing `test/`, which the gate never actually runs.
- **Why it matters:** This is the second false red flag in one day. A gate that cries wolf on renames trains the operator to tick the confirmation box reflexively — and then it gets ticked on the day a check is genuinely disabled. False positives don't just annoy; they destroy the gate's only real asset, which is being believed.

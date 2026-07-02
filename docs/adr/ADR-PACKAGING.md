# ADR — Packaging: Denorios as an installable framework

**Status:** Proposed — awaiting Philipp's ratification
**Author:** O'Brien, 2026-07-02
**Decides:** how this self-developing repo becomes an npm-installable framework that runs the same slice→review→gate→promote loop inside foreign host repos, and what sits above `main` so releases are deliberate while dev stays hourly-breakable
**Builds on:** ADR-GITHUB-CI-MERGE-MODEL.md (the promote gate this extends), ADR-ROLLBACK-MODEL.md
**Rulings already made by Philipp (2026-07-02), recorded here as fixed points:**
1. Distribution is an **npm package + CLI** (not a template repo — templates fork and rot; hosts must take gate fixes by bumping a dependency). The crew's conversational layer ships as the Claude Code plugin.
2. **DS9 names stay canonical** in code, events, env vars, and data contracts; hosts get the neutral job-title display skin (already mode-aware) as their default.
3. The framework **keeps developing in this repo** through the pilot; extraction to a clean repo is reconsidered only after v1 is proven.
4. **v1 ships the full loop only.** No supported gates-only or orchestrator-less mode. A host that disables parts of the loop is using their own engineering judgment and owns the consequences.
5. A **stable release tier above `main`** is required: `main` moves at minute/hour cadence and may break; the installable package must not.

---

## 1. Verdict

Three workstreams, in dependency order: (a) a **release tier** (`stable` branch + `vX.Y.Z` tags + operator-dispatched release workflow) so there is a "production" surface at all; (b) **package hygiene** (tarball whitelist, bin CLI, engines) so `npm pack` is safe and installable in shape; (c) the **config spine** (Phase 1 of the extraction plan) so the engine can point at a host repo instead of itself. (a) and (b) are staged as slices 351/352 now; (c) follows as its own slice series after this ADR is ratified.

## 2. The three-tier release model

| Tier | Moves | Gate | Consumer |
|---|---|---|---|
| `dev` | minutes | ci.yml advisory + per-slice review | the crew |
| `main` | when Philipp presses RUN GATE & MERGE | promote.yml, fail-closed | host zero (us, self-hosting) |
| `stable` | when Philipp presses RELEASE | release.yml re-runs the full gate on the candidate | npm / foreign hosts |

- `stable` only ever **fast-forwards to a `main` SHA chosen at release time** (ancestor-checked, same `merge-base --is-ancestor` discipline promote.yml uses). Never a merge commit, never history not already on main.
- Every stable advance is tagged `vX.Y.Z` and gets a GitHub release with a changelog. **npm publishes exclusively from the tag**; `latest` is always deliberate. A `next` dist-tag auto-publishing from main is possible later, not in v1.
- **Release criteria** (all three, then the button): the gate is green on the candidate SHA; the candidate has **soaked on main under self-hosting** (proposed default: 3 days without incident — we are host zero, so main soak is real production usage); a written changelog exists.
- **Mechanical constraint discovered in audit:** promote.yml pushes main with the default `GITHUB_TOKEN`, and GITHUB_TOKEN pushes do not trigger `push:`-based workflows. A release workflow therefore *cannot* hook `push: [main]` — it must be `workflow_dispatch`. This aligns with the design anyway: releasing, like promoting, is an operator act.
- `stable` gets branch protection mirroring main (linear history, no force-push, no deletion).

## 3. Package hygiene (blocking any publish)

- `npm pack` today would fall back to `.gitignore` and ship **216 git-tracked files under `bridge/trash/` containing personal absolute paths, `bridge/timesheet.jsonl`, `bridge/anchors*.jsonl`, and ~219 `.claude/` files (role memories, inboxes)**. A `files` whitelist in package.json is mandatory, plus a regression guard that asserts the dry-run manifest stays clean (slice 351).
- package.json stays `"private": true` until the first deliberate publish. First publish, the npm name claim, and the `NPM_TOKEN` secret are **Philipp-only** acts.
- The `claude` CLI + a `CLAUDE_CODE_OAUTH_TOKEN` (today provisioned via `repo/.env`, consumed by the launchd plist) become **documented host requirements** — the installer scaffolds the env file, the human supplies the token.
- **Security flag, separate from packaging:** the GitHub repo is public today, so the personal data above is already exposed on GitHub regardless of npm. Needs its own decision (§7.4).

## 4. Naming and numbering

- Package/product name: **denorios** (locked 2026-07-02). Claiming the npm name early is cheap insurance and Philipp-only.
- Internal identifiers keep DS9 canon (`ROM_STARTED`, `DS9_WATCHER_MERGE`, `data-role`); public marketing never leads with Paramount character names — the neutral skin is the public face.
- Slice/commit numbering: proposal pending Philipp's ruling (slice 350) — `S###` as the single display identity for a unit of work: slices display as `S349`, the slice's squash commit is labeled by the same number, the independent running commit counter is retired, and non-slice commits show short sha only. **Hard boundary:** `S` is display + commit-subject only; every machine surface stays bare-numeric (`slice-N-ac-K` AC tags are a chmod-locked contract, `Slice-Id:` trailers, `NNN-*.md` filenames, register fields). No `#N` anywhere in git-rendered text — GitHub auto-links `#N` to issues/PRs.

## 5. Phases (extraction plan, updated with audit numbers)

- **Phase 0 — stabilize + decide (now):** daemon restart to deploy the squash-path Layer-2 fix (07a71d3); ratify this ADR; rule on S-numbering. Slices 350–352 land.
- **Phase 1 — config spine:** one config file answering what the code currently assumes: repo root, branch names, state dir, test command, ports, worktree base, role registry. Audit found ~145 branch-literal lines in bridge/orchestrator.js, 42 in dashboard/server.js, `WORKTREE_BASE='/tmp/ds9-worktrees'` hardcoded twice, and an asymmetry to reconcile (bridge/new-slice.js honors `DS9_QUEUE_DIR`/`DS9_STAGED_DIR` env; the orchestrator reads only bridge/bridge.config.json — which already exists and is the seed). Acceptance: zero absolute personal paths in source, zero git-ref literals outside config defaults, and the repo still runs itself green through its own gate.
- **Phase 2 — separate tool from host:** the gates run the *host's* tests via the config's test command; the framework's own regression/ and e2e/ suites remain as engine self-tests. Acceptance: self-hosting flows through the identical code path a foreign host would use.
- **Phase 3 — the package:** `denorios init` scaffolds config, state dir, hooks, CI workflows and service units from templates; `start/stop/status/upgrade` operate it. The plugin is rebuilt from the live `repo/.claude/skills/` (both existing `ds9.plugin` zips are stale April snapshots; the in-repo copy contains no skills at all).
- **Phase 4 — pilot install:** one foreign repo, `denorios init`, one slice driven end-to-end to a green promote. The punch list from this is v1's backlog.
- **Phase 5 — harden:** Linux/systemd (today: 3 launchd plists with absolute paths, launchctl in start/stop scripts, 2 osascript call sites), install docs, semver discipline.

## 6. Consequences

**Good:** hosts take gate fixes as dependency bumps; releases become boring and checkable (soaked + green + changelog); the tarball is structurally incapable of leaking personal state; self-hosting remains the permanent first integration test; the release tier reuses the exact trust pattern (operator button + fail-closed gate) Philipp already exercises daily.
**Trade-offs:** three tiers mean one more button and one more branch to reason about; re-running the full gate at release duplicates a promote-time run (deliberate — the released SHA is verified in the same job that ships it); macOS-only ops remains a real port deferred to Phase 5; the `claude` CLI/OAuth substrate is a hard host prerequisite we don't control.

## 7. Open questions for Philipp (ratification checklist)

1. Soak period before a release — accept the proposed 3 days of self-hosted main, or set another?
2. S-numbering ruling — approve slice 350 as specified (that press is the ruling)?
3. npm name claim — do it now (Philipp-only)?
4. Public-repo exposure of personal data (bridge/trash, timesheets, role memories) — make the repo private, scrub, or accept?
5. `stable` branch protection — mirror main's settings?

---

*Companions: ADR-GITHUB-CI-MERGE-MODEL.md, ADR-ROLLBACK-MODEL.md. Staged implementation: slices 350 (S-numbering), 351 (package skeleton), 352 (release tier).*

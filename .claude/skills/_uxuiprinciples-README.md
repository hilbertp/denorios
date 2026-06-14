<div align="center">
  <a href="https://uxuiprinciples.com">
    <img src="https://uxuiprinciples.com/android-chrome-512x512.png" alt="UX/UI Principles" width="100">
  </a>
</div>

# UX/UI Principles — Agent Skills

Five SKILL.md files that inject UX expertise into AI agents. Works with Cursor, Windsurf, kx, Claude Code, and any framework that reads SKILL.md.

Each skill runs on LLM inference alone. Add a `UXUI_API_KEY` to unlock enriched output: principle codes, 2,098+ academic citations, severity from the taxonomy, and remediation recipes.

**Get an API key:** [uxuiprinciples.com/pricing](https://uxuiprinciples.com/pricing)

---

## Skills

| Skill | Description | API Required |
|-------|-------------|-------------|
| [uxui-evaluator](./uxui-evaluator/SKILL.md) | Evaluate interfaces against 168 research-backed UX/UI principles | Optional |
| [interface-auditor](./interface-auditor/SKILL.md) | Detect UX antipatterns using the smell taxonomy | Optional |
| [ai-interface-reviewer](./ai-interface-reviewer/SKILL.md) | Audit AI/LLM interfaces against the Part V taxonomy (44 principles) | Optional |
| [flow-checker](./flow-checker/SKILL.md) | Run preflight/postflight checklists against UX flows | Required (pro) |
| [vibe-coding-advisor](./vibe-coding-advisor/SKILL.md) | Inject UX context into AI coding sessions before generating components | Optional |

---

## Installation

Copy the SKILL.md file for the skill you want into your project root (or wherever your agent framework reads skills from).

```bash
# Example: add uxui-evaluator to your project
curl -O https://raw.githubusercontent.com/uxuiprinciples/agent-skills/main/uxui-evaluator/SKILL.md
```

### With API Key (enriched output)

Set `UXUI_API_KEY` in your environment:

```bash
export UXUI_API_KEY=uxui_live_...
```

Or in your agent config:

```toml
[env]
UXUI_API_KEY = "uxui_live_..."
```

---

## What the API Key Unlocks

Without a key, each skill evaluates using LLM inference and returns generic findings.

With a key (pro tier), the toolbox calls return:
- Principle codes (`F.1.1.02`, `S.1.3.01`, etc.) from the full 168-principle taxonomy
- `aiSummary` fields with concise, citation-backed descriptions
- `businessImpact` data from 2,098+ peer-reviewed sources
- `vibeCodingPrompts` for component-level implementation guidance
- UX smell remediation recipes with step-by-step fixes

**Plans:** [uxuiprinciples.com/pricing](https://uxuiprinciples.com/pricing) — API Access from $19/yr

---

## Framework Structure

The skills reference the uxuiprinciples 6-part taxonomy:

| Part | Domain |
|------|--------|
| Part 1 | Cognitive Foundations |
| Part 2 | Visual Design |
| Part 3 | Interaction Design |
| Part 4 | Information Architecture |
| Part 5 | AI and Specialized Domains |
| Part 6 | Human-Centered Design |

---

## License

Skills are free to use and distribute. API access for enriched output requires a paid plan.

[uxuiprinciples.com](https://uxuiprinciples.com)

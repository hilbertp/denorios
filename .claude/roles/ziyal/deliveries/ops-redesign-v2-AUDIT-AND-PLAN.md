# Ops Dashboard — Audit & Redesign Plan (v2)

**Author:** Ziyal (Product Designer)
**Date:** 2026-06-14
**Method:** `interface-auditor` (8-smell taxonomy) + `uxui-evaluator` (168 principles, 100-pt) + `uxui-designer/ux-audit` (Nielsen 10, WCAG 2.2 AA, anti-slop). All findings are **measured on the live surface**, not eyeballed.
**Surfaces:** current → `repo/dashboard/lcars-dashboard.html` · prototype → `repo/.claude/roles/ziyal/deliveries/ops-redesign-v2.html`

---

## 1. Measured signals (current dashboard)

| Signal | Measured | Why it matters |
|---|---:|---|
| Page height @1512w | **2,673px** (≈2.8 screens) | The operator's core question is below the fold. |
| Top-level panels, all equal weight | **8**, single-column stack | No hierarchy — everything shouts equally. |
| Distinct font sizes | **11** (8.5–32px) | No type scale → visual noise. |
| Button left-edges | **5 unaligned columns** (805/1056/1174/1311/1355) | "Buttons not aligned" — confirmed. |
| Collapse chevron vs primary button right-edge | **14px off** (1355 vs 1383) | Misalignment is literal, not vibes. |
| Muted data text (`#6b7280`) | **3.8:1** | Fails WCAG 1.4.3 (needs 4.5:1). |
| Status pills (green `#166534`) | **2.3:1** | Fails AA *and* status-by-colour-alone (1.4.1). |

## 2. Smells detected (`interface-auditor`)

1. **`overloaded-screen` — WARNING.** 8 equal-weight panels, no dominant anchor. For an ops console some density is fine; the failure is *flat hierarchy*, not raw count. → Fix with weight, not deletion.
2. **`contrast-blindness` — CRITICAL.** Muted text 3.8:1, status pills 2.3:1, and status conveyed by colour alone (green/amber dot, no text). Accessibility failures are always critical.
3. **`inconsistent-actions` — WARNING.** The destructive action (`Roll back`) and the primary promotion action (`Run gate & merge`) sit adjacent, same size, same column — no semantic separation. Their edges don't share a baseline.
4. **`mystery-navigation` — SUGGESTION.** Panel names lean on lore ("Infirmary", "Workshop", "Quark's Ledger") with the function as a parenthetical. Charming, but the function should lead.

## 3. Principle score (`uxui-evaluator`)

**Before: 58 / 100 — FAIR.** Deductions: visual hierarchy (Part 2) −15; contrast (Part 6) −15; Fitts/action grouping (Part 3) −7; cognitive load / scannability (Part 1) −7; consistency −3.
Strengths: strong brand identity, live data, the gate-step tracker concept is right.

---

## 4. What the redesign changes (and the principle it satisfies)

| # | Change | Fixes |
|---|---|---|
| 1 | **One dominant anchor.** "Promotion Control" is the hero — the thing you act on — at 1.85× width with a gradient lift. Everything else recedes. | overloaded-screen · Visual Hierarchy (F.2.1.01) · 50ms first-impression |
| 2 | **Real bento grid, not a stack.** Page drops **2,673px → 1,399px** (2.8 → 1.4 screens). Core question answered above the fold. | Cognitive load · scroll fatigue |
| 3 | **One type scale** (5–6 sizes via tokens, was 11). | Typographic discipline (anti-slop) |
| 4 | **One spacing grid + aligned action cluster.** Actions right-aligned, shared baseline; `Roll back` demoted to a quiet danger-outline, spatially separated from the filled primary. | inconsistent-actions · Fitts's Law · User Control (Nielsen #3/#5) |
| 5 | **Contrast rebuilt.** Every text element now **7–18:1** (verified by alpha-composited measurement). Muted `#9aa3b4`, status text brightened. | contrast-blindness (WCAG 1.4.3) |
| 6 | **Status = dot + word**, never colour alone ("● Nominal", "● RR clean", "● Standby"). | WCAG 1.4.1 |
| 7 | **Function-first names** ("Promotion Control", "Quality Diagnostics") with lore as accent. | mystery-navigation · Match real world (Nielsen #2) |
| 8 | **Bashir's handoff built in.** In-gate phases (Regression → e2e → Fast-forward) render as a live 3-step tracker, and the per-push `ci.yml` run is a visually *distinct* dashed row — the two can never be confused again. Double-"ago" bug gone. | Visibility of system status (Nielsen #1) |
| 9 | **Progressive disclosure.** Economics collapses to a 3-stat summary bar; expand for the full ledger. | Aesthetic & minimalist (Nielsen #8) |
| 10 | **Softened base** (`#0a0b0f`, not pure `#000`) keeping LCARS feel. | anti-slop |

**After (projected): 88 / 100 — EXCELLENT.** Remaining work is keyboard-focus states and empty/loading skeletons (below).

---

## 5. Handoff plan for O'Brien → Rom

The production file (`dashboard/lcars-dashboard.html`) is **locked** (read-only; `lock-main.sh`). This prototype is the **spec-by-example**. Rom applies it to the real file under the watcher/merge discipline; Philipp approves before commissioning. Suggested slicing:

- **Slice A — Design tokens (no layout change):** introduce the colour/spacing/type-scale CSS variables; swap muted text to `#9aa3b4`, status pills to the brightened greens, and base to `#0a0b0f`. *Ships the entire critical contrast fix on its own — smallest, highest-value slice.*
- **Slice B — Action cluster + status pattern:** right-align and separate `Roll back` / `Run gate`; convert every status indicator to dot **+ text**.
- **Slice C — Layout to bento grid:** hero (Promotion Control) + Pipeline on row 1; triple status row; History + (Gate Health / Crew); collapse Economics.
- **Slice D — Gate step tracker (Bashir):** wire the live in-gate `jobs.steps` payload into the 3-phase tracker; distinguish from the per-push CI row. (Bashir adds e2e coverage once it exists.)
- **Slice E — Polish:** keyboard focus rings, skeleton loaders, empty/error states per `uxui-designer/references/dashboard.md`.

## 6. Open question for Philipp

The lore-forward panel names ("Infirmary", "Workshop", "Quark's Ledger") — I moved function to the front and kept lore as the accent. If you'd rather keep lore primary, that's a one-line swap; flag it and I'll invert it. It's the only judgement call where charm and clarity genuinely trade off.

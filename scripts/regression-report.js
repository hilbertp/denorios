#!/usr/bin/env node
'use strict';

/**
 * Bashir's regression reporter — closes the feedback loop to O'Brien.
 *
 * The gate runs `node --test regression/**` and, on failure, only emitted an event
 * and dumped raw output to a log. Nobody turned that into a clear "what regressed"
 * report, and nobody routed it to the engineering team — a red gate was a silent
 * dead end. This reporter fixes that.
 *
 * It writes a human-readable report to `regression/LAST-RUN.md` (Bashir's standing
 * report, pass or fail). On FAILURE it also writes a routed handoff to O'Brien's
 * inbox so a fix slice can be authored; on PASS it clears that handoff (resolved).
 *
 * Usage:
 *   node scripts/regression-report.js              # run the suite, then report
 *   node scripts/regression-report.js --from-log   # parse the last gate's stdout log
 *                                                  #   (bridge/state/regression-stdout.log)
 *
 * Exit code mirrors the suite: 0 = green, 1 = something regressed. Safe to use as
 * the gate's report step (CI or the local orchestrator gate).
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO          = path.resolve(__dirname, '..');
const STDOUT_LOG    = path.join(REPO, 'bridge', 'state', 'regression-stdout.log');
const REPORT_PATH   = path.join(REPO, 'regression', 'LAST-RUN.md');
const OBRIEN_INBOX  = path.join(REPO, '.claude', 'roles', 'obrien', 'inbox');
const OBRIEN_HANDOFF = path.join(OBRIEN_INBOX, 'REGRESSION-FAILURE.md');

const AC_NAMING_RE = /slice-(\d+)-ac-(\d+)/i;

// ── Acquire the suite output ────────────────────────────────────────────────
function getOutput() {
  if (process.argv.includes('--from-log')) {
    try { return { output: fs.readFileSync(STDOUT_LOG, 'utf8'), exitCode: null }; }
    catch (_) { return { output: '', exitCode: null }; }
  }
  try {
    const out = execFileSync('node', ['--test', 'regression/**/*.test.js'],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return { output: out, exitCode: 0 };
  } catch (e) {
    // node --test exits non-zero on failure; stdout/stderr ride on the error.
    return { output: `${e.stdout || ''}\n${e.stderr || ''}`, exitCode: e.status ?? 1 };
  }
}

// ── Parse node --test (spec / TAP) output ───────────────────────────────────
function parse(output) {
  const lines = output.split('\n');
  const summary = { tests: null, pass: null, fail: null, skipped: null, durationMs: null };
  for (const l of lines) {
    let m;
    if ((m = l.match(/(?:^|\s)tests\s+(\d+)\s*$/)))       summary.tests = +m[1];
    else if ((m = l.match(/(?:^|\s)pass\s+(\d+)\s*$/)))    summary.pass = +m[1];
    else if ((m = l.match(/(?:^|\s)fail\s+(\d+)\s*$/)))    summary.fail = +m[1];
    else if ((m = l.match(/(?:^|\s)skipped\s+(\d+)\s*$/))) summary.skipped = +m[1];
    else if ((m = l.match(/(?:^|\s)duration_ms\s+([\d.]+)\s*$/))) summary.durationMs = +m[1];
  }

  const failures = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const sf = lines[i].match(/^✖\s+(.*?)(?:\s+\(\d[\d.]*m?s\))?$/); // "✖ name (1.2ms)"
    const tf = lines[i].match(/^not ok \d+\s*-?\s*(.*)/);                  // "not ok 3 - name"
    const m = sf || tf;
    if (!m) continue;
    const name = m[1].trim();
    if (!name || /^(failing tests|tests):?$/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const excerpt = [];
    let j = i + 1;
    const isSummaryLine = (l) => /^ℹ\s*(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(l);
    while (j < lines.length &&
           (lines[j].startsWith('  ') || lines[j].startsWith('#') ||
            (lines[j].startsWith('ℹ') && !isSummaryLine(lines[j])))) {
      excerpt.push(lines[j]);
      j++;
    }
    const ac = name.match(AC_NAMING_RE);
    failures.push({
      name,
      slice: ac ? ac[1] : null,
      ac: ac ? +ac[2] : null,
      excerpt: excerpt.slice(0, 14).join('\n').trim(),
    });
  }
  return { summary, failures };
}

// ── Render the standing report (regression/LAST-RUN.md) ─────────────────────
function renderReport({ summary, failures }, failed, ts) {
  const s = summary;
  const tally = `${s.pass ?? '?'} passed · ${s.fail ?? failures.length} failed`
    + (s.skipped ? ` · ${s.skipped} skipped` : '')
    + (s.durationMs ? ` · ${(s.durationMs / 1000).toFixed(1)}s` : '');

  const lines = [];
  lines.push(`# Regression Report — ${failed ? '🔴 FAIL' : '🟢 PASS'}`);
  lines.push('');
  lines.push(`**Run:** ${ts}  `);
  lines.push(`**Suite:** \`regression/\` (node --test)  `);
  lines.push(`**Result:** ${tally}`);
  lines.push('');

  if (!failed) {
    lines.push('## ✅ All green');
    lines.push('');
    lines.push(`Nothing regressed across ${s.tests ?? '?'} checks. Dev is safe to promote.`);
  } else {
    lines.push(`## ❌ What regressed (${failures.length})`);
    lines.push('');
    lines.push('Engineering team: each item below is a failing acceptance check. The `S<n>` is the slice whose behavior broke — author a fix slice for it before promoting to main.');
    lines.push('');
    for (const f of failures) {
      const head = f.slice ? `S${f.slice} · AC ${f.ac} — ${f.name}` : `⚠️ Naming violation — ${f.name}`;
      lines.push(`### ${head}`);
      if (f.excerpt) {
        lines.push('');
        lines.push('```');
        lines.push(f.excerpt);
        lines.push('```');
      }
      if (f.slice) lines.push(`**Owner:** S${f.slice} → O'Brien cuts a fix slice.`);
      else lines.push(`**Note:** test name does not follow \`slice-<id>-ac-<index>\` — Bashir to rename so failures route to a slice.`);
      lines.push('');
    }
  }
  lines.push('---');
  lines.push(`*Generated by Bashir's regression reporter (\`scripts/regression-report.js\`). On failure this is routed to O'Brien's inbox. Raw output: \`bridge/state/regression-stdout.log\`.*`);
  lines.push('');
  return lines.join('\n');
}

// ── Render the routed handoff to O'Brien ────────────────────────────────────
function renderObrienHandoff({ summary, failures }, ts) {
  const lines = [];
  lines.push(`# 🔴 Regression FAILED — ${ts.slice(0, 10)} (from Bashir)`);
  lines.push('');
  lines.push('**From:** Bashir (QA Engineer)  ');
  lines.push('**To:** O\'Brien (Tech Lead)  ');
  lines.push(`**Result:** ${failures.length} acceptance check(s) failing in \`regression/\`. **Do not promote to main until green.**`);
  lines.push('');
  lines.push('The dev branch regressed. Author fix slices for the failures below, then re-run the gate.');
  lines.push('');
  lines.push('## Failures');
  lines.push('');
  for (const f of failures) {
    lines.push(`- **${f.slice ? `S${f.slice} AC ${f.ac}` : 'naming violation'}** — ${f.name}`);
    if (f.excerpt) {
      const first = f.excerpt.split('\n').find(l => /error|assert|expect|mismatch|✖|Error/i.test(l)) || f.excerpt.split('\n')[0];
      if (first) lines.push(`  - ${first.trim().slice(0, 200)}`);
    }
  }
  lines.push('');
  lines.push('## Next step');
  lines.push('For each failing slice id, cut a fix slice (amendment referencing that slice) addressing the assertion, then re-run the gate.');
  lines.push('');
  lines.push('*Full report: `regression/LAST-RUN.md` · raw output: `bridge/state/regression-stdout.log`. This handoff is auto-cleared when regression goes green again.*');
  lines.push('');
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const { output, exitCode } = getOutput();
  const parsed = parse(output);
  const ts = new Date().toISOString();

  // Determine pass/fail: prefer the runner's exit code; else the parsed fail count.
  const failed = exitCode != null
    ? exitCode !== 0
    : ((parsed.summary.fail ?? parsed.failures.length) > 0);

  // Standing report — always.
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, renderReport(parsed, failed, ts));
  } catch (e) { console.error('regression-report: could not write LAST-RUN.md:', e.message); }

  // Route to O'Brien on failure; clear it on green.
  try {
    if (failed) {
      fs.mkdirSync(OBRIEN_INBOX, { recursive: true });
      fs.writeFileSync(OBRIEN_HANDOFF, renderObrienHandoff(parsed, ts));
      console.error(`regression-report: 🔴 ${parsed.failures.length} failing — report at regression/LAST-RUN.md, routed to O'Brien's inbox.`);
    } else {
      if (fs.existsSync(OBRIEN_HANDOFF)) fs.rmSync(OBRIEN_HANDOFF);
      console.error('regression-report: 🟢 green — regression/LAST-RUN.md updated, O\'Brien handoff cleared.');
    }
  } catch (e) { console.error('regression-report: could not route to O\'Brien:', e.message); }

  process.exit(failed ? 1 : 0);
}

main();

#!/usr/bin/env node
'use strict';

// Read where a build's minutes went, from a log that already exists (slice 392).
//
// The orchestrator attributes every run it finishes and parks the split on the
// DONE event and in bridge/logs/rom-<id>.timing.json. The runs BEFORE that
// landed — rom-383 through rom-391, the ones ADR-PROOF-LANES §8 measures
// against — have only their stream-json log. This reads the same split out of
// any of them, with the same rules, so the baseline and the new runs are one
// series of numbers rather than two.
//
//   node scripts/build-timing.js 383                  # bridge/logs/rom-383.log
//   node scripts/build-timing.js /path/to/a/run.log   # any stream-json log
//   node scripts/build-timing.js 383 --json           # the raw attribution

const fs = require('fs');
const path = require('path');
const { attributeRun } = require('../lib/build-timing');

const DEFAULT_LOGS_DIR = process.env.DS9_LOGS_DIR || path.resolve(__dirname, '..', 'bridge', 'logs');

/**
 * resolveLogPath(arg, logsDir) → absolute path
 *
 * A bare slice id means the log the orchestrator tees for that slice; anything
 * else is taken as a path and resolved against the working directory. Pure: it
 * touches no disk, so a caller can ask where a log WOULD be.
 */
function resolveLogPath(arg, logsDir) {
  const s = String(arg || '').trim();
  if (/^\d+$/.test(s)) return path.join(logsDir || DEFAULT_LOGS_DIR, `rom-${s}.log`);
  return path.resolve(s);
}

function fmtMin(seconds) {
  return `${(seconds / 60).toFixed(1)} min`;
}

/**
 * formatSplit(timing, label) → the printed report
 *
 * The same lines the History row's detail draws, in the same order (longest
 * phase first), so a number read here and a number read on the screen are the
 * same number.
 */
function formatSplit(timing, label) {
  const lines = Object.keys(timing.phases || {}).map(name => {
    const p = timing.phases[name] || {};
    return {
      name,
      seconds: (Number(p.model_s) || 0) + (Number(p.tool_s) || 0),
      model_s: Number(p.model_s) || 0,
      tool_s: Number(p.tool_s) || 0,
      calls: Number(p.calls) || 0,
    };
  });
  lines.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));

  const total = lines.reduce((s, l) => s + l.seconds, 0);
  const span = timing.span_s == null ? 'unknown duration' : fmtMin(timing.span_s);

  const out = [];
  out.push(`${label} — ${span} over ${timing.calls} tool call${timing.calls === 1 ? '' : 's'}`);
  out.push('');
  if (lines.length === 0) {
    out.push('  (no tool calls found in this log)');
  } else {
    out.push(`  ${'phase'.padEnd(13)}${'total'.padStart(9)}${'share'.padStart(7)}${'model'.padStart(9)}${'tool'.padStart(9)}${'calls'.padStart(7)}`);
    for (const l of lines) {
      const share = total > 0 ? `${Math.round((l.seconds / total) * 100)}%` : '—';
      out.push(`  ${l.name.padEnd(13)}${fmtMin(l.seconds).padStart(9)}${share.padStart(7)}${fmtMin(l.model_s).padStart(9)}${fmtMin(l.tool_s).padStart(9)}${String(l.calls).padStart(7)}`);
    }
  }
  out.push('');
  out.push(timing.first_product_edit_s == null
    ? '  First product edit: not recorded'
    : `  First product edit at minute ${(timing.first_product_edit_s / 60).toFixed(1)}`);
  return out.join('\n');
}

function main(argv) {
  const args = argv.filter(a => a !== '--json');
  const asJson = argv.includes('--json');

  if (args.length === 0) {
    console.error('usage: node scripts/build-timing.js <slice-id|path-to-log> [--json]');
    process.exit(2);
  }

  const logPath = resolveLogPath(args[0], DEFAULT_LOGS_DIR);
  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch (_) {
    console.error(`No log to read at ${logPath}`);
    process.exit(1);
    return;
  }

  const timing = attributeRun(raw);
  console.log(asJson ? JSON.stringify(timing, null, 2) : formatSplit(timing, path.basename(logPath)));
}

module.exports = { resolveLogPath, formatSplit, DEFAULT_LOGS_DIR };

if (require.main === module) main(process.argv.slice(2));

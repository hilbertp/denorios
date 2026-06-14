'use strict';
// ── Signed, structure-aware assertion-direction engine (ADR-TEST-UPDATE-GATE, Slice A) ──
//
// Given a unified git diff of a test file, classify how each *check* (test/it block,
// keyed by its slice-<id>-ac-<n> tag, or its trimmed title when untagged) changed:
//
//   'tightened' | 'loosened' | 'reworded' | 'removed' | 'skipped'
//
// This replaces the old sign-blind `assertionDelta++` which counted churn, not
// direction, and could not tell a strengthened assertion from a loosened one. The
// engine is deliberately built to make the DANGEROUS direction loud and to FAIL
// TOWARD 'loosened' (an unknown idiom replacing a known-strict one reads as weak).
//
// It is a heuristic, not a theorem-prover: it proves assertion *direction*, not
// semantic correctness. The real suites remain the backstop for does-the-code-work.

// A check's stable identity: its slice-<id>-ac-<n> tag, else its trimmed title.
function tagOf(name) {
  const m = String(name).match(/slice-[\w]+-ac-\d+/i);
  return m ? m[0].toLowerCase() : String(name).trim();
}

// Strictness rank of a single assertion line. Higher = stricter (constrains more).
//   3 = exact equality / structure / exact text   (loss of this is the loud case)
//   2 = pattern / substring / contains
//   1 = existence / truthiness
//   null = unknown idiom — treated as WEAK when added, STRICT when removed (fail loud)
function assertRank(line) {
  const b = String(line).toLowerCase();
  // strict equality / deep equality / exact value or attribute / count
  if (/\.(?:strictequal|deepstrictequal|deepequal|equal)\(/.test(b)) return 3;
  if (/\.(?:tobe|toequal|tostrictequal|tohavetext|tohaveattribute|tohavecount|tohavevalue|tohaveurl|tohavetitle)\(/.test(b)) return 3;
  // pattern / contains
  if (/\.(?:match|tomatch|tocontaintext|tocontain)\(/.test(b)) return 2;
  if (/\.includes\(/.test(b) || /stringcontaining/.test(b)) return 2;
  // existence / truthiness
  if (/\.(?:ok|tobevisible|tobehidden|tobetruthy|tobedefined|tobeenabled|tobechecked)\(/.test(b)) return 1;
  // bare assert(expr) with no method — truthiness
  if (/^[+-]?\s*(?:await\s+)?assert\(/.test(line)) return 1;
  return null;
}

// Does a line carry a concrete literal (number or quoted string) — the thing whose
// disappearance turns equal(x, 200) into the tautology equal(x, x)?
function hasLiteral(s) {
  return /(?:^|[^.\w])\d+(?:\.\d+)?\b/.test(s) || /['"`][^'"`]*['"`]/.test(s);
}

// Compare the surviving/changed assertions of ONE check.
//   added   = the assertion bodies on the '+' side of this check
//   removed = the assertion bodies on the '-' side of this check
// strictHelpers = names of helpers ADDED in this diff that wrap a strict assert
//                 (so equal(x,5) -> expectStrict(x,5) reads as reworded, not loosened)
function classifyDirection(added, removed, strictHelpers) {
  strictHelpers = strictHelpers || new Set();
  const callsStrictHelper = (line) => {
    for (const h of strictHelpers) {
      if (new RegExp('\\b' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(').test(line)) return true;
    }
    return false;
  };
  const rankOf = (line) => (callsStrictHelper(line) ? 3 : assertRank(line));

  const a = added.length, r = removed.length;
  if (a === 0 && r === 0) return 'reworded';   // only the title/structure moved
  if (a > 0 && r === 0) return 'tightened';     // pure additional checks
  if (a === 0 && r > 0) return 'loosened';      // assertions deleted, test kept

  // Both sides changed. Literal loss is the clearest tautology tell.
  if (removed.some(hasLiteral) && !added.some(hasLiteral)) return 'loosened';

  // Rank comparison: unknown REMOVED counts as strict (its loss is loud);
  // unknown ADDED counts as weak (it doesn't earn strictness it can't prove).
  const maxRemoved = Math.max.apply(null, removed.map(l => { const k = rankOf(l); return k == null ? 3 : k; }));
  const maxAdded   = Math.max.apply(null, added.map(l => { const k = rankOf(l); return k == null ? 0 : k; }));
  if (maxAdded < maxRemoved) return 'loosened';
  if (maxAdded > maxRemoved) return 'tightened';
  return 'reworded';
}

// Capture: a test/it definition line. Group 1 = +/-/space prefix, group 2 = modifier
// (skip/only/…) or undefined, group 3 = quote char, group 4 = full name (inner quotes
// of the OTHER kind are kept — the closing quote is the same char as the opening one).
const TEST_RE = /^([+\- ])\s*(?:await\s+)?(?:test|it)(?:\.(\w+))?\(\s*(['"`])(.*?)\3/;
// An assertion line: a real assert/expect call (NOT a helper definition). Unknown
// custom-call lines are intentionally NOT captured — losing a known assert for an
// unrecognised call reads as a pure-removal => loosened (fail loud), which is correct.
const ASSERT_RE = /^([+\-])\s*((?:await\s+)?(?:assert|expect)\b.*)/;

// Collect helper names ADDED in this diff whose body contains a strict assert, so a
// genuine "extract a strict assert into a helper" refactor reads as reworded.
function collectStrictHelpers(lines) {
  const helpers = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\+\s*(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/);
    if (!m) continue;
    const name = m[1] || m[2];
    // peek a few following added lines for a strict assertion
    for (let j = i; j < Math.min(i + 8, lines.length); j++) {
      if (/^\+/.test(lines[j]) && assertRank(lines[j]) === 3) { helpers.add(name); break; }
    }
  }
  return helpers;
}

// Classify a whole test-file diff. Returns { <key>: { direction, name, onPlus, onMinus } }.
function classifyFileDiff(diffText) {
  const lines = String(diffText || '').split('\n');
  const strictHelpers = collectStrictHelpers(lines);
  const byKey = {};
  let current = null;

  const ensure = (key, name) => (byKey[key] || (byKey[key] = {
    name: name || key, key, added: [], removed: [], onPlus: false, onMinus: false, modPlus: undefined, modMinus: undefined,
  }));
  // A changed line that is a call to a strict helper added in this diff counts as an assert.
  const isHelperCall = (line) => {
    for (const h of strictHelpers) {
      if (new RegExp('^[+\\-]\\s*(?:await\\s+)?' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(').test(line)) return true;
    }
    return false;
  };

  for (const line of lines) {
    if (/^@@/.test(line)) { current = null; continue; }          // new hunk: drop test context
    if (/^(?:diff |index |--- |\+\+\+ )/.test(line)) { continue; } // other diff headers
    const tm = line.match(TEST_RE);
    if (tm) {
      const prefix = tm[1], mod = tm[2], name = tm[4];
      const e = ensure(tagOf(name), name);
      e.name = name;
      current = e;
      if (prefix === '+') { e.onPlus = true; e.modPlus = mod; }
      else if (prefix === '-') { e.onMinus = true; e.modMinus = mod; }
      else { e.onPlus = true; e.onMinus = true; }   // context line: present unchanged on both sides
      continue;
    }
    if (!current || (line[0] !== '+' && line[0] !== '-')) continue;
    const am = line.match(ASSERT_RE);
    const body = am ? am[2] : (isHelperCall(line) ? line.slice(1).trim() : null);
    if (body == null) continue;
    if (line[0] === '+') current.added.push(body);
    else current.removed.push(body);
  }

  const out = {};
  for (const key of Object.keys(byKey)) {
    const e = byKey[key];
    out[key] = { direction: directionFor(e, strictHelpers), name: e.name, onPlus: e.onPlus, onMinus: e.onMinus };
  }
  return out;
}

function isSkip(mod) { return mod === 'skip' || mod === 'only'; }

function directionFor(e, strictHelpers) {
  // Definition present only on the '-' side: the check was deleted (or commented out).
  if (e.onMinus && !e.onPlus) return 'removed';
  // skip/only added where it wasn't before → quarantined, not run.
  if (isSkip(e.modPlus) && !isSkip(e.modMinus)) return 'skipped';
  return classifyDirection(e.added, e.removed, strictHelpers);
}

module.exports = { tagOf, assertRank, hasLiteral, classifyDirection, classifyFileDiff };

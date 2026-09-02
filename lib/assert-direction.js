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
//
// A renamed check is recognised as renamed rather than as delete-plus-add: see
// "Rename detection" below. The rename is reported as a LABEL beside the direction,
// never as a direction of its own.

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

// ── Rename detection (S366) ─────────────────────────────────────────────────
// Untagged checks are keyed by their title text, so a reworded title reads as
// delete-plus-add: a removal (RED) plus an unrelated addition. That is cry-wolf --
// it trains reflex-ticking, and then gets ticked the day a check is genuinely
// disabled. So a disappearing check is paired with a near-identical appearing one
// WITHIN THE SAME FILE, the two entries are MERGED (the old side's removed
// assertions together with the new side's added ones) and the merged entry goes
// through the ordinary direction rules UNCHANGED. A pure rename then falls out as
// 'reworded' for free; a rename that also guts its assertions still falls out as
// 'loosened'. There is no short-circuit -- "it's a rename, skip the masking check"
// would let a gutted check pass by wearing a new title. Nothing here compares
// counts either: totals would clear "delete one strict check, add two trivial ones".
//
// Two known limits fail CLOSED (they stay 'removed' -> RED, and are declarable with a
// Test-Loosen-OK file-path trailer):
//   - a rename that also MOVES the check to another file;
//   - a rename that adds or drops a slice-<id>-ac-<n> tag -- that is a real identity
//     change, and AC custody, not similarity, owns it.
// A heavily reworded title also scores below the threshold and stays RED, which is the
// safe direction. The one limit that fails OPEN is a one-word semantic inversion --
// "...is disabled..." replaced by "...is enabled..." scores 0.90 and pairs. No title
// metric can tell that from a rename, so the MERGE is the real protection: the paired
// entry still has to survive the ordinary assertion-direction rules, and clears only
// when the new assertions are at least as strict as the old ones.
const RENAME_SIMILARITY = 0.8;
const TAG_KEY_RE = /^slice-[\w]+-ac-\d+$/;

function normalizeTitle(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Dice coefficient over character bigrams (a multiset, so repeats count once each).
function charBigramDice(a, b) {
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i + 2 <= s.length; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const A = grams(a), B = grams(b);
  let ta = 0, tb = 0, inter = 0;
  for (const v of A.values()) ta += v;
  for (const v of B.values()) tb += v;
  for (const [k, v] of A) if (B.has(k)) inter += Math.min(v, B.get(k));
  if (ta + tb === 0) return a === b ? 1 : 0;
  return (2 * inter) / (ta + tb);
}

// Dice coefficient over the word multiset.
function wordDice(a, b) {
  const A = a.split(' ').filter(Boolean), B = b.split(' ').filter(Boolean);
  const pool = new Map();
  for (const w of B) pool.set(w, (pool.get(w) || 0) + 1);
  let inter = 0;
  for (const w of A) { const n = pool.get(w) || 0; if (n > 0) { inter++; pool.set(w, n - 1); } }
  if (A.length + B.length === 0) return a === b ? 1 : 0;
  return (2 * inter) / (A.length + B.length);
}

// Similarity of two check titles: the TIGHTER of the two Dice scores above, over the
// normalised title. Taking the MIN widens the margin against near-siblings -- a long
// shared prefix inflates the character score, while the word score only stays high when
// the differing part is a small fraction of the whole title. Calibrated on S353's real
// false RED: its two genuine renames score 0.82 and 0.88, the closest non-pair in that
// same file scores 0.21, and a same-subject-but-different check sits around 0.67. Short
// titles score low on the word metric and so decline to pair -- the safe direction.
function titleSimilarity(a, b) {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.min(charBigramDice(na, nb), wordDice(na, nb));
}

function cmpKey(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// Pair disappearing checks with appearing ones: 1:1, greedy, highest-similarity
// first, each side consumed at most once, above RENAME_SIMILARITY. Returns
// [{ from, to, similarity }] in byKey-key terms.
function pairRenames(byKey) {
  const gone = [], born = [];
  for (const key of Object.keys(byKey)) {
    const e = byKey[key];
    if (TAG_KEY_RE.test(key)) continue;            // tagged: identity is the tag, not the prose
    if (e.onMinus && !e.onPlus) gone.push(key);
    else if (e.onPlus && !e.onMinus) born.push(key);
  }
  const cands = [];
  for (const g of gone) for (const b of born) {
    if (byKey[g].fileMixed || byKey[b].fileMixed || byKey[g].file !== byKey[b].file) continue;
    const similarity = titleSimilarity(byKey[g].name, byKey[b].name);
    if (similarity >= RENAME_SIMILARITY) cands.push({ from: g, to: b, similarity });
  }
  // Strongest first, then by key -- so the same diff always pairs the same way,
  // whatever order the keys happen to come out in.
  cands.sort((x, y) => (y.similarity - x.similarity) || cmpKey(x.from, y.from) || cmpKey(x.to, y.to));
  const usedFrom = new Set(), usedTo = new Set(), pairs = [];
  for (const c of cands) {
    if (usedFrom.has(c.from) || usedTo.has(c.to)) continue;
    usedFrom.add(c.from); usedTo.add(c.to);
    pairs.push(c);
  }
  return pairs;
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

// Classify a whole test-file diff. Returns
//   { <key>: { direction, name, onPlus, onMinus, rename? } }
// where `rename` ({ from, to, similarity }) is present only when this entry absorbed
// a renamed predecessor. It is a LABEL: `direction` is still a real direction.
function classifyFileDiff(diffText) {
  const lines = String(diffText || '').split('\n');
  const strictHelpers = collectStrictHelpers(lines);
  const byKey = {};
  let current = null;

  const ensure = (key, name) => (byKey[key] || (byKey[key] = {
    name: name || key, key, file: undefined, fileMixed: false, added: [], removed: [], onPlus: false, onMinus: false, modPlus: undefined, modMinus: undefined,
  }));
  // A changed line that is a call to a strict helper added in this diff counts as an assert.
  const isHelperCall = (line) => {
    for (const h of strictHelpers) {
      if (new RegExp('^[+\\-]\\s*(?:await\\s+)?' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(').test(line)) return true;
    }
    return false;
  };

  // Which file the current hunk belongs to. Callers pass a single-file diff (curFile
  // stays null throughout, and every entry agrees), but a multi-file diff must never
  // pair a removal in one file with an addition in another -- cross-file renames stay
  // RED by design, so the file is tracked and pairing is fenced to it.
  let curFile = null;

  for (const line of lines) {
    if (/^@@/.test(line)) { current = null; continue; }          // new hunk: drop test context
    if (/^\+\+\+ /.test(line)) {                                 // head-side path of a new file section
      const fm = line.match(/^\+\+\+ (?:b\/)?(.*)$/);
      curFile = fm ? fm[1].trim() : null; current = null; continue;
    }
    if (/^(?:diff |index |--- )/.test(line)) { continue; }        // other diff headers
    const tm = line.match(TEST_RE);
    if (tm) {
      const prefix = tm[1], mod = tm[2], name = tm[4];
      const e = ensure(tagOf(name), name);
      e.name = name;
      if (e.file === undefined) e.file = curFile;
      else if (e.file !== curFile) e.fileMixed = true;   // same title in two files: not pairable
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

  // A renamed check is not a removal plus an addition. Pair it, MERGE the two entries,
  // and let directionFor() classify the result exactly as it would any other change.
  const foldedAway = new Set();
  for (const p of pairRenames(byKey)) {
    const oldE = byKey[p.from], newE = byKey[p.to];
    newE.removed = oldE.removed.concat(newE.removed);
    newE.added = oldE.added.concat(newE.added);
    newE.onMinus = true;                  // it DID exist at base -- under the old title
    newE.modMinus = oldE.modMinus;        // so a rename that also adds .skip still reads as skipped
    newE.rename = { from: oldE.name, to: newE.name, similarity: Math.round(p.similarity * 1000) / 1000 };
    foldedAway.add(p.from);
  }

  const out = {};
  for (const key of Object.keys(byKey)) {
    if (foldedAway.has(key)) continue;    // folded into its renamed successor
    const e = byKey[key];
    out[key] = { direction: directionFor(e, strictHelpers), name: e.name, onPlus: e.onPlus, onMinus: e.onMinus };
    // The rename is a LABEL that rides ALONGSIDE the direction, never in place of it.
    if (e.rename) out[key].rename = e.rename;
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

module.exports = { tagOf, assertRank, hasLiteral, classifyDirection, classifyFileDiff,
  normalizeTitle, titleSimilarity, pairRenames, RENAME_SIMILARITY };

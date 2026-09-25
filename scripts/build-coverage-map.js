#!/usr/bin/env node
'use strict';
// ── COVERAGE.lock deriver (ADR-TEST-UPDATE-GATE, Slice C) ────────────────────
//
// Builds regression/COVERAGE.lock: a deterministic source→guard map that says
// which test tags actually read which BEHAVIOUR source file. The Test-Update
// Gate uses it to corroborate a source change FILE-grained: a behaviour file is
// only "covered" when a test that literally reads that file moved in a
// non-masking direction. Without this map every behaviour change lands
// needs_review (Slice B's conservative default).
//
// Coverage is established three ways, and all three are the same claim — this test
// has the real file in its hands:
//   READS it   — `readFileSync(<source>)`, the original form: the test asserts
//                against the file's own bytes.
//   RUNS it    — the file is the command, or an element of the argument array, of
//                spawn/spawnSync/execFile/execFileSync. `spawnSync('bash', [INSTALL_SH])`
//                exercises that script far more completely than reading it would.
//   LOADS it   — `require()` of a static relative path or of a static path const.
// Slice 410 added the last two. Before it, promote 36190555313 flagged three files
// that were under test as "new behaviour, no test" — an install script that a test
// RUNS, a plist a test hands to plutil, and a module a test REQUIRES — and the only
// way past was a hand-written Tests-Not-Needed trailer on dev.
//
// In every form the path is resolved STATICALLY: const SERVER_SRC = path.resolve(__dirname, …),
// the same inline, a plain relative specifier, and a template-literal segment whose
// substitutions are plain string consts (`${LABEL}.plist`). Dynamic (tmp/fixture/parameter)
// paths resolve to null and are ignored, so only genuine sources become guards. Package
// specifiers (`node:fs`, `@playwright/test`) are not paths and never resolve to one.
//
// Resolution NEVER touches the filesystem outside regression/ and e2e/: lib/apply-draft.js
// predicts an apply by deriving this map against a mirror that holds the SUITE and nothing
// else, so an existence check here would make the prediction disagree with the map.
//
//   node scripts/build-coverage-map.js            # write regression/COVERAGE.lock
//   node scripts/build-coverage-map.js --check     # exit 1 if the file is stale
//
// buildCoverageMap(repoRoot) is PURE over the on-disk regression tree (no git, no
// clock) so the integrity meta-test can regenerate and deepEqual it.

const fs = require('fs');
const path = require('path');
const { bucketOf } = require('../lib/tests-needed');

const TAG_RE = /slice-\d+-ac-\d+/g;
const TITLE_RE = /\btest(?:\.skip|\.only|\.todo)?\s*\(\s*(['"`])([\s\S]*?)\1/g;
// PRE-3 (ADR-AC-RECONCILE): the @ac-hash annotation embeds the SPEC hash a test guards,
// beside its slice-N-ac-K tag:  // @ac-hash: slice-050-ac-7 sha256:<hex>
// The tag is named in the annotation so the manifest join is deterministic, not positional.
const AC_HASH_RE = /\/\/\s*@ac-hash:\s*(slice-\d+-ac-\d+)\s+(sha256:[0-9a-f]{6,64})/g;
const CONST_RE = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*path\.(?:resolve|join)\(([^)]*)\)/g;
// A plain string const, so a path segment written as a template literal still resolves:
// `const LABEL = 'dev.denorios.dashboard'` is what makes `${LABEL}.plist` a path.
const STR_CONST_RE = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])((?:[^'"\\\n]|\\.)*)\2/g;
const READ_CONST_RE = /\breadFileSync\(\s*([A-Za-z_$][\w$]*)\b/g;
const READ_INLINE_RE = /\breadFileSync\(\s*path\.(?:resolve|join)\(([^)]*)\)/g;
// RUNS it (slice 410). Longest name first so `spawnSync(` is not read as `spawn` + junk.
const RUN_RE = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(/g;
// LOADS it (slice 410). The const form, and a RELATIVE specifier only — `fs`, `node:fs`
// and `@playwright/test` are package names, not paths, and must never resolve to a repo
// file nor throw on the way (trap 1).
const REQUIRE_CONST_RE = /\brequire\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
const REQUIRE_REL_RE = /\brequire\(\s*(['"])(\.{1,2}\/[^'"\n]*)\1\s*\)/g;
// A call's argument list is read by balancing brackets from its '(' — bounded, so an
// unbalanced scan (a regex literal, a comment) costs nothing and credits nothing.
const CALL_SCAN_MAX = 4000;

// Split a flat path.resolve/join arg list (no nested parens in our call sites).
function splitArgs(raw) {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Split an argument list at its TOP level, so `[A, B]` and `{ env: { … } }` survive as
// one argument each. Used for the call forms below, where a nested bracket is the norm.
function splitTop(text) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map(x => x.trim()).filter(Boolean);
}

const EMPTY = Object.create(null);

// One path.resolve/join argument as a literal path SEGMENT, or null. A plain string, or a
// template literal whose every `${…}` is a plain string const — which is the only reason
// `path.join(REPO_ROOT, 'scripts', `${LABEL}.plist`)` names a file rather than a mystery.
function segOf(a, strs) {
  const q = a.match(/^['"`]([^'"`${}]*)['"`]$/); // plain string literal
  if (q) return q[1];
  if (a.length < 2 || a[0] !== '`' || a[a.length - 1] !== '`') return null;
  const body = a.slice(1, -1);
  if (body.includes('`')) return null;
  let out = '', i = 0;
  while (i < body.length) {
    const open = body.indexOf('${', i);
    if (open === -1) { out += body.slice(i); break; }
    out += body.slice(i, open);
    const close = body.indexOf('}', open);
    if (close === -1) return null;
    const name = body.slice(open + 2, close).trim();
    if (!Object.prototype.hasOwnProperty.call(strs, name)) return null; // an expression, not a const
    out += strs[name];
    i = close + 1;
  }
  return out.includes('${') ? null : out;
}

// Resolve a path.resolve/join arg list to an absolute path, or null if any
// segment is dynamic (a tmp var, an unresolvable template, an unknown identifier).
function resolveArgs(raw, sym, dirAbs, strs) {
  const parts = [];
  const args = splitArgs(raw);
  for (const a of args) {
    if (a === '__dirname') { parts.push(dirAbs); continue; }
    if (Object.prototype.hasOwnProperty.call(sym, a)) { parts.push(sym[a]); continue; }
    const seg = segOf(a, strs || EMPTY);
    if (seg !== null) { parts.push(seg); continue; }
    return null; // dynamic segment → not a static source path
  }
  if (!parts.length || !path.isAbsolute(parts[0])) return null;
  return path.resolve(...parts);
}

// The text between a call's '(' at `open` and its matching ')', bracket-balanced and
// quote-aware; null when the call does not close inside CALL_SCAN_MAX characters.
function callArgs(src, open) {
  let depth = 0, quote = null;
  const stop = Math.min(src.length, open + CALL_SCAN_MAX);
  for (let i = open; i < stop; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

// One argument expression as an absolute static path, or null. A path const, or the same
// call inline. A bare string is deliberately NOT one: 'bash' and '-lint' are arguments,
// not files, and nothing in the suite names a source by a repo-relative string here.
function staticPathOf(expr, sym, dirAbs, strs) {
  const e = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    return Object.prototype.hasOwnProperty.call(sym, e) ? sym[e] : null;
  }
  const inline = e.match(/^path\.(?:resolve|join)\(([^)]*)\)$/);
  return inline ? resolveArgs(inline[1], sym, dirAbs, strs) : null;
}

// require('../../lib/session-stream') and require('../../lib/session-stream.js') name the
// same file. Node supplies the extension; bucketOf() cannot read a path without one, so it
// is supplied here. NOT an existence check — see the note at the top of this file.
const withJs = (abs) => (abs && !path.extname(abs) ? abs + '.js' : abs);

// Every BEHAVIOUR-bucketed source file this test file has in its hands: one it READS, one
// it RUNS through the child_process family, and one it LOADS with require().
function sourcesReadBy(src, fileAbs, repoRoot) {
  const dirAbs = path.dirname(fileAbs);
  let m;
  // Plain string consts first, whole-file: a path const may be written above the segment
  // const it interpolates, and the map must not depend on which came first.
  const strs = Object.create(null);
  STR_CONST_RE.lastIndex = 0;
  while ((m = STR_CONST_RE.exec(src))) strs[m[1]] = m[3];
  const sym = Object.create(null);
  CONST_RE.lastIndex = 0;
  while ((m = CONST_RE.exec(src))) {
    const abs = resolveArgs(m[2], sym, dirAbs, strs);
    if (abs) sym[m[1]] = abs; // earlier consts feed later ones (REPO_ROOT → …)
  }
  const out = new Set();
  const add = (abs) => {
    if (!abs) return;
    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return; // outside the repo
    const relPosix = rel.split(path.sep).join('/');
    if (bucketOf(relPosix) === 'BEHAVIOUR') out.add(relPosix);
  };
  // ── READS it ──
  READ_CONST_RE.lastIndex = 0;
  while ((m = READ_CONST_RE.exec(src))) add(sym[m[1]]);
  READ_INLINE_RE.lastIndex = 0;
  while ((m = READ_INLINE_RE.exec(src))) add(resolveArgs(m[1], sym, dirAbs, strs));
  // ── RUNS it ── the command, or an element of the argument array. Only those two: an
  // options object holds a cwd and an env, which are not files under test.
  RUN_RE.lastIndex = 0;
  while ((m = RUN_RE.exec(src))) {
    const inner = callArgs(src, RUN_RE.lastIndex - 1);
    if (inner === null) continue;
    const args = splitTop(inner);
    if (!args.length) continue;
    add(staticPathOf(args[0], sym, dirAbs, strs));
    const list = args[1];
    if (list && list.startsWith('[') && list.endsWith(']')) {
      for (const el of splitTop(list.slice(1, -1))) add(staticPathOf(el, sym, dirAbs, strs));
    }
  }
  // ── LOADS it ── this file's own require(), NOT what that module requires in turn.
  // Coverage is not transitive: a test that loads the orchestrator has not tested the
  // twenty modules the orchestrator loads, and crediting them would clear them blind.
  REQUIRE_CONST_RE.lastIndex = 0;
  while ((m = REQUIRE_CONST_RE.exec(src))) add(withJs(sym[m[1]]));
  REQUIRE_REL_RE.lastIndex = 0;
  while ((m = REQUIRE_REL_RE.exec(src))) add(withJs(path.resolve(dirAbs, m[2])));
  return out;
}

// Unique, sorted slice-N-ac-M tags drawn from this file's test() titles.
function tagsIn(src) {
  const tags = new Set();
  let t;
  TITLE_RE.lastIndex = 0;
  while ((t = TITLE_RE.exec(src))) {
    const title = t[2];
    let g;
    TAG_RE.lastIndex = 0;
    while ((g = TAG_RE.exec(title))) tags.add(g[0]);
  }
  return [...tags].sort();
}

// Map slice-N-ac-K → guardAcHash, from `// @ac-hash: <tag> sha256:<hex>` annotations.
// This is the hash EMBEDDED IN THE TEST (the guard's claim about which spec it covers);
// the manifest's acHash is the spec's own hash. stale = acHash !== guardAcHash.
function acHashesIn(src) {
  const out = Object.create(null);
  let m;
  AC_HASH_RE.lastIndex = 0;
  while ((m = AC_HASH_RE.exec(src))) out[m[1]] = m[2];
  return out;
}

// Walk regression/**/*.test.js, repo-relative POSIX paths, sorted. Dot-directories are
// skipped — chiefly regression/.drafts/ (gitignored, machine-authored proposals pending
// human review): they are not part of the committed suite, the test runner's `**` glob
// already skips them, and including them would make the map non-deterministic (drafts come
// and go mid-run) AND environment-dependent (absent on a clean CI checkout → the integrity
// gate would flap). The deriver must see exactly what the runner runs.
function walkTests(repoRoot) {
  const root = path.join(repoRoot, 'regression');
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!ent.name.startsWith('.')) walk(full); }
      else if (ent.isFile() && ent.name.endsWith('.test.js')) out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}

// Walk e2e/**/*.spec.js — the browser suite. E2e specs never statically read
// product sources (they drive the rendered dashboard), so they participate in
// the map ONLY through the annotation-declared form below.
function walkSpecs(repoRoot) {
  const root = path.join(repoRoot, 'e2e');
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!ent.name.startsWith('.')) walk(full); }
      else if (ent.isFile() && ent.name.endsWith('.spec.js')) out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}

function buildCoverageMap(repoRoot) {
  const bySource = Object.create(null);
  for (const rel of [...walkTests(repoRoot), ...walkSpecs(repoRoot)]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const tags = tagsIn(src);
    if (!tags.length) continue;
    const acHashes = acHashesIn(src);

    // Form 1 — read-corroborated (regression only): the test readFileSync's a
    // BEHAVIOUR source; every tag in the file registers under that source.
    if (rel.endsWith('.test.js')) {
      const sources = sourcesReadBy(src, path.join(repoRoot, rel), repoRoot);
      for (const s of sources) {
        (bySource[s] = bySource[s] || []).push(...tags.map(tag => (
          acHashes[tag] ? { tag, file: rel, guardAcHash: acHashes[tag] } : { tag, file: rel }
        )));
      }
    }

    // Form 2 — annotation-declared (regression + e2e): a `// @ac-hash: <tag>
    // sha256:<hex>` annotation whose tag also appears in a test title is an
    // explicit, auditable claim "this test guards this spec". It registers
    // under the TEST FILE'S OWN PATH, so guards over sources the bucket map
    // calls INERT (package.json, release.yml, bin/) and guards that live in
    // the browser suite still count as coverage in the AC classifier — without
    // widening what counts as a corroborated PRODUCT source (corroborated()
    // looks up product paths; a test-file key can never collide with one).
    for (const tag of tags) {
      if (!acHashes[tag]) continue;
      (bySource[rel] = bySource[rel] || []).push({ tag, file: rel, guardAcHash: acHashes[tag] });
    }
  }
  const sorted = {};
  let guardCount = 0;
  const TEST_KEY_RE = /^(regression\/.+\.test\.js|e2e\/.+\.spec\.js)$/;
  for (const s of Object.keys(bySource).sort()) {
    const seen = new Set();
    const list = bySource[s]
      .sort((a, b) => (a.tag === b.tag ? (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) : (a.tag < b.tag ? -1 : 1)))
      .filter(e => { const k = e.tag + '|' + e.file; if (seen.has(k)) return false; seen.add(k); return true; });
    sorted[s] = list;
    // guardCount is the anti-shrink ratchet's currency (lib/tests-needed.js
    // compares it base-vs-head) and counts READ-CORROBORATED (form-1) entries
    // ONLY. Annotation-declared (form-2) entries are classification signals,
    // not corroboration — letting them into the count would allow annotation
    // churn to mask a real loss of product-source coverage.
    if (!TEST_KEY_RE.test(s)) guardCount += list.length;
  }
  return { generator: 'scripts/build-coverage-map.js', guardCount, bySource: sorted };
}

function serialize(map) { return JSON.stringify(map, null, 2) + '\n'; }

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const lockPath = path.join(repoRoot, 'regression', 'COVERAGE.lock');
  const map = buildCoverageMap(repoRoot);
  const next = serialize(map);
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = fs.readFileSync(lockPath, 'utf8'); } catch (_) {}
    if (cur !== next) {
      console.error('COVERAGE.lock is STALE — run: node scripts/build-coverage-map.js');
      process.exit(1);
    }
    console.log(`COVERAGE.lock up to date (${map.guardCount} guards over ${Object.keys(map.bySource).length} sources).`);
    return;
  }
  fs.writeFileSync(lockPath, next);
  console.log(`Wrote regression/COVERAGE.lock — ${map.guardCount} guards over ${Object.keys(map.bySource).length} sources.`);
}

// walkSpecs joins the exports for lib/apply-draft.js: the apply path mirrors the suite into
// a scratch root to predict what applying a guard would do, and a mirror assembled from
// anything but the deriver's OWN walkers could quietly disagree with the map it predicts.
module.exports = { buildCoverageMap, sourcesReadBy, tagsIn, acHashesIn, walkTests, walkSpecs, serialize };

if (require.main === module) main();

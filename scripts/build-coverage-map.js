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
// Coverage is established by `readFileSync(<source>)` inside a regression test —
// the test loads the real source and asserts against its bytes. We resolve the
// path argument statically: const SERVER_SRC = path.resolve(__dirname, …) and
// inline path.resolve/join(__dirname, …). Dynamic (tmp/fixture) paths resolve to
// null and are ignored, so only genuine source reads become guards.
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
const READ_CONST_RE = /\breadFileSync\(\s*([A-Za-z_$][\w$]*)\b/g;
const READ_INLINE_RE = /\breadFileSync\(\s*path\.(?:resolve|join)\(([^)]*)\)/g;

// Split a flat path.resolve/join arg list (no nested parens in our call sites).
function splitArgs(raw) {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Resolve a path.resolve/join arg list to an absolute path, or null if any
// segment is dynamic (a tmp var, a template literal, an unknown identifier).
function resolveArgs(raw, sym, dirAbs) {
  const parts = [];
  const args = splitArgs(raw);
  for (const a of args) {
    const q = a.match(/^['"`]([^'"`${}]*)['"`]$/); // plain string literal only
    if (q) { parts.push(q[1]); continue; }
    if (a === '__dirname') { parts.push(dirAbs); continue; }
    if (Object.prototype.hasOwnProperty.call(sym, a)) { parts.push(sym[a]); continue; }
    return null; // dynamic segment → not a static source path
  }
  if (!parts.length || !path.isAbsolute(parts[0])) return null;
  return path.resolve(...parts);
}

// All BEHAVIOUR-bucketed source files that this test file reads via readFileSync.
function sourcesReadBy(src, fileAbs, repoRoot) {
  const dirAbs = path.dirname(fileAbs);
  const sym = Object.create(null);
  let m;
  CONST_RE.lastIndex = 0;
  while ((m = CONST_RE.exec(src))) {
    const abs = resolveArgs(m[2], sym, dirAbs);
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
  READ_CONST_RE.lastIndex = 0;
  while ((m = READ_CONST_RE.exec(src))) add(sym[m[1]]);
  READ_INLINE_RE.lastIndex = 0;
  while ((m = READ_INLINE_RE.exec(src))) add(resolveArgs(m[1], sym, dirAbs));
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

// Walk regression/**/*.test.js, repo-relative POSIX paths, sorted.
function walkTests(repoRoot) {
  const root = path.join(repoRoot, 'regression');
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.test.js')) out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}

function buildCoverageMap(repoRoot) {
  const bySource = Object.create(null);
  for (const rel of walkTests(repoRoot)) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const sources = sourcesReadBy(src, path.join(repoRoot, rel), repoRoot);
    if (!sources.size) continue;
    const tags = tagsIn(src);
    if (!tags.length) continue;
    const acHashes = acHashesIn(src);
    for (const s of sources) {
      (bySource[s] = bySource[s] || []).push(...tags.map(tag => (
        acHashes[tag] ? { tag, file: rel, guardAcHash: acHashes[tag] } : { tag, file: rel }
      )));
    }
  }
  const sorted = {};
  let guardCount = 0;
  for (const s of Object.keys(bySource).sort()) {
    const seen = new Set();
    const list = bySource[s]
      .sort((a, b) => (a.tag === b.tag ? (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) : (a.tag < b.tag ? -1 : 1)))
      .filter(e => { const k = e.tag + '|' + e.file; if (seen.has(k)) return false; seen.add(k); return true; });
    sorted[s] = list;
    guardCount += list.length;
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

module.exports = { buildCoverageMap, sourcesReadBy, tagsIn, acHashesIn, walkTests, serialize };

if (require.main === module) main();

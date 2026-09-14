'use strict';

/**
 * Journey: J-check-draft-review (Tier 1 — in-process, real repo)
 * Category: Gate & Merge
 *
 * Slice 356. The CHECK overlay used to print a draft's BASENAME and tell the operator to
 * "review it, then move it into the suite" — while no route could serve the file. The
 * thing being blessed was unreadable. These guards pin the read path:
 *
 *   ac-1  a drafted guard's source AND Julian's rationale come back for a flagged AC.
 *   ac-2  when the AC already has a live guard, the draft comes back diffed against it,
 *         so a rewrite is never mistaken for a fresh test.
 *   ac-3  only files under regression/.drafts/ are served; traversal and unknown tags
 *         are refused, and the directory is never listed.
 *   ac-4  the slice adds no route or control that modifies, moves or deletes a file.
 *   trap1 a draft name carries no target path, so an unmatched draft says "unmatched" —
 *         it never claims to be a new file — and every live guard is named.
 *   trap2 draft source is arbitrary JavaScript. _esc() escapes entities but not quotes,
 *         so source reaches the DOM as a text node and attributes use _escAttr().
 *   trap3 reading a draft must not disturb Julian's in-flight `.running` marker — the
 *         obvious implementation (reuse authoringStateFor) UNLINKS it.
 *   trap4 regression/.drafts/ stays gitignored and untracked; no draft is ever committed.
 *
 * Fixtures are written into the real (gitignored) regression/.drafts/ with a tag no
 * slice uses, exactly as j-check-authoring.test.js does, and removed again.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { draftDetailFor, authoringStateFor, liveGuardsForTag } = require('../../dashboard/server');

const REPO      = path.resolve(__dirname, '..', '..');
const DRAFTS    = path.join(REPO, 'regression', '.drafts');
const HTML      = fs.readFileSync(path.join(REPO, 'dashboard', 'lcars-dashboard.html'), 'utf8');
const SERVER    = fs.readFileSync(path.join(REPO, 'dashboard', 'server.js'), 'utf8');
const MUTATORS  = /\b(writeFileSync|appendFileSync|unlinkSync|renameSync|rmSync|rmdirSync|mkdirSync|copyFileSync|createWriteStream|chmodSync|spawn|execFileSync|execSync)\b/;

const made = new Set();
function mk(name, body) {
  fs.mkdirSync(DRAFTS, { recursive: true });
  fs.writeFileSync(path.join(DRAFTS, name), body == null ? 'x' : body);
  made.add(name);
}
after(() => { for (const n of made) { try { fs.unlinkSync(path.join(DRAFTS, n)); } catch (_) {} } });

// Brace-match a top-level `function NAME(...) { ... }` out of the source, so a guard on
// what a function may contain doesn't depend on what happens to sit next to it.
function fnSource(src, name) {
  const at = src.indexOf(`\nfunction ${name}(`);
  assert.notEqual(at, -1, `${name}() must exist in dashboard/server.js`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail(`could not brace-match ${name}()`);
}

// A tag that COVERAGE.lock already guards with a real, diffable file on disk. Derived at
// run time rather than hard-coded, so retiring one guard can't turn this red for the
// wrong reason.
function taggedLiveGuard() {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'regression', 'COVERAGE.lock'), 'utf8'));
  for (const guards of Object.values(lock.bySource || {})) {
    for (const g of (guards || [])) {
      if (!g || !g.tag || !g.file) continue;
      const abs = path.join(REPO, g.file);
      if (!fs.existsSync(abs)) continue;
      const source = fs.readFileSync(abs, 'utf8');
      if (source.split('\n').length > 700) continue;          // stay under the diff ceiling
      return { tag: g.tag, file: g.file, source };
    }
  }
  assert.fail('COVERAGE.lock carries no guard whose file is on disk');
}

test('J-check-draft-review slice-356-ac-1 — a drafted guard comes back with its source and Julian\'s rationale', () => {
  mk('slice-99977-ac-1.draft.test.js', "'use strict';\n// the drafted guard\n");
  mk('slice-99977-ac-1.rationale.txt', 'UPDATE (not new): retargeted the colour assertion.\n');

  const d = draftDetailFor('slice-99977-ac-1');
  assert.equal(d.error, undefined, 'a drafted AC must be readable');
  assert.match(d.draft.source, /the drafted guard/, 'the draft SOURCE, not just its basename');
  assert.match(d.rationale, /UPDATE \(not new\)/, 'Julian\'s rationale must come back too');
  assert.equal(d.draft.path, 'regression/.drafts/slice-99977-ac-1.draft.test.js');

  // …and the overlay reads it in place, from the dashboard's own origin.
  assert.match(HTML, /_toggleDraft\('\$\{_escAttr\(it\.tag\)\}', this\)/, 'the drafted card must offer a read control');
  assert.match(HTML, /fetch\('\/api\/check-test-updates\/draft\?tag=' \+ encodeURIComponent\(tag\)/,
    'the control must fetch the draft endpoint — no leaving the dashboard');
  assert.match(HTML, /why\.textContent = d\.rationale/, 'the rationale must be rendered, not just fetched');
});

test('J-check-draft-review slice-356-ac-2 — a draft for an already-guarded AC comes back diffed against that guard', () => {
  const live = taggedLiveGuard();
  const lines = live.source.split('\n');
  mk(`${live.tag}.draft.test.js`, ['// a rewrite, not a new file'].concat(lines.slice(1)).join('\n'));

  const d = draftDetailFor(live.tag);
  assert.equal(d.kind, 'rewrite', 'an AC with a live guard must read as a rewrite');
  const target = (d.live || []).find(l => l.target);
  assert.ok(target, 'the response must name WHICH live guard the draft is shown against');
  assert.ok(d.diff, 'a rewrite must carry a diff');
  assert.equal(d.diff.against, target.path);
  assert.ok(d.diff.added > 0 && d.diff.removed > 0, `the diff must be real (+${d.diff.added} -${d.diff.removed})`);
  assert.ok(d.diff.lines.some(l => l.op === '+' && /a rewrite, not a new file/.test(l.text)),
    'the added line must show up on the + side');
  assert.ok(d.diff.lines.some(l => l.op === ' '), 'unchanged lines are kept as context');
});

test('J-check-draft-review slice-356-ac-3 — the endpoint serves only regression/.drafts/, refusing traversal and unknown tags', () => {
  for (const bad of ['../../etc/passwd', 'slice-1-ac-1/../../../etc/passwd', '..', '', null, undefined,
                     'slice-1-ac-1.draft.test.js', 'COVERAGE.lock', 'slice-1-ac', 'slice-x-ac-1']) {
    assert.equal(draftDetailFor(bad).error, 'bad_tag', `tag ${JSON.stringify(bad)} must be refused outright`);
  }
  const miss = draftDetailFor('slice-99976-ac-4');
  assert.equal(miss.error, 'no_draft', 'a well-formed tag with no draft is a plain miss');
  assert.equal(miss.draft, undefined, 'a refusal carries no file content');
  assert.equal(miss.names, undefined, 'a refusal never lists the drafts directory');

  // A rationale that is NOT beside a draft is not reachable on its own, and the sibling
  // crew-artifact allowlist is left exactly as it was — it still cannot reach .drafts/.
  mk('slice-99975-ac-1.rationale.txt', 'orphan');
  assert.equal(draftDetailFor('slice-99975-ac-1').error, 'no_draft');
  assert.match(SERVER, /function isDeclaredArtifact\(role, relPath\) \{\s*return \(CREW_ARTIFACTS\[role\] \|\| \[\]\)\.some/,
    'the crew-artifact allowlist must stay membership-only');
  assert.ok(!/CREW_ARTIFACTS[\s\S]{0,4000}?\.drafts/.test(SERVER), 'no crew artifact may point into .drafts/');
});

// Moved by slice 358, which was commissioned to add the apply control this test was
// written to forbid. What 356-ac-4 was protecting — that READING a draft cannot write, and
// that nothing moves or deletes one — is still true and is still asserted here. What is no
// longer true is "no control writes at all": the write now exists, and the assertion moves
// to what makes it safe rather than pretending it is absent.
//   Declared as: Test-Loosen-OK: slice-356-ac-4 reworded
// The AC's own TEXT is Philipp's to restate; this file only follows the spec change.
test('J-check-draft-review slice-356-ac-4 — reading a draft still writes nothing, and the write that exists is a separate, gated route', () => {
  // Every route that can reach a draft is GET.
  const routes = SERVER.match(/if \(pathname === '[^']*draft[^']*'[^)]*\)/g) || [];
  assert.ok(routes.length >= 1, 'the draft route must exist');
  for (const r of routes) assert.match(r, /req\.method === 'GET'/, `${r} must be GET-only`);

  // Nothing on the read path can write, move, delete or spawn.
  for (const fn of ['draftDetailFor', 'safeDraftFile', 'liveGuardsForTag', 'lineDiff', 'pickDiffTarget']) {
    const body = fnSource(SERVER, fn);
    assert.ok(!MUTATORS.test(body), `${fn}() must not call a mutating fs/spawn API`);
  }
  const routeAt = SERVER.indexOf("if (pathname === '/api/check-test-updates/draft'");
  assert.ok(!MUTATORS.test(SERVER.slice(routeAt, SERVER.indexOf('\n  }\n', routeAt))), 'the route body must not mutate');

  // Reading a draft in the overlay is still a GET, and still the whole of what the READ
  // control does.
  const toggle = HTML.slice(HTML.indexOf('async function _toggleDraft'), HTML.indexOf('function _draftCode'));
  assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(toggle), 'reading a draft must be a GET');

  // A draft is still never moved or deleted from the UI — applying one COPIES its source
  // to the declared target and leaves regression/.drafts/ byte-identical (trap 3, below).
  assert.ok(!/_moveDraft|_deleteDraft/.test(HTML), 'no control may move or delete a draft');

  // The write that slice 358 added is a SEPARATE route from the read, it is a POST, and it
  // is refused unless it can show it came from the dashboard. Those three facts are what
  // replaced "there is no write at all".
  const write = SERVER.indexOf("if (pathname === '/api/check-test-updates/apply' && req.method === 'POST')");
  assert.notEqual(write, -1, 'the apply is its own POST route, not a mode of the draft route');
  assert.match(SERVER.slice(write, write + 700), /classifyApprovalOrigin\(req\)/,
    'and it refuses a request that cannot show it came from the dashboard UI');
  assert.ok(!/pathname === '[^']*draft[^']*'[^)]*req\.method === 'POST'/.test(SERVER),
    'no route whose path names a draft may write — the write route is named for what it does');
});

test('J-check-draft-review slice-356-trap-1 — an unmatched draft says so; it never claims to be a new file', () => {
  mk('slice-99974-ac-1.draft.test.js', '// nothing in COVERAGE.lock carries this tag\n');
  const d = draftDetailFor('slice-99974-ac-1');
  assert.equal(d.kind, 'unmatched', 'no live guard → unmatched, never "new"');
  assert.deepEqual(d.live, [], 'nothing to name');
  assert.equal(d.diff, null, 'there is nothing to diff against');

  // Every live guard is named, and exactly one is the diff target — a tag guarded in two
  // suites (a node test AND an e2e spec) must not silently drop one.
  const live = taggedLiveGuard();
  assert.ok(liveGuardsForTag(live.tag).includes(live.file), 'the live guard lookup must find the real guard');
  mk(`${live.tag}.draft.test.js`, live.source + '\n// rewritten\n');
  const r = draftDetailFor(live.tag);
  assert.equal(r.live.length, liveGuardsForTag(live.tag).length, 'every live guard is listed');
  assert.equal(r.live.filter(l => l.target).length, 1, 'exactly one guard is the diff target');

  // The rendered sentences carry the same distinction.
  const panel = HTML.slice(HTML.indexOf('function _renderDraftPanel'), HTML.indexOf('// One CHECK press kicks Julian off'));
  assert.match(panel, /The draft is a rewrite of/, 'the matched case names the live guard');
  assert.match(panel, /unmatched/, 'the unmatched case says unmatched');
  assert.ok(!/new file/.test(panel.replace(/never claims "new file"/g, '')), 'the panel must never assert "new file"');
});

test('J-check-draft-review slice-356-trap-2 — draft source reaches the DOM as text, and attributes are quote-escaped', () => {
  // _esc() escapes entities but NOT quotes, so it is unsafe inside an attribute.
  assert.match(HTML, /function _escAttr\(s\) \{ return _esc\(s\)\.replace\(\/"\/g,'&quot;'\)\.replace\(\/'\/g,'&#39;'\); \}/,
    'an attribute-safe escaper must exist');

  const panel = HTML.slice(HTML.indexOf('  // ── Reading a draft (slice 356)'), HTML.indexOf('// One CHECK press kicks Julian off'));
  assert.ok(!/\.innerHTML\s*(=|\+=)/.test(panel), 'the draft panel must never assign innerHTML');
  assert.match(panel, /pre\.textContent = String\(text == null \? '' : text\)/, 'draft source is set as a text node');
  assert.match(panel, /span\.textContent = text \+ '\\n'/, 'each diff line is a text node');
  assert.match(panel, /why\.textContent = d\.rationale/, 'the rationale is text, not markup');

  // Every attribute this slice interpolates a tag into is escaped for quotes.
  const cardAt = HTML.indexOf('const drafted = a.state ===');
  assert.notEqual(cardAt, -1, 'the drafted-card branch must exist');
  const card = HTML.slice(cardAt, HTML.indexOf('body.innerHTML = html;', cardAt));
  for (const m of card.match(/(id|aria-controls|onclick)="[^"]*\$\{_esc\(/g) || []) {
    assert.fail(`attribute interpolation must use _escAttr, found: ${m}`);
  }
  assert.match(card, /id="utc-draft-\$\{_escAttr\(it\.tag\)\}"/, 'the panel id is attribute-escaped');
});

test('J-check-draft-review slice-356-trap-3 — reading a draft leaves the drafts directory byte-identical', () => {
  mk('slice-99973-ac-1.draft.test.js', '// draft\n');
  mk('slice-99973-ac-1.running', '2026-09-05T00:00:00.000Z');
  const snap = () => fs.readdirSync(DRAFTS).sort()
    .map(n => n + ':' + fs.readFileSync(path.join(DRAFTS, n), 'utf8').length).join('|');

  const before = snap();
  draftDetailFor('slice-99973-ac-1');
  draftDetailFor('slice-99973-ac-1');
  draftDetailFor('../../etc/passwd');
  assert.equal(snap(), before, 'reading a draft must write, move and delete nothing');
  assert.ok(fs.existsSync(path.join(DRAFTS, 'slice-99973-ac-1.running')),
    'the read path must not clear Julian\'s in-flight marker');

  // For contrast — and to pin WHY draftDetailFor may not be built on it: the status
  // helper unlinks that marker as a side effect.
  authoringStateFor('slice-99973-ac-1');
  assert.ok(!fs.existsSync(path.join(DRAFTS, 'slice-99973-ac-1.running')),
    'authoringStateFor DOES unlink .running — reusing it here would have made the read a write');
});

test('J-check-draft-review slice-356-trap-4 — regression/.drafts/ stays gitignored and untracked', () => {
  const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.match(ignore, /^regression\/\.drafts\/$/m, 'the drafts directory must stay ignored');

  mk('slice-99972-ac-1.draft.test.js', '// must never be committed\n');
  const rel = 'regression/.drafts/slice-99972-ac-1.draft.test.js';
  let ignored = false;
  try { execFileSync('git', ['check-ignore', '--quiet', '--', rel], { cwd: REPO, stdio: 'ignore' }); ignored = true; }
  catch (_) { ignored = false; }                                  // non-zero exit = not ignored
  assert.ok(ignored, `${rel} must be ignored by git`);

  const tracked = execFileSync('git', ['ls-files', '--', 'regression/.drafts'], { cwd: REPO, encoding: 'utf8' }).trim();
  assert.equal(tracked, '', 'no draft may be tracked in git');
});

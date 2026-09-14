'use strict';
// ── author-sandbox.js — the box the authoring agent runs in (slice 359) ──────────────
//
// scripts/author-ac-test.js spawns `claude -p --permission-mode bypassPermissions`. Until
// this module it did so with `cwd` set to the repo root, and the ONLY thing keeping that
// agent out of the live suite was a sentence in its prompt ("do NOT modify anything outside
// the drafts directory"). An agent that misreads that sentence writes straight into
// regression/ or e2e/ — the exact "machine silently weakens the suite" outcome the whole
// test-update gate exists to prevent. Slice 359 adds a per-AC dispatch button, which
// multiplies how often that spawn happens, so the box ships with the button.
//
// ── Two layers, because neither is sufficient alone ──────────────────────────────────
//
// 1. PREVENTION — the agent runs in a throwaway `git worktree` in a tmpdir. It gets a real
//    checkout of HEAD (it must READ the suites: that is how it matches house style and
//    finds the guard that already touches an AC), but every write lands in a copy that is
//    deleted when the run ends. Only the tag-scoped draft artifacts are carried back.
//
// 2. DETECTION — after the agent exits, EVERY run is verified. The sandbox's own policed
//    directories must be clean, and no policed file in the real repo may have changed its
//    BYTES while the agent was running — including the ones that were already dirty when
//    it started, which a status-code comparison cannot see. A run that fails either check
//    has its draft withheld: it never reaches the review-and-apply path at all. What the
//    live half deliberately does NOT police is set out beside POLICED_DIRS below.
//
// The honest limit, stated once: an agent running with bypassPermissions as the same OS
// user can write to any absolute path on this machine. A worktree is not a jail. What the
// two layers buy is that (a) the obvious failure — the agent writing "the suite" it can
// see — cannot touch the real suite, and (b) an agent that reaches around the sandbox into
// the live checkout is CAUGHT and its work is thrown away rather than offered for review.
// Nothing here should ever be described as tamper-proof.
//
// Pure functions over (repoRoot, tag) plus git; the agent spawn itself is injected by the
// caller, so the whole pipeline is testable without spawning an agent.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TAG_RE = /^slice-\d+-ac-\d+$/;

// The directories a test-authoring run may never change. `bridge/` and `dashboard/` are
// not test suites; they are here because an agent that can rewrite the orchestrator or the
// server can rewrite the gate that judges it.
const POLICED_DIRS = ['regression', 'e2e', 'lib', 'scripts', 'dashboard', 'bridge'];

// ── Why the LIVE half polices less than the sandbox half ─────────────────────────────
// The sandbox is a clean room: it starts as a fresh checkout of HEAD, so every policed
// change in it is the agent's and the whole list above is exactly right.
//
// The live checkout is not a clean room — it is this system's RUNNING STATE. Under
// `bridge/` alone it currently carries 36 untracked-but-unignored files: the staged
// slices O'Brien writes (`bridge/staged/NNN-STAGED.md`), the per-role timesheets, anchors
// and tt-audit logs each `wrap-up` appends, `bridge/host-health.json`, plus
// `regression/AC-CHECK.json` and `regression/TEST-DRIFT.json`, which the gate itself
// rewrites. Any ONE of those appearing during the five-to-ten minutes an authoring run
// takes used to read as `CONTAINMENT BREACH`, name a file the agent never touched, and
// throw away a perfectly good draft. Staging a slice while Julian drafts was enough.
//
// So on the live side a path counts only if the agent could plausibly have written it:
//   * it is TRACKED — part of the repo, so a change to it is a change to the repo,
//     whatever it is named (this is what catches a rewritten guard or a gutted server); or
//   * it is a NEW file whose name says code (this is what catches an invented
//     `e2e/sneaky.spec.js` or `regression/gate-merge/j-rogue.test.js`).
//
// The gap that leaves, stated rather than hidden: UNTRACKED NON-CODE paths under a policed
// directory are not watched at all on this side — an agent reaching in with an absolute path
// could forge a `bridge/staged/999-STAGED.md`, or rewrite an existing untracked one, and this
// half would not see it. That is deliberate and it is not closeable from here: those are the
// very files this system rewrites on its own all day (`bridge/host-health.json` on every
// poll, a timesheet on every append), so hashing them would put Nog's finding straight back.
// It is a smaller hole than discarding real drafts on the system's own routine writes, and it
// is the sandbox's job to make reaching around at all the unlikely case.
const UNTRACKED = '??';
const CODE_FILE = /\.(?:js|cjs|mjs|jsx|ts|tsx|sh)$/;

/** Could an authoring agent plausibly have written this live-checkout path? */
function isLiveSuspect(rel, status) {
  if (!isPoliced(rel)) return false;
  if (status !== UNTRACKED) return true;
  return CODE_FILE.test(rel);
}

// The one writable hole in that list — where drafts are supposed to land.
const DRAFTS_REL = 'regression/.drafts';

// The artifacts a run legitimately produces for its tag. Anything else the agent leaves in
// the drafts directory stays in the sandbox and dies with it: a run authors for ONE AC.
const ARTIFACT_SUFFIXES = ['.QUESTION.md', '.rationale.txt', '.target.json'];
const isArtifactFor = (tag, name) =>
  name.startsWith(`${tag}.draft.`) || ARTIFACT_SUFFIXES.some(sfx => name === tag + sfx);

/** Is `rel` inside a policed directory and outside the drafts hole? */
function isPoliced(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return false;
  if (p === DRAFTS_REL || p.startsWith(DRAFTS_REL + '/')) return false;
  return POLICED_DIRS.some(d => p === d || p.startsWith(d + '/'));
}

/**
 * Parse `git status --porcelain=v1 -z --no-renames` into Map(path → 'XY').
 *
 * -z (never the default output) because a path with a space or a quote is SHELL-quoted in
 * the human-readable form, and a breach that unquoted itself into a different path would be
 * a breach we reported under the wrong name. --no-renames because a rename in the default
 * form is one record holding two paths, and this only needs "what is different now".
 */
function parsePorcelain(out) {
  const map = new Map();
  for (const rec of String(out == null ? '' : out).split('\0')) {
    if (!rec || rec.length < 4) continue;
    const status = rec.slice(0, 2);
    const p = rec.slice(3);
    if (p) map.set(p, status);
  }
  return map;
}

/** `git status` over the policed directories, or null when it could not be read. */
function porcelainOf(root) {
  try {
    // -uall lists every file inside a new directory rather than the directory alone, so an
    // agent that drops a whole `regression/whatever/` tree is named file by file. Ignored
    // paths are NOT listed, which is exactly right: regression/.drafts/ and node_modules
    // are gitignored, so the hole and the dependency link never read as breaches.
    return parsePorcelain(execFileSync('git',
      ['status', '--porcelain=v1', '-z', '-uall', '--no-renames', '--', ...POLICED_DIRS],
      { cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024 }));
  } catch (_) {
    // Not a git checkout, or git is unavailable. An unreadable snapshot is not evidence of
    // cleanliness — the caller treats a null snapshot as "could not verify", which fails
    // the run rather than passing it.
    return null;
  }
}

/**
 * What one path's BYTES are right now: a hash, or why there are none.
 *
 * The status code alone is not an answer. A file that reads ` M` before the run and ` M`
 * after it has the same code whatever happened to its contents in between — and in a live
 * checkout the files most likely to be already-dirty are exactly the ones somebody has open,
 * which is to say the most interesting ones to reach into. Content is the only signal that
 * survives that.
 */
function contentSig(root, rel) {
  const abs = path.join(root, rel);
  let st = null;
  try { st = fs.lstatSync(abs); } catch (_) { return 'absent'; }
  if (st.isSymbolicLink()) { try { return 'link:' + fs.readlinkSync(abs); } catch (_) { return 'link:?'; } }
  if (st.isDirectory()) return 'dir';
  try { return 'sha1:' + crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex'); }
  catch (_) { return 'unreadable'; }
}

/**
 * The policed changes in a checkout, as Map(path → { status, content }).
 *
 * Used on the SANDBOX, which starts as a clean checkout of HEAD: there, the whole policed
 * list is exactly right and the mere presence of a path is the breach, so no content is
 * read. `content: null` says so — the comparator falls back to the status code only when
 * neither side carries bytes.
 */
function policedSnapshot(root) {
  const all = porcelainOf(root);
  if (all === null) return null;
  const policed = new Map();
  for (const [p, status] of all) if (isPoliced(p)) policed.set(p, { status, content: null });
  return policed;
}

/**
 * The same, for the LIVE checkout: narrowed by isLiveSuspect(), and carrying bytes.
 *
 * `alsoHash` is the previous snapshot's paths. A file that was dirty before the run and has
 * since been committed — or reverted by the agent — drops out of `git status` entirely, so
 * without this it would simply vanish from the comparison and be verified by nobody. Hashed
 * explicitly, a commit reads as "same bytes, no breach" and a revert reads as the change it
 * is.
 */
function liveSnapshot(root, alsoHash) {
  const all = porcelainOf(root);
  if (all === null) return null;
  const snap = new Map();
  for (const [p, status] of all) {
    if (!isLiveSuspect(p, status)) continue;
    snap.set(p, { status, content: contentSig(root, p) });
  }
  for (const p of (alsoHash || [])) {
    if (snap.has(p)) continue;
    const content = contentSig(root, p);
    // Git no longer reports it: either it matches the index again, or it is gone.
    snap.set(p, { status: content === 'absent' ? ' D' : '==', content });
  }
  return snap;
}

/** Same path, same state? Bytes decide whenever either side has them. */
function sameEntry(a, b) {
  if (!a || !b) return false;
  if (a.content != null || b.content != null) return a.content === b.content;
  return a.status === b.status;
}

/**
 * What appeared or changed between two snapshots of the same checkout.
 *
 * The real repo is a LIVE working tree: it routinely holds somebody's uncommitted work, so
 * "is it clean?" is the wrong question there and would fail every run. The right question
 * is whether anything policed became different WHILE the agent was running — which is why
 * this walks the UNION of both sides and compares bytes, not the newer side's status codes.
 */
function newBreaches(before, after) {
  const was = before || new Map();
  const now = after || new Map();
  const out = [];
  for (const p of new Set([...was.keys(), ...now.keys()])) {
    if (sameEntry(was.get(p), now.get(p))) continue;   // unchanged since before the spawn
    const b = now.get(p);
    out.push({ path: p, status: b ? b.status : 'gone' });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Every policed change in a checkout, as breaches. Used on the sandbox, which starts clean. */
function allBreaches(snapshot) {
  return newBreaches(new Map(), snapshot);
}

const sandboxDraftsDir = (dir) => path.join(dir, DRAFTS_REL);

/**
 * A throwaway checkout of HEAD, outside the repo, with a drafts directory to write into.
 *
 * `--detach` so the sandbox is on no branch: nothing the agent does can move a real ref,
 * and the worktree can be thrown away without touching branch state. node_modules is
 * symlinked the way every other workspace gets it (orchestrator.provisionWorkspaceDeps) so
 * the agent can run its own draft if it wants to — inside the sandbox.
 */
function createSandbox(repoRoot, tag) {
  // A run that was killed (the orchestrator's buffer kill, a restart) leaves a worktree
  // registration pointing at a tmpdir the OS later sweeps. Pruning first keeps `git
  // worktree list` honest instead of accumulating one dead entry per interrupted run.
  try {
    execFileSync('git', ['worktree', 'prune'],
      { cwd: repoRoot, encoding: 'utf8', timeout: 30000, stdio: 'ignore' });
  } catch (_) {}
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `ds9-author-${tag}-`));
  const dir = path.join(base, 'wt');
  execFileSync('git', ['worktree', 'add', '--detach', dir, 'HEAD'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  const drafts = sandboxDraftsDir(dir);
  fs.mkdirSync(drafts, { recursive: true });
  try {
    const source = path.join(repoRoot, 'node_modules');
    if (fs.existsSync(source)) fs.symlinkSync(source, path.join(dir, 'node_modules'), 'dir');
  } catch (_) { /* no dependencies is a worse sandbox, not a reason to refuse the run */ }
  return {
    dir, drafts,
    remove() {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', dir],
          { cwd: repoRoot, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (_) { /* fall through to the unlink below */ }
      try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
      try {
        execFileSync('git', ['worktree', 'prune'],
          { cwd: repoRoot, encoding: 'utf8', timeout: 30000, stdio: 'ignore' });
      } catch (_) {}
    },
  };
}

/**
 * Carry this tag's artifacts out of the sandbox and into the real drafts directory.
 *
 * Tag-scoped and regular-files-only. lstat, not stat: a symlink named `<tag>.draft.test.js`
 * pointing at a file elsewhere on disk would otherwise be copied out by its CONTENT, which
 * is a way to smuggle an arbitrary file into the review panel under a draft's name.
 */
function harvestArtifacts(fromDir, toDir, tag) {
  let names = [];
  try { names = fs.readdirSync(fromDir); } catch (_) { return []; }
  fs.mkdirSync(toDir, { recursive: true });
  const taken = [];
  for (const name of names.sort()) {
    if (!isArtifactFor(tag, name)) continue;
    const src = path.join(fromDir, name);
    let st = null;
    try { st = fs.lstatSync(src); } catch (_) { continue; }
    if (!st.isFile()) continue;
    try {
      fs.writeFileSync(path.join(toDir, name), fs.readFileSync(src));
      taken.push(name);
    } catch (_) { /* one unreadable artifact must not lose the others */ }
  }
  return taken;
}

/**
 * This tag's artifacts as { name, source } text, capped. Nothing is written: this is how a
 * WITHHELD draft is preserved for reading without existing as an appliable file anywhere.
 */
const WITHHELD_CAP = 64 * 1024;
function readArtifacts(fromDir, tag) {
  let names = [];
  try { names = fs.readdirSync(fromDir); } catch (_) { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (!isArtifactFor(tag, name)) continue;
    const p = path.join(fromDir, name);
    let st = null;
    try { st = fs.lstatSync(p); } catch (_) { continue; }
    if (!st.isFile()) continue;
    let source = '';
    try { source = fs.readFileSync(p, 'utf8').slice(0, WITHHELD_CAP); } catch (_) { continue; }
    out.push({ name, source });
  }
  return out;
}

/**
 * The breach list, as the sentence an operator reads.
 *
 * `[live checkout]` marks the half that watches the real repo, where two codes are this
 * module's own rather than git's: `==` is "git no longer calls this changed, but its bytes
 * are not what they were when the run started", and a line with no `[live checkout]` prefix
 * came from the sandbox, where every entry is the agent's by construction.
 */
function formatBreaches(breaches) {
  if (!breaches || !breaches.length) return '';
  return breaches.map(b => `  ${b.status || '??'}  ${b.where === 'repo' ? '[live checkout] ' : ''}${b.path}`).join('\n');
}

/**
 * Run one authoring attempt inside the box.
 *
 *   runAgent({ cwd, draftsDir }) — the caller's spawn. Everything it writes lands in a
 *   worktree that is deleted before this function returns.
 *
 * Returns { ok, breaches, harvested, agent, error }. `ok:false` with a non-empty `breaches`
 * is a containment failure: NOTHING was harvested, so the draft cannot reach the review
 * path — it is withheld by construction rather than deleted after arrival.
 */
function runContained({ repoRoot, tag, draftDir, runAgent }) {
  if (!TAG_RE.test(String(tag || ''))) return { ok: false, breaches: [], harvested: [], error: 'bad tag' };
  const before = liveSnapshot(repoRoot);
  let sandbox = null;
  try { sandbox = createSandbox(repoRoot, tag); }
  catch (err) { return { ok: false, breaches: [], harvested: [], error: `could not create the sandbox worktree: ${err && err.message || err}` }; }

  let agent = null, error = null, harvested = [], withheld = [];
  const breaches = [];
  try {
    try { agent = runAgent({ cwd: sandbox.dir, draftsDir: sandbox.drafts }); }
    catch (err) { error = String(err && err.message || err); }

    // ── Verify, every run, before anything is carried out of the box ────────────────
    const inSandbox = policedSnapshot(sandbox.dir);
    if (inSandbox === null) {
      error = error || 'the sandbox could not be inspected after the run — containment unverified';
    } else {
      for (const b of allBreaches(inSandbox)) breaches.push({ ...b, where: 'sandbox' });
    }
    const after = liveSnapshot(repoRoot, before ? [...before.keys()] : []);
    if (before === null || after === null) {
      error = error || 'the live checkout could not be inspected — containment unverified';
    } else {
      for (const b of newBreaches(before, after)) breaches.push({ ...b, where: 'repo' });
    }

    if (!breaches.length && !error) {
      harvested = harvestArtifacts(sandbox.drafts, draftDir || path.join(repoRoot, DRAFTS_REL), tag);
    } else if (breaches.length) {
      // Read, never copy. The operator asked for a guard and should be able to READ what
      // the agent wrote before re-running, but a withheld draft must not exist as a file
      // the apply path could pick up — so it comes back as text, and the caller quotes it
      // inside a failure report rather than leaving a `.draft.` file on disk.
      withheld = readArtifacts(sandbox.drafts, tag);
    }
  } finally {
    // The sandbox goes, whatever happened above. A throw between the spawn and the harvest
    // must not leave a checkout of this repo lying in the tmpdir with an agent's writes in it.
    sandbox.remove();
  }
  return { ok: !breaches.length && !error, breaches, harvested, withheld, agent, error };
}

module.exports = {
  POLICED_DIRS, DRAFTS_REL, TAG_RE, CODE_FILE,
  isPoliced, isLiveSuspect, parsePorcelain, contentSig,
  policedSnapshot, liveSnapshot, newBreaches, allBreaches,
  createSandbox, sandboxDraftsDir, harvestArtifacts, readArtifacts, isArtifactFor, formatBreaches, runContained,
};

'use strict';

// J-dashboard-service — slice 403: the dashboard runs under launchd, not under whatever
// terminal happened to start it.
//
// Philipp read the symptom as "the server keeps crashing". The dashboard was not crashing;
// it had no supervisor, so it died with its parent and never came back. The orchestrator
// already had a launchd agent; this slice gives the dashboard the same shape.
//
// Coverage:
//  - the plist is valid and carries every key launchd needs to keep it up (AC-1)
//  - install-dashboard-service.sh symlinks and loads, through overridable plumbing (AC-2)
//  - a second install succeeds, leaves one symlink, and unloads before loading (AC-3)
//  - trap 1: ln without -n follows an existing link instead of replacing it
//  - trap 2: on a first install nothing is loaded, and an unguarded unload aborts set -e
//  - trap 3: a fresh machine has no LaunchAgents directory at all
//
// The install script is never run against the host: LAUNCH_AGENTS_DIR and LAUNCHCTL are
// redirected into a tmpdir, and HOME is redirected too so that a regression which ignores
// the overrides still cannot reach ~/Library/LaunchAgents.
//
// @ac-hash: slice-403-ac-1 sha256:14eaed2d27774f8e1551202271fa55d450aad983560260c9770e336df9b8904d
// @ac-hash: slice-403-ac-2 sha256:b39cc1dfb209a9e1af871cf30f954cdc489850eda5c1030b198bbb7dc54fac50
// @ac-hash: slice-403-ac-3 sha256:fc7ad4085f455cc8d1db2600366342f4eea631e2ef80f0b3e0e38e4e8999020f

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const LABEL      = 'dev.denorios.dashboard';
const PLIST_SRC  = path.join(REPO_ROOT, 'scripts', `${LABEL}.plist`);
const ORCH_PLIST = path.join(REPO_ROOT, 'scripts', 'dev.denorios.orchestrator.plist');
const INSTALL_SH = path.join(REPO_ROOT, 'scripts', 'install-dashboard-service.sh');

// ── a minimal XML-plist reader ─────────────────────────────────────────────
// CI is ubuntu-latest, so plutil is not there to parse with. This handles the five
// element kinds a launchd agent uses; plutil -lint still runs below where it exists.

function tokenize(xml) {
  const re = /<(\/?)([a-zA-Z0-9]+)[^>]*?(\/?)>/g;
  const out = [];
  let m, last = 0;
  while ((m = re.exec(xml)) !== null) {
    const text = xml.slice(last, m.index);
    last = re.lastIndex;
    if (text.trim()) out.push({ type: 'text', value: text });
    out.push({ type: 'tag', name: m[2], close: m[1] === '/', self: m[3] === '/' });
  }
  return out;
}

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function parseValue(toks, i) {
  const t = toks[i];
  assert.ok(t && t.type === 'tag' && !t.close, `expected a plist value at token ${i}`);
  if (t.name === 'true')  return [true, i + 1];
  if (t.name === 'false') return [false, i + 1];
  if (t.name === 'dict' || t.name === 'array') {
    const isDict = t.name === 'dict';
    const acc = isDict ? {} : [];
    let j = i + 1;
    for (;;) {
      const tok = toks[j];
      assert.ok(tok, `unterminated <${t.name}>`);
      if (tok.type === 'tag' && tok.name === t.name && tok.close) return [acc, j + 1];
      if (isDict) {
        assert.equal(tok.name, 'key', 'a dict entry starts with <key>');
        const key = decode(toks[j + 1].value.trim());
        const [v, next] = parseValue(toks, j + 3); // skip <key> TEXT </key>
        acc[key] = v;
        j = next;
      } else {
        const [v, next] = parseValue(toks, j);
        acc.push(v);
        j = next;
      }
    }
  }
  if (t.name === 'string' || t.name === 'integer' || t.name === 'real') {
    let j = i + 1;
    let text = '';
    if (toks[j] && toks[j].type === 'text') { text = toks[j].value; j++; }
    j++; // closing tag
    return [t.name === 'string' ? decode(text) : Number(decode(text)), j];
  }
  throw new Error(`unsupported plist element <${t.name}>`);
}

function parsePlist(file) {
  const toks = tokenize(fs.readFileSync(file, 'utf8'));
  const root = toks.findIndex(t => t.type === 'tag' && t.name === 'plist' && !t.close);
  assert.ok(root >= 0, `${file} has a <plist> root`);
  return parseValue(toks, root + 1)[0];
}

// ── a launchctl stub that behaves like the real one ────────────────────────
// It records every invocation and keeps a loaded-set on disk, so `load` of an
// already-loaded job fails the way launchctl's does ("service already loaded").
// That is what makes AC-3 mean something: skip the unload and the second run dies.

const STUB_LAUNCHCTL = `#!/usr/bin/env bash
STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
printf '%s\\n' "$*" >> "$STATE_DIR/launchctl.log"
cmd="\${1:-}"; shift || true
case "$cmd" in
  list)
    label="\${1:-}"
    [ -n "$label" ] || exit 0
    if [ -f "$STATE_DIR/loaded-$label" ]; then
      printf '{ "Label" = "%s"; "PID" = 4747; };\\n' "$label"; exit 0
    fi
    echo "Could not find service \\"$label\\"" >&2; exit 113 ;;
  load)
    label="$(basename "\${1:-}" .plist)"
    if [ -f "$STATE_DIR/loaded-$label" ]; then
      echo "service already loaded" >&2; exit 5
    fi
    : > "$STATE_DIR/loaded-$label" ;;
  unload)
    label="$(basename "\${1:-}" .plist)"
    if [ ! -f "$STATE_DIR/loaded-$label" ]; then
      echo "Could not find specified service" >&2; exit 113
    fi
    rm -f "$STATE_DIR/loaded-$label" ;;
esac
exit 0
`;

function sandbox(t, name) {
  const dir = makeTmpDir(`ds9-dashboard-service-${name}`);
  t.after(() => removeTmpDir(dir));
  const stubDir = path.join(dir, 'stub');
  fs.mkdirSync(stubDir, { recursive: true });
  const launchctl = path.join(stubDir, 'launchctl');
  fs.writeFileSync(launchctl, STUB_LAUNCHCTL);
  fs.chmodSync(launchctl, 0o755);
  return {
    dir, stubDir, launchctl,
    agents: path.join(dir, 'LaunchAgents'),
    logFile: path.join(stubDir, 'launchctl.log'),
    loadedMarker: path.join(stubDir, `loaded-${LABEL}`),
  };
}

function install(sb, agentsDir = sb.agents) {
  return spawnSync('bash', [INSTALL_SH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      LAUNCH_AGENTS_DIR: agentsDir,
      LAUNCHCTL: sb.launchctl,
      // If a regression ever ignores LAUNCH_AGENTS_DIR, the fallback lands here.
      HOME: sb.dir,
    },
  });
}

const readLog = sb => (fs.existsSync(sb.logFile)
  ? fs.readFileSync(sb.logFile, 'utf8').split('\n').filter(Boolean)
  : []);
const clearLog = sb => { fs.rmSync(sb.logFile, { force: true }); };
const installedAt = agentsDir => path.join(agentsDir, `${LABEL}.plist`);

// ── AC-1 ───────────────────────────────────────────────────────────────────

test('slice-403-ac-1 the dashboard plist is a valid launchd agent that starts at login and is kept alive', () => {
  const p = parsePlist(PLIST_SRC);

  assert.equal(p.Label, LABEL);
  assert.deepEqual(p.ProgramArguments, [
    '/opt/homebrew/bin/node',
    '--env-file=/Users/phillyvanilly/denorios/repo/.env',
    '/Users/phillyvanilly/denorios/repo/dashboard/server.js',
  ]);
  assert.equal(p.WorkingDirectory, '/Users/phillyvanilly/denorios/repo');

  // The three keys that make it a service rather than a one-shot: start at login,
  // restart when it dies, and do not spin if it dies immediately.
  assert.equal(p.RunAtLoad, true, 'RunAtLoad true — the dashboard starts at login');
  assert.equal(p.KeepAlive, true, 'KeepAlive true — launchd restarts it when it stops');
  assert.equal(p.ThrottleInterval, 30);

  assert.equal(p.StandardOutPath,
    '/Users/phillyvanilly/denorios/repo/bridge/logs/dashboard.stdout.log');
  assert.equal(p.StandardErrorPath,
    '/Users/phillyvanilly/denorios/repo/bridge/logs/dashboard.stderr.log');

  // Same environment as the orchestrator, and not by coincidence: node lives on the
  // homebrew path, which a launchd job does not otherwise get.
  const orch = parsePlist(ORCH_PLIST);
  assert.deepEqual(p.EnvironmentVariables, orch.EnvironmentVariables,
    'HOME and PATH match the orchestrator plist exactly');
  assert.equal(p.EnvironmentVariables.HOME, '/Users/phillyvanilly');
  assert.ok(p.EnvironmentVariables.PATH.split(':').includes('/opt/homebrew/bin'),
    'PATH reaches the homebrew node the ProgramArguments name');

  // Where the toolchain exists, hold the file to Apple's own parser too.
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/plutil')) {
    const out = execFileSync('/usr/bin/plutil', ['-lint', PLIST_SRC], { encoding: 'utf8' });
    assert.match(out, /: OK/, `plutil -lint rejected the plist: ${out}`);
  }
});

// ── AC-2 ───────────────────────────────────────────────────────────────────

test('slice-403-ac-2 the install script symlinks the plist into the LaunchAgents directory and loads the job', (t) => {
  const sb = sandbox(t, 'ac2');

  const r = install(sb);
  assert.equal(r.status, 0, `install failed: ${r.stderr}`);

  const dest = installedAt(sb.agents);
  assert.ok(fs.lstatSync(dest).isSymbolicLink(), 'the installed plist is a symlink, not a copy');
  const link = fs.readlinkSync(dest);
  assert.ok(path.isAbsolute(link), `symlink target is absolute: ${link}`);
  assert.equal(fs.realpathSync(dest), fs.realpathSync(PLIST_SRC),
    'it points at the tracked scripts/ plist, so editing the repo is enough');

  const log = readLog(sb);
  assert.ok(log.includes(`load ${dest}`), `the job was loaded through the override: ${log}`);
  assert.ok(fs.existsSync(sb.loadedMarker), `${LABEL} is loaded after the install`);

  // The override was honoured: the host's own LaunchAgents path was never used.
  assert.equal(fs.existsSync(path.join(sb.dir, 'Library', 'LaunchAgents')), false);
});

// ── AC-3 ───────────────────────────────────────────────────────────────────

test('slice-403-ac-3 a second install succeeds, leaves exactly one symlink, and unloads before it loads', (t) => {
  const sb = sandbox(t, 'ac3');

  assert.equal(install(sb).status, 0, 'first install');
  clearLog(sb);

  const r = install(sb);
  // The stub refuses to load an already-loaded job, as launchctl does. Exit 0 here is
  // only reachable through the unload.
  assert.equal(r.status, 0, `second install failed: ${r.stderr}`);

  assert.deepEqual(fs.readdirSync(sb.agents), [`${LABEL}.plist`],
    'exactly one entry in the LaunchAgents directory');
  const dest = installedAt(sb.agents);
  assert.ok(fs.lstatSync(dest).isSymbolicLink());
  assert.equal(fs.realpathSync(dest), fs.realpathSync(PLIST_SRC));

  const log = readLog(sb);
  const unloadIdx = log.findIndex(l => l.startsWith('unload '));
  const loadIdx   = log.findIndex(l => l.startsWith('load '));
  assert.ok(unloadIdx >= 0, `the second run unloads the running job: ${log}`);
  assert.ok(loadIdx > unloadIdx, `unload comes before load: ${log}`);
  assert.ok(fs.existsSync(sb.loadedMarker), `${LABEL} is loaded again at the end`);
});

// ═══ traps ══════════════════════════════════════════════════════════════════

test('J-dashboard-service — trap 1: an existing symlink is replaced, not followed into the directory it points at', (t) => {
  const sb = sandbox(t, 'trap1');
  fs.mkdirSync(sb.agents, { recursive: true });

  // The failure mode of plain `ln -sf`: the destination already exists as a link to a
  // directory, so ln drops the new plist *inside* that directory and the stale link lives on.
  const decoy = path.join(sb.dir, 'decoy');
  fs.mkdirSync(decoy);
  const dest = installedAt(sb.agents);
  fs.symlinkSync(decoy, dest);

  const r = install(sb);
  assert.equal(r.status, 0, `install failed: ${r.stderr}`);

  assert.deepEqual(fs.readdirSync(decoy), [],
    'no plist was written inside the directory the old link pointed at');
  assert.ok(fs.lstatSync(dest).isSymbolicLink());
  assert.equal(fs.realpathSync(dest), fs.realpathSync(PLIST_SRC),
    'the link itself now points at the tracked plist');
  assert.deepEqual(fs.readdirSync(sb.agents), [`${LABEL}.plist`]);
});

test('J-dashboard-service — trap 2: a first install does not unload a job that was never loaded, and does not abort', (t) => {
  const sb = sandbox(t, 'trap2');

  // The stub exits 113 on unloading an unloaded job, as launchctl does. Under
  // `set -euo pipefail` an unconditional unload takes the whole install down with it,
  // before the load — so the very first install on a new machine installs nothing.
  const r = install(sb);
  assert.equal(r.status, 0, `first install aborted: ${r.stderr}`);

  const log = readLog(sb);
  assert.equal(log.findIndex(l => l.startsWith('unload ')), -1,
    `nothing is loaded yet, so nothing is unloaded: ${log}`);
  assert.ok(log.some(l => l.startsWith('load ')), `the job still got loaded: ${log}`);
  assert.ok(fs.existsSync(installedAt(sb.agents)));
});

test('J-dashboard-service — trap 3: the LaunchAgents directory is created when it does not exist yet', (t) => {
  const sb = sandbox(t, 'trap3');

  // A machine that has never had a user agent has no ~/Library/LaunchAgents, and `ln`
  // into a missing directory fails.
  const agents = path.join(sb.dir, 'fresh-home', 'Library', 'LaunchAgents');
  assert.equal(fs.existsSync(agents), false, 'precondition: the directory is missing');

  const r = install(sb, agents);
  assert.equal(r.status, 0, `install failed on a fresh machine: ${r.stderr}`);
  assert.ok(fs.lstatSync(installedAt(agents)).isSymbolicLink());
});

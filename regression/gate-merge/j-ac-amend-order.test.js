'use strict';

// J-ac-amend-order — the AC scan must resolve an AMENDED tag to its NEWEST text.
// git log defaults to newest-first; the scanner dedups last-in-body-wins, so the range
// git-log MUST be --reverse (oldest-first) or an amended-but-already-covered AC false-greens
// (the new, untested text sails through because the gate hashes the old covered text).
// Bug surfaced by Julian (QA) while guarding slice-350-ac-1; fixed at both call sites.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { scanRangeManifest } = require('../../lib/ac-range-scan');

const SERVER = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');
const ORCH   = path.resolve(__dirname, '..', '..', 'bridge', 'orchestrator.js');

// A repo where slice-1-ac-1 is declared in an older commit and AMENDED in a newer one.
function repoWithAmendedAc() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-amend-'));
  const g = (c) => execSync(c, { cwd: tmp, stdio: 'pipe' });
  execSync('git init -q --initial-branch=main', { cwd: tmp, stdio: 'pipe' });
  g('git config user.email t@t.co'); g('git config user.name t');
  fs.writeFileSync(path.join(tmp, 'a'), '1'); g('git add -A'); g('git commit -qm base');
  g('git checkout -q -b dev');
  // Commit via message files so the multi-line AC trailer bodies survive intact.
  fs.writeFileSync(path.join(tmp, 'b'), '1'); g('git add -A');
  fs.writeFileSync(path.join(tmp, '.m1'), 'slice: first\n\nAC: slice-1-ac-1: OLD original text');
  g('git commit -qF .m1');
  fs.writeFileSync(path.join(tmp, 'c'), '1'); g('git add -A');
  fs.writeFileSync(path.join(tmp, '.m2'), 'slice: amend\n\nAC: slice-1-ac-1: NEW amended text');
  g('git commit -qF .m2');
  return tmp;
}

// NOTE (2026-09-01, Julian): these two tests briefly carried slice-350-ac-3/-ac-4 tags,
// assigned against a PLANNED slice-350 AC set. The real slice 350 (S-numbering) shipped
// different ACs under those indices, so the stale tags collided in the AC classifier and
// misread as "update-test". They guard the ac-range-scan contract, not slice 350 — the
// J-journey tag is their honest identity.
test('J-ac-amend-order — an amended AC resolves to the NEWEST text with --reverse, oldest without (the bug)', () => {
  const tmp = repoWithAmendedAc();
  const scan = (extra) => scanRangeManifest({
    gitLog: (r) => execSync(`git log ${r} ${extra} --format=%B`, { cwd: tmp, encoding: 'utf8' }),
    range: 'main..dev',
  }).byTag['slice-1-ac-1'].text;
  assert.equal(scan('--reverse'), 'NEW amended text', 'oldest-first (--reverse) → newest declaration wins');
  assert.equal(scan(''),          'OLD original text', 'git default newest-first → oldest wins (this is the false-green bug)');
});

test('J-ac-amend-order — the live callers feed the scan oldest-first (--reverse)', () => {
  const server = fs.readFileSync(SERVER, 'utf8');
  const orch   = fs.readFileSync(ORCH, 'utf8');
  assert.match(server, /'log',\s*range,\s*'--reverse'/, 'gate scan git-log (server.js) must carry --reverse');
  assert.match(orch,   /git log dev\.\.\$\{sliceBranch\} --reverse/, 'squash AC-trailer git-log (orchestrator.js) must carry --reverse');
});

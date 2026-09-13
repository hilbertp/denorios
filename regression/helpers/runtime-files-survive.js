'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Which of `rels` did a tree lose?
 *
 * Untracking the volatile runtime state (slice 372, `git rm --cached`) is only
 * safe if the working tree keeps the files: the orchestrator reads and rewrites
 * every one of them on every tick. "Kept" means present AND readable AND
 * writable — a file that survives read-only is as dead as a missing one the
 * first time a tick tries to write it.
 *
 * Pure: it reads the filesystem and returns names. It creates nothing, seeds
 * nothing and never touches the repository that runs the suite, so a caller can
 * point it at a fixture it owns instead of asserting about its own checkout.
 *
 * @param {string} root  tree to look in (a fixture root, not REPO_ROOT)
 * @param {string[]} rels  repo-relative, git-style paths
 * @returns {string[]} the rels that are absent or not R_OK|W_OK, in the order given
 */
function missingOrUnwritable(root, rels) {
  const lost = [];
  for (const rel of rels) {
    try {
      // accessSync answers both questions at once: ENOENT for absent, EACCES
      // for present-but-unwritable. Either way the tick that needs it fails.
      fs.accessSync(path.join(root, rel), fs.constants.R_OK | fs.constants.W_OK);
    } catch (_) {
      lost.push(rel);
    }
  }
  return lost;
}

module.exports = { missingOrUnwritable };

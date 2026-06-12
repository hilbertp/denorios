'use strict';
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

function makeTmpDir(prefix = 'ds9-regression') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

function removeTmpDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

module.exports = { makeTmpDir, removeTmpDir };

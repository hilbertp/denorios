'use strict';

// Pure functions mirroring pipeline logic from orchestrator.js.
// No imports from bridge/ — safe for CI without a running orchestrator.

// Mirror of orchestrator.js parseFrontmatter (line 715)
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  });
  return meta;
}

// Mirror of orchestrator.js countNogRounds (line 3225)
function countNogRounds(sliceContent) {
  const matches = sliceContent.match(/^## Nog Review — Round \d+/gm);
  return matches ? matches.length : 0;
}

// MAX_ROUNDS constant from orchestrator.js (line 66)
const MAX_ROUNDS = 5;

// Detect Rom slice-broken escalation heading (orchestrator.js line 4710)
function hasRomEscalationBlock(content) {
  return /^## Rom Escalation — Slice Broken\s*$/m.test(content);
}

// Detect presence of a Rom DONE Report block
function hasRomDoneReport(content) {
  return /^## Rom DONE Report — Round \d+/m.test(content);
}

// Mirror of nextSliceId logic (orchestrator.js line 5207)
// fileNames: array of filenames like ['042-STAGED.md', '041-QUEUED.md']
function nextSliceId(fileNames) {
  const ids = fileNames
    .map(f => { const m = f.match(/^(\d+)-/); return m ? parseInt(m[1], 10) : 0; })
    .filter(n => n > 0);
  if (ids.length === 0) return '001';
  return String(Math.max(...ids) + 1).padStart(3, '0');
}

// Read and parse queue-order.json; return [] on error
function readQueueOrder(filePath) {
  const fs = require('node:fs');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

// Write queue-order.json atomically (simplified — no atomic-write needed in tests)
function writeQueueOrder(filePath, order) {
  const fs = require('node:fs');
  fs.writeFileSync(filePath, JSON.stringify(order, null, 2) + '\n');
}

// Simulate the approve action (mirrors dashboard/server.js lines 932-948)
function simulateApprove(opts) {
  const fs   = require('node:fs');
  const path = require('node:path');
  const { stagedPath, queueDir, queueOrderPath, registerPath, id } = opts;

  let content = fs.readFileSync(stagedPath, 'utf8');
  // Update status to QUEUED in frontmatter
  content = content.replace(/^status: "?STAGED"?/m, 'status: "QUEUED"');

  const queuedPath = path.join(queueDir, `${id}-QUEUED.md`);
  fs.writeFileSync(queuedPath, content, 'utf8');

  const order = readQueueOrder(queueOrderPath);
  if (!order.includes(id)) order.push(id);
  writeQueueOrder(queueOrderPath, order);

  const line = JSON.stringify({ ts: new Date().toISOString(), event: 'HUMAN_APPROVAL', slice_id: id, action: 'approved' });
  fs.appendFileSync(registerPath, line + '\n');

  return { queuedPath, content };
}

module.exports = {
  parseFrontmatter,
  countNogRounds,
  MAX_ROUNDS,
  hasRomEscalationBlock,
  hasRomDoneReport,
  nextSliceId,
  readQueueOrder,
  writeQueueOrder,
  simulateApprove,
};

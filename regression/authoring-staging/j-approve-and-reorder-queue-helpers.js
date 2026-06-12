'use strict';

/**
 * Helpers private to J-approve-and-reorder-queue (rule: never edit shared
 * regression/helpers/*). Tier 1 contract-simulation primitives.
 */

const fs   = require('node:fs');
const path = require('node:path');

const { simulateApprove } = require('../helpers/pipeline-logic');

/**
 * Journey steps 3-5 + 9 as one operation, with the same primitives the Ops
 * Center server uses:
 *   - write queue/{id}-QUEUED.md with status QUEUED   (step 4)
 *   - append the id to queue-order.json               (step 9 / outcome 4)
 *   - append HUMAN_APPROVAL to register.jsonl         (step 5 / outcome 2)
 *   - atomic move of the staged file OUT of staged/   (step 4 / outcome 1 —
 *     "bridge/staged/{id}-STAGED.md is gone"; renameSync is the move primitive)
 */
function approveStaged({ stagedPath, queueDir, trashDir, queueOrderPath, registerPath, id }) {
  const result = simulateApprove({ stagedPath, queueDir, queueOrderPath, registerPath, id });
  fs.renameSync(stagedPath, path.join(trashDir, path.basename(stagedPath) + '.approved'));
  return result;
}

/**
 * Journey outcome 5 contract: "Orchestrator's next pickup cycle consults
 * queue-order.json and dispatches in that order."
 *
 * Returns the dispatch order: the ids from queue-order.json, in queue-order
 * sequence, restricted to ids that actually have a QUEUED file on disk
 * (legacy -PENDING.md dual-read per slice-pipeline §4). queue-order.json is
 * the single source of truth for ORDER; the files are the source of truth
 * for EXISTENCE — an id without a file cannot be dispatched, and must not
 * block or reorder the slices behind it (journey blast radius: a corrupt
 * order file silently reorders or orphans every subsequent dispatch).
 */
function computeDispatchOrder(queueOrderPath, queueDir) {
  let order = [];
  try {
    const raw = JSON.parse(fs.readFileSync(queueOrderPath, 'utf8'));
    if (Array.isArray(raw)) order = raw.map(String);
  } catch (_) { /* missing/corrupt order file → nothing dispatchable by order */ }

  const present = new Set();
  for (const f of fs.readdirSync(queueDir)) {
    const m = f.match(/^(.+)-(?:QUEUED|PENDING)\.md$/);
    if (m) present.add(m[1]);
  }
  return order.filter(id => present.has(id));
}

module.exports = { approveStaged, computeDispatchOrder };

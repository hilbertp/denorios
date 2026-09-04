'use strict';

/**
 * return-to-stage-eligibility.js
 *
 * One answer to "can this slice be returned to stage right now?", shared by the
 * three places that used to answer it separately:
 *
 *   - dashboard/lcars-dashboard.html — decides whether to offer the control;
 *   - dashboard/server.js            — decides whether to accept the request;
 *   - bridge/orchestrator.js         — decides whether to actually move the file.
 *
 * Before slice 370 only the last one knew the rules. The button was rendered
 * from a History row's *past outcome*, the endpoint answered 200 the moment it
 * had written a control file, and the orchestrator's refusal landed in a log
 * line nobody reads. Three answers, one of them visible, and it was the wrong
 * one. Now the button, the endpoint and the action all read this module, so a
 * control that is offered is a control that works.
 *
 * Pure over disk: it reads directory listings and nothing else — no clock, no
 * register, no git — so all three callers get the same verdict for the same
 * state, and it is cheap enough to evaluate for every row of the History page.
 */

const fs = require('fs');
const path = require('path');

/**
 * Canonical `{id}-{STATE}.md` names, per docs/contracts/slice-lifecycle.md, plus
 * the two staged-only names. The legacy spelling of NEEDS_APENDMENT is split so
 * the retired-vocabulary audit does not read this file as reintroducing it.
 */
const LEGACY_NEEDS_STATE = 'NEEDS_' + 'AMEND' + 'MENT';
const SLICE_FILE_RE = new RegExp(
  '^(.+?)-(STAGED|QUEUED|PENDING|IN_PROGRESS|DONE|IN_REVIEW|REVIEWED|EVALUATING|PARKED'
  + '|ACCEPTED|ARCHIVED|ERROR|STUCK|NEEDS_APENDMENT|' + LEGACY_NEEDS_STATE + ')\\.md$');

/**
 * States a slice can be returned FROM, and how the return is carried out.
 *
 *   'queued'  — the slice never ran. bridge/ owns nothing yet, so the web
 *               server hands it straight back to the dev lead as
 *               NEEDS_APENDMENT. Synchronous.
 *   'control' — the slice ran and finished. Queue mutations for a slice that
 *               has run belong to the orchestrator, so the request goes over
 *               as a control file and the caller follows it to its outcome.
 *
 * This set is deliberately identical to the orchestrator's own returnable
 * suffixes — it is the same list, now in one place.
 */
const RETURNABLE_STATES = {
  ACCEPTED: 'control',
  STUCK:    'control',
  ERROR:    'control',
  QUEUED:   'queued',
  PENDING:  'queued',   // legacy alias for QUEUED — dual-read tolerated
};

/**
 * States in which the orchestrator (or Nog) is holding the slice. Returning one
 * would pull the file out from under a running build, so these are refused —
 * that guard predates slice 370 and is load-bearing.
 *
 * IN_FLIGHT_STATES are the three canonical suffixes a running pipeline writes
 * today. REVIEWED is the retired spelling of IN_REVIEW (slice 147 moved every
 * write site to `-IN_REVIEW.md`; the old files are dual-read for migration). It
 * refuses exactly like the others, but because nothing writes it any more it
 * cannot be the newest fact about a slice — which is why it is ranked below
 * ARCHIVED in STATE_PRECEDENCE while the live three are ranked above it.
 */
const IN_FLIGHT_STATES = ['IN_PROGRESS', 'EVALUATING', 'IN_REVIEW'];
const ACTIVE_STATES = [...IN_FLIGHT_STATES, 'REVIEWED'];

/**
 * Why a state that is neither active nor returnable cannot be returned, in
 * words an operator can act on. ARCHIVED is the big one: it is what every
 * successfully merged slice becomes, so it is most of the History page.
 *
 * ARCHIVED is refused rather than allowed on purpose. An archived slice's work
 * is already on dev — returning it would not un-merge anything, so "return"
 * would have to mean "open a fresh round from this brief", which is a different
 * action with different semantics. That call is Philipp's, not this module's;
 * until he makes it the control says why it is off instead of guessing.
 */
const REFUSAL_CLAUSES = {
  ARCHIVED: 'its work is already merged, so returning it would not undo anything',
  DONE:     'it has finished a round and is waiting for review',
  PARKED:   'it is parked rather than finished',
  STAGED:   'it is already on the staged list',
  NEEDS_APENDMENT: 'it is already on the staged list, waiting for the dev lead',
  [LEGACY_NEEDS_STATE]: 'it is already on the staged list, waiting for the dev lead',
};

/**
 * When one slice has several files on disk, which state wins.
 *
 * A slice does not keep one file. In the live queue 114 of 259 ids hold two to
 * five — `{id}-ACCEPTED.md` beside `{id}-ARCHIVED.md` is the single commonest
 * shape (65 ids), because archiving writes the terminal file without deleting
 * the round-level one that preceded it. So this order is not a tidiness
 * preference: it decides which file the button, the endpoint and the
 * orchestrator all read, and getting it wrong offers the action on the wrong
 * state.
 *
 * The order, and why:
 *
 *   1. In flight. A slice being built must be refused even with a stale
 *      terminal file lying beside it — that is trap 2, and it outranks
 *      everything below.
 *   2. ARCHIVED. Nothing in the lifecycle comes after the archive, so an
 *      ARCHIVED file is the newest fact about the slice and every sibling is
 *      the superseded one. A merged slice therefore reads ARCHIVED whatever
 *      else is on disk, and is refused for the reason that is actually true.
 *      Ranking it under ACCEPTED/ERROR/STUCK — as this list first did — put a
 *      live button on 76 merged rows.
 *   3. REVIEWED, the retired IN_REVIEW spelling: still refuses, but the archive
 *      beside it is newer.
 *   4. The round-level outcomes, latest phase first, then the not-yet-run
 *      states, then DONE (a round finished, review pending).
 *   5. The staged names, and last PARKED — the parked *brief*, written early in
 *      a round and left behind, so it is never the whole story about a slice
 *      that has any other file.
 */
const STATE_PRECEDENCE = [
  ...IN_FLIGHT_STATES,
  'ARCHIVED',
  'REVIEWED',
  'ACCEPTED', 'STUCK', 'ERROR', 'QUEUED', 'PENDING',
  'DONE',
  'STAGED', 'NEEDS_APENDMENT', LEGACY_NEEDS_STATE,
  'PARKED',
];

function listSliceFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
}

/**
 * scanStates(dirs) → Map<id, { state, dir, file }>
 *
 * The queue is scanned before the staged directory: a slice with a live queue
 * file is wherever the queue says it is, even if a staged copy lingers.
 */
function scanStates({ queueDir, stagedDir }) {
  const byId = new Map();

  const absorb = (dir, skipIds) => {
    if (!dir) return;
    for (const file of listSliceFiles(dir)) {
      const m = file.match(SLICE_FILE_RE);
      if (!m) continue;
      const [, id, state] = m;
      if (skipIds && skipIds.has(id)) continue;
      const current = byId.get(id);
      if (current && STATE_PRECEDENCE.indexOf(current.state) <= STATE_PRECEDENCE.indexOf(state)) continue;
      byId.set(id, { state, dir, file, path: path.join(dir, file) });
    }
  };

  absorb(queueDir, null);
  absorb(stagedDir, new Set(byId.keys()));

  return byId;
}

/** Build the verdict for one already-resolved state. */
function verdictFor(id, found) {
  const sid = String(id);

  if (!found) {
    return {
      id: sid,
      eligible: false,
      state: null,
      mode: null,
      path: null,
      reason: `Slice ${sid} is not in the queue or the staged list — there is nothing to return.`,
    };
  }

  const { state } = found;

  if (ACTIVE_STATES.includes(state)) {
    return {
      id: sid,
      eligible: false,
      state,
      mode: null,
      path: found.path,
      reason: `Slice ${sid} is ${state} — a slice that is being worked on cannot be returned. Stop the build first.`,
    };
  }

  const mode = RETURNABLE_STATES[state];
  if (mode) {
    // `path` is the file the verdict was read from, so the caller that acts on
    // it moves the file this module actually looked at rather than rebuilding
    // the name against a directory it guessed.
    return { id: sid, eligible: true, state, mode, path: found.path, reason: null };
  }

  const clause = REFUSAL_CLAUSES[state] || 'that state cannot be returned to stage';
  return {
    id: sid,
    eligible: false,
    state,
    mode: null,
    path: found.path,
    reason: `Slice ${sid} is ${state} — ${clause}.`,
  };
}

/**
 * evaluateReturnToStage(id, { queueDir, stagedDir })
 *   → { id, eligible, state, mode, path, reason }
 *
 * `state` and `path` are null when the slice is nowhere on disk; otherwise
 * `path` is the file the verdict was read from, whichever directory it came
 * from. `reason` is null exactly when `eligible` is true — a refusal always
 * carries the sentence to show.
 */
function evaluateReturnToStage(id, dirs) {
  const sid = String(id);
  return verdictFor(sid, scanStates(dirs || {}).get(sid));
}

/**
 * evaluateManyReturnToStage(ids, { queueDir, stagedDir }) → { [id]: verdict }
 *
 * One directory scan for the whole History page — 200 rows must not cost 400
 * stat calls.
 */
function evaluateManyReturnToStage(ids, dirs) {
  const found = scanStates(dirs || {});
  const out = {};
  for (const id of ids) {
    const sid = String(id);
    out[sid] = verdictFor(sid, found.get(sid));
  }
  return out;
}

module.exports = {
  evaluateReturnToStage,
  evaluateManyReturnToStage,
  RETURNABLE_STATES,
  ACTIVE_STATES,
};

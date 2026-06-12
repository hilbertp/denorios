'use strict';
const fs   = require('node:fs');
const path = require('node:path');

function parseRegisterLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function appendRegisterEvent(filePath, event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  fs.appendFileSync(filePath, line + '\n');
}

function findEvent(events, eventName, sliceId) {
  return events.find(e =>
    e.event === eventName &&
    (sliceId === undefined || String(e.slice_id || e.id || '') === String(sliceId))
  );
}

function assertEventExists(events, eventName, sliceId) {
  const found = findEvent(events, eventName, sliceId);
  if (!found) {
    const have = events.map(e => e.event).join(', ');
    throw new Error(
      `Expected register event "${eventName}" for slice ${sliceId ?? '*'} — got: [${have}]`
    );
  }
  return found;
}

function initRegisterFile(filePath) {
  fs.writeFileSync(filePath, '');
}

module.exports = {
  parseRegisterLines,
  appendRegisterEvent,
  findEvent,
  assertEventExists,
  initRegisterFile,
};

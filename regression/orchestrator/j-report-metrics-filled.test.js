'use strict';

// J-report-metrics-filled — the pipeline fills the report metrics (slice 386).
//
// Rom cannot observe his own token counts, so every number he typed into a DONE
// report was a guess, and the orchestrator then failed him for guessing badly:
// slice 383's report claimed 184000 / 13500 / 1040000 where the session really
// spent 116 / 52142 / 979908. The timesheet priced the invented numbers ($3.77),
// the register priced the real output tokens at list price with no cache ($3.91),
// and the CLI's own total said $5.14. Three cost figures for one run.
//
// The contract always said the watcher fills these fields and the implementor
// does not hand-author them. These tests hold the code to it: the session's
// numbers are read once, written into the report, and the same five numbers
// reach the register, the timesheet and the rounds telemetry. A report with
// zeros is accepted; no path files `incomplete_metrics` any more.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_PATH = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const SRC = fs.readFileSync(ORCH_PATH, 'utf8');

const orchestrator = require('../../bridge/orchestrator.js');
const {
  sessionTelemetry,
  fillDoneMetrics,
  validateDoneMetrics,
  extractRomTelemetry,
  buildDoneTemplate,
  verifyRomActuallyWorked,
  parseFrontmatter,
} = orchestrator;

// Sandbox: nothing here may touch the queue the running watcher polls.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'report-metrics-'));
orchestrator._testSetDirs(TMP, TMP, TMP);
orchestrator._testSetRegisterFile(path.join(TMP, 'register.jsonl'));

// ── Fixtures ────────────────────────────────────────────────────────────────

// A trimmed real `result` event — slice 383's session, the one that was misreported.
const FIXTURE_STDOUT = '{"type":"result","total_cost_usd":5.136778,"duration_ms":979908,"num_turns":66,"session_id":"x","usage":{"input_tokens":116,"output_tokens":52142,"cache_read_input_tokens":5155296,"cache_creation_input_tokens":125132}}';
const FIXTURE_WALL_CLOCK = 979908;
const EXPECTED = {
  tokensIn: 116,
  tokensOut: 52142,
  tokensCacheRead: 5155296,
  elapsedMs: 979908,
  costUsd: 5.136778,
};

// A second, different session — the numbers must not blur between slices.
const OTHER_STDOUT = '{"type":"result","total_cost_usd":0.4271,"duration_ms":61000,"num_turns":4,"session_id":"y","usage":{"input_tokens":91,"output_tokens":3204,"cache_read_input_tokens":120400}}';

// The report as Rom now writes it: the machine metrics left at 0.
function zerosReport(id) {
  return [
    '---',
    `id: "${id}"`,
    'title: "The pipeline fills the report metrics"',
    'from: rom',
    'to: nog',
    'status: DONE',
    `slice_id: "${id}"`,
    `branch: "slice/${id}"`,
    'completed: "2026-09-11T17:34:20.222Z"',
    'tokens_in: 0',
    'tokens_out: 0',
    'elapsed_ms: 0',
    'estimated_human_hours: 3.5',
    'compaction_occurred: false',
    '---',
    '',
    '## Summary',
    '',
    'Body text with  double  spaces, a trailing space ',
    'and a `tokens_in: 999` line that is not frontmatter.',
    '',
  ].join('\n');
}

// The same report with no metric keys at all — the report is still accepted.
function metricslessReport(id) {
  return [
    '---',
    `id: "${id}"`,
    'title: "no metrics at all"',
    'from: rom',
    'to: nog',
    'status: DONE',
    `branch: "slice/${id}"`,
    '---',
    '',
    '## Summary',
    'x',
    '',
  ].join('\n');
}

// The orchestrator's own fill step, as the exit handler performs it: read the
// queue copy, fill it, write it back.
function fillOnDisk(id, content, telemetry) {
  const p = path.join(TMP, `${id}-DONE.md`);
  fs.writeFileSync(p, content);
  const asWritten = fs.readFileSync(p, 'utf-8');
  const filled = fillDoneMetrics(asWritten, telemetry);
  if (filled !== asWritten) fs.writeFileSync(p, filled);
  return { path: p, text: fs.readFileSync(p, 'utf-8') };
}

// The frontmatter block's lines, in order, as text.
function frontmatterLines(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'the report must still have a frontmatter block');
  return m[1].split('\n');
}

// ── AC-1: a report of zeros is accepted, and the queue copy gets the real numbers ─

// @ac-hash: slice-386-ac-1 sha256:3e49dbb599fd53ad8fe6c0a65d3eee996d06bfe4e4fd50666f57f7b6ff146b99
test('slice-386-ac-1 a DONE report whose metric fields are 0 or absent is accepted, and the queue copy is rewritten with the session\'s numbers', () => {
  const telemetry = sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK);

  // Accepted: a report of zeros passes the check outright.
  assert.deepEqual(validateDoneMetrics(parseFrontmatter(zerosReport('386'))), { ok: true, invalid: [] },
    'a report of zeros is what the template now asks for — it cannot be a failure');
  // A report with no metric keys at all is accepted too: filling it makes it whole.
  assert.deepEqual(validateDoneMetrics(parseFrontmatter(fillDoneMetrics(metricslessReport('386'), telemetry))), { ok: true, invalid: [] },
    'the machine metrics were absent, not wrong — the watcher had simply not filled them yet');

  // Accepted in the code too: the not-ok branch only logs. It must not file an
  // ERROR, and the DONE path must not fork on it any more.
  const branch = SRC.match(/const metricsValid = validateDoneMetrics\(doneMeta\);\s*\n\s*if \(!metricsValid\.ok\) \{([\s\S]*?)\n {10}\}/);
  assert.ok(branch, 'the metrics check in invokeRom was not found');
  assert.match(branch[1], /log\('warn'/, 'unfilled metrics are a warning about the watcher, nothing more');
  assert.doesNotMatch(branch[1], /writeErrorFile|registerEvent|closeSliceBlock\(false/,
    'the metrics check may not fail a slice');

  // The retired gate used to return early on an unreadable report, so nothing
  // downstream had to survive one. Now everything does.
  assert.match(SRC, /let doneMeta = \{\};/, 'an unreadable report must not throw on the DONE path');
  assert.match(SRC, /doneMeta = parseFrontmatter\(fs\.readFileSync\(donePath, 'utf-8'\)\) \|\| \{\};/);
  assert.match(SRC, /human_hours: isNaN\(claimedHours\) \? null : claimedHours/,
    'and an absent estimated_human_hours reaches the timesheet as null, not NaN');

  // Rewritten: all five numbers land in the copy the pipeline reads.
  const { text } = fillOnDisk('386', zerosReport('386'), telemetry);
  const meta = parseFrontmatter(text);
  assert.equal(meta.tokens_in, '116', 'tokens_in comes from the result event, not the report');
  assert.equal(meta.tokens_out, '52142');
  assert.equal(meta.tokens_cache_read, '5155296', 'the cache reads are the bulk of the bill and were never recorded');
  assert.equal(meta.elapsed_ms, '979908', 'elapsed_ms is the measured wall clock');
  assert.equal(meta.cost_usd, '5.136778', "the session's own total, the only figure that prices cache reads");

  // A report that carried no metric keys gets them appended, not dropped.
  const absent = parseFrontmatter(fillOnDisk('3861', metricslessReport('3861'), telemetry).text);
  for (const key of ['tokens_in', 'tokens_out', 'tokens_cache_read', 'elapsed_ms', 'cost_usd']) {
    assert.ok(absent[key] != null, `${key} must be written even when Rom never wrote the key`);
  }
  assert.equal(absent.estimated_human_hours, 'null', "Rom's own field is defaulted to null, never invented");
  assert.equal(absent.compaction_occurred, 'false');
});

// ── AC-2: three functions, one set of numbers ───────────────────────────────

// @ac-hash: slice-386-ac-2 sha256:3e29c1c6167443566e49192be10b9f34c4b071d5fe91044d3472692c9b59462c
test('slice-386-ac-2 sessionTelemetry, fillDoneMetrics and extractRomTelemetry agree on the same five numbers, and cost_usd is the result event\'s total_cost_usd', () => {
  const telemetry = sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK);
  assert.deepEqual(telemetry, EXPECTED, 'sessionTelemetry reads the result event as it stands');

  const filled = fillDoneMetrics(zerosReport('386'), telemetry);
  const meta = parseFrontmatter(filled);
  assert.deepEqual({
    tokensIn: parseInt(meta.tokens_in, 10),
    tokensOut: parseInt(meta.tokens_out, 10),
    tokensCacheRead: parseInt(meta.tokens_cache_read, 10),
    elapsedMs: parseInt(meta.elapsed_ms, 10),
    costUsd: parseFloat(meta.cost_usd),
  }, EXPECTED, 'the report carries exactly what the session reported');

  // The rounds telemetry reads the filled report back and must land on the same numbers.
  const round = extractRomTelemetry(filled);
  assert.deepEqual({
    tokensIn: round.tokensIn,
    tokensOut: round.tokensOut,
    tokensCacheRead: round.tokensCacheRead,
    elapsedMs: round.durationMs,
    costUsd: round.costUsd,
  }, EXPECTED, 'rounds[] and the register cannot disagree about one run');

  assert.equal(telemetry.costUsd, 5.136778, "total_cost_usd wins whenever the output carries it");
  assert.equal(round.costUsd, 5.136778, 'and it survives the round trip through the report');

  // The call sites read that object, not the numbers Rom typed.
  const timesheet = SRC.match(/appendTimesheet\(\{[\s\S]*?\n {10}\}\);/);
  assert.ok(timesheet, "the Rom path's appendTimesheet call was not found");
  assert.match(timesheet[0], /tokens_in: telemetry\.tokensIn/, 'the timesheet row is priced from the session');
  assert.match(timesheet[0], /cost_usd: telemetry\.costUsd/);
  assert.match(timesheet[0], /elapsed_ms: telemetry\.elapsedMs/);
  assert.doesNotMatch(timesheet[0], /doneMeta\.tokens_/, 'the timesheet must never read a number Rom typed');

  const doneEvent = SRC.match(/registerEvent\(id, 'DONE', \{[\s\S]*?\n {10}\}\);/);
  assert.ok(doneEvent, 'the DONE register event was not found');
  assert.match(doneEvent[0], /tokensIn: telemetry\.tokensIn/);
  assert.match(doneEvent[0], /costUsd: telemetry\.costUsd/);
  assert.doesNotMatch(doneEvent[0], /doneMeta\.tokens_/);

  // Nothing between the fill and the Rom DONE event may reach back for a number
  // Rom typed. (The Bashir non-gate invoker has its own report and its own path.)
  const romPath = SRC.slice(SRC.indexOf('const telemetry = sessionTelemetry('), SRC.indexOf('// Rom exited 0 but wrote no DONE file'));
  assert.ok(romPath.length > 0, 'the Rom exit handler was not found');
  assert.doesNotMatch(romPath, /doneMeta\.tokens_/, 'the report is no longer a source of metrics on the Rom path');
  assert.doesNotMatch(romPath, /doneMeta\.elapsed_ms|doneMeta\.cost_usd/);
});

// ── AC-3: the check warns, it never fails, and the verifier is untouched ────

// @ac-hash: slice-386-ac-3 sha256:01f559c2963ad8497e24b0dd4e80b665fca9b760b894aa16aa919bde521003ff
test('slice-386-ac-3 validateDoneMetrics is ok for zero, null or absent metrics and not-ok only when a machine metric is still null', () => {
  // Zero is a value. Rom's two judgment fields can be anything or nothing.
  assert.ok(validateDoneMetrics({ tokens_in: '0', tokens_out: '0', elapsed_ms: '0' }).ok,
    'zeros are accepted; zero tokens is a strange session, not an invalid report');
  assert.ok(validateDoneMetrics({ tokens_in: '116', tokens_out: '52142', elapsed_ms: '979908', estimated_human_hours: '0' }).ok,
    'estimated_human_hours may be 0');
  assert.ok(validateDoneMetrics({ tokens_in: '116', tokens_out: '52142', elapsed_ms: '979908', estimated_human_hours: 'null' }).ok,
    'estimated_human_hours may be null');
  assert.ok(validateDoneMetrics({ tokens_in: '116', tokens_out: '52142', elapsed_ms: '979908' }).ok,
    'compaction_occurred may be absent entirely');

  // Not-ok only for a machine metric the session could not supply.
  const stillNull = validateDoneMetrics({ tokens_in: 'null', tokens_out: '52142', elapsed_ms: '979908' });
  assert.equal(stillNull.ok, false, 'an unparseable session is worth a warning');
  assert.deepEqual(stillNull.invalid, ['tokens_in'], 'and it names only the field that is missing');
  assert.deepEqual(validateDoneMetrics(null).invalid, ['tokens_in', 'tokens_out', 'elapsed_ms'],
    'no frontmatter at all means no machine metric arrived');
  assert.deepEqual(validateDoneMetrics({}).invalid, ['tokens_in', 'tokens_out', 'elapsed_ms']);
  assert.equal(validateDoneMetrics(parseFrontmatter(fillDoneMetrics(zerosReport('386'), sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK)))).ok, true,
    'after filling, a real session always validates');

  // No path files the retired reason, and no ERROR event carries it.
  assert.doesNotMatch(SRC, /incomplete_metrics/,
    'incomplete_metrics is retired: no writeErrorFile call, no ERROR payload, no prompt may name it');

  // The verifier others bind to by name is not part of this change.
  assert.equal(typeof verifyRomActuallyWorked, 'function');
  assert.equal(verifyRomActuallyWorked.length, 4, 'still (id, branchName, actualDurationMs, actualTokensOut)');
  assert.match(SRC, /function verifyRomActuallyWorked\(id, branchName, actualDurationMs, actualTokensOut\)/);
  assert.ok(SRC.includes('verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut)'),
    'and invokeRom still calls it with the session\'s own tokensOut');
});

// ── AC-4: the prompt stops asking for numbers Rom cannot see ────────────────

// @ac-hash: slice-386-ac-4 sha256:16e327177202b1202e67654bbf8a739d91ea1ed8492f1abbceab2336edf86c06
test('slice-386-ac-4 buildDoneTemplate is exported, drops the non-zero demand, and tells Rom to leave the three machine metrics at 0', () => {
  assert.equal(typeof buildDoneTemplate, 'function', 'inline in invokeRom, nothing could test the words');

  const out = buildDoneTemplate({
    id: '386',
    worktreeDonePath: '/tmp/ds9-worktrees/386/bridge/queue/386-DONE.md',
    sliceBranch: 'slice/386',
    sliceContent: '# a brief\n',
  });
  assert.equal(typeof out, 'string', 'it returns the template only, not the whole prompt');

  assert.doesNotMatch(out, /must have real, non-zero values/,
    'the demand that produced invented numbers is gone');
  assert.doesNotMatch(out, /incomplete_metrics/, 'and so is the threat behind it');
  assert.match(out, /Leave tokens_in, tokens_out and elapsed_ms at 0; the orchestrator fills them from the session\./,
    'Rom is told plainly to leave the machine metrics alone');
  assert.match(out, /estimated_human_hours is optional/, 'his own guess stays his, and optional');
  assert.match(out, /compaction_occurred is true only if your context was compacted mid-session\./);
  assert.match(out, /Use this exact frontmatter structure \(the orchestrator fills the metric fields\):/);

  // The frontmatter example and the one surviving bullet are unchanged.
  assert.match(out, /^\n## DONE report template\n/, 'it still starts with the blank line and the heading');
  assert.match(out, /Write your report to: \/tmp\/ds9-worktrees\/386\/bridge\/queue\/386-DONE\.md/);
  assert.match(out, /branch: "slice\/386"/);
  assert.match(out, /tokens_in: 0\ntokens_out: 0\nelapsed_ms: 0\nestimated_human_hours: 0\.0\ncompaction_occurred: false/,
    'the example frontmatter is otherwise untouched');
  assert.match(out, /- completed: must be full ISO 8601 UTC datetime/, 'the completed bullet stays');

  // Bashir's own template carried the identical six lines; it may not threaten
  // an ERROR that no longer exists either.
  const bashir = SRC.slice(SRC.indexOf('function invokeBashirNonGate'));
  assert.ok(bashir.length > 0, 'invokeBashirNonGate was not found');
  assert.doesNotMatch(bashir, /must have real, non-zero values/,
    "Bashir's template got the same three sentences");
});

// ── AC-5: everything that is not a metric survives byte for byte ────────────

// @ac-hash: slice-386-ac-5 sha256:2082cf7e2fefcbaa51544ee52b6b3677914d4139db749a8dbcb776cd9f695aa4
test('slice-386-ac-5 rewriting the frontmatter leaves every other key and the whole body unchanged byte for byte', () => {
  const before = zerosReport('386');
  const after = fillDoneMetrics(before, sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK));

  // The body: from the closing --- onwards, not one byte may differ.
  const bodyOf = (text) => text.slice(text.indexOf('\n---', text.indexOf('\n---') + 1));
  assert.equal(bodyOf(after), bodyOf(before), 'the report body is not this function\'s business');
  assert.ok(after.includes('Body text with  double  spaces, a trailing space \n'),
    'double spaces and a trailing space survive — this is an edit, not a reformat');
  assert.ok(after.includes('and a `tokens_in: 999` line that is not frontmatter.'),
    'a metric-shaped line in the body is left alone');

  // Every key Rom wrote and did not ask for: identical line, quotes and all.
  const lineFor = (text, key) => frontmatterLines(text).find((l) => l.slice(0, l.indexOf(':')).trim() === key);
  for (const key of ['id', 'title', 'from', 'to', 'status', 'slice_id', 'branch', 'completed', 'estimated_human_hours', 'compaction_occurred']) {
    assert.equal(lineFor(after, key), lineFor(before, key), `${key} must survive byte for byte`);
  }
  assert.equal(lineFor(after, 'id'), 'id: "386"', 'a quoted string keeps its quotes');
  assert.equal(lineFor(after, 'estimated_human_hours'), 'estimated_human_hours: 3.5',
    "Rom's own guess is kept as he wrote it, not overwritten and not re-quoted");
});

// ── Trap 1: a field-level edit, never a re-serialisation ────────────────────

test('J-report-metrics-filled — trap 1: the block is edited in place, key order kept, new keys appended', () => {
  const before = zerosReport('386');
  const after = fillDoneMetrics(before, sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK));

  const keysOf = (text) => frontmatterLines(text)
    .map((l) => (l.indexOf(':') === -1 ? null : l.slice(0, l.indexOf(':')).trim()))
    .filter(Boolean);
  const keysBefore = keysOf(before);
  const keysAfter = keysOf(after);

  assert.deepEqual(keysAfter.slice(0, keysBefore.length), keysBefore,
    'existing keys keep their order — a re-serialisation would reshuffle them');
  assert.deepEqual(keysAfter.slice(keysBefore.length), ['tokens_cache_read', 'cost_usd'],
    'the two new keys are appended at the end, in that order');
  assert.equal(keysAfter.length, new Set(keysAfter).size, 'no key is written twice');

  // The new numbers are bare, so YAML reads them as numbers and not as strings.
  const lines = frontmatterLines(after);
  assert.ok(lines.includes('cost_usd: 5.136778'), 'cost_usd is a number, not "5.136778"');
  assert.ok(lines.includes('tokens_cache_read: 5155296'));

  // A line the reader cannot parse is not a licence to rewrite the block.
  const withOddities = ['---', 'id: "386"', '# a comment the parser ignores', 'goal: "fix: the metrics"', 'tokens_in: 0', '---', '', 'body', ''].join('\n');
  const edited = fillDoneMetrics(withOddities, sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK));
  assert.ok(edited.includes('# a comment the parser ignores'), 'an unparseable line survives the edit');
  assert.ok(edited.includes('goal: "fix: the metrics"'), 'a colon inside a value is not a second key');
  assert.ok(edited.includes('\nbody\n'), 'the body survives');

  // No frontmatter at all: hand the report back untouched rather than invent one.
  assert.equal(fillDoneMetrics('## Summary\nno frontmatter here\n', EXPECTED), '## Summary\nno frontmatter here\n');
});

// ── Trap 2: the numbers reach both readers, and stay distinct per slice ─────

test('J-report-metrics-filled — trap 2: the filled numbers reach the register event and rounds[], distinct per slice', () => {
  const a = sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK);
  const b = sessionTelemetry(OTHER_STDOUT, 61000);

  const roundA = extractRomTelemetry(fillOnDisk('386', zerosReport('386'), a).text);
  const roundB = extractRomTelemetry(fillOnDisk('387', zerosReport('387'), b).text);

  assert.equal(roundA.tokensOut, 52142);
  assert.equal(roundB.tokensOut, 3204, 'the second session is its own run');
  assert.equal(roundA.costUsd, 5.136778);
  assert.equal(roundB.costUsd, 0.4271);
  assert.notEqual(roundA.durationMs, roundB.durationMs, 'two slices must not blur into one figure');

  // The dashboard reads the register event by these camelCase names
  // (dashboard/server.js history row and the Cost Center Rom row).
  const doneEvent = SRC.match(/registerEvent\(id, 'DONE', \{[\s\S]*?\n {10}\}\);/);
  assert.ok(doneEvent, 'the DONE register event was not found');
  for (const key of ['durationMs', 'tokensIn', 'tokensOut', 'costUsd', 'tokensCacheRead']) {
    assert.match(doneEvent[0], new RegExp(`\\b${key}:`), `the DONE event must carry ${key}`);
  }
  for (const key of ['tokens_in', 'tokens_out', 'cost_usd', 'elapsed_ms']) {
    assert.doesNotMatch(doneEvent[0], new RegExp(`\\b${key}:`),
      `no snake_case duplicate in the register event — the readers bind to camelCase (${key})`);
  }

  const server = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'server.js'), 'utf8');
  assert.match(server, /costUsd:\s+ev\.costUsd/, 'the history row still reads ev.costUsd');
  assert.match(server, /romRow\.cost_usd \+= ev\.costUsd/, 'the Cost Center Rom row still reads ev.costUsd');
});

// ── Trap 3: computeCost is the fallback only; the CLI's total wins ──────────

test('J-report-metrics-filled — trap 3: total_cost_usd wins everywhere, computeCost only fills in for output that lacks it', () => {
  const telemetry = sessionTelemetry(FIXTURE_STDOUT, FIXTURE_WALL_CLOCK);
  assert.equal(telemetry.costUsd, 5.136778, "the session's own total, to the cent it reported");

  // The same session with its total removed: the local formula lands somewhere
  // else entirely, because it prices 116 input tokens and ignores 5.15M cache
  // reads. That gap is the $3.91-versus-$5.14 disagreement this slice ends, and
  // it is not a figure to "correct" the CLI's total with.
  const sameSessionNoTotal = FIXTURE_STDOUT.replace('"total_cost_usd":5.136778,', '');
  const listPrice = sessionTelemetry(sameSessionNoTotal, FIXTURE_WALL_CLOCK).costUsd;
  assert.ok(listPrice > 0, 'computeCost still covers output that carries no total');
  assert.ok(Math.abs(telemetry.costUsd - listPrice) > 1,
    `the cache-priced total must not be replaced by the local formula (${listPrice})`);

  // computeCost ignores cache reads — two sessions identical but for 5M cache
  // reads are priced the same by it. Only total_cost_usd can tell them apart.
  const cheapCache = '{"type":"result","usage":{"input_tokens":1000,"output_tokens":2000,"cache_read_input_tokens":50}}';
  const richCache  = '{"type":"result","usage":{"input_tokens":1000,"output_tokens":2000,"cache_read_input_tokens":5000000}}';
  const fallback = sessionTelemetry(cheapCache, 61000);
  assert.ok(fallback.costUsd > 0, 'the fallback still prices a session');
  assert.equal(sessionTelemetry(richCache, 61000).costUsd, fallback.costUsd,
    'computeCost is blind to cache reads — which is exactly why it is only the fallback');

  // A pre-386 report has no cost_usd key at all; rounds[] falls back the same way.
  const preFilled = fillDoneMetrics(zerosReport('386'), fallback).replace(/\ncost_usd: [^\n]*/, '');
  assert.ok(!/cost_usd:/.test(preFilled), 'the fixture stands in for a report written before this slice');
  assert.ok(Math.abs(extractRomTelemetry(preFilled).costUsd - fallback.costUsd) < 1e-9,
    'a report with no cost_usd key is still priced, by computeCost');

  // An unparseable session reports null, never a zero that reads as a measurement.
  const blind = sessionTelemetry('not json at all', 5000);
  assert.deepEqual(blind, { tokensIn: null, tokensOut: null, tokensCacheRead: null, elapsedMs: 5000, costUsd: null });
  assert.match(fillDoneMetrics(zerosReport('386'), blind), /\ntokens_in: null\n/,
    'the literal null is written, the same convention as estimated_human_hours: null');
  assert.match(fillDoneMetrics(zerosReport('386'), blind), /\ncost_usd: null\n/);
});

// ── Trap 4: the wiring itself, checked in the source ───────────────────────

test('J-report-metrics-filled — trap 4: invokeRom builds its prompt with buildDoneTemplate, and the fill runs before any reader', () => {
  assert.match(SRC, /const prompt = sliceContent \+ buildDoneTemplate\(\{[^}]*\}\);/,
    'invokeRom must build its prompt with the exported function, or nothing tests the words it sends');
  assert.match(SRC, /function buildDoneTemplate\(\{ id, worktreeDonePath, sliceBranch, sliceContent \}\)/,
    'the four-key signature is what slices 387 to 389 extend');

  // The fill happens after the worktree copy and before anything reads the file.
  const copyIdx = SRC.indexOf("msg: 'Copied DONE file from worktree to PROJECT_DIR'");
  const fillIdx = SRC.indexOf('const filled = fillDoneMetrics(asWritten, telemetry);');
  const readIdx = SRC.indexOf('doneMeta = parseFrontmatter(fs.readFileSync(donePath');
  const verifyIdx = SRC.indexOf('verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut)');
  const doneIdx = SRC.indexOf("registerEvent(id, 'DONE'");
  assert.ok(copyIdx > 0 && fillIdx > copyIdx, 'the fill must follow the copy into bridge/queue/');
  assert.ok(readIdx > fillIdx, 'validation reads the filled copy, not the one Rom wrote');
  assert.ok(verifyIdx > fillIdx, 'the divergence check compares against numbers that are already real');
  assert.ok(verifyIdx < doneIdx, 'verification still runs before the DONE event');

  // One telemetry object per session, computed once from the session output.
  assert.match(SRC, /const telemetry = sessionTelemetry\(stdout \|\| '', durationMs\);/,
    'the exit handler computes the session numbers once');
  assert.equal((SRC.match(/= sessionTelemetry\(/g) || []).length, 1,
    'exactly one call site — a second would be a second set of numbers');
  assert.doesNotMatch(SRC, /const costUsd = computeCost\(tokensIn, tokensOut\);/,
    'the exit handler no longer prices the run itself');
});

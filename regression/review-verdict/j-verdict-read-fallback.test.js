'use strict';

/**
 * Journey: J-verdict-read-fallback
 * Category: Review & Verdict
 *
 * What this tests:
 *   Jordan's verdict is read as the verdict it declares, even when the file it
 *   is written in is malformed.
 *
 *   `{id}-NOG.md` is supposed to be a closed frontmatter block. When Jordan
 *   drops the closing `---`, parseFrontmatter returns null, the round is filed
 *   as `verdict_unreadable` — which is a REJECTED — and the slice is sent round
 *   again. In two days that cost a round three times (390 twice, 358 once) and
 *   on 388 an ACCEPTED verdict was thrown away. Each lost round costs a Sam
 *   session (6–16 min) plus another Jordan review (~8 min).
 *
 *   Slice 399 fixed the writing side (the prompt now shows Jordan the file).
 *   This is the reading side: readNogVerdict tolerates a missing closing fence,
 *   a byte-order mark, leading blank lines and CRLF endings, and when the file
 *   still yields nothing it falls back to the `**Verdict:**` line in Jordan's
 *   review section for the CURRENT round — a line that was intact every time.
 *   Only when both are empty is the round unreadable, exactly as before.
 *
 * Guards:
 *   slice-400-ac-1 … slice-400-ac-6, plus the four traps in the brief.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORCHESTRATOR_SRC_PATH = path.resolve(__dirname, '..', '..', 'bridge', 'orchestrator.js');
const SRC = fs.readFileSync(ORCHESTRATOR_SRC_PATH, 'utf8');

const orchestrator = require('../../bridge/orchestrator');
const {
  readNogVerdict,
  parseFrontmatter,
  NOG_VERDICTS,
  MAX_UNREADABLE_ATTEMPTS,
  UNREADABLE_BACKOFF_MS,
  unreadableBackoffMs,
} = orchestrator;

// The body of invokeNog: everything between its declaration and the next
// top-level function. AC-4 and traps 2 and 3 are about what happens inside it.
const INVOKE_NOG = (() => {
  const start = SRC.indexOf('function invokeNog(id) {');
  const end = SRC.indexOf('function handleNogReturn(', start);
  assert.ok(start > 0 && end > start, 'invokeNog must still be findable in the orchestrator');
  return SRC.slice(start, end);
})();

const HANDLE_ACCEPTED = (() => {
  const start = SRC.indexOf('function handleAccepted(');
  assert.ok(start > 0, 'handleAccepted must still be findable in the orchestrator');
  return SRC.slice(start, start + 2000);
})();

// A verdict file exactly as the reviewer's prompt shows it.
const WELL_FORMED = '---\nverdict: ACCEPTED\nsummary: "All six criteria met."\n---\n';

// A slice file with two review rounds in it, the shape Jordan appends.
function sliceWithRounds(rounds) {
  const head = '---\nid: "400"\ntitle: "A slice"\n---\n\n# A slice\n\nBody.\n';
  return head + rounds.map(([n, verdict]) => [
    '',
    '---',
    '',
    `## Nog Review — Round ${n}`,
    '',
    `**Verdict:** ${verdict}`,
    '',
    '**AC Check:**',
    '- slice-400-ac-1 → ✓ Satisfied',
    '',
  ].join('\n')).join('\n');
}

// ---------------------------------------------------------------------------
// slice-400-ac-1 — a missing closing fence is not a missing verdict
// ---------------------------------------------------------------------------
// @ac-hash: slice-400-ac-1 sha256:d50d21b23e25aea243f4da18a46e773dd9ca646b38442fae5a1f5c7cb47d1475

test('slice-400-ac-1 a verdict file with no closing --- is read as the verdict it declares, with source unfenced', () => {
  const unfenced = '---\nverdict: ACCEPTED\nsummary: "All six criteria met."\n';
  assert.deepEqual(readNogVerdict(unfenced, '', 1), {
    verdict: 'ACCEPTED',
    summary: 'All six criteria met.',
    source: 'unfenced',
  });

  // parseFrontmatter — what the orchestrator used to call here — reads exactly
  // nothing from that file. That is the whole bug, in one assertion.
  assert.equal(parseFrontmatter(unfenced), null,
    'the old reader returns null on this input; if it ever stops doing so, this guard is testing the wrong thing');

  // Every verdict, not just the happy one: an unfenced REJECTED must still
  // reject, or the fix would trade a lost ACCEPTED for a landed rejection.
  for (const verdict of NOG_VERDICTS) {
    const read = readNogVerdict(`---\nverdict: ${verdict}\nsummary: "x"\n`, '', 1);
    assert.equal(read.verdict, verdict, `${verdict} declared unfenced must be read as ${verdict}`);
    assert.equal(read.source, 'unfenced');
  }

  // A closed fence is still a closed fence, and still says so.
  assert.deepEqual(readNogVerdict(WELL_FORMED, '', 1), {
    verdict: 'ACCEPTED',
    summary: 'All six criteria met.',
    source: 'frontmatter',
  });
});

// ---------------------------------------------------------------------------
// slice-400-ac-2 — a byte-order mark, blank lines and CRLF are not the verdict
// ---------------------------------------------------------------------------
// @ac-hash: slice-400-ac-2 sha256:cc30987fe368a1736a2e5dc0863e5144b4554fe0045dbd650cad12a92dd0cf4b

test('slice-400-ac-2 a byte-order mark, leading blank lines or CRLF endings do not hide the verdict', () => {
  const cases = [
    ['byte-order mark', '﻿---\nverdict: ACCEPTED\nsummary: "ok"\n---\n', 'frontmatter'],
    ['leading blank lines', '\n\n   \n---\nverdict: ACCEPTED\nsummary: "ok"\n---\n', 'frontmatter'],
    ['CRLF endings', '---\r\nverdict: ACCEPTED\r\nsummary: "ok"\r\n---\r\n', 'frontmatter'],
    ['all three at once, unfenced', '﻿\r\n\r\n---\r\nverdict: ACCEPTED\r\nsummary: "ok"\r\n', 'unfenced'],
  ];

  for (const [label, content, source] of cases) {
    const read = readNogVerdict(content, '', 1);
    assert.equal(read.verdict, 'ACCEPTED', `${label}: the declared verdict must survive`);
    assert.equal(read.summary, 'ok', `${label}: the summary must survive too — it is the reason the operator reads`);
    assert.equal(read.source, source, `${label}: source`);
  }
});

// ---------------------------------------------------------------------------
// slice-400-ac-3 — the review section decides when the file cannot
// ---------------------------------------------------------------------------
// @ac-hash: slice-400-ac-3 sha256:9f55424fafbd16f92698ac42ccb08dee7af4ce6632cc1f7573c5b520870a62e7

test('slice-400-ac-3 with nothing readable in the verdict file the current round\'s **Verdict:** line decides, and no other round\'s does', () => {
  const slice = sliceWithRounds([[1, 'REJECTED'], [2, 'ACCEPTED']]);

  // Round 2 is being reviewed: round 2's line decides, not round 1's.
  assert.deepEqual(readNogVerdict('', slice, 2), { verdict: 'ACCEPTED', summary: '', source: 'review_section' });

  // Round 1 reads round 1. The two sections are in one file and must not blur.
  assert.deepEqual(readNogVerdict('', slice, 1), { verdict: 'REJECTED', summary: '', source: 'review_section' });

  // A verdict file that exists but declares nothing usable falls back the same
  // way — "yields no valid verdict" is not only "file missing".
  assert.equal(readNogVerdict('---\nverdict: MAYBE\nsummary: "unsure"\n---\n', slice, 2).verdict, 'ACCEPTED');
  assert.equal(readNogVerdict('---\nsummary: "no verdict key at all"\n---\n', slice, 2).source, 'review_section');

  // A readable verdict file always wins; the fallback is a fallback.
  assert.equal(readNogVerdict(WELL_FORMED, sliceWithRounds([[1, 'REJECTED']]), 1).source, 'frontmatter');
});

// ---------------------------------------------------------------------------
// slice-400-ac-4 — the register says which read decided the round
// ---------------------------------------------------------------------------
// @ac-hash: slice-400-ac-4 sha256:e3eadd348da52460cffcacc5108641ea24bd5a44f4254c696bfa7245330f0926

test('slice-400-ac-4 every NOG_DECISION invokeNog emits with a readable verdict carries verdict_source', () => {
  // The three names, and only these three, are what a readable read reports.
  const sources = [
    readNogVerdict(WELL_FORMED, '', 1).source,
    readNogVerdict('---\nverdict: ACCEPTED\n', '', 1).source,
    readNogVerdict('', sliceWithRounds([[1, 'ACCEPTED']]), 1).source,
  ];
  assert.deepEqual(sources, ['frontmatter', 'unfenced', 'review_section']);

  // Walk every NOG_DECISION emission inside invokeNog. The unreadable one must
  // stay bare (there is no source to name); every other one must carry the
  // field. Written as a walk rather than two hard-coded checks so that a
  // NOG_DECISION added here later cannot ship without it.
  const marker = "registerEvent(id, 'NOG_DECISION'";
  let found = 0;
  for (let i = INVOKE_NOG.indexOf(marker); i !== -1; i = INVOKE_NOG.indexOf(marker, i + 1)) {
    found++;
    const call = INVOKE_NOG.slice(i, INVOKE_NOG.indexOf('\n', i));
    const preamble = INVOKE_NOG.slice(Math.max(0, i - 400), i);
    if (call.includes('verdict_unreadable')) {
      assert.ok(!call.includes('verdict_source'),
        'the unreadable path names no source — there was nothing to read');
      continue;
    }
    assert.ok(/verdict_source/.test(call) || /verdict_source/.test(preamble),
      `a NOG_DECISION with a readable verdict must record where the verdict came from: ${call.trim()}`);
  }
  assert.equal(found, 2, 'invokeNog emits NOG_DECISION on the unreadable and the rejected paths');

  // The ACCEPTED decision is emitted by handleAccepted on invokeNog's behalf,
  // so the source has to be handed across the call.
  assert.match(INVOKE_NOG, /handleAccepted\([^)]*verdictSource\)/,
    'the accepted path must pass the source through to handleAccepted');
  assert.match(HANDLE_ACCEPTED, /if \(verdictSource\) acceptedDecision\.verdict_source = verdictSource;/,
    'handleAccepted must put the source on its NOG_DECISION when it has one');
  assert.match(HANDLE_ACCEPTED, /registerEvent\(id, 'NOG_DECISION', acceptedDecision\)/,
    'and must emit that object, not a literal built beside it');
});

// ---------------------------------------------------------------------------
// slice-400-ac-5 — a genuinely unreadable verdict is still unreadable
// ---------------------------------------------------------------------------
// @ac-hash: slice-400-ac-5 sha256:7392540d0a2d76ad690d6cd0d6e5f8d66678afaa995c0296b233907fea0df110

test('slice-400-ac-5 no verdict in the file and none in this round\'s section is filed as verdict_unreadable, with the backoff and cap untouched', () => {
  const noVerdictHere = sliceWithRounds([[1, 'ACCEPTED']]);
  const nothing = { verdict: null, summary: '', source: null };

  assert.deepEqual(readNogVerdict('', '', 1), nothing, 'nothing anywhere');
  assert.deepEqual(readNogVerdict('I reviewed it and it looks fine to me.', '', 1), nothing, 'prose is not a verdict');
  assert.deepEqual(readNogVerdict('---\nverdict: LOOKS_GOOD\n---\n', '', 1), nothing, 'an invented verdict is not one of the four');
  assert.deepEqual(readNogVerdict('---\nsummary: "no verdict"\n', '', 1), nothing, 'unfenced with no verdict key');
  assert.deepEqual(readNogVerdict('', noVerdictHere, 2), nothing, 'this round has no section yet');
  assert.deepEqual(readNogVerdict(undefined, undefined, undefined), nothing, 'a read that threw gives us nothing to work with');

  // The path those nulls fall into is the one slice 372 built, unchanged.
  assert.equal(MAX_UNREADABLE_ATTEMPTS, 3, 'the three-attempt cap');
  assert.deepEqual(UNREADABLE_BACKOFF_MS, [60000, 300000], 'the backoff schedule');
  assert.equal(unreadableBackoffMs(1), 60000);

  const branch = INVOKE_NOG.slice(INVOKE_NOG.indexOf("if (!verdict || !['ACCEPTED', 'REJECTED', 'ESCALATE', 'OVERSIZED'].includes(verdict))"));
  assert.ok(branch.length > 0, 'the unreadable branch must still be entered on a null verdict');
  assert.ok(branch.includes("reason: 'verdict_unreadable'"), 'the register reason is unchanged');
  assert.ok(branch.includes('countUnreadableVerdicts(id, round)'), 'the attempts are still counted per round');
  assert.ok(branch.includes('if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS)'), 'the cap still fires');
  assert.ok(branch.includes('const backoffMs = unreadableBackoffMs(unreadableAttempts)'), 'the retry still backs off');
  assert.ok(/handleNogReturn\([^)]*notBefore\)/.test(branch), 'the re-queue still carries the backoff stamp');
});

// ---------------------------------------------------------------------------
// slice-400-ac-6 — parseFrontmatter is not the thing that changed
// ---------------------------------------------------------------------------
// @ac-hash: slice-400-ac-6 sha256:be1581dd4149ab3f1d313a2398ae9605a644df34c63a6eee500687f13b2242b2

test('slice-400-ac-6 parseFrontmatter behaves exactly as before; only the verdict read in invokeNog moved off it', () => {
  // About thirty callers read frontmatter through this function. Its answers are
  // pinned here so that "be lenient about fences" cannot leak into them: a
  // tolerant parseFrontmatter would make every headed markdown file in the queue
  // parse its own body as frontmatter.
  assert.deepEqual(parseFrontmatter('---\nid: "400"\ntitle: "A slice"\n---\n\nbody'), { id: '400', title: 'A slice' });
  assert.equal(parseFrontmatter('---\nverdict: ACCEPTED\n'), null, 'no closing fence is still no frontmatter');
  assert.equal(parseFrontmatter('﻿---\nverdict: ACCEPTED\n---\n'), null, 'a byte-order mark still defeats it');
  assert.equal(parseFrontmatter('\n---\nverdict: ACCEPTED\n---\n'), null, 'a leading blank line still defeats it');
  assert.equal(parseFrontmatter('---\r\nverdict: ACCEPTED\r\n---\r\n'), null, 'CRLF still defeats it');
  assert.equal(parseFrontmatter('no frontmatter at all'), null);
  assert.deepEqual(parseFrontmatter('---\nnot a pair\nkey: value\n---'), { key: 'value' }, 'lines without a colon are still skipped');
  assert.deepEqual(parseFrontmatter('---\nkey: a: b\n---'), { key: 'a: b' }, 'only the first colon still splits');
  assert.deepEqual(parseFrontmatter("---\nkey: 'quoted'\n---"), { key: 'quoted' }, 'surrounding quotes are still stripped');

  // Its source is byte-identical to what it was.
  const fn = SRC.slice(SRC.indexOf('function parseFrontmatter(content) {'), SRC.indexOf('// Sets or replaces key-value pairs in YAML frontmatter'));
  assert.ok(fn.includes('const match = content.match(/^---\\n([\\s\\S]*?)\\n---/);'), 'the fence regex is untouched');
  assert.ok(fn.includes('if (!match) return null;'), 'it still refuses malformed input');

  // And invokeNog no longer reads the verdict through it. This is the change.
  assert.ok(!/parseFrontmatter\(nogContent\)/.test(INVOKE_NOG),
    'the verdict file must not be read with parseFrontmatter any more');
  assert.match(INVOKE_NOG, /readNogVerdict\(nogContent, updatedSliceContent, round\)/,
    'the verdict read is the only thing that changed, and this is it');
});

// ---------------------------------------------------------------------------
// Trap 1 — an earlier round's Verdict line is still in the file
// ---------------------------------------------------------------------------

test('J-verdict-read-fallback slice-400-trap-1 a Verdict line outside the current round\'s section is never read', () => {
  // Round 1 REJECTED deciding round 2 would rework work that was accepted; a
  // round 1 ACCEPTED deciding round 2 would land work nobody signed off. Both
  // directions have to be shut.
  const rejectedThenAccepted = sliceWithRounds([[1, 'REJECTED'], [2, 'ACCEPTED']]);
  const acceptedThenRejected = sliceWithRounds([[1, 'ACCEPTED'], [2, 'REJECTED']]);

  assert.equal(readNogVerdict('', rejectedThenAccepted, 2).verdict, 'ACCEPTED');
  assert.equal(readNogVerdict('', acceptedThenRejected, 2).verdict, 'REJECTED');

  // The section this round has not written yet is empty, not "whatever the last
  // round said". Round 3 finds nothing even though rounds 1 and 2 both decided.
  assert.equal(readNogVerdict('', rejectedThenAccepted, 3).verdict, null);
  assert.equal(readNogVerdict('', rejectedThenAccepted, 3).source, null);

  // The section ends at the next `## ` heading, whatever that heading is —
  // Sam's round-2 report sits between the two review sections in a real file.
  const interleaved = [
    '## Nog Review — Round 1', '', '**Verdict:** REJECTED', '',
    '## Rom DONE Report — Round 2', '', '**Verdict:** ACCEPTED', '',
  ].join('\n');
  assert.equal(readNogVerdict('', interleaved, 1).verdict, 'REJECTED',
    'reading past the heading would let Sam\'s own report decide his review');

  // Round 1 must not match "Round 10" — a prefix match would have round 1 read
  // a verdict from a round that cannot exist yet.
  assert.equal(readNogVerdict('', sliceWithRounds([[10, 'ACCEPTED']]), 1).verdict, null);
  assert.equal(readNogVerdict('', sliceWithRounds([[1, 'ACCEPTED']]), 10).verdict, null);
});

// ---------------------------------------------------------------------------
// Trap 2 — the unreadable path is pinned by an existing guard
// ---------------------------------------------------------------------------

test('J-verdict-read-fallback slice-400-trap-2 the retry-cap guard\'s subject is untouched', () => {
  // regression/review-verdict/j-unreadable-verdict-retry-cap.test.js pins this
  // path. It reads the orchestrator source by the same landmarks, so those
  // landmarks must still be where it looks.
  const capIdx = SRC.indexOf('if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS) {');
  assert.ok(capIdx > 0, 'the cap block must still exist at a findable landmark');
  const block = SRC.slice(capIdx, capIdx + 2200);
  assert.ok(block.includes("'VERDICT_UNREADABLE_EXHAUSTED'"), 'the terminal event survives');
  assert.ok(block.includes('-STUCK.md'), 'the terminal state survives');
  assert.ok(block.includes("reason: 'verdict_unreadable_retry_cap'"), 'the transition reason survives');

  // And a verdict that is genuinely unreadable still reaches it — the new reader
  // must not invent a verdict out of a file that has none.
  assert.equal(readNogVerdict('---\nsummary: "I could not decide."\n---\n', 'no review section here', 1).verdict, null);
  assert.equal(readNogVerdict('```\nverdict: ACCEPTED\n```', '', 1).verdict, null,
    'a code fence is not a frontmatter fence');
  assert.equal(readNogVerdict('Everything looks good.\n---\nverdict: ACCEPTED\n---\n', '', 1).verdict, null,
    'prose before the fence is the shape the prompt forbids; reading it would be inventing a rule nobody wrote');
});

// ---------------------------------------------------------------------------
// Trap 3 — the fallback must see the review Jordan actually wrote
// ---------------------------------------------------------------------------

test('J-verdict-read-fallback slice-400-trap-3 the verdict is read after the slice file is copied back from the worktree', () => {
  // Jordan appends his review inside his worktree. Until the orchestrator copies
  // that file back and re-reads it, the slice content in hand is the pre-review
  // version — and the fallback would never find a thing.
  const copyIdx = INVOKE_NOG.indexOf('fs.copyFileSync(worktreeResolved, resolvedParkedPath)');
  const rereadIdx = INVOKE_NOG.indexOf('updatedSliceContent = fs.readFileSync(resolvedParkedPath');
  const readIdx = INVOKE_NOG.indexOf('readNogVerdict(nogContent, updatedSliceContent, round)');

  assert.ok(copyIdx > 0, 'the worktree copy must still happen');
  assert.ok(rereadIdx > copyIdx, 'the re-read must follow the copy');
  assert.ok(readIdx > rereadIdx, 'the verdict read must follow the re-read, or the fallback reads a file Jordan had not written to yet');

  // The closure's own sliceContent is the pre-Nog version; handing that to the
  // reader would be the same bug with the lines in the right order.
  assert.ok(!/readNogVerdict\([^)]*[^d]sliceContent[,)]/.test(INVOKE_NOG),
    'the reader must be given updatedSliceContent, never the stale sliceContent');

  // Proof the distinction matters: the pre-review file has no section at all.
  assert.equal(readNogVerdict('', sliceWithRounds([]), 1).verdict, null);
  assert.equal(readNogVerdict('', sliceWithRounds([[1, 'ACCEPTED']]), 1).verdict, 'ACCEPTED');
});

// ---------------------------------------------------------------------------
// Trap 4 — the daemon runs the code it was started with
// ---------------------------------------------------------------------------

test('J-verdict-read-fallback slice-400-trap-4 the restart this fix needs is written next to the code that needs it', () => {
  // Landing this changes nothing for the running pipeline: the orchestrator is a
  // long-lived daemon and holds the old module until it is restarted. That has
  // bitten this project before — gate fixes sat undeployed for a week because
  // the server was never restarted. The note belongs where the next person
  // editing this function will read it, not only in a report that gets archived.
  const doc = SRC.slice(SRC.indexOf(' * readNogVerdict(verdictFileContent'), SRC.indexOf('function readNogVerdict('));
  assert.ok(doc.length > 0, 'readNogVerdict must carry a doc comment');
  assert.match(doc, /restart/i, 'the doc comment must say the daemon needs a restart');
  assert.ok(doc.includes('launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator'),
    'and must give the exact command, so nobody has to go looking for it');
});

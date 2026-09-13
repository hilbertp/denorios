'use strict';

/**
 * nog-prompt.js
 *
 * Builds the prompt string passed to Nog via `claude -p` for code review.
 * Nog reviews O'Brien's work against the slice's acceptance criteria,
 * runs linting checks, and evaluates code quality per ROLE.md.
 */

/**
 * buildNogPrompt({ id, round, sliceFileContents, doneReportContents, gitDiff, scopeDiff, slicePath, lane })
 *
 * @param {Object} opts
 * @param {string} opts.id              - Slice ID
 * @param {number} opts.round           - Current review round (1–5)
 * @param {string} opts.sliceFileContents - Full contents of the slice file (including any prior Nog reviews)
 * @param {string} opts.doneReportContents - O'Brien's DONE report contents
 * @param {string} opts.gitDiff         - Output of `git diff main...{branch}`
 * @param {string} opts.scopeDiff       - File-level scope summary for scope discipline check
 * @param {string} opts.slicePath       - Absolute path to the slice file (for Nog to append review)
 * @param {string} opts.lane            - 'surface' | 'core' (slice 389); anything else is core
 * @returns {string} The complete prompt for Nog
 */
function buildNogPrompt({ id, round, sliceFileContents, doneReportContents, gitDiff, scopeDiff, slicePath, lane }) {
  // Part 5 exists because a lighter lane needs a reviewer who knows it is lighter.
  // Told nothing, Jordan rejects a surface slice for the tests it was excused from
  // writing, and the saving goes straight back out as a rework round. The lane also
  // has to be checked against the diff, or "surface" becomes the way to skip proof
  // on a change that alters behaviour (ADR-PROOF-LANES §2, §5).
  const isSurface = String(lane == null ? '' : lane).trim().toLowerCase() === 'surface';
  const laneCheck = isSurface
    ? [
        '### Part 5: Lane check',
        'Lane check: this slice is declared surface. Do not reject for missing tests, a missing break-it list or missing browser evidence.',
        "Reject, with the fix instruction 'lane mismatch: this change alters behaviour (name the function or branch); Alex must re-file it as core', if the diff adds or changes control flow, state, git operations, the gate, an API endpoint or its response.",
        'The surface report has four headings: Summary, What changed, Screen hooks, Commit; do not reject for the absence of Acceptance criteria verification, Safety-net tests or Tests moved or weakened.',
      ]
    : [
        '### Part 5: Lane check',
        'Lane check: this slice is declared core. The test rules apply unchanged: one safety-net test per acceptance criterion plus one per trap, the break-it list under Safety-net tests, and the seven report headings of the contract.',
      ];

  return [
    'You are Nog, Code Reviewer for the DS9 pipeline.',
    'Read your role definition at: .claude/roles/nog/ROLE.md',
    '',
    `You are reviewing slice ${id} — round ${round}.`,
    '',
    'Your review has FIVE parts:',
    '',
    '### Part 1: Code Review',
    'Review the code changes per ROLE.md: correctness, quality, lint, test coverage, no regressions.',
    '',
    '### Part 2: Acceptance Criteria',
    'Did Rom\'s work satisfy ALL acceptance criteria in the original slice?',
    'Be specific. If even one AC is not met, the verdict is REJECTED.',
    '',
    '### Part 3: Intent Verification',
    'Every slice has a goal — a reason it exists. Read the slice\'s title and goal field.',
    'Then ask: does the shipped solution actually achieve that intent?',
    '',
    'It is possible to tick every AC checkbox while missing the point entirely.',
    'For example: a slice asks for "pagination so users can browse large result sets".',
    'Rom could add prev/next buttons that technically satisfy the AC "add pagination',
    'controls" but wire them to a hardcoded page 1 — the ACs pass, the intent fails.',
    '',
    'If the solution does not meaningfully achieve the slice\'s stated goal,',
    'even if individual ACs are technically met, the verdict is REJECTED.',
    'Explain what the gap is between the intent and what was delivered.',
    '',
    '### Part 4: Scope Discipline',
    'Review the list of changed files below against the slice\'s title and goal.',
    'Ask yourself:',
    '- Did Rom ONLY change files that are relevant to this slice\'s goal?',
    '- Were any files modified that have nothing to do with the task?',
    '- If files outside the expected scope were touched, is there a clear reason',
    '  (e.g. a shared utility that needed updating, a config change required by the feature)?',
    '- Did any existing file lose significant content that was NOT related to the task?',
    '',
    'Out-of-scope changes are a red flag. If you see them and the DONE report does',
    'not explain why, the verdict is REJECTED — the fix instruction should be',
    '"revert changes to [file] that are outside the scope of this slice."',
    '',
    ...laneCheck,
    '',
    'Slice file (includes original brief and any prior review rounds):',
    sliceFileContents,
    '',
    "O'Brien's DONE report:",
    doneReportContents,
    '',
    'Git diff (main...branch):',
    gitDiff,
    '',
    scopeDiff || '',
    '',
    'Perform your review covering all five parts. Then:',
    `1. Append your review section to the slice file at: ${slicePath}`,
    `2. Write your verdict to: bridge/queue/${id}-NOG.md`,
    '   Format: YAML frontmatter with one of the following `verdict` values, plus a one-line `summary`:',
    '     verdict: ACCEPTED  — code quality cleared, all ACs met, intent achieved, no scope violations',
    '     verdict: REJECTED  — one or more issues found (code quality, AC unmet, intent gap, or scope); rework needed',
    '     verdict: ESCALATE  — ACs are contradictory, impossible, or require scope change; needs O\'Brien',
    '     verdict: OVERSIZED — diff too large or scope exceeded; slice must be split before review',
    '',
    'Do not modify any code. Read only. Write only to the two files above.',
  ].join('\n');
}

module.exports = { buildNogPrompt };

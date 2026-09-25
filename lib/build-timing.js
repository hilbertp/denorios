'use strict';

// Where a build's minutes went (slice 392).
//
// The register records one number per build — `durationMs` — so the only way to
// learn whether sixteen minutes went into the product change or into proof and
// paperwork was a hand parser over bridge/logs/rom-<id>.log that Taylor ran by
// hand (ADR-PROOF-LANES §1 was derived that way, eleven passes over slice 383).
// §8 wants that split for twenty runs. This module is the parser, made pure so
// the pipeline can run it on every session.
//
// The rules are ADR-PROOF-LANES §1's, one phase per tool call:
//
//   orient       Read; grep, sed -n, cat, head, ls, find
//   build        Write/Edit outside regression/ and outside the DONE report;
//                sed -i, python3 -, node -e, heredocs that write product files
//   tests        Write/Edit under regression/; `node --test <one file>`
//   break-it     git stash or `git checkout --`, and the test runs inside that window
//   suite        npm test, `node --test` over a directory or a glob
//   locks        build-coverage-map, build-ac-manifest, ac-reconcile, the two lock files
//   report       the DONE file, commit message files
//   git          add, commit, status, diff, log, push
//   browser-look playwright, chromium, curl
//   other        everything else
//
// Timing follows the stream-json shape: a tool call is a `tool_use` block in an
// assistant event, its result a `tool_result` block in a later user event, and
// both carry `timestamp`. Model time for a call is the gap from the previous
// result to the call; tool time is the gap from the call to its result.
//
// Every interval between two consecutive timestamps is charged EXACTLY ONCE, so
// the phase seconds add up to the run's span instead of exceeding it. That is
// why a result event's gap is measured from the clock rather than from its own
// call, and why parallel calls in one message share their gap instead of each
// claiming the whole of it — a session that batches ten reads into one message
// spends one interval of wall clock, not ten.
//
// Pure: no I/O, no git, no clock, no dependencies (trap 3 — lib/ must not reach
// into bridge/orchestrator.js, whose module load seeds runtime files).

// The canonical order — the vocabulary, not a ranking. Callers that render a
// split sort by minutes; this list is what `other` is measured against.
const PHASES = ['orient', 'build', 'tests', 'break-it', 'suite', 'locks', 'report', 'git', 'browser-look', 'other'];

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS  = new Set(['Read', 'Grep', 'Glob', 'LS']);

// A shell fragment that puts bytes on disk. `2>&1` is not one: the character
// before the arrow is a digit, which is why the leading class excludes them.
const WRITE_OP = /(^|[^0-9&>])>>?\s*[^|&;\s]|\btee\b|<<\s*['"]?[A-Za-z_]|\bsed\s+-i\b/;

// Scratch space. A heredoc into /tmp is not a product file, and charging it to
// `build` would move the first-product-edit minute earlier than the truth.
const TRANSIENT_PATH = /\/tmp\/|\/dev\/null|\/var\/folders\//;

const LOCKISH  = /build-coverage-map|build-ac-manifest|ac-reconcile|COVERAGE\.lock|AC-MANIFEST\.lock|AC-RECONCILE/i;
const REPORTISH = /-DONE\.md|COMMIT_EDITMSG|commit[-_]?msg/i;

// First word of any segment of a pipeline or an && chain.
const ORIENT_CMD = /(^|[|&;]\s*)(grep|rg|cat|head|tail|ls|find|wc|awk|which|file|tree|jq|sed\s+-n)\b/;

const BUILD_CMD = /\bpython3?\s+-(\s|c\b)|\bnode\s+-e\b/;

function bump(phases, phase, key, amount) {
  const row = phases[phase] || (phases[phase] = { calls: 0, model_ms: 0, tool_ms: 0 });
  row[key] += amount;
}

// Shell decoration around a target: a redirect and everything after it, and the
// quotes a path may be wrapped in. One file is still one file when its stderr is
// piped somewhere — and the count of targets is what separates the test Sam
// wrote from the suite he is not supposed to run, so the decoration has to come
// off before anything is counted. The optional leading digits are the fd of
// `2>&1`; they belong to the arrow, not to the target list.
const REDIRECT_TAIL = /\d*(?:>>?|<)[\s\S]*$/;

// `node --test` is two phases depending on its target: one file is the test Sam
// wrote, a directory or a glob is the suite he is not supposed to run at all.
function nodeTestKind(cmd) {
  const m = /\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*--test\b([^|&;]*)/.exec(cmd);
  if (!m) return null;
  const targets = m[1].replace(REDIRECT_TAIL, '').split(/\s+/).filter(t => t && !t.startsWith('-'));
  if (targets.length !== 1) return 'suite';
  const t = targets[0].replace(/^['"]|['"]$/g, '');
  if (t.includes('*') || t.endsWith('/') || !/\.(js|mjs|cjs)$/.test(t)) return 'suite';
  return 'tests';
}

// `git commit -m "$(cat <<'EOF' … EOF)"` puts no bytes on disk that anyone
// builds with: the heredoc carries a commit message. Left in, that heredoc reads
// as a write-op and the commit lands in `build` — the one line Philipp reads
// first — or in `tests`, when the message names the test file it added. So the
// whole construct comes out (opener, body and terminator) before any rung asks
// whether the command writes; a message that happens to contain `->` cannot read
// as an edit either. What is left is judged on its own, so the `sed -i` in
// `git commit -m "$(…)" && sed -i …` still counts as the edit it is. The other
// spelling, `git commit -F /tmp/msg.txt`, already lands in `git` by being
// transient; this puts the two forms in the same place.
// The `[^|;&\n]*` between the subcommand and the `<<` is the command's own
// arguments and nothing else: it stops at `&` as well as at `|` and `;`, so the
// strip cannot reach across `&&` and swallow a heredoc belonging to the command
// after it — `git commit -m 'x' && cat > dashboard/server.js <<'EOF' … EOF` is
// still the product write it is. It stops short of nothing real: in
// `git add … && git commit -m "$(…)"` the match simply starts at the second
// `git`, after the `&&`.
const GIT_MSG_HEREDOC = /\bgit\s+(?:commit|tag|merge|revert|notes)\b[^|;&\n]*<<\s*(['"]?)(\w+)\1[\s\S]*?\n\2\b[^\n]*/g;

function withoutGitMessage(cmd) {
  return cmd.replace(GIT_MSG_HEREDOC, ' git-message ');
}

// The ladder, in the order it is read. A command matches at most one rung, and
// the first rung that claims it wins: `git stash && node --test x.js` is the
// break-it ritual, not a test run; a heredoc into a lock file is lock work, not
// a build. Write-ish rungs sit above read-ish ones so `cat a && sed -i b` counts
// as the edit it is.
//
// Every rung is asked about `written` — the command with any git message taken
// out — because a commit message is not a command. Sam's messages name the lock
// files he regenerated and quote the commands he ran, and a rung reading the raw
// text bills that prose as lock work or as a suite run that never happened.
//
// `git` is the single exception and reads `raw`. The strip deliberately destroys
// the evidence that rung looks for — a bare heredoc commit reduces to
// ` git-message ` — so the one question that must be asked of what was actually
// typed is "was git invoked?". That asymmetry is the whole design: everything
// above the `git` rung asks what the command *did*, and prose does nothing.
const BASH_LADDER = [
  ['locks',        w => LOCKISH.test(w)],
  ['break-it',     w => /\bgit\s+stash\b/.test(w) || /\bgit\s+checkout\s+--(\s|$)/.test(w)],
  ['suite',        w => /\bnpm\s+(run\s+)?test\b/.test(w) || nodeTestKind(w) === 'suite'],
  ['browser-look', w => /\bplaywright\b|\bchromium\b|\bpuppeteer\b|\bcurl\b|\bopen\s+https?:/.test(w)],
  ['tests',        w => nodeTestKind(w) === 'tests' || (WRITE_OP.test(w) && /(^|[\s'"/])regression\//.test(w))],
  ['report',       w => WRITE_OP.test(w) && REPORTISH.test(w)],
  ['build',        w => BUILD_CMD.test(w) || (WRITE_OP.test(w) && !TRANSIENT_PATH.test(w))],
  ['git',          (w, raw) => /\bgit\s+[a-z]/.test(raw)],
  // A command that puts bytes on disk is never orientation, whatever it starts
  // with: `cat > scratch <<EOF` is writing, not reading.
  ['orient',       w => ORIENT_CMD.test(w) && !WRITE_OP.test(w)],
];

function bashPhase(cmd) {
  const written = withoutGitMessage(cmd);
  for (const [phase, matches] of BASH_LADDER) {
    if (matches(written, cmd)) return phase;
  }
  return 'other';
}

function pathPhase(p) {
  if (!p) return 'other';
  if (REPORTISH.test(p)) return 'report';
  if (LOCKISH.test(p)) return 'locks';
  if (/(^|\/)regression\//.test(p)) return 'tests';
  return 'build';
}

/**
 * phaseOf(toolName, input) → phase
 *
 * One call, one phase, no history. The break-it window is the one rule this
 * cannot see (a stash and the red run that follows it are two calls), so
 * attributeRun layers that on top; everything else is decidable here, which is
 * what makes the rules testable one call at a time.
 */
function phaseOf(toolName, input) {
  const name = String(toolName || '');
  const inp = input && typeof input === 'object' ? input : {};
  if (name === 'Bash') return bashPhase(String(inp.command || ''));
  if (WRITE_TOOLS.has(name)) return pathPhase(String(inp.file_path || inp.notebook_path || inp.path || ''));
  if (READ_TOOLS.has(name)) return 'orient';
  return 'other';
}

function contentBlocks(ev) {
  const msg = ev && ev.message;
  const content = msg && msg.content;
  return Array.isArray(content) ? content : [];
}

function tsOf(ev) {
  const raw = ev && ev.timestamp;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return isFinite(ms) ? ms : null;
}

function round1(ms) {
  return Math.round(ms / 100) / 10;
}

/**
 * createAttributor() → { event(ev), result() }
 *
 * The attribution, one event at a time. `event` takes a parsed stream-json
 * event; `result` finishes the run and returns
 * { span_s, calls, first_product_edit_s, phases }, the same object attributeRun
 * always returned and the same object however many times it is asked for. After
 * it, further events are ignored: a split is a reading of a session that ended.
 *
 * Incremental because the daemon no longer holds the session's text (slice 396)
 * — it reads the session as it arrives, so the attribution has to as well.
 *
 * phases is { <phase>: { calls, model_s, tool_s } } and holds only the phases
 * the run actually used — a line per phase the build never entered is noise on
 * a screen, not a measurement.
 *
 * Never throws. A log with no timestamps still counts its calls and their
 * phases, and reports span_s: null with zero seconds rather than a fabricated
 * duration (trap: a zero that reads as a measurement is worse than a null).
 * A tool_result with no tool_use (truncated log) moves the clock on and is
 * charged to nothing — its seconds go missing from the split rather than being
 * guessed into a phase. A tool_use with no result (killed run) keeps its model
 * time and its call, and has no tool time to spend (trap 2).
 */
function createAttributor() {
  const phases = {};
  let calls = 0;
  let runStart = null;
  let runEnd = null;
  let clock = null;               // when the last thing finished
  let firstProductEditMs = null;
  let breakItOpen = false;
  const pending = new Map();      // tool_use_id → { phase, at }
  let finished = null;            // the split, computed once and then frozen

  function event(ev) {
    if (finished) return;
    if (!ev || typeof ev !== 'object') return;

    const ts = tsOf(ev);
    if (ts != null) {
      // The clock starts at the run's first event, not at its first tool call,
      // so the session's start-up and its first thinking are charged to the
      // first call rather than falling out of the split.
      if (runStart == null) { runStart = ts; clock = ts; }
      runEnd = ts;
    }

    if (ev.type === 'assistant') {
      const uses = contentBlocks(ev).filter(b => b && b.type === 'tool_use');
      if (uses.length === 0) return;   // a text-only turn is the next call's thinking time

      const gap = (ts != null && clock != null) ? Math.max(0, ts - clock) : 0;
      const share = gap / uses.length;

      for (const use of uses) {
        let phase = phaseOf(use.name, use.input);

        // Break-it is a ritual, not one call: stash the fix, run the test file,
        // watch it go red, put the fix back. Charging only the two git calls to
        // break-it would bill the red run to `tests` and understate the proof
        // the core lane demands. So a stash opens a window that reclaims the
        // test runs inside it; the restore closes it, and so does the first call
        // that is neither a test run nor bookkeeping — a stash that is never
        // restored must not swallow the rest of the run.
        if (phase === 'break-it') {
          breakItOpen = !/\bgit\s+stash\s+(apply|pop|drop)\b/.test(String((use.input || {}).command || ''));
        } else if (breakItOpen) {
          if (phase === 'tests' || phase === 'suite') phase = 'break-it';
          else if (phase !== 'git' && phase !== 'orient') breakItOpen = false;
        }

        calls++;
        bump(phases, phase, 'calls', 1);
        bump(phases, phase, 'model_ms', share);
        if (phase === 'build' && firstProductEditMs == null && ts != null && runStart != null) {
          firstProductEditMs = ts - runStart;
        }
        if (use.id != null) pending.set(use.id, { phase, at: ts });
      }

      if (ts != null) clock = ts;
    } else if (ev.type === 'user') {
      const results = contentBlocks(ev).filter(b => b && b.type === 'tool_result');
      if (results.length === 0) return;

      const matched = [];
      for (const r of results) {
        const call = pending.get(r.tool_use_id);
        if (call) { matched.push(call); pending.delete(r.tool_use_id); }
      }

      if (matched.length > 0 && ts != null && clock != null) {
        const gap = Math.max(0, ts - clock);
        for (const call of matched) bump(phases, call.phase, 'tool_ms', gap / matched.length);
      }

      if (ts != null) clock = ts;
    }
  }

  function result() {
    if (finished) return finished;

    const timed = runStart != null && runEnd != null;
    const out = {};
    for (const name of Object.keys(phases)) {
      const row = phases[name];
      out[name] = {
        calls: row.calls,
        model_s: timed ? round1(row.model_ms) : 0,
        tool_s:  timed ? round1(row.tool_ms)  : 0,
      };
    }

    finished = {
      span_s: timed ? round1(runEnd - runStart) : null,
      calls,
      first_product_edit_s: (timed && firstProductEditMs != null) ? round1(firstProductEditMs) : null,
      phases: out,
    };
    return finished;
  }

  return { event, result };
}

/**
 * attributeRun(ndjsonText) → { span_s, calls, first_product_edit_s, phases }
 *
 * The whole-text form: feeds every line of a session to a fresh attributor and
 * finishes it. The daemon no longer holds a session's text to call this — it
 * feeds the attributor event by event as the session speaks (slice 396) — but a
 * log on disk is still a string, and every test of this file is one.
 */
function attributeRun(ndjsonText) {
  const attributor = createAttributor();
  for (const line of String(ndjsonText || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let ev;
    try { ev = JSON.parse(s); } catch (_) { continue; }
    attributor.event(ev);
  }
  return attributor.result();
}

module.exports = { attributeRun, createAttributor, phaseOf, PHASES };

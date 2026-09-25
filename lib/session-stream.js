'use strict';

/**
 * lib/session-stream.js — one claude session, read line by line as it speaks.
 *
 * Slices 358 and 363 were killed at 28 and 24 minutes by
 * ERR_CHILD_PROCESS_STDIO_MAXBUFFER: execFile holds the WHOLE session in memory
 * so it can hand it to a callback, and a dashboard slice that reads screenshots
 * logs 160-420 KB per image. Raising the cap to 256 MB (a8da61f) moved the
 * cliff; it did not remove it, and it bought the move by letting one session
 * hold a quarter of a gigabyte of strings.
 *
 * This removes the buffer. The session is read as it arrives: every chunk is
 * teed to the log and then dropped, and what the run needs afterwards — the
 * result event, the session id, four whole-session flags, the last 64 KB of
 * each stream and the byte count — is kept as it goes past. A session of any
 * size finishes; memory does not grow with it.
 *
 * Traps this file exists to survive:
 *
 *  · A chunk boundary is not a line boundary, and it is not a character
 *    boundary either. Lines are joined across chunks through a StringDecoder,
 *    so a result event written in two writes is still one line, and a multi-byte
 *    character split between them still reaches the log and the retained values
 *    whole. Reading the whole output never split either, which is why nothing
 *    in the daemon guarded it before.
 *
 *  · The prompt goes in on stdin. Starting the child with stdin 'ignore' starts
 *    the session with an empty prompt, which is a session that does nothing for
 *    30 minutes and then times out.
 *
 *  · spawn reports "cannot start the command" as an 'error' EVENT, not as a
 *    callback argument. Unhandled it throws, and it throws in the daemon's own
 *    process. It is reported here as one callback with `spawnError` set, exactly
 *    once, the way execFile's callback reported it.
 */

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

// What each stream keeps for the post-mortem: the tail an ERROR file quotes.
const TAIL_BYTES = 64 * 1024;

// An unterminated "line" this long is not a CLI event — it is a stream with no
// newlines in it, and holding it would put the buffer back. Its flags are read
// off it and all but a seam is dropped.
const MAX_LINE_CHARS = 8 * 1024 * 1024;
const LINE_SEAM_CHARS = 256;

const STDERR_PREFIX = Buffer.from('[stderr] ');

// ── the tail ring ───────────────────────────────────────────────────────────
// Bytes, not characters: the ERROR file's "last 65,536 bytes" is a byte count,
// and a Buffer is the only thing that can be cut at one without inventing a
// character. Chunks older than the cap are dropped as they are overtaken, so
// the ring holds at most one chunk more than it needs.

function createTail(cap) {
  return { cap, chunks: [], bytes: 0 };
}

function pushTail(tail, chunk) {
  tail.chunks.push(chunk);
  tail.bytes += chunk.length;
  while (tail.chunks.length > 1 && (tail.bytes - tail.chunks[0].length) >= tail.cap) {
    tail.bytes -= tail.chunks.shift().length;
  }
}

function readTail(tail) {
  if (tail.chunks.length === 0) return '';
  const buf = tail.chunks.length === 1 ? tail.chunks[0] : Buffer.concat(tail.chunks, tail.bytes);
  const cut = buf.length > tail.cap ? buf.subarray(buf.length - tail.cap) : buf;
  return cut.toString('utf8');
}

// ── whole-session flags ─────────────────────────────────────────────────────
// Four questions the run asks of the session AFTER it has ended, and the answer
// to all four is "anywhere in it" — a rate limit announced in the first minute
// of a 40-minute session is still a rate limit. None of the four patterns can
// span a newline, so asking them of every line as it goes past gives the same
// answer as asking them of the whole text, which is what the daemon did before.

function scanFlags(flags, line) {
  if (!flags.hitYourLimit && line.includes('hit your limit')) flags.hitYourLimit = true;
  if (!flags.rateLimitRejected && /"rate_limit_event"[^\n]*"status":"rejected"/.test(line)) flags.rateLimitRejected = true;
  if (!flags.apiError && line.includes('"api_error"')) flags.apiError = true;
  if (!flags.apiError5xx && /API Error: 5\d\d/.test(line)) flags.apiError5xx = true;
}

/**
 * streamSession(options, done) → ChildProcess
 *
 * options:
 *   command     the executable (config.claudeCommand)
 *   args        its argument list
 *   cwd         where to run it
 *   prompt      written to stdin, which is then ended
 *   logPath     the live session log; a parameter so a test can point it at a
 *               temp directory instead of bridge/logs/
 *   onActivity  called for every stdout AND stderr chunk. Output is what keeps
 *               a session alive: a chunk that does not reach this is a session
 *               being killed for inactivity while it is still talking
 *   onEvent     called with every parsed stream-json event, as it arrives
 *
 * done is called exactly once — on the child's `close` (not `exit`: close is
 * what fires after stdout has ended, so the last line is in) or on a spawn
 * error — with { code, signal, spawnError, retained }.
 */
function streamSession(options, done) {
  const {
    command, args, cwd, prompt, logPath,
    onActivity = null, onEvent = null,
  } = options || {};

  const stdoutTail = createTail(TAIL_BYTES);
  const stderrTail = createTail(TAIL_BYTES);
  const flags = { hitYourLimit: false, rateLimitRejected: false, apiError: false, apiError5xx: false };

  let resultLine = null;     // the last line whose JSON type is "result"
  let lastJsonLine = null;   // the last line that parses as a JSON object
  let sessionIdLine = null;  // the FIRST line carrying a session_id (the init event)
  let stdoutBytes = 0;
  let pending = '';          // the part of a line the last chunk ended in the middle of

  const decoder = new StringDecoder('utf8');

  let logStream = null;
  try { logStream = fs.createWriteStream(logPath, { flags: 'w' }); } catch (_) { logStream = null; }

  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

  // ── the tee, with backpressure ────────────────────────────────────────────
  // A session can write faster than the disk takes it. When the log stream is
  // over its high-water mark, stdout is paused until it drains — the pipe holds
  // the session back instead of the daemon holding the session in memory.
  let stdoutPaused = false;
  function tee(chunk) {
    if (!logStream) return;
    let ok = true;
    try { ok = logStream.write(chunk); } catch (_) { return; }
    if (!ok && !stdoutPaused) {
      stdoutPaused = true;
      try { child.stdout.pause(); } catch (_) {}
      logStream.once('drain', () => {
        stdoutPaused = false;
        try { child.stdout.resume(); } catch (_) {}
      });
    }
  }

  function takeLine(line) {
    scanFlags(flags, line);
    const s = line.trim();
    if (!s) return;
    let ev;
    try { ev = JSON.parse(s); } catch (_) { return; }
    if (!ev || typeof ev !== 'object') return;
    if (onEvent) { try { onEvent(ev); } catch (_) {} }
    if (Array.isArray(ev)) return;
    lastJsonLine = s;
    if (ev.type === 'result') resultLine = s;
    if (sessionIdLine === null && typeof ev.session_id === 'string') sessionIdLine = s;
  }

  if (child.stdout) {
    child.stdout.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      if (onActivity) { try { onActivity(); } catch (_) {} }
      stdoutBytes += chunk.length;
      pushTail(stdoutTail, chunk);
      tee(chunk);

      const text = pending + decoder.write(chunk);
      let start = 0;
      let nl;
      while ((nl = text.indexOf('\n', start)) !== -1) {
        takeLine(text.slice(start, nl));
        start = nl + 1;
      }
      pending = text.slice(start);
      if (pending.length > MAX_LINE_CHARS) {
        // Not an event, and not worth a buffer. Its flags are read now; only a
        // seam is carried forward so a pattern straddling the cut is not lost.
        scanFlags(flags, pending);
        pending = pending.slice(-LINE_SEAM_CHARS);
      }
    });
  }

  if (child.stderr) {
    child.stderr.on('error', () => {});
    child.stderr.on('data', (chunk) => {
      if (onActivity) { try { onActivity(); } catch (_) {} }
      pushTail(stderrTail, chunk);
      tee(Buffer.concat([STDERR_PREFIX, chunk], STDERR_PREFIX.length + chunk.length));
    });
  }

  let settled = false;
  function settle(payload) {
    if (settled) return;
    settled = true;

    // The last line of a session has no newline after it. It is still a line.
    const rest = pending + decoder.end();
    pending = '';
    if (rest) takeLine(rest);

    const retained = {
      resultLine,
      lastJsonLine,
      sessionIdLine,
      flags,
      stdoutTail: readTail(stdoutTail),
      stderrTail: readTail(stderrTail),
      stdoutBytes,
    };

    const finish = () => done({ retained, ...payload });
    if (!logStream) { finish(); return; }
    // Called back only once the log is on disk: the ERROR file, the viewer and
    // the tests all read it the moment this callback returns.
    try { logStream.end(finish); } catch (_) { finish(); }
  }

  child.on('error', (err) => {
    settle({ code: null, signal: null, spawnError: err });
  });

  child.on('close', (code, signal) => {
    settle({ code, signal, spawnError: null });
  });

  // The prompt. Not a spawn option: stdin 'ignore' starts the session with an
  // empty prompt. The error listener is what keeps an unstartable command
  // (ENOENT destroys these pipes) from throwing inside the daemon.
  try {
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.write(prompt);
      child.stdin.end();
    }
  } catch (_) {}

  return child;
}

module.exports = { streamSession };

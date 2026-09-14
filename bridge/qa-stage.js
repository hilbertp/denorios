'use strict';

// qa-stage.js — Julian's stage: the IN_QA state and the information packet (slice 363).
//
// Under the ratified flow a slice that lands on the integration branch gets one QA stage of
// its own. This module owns the two halves of that stage that are pure data:
//
//   1. THE PACKET. Eight items, assembled from the queue files while they are still on disk
//      (or from the trash copies, for a slice that archived before this existed). Julian is
//      information-only: he is never handed the diff and never a line of a product source
//      file, which is exactly what makes it safe for him — not the builder — to say whether
//      the slice works. Everything that goes into the packet passes through redactCode().
//
//   2. THE STICKER. What survives archive. Before this slice only Rom's report did; the
//      brief (with every review round) and Nog's verdict went to bridge/trash/ at the sweep
//      and the record of why the slice was accepted was scattered. The sticker is all of it
//      in one file, under one name, with a slot for Julian's result.
//
// Nothing here spawns anything or touches git history; the orchestrator drives the stage.

const fs = require('fs');
const path = require('path');

// The live state file while the stage runs, and the sidecar the unclear-criterion exit
// writes for Philipp. Both are whitelisted as canonical queue suffixes; the question file
// is a sidecar, not a state file, and no slice ever "is" QA_QUESTION.
const IN_QA_SUFFIX = '-IN_QA.md';
const QA_QUESTION_SUFFIX = '-QA_QUESTION.md';

// The eight packet items, in the order Julian reads them. The prompt carries these and,
// beyond them, only operational lines — the heading list IS the contract, so a ninth thing
// smuggled into the packet shows up as a ninth heading.
const PACKET_ITEM_HEADINGS = [
  '1. The slice file',
  "2. Rom's DONE report",
  "3. Nog's verdict and review",
  '4. Changed files (names only)',
  '5. Screen hooks',
  '6. Tests Rom moved or weakened',
  '7. The live dashboard',
  '8. Break-it result',
];

// What the prompt may carry that is not one of the eight: how to stay alive, and where he
// is allowed to write. Operational, not information about the slice.
const OPERATIONAL_HEADINGS = [
  'Mutex contract',
  'Where you write',
];

// ---------------------------------------------------------------------------
// Redaction — the one rule that makes the packet safe to hand over
// ---------------------------------------------------------------------------

// Markdown carries code in fences. A fence whose info string names a source language, or
// whose body is a unified diff, is the only way product code reaches a queue document — so
// that is what comes out. Prose fences (the DONE-report frontmatter template, a quoted
// error message) are left alone: they are not code and Julian needs them.
const SOURCE_FENCE_LANGS = new Set([
  'js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'typescript',
  'json', 'jsonc', 'json5', 'sh', 'bash', 'zsh', 'shell', 'console',
  'html', 'xml', 'css', 'scss', 'less', 'yaml', 'yml', 'toml',
  'diff', 'patch', 'py', 'python', 'go', 'rb', 'ruby', 'sql', 'c', 'cpp', 'java', 'rs',
]);

// A unified diff, wherever it appears — fenced, or pasted bare into a report body.
const DIFF_LINE_RE = /^(?:diff --git |index [0-9a-f]{7,}\.\.|--- a\/|\+\+\+ b\/|@@ -)/;

const REDACTION =
  '_[code redacted — Julian is information-only: never the diff, never a line of a product source file]_';

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)/;

/**
 * redactCode(text) → string
 *
 * Strips every code fence that carries source or a diff, and every bare diff line, leaving
 * one redaction marker where each stood. This is the packet's guarantee: a brief that
 * quotes a function, a DONE report that pastes a hunk, a Nog review that shows the line he
 * objected to — none of them reach Julian as code.
 */
function redactCode(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const open = lines[i].match(FENCE_RE);
    if (open) {
      const marker = open[2];
      const lang = (open[3] || '').toLowerCase();
      const body = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const close = lines[j].match(FENCE_RE);
        if (close && close[2].startsWith(marker[0]) && close[2].length >= marker.length && !close[3]) {
          closed = true;
          break;
        }
        body.push(lines[j]);
        j++;
      }
      const isSource = SOURCE_FENCE_LANGS.has(lang) || body.some(l => DIFF_LINE_RE.test(l));
      if (isSource) {
        out.push(REDACTION);
      } else {
        out.push(lines[i], ...body);
        if (closed) out.push(lines[j]);
      }
      i = closed ? j + 1 : j;
      continue;
    }

    if (DIFF_LINE_RE.test(lines[i])) {
      // A bare hunk: swallow it whole rather than leaving its surviving half visible.
      if (out[out.length - 1] !== REDACTION) out.push(REDACTION);
      while (i < lines.length && (DIFF_LINE_RE.test(lines[i]) || /^[-+ ]/.test(lines[i]))) i++;
      continue;
    }

    out.push(lines[i]);
    i++;
  }

  return out.join('\n');
}

/**
 * demoteHeadings(text, by) → string
 *
 * Pushes every ATX heading down `by` levels so an embedded document cannot masquerade as a
 * packet item. The brief's own `## Tasks` becomes `#### Tasks` inside item 1; the packet's
 * `##` headings stay the eight items plus the operational ones, which is what makes that
 * list checkable. Fenced content is left exactly as it is.
 */
function demoteHeadings(text, by = 2) {
  if (!text) return '';
  const hashes = '#'.repeat(Math.max(0, by));
  let fence = null;
  return String(text).split('\n').map(line => {
    const f = line.match(FENCE_RE);
    if (f) {
      if (fence && f[2].startsWith(fence[0]) && f[2].length >= fence.length && !f[3]) fence = null;
      else if (!fence) fence = f[2];
      return line;
    }
    if (fence) return line;
    return /^#{1,6}\s/.test(line) ? hashes + line : line;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Reading the slice's documents
// ---------------------------------------------------------------------------

function readIfPresent(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch (_) { return null; }
}

/**
 * newestTrashCopy(trashDir, id, baseName) → string | null
 *
 * The sweep renames `{id}-PARKED.md` to `{id}-PARKED.md.cleanup-ARCHIVED-<iso>` and Nog's
 * verdict to `{id}-NOG.md.pass`. For a slice that archived before this stage existed, those
 * copies are the only surviving originals — newest wins when a slice was swept twice.
 */
function newestTrashCopy(trashDir, id, baseName) {
  let entries;
  try { entries = fs.readdirSync(trashDir); } catch (_) { return null; }
  const prefix = `${id}-${baseName}`;
  const hits = entries.filter(f => f.startsWith(prefix)).sort();
  if (!hits.length) return null;
  return path.join(trashDir, hits[hits.length - 1]);
}

/**
 * findDoc(id, names, opts) → { path, content } | null
 *
 * Live queue file first (the packet is assembled BEFORE the sweep, which is the whole
 * point of moving archival behind the stage), then the trash copy.
 */
function findDoc(id, names, opts) {
  const queueDir = opts.queueDir;
  const trashDir = opts.trashDir;
  for (const name of names) {
    const p = path.join(queueDir, `${id}${name}`);
    const content = readIfPresent(p);
    if (content != null) return { path: p, content };
  }
  for (const name of names) {
    const p = newestTrashCopy(trashDir, id, name.replace(/^-/, ''));
    if (!p) continue;
    const content = readIfPresent(p);
    if (content != null) return { path: p, content };
  }
  return null;
}

/** Split `---\n…\n---\n` frontmatter off the front of a markdown document. */
function splitFrontmatter(content) {
  const m = String(content || '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: String(content || '') };
  return { frontmatter: m[1], body: m[2] };
}

/**
 * withFrontmatter(content) → string
 *
 * The document with its frontmatter kept, delimiters and all. Item 1 of the packet is
 * "the whole slice file", and in a real brief the one sentence saying what the slice is
 * FOR lives in the frontmatter — `goal: "…"` — not in the body. The first cut of this
 * handed Julian `splitFrontmatter(brief).body`, which dropped the goal (and with it
 * `title`, `lane` and `references`) from both his packet and the permanent sticker. A
 * brief whose body opens `## What is broken` then arrived with nothing at all saying what
 * success meant. So the file goes over whole, and redactCode still runs over all of it.
 */
function withFrontmatter(content) {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter == null) return String(content || '');
  return `---\n${frontmatter}\n---\n\n${String(body).replace(/^\n+/, '')}`;
}

/**
 * section(md, heading) → string | null
 *
 * The body under a `## <heading>` up to the next heading of the same or higher level.
 */
function section(md, heading) {
  if (!md) return null;
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^#{1,3}\\s*${esc}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|\\Z)`, 'im');
  const m = md.match(re);
  if (!m) return null;
  const body = m[1].trim();
  return body || null;
}

/**
 * stickerSection(body, heading) → string | null
 *
 * A top-level `## ` section of a sticker. It cannot use section() above: a sticker's
 * embedded documents are demoted two levels, so their own headings land at `###` — inside
 * section()'s `#{1,3}` boundary — and the brief would be cut off at its first sub-heading.
 * Here only a `## ` at the start of a line ends a section, which is exactly the sticker's
 * own structure.
 */
function stickerSection(body, heading) {
  const lines = String(body || '').split('\n');
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^## \S/.test(l));
  const out = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return out || null;
}

const NONE = '_None recorded._';

/**
 * assemblePacket(id, opts) → packet
 *
 * opts: { queueDir, trashDir, changedFiles?, sha?, runGit?, repoRoot?, dashboardUrl?,
 *         breakItResult? }
 *
 * Everything the stage knows about the slice, redacted, in one object. `changedFiles` is
 * names only — never a diff, never a file's contents; when it is not supplied it comes from
 * `git diff --name-only <sha>^ <sha>`, which cannot return contents.
 */
function assemblePacket(id, opts) {
  opts = opts || {};
  const queueDir = opts.queueDir;
  const trashDir = opts.trashDir;
  const ctx = { queueDir, trashDir };

  // The brief with every review round appended. During the stage the sticker lives under
  // the IN_QA name, so a re-run reads what the first run wrote.
  const brief = findDoc(id, ['-PARKED.md', '-STUCK.md'], ctx);
  const report = findDoc(id, [IN_QA_SUFFIX, '-ACCEPTED.md', '-ARCHIVED.md', '-DONE.md'], ctx);
  const nog = findDoc(id, ['-NOG.md'], ctx);

  // Once the stage has run, the file under that name is the STICKER, not the bare report —
  // so read the three documents back out of it rather than handing the whole record over
  // as if it were the report. This is also the "from the trash copies" path's twin: for a
  // slice whose siblings have already been swept, the sticker is where they went.
  let sliceFileRaw = brief ? withFrontmatter(brief.content) : null;
  let nogRaw = nog ? splitFrontmatter(nog.content).body : null;
  let reportBody = report ? splitFrontmatter(report.content).body : null;
  if (report && isSticker(report.content)) {
    const whole = reportBody;
    reportBody = stickerSection(whole, "Rom's DONE report");
    if (!sliceFileRaw) sliceFileRaw = stickerSection(whole, 'Brief (with every review round)');
    if (!nogRaw) nogRaw = stickerSection(whole, "Nog's verdict and review");
  }

  let changedFiles = opts.changedFiles || null;
  if (!changedFiles && opts.sha && opts.runGit) {
    try {
      const raw = opts.runGit(`git diff --name-only ${opts.sha}^ ${opts.sha}`, {
        slice_id: String(id), op: 'qaStage_changedFiles', cwd: opts.repoRoot, encoding: 'utf-8',
      });
      changedFiles = String(raw || '').split('\n').map(l => l.trim()).filter(Boolean);
    } catch (_) { changedFiles = null; }
  }

  return {
    slice_id: String(id),
    // Item 1 — the whole slice file, frontmatter included: the goal lives there, and the
    // goal is what Julian judges the shipped slice against.
    sliceFile: sliceFileRaw ? redactCode(sliceFileRaw).trim() : null,
    sliceFilePath: brief ? brief.path : null,
    // Item 2 — Rom's DONE report.
    romReport: reportBody ? redactCode(reportBody).trim() : null,
    romReportPath: report ? report.path : null,
    romFrontmatter: report ? splitFrontmatter(report.content).frontmatter : null,
    // Item 3 — Nog's verdict and review.
    nogVerdict: nogRaw ? redactCode(nogRaw).trim() : null,
    nogVerdictPath: nog ? nog.path : null,
    // Item 4 — names only.
    changedFiles: changedFiles || [],
    // Items 5 and 6 — lifted out of the report so Julian does not have to hunt for them.
    screenHooks: reportBody ? (section(redactCode(reportBody), 'Screen hooks') || null) : null,
    testsMoved: reportBody ? (section(redactCode(reportBody), 'Tests moved or weakened') || null) : null,
    // Item 7 — for looking at the product, not for running his tests against.
    dashboardUrl: opts.dashboardUrl || defaultDashboardUrl(),
    // Item 8 — filled by the break-it script; that script is the next slice.
    breakItResult: opts.breakItResult || null,
  };
}

function defaultDashboardUrl() {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL;
  const port = process.env.DASHBOARD_PORT || '4747';
  return `http://localhost:${port}`;
}

// ---------------------------------------------------------------------------
// The sticker — what survives archive
// ---------------------------------------------------------------------------

const STICKER_MARKER = '<!-- ds9:sticker v1 -->';
const JULIAN_RESULT_HEADING = "## Julian's result";

/**
 * buildSticker(id, packet, opts) → string
 *
 * The whole record of one slice in one file: the brief with every review round, Rom's
 * report, Nog's verdict, and the slot Julian's result lands in. Rom's frontmatter is kept
 * at the top verbatim so everything that reads a slice's metadata off this file (title,
 * branch, the landed metrics) still finds it where it always was.
 */
function buildSticker(id, packet, opts) {
  opts = opts || {};
  const title = opts.title || `Slice ${id}`;
  const parts = [];

  if (packet.romFrontmatter) parts.push('---', packet.romFrontmatter, '---', '');
  parts.push(
    STICKER_MARKER,
    '',
    `# ${title} — slice record`,
    '',
    'The whole sticker: the brief with every review round, the builder\'s report, the',
    'reviewer\'s verdict, and Julian\'s result. This file is the slice\'s permanent record.',
    '',
    '## Brief (with every review round)',
    '',
    packet.sliceFile ? demoteHeadings(packet.sliceFile, 2) : NONE,
    '',
    "## Rom's DONE report",
    '',
    packet.romReport ? demoteHeadings(packet.romReport, 2) : NONE,
    '',
    "## Nog's verdict and review",
    '',
    packet.nogVerdict ? demoteHeadings(packet.nogVerdict, 2) : NONE,
    '',
    JULIAN_RESULT_HEADING,
    '',
    opts.julianResult || '_Julian\'s stage has not recorded a result for this slice yet._',
    '',
  );
  return parts.join('\n');
}

/** True when a queue document has already been rewritten as a sticker (idempotence). */
function isSticker(content) {
  return String(content || '').includes(STICKER_MARKER);
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

const PROMPT_TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'bashir-prompt.md');

function fill(template, key, value) {
  return template.split(`{{${key}}}`).join(value);
}

/**
 * buildPrompt(packet, opts) → string
 *
 * Hydrates bridge/templates/bashir-prompt.md with the packet. Every embedded document is
 * demoted two levels, so the prompt's own `##` headings are exactly the eight packet items
 * plus the operational ones — which is how "the eight items and nothing beyond them" is
 * checkable rather than a promise.
 */
function buildPrompt(packet, opts) {
  opts = opts || {};
  const templatePath = opts.templatePath || PROMPT_TEMPLATE_PATH;
  let out = fs.readFileSync(templatePath, 'utf-8');

  const embed = (v) => (v ? demoteHeadings(redactCode(v), 2).trim() : NONE);

  out = fill(out, 'SLICE_ID', packet.slice_id);
  out = fill(out, 'HEARTBEAT_PATH', opts.heartbeatPath || 'bridge/state/bashir-heartbeat.json');
  out = fill(out, 'SLICE_FILE', embed(packet.sliceFile));
  out = fill(out, 'ROM_REPORT', embed(packet.romReport));
  out = fill(out, 'NOG_VERDICT', embed(packet.nogVerdict));
  out = fill(out, 'CHANGED_FILES', packet.changedFiles && packet.changedFiles.length
    ? packet.changedFiles.map(f => `- \`${f}\``).join('\n')
    : NONE);
  out = fill(out, 'SCREEN_HOOKS', embed(packet.screenHooks));
  out = fill(out, 'TESTS_MOVED', embed(packet.testsMoved));
  out = fill(out, 'DASHBOARD_URL', packet.dashboardUrl);
  out = fill(out, 'BREAKIT_RESULT', packet.breakItResult
    ? embed(packet.breakItResult)
    : '_Not run yet — the break-it script is the next slice in this set. Treat every safety-net test Rom lists as unconfirmed until it reports._');

  return out;
}

/** The `## ` headings a built prompt actually carries — the checkable half of the contract. */
function promptHeadings(prompt) {
  return String(prompt || '').split('\n')
    .filter(l => /^##\s+\S/.test(l))
    .map(l => l.replace(/^##\s+/, '').trim());
}

module.exports = {
  IN_QA_SUFFIX,
  QA_QUESTION_SUFFIX,
  PACKET_ITEM_HEADINGS,
  OPERATIONAL_HEADINGS,
  REDACTION,
  STICKER_MARKER,
  JULIAN_RESULT_HEADING,
  redactCode,
  demoteHeadings,
  splitFrontmatter,
  withFrontmatter,
  readIfPresent,
  section,
  stickerSection,
  findDoc,
  newestTrashCopy,
  assemblePacket,
  buildSticker,
  isSticker,
  buildPrompt,
  promptHeadings,
  defaultDashboardUrl,
  PROMPT_TEMPLATE_PATH,
};

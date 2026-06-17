'use strict';

// AC-block parsing + validation — PRE-2 of ADR-AC-RECONCILE.
//
// A slice's `## Acceptance criteria` section lists one explicitly-tagged line per AC:
//
//     ## Acceptance criteria
//
//     - slice-050-ac-1: the endpoint returns 200 with the slice body
//     - slice-050-ac-2: an unknown id returns 404, no file written
//
// These tagged lines are the source-of-truth the AC-manifest deriver
// (scripts/build-ac-manifest.js, BUILD-1) reads. The join key is the LITERAL
// `slice-<id>-ac-<k>` tag, authored by O'Brien — never derived from list position
// (tags are sparse/non-contiguous by design). Pure + dependency-free so it can be
// imported by new-slice.js (commission-time validation) and the deriver alike.

const AC_LINE_RE = /^\s*[-*]\s*(slice-(\d+)-ac-(\d+))\s*:\s*(.+?)\s*$/;

// Body of the `## Acceptance criteria` section, up to the next `## ` heading or EOF.
function extractAcSection(content) {
  const lines = String(content).split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Acceptance criteria\s*$/.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

// Parse the section into structured ACs + structural errors. No id-matching here.
function parseAcBlock(content) {
  const section = extractAcSection(content);
  if (section === null) {
    return { present: false, isStub: false, acs: [], errors: ['no "## Acceptance criteria" section'], warnings: [] };
  }
  const acs = [];
  const errors = [];
  let sawComment = false;
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('<!--') || line.endsWith('-->') || line.startsWith('#')) { sawComment = true; continue; }
    const m = raw.match(AC_LINE_RE);
    if (m) {
      acs.push({ tag: m[1], slice: m[2], k: parseInt(m[3], 10), text: m[4].trim() });
    } else if (/^\s*[-*]\s/.test(raw)) {
      errors.push(`unparseable AC line (expected "- slice-<id>-ac-<k>: <text>"): ${line}`);
    }
  }
  const isStub = acs.length === 0 && errors.length === 0;
  return { present: true, isStub, acs, errors, warnings: [] };
}

// Validate a slice's AC block against its own id. Returns { ok, errors, warnings, acs }.
// `ok` is true when there are no structural ERRORS (advisory-v1 keeps stubs/gaps as warnings).
function validateAcBlock(content, sliceId) {
  const parsed = parseAcBlock(content);
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];

  if (!parsed.present) {
    return { ok: false, errors: ['slice has no "## Acceptance criteria" section'], warnings, acs: [] };
  }
  if (parsed.isStub) {
    warnings.push('"## Acceptance criteria" is an unfilled stub — no tagged AC lines yet. Fill before commission so the AC manifest can derive them.');
    return { ok: true, errors, warnings, acs: [] };
  }

  // Id match (tolerant of zero-padding: slice-50 == slice-050).
  if (sliceId != null) {
    const want = parseInt(String(sliceId), 10);
    for (const ac of parsed.acs) {
      if (parseInt(ac.slice, 10) !== want) {
        errors.push(`AC tag ${ac.tag} does not match this slice's id (${sliceId})`);
      }
    }
  }

  // Duplicate tags are an error; non-contiguous k is allowed (warn only).
  const seen = new Set();
  for (const ac of parsed.acs) {
    if (seen.has(ac.tag)) errors.push(`duplicate AC tag ${ac.tag}`);
    seen.add(ac.tag);
  }
  const ks = parsed.acs.map(a => a.k).sort((a, b) => a - b);
  for (let i = 1; i < ks.length; i++) {
    if (ks[i] > ks[i - 1] + 1) {
      warnings.push(`AC indices are non-contiguous (gap before ac-${ks[i]}) — allowed, but confirm it's intentional.`);
      break;
    }
  }

  return { ok: errors.length === 0, errors, warnings, acs: parsed.acs };
}

module.exports = { AC_LINE_RE, extractAcSection, parseAcBlock, validateAcBlock };

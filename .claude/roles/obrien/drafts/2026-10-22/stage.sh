#!/usr/bin/env bash
# Stage one drafted brief on the machine that runs the pipeline.
# Mints the id through bridge/new-slice.js (never by hand), then writes the id into
# the NNN placeholders of the staged file.
#
#   .claude/roles/obrien/drafts/2026-10-22/stage.sh 1     # shakedown slices 1..5 (surface lane), in order
#   .claude/roles/obrien/drafts/2026-10-22/stage.sh A     # checker fixes (ADR-JULIAN-ALONGSIDE item A)
#   .claude/roles/obrien/drafts/2026-10-22/stage.sh B     # quiet between landings (item B)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
D=.claude/roles/obrien/drafts/2026-10-22

case "${1:-}" in
  A)
    BODY=$D/A-checker-fixes.md
    TITLE="Red means something: a removed-coverage declaration covers one source, and the manifest records criterion wording again"
    GOAL="A red at the merge press means a real problem: a Coverage-Removed trailer clears only the source it names, and every landing records the wording of its criteria."
    PRIO=high; LANE=core; TIMEOUT=30 ;;
  B)
    BODY=$D/B-quiet.md
    TITLE="Nothing runs between landings: the per-push suite, its fix requests and its pill go"
    GOAL="No suite runs on a push to dev and nothing files work from one: ci.yml runs only by hand or on a pull request, the dashboard keeps no per-push state and shows no per-push pill, and the prompts name the merge press as the only run."
    PRIO=high; LANE=core; TIMEOUT=30 ;;
  1)
    BODY=$D/1-root-debris.md
    TITLE="Three dead files leave the repo root"
    GOAL="The repo root no longer carries the April smoke file, the June rollback-test marker or the May branch-recovery script, none of which anything reads."
    PRIO=normal; LANE=surface; TIMEOUT=15 ;;
  2)
    BODY=$D/2-slice-template.md
    TITLE="The slice template that nothing reads goes"
    GOAL="bridge/templates/slice.md, which no code reads and which contradicts the slice tool on priorities, fields and lane, is gone; the only way to make a slice is bridge/new-slice.js."
    PRIO=normal; LANE=surface; TIMEOUT=15 ;;
  3)
    BODY=$D/3-docs-taxonomy.md
    TITLE="The docs taxonomy describes the folders that exist"
    GOAL="docs/README.md names every folder under docs/ that exists and none that does not, says a new ADR goes in docs/adr/, and lists the top-level documents."
    PRIO=normal; LANE=surface; TIMEOUT=15 ;;
  4)
    BODY=$D/4-readme-fresh-clone.md
    TITLE="The quick start works on a fresh clone"
    GOAL="A reader who follows README.md on a fresh Linux, WSL or macOS clone reaches a running dashboard with the orchestrator in gate-flow mode, with the token, the browser install and the OS-specific scripts explained."
    PRIO=normal; LANE=surface; TIMEOUT=15 ;;
  5)
    BODY=$D/5-julian-not-priya.md
    TITLE="The crew list shows Julian, the name Philipp chose"
    GOAL="The Ops crew tile, owner chips and person labels show the QA engineer as Julian in light mode, as decided on 2026-09-03, with Bashir still shown in the LCARS skin."
    PRIO=normal; LANE=surface; TIMEOUT=15 ;;
  *) echo "usage: $0 1|2|3|4|5|A|B" >&2; exit 2 ;;
esac

# Mint the id the way new-slice.js will: next free queue id, bumped past any staged file.
ID=$(node bridge/next-id.js | tail -1)
while [ -e "bridge/staged/$ID-STAGED.md" ]; do ID=$(printf '%03d' $((10#$ID + 1))); done
TMP=$(mktemp)
sed "s/NNN/$ID/g" "$BODY" > "$TMP"
OUT=$(node bridge/new-slice.js --title "$TITLE" --goal "$GOAL" --priority "$PRIO" --lane "$LANE" --timeout "$TIMEOUT" --to rom --body-file "$TMP" 2>&1) || { printf '%s\n' "$OUT" >&2; rm -f "$TMP"; exit 1; }
rm -f "$TMP"
printf '%s\n' "$OUT" | grep -E '^new-slice: AC (problem|warning)' >&2 || true
FILE=$(printf '%s\n' "$OUT" | sed -n 's/^Created: //p' | head -1)
[ -n "$FILE" ] || { printf '%s\n' "$OUT" >&2; echo "could not find the created file in new-slice.js output" >&2; exit 1; }
GOT=$(basename "$FILE" | cut -d- -f1)
if [ "$GOT" != "$ID" ]; then
  # new-slice.js chose a different number (a staged file appeared in between): retag.
  sed -i "s/slice-$ID-ac-/slice-$GOT-ac-/g" "$FILE"
  echo "note: tool assigned $GOT, not $ID; tags retagged in place" >&2
fi
grep -q "slice-$GOT-ac-1" "$FILE" || { echo "tag substitution failed in $FILE" >&2; exit 1; }
grep -q "NNN" "$FILE" && { echo "placeholder left in $FILE" >&2; exit 1; }
echo "staged $FILE as slice $GOT"

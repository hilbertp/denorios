#!/usr/bin/env bash
# Stage one drafted brief on the machine that runs the pipeline.
# Mints the id through bridge/new-slice.js (never by hand), then writes the id into
# the NNN placeholders of the staged file.
#
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
  *) echo "usage: $0 A|B" >&2; exit 2 ;;
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

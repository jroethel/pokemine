#!/usr/bin/env bash
# Graduate parked items from a brief's "## Parking lot" section into backlog issues.
# Resolves config/repo-state.md (the conforming-repo marker it checks for) from the caller's cwd
# repo, the same convention skills/loop-auto/loop-auto.sh uses - never from this script's own
# location. The graduated-item template whose body shape this mirrors lives in config/conventions.md.
set -uo pipefail

fail() { echo "graduate-parking: $1" >&2; exit 1; }

[ $# -ge 1 ] || fail "usage: graduate-parking.sh <brief-path>"
BRIEF="$1"
[ -f "$BRIEF" ] || fail "brief not found: $BRIEF (resolved from caller cwd)"

# The conforming-repo marker lives in the caller's repo, resolved against cwd like loop-auto.sh.
REPO_STATE="config/repo-state.md"
[ -f "$REPO_STATE" ] || fail "conforming-repo marker missing: $REPO_STATE (resolve from caller cwd, not script location)"

TODAY="$(date +%Y-%m-%d)"
DRY=0
[ "${GRADUATE_DRY_RUN:-0}" = "1" ] && DRY=1

# Parse the Parking lot section in one pass: a top-level "- " bullet starts an item, any
# indented line continues it, the next "## " heading ends the section. Emits one
# "prose<TAB>restart" line per item, with a leading "Restart context:" label stripped from
# the continuation (the body field supplies its own label).
items="$(awk '
  BEGIN { in_sec = 0; started = 0 }
  tolower($0) ~ /^##[[:space:]]+parking lot/ { in_sec = 1; next }
  in_sec && tolower($0) ~ /^##[[:space:]]+/ {
    if (started) { printf "%s\t%s\n", prose, restart; started = 0 }
    in_sec = 0; next
  }
  !in_sec { next }
  $0 ~ /^[[:space:]]*$/ {
    if (started) { printf "%s\t%s\n", prose, restart; started = 0 }
    next
  }
  $0 ~ /^-[[:space:]]+/ {
    if (started) printf "%s\t%s\n", prose, restart
    started = 1
    line = $0
    sub(/^-[[:space:]]+/, "", line)
    sub(/[[:space:]]+$/, "", line)
    prose = line
    restart = ""
    next
  }
  started && $0 ~ /^[[:space:]]+/ {
    cont = $0
    sub(/^[[:space:]]+/, "", cont)
    sub(/[[:space:]]+$/, "", cont)
    if (match(cont, /^[Rr]estart [Cc]ontext:[[:space:]]*/)) cont = substr(cont, RLENGTH + 1)
    if (restart == "") restart = cont
    else restart = restart " " cont
    next
  }
  END { if (started) printf "%s\t%s\n", prose, restart }
' "$BRIEF")"

if [ -z "$items" ]; then
  echo "graduate-parking: no parked items in $BRIEF"
  exit 0
fi

while IFS=$'\t' read -r prose restart; do
  [ -n "$prose" ] || continue
  # Title derived from the item's first sentence (text up to the first period).
  title="${prose%%.*}"
  [ -n "$title" ] || title="$prose"
  [ -n "$restart" ] || restart="n/a"
  # Body shape mirrors the graduated-item template in config/conventions.md.
  body="$(printf '%s\n---\nSource brief: %s\nGraduated: %s\nRestart context: %s' \
    "$prose" "$BRIEF" "$TODAY" "$restart")"
  if [ "$DRY" = "1" ]; then
    printf "scripts/tracker.sh create --label idea --title '%s' --body:\n" "$title"
    printf '%s\n\n' "$body"
  else
    num="$(scripts/tracker.sh create --label idea --title "$title" --body "$body")" \
      || fail "tracker.sh create failed for: $title"
    printf 'Graduated idea #%s: %s\n' "$num" "$title"
  fi
done <<< "$items"

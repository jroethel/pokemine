#!/usr/bin/env bash
# tracker.sh - the single backend seam. Reads config/repo-state.md's tracker: key and
# dispatches every issue operation to github (gh) or local (docs/issues/*.md) accordingly.
# Operates on the caller's cwd repo, never on this script's own location (cf. loop-auto.sh).
set -uo pipefail
fail() { echo "tracker: $1" >&2; exit 1; }
RS="config/repo-state.md"
ISSUE_DIR="docs/issues"

tracker_mode_get() {          # prints mode, or exits 3 when the key is absent
  [ -f "$RS" ] || return 3
  local v
  v="$(grep -E '^tracker:' "$RS" | head -1 | sed -E 's/^tracker:[[:space:]]*//; s/[[:space:]]*$//')"
  [ -n "$v" ] || return 3
  printf '%s\n' "$v"
}
tracker_mode_set() {
  local m="$1"
  case "$m" in github|local) ;; *) fail "mode set: must be 'github' or 'local' (got '$m')";; esac
  mkdir -p "$(dirname "$RS")"; touch "$RS"
  grep -v '^tracker:' "$RS" > "${RS}.tmp" || true
  printf 'tracker: %s\n' "$m" >> "${RS}.tmp"
  mv "${RS}.tmp" "$RS"
  printf '%s\n' "$m"
}

gh_guard() {                  # fail-fast: covers gh-absent AND unauthenticated (criterion 3)
  command -v gh >/dev/null 2>&1 || fail "github mode requires the gh CLI, which is not on PATH"
  gh auth status >/dev/null 2>&1 || fail "github mode requires an authenticated gh CLI (run: gh auth login)"
}

# --- local backend helpers ---
slugify() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'; }
fm() { grep -E "^$2:" "$1" | head -1 | sed -E "s/^$2:[[:space:]]*//; s/[[:space:]]*$//"; }  # frontmatter value
# ponytail: escapes only \ and " (zero-dependency, no jq). Tab/newline/other control chars in a title
# are NOT escaped - rare in issue titles, and frontmatter values are single-line so embedded newlines
# cannot occur. Upgrade path: pipe through jq -Rn if control-char titles ever matter.
json_escape() { printf '%s' "$1" | sed -E 's/\\/\\\\/g; s/"/\\"/g'; }

next_number() {
  local max=0 n f
  shopt -s nullglob
  for f in "$ISSUE_DIR"/*.md; do
    n="$(fm "$f" number)"
    [ -n "$n" ] && [ "$n" -gt "$max" ] 2>/dev/null && max="$n"
  done
  echo $((max + 1))
}
find_issue_file() {           # arg: number -> prints path, exit 1 if none
  local f n
  shopt -s nullglob
  for f in "$ISSUE_DIR"/*.md; do
    n="$(fm "$f" number)"
    [ "$n" = "$1" ] && { printf '%s\n' "$f"; return 0; }
  done
  return 1
}
local_create() {              # args: label title body -> prints number
  local label="$1" title="$2" body="$3" num slug file
  mkdir -p "$ISSUE_DIR"
  num="$(next_number)"; slug="$(slugify "$title")"; slug="${slug:-issue}"  # all-punctuation title -> NNN-issue.md
  file="$(printf '%s/%03d-%s.md' "$ISSUE_DIR" "$num" "$slug")"
  {
    echo "---"
    echo "number: $num"
    echo "title: $title"
    echo "labels: $label"
    echo "state: open"
    echo "updated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "---"
    printf '%s\n' "$body"
  } > "$file"
  echo "note: ISSUES.md/BACKLOG.md now stale - run scripts/gen-mirrors.sh ." >&2  # reminder only; no auto-regen
  printf '%s\n' "$num"
}
local_set_state() {           # args: number newstate ; rewrites state: and updated: only inside the first frontmatter block
  local f tmp now; f="$(find_issue_file "$1")" || fail "no local issue #$1"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp="$(mktemp)"
  awk -v st="$2" -v up="$now" '
    /^---$/ { d++; print; next }
    d==1 && /^state:/   { print "state: " st; next }
    d==1 && /^updated:/ { print "updated: " up; next }
    { print }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
  echo "note: ISSUES.md/BACKLOG.md now stale - run scripts/gen-mirrors.sh ." >&2  # reminder only; no auto-regen
}
local_list() {                # emit gh-shaped JSON for open issues
  local first=1 out="[" f state num title upd labels_raw labels_json l
  shopt -s nullglob
  for f in "$ISSUE_DIR"/*.md; do
    state="$(fm "$f" state)"; [ "$state" = "open" ] || continue
    num="$(fm "$f" number)"; title="$(fm "$f" title)"; upd="$(fm "$f" updated)"
    labels_raw="$(fm "$f" labels)"
    labels_json=""
    if [ -n "$labels_raw" ]; then   # guard: iterating an empty array under set -u aborts on bash 3.2 (macOS)
      IFS=',' read -ra _larr <<< "$labels_raw"
      for l in "${_larr[@]}"; do
        l="$(printf '%s' "$l" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
        [ -n "$l" ] || continue
        [ -n "$labels_json" ] && labels_json="$labels_json,"
        labels_json="$labels_json{\"name\":\"$(json_escape "$l")\"}"
      done
    fi
    [ "$first" -eq 1 ] || out="$out,"; first=0
    out="$out{\"number\":$num,\"title\":\"$(json_escape "$title")\",\"labels\":[$labels_json],\"updatedAt\":\"$(json_escape "$upd")\"}"
  done
  printf '%s]\n' "$out"
}

usage() {
  cat >&2 <<EOF
Usage: tracker.sh <command> [args]
  mode get                       print the declared tracker mode (github|local); exit 3 if the key is absent
  mode set <github|local>        write the line-anchored tracker: key
  list                           print a gh-shaped issue-JSON array for open issues
  create --label L --title T --body B   create an issue, print its number
  close <num>                    close an issue by number
  reopen <num>                   reopen an issue by number
EOF
}

[ $# -ge 1 ] || { usage; exit 1; }
sub="$1"; shift
case "$sub" in
  mode)
    [ $# -ge 1 ] || { usage; exit 1; }
    msub="$1"; shift
    case "$msub" in
      get) tracker_mode_get ;;
      set) [ $# -ge 1 ] || fail "mode set: requires 'github' or 'local'"; tracker_mode_set "$1" ;;
      *)   usage; exit 1 ;;
    esac
    ;;
  list)
    # ponytail: mode bound in the PARENT scope - NOT a require_mode subshell. tracker_mode_get
    # return-3s on a keyless repo; the parent-scope `|| fail` then aborts non-zero. A subshell
    # `fail` would exit only the subshell and the parent would fall into the local branch.
    mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
    if [ "$mode" = github ]; then
      gh_guard
      gh issue list --state open --json number,title,labels,updatedAt
    else
      local_list
    fi
    ;;
  create)
    label=""; title=""; body=""
    while [ $# -ge 2 ]; do
      case "$1" in
        --label) label="$2"; shift 2 ;;
        --title) title="$2"; shift 2 ;;
        --body)  body="$2";  shift 2 ;;
        *) fail "create: unknown argument '$1'" ;;
      esac
    done
    [ $# -eq 0 ] || fail "create: unpaired arguments"
    mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
    if [ "$mode" = github ]; then
      gh_guard
      url="$(gh issue create --label "$label" --title "$title" --body "$body")"
      printf '%s\n' "${url##*/}"
    else
      local_create "$label" "$title" "$body"
    fi
    ;;
  close|reopen)
    [ $# -ge 1 ] || fail "$sub: requires an issue number"
    num="$1"
    mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
    if [ "$mode" = github ]; then
      gh_guard
      gh issue "$sub" "$num"
    else
      if [ "$sub" = close ]; then local_set_state "$num" closed
      else                           local_set_state "$num" open; fi
    fi
    ;;
  *) usage; exit 1 ;;
esac

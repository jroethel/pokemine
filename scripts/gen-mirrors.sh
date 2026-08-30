#!/usr/bin/env bash
# gen-mirrors.sh - render the declared tracker backend's open issues into three markdown mirrors.
#   <out-dir>/ISSUES.md    - issues with no `idea` label
#   <out-dir>/BACKLOG.md   - issues labeled `idea`
#   <out-dir>/WAYFINDER.md - open `wayfinder:map` issues, one section per map, with their child
#                            tickets (type, open/closed state, Blocked-by). github only: wayfinder
#                            has no gitlab/local sub-issue source yet, so other modes render an
#                            empty mirror.
#   Issues labeled `wayfinder:*` are excluded from ISSUES.md/BACKLOG.md.
# Source of truth is GitHub issues; these files are generated, never hand-edited.
# Usage: scripts/gen-mirrors.sh <out-dir>
# Test hook: MIRRORS_JSON_FILE=<path> reads that file instead of calling gh.
#            MIRRORS_CHILDREN_DIR=<dir> reads <dir>/<map-num>.json instead of `tracker.sh children`.
set -uo pipefail
fail() { echo "FAIL: $1" >&2; exit 1; }

[ $# -eq 1 ] || fail "usage: $0 <out-dir>"
OUT_DIR="$1"
[ -d "$OUT_DIR" ] || fail "out-dir not found: $OUT_DIR"
GEN_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TAB=$'\t'

# 1. Source the issue JSON. The fixture hook wins and never touches the network.
if [ -n "${MIRRORS_JSON_FILE:-}" ]; then
  [ -f "$MIRRORS_JSON_FILE" ] || fail "MIRRORS_JSON_FILE not found: $MIRRORS_JSON_FILE"
  JSON_SRC="$(cat "$MIRRORS_JSON_FILE")"
else
  JSON_SRC="$(scripts/tracker.sh list)" || fail "tracker.sh list failed"
fi

# 2. Parse JSON into TSV rows: lane(0=issues,1=backlog) \t number \t title \t labels \t updated.
#    No jq: brace-depth scan handles compact (fixture) and pretty (gh) JSON alike.
#    Global sort by number desc; the lane split below preserves desc order within each file.
rows_file="$(mktemp)"
maps_file="$(mktemp)"
trap 'rm -f "$rows_file" "$maps_file"' EXIT
printf '%s' "$JSON_SRC" | awk -v maps_out="$maps_file" '
  BEGIN { OFS = "\t" }
  { all = all $0 "\n" }
  END {
    n = length(all); depth = 0; obj = ""
    for (i = 1; i <= n; i++) {
      c = substr(all, i, 1)
      if (c == "{") {
        if (depth == 0) obj = "{"; else obj = obj c
        depth++
      } else if (c == "}") {
        depth--
        if (depth == 0) { obj = obj c; emit(obj); obj = "" }
        else obj = obj c
      } else if (depth > 0) {
        obj = obj c
      }
    }
  }
  # ponytail: string fields use "[^"]*" - titles/labels with escaped quotes (\") or
  # embedded braces are not handled; rare for issue titles, and the failure is graceful
  # (truncation), not a crash. Upgrade to an escaped-aware scan if such titles appear.
  function emit(s,    m, num, title, labels, upd) {
    if (match(s, /"number"[ \t]*:[ \t]*[0-9]+/)) {
      m = substr(s, RSTART, RLENGTH); gsub(/[^0-9]/, "", m); num = m
    } else return
    if (match(s, /"title"[ \t]*:[ \t]*"[^"]*"/)) {
      m = substr(s, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m); title = m
    } else title = ""
    if (match(s, /"updatedAt"[ \t]*:[ \t]*"[^"]*"/)) {
      m = substr(s, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m); upd = m
    } else upd = ""
    labels = labels_of(s)
    if (is_map(labels)) print num, title, upd >> maps_out
    if (is_wayfinder(labels)) return
    print (is_idea(labels) ? 1 : 0), num, title, labels, upd
  }
  function labels_of(s,    out, seg, m) {
    out = ""
    if (match(s, /"labels"[ \t]*:[ \t]*\[/)) {
      seg = substr(s, RSTART)
      while (match(seg, /"name"[ \t]*:[ \t]*"[^"]*"/)) {
        m = substr(seg, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m)
        out = (out == "" ? m : out "," m)
        seg = substr(seg, RSTART + RLENGTH)
      }
    }
    return out
  }
  function is_idea(labels) { return (labels ~ /(^|,)idea(,|$)/) ? 1 : 0 }
  function is_wayfinder(labels) { return (labels ~ /(^|,)wayfinder:/) ? 1 : 0 }
  function is_map(labels) { return (labels ~ /(^|,)wayfinder:map(,|$)/) ? 1 : 0 }
' | sort -t"$TAB" -k2,2nr > "$rows_file" || fail "issue parse/sort failed"

# 3. Write each mirror: disclosed HTML-comment header, H1, then the table.
MODE="$(scripts/tracker.sh mode get 2>/dev/null || true)"
case "$MODE" in
  gitlab) SRC_LABEL="GitLab issues" ;;
  local)  SRC_LABEL="docs/issues/ local tracker" ;;
  *)      SRC_LABEL="GitHub issues" ;;
esac
write_mirror() {
  local file="$1" h1="$2" want="$3"
  {
    echo "<!--"
    echo "generated: $GEN_TIME"
    echo "source of truth: $SRC_LABEL"
    echo "regenerate: scripts/gen-mirrors.sh $OUT_DIR"
    echo "DO NOT EDIT"
    echo "-->"
    echo "# $h1"
    echo ""
    echo "| # | title | labels | updated |"
    echo "|---|---|---|---|"
  } > "$file"
  # Escape pipes in title/labels so a cell can never add a column to the table.
  # Char-loop (not gsub): gsub rescans its replacement and the backslash-count
  # differs between BWK awk and gawk, so this is the portable way to prefix `\`.
  awk -F"$TAB" -v want="$want" '
    function esc(s,    r, i, c) {
      r = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        r = r (c == "|" ? "\\|" : c)
      }
      return r
    }
    $1 == want { printf "| %s | %s | %s | %s |\n", $2, esc($3), esc($4), $5 }
  ' "$rows_file" >> "$file" || fail "row emit failed for $file"
}

write_mirror "$OUT_DIR/ISSUES.md"  "Issues" 0
write_mirror "$OUT_DIR/BACKLOG.md" "Backlog" 1

# 4. Wayfinder mirror: one section per open `wayfinder:map` issue, its children fetched fresh
#    (children aren't in the open-issue JSON already read - a map's own children can be closed).
fetch_children() {            # arg: map number -> children JSON array on stdout (fixture-aware)
  local num="$1" f
  if [ -n "${MIRRORS_CHILDREN_DIR:-}" ]; then
    f="$MIRRORS_CHILDREN_DIR/$num.json"
    [ -f "$f" ] && cat "$f" || echo "[]"
  else
    scripts/tracker.sh children "$num" || fail "tracker.sh children failed for map #$num"
  fi
}
render_children() {           # arg: map number -> markdown table rows for its children, on stdout
  fetch_children "$1" | awk '
    BEGIN { OFS = "\t" }
    { all = all $0 "\n" }
    END {
      n = length(all); depth = 0; obj = ""
      for (i = 1; i <= n; i++) {
        c = substr(all, i, 1)
        if (c == "{") {
          if (depth == 0) obj = "{"; else obj = obj c
          depth++
        } else if (c == "}") {
          depth--
          if (depth == 0) { obj = obj c; emit(obj); obj = "" }
          else obj = obj c
        } else if (depth > 0) {
          obj = obj c
        }
      }
    }
    function esc(s,    r, i, c) {
      r = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        r = r (c == "|" ? "\\|" : c)
      }
      return r
    }
    function emit(s,    m, num, title, state, labels, type, blocked) {
      if (match(s, /"number"[ \t]*:[ \t]*[0-9]+/)) {
        m = substr(s, RSTART, RLENGTH); gsub(/[^0-9]/, "", m); num = m
      } else return
      if (match(s, /"title"[ \t]*:[ \t]*"[^"]*"/)) {
        m = substr(s, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m); title = m
      } else title = ""
      if (match(s, /"state"[ \t]*:[ \t]*"[^"]*"/)) {
        m = substr(s, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m); state = m
      } else state = ""
      labels = labels_of(s)
      type = ticket_type(labels)
      blocked = blocked_of(s)
      printf "| %s | %s | %s | %s | %s |\n", num, esc(title), type, state, blocked
    }
    function labels_of(s,    out, seg, m) {
      out = ""
      if (match(s, /"labels"[ \t]*:[ \t]*\[/)) {
        seg = substr(s, RSTART)
        while (match(seg, /"name"[ \t]*:[ \t]*"[^"]*"/)) {
          m = substr(seg, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m)
          out = (out == "" ? m : out "," m)
          seg = substr(seg, RSTART + RLENGTH)
        }
      }
      return out
    }
    function ticket_type(labels,    m) {
      if (match(labels, /wayfinder:(research|prototype|grilling|task)/)) {
        m = substr(labels, RSTART, RLENGTH); sub(/^wayfinder:/, "", m); return m
      }
      return ""
    }
    function blocked_of(s,    out, seg, m) {
      out = ""; seg = s
      while (match(seg, /Blocked by:[ \t]*#[0-9]+/)) {
        m = substr(seg, RSTART, RLENGTH); gsub(/[^0-9]/, "", m)
        out = (out == "" ? m : out "," m)
        seg = substr(seg, RSTART + RLENGTH)
      }
      return out
    }
  ' || fail "children render failed for map #$1"
}
write_wayfinder_mirror() {
  local file="$OUT_DIR/WAYFINDER.md" mnum mtitle
  {
    echo "<!--"
    echo "generated: $GEN_TIME"
    echo "source of truth: $SRC_LABEL"
    echo "regenerate: scripts/gen-mirrors.sh $OUT_DIR"
    echo "DO NOT EDIT"
    echo "-->"
    echo "# Wayfinder"
  } > "$file"
  if [ ! -s "$maps_file" ]; then
    printf '\n(no open wayfinder maps)\n' >> "$file"
    return
  fi
  while IFS="$TAB" read -r mnum mtitle _; do
    {
      printf '\n## %s (#%s)\n\n' "$mtitle" "$mnum"
      echo "| # | title | type | state | blocked by |"
      echo "|---|---|---|---|---|"
    } >> "$file"
    # Sub-issues are a github-only source today; a fixture always wins (never touches gh),
    # but a live gitlab/local repo has nowhere to fetch children from - say so, don't crash.
    if [ -z "${MIRRORS_CHILDREN_DIR:-}" ] && { [ "$MODE" = gitlab ] || [ "$MODE" = local ]; }; then
      echo "| - | (children unavailable: $MODE has no wayfinder sub-issue source yet) | - | - | - |" >> "$file"
    else
      render_children "$mnum" >> "$file"
    fi
  done < "$maps_file"
}
write_wayfinder_mirror

echo "wrote $OUT_DIR/ISSUES.md, $OUT_DIR/BACKLOG.md, and $OUT_DIR/WAYFINDER.md ($GEN_TIME)"

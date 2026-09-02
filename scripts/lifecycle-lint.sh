#!/usr/bin/env bash
# lifecycle-lint - deterministic lifecycle reconciliation detector (no hooks, no daemons; run
# on demand, before declaring work done (conventions.md rule 6), and at handoff time). Classes:
#   a  superseded+unlinked plan-set: a live docs/plans/*-plan{,_loop}.md whose date is older
#      than the newest live plan-set, not archived, and referenced by no OPEN issue
#   b  orphaned brief: a live docs/briefs/*-brief.md whose plan already sits in docs/archive/
#   c  an OPEN issue still referencing an ARCHIVED plan stem (completed work, open ticket);
#      backlog `idea` issues are exempt - parked ideas cite archived stems by design
#   d  a CLOSED issue referenced by a LIVE plan (local backend only: tracker.sh list exposes
#      open issues only, so closed issues are enumerable just by scanning docs/issues/*.md)
#   e  every backticked in-repo pointer in config/context-map.md's index resolves (test -e)
#   f  filename grammar: a lane doc dated on/after filename-grammar-since: whose name does not
#      match <date>.<tokens>.<slug>.md
#   g  roadmap R-tag defect: a duplicate or malformed [R...] tag in ROADMAP.md (absence is
#      never flagged)
# Class f runs only when filename-grammar-since: exists in config/repo-state.md; class g runs
# whenever ROADMAP.md exists. Classes a (supersession half) and b are pure filesystem and
# always run. The issue-link checks query the tracker seam and run only when `tracker.sh mode
# get` succeeds; absent a
# declared mode they are skipped silently, so the lint works in a bare repo with no backend.
# Remote backends match issue titles only (tracker.sh list does not expose bodies); local
# matches title and body. This script only DETECTS - the archive/close action is BATCH-class
# per loop-auto, and closing an issue additionally requires an evidence receipt (done verb).
# Output: one "LINT <class> <path-or-issue>: <why>" line per finding; exit 0 clean, 1 on any.
set -uo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRACKER="$SCRIPT_DIR/tracker.sh"

[ $# -eq 1 ] || { echo "lifecycle-lint: usage: lifecycle-lint.sh <repo-root>" >&2; exit 2; }
# cd into the target repo before anything else, so every tracker.sh call (which operates on
# its caller's cwd) resolves against the target repo, never the caller's cwd.
cd "$1" || { echo "lifecycle-lint: cannot cd into '$1'" >&2; exit 2; }

PLANS=docs/plans; BRIEFS=docs/briefs; ARCHIVE=docs/archive; ISSUES=docs/issues
shopt -s nullglob

found=0
lint() { printf 'LINT %s %s: %s\n' "$1" "$2" "$3"; found=1; }

# stem_of <basename>: prints the topic stem of a dated doc filename, dash or dot grammar;
# dot names have their leading [BIRW]<n> token segments stripped before the stem. Returns 1 for
# undated or foreign filenames, which never participate in lifecycle checks.
stem_of() {
  local s="$1"; s="${s%.md}"
  case "$s" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].*)
      s="${s:11}"                                # dot grammar: strip date + '.'
      while :; do                                # drop leading [BIRW]<n> token segments
        case "$s" in
          [BIRW][0-9]*.*) s="${s#*.}" ;;
          *) break ;;
        esac
      done
      ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*)  # legacy dash grammar, unchanged
      s="${s:11}"
      ;;
    *) return 1 ;;
  esac
  case "$s" in
    *-plan_loop) s="${s%-plan_loop}" ;;
    *-plan)      s="${s%-plan}" ;;
    *-brief)     s="${s%-brief}" ;;
  esac
  printf '%s\n' "$s"
}
date_of() { printf '%s\n' "${1:0:10}"; }
fm() { grep -E "^$2:" "$1" | head -1 | sed -E "s/^$2:[[:space:]]*//; s/[[:space:]]*$//"; }

# --- filesystem facts: newest live plan-set date, live stems, archived stems ---
newest=""
for f in "$PLANS"/*-plan.md "$PLANS"/*-plan_loop.md; do
  b="$(basename "$f")"; stem_of "$b" >/dev/null || continue
  d="$(date_of "$b")"
  [ -z "$newest" ] && newest="$d"
  [[ "$d" > "$newest" ]] && newest="$d"
done
live_stems="$(
  for f in "$PLANS"/*-plan.md "$PLANS"/*-plan_loop.md; do
    b="$(basename "$f")"; stem_of "$b" || continue
  done | sort -u
)"
archived_stems="$(
  for f in "$ARCHIVE"/*-plan.md "$ARCHIVE"/*-plan_loop.md; do
    b="$(basename "$f")"; stem_of "$b" || continue
  done | sort -u
)"

# --- optional tracker backend: absent a mode, every issue-link check below is skipped ---
mode=""
[ -x "$TRACKER" ] && { mode="$("$TRACKER" mode get 2>/dev/null)" || mode=""; }
open_titles=""
if [ -n "$mode" ] && [ "$mode" != local ]; then
  # no-jq brace scan (cf. tracker.sh next_eligible): one num<TAB>title row per open issue
  if ! open_titles="$("$TRACKER" list 2>/dev/null | awk '
    { all = all $0 "\n" }
    END {
      n = length(all); depth = 0; obj = ""
      for (i = 1; i <= n; i++) {
        c = substr(all, i, 1)
        if (c == "{") { if (depth == 0) obj = "{"; else obj = obj c; depth++ }
        else if (c == "}") { depth--; if (depth == 0) { obj = obj c; emit(obj); obj = "" } else obj = obj c }
        else if (depth > 0) obj = obj c
      }
    }
    function emit(s,  m, num, title, lab) {
      if (!match(s, /"number"[ \t]*:[ \t]*[0-9]+/)) return
      m = substr(s, RSTART, RLENGTH); gsub(/[^0-9]/, "", m); num = m
      title = ""
      if (match(s, /"title"[ \t]*:[ \t]*"[^"]*"/)) {
        m = substr(s, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m); title = m
      }
      # third column: backlog-lane flag from the nested label objects; a backend whose list
      # omits labels reads as "-", failing open to pre-exemption behavior
      lab = (s ~ /"name"[ \t]*:[ \t]*"idea"/) ? "idea" : "-"
      print num "\t" title "\t" lab
    }
  ')"; then
    echo "lifecycle-lint: tracker.sh list failed - issue-link checks skipped" >&2
    mode=""; open_titles=""
  fi
fi

# open_issue_refs <stem> [nonidea]: prints each OPEN issue number whose title (remote) or title/body
# (local, straight from the files) references the stem; "nonidea" excludes backlog `idea` issues
open_issue_refs() {
  local stem="$1" filter="${2:-}" f num state
  if [ "$mode" = local ]; then
    for f in "$ISSUES"/*.md; do
      state="$(fm "$f" state)"; [ "$state" = open ] || continue
      grep -qF "$stem" "$f" || continue
      if [ "$filter" = nonidea ]; then
        case ",$(fm "$f" labels | tr -d ' ')," in *,idea,*) continue ;; esac
      fi
      num="$(fm "$f" number)"; [ -n "$num" ] && printf '%s\n' "$num"
    done
  else
    printf '%s\n' "$open_titles" | awk -F'\t' -v s="$stem" -v flt="$filter" \
      'index($2, s) && !(flt == "nonidea" && $3 == "idea") { print $1 }'
  fi
}

# (a) superseded + unlinked plan-set
for f in "$PLANS"/*-plan.md "$PLANS"/*-plan_loop.md; do
  b="$(basename "$f")"
  stem="$(stem_of "$b")" || continue
  d="$(date_of "$b")"
  [ -n "$newest" ] || continue
  [[ "$d" < "$newest" ]] || continue
  if [ -n "$mode" ] && [ -n "$(open_issue_refs "$stem")" ]; then continue; fi
  lint a "$PLANS/$b" "superseded by the $newest cycle, not archived, no open issue links stem '$stem'"
done

# (b) orphaned brief
for f in "$BRIEFS"/*-brief.md; do
  b="$(basename "$f")"
  stem="$(stem_of "$b")" || continue
  printf '%s\n' "$archived_stems" | grep -xF "$stem" >/dev/null || continue
  lint b "$BRIEFS/$b" "matching plan '$stem' is already in $ARCHIVE"
done

# (c) archived plan still referenced by an open issue. Backlog `idea` issues are exempt: parked
# follow-on ideas and the graduation template's Source-brief pointer cite archived stems by
# design, so only an Issues-lane (non-idea) reference signals completed work with an open ticket.
if [ -n "$mode" ]; then
  for stem in $archived_stems; do
    for num in $(open_issue_refs "$stem" nonidea); do
      lint c "#$num" "open issue still references archived plan stem '$stem' (close via tracker.sh done with evidence)"
    done
  done
fi

# (d) closed issue referenced by a live plan - local backend only (see header)
if [ "$mode" = local ]; then
  for f in "$ISSUES"/*.md; do
    [ "$(fm "$f" state)" = closed ] || continue
    num="$(fm "$f" number)"
    [ -n "$num" ] || continue
    for stem in $live_stems; do
      grep -qF "$stem" "$f" || continue
      lint d "#$num" "closed issue referenced by live plan stem '$stem'"
    done
  done
fi

# (e) in-repo context-map pointer resolves - pure filesystem, runs only when a map exists, so the
# lint stays portable across loop-stack repos. Scans only the "## The index" section, so backticked
# prose in the policy header (e.g. `MEMORY.md`, a grep example) is never mistaken for a pointer.
MAP=config/context-map.md
if [ -f "$MAP" ]; then
  # Resolve only filesystem-style in-repo pointers; skip verbs, externals, URI schemes, prose words.
  while IFS= read -r tok; do
    case "$tok" in
      *' '*)         continue ;;  # a retrieval verb, not a path
      *'://'*)       continue ;;  # a URI scheme (e.g. qmd://...), not a filesystem path
      '~'*|/*|http*) continue ;;  # external or absolute - not an in-repo pointer
      *.*|*/*)       ;;           # has an extension or a slash: treat as a path
      *)             continue ;;  # bare backticked prose word
    esac
    p="${tok%%:*}"               # drop any :line-range suffix
    [ -e "$p" ] || lint e "$MAP" "in-repo pointer '$tok' does not resolve"
  done < <(sed -n '/^## The index/,$p' "$MAP" | grep -oE '`[^`]+`' | sed 's/`//g')
fi

# (f) filename grammar - runs only when the adopting key is present (same absence-skips pattern
# as the tracker mode): docs in the four lanes dated on/after the key's date must match
# <date>.<tokens>.<slug>.md; older docs are exempt; lanes outside the four are never scanned,
# and the non-recursive *.md glob keeps subdirs like docs/reviews/unit-logs/ out of the scan.
# Reads the key with the existing fm() helper near the top of this script; no new helper.
SINCE=""
[ -f config/repo-state.md ] && SINCE="$(fm config/repo-state.md filename-grammar-since)"
if [ -n "$SINCE" ]; then
  for lane in docs/briefs docs/plans docs/handoffs docs/reviews; do
    for f in "$lane"/*.md; do
      [ -e "$f" ] || continue
      b="$(basename "$f")"
      d="$(date_of "$b")"
      case "$d" in
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
        *) continue ;;                          # undated names never participate
      esac
      [[ "$d" < "$SINCE" ]] && continue         # grandfathered (ISO dates compare lexically)
      printf '%s\n' "$b" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[BIRW][0-9]+)*\.[a-z0-9-]+(_loop)?\.md$' \
        || lint f "$f" "filename does not match <date>.<tokens>.<slug>.md (grammar since $SINCE)"
    done
  done
fi

# (g) roadmap R-tags - unique well-formed tags, malformed [R...] groups flagged, absence never.
if [ -f ROADMAP.md ] && [ -n "$(grep -oE '\[R[^]]*\]' ROADMAP.md 2>/dev/null)" ]; then
  gfindings="$(grep -oE '\[R[^]]*\]' ROADMAP.md | awk '
    { if ($0 ~ /^\[R[0-9]+\]$/) seen[$0]++
      else print "malformed\t" $0 }
    END { for (t in seen) if (seen[t] > 1) print "duplicate\t" t }
  ')"
  while IFS=$'\t' read -r kind t; do
    [ -n "$t" ] || continue
    lint g ROADMAP.md "$kind R-tag '$t'"
  done <<< "$gfindings"
fi

exit "$found"

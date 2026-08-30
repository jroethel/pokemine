#!/usr/bin/env bash
# tracker.sh - the single backend seam. Reads config/repo-state.md's tracker: key and
# dispatches every issue operation to github (gh), gitlab (glab), or local (docs/issues/*.md)
# accordingly.
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
  case "$m" in github|gitlab|local) ;; *) fail "mode set: must be 'github', 'gitlab', or 'local' (got '$m')";; esac
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

# --- gitlab backend helpers ---
gitlab_host() {               # prints the host of origin; nothing + non-zero when origin is absent
  local url
  url="$(git remote get-url origin 2>/dev/null)" || return 1
  [ -n "$url" ] || return 1
  printf '%s\n' "$url" | sed -E 's#^[a-z+]+://##; s#^[^@]*@##; s#[:/].*$##'
}
gitlab_group() {              # prints the first path segment after the host of origin
  local url p
  url="$(git remote get-url origin 2>/dev/null)" || return 1
  [ -n "$url" ] || return 1
  p="$(printf '%s\n' "$url" | sed -E 's#^[a-z+]+://##; s#^[^@]*@##; s#^[^:/]+##; s#^:[0-9]+/#/#; s#^:##; s#^/##')"
  printf '%s\n' "${p%%/*}"
}
glab_guard() {                # fail-fast: host-scoped auth check (never bare `glab auth status`)
  command -v glab >/dev/null 2>&1 || fail "gitlab mode requires the glab CLI, which is not on PATH"
  local host
  host="$(gitlab_host)" || fail "gitlab mode requires an origin remote to resolve the GitLab host (found none)"
  [ -n "$host" ] || fail "gitlab mode requires an origin remote to resolve the GitLab host (found none)"
  glab auth status --hostname "$host" >/dev/null 2>&1 \
    || fail "gitlab mode requires glab authenticated to $host (run: glab auth login --hostname $host)"
}
# ponytail: 50 pages x 100 = a 5000-open-issue ceiling. GitLab caps per_page at 100, so a
# page loop is the only correct form; raise the cap or switch to keyset pagination if a repo
# ever exceeds it. The loop stops on the first short page, so the cap costs nothing normally.
gitlab_list() {
  local page=1 rows n all=""
  while [ "$page" -le 50 ]; do
    # declare first, assign second: `local rows="$(...)" || fail` would test local's status.
    rows="$(glab issue list --per-page 100 --page "$page" -O json \
      --jq '.[] | {number:.iid, title:.title, labels:[.labels[]|{name:.}], updatedAt:.updated_at}')" \
      || fail "glab issue list failed on page $page"
    [ -n "$rows" ] || break
    all="${all:+$all,}$(printf '%s' "$rows" | paste -sd, -)"
    n="$(printf '%s\n' "$rows" | grep -c .)"
    [ "$n" -lt 100 ] && break
    page=$((page + 1))
  done
  printf '[%s]\n' "$all"
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
local_label() {               # args: number name add|remove ; rewrites labels: (deduped comma list)
  local f num="$1" name="$2" op="$3" cur l out="" _arr lb now tmp   # + updated:, first block only
  f="$(find_issue_file "$num")" || fail "no local issue #$num"
  cur="$(fm "$f" labels)"
  if [ -n "$cur" ]; then      # guard: iterating an empty array under set -u aborts on bash 3.2 (macOS)
    IFS=',' read -ra _arr <<< "$cur"
    for l in "${_arr[@]}"; do
      l="$(printf '%s' "$l" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      [ -n "$l" ] || continue
      [ "$op" = remove ] && [ "$l" = "$name" ] && continue
      case ",$out," in *",$l,"*) continue ;; esac   # de-dup: add is idempotent
      out="${out:+$out,}$l"
    done
  fi
  if [ "$op" = add ]; then
    case ",$out," in *",$name,"*) ;; *) out="${out:+$out,}$name" ;; esac
  fi
  lb="$out"; [ -n "$lb" ] && lb=" $lb"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp="$(mktemp)"
  awk -v lb="$lb" -v up="$now" '
    /^---$/ { d++; print; next }
    d==1 && /^labels:/  { print "labels:" lb; next }
    d==1 && /^updated:/ { print "updated: " up; next }
    { print }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
  echo "note: ISSUES.md/BACKLOG.md now stale - run scripts/gen-mirrors.sh ." >&2  # reminder only; no auto-regen
}
local_comment() {             # args: number text ; appends a receipt line after the body, refreshes updated:
  local f num="$1" text="$2" now tmp
  f="$(find_issue_file "$num")" || fail "no local issue #$num"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp="$(mktemp)"
  awk -v up="$now" -v line="> comment $now: $text" '
    /^---$/ { d++; print; next }
    d==1 && /^updated:/ { print "updated: " up; next }
    { print }
    END { print line }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
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

# --- cross-backend dispatch helpers (shared by the public verbs and status/claim/done) ---
do_label() {                 # args: num name add|remove - raw op; the agent:done guard lives in the public verb only
  local num="$1" name="$2" op="$3" mode
  mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
  case "$mode" in
    github) gh_guard
            if [ "$op" = add ]; then gh issue edit "$num" --add-label "$name"
            else                      gh issue edit "$num" --remove-label "$name"; fi ;;
    gitlab) glab_guard
            if [ "$op" = add ]; then glab issue update "$num" --label "$name"
            else                      glab issue update "$num" --unlabel "$name"; fi ;;
    local)  local_label "$num" "$name" "$op" ;;
    *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
  esac
}
do_comment() {               # args: num text
  local num="$1" text="$2" mode
  mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
  case "$mode" in
    github) gh_guard; gh issue comment "$num" --body "$text" ;;
    gitlab) glab_guard; glab issue note "$num" --message "$text" ;;
    local)  local_comment "$num" "$text" ;;
    *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
  esac
}
do_state() {                 # args: num close|reopen
  local num="$1" op="$2" mode
  mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
  case "$mode" in
    github) gh_guard; gh issue "$op" "$num" ;;
    gitlab) glab_guard; glab issue "$op" "$num" ;;
    local)  if [ "$op" = close ]; then local_set_state "$num" closed
            else                          local_set_state "$num" open; fi ;;
    *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
  esac
}
set_status() {               # args: num state - exactly one active agent:* status label
  local num="$1" st="$2"
  clear_status "$num" "$st"
  do_label "$num" "agent:$st" add
}
clear_status() {             # args: num [keep] - remove every agent: status label except `keep`
  local num="$1" keep="${2:-}" s
  for s in todo working needs-input review; do
    [ "$s" = "$keep" ] && continue
    # blind remove: safe without a current-labels fetch (an absent label is the common case)
    do_label "$num" "agent:$s" remove || true
  done
}
gather_receipts() {          # arg: num - prints canonical "AGENT CLAIMED|RECLAIMED <sid> <ts>" lines,
  local num="$1" mode f      # anchored to line shape so a receipt merely quoting the phrase is not counted
  mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
  case "$mode" in
    github) gh_guard; gh issue view "$num" --json comments -q '.comments[].body' \
              | grep -E '^AGENT (CLAIMED|RECLAIMED) [^ ]+ [^ ]+$' ;;
    gitlab) glab_guard; glab issue view "$num" --comments 2>/dev/null \
              | grep -E '^AGENT (CLAIMED|RECLAIMED) [^ ]+ [^ ]+$' ;;
    local)  f="$(find_issue_file "$num")" || fail "no local issue #$num"
            grep -E '^> comment [0-9][0-9:TZ-]*: AGENT (CLAIMED|RECLAIMED) [^ ]+ [^ ]+' "$f" \
              | sed -E 's/^> comment [0-9][0-9:TZ-]*: //' ;;
    *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
  esac
}
compute_owner() {            # stdin: canonical receipt lines -> owner sid (earliest ts; ties lex-least sid);
  awk '                        # active window: at-or-after the most recent RECLAIMED, else all receipts
    { sid[NR]=$3; ts[NR]=$4; if ($2 == "RECLAIMED") last = NR }
    END {
      if (NR == 0) exit 0
      for (i = (last ? last : 1); i <= NR; i++)
        if (bs == "" || ts[i] < bt || (ts[i] == bt && sid[i] < bs)) { bt = ts[i]; bs = sid[i] }
      print bs
    }'
}
do_list() {                   # the list verb's backend dispatch; next-eligible reads it once per run
  local mode
  # ponytail: mode bound in the PARENT scope - NOT a require_mode subshell. tracker_mode_get
  # return-3s on a keyless repo; the parent-scope `|| fail` then aborts non-zero. A subshell
  # `fail` would exit only the subshell and the parent would fall into the local branch.
  mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
  case "$mode" in
    github) gh_guard; gh issue list --state open --limit 1000 --json number,title,labels,updatedAt ;;
    gitlab) glab_guard; gitlab_list ;;
    local)  local_list ;;
    *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
  esac
}
do_children() {                # arg: map issue number -> gh-shaped sub-issue-JSON array (number,title,state,labels,body)
  local num="$1" mode
  mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
  case "$mode" in
    github) gh_guard
            gh api "repos/{owner}/{repo}/issues/$num/sub_issues" \
              --jq '[.[] | {number, title, state, labels, body}]' \
              || fail "gh api sub_issues failed for #$num" ;;
    gitlab) fail "children: gitlab sub-issues not yet supported" ;;
    local)  fail "children: local tracker has no sub-issue concept" ;;
    *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
  esac
}
fetch_body() {                # arg: num -> only that candidate's body (the blocker scan is candidate-scoped)
  local num="$1" mode f
  mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
  case "$mode" in
    github) gh_guard; gh issue view "$num" --json body -q .body ;;
    gitlab) glab_guard; glab issue view "$num" ;;
    local)  f="$(find_issue_file "$num")" || fail "no local issue #$num"
            awk '/^---$/ { d++; next } d >= 2 { print }' "$f" ;;  # body only: frontmatter cannot fake a Blocked by
    *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
  esac
}
next_eligible() {             # arg: optional session-id; prints one SELECTED/NONE ELIGIBLE line, always rc 0
  local sid="${1:-}" num labels m rts newest owner blines blocked cutoff rows
  local open_ids="," work_nums="" todo_nums="" total=0 nw=0 nt=0 nblk=0
  # ponytail: STALE_CLAIM_SECS is a wall-clock heuristic for auto-resurfacing. Explicit
  # 'claim --reclaim' is the operator's zero-wait override; tune the env if 1h is wrong
  # for a given cadence. Receipts share the claim verb's fixed %Y-%m-%dT%H:%M:%SZ shape,
  # so a lexical compare against a pre-rendered cutoff string equals the epoch compare.
  cutoff="$(date -u -r "$(( $(date +%s) - ${STALE_CLAIM_SECS:-3600} ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" \
    || cutoff="$(date -u -d "@$(( $(date +%s) - ${STALE_CLAIM_SECS:-3600} ))" +%Y-%m-%dT%H:%M:%SZ)"
  # one list read per run: the open-set + labels. No-jq brace scan (cf. gen-mirrors.sh), so
  # multi-field label objects degrade to just their name.
  rows="$(do_list | awk '
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
    function emit(s,  seg, m, num, labels) {
      if (!match(s, /"number"[ \t]*:[ \t]*[0-9]+/)) return
      m = substr(s, RSTART, RLENGTH); gsub(/[^0-9]/, "", m); num = m
      labels = ""
      if (match(s, /"labels"[ \t]*:[ \t]*\[/)) {
        seg = substr(s, RSTART)
        while (match(seg, /"name"[ \t]*:[ \t]*"[^"]*"/)) {
          m = substr(seg, RSTART, RLENGTH); gsub(/^"[^"]*"[ \t]*:[ \t]*"|"$/, "", m)
          labels = (labels == "" ? m : labels "," m)
          seg = substr(seg, RSTART + RLENGTH)
        }
      }
      print num "\t" labels
    }
  ' | sort -t$'\t' -k1,1n)"
  while IFS=$'\t' read -r num labels; do
    [ -n "$num" ] || continue
    total=$((total + 1)); open_ids="$open_ids$num,"
    case ",$labels," in *",agent:working,"*) work_nums="$work_nums$num "; nw=$((nw + 1)) ;; esac
    case ",$labels," in *",agent:todo,"*)    todo_nums="$todo_nums$num " ;; esac
  done <<< "$rows"
  # lane 1 - stale working: newest claim/reclaim receipt past the cutoff, owned by another session
  for num in $work_nums; do
    rts="$(gather_receipts "$num" 2>/dev/null || true)"
    [ -n "$rts" ] || continue     # receiptless working ticket: age unknowable, not judgeable as stale
    newest="$(printf '%s\n' "$rts" | awk '{print $4}' | sort | tail -1)"
    if [ -n "$cutoff" ] && [ "$newest" \< "$cutoff" ]; then
      owner="$(printf '%s\n' "$rts" | compute_owner)"
      if [ -z "$sid" ] || [ "$owner" != "$sid" ]; then
        printf 'SELECTED #%s: stale working, relaunch\n' "$num"
        return 0
      fi
    fi
  done
  # lane 2 - lowest open agent:todo, not working, blocked by no OPEN issue
  for num in $todo_nums; do
    case " $work_nums " in *" $num "*) continue ;; esac
    nt=$((nt + 1))
    blines="$(fetch_body "$num" 2>/dev/null | grep -E '^Blocked by:' || true)"   # anchored: quoted mentions cannot block
    blocked=0
    if [ -n "$blines" ]; then
      for m in $(printf '%s\n' "$blines" | grep -oE '#[0-9]+' | sed 's/#//'); do
        case "$open_ids" in *",$m,"*) blocked=1; break ;; esac    # unresolved iff still in the open set
      done
    fi
    [ "$blocked" -eq 1 ] && { nblk=$((nblk + 1)); continue; }
    printf 'SELECTED #%s: agent:todo, unblocked\n' "$num"
    return 0
  done
  if [ "$nt" -eq 0 ]; then
    printf 'NONE ELIGIBLE: no open agent:todo tickets (%d open, %d agent:working)\n' "$total" "$nw"
  else
    printf 'NONE ELIGIBLE: %d of %d agent:todo ticket(s) blocked by open issues (%d open, %d agent:working)\n' \
      "$nblk" "$nt" "$total" "$nw"
  fi
  return 0
}

usage() {
  cat >&2 <<EOF
Usage: tracker.sh <command> [args]
  mode get                       print the declared tracker mode (github|gitlab|local); exit 3 if the key is absent
  mode set <github|gitlab|local> write the line-anchored tracker: key
  host                           print the GitLab host derived from origin
  group                          print the first path segment of origin (the backlog group)
  list                           print a gh-shaped issue-JSON array for open issues
  children <num>                 print a gh-shaped sub-issue-JSON array for a wayfinder map's children (github only)
  create --label L --title T --body B   create an issue, print its number
  close <num>                    close an issue by number (human-only; agents complete via 'done')
  reopen <num>                   reopen an issue by number
  label ensure <name>            idempotently make the label exist (no-op in local mode)
  label add <num> <name>         attach a label (agent:done is evidence-gated: use 'done')
  label remove <num> <name>      detach a label
  comment <num> <text>           append a durable comment/receipt
  status <num> <state>           set exactly one active agent: status (todo|working|needs-input|review)
  claim <num> <session-id> [--reclaim]  receipt-before-flip claim; prints owner id, exit 4 on race
  done <num> --receipt <text> [--ran <cmd>]  evidence-gated completion: agent:done + close
  next-eligible [<session-id>]    select at most one actionable ticket (stale working, else unblocked todo)
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
      set) [ $# -ge 1 ] || fail "mode set: requires 'github', 'gitlab', or 'local'"; tracker_mode_set "$1" ;;
      *)   usage; exit 1 ;;
    esac
    ;;
  list)
    do_list
    ;;
  children)
    [ $# -eq 1 ] || fail "children: requires <num>"
    do_children "$1"
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
    case "$mode" in
      github)
        gh_guard
        args=(issue create --title "$title" --body "$body")
        [ -n "$label" ] && args+=(--label "$label")
        url="$(gh "${args[@]}")" || fail "gh issue create failed"
        printf '%s\n' "${url##*/}"
        ;;
      gitlab)
        glab_guard
        args=(issue create --yes --no-editor -t "$title" -d "$body")
        [ -n "$label" ] && args+=(-l "$label")
        out="$(glab "${args[@]}")" || fail "glab issue create failed"
        iid="$(printf '%s' "$out" | grep -oE '/issues/[0-9]+' | tail -1 | sed 's#.*/##')"
        [ -n "$iid" ] || fail "glab issue create returned no parseable issue URL"
        printf '%s\n' "$iid"
        ;;
      local)
        local_create "$label" "$title" "$body"
        ;;
      *)
        fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)"
        ;;
    esac
    ;;
  close|reopen)
    [ $# -ge 1 ] || fail "$sub: requires an issue number"
    do_state "$1" "$sub"
    ;;
  label)
    [ $# -ge 1 ] || fail "label: requires a subcommand (ensure|add|remove)"
    lsub="$1"; shift
    case "$lsub" in
      ensure)
        [ $# -ge 1 ] || fail "label ensure: requires a label name"
        mode="$(tracker_mode_get)" || fail "no tracker mode declared in $RS (run loop-setup)"
        case "$mode" in
          github) gh_guard; gh label create "$1" 2>/dev/null || true ;;
          gitlab) glab_guard; glab label create --name "$1" 2>/dev/null || true ;;
          local)  echo "note: local labels are frontmatter, nothing to ensure" >&2 ;;
          *)      fail "unknown tracker mode '$mode' in $RS (expected github, gitlab, or local)" ;;
        esac
        ;;
      add)
        [ $# -ge 2 ] || fail "label add: requires an issue number and a label name"
        [ "$2" = "agent:done" ] && { echo "tracker: agent:done is reachable only through 'tracker.sh done' (evidence-gated)" >&2; exit 6; }
        do_label "$1" "$2" add
        ;;
      remove)
        [ $# -ge 2 ] || fail "label remove: requires an issue number and a label name"
        do_label "$1" "$2" remove
        ;;
      *) usage; exit 1 ;;
    esac
    ;;
  comment)
    [ $# -ge 2 ] || fail "comment: requires an issue number and a text"
    do_comment "$1" "$2"
    ;;
  status)
    [ $# -ge 2 ] || fail "status: requires an issue number and a state (todo|working|needs-input|review)"
    num="$1"; st="$2"
    case "$st" in
      todo|working|needs-input|review) ;;
      *) fail "status: state must be todo|working|needs-input|review (got '$st'; 'done' routes through 'tracker.sh done')" ;;
    esac
    set_status "$num" "$st"
    ;;
  claim)
    [ $# -ge 2 ] || fail "claim: requires an issue number and a session id"
    num="$1"; sid="$2"; shift 2
    reclaim=0
    while [ $# -ge 1 ]; do
      case "$1" in
        --reclaim) reclaim=1; shift ;;
        *) fail "claim: unknown argument '$1'" ;;
      esac
    done
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    verb=CLAIMED; [ "$reclaim" -eq 1 ] && verb=RECLAIMED
    # receipt BEFORE flip: a mid-claim death never leaves a receiptless working ticket
    do_comment "$num" "AGENT $verb $sid $now"
    set_status "$num" working
    owner="$(gather_receipts "$num" | compute_owner)"
    if [ -z "$owner" ]; then
      printf '%s\n' "$sid"      # no parseable receipt on the backend: trust our own just-written one
    elif [ "$owner" = "$sid" ]; then
      printf '%s\n' "$sid"
    elif [ "$reclaim" -eq 1 ]; then
      printf '%s\n' "$sid"      # explicit takeover supersedes prior claims
    else
      echo "RACE: #$num owned by $owner" >&2; exit 4
    fi
    ;;
  done)
    [ $# -ge 2 ] || fail "done: requires an issue number and --receipt <text>"
    num="$1"; shift
    receipt=""; rancmd=""
    while [ $# -ge 2 ]; do
      case "$1" in
        --receipt) receipt="$2"; shift 2 ;;
        --ran)     rancmd="$2";  shift 2 ;;
        *) fail "done: unknown argument '$1'" ;;
      esac
    done
    [ $# -eq 0 ] || fail "done: unpaired arguments"
    [ -n "$receipt" ] || fail "done: --receipt is required"
    if [ -n "$rancmd" ]; then
      # strong path: re-execute the cited command and capture the REAL exit, not a pasted claim
      sh -c "$rancmd" >/dev/null 2>&1
      rc=$?
      receipt="$receipt --ran $rancmd exit $rc"
      if [ "$rc" -ne 0 ]; then
        do_comment "$num" "$receipt"
        set_status "$num" review
        echo "tracker: --ran command exited $rc; #$num routed to review, not done" >&2
        exit 7
      fi
    else
      # ponytail: without --ran, evidence is a regex proving a receipt CITES a passing run, not that
      # it happened. --ran is the strong path (re-execute + capture). Upgrade: make --ran mandatory
      # in autonomous queue-runner mode if forgery ever matters.
      if ! printf '%s\n' "$receipt" | grep -qE '(exit( status)? 0( |$)|[1-9][0-9]* passed|(^| )0 failed|https?://[^ ]+)'; then
        echo "agent:done requires executed-check evidence of a PASSING run (exit 0 / N passed / 0 failed / artifact link)" >&2
        exit 5
      fi
    fi
    do_comment "$num" "$receipt"
    clear_status "$num"       # 'done' is not a status verb; clear all four siblings, then add agent:done
    do_label "$num" agent:done add   # internal path: the guard blocks the public verb, not this completion
    do_state "$num" close
    ;;
  next-eligible)
    next_eligible "${1:-}"
    ;;
  host)   gitlab_host || fail "no origin remote" ;;
  group)  gitlab_group || fail "no origin remote" ;;
  *) usage; exit 1 ;;
esac

#!/usr/bin/env bash
# migrate-tracker.sh - recreate every local docs/issues/ file as a remote issue (local -> github|gitlab).
# --to <github|gitlab> selects the target (default github, so existing invocations are unchanged).
# MIGRATE_DRY_RUN=1 prints the target's commands without executing. Real runs flip tracker: <target> at the end.
set -uo pipefail
fail() { echo "migrate-tracker: $1" >&2; exit 1; }
ask() {   # $1 = prompt; 0 = yes, 1 = no
  [ "${LOOP_ASSUME_YES:-0}" = 1 ] && return 0
  [ "${LOOP_ASSUME_NO:-0}"  = 1 ] && return 1
  local a; printf '%s [y/N]: ' "$1" >&2; read -r a || return 1
  case "$a" in [yY]*) return 0;; *) return 1;; esac
}
ISSUE_DIR="docs/issues"
DRY=0; [ "${MIGRATE_DRY_RUN:-0}" = "1" ] && DRY=1
TARGET=github
while [ $# -gt 0 ]; do
  case "$1" in
    --to) [ $# -ge 2 ] || fail "--to: must be 'github' or 'gitlab'"
          case "$2" in github|gitlab) TARGET="$2"; shift 2 ;; *) fail "--to: must be 'github' or 'gitlab' (got '$2')" ;; esac ;;
    *) fail "--to: must be 'github' or 'gitlab' (got '$1')" ;;
  esac
done
fm() { grep -E "^$2:" "$1" | head -1 | sed -E "s/^$2:[[:space:]]*//; s/[[:space:]]*$//"; }
body_of() { awk 'f{print} /^---$/{c++; if(c==2){f=1}}' "$1"; }   # everything after the frontmatter
stamp_migrated() {   # append a migrated: <url> line inside the FIRST frontmatter block (before its closing ---)
  local f="$1" u="$2" tmp; tmp="$(mktemp)"
  awk -v u="$u" '/^---$/ { d++; if (d==2) print "migrated: " u } { print }' "$f" > "$tmp" && mv "$tmp" "$f"
}
freeze_state() {   # rewrite the state: VALUE to the frozen marker inside the FIRST frontmatter block
  local f="$1" tmp; tmp="$(mktemp)"
  awk '
    /^---$/ { d++; print; next }
    d==1 && /^state:/ { print "state: migrated"; next }
    { print }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
}

if [ "$DRY" = 0 ]; then
  if [ "$TARGET" = github ]; then
    command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 \
      || fail "migration to github requires an authenticated gh CLI (run: gh auth login)"
  else
    host="$(scripts/tracker.sh host)" \
      || fail "migration to gitlab requires an origin remote to resolve the GitLab host (found none)"
    command -v glab >/dev/null 2>&1 && glab auth status --hostname "$host" >/dev/null 2>&1 \
      || fail "migration to gitlab requires glab authenticated to $host (run: glab auth login --hostname $host)"
  fi
fi
shopt -s nullglob
files=("$ISSUE_DIR"/*.md)
[ "${#files[@]}" -gt 0 ] || { echo "migrate-tracker: no local issues in $ISSUE_DIR"; exit 0; }

# ensure every distinct label exists first - gh issue create --label X aborts if X is not defined on the remote
labelset="$(for f in "${files[@]}"; do fm "$f" labels; done | tr ',' '\n' \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | grep -v '^$' | sort -u)"
if [ -n "$labelset" ]; then
  while IFS= read -r lbl; do
    [ -n "$lbl" ] || continue
    if [ "$DRY" = 1 ]; then
      if [ "$TARGET" = github ]; then printf 'gh label create %s\n' "$lbl"
      else printf 'glab label create --name %s\n' "$lbl"; fi
    else
      if [ "$TARGET" = github ]; then gh label create "$lbl" 2>/dev/null || true
      else glab label create --name "$lbl" 2>/dev/null || true; fi
    fi
  done <<< "$labelset"
fi

for f in "${files[@]}"; do
  # resume-safe: a real run skips any file already stamped migrated: (a prior partial run created it).
  # dry-run never skips - it previews every issue.
  if [ "$DRY" = 0 ] && grep -q '^migrated:' "$f"; then
    echo "skip: local #$(fm "$f" number) already migrated ($(fm "$f" migrated))"; continue
  fi
  num="$(fm "$f" number)"; title="$(fm "$f" title)"; labels="$(fm "$f" labels)"; state="$(fm "$f" state)"
  body="$(printf '%s\n---\nMigrated from local issue #%s\n' "$(body_of "$f")" "$num")"
  if [ "$DRY" = 1 ]; then
    if [ "$TARGET" = github ]; then
      if [ -n "$labels" ]; then
        printf "gh issue create --title '%s' --label '%s' --body <migrated body of local #%s>\n" "$title" "$labels" "$num"
      else
        printf "gh issue create --title '%s' --body <migrated body of local #%s>\n" "$title" "$num"
      fi
      [ "$state" = closed ] && printf "gh issue close <new #> (local #%s was closed)\n" "$num"
    else
      if [ -n "$labels" ]; then
        printf "glab issue create --yes --no-editor -t '%s' -l '%s' -d <migrated body of local #%s>\n" "$title" "$labels" "$num"
      else
        printf "glab issue create --yes --no-editor -t '%s' -d <migrated body of local #%s>\n" "$title" "$num"
      fi
      [ "$state" = closed ] && printf "glab issue close <new #> (local #%s was closed)\n" "$num"
    fi
  else
    if [ "$TARGET" = github ]; then
      if [ -n "$labels" ]; then
        url="$(gh issue create --title "$title" --label "$labels" --body "$body")" \
          || fail "gh issue create failed for local #$num ($title)"
      else
        url="$(gh issue create --title "$title" --body "$body")" \
          || fail "gh issue create failed for local #$num ($title)"
      fi
      new="${url##*/}"
    else
      args=(issue create --yes --no-editor -t "$title" -d "$body")
      [ -n "$labels" ] && args+=(-l "$labels")
      url="$(glab "${args[@]}")" \
        || fail "glab issue create failed for local #$num ($title)"
      # /issues/<n> grep (not ${url##*/}): a GitLab URL's path tail is the iid, but the same
      # derivation as tracker.sh keeps the two seams in lockstep if the URL shape ever changes.
      new="$(printf '%s' "$url" | grep -oE '/issues/[0-9]+' | tail -1 | sed 's#.*/##')"
      [ -n "$new" ] || fail "glab issue create returned no parseable issue URL for local #$num ($title)"
    fi
    stamp_migrated "$f" "$url"   # record BEFORE anything else so a re-run after a later failure skips this file
    freeze_state "$f"
    echo "migrated local #$num -> $url"
    [ "$state" = closed ] && {
      if [ "$TARGET" = github ]; then gh issue close "$new" >/dev/null && echo "  re-closed #$new (was closed locally)";
      else glab issue close "$new" >/dev/null && echo "  re-closed #$new (was closed locally)"; fi
    }
  fi
done
if [ "$DRY" = 0 ]; then
  scripts/tracker.sh mode set "$TARGET" >/dev/null; echo "flipped tracker: $TARGET"
fi
if [ "$DRY" = 0 ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mig=()
  for f in "${files[@]}"; do grep -q '^migrated:' "$f" && mig+=("$f"); done
  if [ "${#mig[@]}" -gt 0 ] && ask "git rm the ${#mig[@]} migrated ledger file(s)?"; then
    # -f: freeze_state modified these files vs HEAD, and plain `git rm` refuses modified files.
    # --cached: stage the deletion in the index but leave the frozen audit file on disk for review.
    # Guarded: on a repo where the migrated files were never `git add`ed, `git rm --cached` exits
    # 128. Without `set -e` that does not abort, but it became the script's exit status - a
    # successful migration misreported as failure. The guard reports it without going fatal.
    git rm -qf --cached "${mig[@]}" 2>/dev/null \
      && echo "staged git rm of ${#mig[@]} migrated ledger file(s)" \
      || echo "could not stage git rm (files may be untracked); left on disk"
  fi
fi
exit 0

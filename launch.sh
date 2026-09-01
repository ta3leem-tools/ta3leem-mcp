#!/usr/bin/env bash
# Launcher for both MCP servers. Claude Code is registered against this script,
# not against copies of the server files, so one `git push` from the maintainer
# reaches everyone with no reinstall.
#
# Usage: launch.sh openproject | launch.sh gitea
#
# The update check runs detached and after the server has started, so a slow or
# unreachable network can never delay or block a Claude Code session. Code that
# lands during a session takes effect the next time a session starts.

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
WHAT="$1"
STAMP="$HERE/.last-update-check"
MAX_AGE_HOURS=6
GITEA_TOOLS="get_me,list_pull_requests,pull_request_read,list_issues,issue_read,search_issues,search_repos,list_my_repos,get_file_contents,list_branches,list_commits,get_commit,notification_read"

self_update() {
  git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1 || return 0

  # At most one check per MAX_AGE_HOURS.
  if [ -f "$STAMP" ]; then
    age_s=$(( $(date +%s) - $(stat -c %Y "$STAMP" 2>/dev/null || echo 0) ))
    if [ "$age_s" -lt $(( MAX_AGE_HOURS * 3600 )) ]; then
      return 0
    fi
  fi
  touch "$STAMP" 2>/dev/null || true

  # Never touch a tree with local edits, and never leave a half-merged state.
  if [ -n "$(git -C "$HERE" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    return 0
  fi

  timeout 60 git -C "$HERE" pull --quiet --ff-only >/dev/null 2>&1 || return 0

  # Keep the slash commands in step with whatever just landed.
  if [ -d "$HERE/skills" ]; then
    for d in "$HERE"/skills/*/; do
      [ -f "${d}SKILL.md" ] || continue
      name="$(basename "$d")"
      mkdir -p "$HOME/.claude/skills/$name" 2>/dev/null || continue
      cp "${d}SKILL.md" "$HOME/.claude/skills/$name/" 2>/dev/null || true
    done
  fi
}

# Detached so it cannot hold the server's stdio open or outlive its usefulness.
( self_update >/dev/null 2>&1 & ) </dev/null

case "$WHAT" in
  openproject)
    exec node "$HERE/openproject-mcp.mjs"
    ;;
  gitea)
    exec "$HERE/gitea-mcp" -t stdio -r -O "$GITEA_TOOLS"
    ;;
  *)
    echo "Usage: launch.sh openproject|gitea" >&2
    exit 64
    ;;
esac

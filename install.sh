#!/usr/bin/env bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OP_URL="https://pm.ta3leem.dev"
GITEA_URL="https://gitea.ta3leem.dev"
GITEA_TOOLS="get_me,list_pull_requests,pull_request_read,list_issues,issue_read,search_issues,search_repos,list_my_repos,get_file_contents,list_branches,list_commits,get_commit,notification_read"

echo "== ta3leem MCP installer (gitea + openproject, read-only) =="
echo

# ---- 1. prerequisites ----------------------------------------------
miss=0
for c in node claude cloudflared; do
  command -v "$c" >/dev/null || { echo "MISSING: $c"; miss=1; }
done
if [ "$miss" = "1" ]; then
  echo
  echo "Install what is missing, then re-run:"
  echo "  node        https://nodejs.org  (v18+; 'node --version' must work in a plain terminal)"
  echo "  claude      npm i -g @anthropic-ai/claude-code"
  echo "  cloudflared sudo apt install cloudflared"
  exit 1
fi

# ---- 2. tokens ------------------------------------------------------
echo "Get your OWN tokens (never reuse a teammate's):"
echo "  Gitea:       $GITEA_URL -> Settings -> Applications -> Generate Token"
echo "  OpenProject: $OP_URL -> My Account -> Access tokens -> API"
echo
read -rp "Gitea token: " GT
read -rp "OpenProject API key: " OP
# Windows clipboards paste a trailing CR that read -r keeps; it would be baked
# into the registered command and surface later as a bogus "bad token" error.
GT="$(printf '%s' "$GT" | tr -d '\r\n \t')"
OP="$(printf '%s' "$OP" | tr -d '\r\n \t')"
if [ -z "$GT" ] || [ -z "$OP" ]; then
  echo "Both tokens required. Aborting."
  exit 1
fi

# ---- 3. cloudflare access (OpenProject sits behind CF Zero Trust) ---
echo
echo "Opening Cloudflare Access login in your browser..."
cloudflared access login "$OP_URL" || {
  echo
  echo "Cloudflare Access login failed or was cancelled. Nothing was installed."
  echo "Re-run this installer and complete the browser login."
  exit 1
}

# ---- 4. run in place ------------------------------------------------
# Both servers run straight out of this directory through launch.sh. Nothing is
# copied into ~/.local, so when this is a git clone every future fix arrives via
# launch.sh's own background pull, with no reinstall and no re-registering.
chmod +x "$HERE/launch.sh" "$HERE/gitea-mcp" 2>/dev/null || true
if ! git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  echo
  echo "Note: this is not a git clone, so automatic updates are off."
  echo "For updates without reinstalling, clone the repo instead of unpacking an archive."
fi

# /ta3leem-report slash command, user scope so it works in every repo
mkdir -p ~/.claude/skills/ta3leem-report 2>/dev/null || {
  echo "Cannot create ~/.claude/skills. Check permissions on $HOME/.claude, then re-run."
  exit 1
}
if [ -f ~/.claude/skills/ta3leem-report/SKILL.md ]; then
  cp ~/.claude/skills/ta3leem-report/SKILL.md ~/.claude/skills/ta3leem-report/SKILL.md.bak
  echo "Existing /ta3leem-report found, previous version saved as SKILL.md.bak"
fi
cp "$HERE/skills/ta3leem-report/SKILL.md" ~/.claude/skills/ta3leem-report/

# ---- 5. prove both servers work BEFORE registering ------------------
echo
echo "Testing both servers with your tokens..."
ST="$HERE/selftest.mjs"

GITEA_HOST="$GITEA_URL" GITEA_ACCESS_TOKEN="$GT" \
  node "$ST" gitea get_me '{}' -- bash "$HERE/launch.sh" gitea || {
    echo
    echo "Gitea check failed. Usual cause: bad or expired token. Regenerate and re-run."
    exit 1
  }

OPENPROJECT_URL="$OP_URL" OPENPROJECT_API_KEY="$OP" CF_USE_CLOUDFLARED=1 \
  node "$ST" openproject list_projects '{}' -- bash "$HERE/launch.sh" openproject || {
    echo
    echo "OpenProject check failed. Usual causes:"
    echo "  - Cloudflare session missing/expired -> cloudflared access login $OP_URL"
    echo "  - wrong API key -> regenerate at $OP_URL (My Account -> Access tokens)"
    exit 1
  }

# ---- 6. register with Claude Code -----------------------------------
# Remove immediately before the matching add, never both up front: a failed
# add would otherwise leave the other server deregistered with no rollback.
claude mcp remove gitea --scope user 2>/dev/null || true
if ! claude mcp add gitea --scope user \
  -e GITEA_HOST="$GITEA_URL" \
  -e GITEA_ACCESS_TOKEN="$GT" \
  -- bash "$HERE/launch.sh" gitea; then
  echo
  echo "Registering 'gitea' with Claude Code failed. Any previous gitea entry was removed."
  echo "Re-run this installer. If it keeps failing: claude mcp list"
  exit 1
fi

claude mcp remove openproject --scope user 2>/dev/null || true
if ! claude mcp add openproject --scope user \
  -e OPENPROJECT_URL="$OP_URL" \
  -e OPENPROJECT_API_KEY="$OP" \
  -e CF_USE_CLOUDFLARED=1 \
  -- bash "$HERE/launch.sh" openproject; then
  echo
  echo "Registering 'openproject' failed, but 'gitea' is installed and working."
  echo "Re-run this installer to finish. If it keeps failing: claude mcp list"
  exit 1
fi

echo
echo "-- Claude Code health check --"
claude mcp list 2>/dev/null | grep -iE "^(gitea|openproject):" || echo "(run 'claude mcp list' manually)"

echo
echo "Done. Both servers are READ-ONLY (no create/edit/comment/merge tools exist)."
echo "Open Claude Code and try: 'list my open PRs', or run /ta3leem-report"
echo "for your daily report. See USAGE.md for more."
echo
echo "The Cloudflare session lasts about 24h. When OpenProject stops answering, run:"
echo "  cloudflared access login $OP_URL"

# ta3leem MCP setup (Gitea + OpenProject in Claude Code)

Gives Claude Code read-only access to our Gitea (PRs, issues, code) and
OpenProject (tickets, comments, attachments). Read-only by design: there is no
tool in either server that can create, edit, comment, merge, or mark anything read.

## Install

    git clone https://gitea.ta3leem.dev/sandip.vanodiya/ta3leem-mcp.git
    cd ta3leem-mcp
    ./install.sh

The script asks for two tokens, checks they work, then registers both servers.
Takes about 2 minutes.

## Before you start

You need `node` (v18+), the `claude` CLI, and `cloudflared` on your PATH. The
script checks and tells you what is missing.

Generate your OWN tokens. Do not reuse a teammate's, everything you do is
logged as that person.

- Gitea token: https://gitea.ta3leem.dev -> Settings -> Applications -> Generate Token
- OpenProject key: https://pm.ta3leem.dev -> My Account -> Access tokens -> API

A browser window opens once for Cloudflare Access login. That session lasts
about 24h. When OpenProject stops answering, run:

    cloudflared access login https://pm.ta3leem.dev

## How to use it

See `USAGE.md` for example prompts and the two gotchas worth knowing before you
review a big PR.

## Check it worked

    claude mcp list

Both `gitea` and `openproject` should say Connected. Then in Claude Code, try
"list my open PRs", or run `/ta3leem-report` for your daily report.

## Updating later

    cd ta3leem-mcp
    git pull
    ./install.sh

That is the whole update path. No files to chase, no re-download. `install.sh` is
safe to re-run any number of times. See `CHANGELOG.md` for what changed and
`VERSION` for what you have.

## Platform

The committed `gitea-mcp` is a linux x86-64 binary. On macOS or ARM, download the
matching v1.3.0 build from gitea.com/gitea/gitea-mcp, replace the one in your
clone, then run install.sh as normal. Do not commit that replacement, keep it
local so `git pull` does not fight you.

## Known limits

- Reviewing a big PR: `get_diff` silently returns only part of the diff on large
  PRs (measured: 65 of 299 files), and `get_files` defaults to 30 files per page.
  Ask Claude to page through with `per_page` if you need the whole thing.
- PR review discussion lives in the issue comments, not in `get_reviews`.
- If a very long ticket journal comes back cut off, add this to the `env` block
  of your `~/.claude/settings.json` and restart Claude Code:

      "MAX_MCP_OUTPUT_TOKENS": "100000",

## Files

- `install.sh`, the installer, also the updater
- `VERSION` and `CHANGELOG.md`, what you have and what changed
- `gitea-mcp`, upstream Gitea MCP binary v1.3.0, run with `-r` (read-only) and a tool allowlist
- `openproject-mcp.mjs`, our OpenProject server, zero npm dependencies
- `selftest.mjs`, used by the installer to prove your tokens work before registering
- `USAGE.md`, example prompts and gotchas
- `skills/ta3leem-report/`, the `/ta3leem-report` daily report command, installed to `~/.claude/skills`

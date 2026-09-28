# ta3leem MCP for Claude Code

Read-only access to our Gitea and OpenProject from inside Claude Code. Ask about
a ticket or a pull request in plain language and Claude fetches the real thing,
instead of you copying text out of a browser tab.

Install once, and you never touch it again: the servers update themselves.

## What you get

- **Tickets.** Read any OpenProject ticket with its full description, its entire
  comment history, its parent, its child tickets and its related tickets.
- **Code and reviews.** Pull requests, diffs, issues, commits, branches and file
  contents from Gitea.
- **`/ta3leem-report`.** Your daily work report, assembled from what you actually
  did in OpenProject and the commits you authored. It excludes tickets that only
  moved because QA touched them.
- **Attachments.** Screenshots and PDFs on a ticket, downloaded so Claude can
  actually look at them. The real spec often lives there rather than in the
  description.
- **Read-only.** No tool you get can create, edit, comment, merge, approve, or
  mark anything as read. The OpenProject server has no write code at all. The
  upstream Gitea server does ship write tools, and they never load: it starts
  with `-r` (read-only mode) and a 13-tool allowlist.

Everything runs under your own tokens, so you see exactly what you would see in
the browser and nothing more.

## Requirements

Check these first. The installer stops with a clear message if any is missing,
but it saves you a round trip to have them ready.

| Need | Check with | If missing |
|---|---|---|
| `node` v18+ | `node --version` | https://nodejs.org |
| `claude` CLI | `claude --version` | `npm i -g @anthropic-ai/claude-code` |
| `cloudflared` | `cloudflared --version` | `sudo apt install cloudflared` |
| Repo access | you can open the repo page | ask the maintainer for an invite |

You also need two tokens. **Generate your own. Never reuse a teammate's**, since
every action is logged as whoever owns the token, and their access follows them
when they leave.

- **Gitea token:** https://gitea.ta3leem.dev then Settings, Applications,
  Generate Token. Read scopes only.
- **OpenProject key:** https://pm.ta3leem.dev then My Account, Access tokens, API.

## Install

The easiest way is the Claude Code plugin. Nothing to clone, tokens go into
your system's credential store, and updates arrive through Claude Code:

```bash
claude plugin marketplace add ta3leem-tools/ta3leem-mcp
claude plugin install ta3leem@ta3leem-mcp
```

`GETTING-STARTED.md` walks through it, including the token and auto-update
steps. The rest of this section covers the older clone-and-install route, which
still works.

```bash
git clone https://github.com/ta3leem-tools/ta3leem-mcp.git
cd ta3leem-mcp
./install.sh
```

About 2 minutes. The installer walks through four steps and stops on the first
problem rather than half-installing:

1. Checks the requirements above.
2. Asks for your two tokens.
3. Opens a browser once for Cloudflare Access login, since OpenProject sits
   behind Cloudflare Zero Trust.
4. Proves both servers answer with your tokens, and only then registers them
   with Claude Code.

**Keep the clone where it is.** Claude Code is registered against this
directory's path, so moving or deleting it breaks both servers. If you do move
it, re-run `./install.sh` from the new location.

## Verify

```bash
claude mcp list
```

Both `gitea` and `openproject` should report Connected. Then open Claude Code and
try it:

```
list my open PRs
read ticket 18390 and tell me what is blocked
/ta3leem-report
```

If those answer with real data, you are done.

## Usage

You never call the tools yourself. Talk normally and name the ticket or PR
number. A few that work well:

```
read ticket 18843 including all the comments
what are the child tickets of 17472 and what state is each in
show me the review comments on PR 287
read ticket 18843, then check whether PR 341 actually implements it
/ta3leem-report yesterday
```

Three habits that noticeably improve the answers:

- **Give the number.** "The leave ticket" costs an extra search and often finds
  the wrong one.
- **Ask for the comments explicitly.** Our requirements usually live in the
  activity history, not the description.
- **Mention attachments.** Otherwise Claude reads only text and misses the
  screenshot holding the actual spec.

`USAGE.md` has the fuller list, plus what to do with a large PR.

## Updating

Nothing to do. Both servers run out of this clone and check for new code in the
background, at most once every 6 hours, so a fix from the maintainer reaches you
on your next Claude Code session.

The check is deliberately timid: it runs after the server has already started so
it can never delay a session, it uses `--ff-only`, and it skips itself entirely
if you have local edits. `UPDATE.md` covers the manual override.

## Stop logging in every day

The Cloudflare browser login lasts about 24 hours. When OpenProject goes quiet:

```bash
cloudflared access login https://pm.ta3leem.dev
```

To be rid of that, ask the maintainer for a **Cloudflare Access service token**,
which lasts a year. Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`
instead of `CF_USE_CLOUDFLARED=1`, and `cloudflared` stops being needed at all.

Two conditions: the Access policy for the application must have its action set to
**Service Auth**, or Cloudflare still prompts for a browser login; and the token
must be **per person**, not one shared across the team, or nobody can tell who
did what and access outlives employment.

## Claude on the web and on your phone

Everything above is for Claude Code, which runs on your laptop. claude.ai in a
browser, the mobile apps and Cowork connect from Anthropic's cloud instead, so
they cannot reach a local process and need a server on the public internet.

`remote/` holds that: one Cloudflare Worker exposing the same 20 tools over
HTTPS, with its own OAuth sign-in so each person still connects under their own
tokens rather than a shared key. It is optional, it changes nothing here, and
`remote/README.md` has the deploy steps.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| OpenProject stopped answering | Cloudflare session expired, about 24h | `cloudflared access login https://pm.ta3leem.dev`, then restart Claude Code |
| `MISSING: node` / `claude` / `cloudflared` | Not on PATH | Install it, re-run `./install.sh` |
| Gitea check failed during install | Token wrong, expired, or revoked | Regenerate the token, re-run `./install.sh` |
| Both servers vanished | The clone was moved or deleted | Re-run `./install.sh` from where it lives now |
| A long ticket's history looks cut off | Claude Code caps one tool result at 25k tokens | Add `"MAX_MCP_OUTPUT_TOKENS": "100000"` to the `env` block of `~/.claude/settings.json`, restart |
| `claude mcp list` shows Failed | Usually a bad token or no network | Re-run `./install.sh`, it reports the real error |

Re-running `./install.sh` is always safe. It replaces one server's registration
at a time, so a failure never leaves you with neither.

## Platform

Linux and macOS, on x86-64 or ARM. The committed `gitea-mcp` is the linux
x86-64 build. On any other platform `./install.sh` downloads the matching v1.3.0
build from gitea.com, checks it against the release checksums, and puts it in
`bin/`, which git ignores. The committed binary stays untouched, so automatic
updates keep working. You need `curl` and `tar` for that step.

## Known limits

Worth knowing before you trust an answer:

- **Large PR diffs come back partial.** On a PR touching hundreds of files,
  Gitea's `get_diff` returns only part of it with no warning. Measured: 65 files
  out of 299. Ask Claude to page through `get_files` with an explicit `per_page`
  when reviewing something big.
- **Review discussion is in the issue comments,** not in `get_reviews`, which
  returns near-empty scaffolding on this Gitea instance.
- **A thin commit message gives a thin report bullet.** `/ta3leem-report` is
  assembled from ticket comments and commit messages, so read what it produces
  before pasting it anywhere.

## What is in here

| File | Purpose |
|---|---|
| `.claude-plugin/` | Plugin manifest and marketplace catalog for the `claude plugin install` route |
| `GETTING-STARTED.md` | Step-by-step setup for teammates, plugin route |
| `install.sh` | One-time setup for the clone route. Safe to re-run whenever tokens change |
| `scripts/fetch-gitea-mcp.sh` | Downloads and checksums the `gitea-mcp` build on macOS or ARM, for both routes |
| `launch.sh` | What Claude Code actually runs. Starts a server; on the clone route it also checks for updates in the background |
| `openproject-mcp.mjs` | Our OpenProject server. 7 read-only tools, zero npm dependencies |
| `gitea-mcp` | Upstream Gitea MCP v1.3.0, run with `-r` and a 13-tool read-only allowlist |
| `bin/` | Created by the installer on macOS or ARM only: the matching `gitea-mcp` build, not committed |
| `selftest.mjs` | Proves your tokens work before anything gets registered |
| `skills/ta3leem-report/` | The report command: `/ta3leem:ta3leem-report` from the plugin, or `/ta3leem-report` copied into `~/.claude/skills` by `install.sh` |
| `USAGE.md` | Example prompts and the large-PR caveats |
| `UPDATE.md` | How auto-update works, and the manual override |
| `remote/` | Optional Cloudflare Worker for claude.ai, mobile and Cowork |
| `VERSION`, `CHANGELOG.md` | What you have, and what changed |

## Maintainer

Sandip Vanodiya. Open an issue on the repo, or ask in the team channel.

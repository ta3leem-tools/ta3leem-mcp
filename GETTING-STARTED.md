# Getting started with ta3leem MCP

This connects Claude Code to our OpenProject and Gitea, so you can ask about a
ticket or a pull request by number and Claude reads the real thing. You don't
have to copy text out of the browser.

Everything is read-only. Claude can read tickets, comments, attachments, PRs,
diffs, commits and files. It cannot comment, change a status, approve or merge,
because those tools were never built into the servers.

Setup takes about 10 minutes, most of it spent creating tokens.

## Before you start

You need these installed:

| Tool | Check | Install |
|---|---|---|
| Node.js 18 or newer | `node --version` | https://nodejs.org |
| Claude Code | `claude --version` | `npm i -g @anthropic-ai/claude-code` |
| cloudflared | `cloudflared --version` | Linux: `sudo apt install cloudflared`. macOS: `brew install cloudflared` |
| git | `git --version` | your package manager |

On macOS or an ARM machine, the installer also downloads a Gitea binary for
your platform, so `curl` and `tar` must be available. Both come with macOS.

The repository is private. Ask Sandip to add your GitHub account before you
clone it.

## Step 1: create your own tokens

Use your own tokens, never a teammate's. Everything Claude reads is logged
under the token owner's name, and a shared token keeps working after its owner
leaves.

1. Gitea token: open https://gitea.ta3leem.dev, go to Settings, then
   Applications, then Generate Token. Give it read scopes only.
2. OpenProject key: open https://pm.ta3leem.dev, go to My Account, then Access
   tokens, then API.

Keep both somewhere handy for the next step.

## Step 2: install

```bash
git clone https://github.com/sandiprv9898/ta3leem-mcp.git
cd ta3leem-mcp
./install.sh
```

The installer:

1. Checks that `node`, `claude` and `cloudflared` are installed.
2. Asks for your Gitea token and your OpenProject key.
3. Opens your browser once for the Cloudflare login that protects OpenProject.
4. Calls both servers with your tokens and registers them with Claude Code only
   if both answer.

If anything fails, it stops and tells you why. Nothing is left half installed,
and running `./install.sh` again is always safe.

Leave the cloned folder where it is. Claude Code starts the servers from that
path, so moving or deleting the folder breaks both. If you do move it, run
`./install.sh` again from the new location.

## Step 3: check it works

```bash
claude mcp list
```

You should see `gitea` and `openproject` both marked Connected. Then open
Claude Code in any project and try:

```
list my open PRs
read ticket 18390 and tell me what is blocked
```

If you get real data back, you're set up.

## How to use it

You never call the tools by name. Ask in plain language and include the ticket
or PR number.

Tickets:

```
read ticket 18843 including all the comments
what are the acceptance criteria on 18843
what are the child tickets of 17472 and what state is each in
check the attachments on 18769 too
find tickets assigned to burhan
```

Pull requests and code:

```
show me the comments on PR 287
what changed in PR 341
show me app/Models/HR_Employees.php from the dev branch
what were the last 10 commits on this branch
read ticket 18843, then check whether PR 341 implements it
```

Daily report:

```
/ta3leem-report
/ta3leem-report yesterday
/ta3leem-report 2026-09-01
```

The report is built from your OpenProject activity and the commits you wrote.
A short commit message gives a short report line, so read it before you post it.

## Habits that get better answers

- Give the number. "The leave ticket" costs Claude an extra search, and it often
  finds the wrong ticket.
- Ask for the comments. Most of our requirements live in the activity history,
  and the description alone often misses them.
- Mention attachments. Claude reads text by default, and the real spec is often
  a screenshot or a PDF on the ticket.
- Ask for PR comments, not reviews. Our Gitea keeps review discussion in the
  issue comments, so asking for "the reviews" returns almost nothing.
- Page through big PRs. On a PR with hundreds of files the diff comes back
  partial without any warning (65 of 299 files in one test). Ask Claude to "page
  through all the changed files" instead.

## Updates

You don't need to do anything. Each time a server starts it checks the
repository in the background, at most once every 6 hours, and pulls new code.
The new version runs from your next Claude Code session.

The check skips itself if you have edited files in the clone, so leave the
clone unmodified if you want updates. To update right away, run `git pull`
inside the folder and restart Claude Code. `cat VERSION` shows what you have,
and `CHANGELOG.md` lists what changed.

## When something goes wrong

| What you see | Why | Fix |
|---|---|---|
| OpenProject stops answering | The Cloudflare login expired, about every 24 hours | `cloudflared access login https://pm.ta3leem.dev`, then restart Claude Code |
| `claude mcp list` shows Failed | Usually a wrong or expired token, or no network | Run `./install.sh` again. It prints the real error |
| Both servers disappeared | The clone was moved or deleted | Run `./install.sh` from where the folder is now |
| A long ticket history looks cut off | Claude Code limits one tool result to 25k tokens | Add `"MAX_MCP_OUTPUT_TOKENS": "100000"` to the `env` block of `~/.claude/settings.json`, then restart |
| `Checksum mismatch` during install on a Mac | The downloaded Gitea binary did not match its published checksum | Run `./install.sh` again. If it repeats, tell Sandip |

## More detail

`README.md` covers how the pieces fit together, and `USAGE.md` has more example
prompts. For claude.ai in the browser or the mobile app, see `remote/README.md`.
That setup is optional and separate from this one.

Questions go to Sandip Vanodiya or the team channel.

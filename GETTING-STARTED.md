# Getting started with ta3leem MCP

This connects Claude Code to our OpenProject and Gitea, so you can ask about a
ticket or a pull request by number and Claude reads the real thing. You don't
have to copy text out of the browser.

Everything is read-only. Claude can read tickets, comments, attachments, PRs,
diffs, commits and files. It cannot comment, change a status, approve or merge.
The OpenProject server has no write tools at all, and the Gitea server starts
in read-only mode with a list of 13 reading tools, so its write tools never
load.

It installs as a Claude Code plugin, so there is no folder to clone or keep.
Setup takes about 10 minutes, most of it spent creating tokens.

## Before you start

You need these installed:

| Tool | Check | Install |
|---|---|---|
| Node.js 18 or newer | `node --version` | https://nodejs.org |
| Claude Code | `claude --version` | `npm i -g @anthropic-ai/claude-code` |
| cloudflared | `cloudflared --version` | Linux: `sudo apt install cloudflared`. macOS: `brew install cloudflared` |
| git | `git --version` | your package manager |

The plugin runs on Linux and macOS, on x86-64 or ARM. It does not run on
Windows directly.

The repository is public, so you don't need a GitHub account or an invite to
install. What you can see is still decided by your own tokens.

## Step 1: create your own tokens

Use your own tokens, never a teammate's. Everything Claude reads is logged
under the token owner's name, and a shared token keeps working after its owner
leaves.

1. Gitea token: open https://gitea.ta3leem.dev, go to Settings, then
   Applications, then Generate Token. Give it read scopes only.
2. OpenProject key: open https://pm.ta3leem.dev, go to My Account, then Access
   tokens, then API.

Keep both somewhere handy for Step 3.

## Step 2: install the plugin

Run these in a terminal:

```bash
cloudflared access login https://pm.ta3leem.dev
claude plugin marketplace add ta3leem-tools/ta3leem-mcp
claude plugin install ta3leem@ta3leem-mcp
```

The first command opens your browser once for the Cloudflare login that
protects OpenProject. The other two register our plugin catalog and install the
plugin from it. The install ends with a note that 2 settings are not set yet.
That is expected, and Step 3 sets them.

## Step 3: add your tokens

Open Claude Code and run:

```
/plugin configure ta3leem@ta3leem-mcp
```

Paste your Gitea token and your OpenProject key when asked. The input is masked,
and Claude Code keeps both values in your system's credential store rather than
in a settings file. Restart Claude Code afterwards.

## Step 4: turn on automatic updates

Claude Code leaves automatic updates off for a new plugin catalog, so switch
them on once:

1. In Claude Code, run `/plugin`.
2. Open Marketplaces and select `ta3leem-mcp`.
3. Select Enable auto-update.

## Step 5: check it works

```bash
claude mcp list
```

You should see `plugin:ta3leem:gitea` and `plugin:ta3leem:openproject`, both
marked Connected. On a Mac or an ARM machine, the first start of the Gitea
server downloads the binary for your platform (about 4 MB), so give it a few
seconds.

Then open Claude Code in any project and try:

```
list my open PRs
read ticket 18390 and tell me what is blocked
```

If you get real data back, you're set up.

## How to use it

You never call the tools by name. Ask in plain language and include the ticket
or PR number. The plugin also brings two skills, `/ta3leem:pm` and
`/ta3leem:gitea`, that tell Claude how to read our tickets and PRs properly.
Claude loads them by itself when you ask about a ticket or a PR, so you rarely
need to type them.

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
/ta3leem:ta3leem-report
/ta3leem:ta3leem-report yesterday
/ta3leem:ta3leem-report 2026-09-01
/ta3leem:ta3leem-report burhan
```

The last form reports on someone else, for example a teammate you are covering
for. The report is built from OpenProject activity plus the Gitea commits and
PRs the person authored. A short commit message gives a short report line, so
read the report before you post it.

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

## Using it in claude.ai and the mobile app

The same tickets and PRs are available in claude.ai in the browser and in the
Claude mobile app, through a connector our organization already has. You don't
need the plugin for this, only your two tokens from Step 1.

1. In claude.ai, open Settings, then Connectors.
2. Find `ta3leem` and click Connect.
3. Enter the team passphrase (ask Sandip for it), your OpenProject key and
   your Gitea token.

Try `list my open PRs in mohesr/ums-v2-hr` in a new chat. Claude asks for
permission the first time it uses the connector; choose Always allow. If
OpenProject stops answering there while Gitea still works, tell Sandip, since
the server's access token needs a refresh.

## Updates

With auto-update on (Step 4), Claude Code checks the catalog in the background
after a session starts and installs any new version Sandip has pushed. The new
version is used from your next session, or right away after `/reload-plugins`.

To update by hand, run `claude plugin update ta3leem@ta3leem-mcp` and restart
Claude Code. `CHANGELOG.md` in the repository lists what changed.

## Moving from the old install.sh setup

If you installed earlier by cloning the repository and running `./install.sh`,
remove the old servers so you don't have two copies of every tool:

```bash
claude mcp remove gitea --scope user
claude mcp remove openproject --scope user
```

Then follow Steps 2 to 5. The old `/ta3leem-report` command in
`~/.claude/skills/ta3leem-report` can be deleted too, since the plugin brings
its own as `/ta3leem:ta3leem-report`. Once the plugin works, you can delete the
old clone.

The `./install.sh` route still works if you prefer it. `README.md` describes it.

## Found a bug or want to change something

Open an issue on GitHub, or send a pull request. Only Sandip merges into
`main`, because a merge goes out to everyone's machine through auto-update.
Please don't merge a pull request yourself, even when GitHub offers the button,
and don't push to `main`. `CONTRIBUTING.md` has the full rules and how to test
a change before you send it.

## When something goes wrong

| What you see | Why | Fix |
|---|---|---|
| `marketplace add` or `plugin install` fails with a network or "not found" error | git cannot reach github.com, or the name is mistyped | Check you can open https://github.com/ta3leem-tools/ta3leem-mcp in a browser, then copy the command again |
| OpenProject stops answering, or Claude Code warns at startup that your OpenProject login expires soon | The Cloudflare login lasts about 24 hours | `cloudflared access login https://pm.ta3leem.dev`, then restart Claude Code |
| A server shows Failed in `claude mcp list` | Usually a wrong or expired token, or no network | Run `/plugin configure ta3leem@ta3leem-mcp` in Claude Code, paste fresh tokens, restart |
| Gitea shows Failed on a Mac or ARM machine | The first-start download of the Gitea binary failed | Check your network and restart Claude Code. It tries the download again on every start until it succeeds |
| A very long ticket history still looks cut off | The ticket tools allow 200,000 characters per result | Ask Claude to read the history in chunks, for example "read the activities of 18843 in pages of 50" |

## More detail

`README.md` covers how the pieces fit together, and `USAGE.md` has more example
prompts. For claude.ai in the browser or the mobile app, see `remote/README.md`.
That setup is optional and separate from this one.

Questions go to Sandip Vanodiya or the team channel.

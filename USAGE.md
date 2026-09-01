# How to use it

Once installed, you do not call these tools yourself. You talk to Claude Code in
plain language and it picks the right one. Just be specific about the ticket
number, PR number, or repo.

Both servers are read-only. Claude cannot comment on a ticket, approve a PR, or
change a status even if you ask it to. Do that in the browser.

## OpenProject (tickets)

Ask things like:

    read ticket 18390 and summarise what is blocked
    what are the acceptance criteria on 18843
    show me the full comment history on 18127
    what did the client ask for in the latest comments on 18769
    list my open tickets
    what tickets were updated this week
    find tickets assigned to burhan
    are there attachments on 18769, and what do they show

Parent and child tickets come back automatically, so epic questions work:

    what are the child tickets of 17472 and what state is each in
    is 18843 part of a bigger epic
    give me the whole picture on epic 18127 including its sub-tickets
    what other tickets are related to 17472

Tips that make a real difference:

- **Always give the ticket number.** "the leave ticket" costs an extra search step
  and often finds the wrong one.
- **Ask for the activity history explicitly** when the description alone is not
  enough. Requirements in our tickets usually live in the comments, not the
  description. "read 18390 including all comments" is the reliable phrasing.
- **Attachments matter.** Screenshots and PDFs on a ticket often contain the real
  spec. Ask "check the attachments on 18390 too" or Claude may only read text.
- Timestamps come back in IST already, no conversion needed.
- Reading one ticket also returns its parent, its children, and any related
  tickets, so you can ask "what else does this touch" without hunting in the
  browser.

## Gitea (code, PRs, issues)

Ask things like:

    list my open PRs
    review PR 157 in ums-v2-hr
    what changed in PR 341
    show me the review comments on PR 287
    what did the reviewer ask for on my PR
    show me app/Models/HR_Employees.php from the dev branch
    what were the last 10 commits on this branch
    search issues mentioning leave balance

Two traps worth knowing:

- **Big PRs come back partial.** On a PR touching hundreds of files, the diff
  tool silently returns only part of it (measured: 65 files out of 299) with no
  warning. If you are reviewing something large, say "page through all the
  changed files" so Claude requests them in batches instead of trusting the
  first response.
- **Review comments are not in the reviews tool.** Our Gitea keeps review
  discussion in the issue comments. Ask for "the comments on PR 157", not "the
  reviews", or you get an almost empty answer.

## Daily report

    /ta3leem-report

Builds your daily work report by cross-referencing what you did in OpenProject
with the PRs and commits you authored in Gitea, then prints it in the
𝗔𝗦𝗞 𝗟𝗜𝗦𝗧 𝗦𝗨𝗠𝗠𝗔𝗥𝗬 format the team uses. Takes a minute or two, since it reads
every candidate ticket's history.

    /ta3leem-report yesterday
    /ta3leem-report 2026-09-01
    /ta3leem-report <name>          report for someone else

It works out who you are from your own Gitea account, so there is nothing to
configure. It only counts work you actually did: a ticket that moved to Tested
because QA touched it does not appear, and it says which tickets it excluded and
why. Status moves and PR housekeeping are left out by design, so bullets describe
what changed, not where the ticket landed in the workflow.

Read what it produces before pasting it anywhere. It is assembled from ticket
comments and commit messages, so a thin commit message gives a thin bullet.

## Combining both

The useful part is asking one question that spans both systems:

    read ticket 18843, then check whether PR 341 actually implements it
    my PR 157 got review comments, and ticket 18390 has new client comments,
      summarise what I need to change
    what is left to do on ticket 18127 based on the code that already merged

## When it stops working

OpenProject goes quiet after about 24h because the Cloudflare session expires:

    cloudflared access login https://pm.ta3leem.dev

Then restart Claude Code. To check both servers are alive:

    claude mcp list

Gitea failing instead usually means your token was revoked or expired.
Regenerate it and re-run `./ta3leem-mcp/install.sh`, it is safe to run again.

## What Claude can see

Everything you can see, and nothing more. Both servers use your own token, so
your own permissions apply. A private repo or project you cannot open stays
invisible to Claude too.

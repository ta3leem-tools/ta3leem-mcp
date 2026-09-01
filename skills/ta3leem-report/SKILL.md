---
name: ta3leem-report
description: Your daily work report, built from OpenProject tickets and Gitea PRs and commits.
disable-model-invocation: true
---

# ta3leem-report

Builds **your own** daily work report by cross-referencing OpenProject (tickets and
activities) with Gitea (PRs and commits). Output goes in the
`𝗔𝗦𝗞 𝗟𝗜𝗦𝗧 𝗦𝗨𝗠𝗠𝗔𝗥𝗬` format the team uses.

Usage:

    /ta3leem-report                 today, you
    /ta3leem-report yesterday
    /ta3leem-report 2026-09-01
    /ta3leem-report <name>          someone else, e.g. a teammate you cover for

## Hard rules

- **Read-only.** Never create, update, or comment on anything in OpenProject or
  Gitea. No write tool exists in either server anyway.
- **Use only `mcp__openproject__*` and `mcp__gitea__*` tools.** Never curl those
  APIs.
- **Count only work the person actually did.** Their comments, their status
  changes, their authored commits and PRs.
  - EXCLUDE status moves made by others. A ticket whose only activity that day is
    QA flipping it to Tested, a reviewer ping, or a PM cascade was NOT worked on.
  - A move to Code Review or Done counts only if the person made it themselves.
- **No file names in the output.** Say what behavior changed, not which file.
- **No status-transition bullets, ever.** Never write "moved to Code Review",
  "opened MR #12 and moved to Code Review", or any bullet whose payload is a
  status move, not even as a trailing clause. Status is metadata, not work.
- **No process or housekeeping bullets, ever.** Drop "raised PR #N", "posted the
  MR link", "merged dev into the branch", "looped in the reviewer". These are
  workflow mechanics. Only substance counts: what was investigated, root-caused,
  built, fixed, decided, or verified.
- **5 to 6 real bullets per ticket.** Write proper detail, not one-liners. If you
  genuinely only have two bullets of substance, say so rather than padding with
  process filler.
- **No raw counts from a dev environment** (row counts, record totals) in anything
  client-facing. Describe qualitatively.
- **Timestamps are IST.** The OpenProject server already returns
  `DD/MM/YYYY HH:mm IST`. Use as-is, do not convert.
- **Verify, do not assume.** Every bullet must trace to a real PM activity or a
  real Gitea commit or PR. State your confidence at the end.

## Step 0: resolve who and when

1. **Who:** call `mcp__gitea__get_me` to get the Gitea handle and email of
   whoever is running this. That is the default subject of the report. Resolve the
   matching OpenProject identity with `mcp__openproject__find_user` using the
   name from `get_me`.
   - If an argument names a person instead, resolve that person and report on them.
   - Commits can carry more than one email per person. Confirm which email the
     Gitea account actually uses via `get_me`, and attribute on that.
2. **When:** default is today in IST. Accept `yesterday` or an explicit
   `YYYY-MM-DD`.
3. **Repos:** scan `ums-v2-hr`, `ums-v2-admin`, `ums-v2-iam` under owner
   `mohesr`. Use `list_my_repos` if you need others, and add any repo a PM
   comment links to.

## Step 1: candidate tickets

`search_work_packages` with `assignee_name=<person>`, `updated_since=<date>`,
`updated_until=<date>`, `status=all`, `page_size=50`.

This is a candidate list, not the final one. `updatedAt` fires on other people's
actions too.

## Step 2: confirm what the person did

For each candidate, `get_work_package_activities`.

- Every entry carries `user` and `userId`. Match on `userId` against the id
  `find_user` returned, since display names are not unique. Keep only entries
  dated on `<date>` in IST whose author is the person.
- Capture what they wrote: root-cause notes, clarifications, decisions, answers to
  questions, demo notes.
- Drop tickets whose only activity that day belongs to someone else.
- Reading one ticket also returns its parent and children. On an epic, check
  whether the real work landed on a child ticket.
- If a journal is too long to read in one go, use the `limit` and `offset`
  arguments to page through it. Do not skip it.

## Step 3: Gitea work

- Per repo, `list_pull_requests` with `state=all`, `sort=recentupdate`. Keep PRs
  authored by the person and touched on `<date>`.
- **Never skip this:** for every open PR of theirs updated on `<date>`, drafts
  included, run `list_commits` on its head branch and keep commits they authored
  on `<date>`. Pushed commits often have zero OpenProject activity that day, so a
  ticket dropped in Step 2 must come back if its branch has their commits.
- For merged PRs, `list_commits` on the head branch. Commit messages tell you what
  shipped.
- Also run `git log --author` locally for `<date>`, which catches work committed
  but not pushed.
- Review discussion lives in `issue_read get_comments`, not in `get_reviews`.
- On a large PR, `get_diff` silently returns only part of the diff. If you need the
  full picture, page through `get_files` with an explicit `per_page`.
- Map each PR back to its ticket. The PR body usually carries the ticket URL, and
  PM comments usually carry the PR link.

## Step 4: write it

One block per ticket genuinely worked that day. Turn commits and PM comments into
functional bullets: what behavior changed, what broke and why, what was decided.

Order the blocks: merged work first, then work under review, then newly started
last. Use that only for sequencing, never as bullet text.

Label cross-repo work by module: HR, IAM, Super Admin, SIS, MOOC.

## Output format

```
𝗔𝗦𝗞 𝗟𝗜𝗦𝗧 𝗦𝗨𝗠𝗠𝗔𝗥𝗬

Worked on ticket #<id>
* <functional bullet>
* <functional bullet>

Worked on ticket #<id>
* <functional bullet>
```

Plain past tense, `*` bullets, no file names.

End with a one-line confidence note, plus any ticket you excluded and why, for
example "excluded #17451, moved to Tested by QA, not your action today".

## Example

```
𝗔𝗦𝗞 𝗟𝗜𝗦𝗧 𝗦𝗨𝗠𝗠𝗔𝗥𝗬

Worked on ticket #16037
* Finalized the Employee ID card printing request workflow and merged it into dev
* Reworked the Pending, Approved and Rejected screens so columns, actions and
  status handling line up across the whole printing lifecycle
* Verified the approval path end to end against real request records

Worked on ticket #17761
* Investigated the 500 "under maintenance" error when editing a 2FA-enabled user
* Root-caused it to the shared-DB user owner type pointing at the HR employee
  class with no polymorphic mapping registered in IAM
* Fixed it by registering the missing mapping, then confirmed the edit screen
  loads for both 2FA and non-2FA users
* Recorded a demo video showing the fix working end to end
```

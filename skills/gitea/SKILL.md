---
name: gitea
description: Answer questions about Gitea on gitea.ta3leem.dev, such as pull requests, review comments, diffs, changed files, commits, branches, issues and repos. Use when the user names a PR number, pastes a Gitea link, or asks about PRs, review feedback or what changed in a branch.
---

# gitea

Read-only. Never create, merge, approve or comment on anything in Gitea. The server
exposes read tools only.

## Tools

Use only the Gitea MCP tools. Installed as the plugin they are
`mcp__plugin_ta3leem_gitea__<tool>`. Installed the older way they are
`mcp__gitea__<tool>`. Use whichever set this session has. Tool names below are
written in the short form. Never curl the Gitea API from Bash.

Default repo when none is named: owner `mohesr`, repo `ums-v2-hr`. The Admin repo
is `mohesr/ums-v2-admin`.

- List PRs: `list_pull_requests` (`owner`, `repo`, `state` open, closed or all,
  `sort`, `page`, `per_page`). It has no author filter, so filter by author yourself.
- One PR: `pull_request_read` with `method` set to `get` (details, head branch),
  `get_files` (changed files), `get_diff`, or `get_status` (head commit checks).
- Review feedback: `issue_read` with `method=get_comments` and the PR number as
  `issue_number`. See the traps below.
- Issues: `list_issues`, `issue_read` (`get`, `get_comments`, `get_labels`), and
  `search_issues` (`query`, `type` issues or pulls, `state`, `owner`) across repos.
- Commits: `list_commits` (`sha` accepts a branch name, `path` narrows to a file),
  then `get_commit` (`sha`) for one commit.
- Branches: `list_branches`. File content at a ref: `get_file_contents` (`ref`, `path`).
- Repos: `list_my_repos`, `search_repos`.
- Notifications: `notification_read` with `method=list` or `get`.
- "My PRs" means authored by or assigned to the token owner. Call `get_me` first to
  learn who that is.

## Known traps

- Review discussion lives in the PR's issue comments (`issue_read get_comments`).
  `get_reviews` returns near-empty scaffolding on this Gitea instance, so an empty
  review list does not mean nobody commented.
- On a large PR, `get_diff` returns only part of the diff with no warning. When the
  full picture matters, page through `get_files` with an explicit `per_page` and
  `page` until a page comes back short, and say how many files you covered.

## Single PR

1. `pull_request_read` with `method=get` for details, `updated_at` and head branch.
2. `issue_read` with `method=get_comments` for the discussion.
3. `get_files` (paged, as above) when the question is about what changed.
4. Link it to its ticket: the head branch usually reads `feature/<id>-...` or
   `bugfix/<id>-...`, and the PR body usually carries the ticket URL.

## Timestamps

Always show IST (`+05:30`). Gitea returns `+02:00`, so convert: add 3 hours 30 minutes.

## Errors

If a tool fails with 401 or 403, the token has expired or lacks read scope. Tell
the user to generate a new one in Gitea under Settings, Applications, then update
the plugin's `gitea_token` setting (on the older install, rerun `install.sh`).
Do not retry with curl.

## Output

- PR list: a markdown table with number, title, author, state, updated.
- Comments and reviews: chronological, `[date] author: comment`, with `file:line` when present.
- Diffs: summarize per file (path, added and removed lines, what changed). Show
  hunks only when the user asks.
- Refer to PRs as `PR #n`. Answer the question asked and leave out raw JSON.

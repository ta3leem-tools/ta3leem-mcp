---
name: pm
description: Answer questions about OpenProject tickets (work packages) on pm.ta3leem.dev, such as status, description, comments, attachments, history, and who is working on what. Use when the user names a ticket number, pastes an OpenProject link, or asks about tickets, assignees or weekly activity.
---

# pm

Read-only. Never create, update or comment on anything in OpenProject. The server
has no write tools anyway.

## Tools

Use only the OpenProject MCP tools. Installed as the plugin they are
`mcp__plugin_ta3leem_openproject__<tool>`. Installed the older way they are
`mcp__openproject__<tool>`. Use whichever set this session has. Tool names below
are written in the short form. Never curl the OpenProject API from Bash.

- Ticket details, description, parent, children, related tickets: `get_work_package` (`id`).
- Comments, status changes, full history: `get_work_package_activities` (`id`).
  On a very long ticket, page with `limit` and `offset` (0-based) instead of skipping it.
- Attachment list: `get_work_package_attachments` (`id`).
- Read one attachment: `download_attachment` (`id`, `filename`). It returns a local
  path; open that path with Read.
- Find tickets: `search_work_packages` with `query` (subject text), `project_id`,
  `status` (`open`, `closed`, `all`; default open), `assignee_me`, `assignee_name`
  (partial name is fine), `updated_since` and `updated_until` (YYYY-MM-DD),
  `page_size`, `sort` (`newest`, `oldest`), `offset` (1-based page number).
- "What is <person> working on": `search_work_packages` with `assignee_name`.
  In Progress means actively working.
- User or group id: `find_user` (`name`, partial).
- Project ids and identifiers: `list_projects`.

## Single ticket

1. `get_work_package` for the id.
2. `get_work_package_activities` for the id. The description is capped at 2000
   characters, and the activities often carry the full acceptance criteria and
   the decisions made later.
3. `get_work_package_attachments` for the id. Download and read every `.txt`,
   `.log` and `.json` attachment (Sentry exports, error dumps, stack traces), and
   look at every screenshot. This step is mandatory. The subject or description is
   sometimes stale or pasted from a different issue, and the attached dump is the
   ground truth when one exists. Never answer a bug ticket, or hand it to a fix or
   investigation flow, before reading its attachments.
4. If an attachment contradicts the description or subject (different module,
   different stack trace, different project), trust the attachment and tell the
   user about the mismatch plainly. Do not quietly reconcile the two.
5. Note linked tickets from `#<number>` mentions in the description and comments.

## Many tickets and reports

- Period or weekly report for a person: `search_work_packages` with
  `assignee_name`, `updated_since`, `updated_until` and `status=all`, then
  `get_work_package_activities` for each hit.
- `updatedAt` also moves when someone else acts on a ticket. To attribute work,
  filter activities by author and date yourself.
- For several ids, loop `get_work_package_activities`, filter by `createdAt`, and
  aggregate.

## Timestamps

Always IST (`+05:30`). OpenProject already returns `DD/MM/YYYY HH:mm IST`; show it
as-is without converting.

## Errors

If a tool fails with "Cloudflare Access session expired", tell the user to run:

    cloudflared access login https://pm.ta3leem.dev

Then stop. Never retry the request with curl.

## Output

- One ticket: a compact line `WP #id: subject | status | assignee | priority | last update`, then the answer.
- Several tickets: a markdown table with id, subject, status, assignee, updated.
- Comments and activity: chronological, one per line as `[date] author: comment or change`.
- Refer to tickets as `WP #id`. Answer the question asked and leave out raw JSON.

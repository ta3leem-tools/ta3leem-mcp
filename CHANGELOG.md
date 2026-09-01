# Changelog

## 1.3.0 (2026-09-01)

- **No more reinstalling.** Both servers now run out of the clone through
  `launch.sh`, which checks for updates in a detached background process after
  the server has started, at most once every 6 hours. A `git push` from the
  maintainer reaches everyone on their next session. Nothing is copied into
  `~/.local` any more, and the update is skipped if the clone has local edits.
- Tool annotations added: every tool declares `readOnlyHint`, `destructiveHint`,
  `idempotentHint` and `openWorldHint`, so a client can tell these are safe reads
  and skip confirmation prompts. `download_attachment` is correctly marked not
  read-only, since it writes a local file.
- Tool titles added for clients that display them.
- Tool results now carry `structuredContent` alongside the text block, so a
  client gets parsed JSON instead of re-parsing a string. The text block is
  unchanged, so older clients behave exactly as before.
- `outputSchema` added for `find_user`, `list_projects` and
  `get_work_package_attachments`, validated against live responses.
- `initialize` now answers with the spec revision this server actually
  implements instead of echoing whatever the client asked for. It previously
  claimed support for any version a client named, including ones with features
  this transport does not have.

## 1.2.0 (2026-09-01)

- `get_work_package_activities` now returns `user` and `userId` on every entry.
  The API only ever sent a bare href, so the author was silently dropped and
  every activity came back anonymous. Without it a daily report cannot tell your
  own work from a QA status flip on the same ticket the same day.

## 1.1.0 (2026-09-01)

- `get_work_package` now returns the ticket's parent, its child tickets, and any
  related tickets. Epic questions work without hunting in the browser.
- Fixed `find_user` dropping every match past the 100th. A broad name search
  silently lost people.
- Fixed `list_projects` having the same hole, which would have triggered at 101
  projects.
- Added `limit` and `offset` on `get_work_package_activities` for very long
  journals.
- Added the `/ta3leem-report` daily report command.
- Installer now checks node, claude and cloudflared upfront, validates both
  tokens before registering anything, strips pasted carriage returns, and no
  longer deregisters one server when the other fails to register.

## 1.0.0

- First version: read-only Gitea and OpenProject MCP servers.

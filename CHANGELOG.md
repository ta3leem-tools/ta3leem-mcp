# Changelog

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

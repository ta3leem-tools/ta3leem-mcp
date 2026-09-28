# Changelog

## 1.6.0 (2026-09-28)

- **New: install as a Claude Code plugin.** The repository is now also a plugin
  marketplace. Teammates run `claude plugin marketplace add
  sandiprv9898/ta3leem-mcp` and `claude plugin install ta3leem@ta3leem-mcp`,
  with no clone to keep and no installer to run. Tokens are asked for through
  `/plugin configure` and kept in the system credential store. Updates arrive
  through Claude Code's plugin auto-update once it is enabled for the
  marketplace. `GETTING-STARTED.md` covers the steps.
- The plugin declares no `version`, so each pushed commit is a new version.
- In plugin mode the tools are named `mcp__plugin_ta3leem_gitea__*` and
  `mcp__plugin_ta3leem_openproject__*`, and the report command is
  `/ta3leem:ta3leem-report`. The report skill now works with either naming.
- `launch.sh` skips its git self-update in plugin mode, and on macOS or ARM
  downloads the Gitea binary once into the plugin data directory, which
  survives plugin updates. The file name carries the gitea-mcp version, so a
  future version bump fetches the new build instead of reusing the old one.
- The Mac/ARM download moved into `scripts/fetch-gitea-mcp.sh`, shared by
  `install.sh` and `launch.sh`. It extracts into a temporary directory inside
  the target directory and renames the binary into place, so a failed extract
  never leaves a broken binary and two sessions starting at once never run a
  half-copied one.
- The `install.sh` route is unchanged and keeps working.

## 1.5.0 (2026-09-28)

- **Fix: list results no longer break strict clients.** MCP 2025-06-18 requires
  `structuredContent` to be an object, but `find_user`, `list_projects` and
  `get_work_package_attachments` returned a bare array. List results are now
  wrapped as `{ items: [...] }`, and the declared `outputSchema` is wrapped to
  match. Applied to both the local OpenProject server and the remote Worker.
  The Worker needs a redeploy to pick it up.
- **Fix: automatic updates now run on macOS.** `launch.sh` called `timeout`,
  which macOS does not ship, so every background pull failed silently. It now
  falls back to git's own low-speed abort, and reads the stamp file's age with
  BSD `stat` when GNU `stat` is missing.
- **New: `install.sh` fetches the right `gitea-mcp` on macOS and ARM.** It
  downloads the matching v1.3.0 release from gitea.com, verifies the SHA-256
  against the release checksums, and installs it to the gitignored `bin/`.
  `launch.sh` prefers `bin/gitea-mcp` when present. No more hand-replacing the
  committed binary, which also used to switch auto-update off because the clone
  then had local edits.

## 1.4.0 (2026-09-01)

- **New: `remote/`, a public HTTPS server for the hosted Claude clients.**
  claude.ai, the mobile apps and Cowork connect from Anthropic's cloud, so they
  cannot use the stdio servers at all. `remote/` is one Cloudflare Worker
  carrying the same 20 tools (7 OpenProject, 13 Gitea) over Streamable HTTP.
  The Claude Code setup is untouched and this is entirely optional.
- The Worker is its own OAuth 2.1 authorization server, with dynamic client
  registration, Client ID Metadata Document support and S256 PKCE. Each person
  pastes their own OpenProject key and Gitea token at the consent screen and
  those are encrypted into that person's grant, so there is no shared service
  identity and attribution survives.
- Enrollment is gated by a team passphrase, and both credentials are verified
  against the live APIs before a grant is ever stored, so a wrong key fails on
  the spot instead of producing a connector that silently does not work.
- The 13 Gitea tools are reimplemented against Gitea REST v1, because the
  upstream Go binary cannot run on Workers. Tool names are identical, so the
  same prompts work on both setups.
- Every list-shaped Gitea tool now takes explicit `page` and `limit` and reports
  whether more remains, which is a direct answer to the silent diff truncation
  (65 files returned out of 299).
- `download_attachment` returns the bytes inline as base64, capped at 4 MB. A
  Worker has no local disk, so there is no file path to hand back.
- `remote/selftest-remote.mjs` drives the whole flow end to end: registration,
  PKCE, consent, token exchange, real tool calls, plus the negative paths.
- Two ways through Cloudflare Access, because a service token needs admin on the
  account that owns the Access application and not everyone has it. A service
  token is preferred when present; failing that, `remote/refresh-access-token.sh`
  pushes a 24h `cloudflared` session token into the Worker and can be crontabbed.
  Verified working: with the session token set, a request reaches OpenProject
  itself rather than the Access login page.
- Gitea turned out to need no Cloudflare Access token at all. Its bare API 403 is
  Gitea's own "Only signed in user is allowed to call APIs", not a Cloudflare
  block, and the host answers publicly. Each user's own token is enough, so all
  13 Gitea tools work with no extra setup and keep working when the OpenProject
  session token lapses.
- Access headers are now per upstream rather than shared, since an Access JWT's
  `aud` claim is scoped to one application.
- Confirmed against a live deployment, not just locally. The Cloudflare Access
  session JWT does work from Cloudflare's edge and is not IP bound: a request
  from the deployed Worker reached OpenProject and came back with a 401 on a
  deliberately invalid API key, rather than the Access login page. That was the
  last open assumption in the design.
- Three real bugs found by running the setup rather than reading about it.
  `wrangler whoami` exits 0 while logged out, so its exit code cannot be used as
  a login check. `wrangler secret put` fails with error 10007 on a Worker that
  has not been deployed yet, so deploy has to come before secrets. And a cron job
  would have failed silently every day, because the system Node 20 shadows nvm's
  Node 24 under cron's minimal PATH and wrangler needs 22 or newer.
- `cloudflared access login` does not rotate a session that is still valid, it
  returns the cached token unchanged. Deleting the cached token file first mints
  a new one, though the old one stays valid until it expires.
- `remote/deploy.sh` reduces setup to one browser click plus one command. It
  creates the KV namespace and writes its id into the config, stores or generates
  the team passphrase, deploys, pushes the Access token and runs the selftest
  against the live URL. Re-running it skips whatever is already done.

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

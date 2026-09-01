# Updating

You do not have to do anything.

Both servers run out of this clone, and every time one starts it checks for
updates in the background, at most once every 6 hours. New code takes effect the
next time you start a Claude Code session. No pull, no reinstall, no
re-registering, no re-typing tokens.

The check is deliberately cautious:

- It runs after the server has already started, so a slow or unreachable network
  can never delay or block a session.
- It uses `--ff-only`, so it will never create a merge commit.
- It is skipped entirely if you have local edits in the clone, so your changes
  are never clobbered.
- It also refreshes the `/ta3leem-report` command from the repo.

## If you want to update right now

    cd ta3leem-mcp
    git pull

Then restart Claude Code. Only re-run `./install.sh` if your tokens changed or a
release note explicitly says to.

## Which version am I on

    cat VERSION

Compare against `CHANGELOG.md`.

## Do not move the clone

Claude Code is registered against the path of this directory. If you move or
delete it, both servers stop working. Re-run `./install.sh` from the new location
to fix it.

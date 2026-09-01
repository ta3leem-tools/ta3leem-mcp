# Updating

    cd ta3leem-mcp
    git pull
    ./install.sh

`install.sh` is safe to re-run. It replaces the server files and re-registers
both servers with the tokens you type in.

To skip re-typing tokens on an update, keep them in your environment and the
script will still prompt, so paste from your password manager. Tokens are never
stored in this repo.

Check which version you have:

    cat VERSION

Compare against `CHANGELOG.md` after a `git pull` to see what changed.

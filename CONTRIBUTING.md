# Contributing to ta3leem MCP

Sandip Vanodiya owns this repository. Anyone on the team can open issues and
send pull requests. Only Sandip merges into `main`.

That rule exists because of how updates work. The plugin has no version
number, so every commit on `main` is a new version, and Claude Code's
auto-update installs it on every teammate's machine. Installs made with
`install.sh` pull `main` on their own within about 6 hours. Either way a merge
is a release to the whole team, and nobody gets to review it on their machine
first.

## Rules for everyone

1. Don't merge pull requests, yours or anyone else's, even if GitHub shows you
   the merge button.
2. Don't push to `main`. Work on a branch and open a pull request.
3. Keep the servers read-only. A change that lets Claude create, edit, comment,
   approve, merge or mark anything as read in OpenProject or Gitea will be
   closed, however small it is.
4. Never commit or paste a secret. That covers Gitea tokens, OpenProject keys,
   Cloudflare service tokens, `~/.claude.json` and `remote/.dev.vars`. If one
   leaks, revoke it straight away and tell Sandip.
5. Develop in your own fork, never in a folder you installed from. On the
   `install.sh` route, local edits there switch off your automatic updates.
6. Leave `VERSION` and `CHANGELOG.md` alone. Sandip updates both when releasing.

## Opening an issue

Open one for a bug, a wrong or incomplete answer, a failing install, or an idea.
Include:

- what you asked Claude, and what came back
- your version and your OS. For the plugin, `claude plugin list` shows the
  version; for an `install.sh` install, run `cat VERSION` in its folder
- the output of `claude mcp list`
- the exact error text, if there is one

Remove tokens, keys and client data from anything you paste.

## Sending a pull request

1. Fork the repository on GitHub (Fork button, top right). Your role can read
   the repository but not push to it, so pull requests come from your fork.
   Clone your fork into its own folder:

   ```bash
   git clone https://github.com/<your-username>/ta3leem-mcp.git ta3leem-mcp-dev
   cd ta3leem-mcp-dev
   git switch -c fix/short-description
   ```

2. Make one change per pull request. A bug fix and a new feature go in separate
   pull requests.

3. Test the servers you touched, from your development clone, with your own
   tokens:

   ```bash
   GITEA_HOST=https://gitea.ta3leem.dev GITEA_ACCESS_TOKEN=<your token> \
     node selftest.mjs gitea get_me '{}' -- bash ./launch.sh gitea

   OPENPROJECT_URL=https://pm.ta3leem.dev OPENPROJECT_API_KEY=<your key> CF_USE_CLOUDFLARED=1 \
     node selftest.mjs openproject list_projects '{}' -- bash ./launch.sh openproject
   ```

   For a change to `.claude-plugin/`, run `claude plugin validate .`. To try
   the plugin from your folder without touching your real install, run
   `claude --plugin-dir .`. For a change under `remote/`, run
   `npx tsc --noEmit` inside `remote/`. For a shell script, run `bash -n` on it.

4. Push the branch to your fork and open a pull request against `main` of the
   team repository. In the description, say what changed, why, and paste the
   test output.

5. Wait for Sandip's review. Sandip either asks for changes or merges it.

## For the maintainer

### Releasing a change

1. Review the pull request and run the self tests above from a clean clone.
2. Merge it.
3. Bump `VERSION` and add a `CHANGELOG.md` entry that says what changed for
   users.
4. Push to `main`. Plugin users with auto-update on get it after their next
   session start, and `install.sh` users within about 6 hours plus a restart.
5. If anything under `remote/` changed, redeploy the Worker with
   `cd remote && ./deploy.sh`. The Worker does not update itself.

### What an update can and cannot deliver

Plugin users get everything in the repository, including
`.claude-plugin/plugin.json`, so a new server, a changed URL or a new
environment variable reaches them with the update. A new `userConfig` field is
the exception: Claude Code has to ask each person for the value, so say in the
changelog that they need to run `/plugin configure ta3leem@ta3leem-mcp`.

`install.sh` users get the servers, `launch.sh`, the Gitea binary, the tool
allowlist and the skills through `git pull`. Their registration does not
update: the tokens, the URLs and the command Claude Code runs live in their
`~/.claude.json`, which `install.sh` writes. If a release changes any of that,
start its changelog entry with "Action needed: re-run `./install.sh`".

Post either kind of action in the team channel as well.

### Keep `main` fast-forward only

`install.sh` users update with `git pull --ff-only`. If `main` is rewritten by
a force push or a rebase, every such install fails that pull without any
message and stops updating. To undo a bad release, push a revert commit
instead. It reaches everyone, plugin users included, the same way the bad
change did.

### Making the rules stick

GitHub does not enforce the rules above on its own:

- In a private repository owned by a personal account, every collaborator gets
  write access and can merge pull requests. Read-only collaborators are not
  possible there.
- Protected branches in a private repository need GitHub Pro on a personal
  account.

Two ways to enforce them:

1. Move the repository to a free GitHub organization and give teammates the
   Read or Triage role. Both roles can open issues and send pull requests from
   forks, and neither can push or merge. Turn on forking of private
   repositories in the organization settings so they can fork. After the move,
   update the repository name in `GETTING-STARTED.md`, `README.md`, this file
   and `.claude-plugin/plugin.json`. GitHub redirects the old URL. Even so,
   ask `install.sh` users to run `git remote set-url origin <new url>` in their
   install folder so updates do not depend on the redirect.
2. Stay on the personal account with GitHub Pro. Add `.github/CODEOWNERS`
   containing `* @sandiprv9898`, then protect `main` with "Require a pull
   request before merging" and "Require review from Code Owners". A teammate
   can still press merge after you approve, so rule 1 still matters.

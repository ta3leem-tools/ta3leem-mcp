# ta3leem MCP over public HTTPS

The setup in the parent directory serves Claude Code, which runs on your laptop
and can talk to a local process. The hosted Claude clients cannot: claude.ai in
a browser, the iOS and Android apps, and Cowork all connect from Anthropic's
cloud, so they need a server on the public internet. That is what this is.

This is optional and separate. Nothing here changes the Claude Code setup, and
you do not need it unless you want tickets and pull requests on your phone or in
claude.ai.

## What it is

One Cloudflare Worker that is two things at once:

- a read-only MCP server with **20 tools**, 7 for OpenProject and 13 for Gitea
- its own OAuth 2.1 authorization server, so each person signs in as themselves

The 13 Gitea tools are reimplemented here against Gitea's REST API, because the
upstream `gitea-mcp` binary is a Go program and cannot run on Workers. The tool
names match the Claude Code setup exactly, so a prompt that works in one works
in the other.

## How the identity works, and why it is built this way

The obvious shortcut is to put one OpenProject key in the Worker and let
everyone share it. That is rejected here: every action would be logged as one
person, everyone would see everything that person can see, and the key would
outlive whoever owned it.

Instead, when you connect, the Worker shows you a consent screen and asks for
**your own** OpenProject key and Gitea token. Those are stored in the OAuth
grant, which the provider encrypts with key material wrapped by your access
token. So they are only decryptable while you hold a live token, they are never
readable by another user, and every upstream request is attributed to the real
human.

The Worker's own secrets hold one thing only: a Cloudflare Access service token,
which gets past the Access edge sitting in front of both `pm.ta3leem.dev` and
`gitea.ta3leem.dev`. That is reachability, not identity. What you can see is
still decided by your own API key.

A consent screen on a public URL would otherwise let any stranger who finds the
URL start enrolling, so it is gated by a shared team passphrase before it will
even check your credentials.

## Requirements

| Need | Notes |
|---|---|
| Cloudflare account | A free one of your own, for hosting the Worker. Separate from whoever administers `ta3leem.dev`. |
| Node 22+ and `npx` | wrangler refuses to start on anything older. Check with `node -v`. |
| A way past Cloudflare Access, for OpenProject only | Two options, below. |

Your Worker needs no inbound firewall work. Workers are public by default and
the traffic to the upstreams is outbound. Anthropic reaches your Worker from
`160.79.104.0/21` if you ever do want to restrict it.

### Gitea needs nothing extra

`gitea.ta3leem.dev` is not a Cloudflare Access application and is reachable from
the public internet. Its bare API returns
`{"message":"Only signed in user is allowed to call APIs."}`, which is Gitea's
own response, not Cloudflare's. Each person's own Gitea token, collected at the
consent screen, is all it takes. All 13 Gitea tools work with zero setup.

### OpenProject needs one of two things

`pm.ta3leem.dev` does sit behind Cloudflare Access, so the Worker has to get
past it. Pick whichever you can actually do.

**Option A, a service token.** Lasts a year, then forget about it. Needs admin
on the Cloudflare account that owns the Access application, so this is usually a
one-time ask to whoever runs `ta3leem.dev`:

- Zero Trust, Access controls, Service credentials, Service Tokens, Create
- Duration `8760` hours is one year
- On the `pm.ta3leem.dev` application, add a policy whose action is **Service
  Auth** with that token as the selector. Skip this and Cloudflare ignores the
  token and still demands a browser login.
- Then set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as Worker secrets.

**Option B, a daily session token.** No admin needed, but someone has to run one
command a day. `cloudflared access token` mints a 24h Access JWT on your laptop
and `refresh-access-token.sh` pushes it into the Worker:

```bash
cd remote
cloudflared access login https://pm.ta3leem.dev   # once, opens a browser
./refresh-access-token.sh                          # daily
```

Re-running the login does not rotate anything while the session is still valid:
`cloudflared` hands back the identical cached JWT. To force a new one, delete the
cache first. Note that this mints a new token but does not invalidate the old
one, which stays valid until it expires. Only an Access administrator can revoke
an issued session server side.

```bash
rm ~/.cloudflared/pm.ta3leem.dev-*-token
cloudflared access login https://pm.ta3leem.dev
```

Cron it if you want it to stop being a chore:

```
30 9 * * * cd /path/to/ta3leem-mcp/remote && ./refresh-access-token.sh >> /tmp/ta3leem-token.log 2>&1
```

The Worker prefers a service token whenever both are present, so moving from B
to A later means setting the two secrets and deleting the cron job. Nothing else
changes.

When the token lapses, OpenProject tools start failing and Gitea keeps working,
which is a useful signal about which half broke.

## Deploy

One browser click, then one command.

```bash
cd remote
npx wrangler login     # opens a browser, click Allow. Creates a free account if you have none.
./deploy.sh
```

`deploy.sh` prints the passphrase once at the end. To change it later, or to read
back one that was rotated:

```bash
cd remote
cat .passphrase                                  # mode 600, gitignored
npx wrangler secret put ENROLL_PASSPHRASE        # set a new one
```

`deploy.sh` does the rest: installs dependencies, creates the `OAUTH_KV`
namespace and writes its id into `wrangler.jsonc`, stores the team passphrase
(generating one if you just press Enter), deploys, pushes the Access token, then
runs the full selftest against the live URL. It prints your connector URL and
the passphrase at the end. Safe to re-run, it skips whatever is already done.

`wrangler login` is the one step that cannot be scripted. On a headless machine,
create an API token instead and `export CLOUDFLARE_API_TOKEN=...` before running
`deploy.sh`.

<details>
<summary>The same thing by hand</summary>

All of these run from inside `remote/`. wrangler reads `wrangler.jsonc` from the
working directory, so from anywhere else it fails with "Required Worker name
missing".

```bash
cd remote
npm install
npx wrangler kv namespace create OAUTH_KV   # paste the id into wrangler.jsonc

# The team passphrase gating the consent screen. Invent one:
#   openssl rand -base64 24
npx wrangler secret put ENROLL_PASSPHRASE

# Option A only, if you have a service token:
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET

npx wrangler deploy
./refresh-access-token.sh    # Option B only
```

</details>

## Verify before you hand the URL out

```bash
BASE=https://ta3leem-mcp.<your-subdomain>.workers.dev node selftest-remote.mjs
```

That checks the three things Claude needs before it will connect at all: both
discovery documents, and that an unauthenticated call returns `401` with a
`WWW-Authenticate` header pointing at the resource metadata.

To also drive the whole flow end to end, including real tool calls, add your own
credentials:

```bash
BASE=https://... ENROLL_PASSPHRASE=... \
OPENPROJECT_API_KEY=... GITEA_TOKEN=... node selftest-remote.mjs
```

That registers a client, runs an authorization request with PKCE, posts the
consent form, exchanges the code, then calls `list_projects` against OpenProject
and `get_me` against Gitea. It also checks the negative paths: a wrong
passphrase, a bad `code_verifier`, and an unknown tool name.

## Connect from Claude

1. In claude.ai, go to **Customize**, then **Connectors**, then **Add custom
   connector**. On Team or Enterprise this lives under **Organization settings**.
2. URL: your Worker URL with `/mcp` on the end.
3. Leave the OAuth client fields blank. Claude identifies itself on its own.
4. Click through, and the Worker's consent screen asks for the team passphrase
   and your two tokens. Both are checked against the live APIs before anything
   is stored, so a wrong key fails immediately with a real message rather than
   enrolling a broken connection.

The same connector then works in the mobile apps and Cowork, since they share
one account.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in, it is gitignored
npx wrangler dev
BASE=http://localhost:8787 node selftest-remote.mjs
```

## Read-only, by construction

Every one of the six outbound HTTP calls in this Worker is an explicit
`method: "GET"`, and no code path issues POST, PUT, PATCH or DELETE. Nothing can
create, edit, comment, merge, approve, close, or mark anything read. It is not a
setting that could be flipped, the code does not exist. Check it yourself:

```bash
grep -rniE 'method:\s*"(post|put|patch|delete)"' src/    # returns nothing
grep -rc 'method: "GET"' src/*.ts
```

## Troubleshooting

**Three FAILs immediately after the first deploy.** A brand new
`*.workers.dev` subdomain does not have its certificate yet, and TLS fails with
`ssl3_read_bytes: sslv3 alert handshake failure` (SSL alert 40) for a minute or
two. It looks exactly like a broken deployment. Wait, then re-run:

```bash
cd remote
BASE=https://<your-worker>.workers.dev node selftest-remote.mjs
```

**"Required Worker name missing".** You are not in `remote/`. Every wrangler
command reads `wrangler.jsonc` from the working directory.

**"Wrangler requires at least Node.js v22".** A system Node older than 22 is
shadowing a newer one. `nvm use --lts`, then retry. Under cron this happens
silently, which is why `refresh-access-token.sh` checks the version itself and
falls back to the newest nvm install.

**OpenProject tools fail and Gitea tools still work.** The Access token lapsed.
Run `./refresh-access-token.sh`.

## Known limits

- **Large PR diffs come back partial.** Gitea truncates without warning:
  measured at 65 files out of 299. Every list-shaped Gitea tool takes explicit
  `page` and `limit` and reports whether more remains, so ask Claude to keep
  paging on a big review.
- **Review discussion lives in the issue comments,** not in the reviews
  endpoint, which returns near-empty scaffolding on this Gitea instance.
- **Attachments are capped at 4 MB** and come back inline as base64. A Worker
  has no local disk, so unlike the Claude Code setup there is no file path to
  hand back. Above the cap, open the `downloadUrl` instead.
- **Sessions are stateless.** No SSE stream and no session id, which is all the
  hosted Claude clients need and what keeps this on the free plan.
- **On Option B, OpenProject goes quiet once a day** until the token is
  refreshed. Gitea is unaffected, so a half-working server means the token
  lapsed, not that the Worker broke.
- **Authentication settings cannot be edited after a connector is added.** To
  change them, remove the connector and add it again.

## What is in here

| File | Purpose |
|---|---|
| `src/index.ts` | OAuth provider wiring, consent screen, credential verification |
| `src/mcp.ts` | Stateless Streamable HTTP transport, JSON-RPC 2.0 |
| `src/openproject.ts` | 7 OpenProject tools, ported from the stdio server |
| `src/gitea.ts` | 13 Gitea tools, against Gitea REST v1 |
| `src/types.ts` | The `Tool` and `ToolCtx` contract shared by both tool modules |
| `selftest-remote.mjs` | End-to-end check, including the full OAuth dance |
| `deploy.sh` | One-shot setup. Everything except the browser login |
| `refresh-access-token.sh` | Option B only. Pushes a fresh 24h Access token into the Worker |
| `wrangler.jsonc` | Worker config. Holds no secrets. |

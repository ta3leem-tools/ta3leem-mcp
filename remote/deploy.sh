#!/usr/bin/env bash
#
# One-shot setup for the remote MCP Worker.
#
# Does everything except the one step that needs a browser. Run:
#
#   npx wrangler login     <- you, once. Click Allow.
#   ./deploy.sh            <- this
#
# Safe to re-run. It skips whatever is already done.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

CONFIG="wrangler.jsonc"
PLACEHOLDER="REPLACE_WITH_KV_NAMESPACE_ID"

step() { printf '\n== %s\n' "$1"; }
die() { printf '\n%s\n' "$1"; exit 1; }

# --- 1. prerequisites -------------------------------------------------------

step "Checking prerequisites"
for c in node npx cloudflared; do
  if command -v "$c" >/dev/null 2>&1; then
    echo "  ok    $c"
  else
    die "MISSING: $c. Install it, then re-run."
  fi
done

# wrangler needs node 22+. A system node that is too old fails much later with a
# confusing message, so catch it here.
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 22 ]; then
  die "wrangler needs Node 22 or newer. Found $(node -v 2>/dev/null || echo none).

If you use nvm, switch first:
    nvm use --lts"
fi
echo "  ok    node $(node -v)"

if [ ! -d node_modules ]; then
  echo "  installing dependencies"
  npm install --silent || die "npm install failed."
fi

# `wrangler whoami` exits 0 even when nobody is logged in, so its exit code
# proves nothing. Read what it actually says.
whoami_out="$(npx wrangler whoami 2>&1)"
account="$(printf '%s' "$whoami_out" | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | head -1)"
if printf '%s' "$whoami_out" | grep -qi "not authenticated" || [ -z "$account" ]; then
  die "Not logged in to Cloudflare.

Run this first, click Allow in the browser it opens, then re-run ./deploy.sh:

    npx wrangler login

If you have no Cloudflare account yet, that page lets you create a free one.

On a machine with no browser, create an API token instead and export it:
    https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
    export CLOUDFLARE_API_TOKEN=..."
fi
echo "  ok    logged in as $account"

# --- 2. KV namespace for OAuth grants ---------------------------------------

step "KV namespace for OAuth grants"
if grep -q "$PLACEHOLDER" "$CONFIG"; then
  echo "  creating OAUTH_KV"
  out="$(npx wrangler kv namespace create OAUTH_KV 2>&1)"
  # Wrangler's output format has changed across versions, so pull the first
  # 32-hex id out of whatever shape it printed rather than parsing a layout.
  kv_id="$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)"
  if [ -z "$kv_id" ]; then
    printf '%s\n' "$out"
    die "Could not read the namespace id from that output. Paste it into $CONFIG by hand, replacing $PLACEHOLDER."
  fi
  cp "$CONFIG" "$CONFIG.bak"
  sed -i "s/$PLACEHOLDER/$kv_id/" "$CONFIG"
  echo "  ok    created and written to $CONFIG ($kv_id)"
else
  echo "  ok    already configured"
fi

# --- 3. deploy --------------------------------------------------------------

step "Deploying"
out="$(npx wrangler deploy 2>&1)"
printf '%s\n' "$out" | tail -6
url="$(printf '%s' "$out" | grep -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)"
if [ -z "$url" ]; then
  die "Deploy did not report a URL. Full output is above."
fi
echo "  ok    $url"

# --- 4. the team passphrase -------------------------------------------------

step "Team passphrase"
  # Set after deploying, not before: secret put needs the Worker to exist.
  # Until this lands the Worker refuses every enrolment, so the gap is safe.
echo "  This gates the consent screen, so a stranger who finds the URL cannot enrol."
read -r -p "  Enter one, or press Enter to generate: " pass
pass="$(printf '%s' "$pass" | tr -d '\r\n\t')"
generated=0
if [ -z "$pass" ]; then
  pass="$(openssl rand -base64 24 2>/dev/null | tr -d '\r\n')"
  [ -z "$pass" ] && die "Could not generate a passphrase. Re-run and type one in."
  generated=1
fi
if printf '%s' "$pass" | npx wrangler secret put ENROLL_PASSPHRASE >/dev/null 2>&1; then
  echo "  ok    stored as a Worker secret"
else
  echo "  Could not store it non-interactively. Run this yourself and re-run deploy.sh:"
  echo "    npx wrangler secret put ENROLL_PASSPHRASE"
  die "Stopped: the Worker refuses all enrolment until that secret exists."
fi

# --- 5. Cloudflare Access token for OpenProject ------------------------------

step "Cloudflare Access token for OpenProject"
if npx wrangler secret list 2>/dev/null | grep -q CF_ACCESS_CLIENT_ID; then
  echo "  ok    a service token is already set, nothing to refresh daily"
else
  if ./refresh-access-token.sh; then
    echo "  Remember: that token lasts 24h. Cron it:"
    echo "    30 9 * * * cd $HERE && ./refresh-access-token.sh >> /tmp/ta3leem-token.log 2>&1"
  else
    echo "  OpenProject tools will fail until this succeeds. Gitea still works."
  fi
fi

# --- 6. prove it works ------------------------------------------------------

step "Verifying the deployed Worker"
BASE="$url" node selftest-remote.mjs
rc=$?

# --- done -------------------------------------------------------------------

printf '\n== Done\n'
echo "  Connector URL for Claude:  $url/mcp"
if [ "$generated" = "1" ]; then
  echo "  Team passphrase:           $pass"
  echo "  (Shown once. Save it and share it with the team.)"
fi
echo
echo "  In claude.ai: Customize, Connectors, Add custom connector."
echo "  Paste the URL above. Leave the OAuth client fields blank."
echo "  Claude then shows the consent screen, which asks for the passphrase"
echo "  plus your own OpenProject and Gitea tokens."
exit $rc

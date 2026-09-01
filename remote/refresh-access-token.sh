#!/usr/bin/env bash
#
# Push a fresh Cloudflare Access session token into the Worker.
#
# Only needed when you do NOT have a service token. Access session tokens last
# 24h, so this has to run once a day or the Worker stops being able to reach the
# upstreams and claude.ai goes quiet.
#
# If someone with Cloudflare admin gives you a service token instead, set
# CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET once and delete this cron job:
# the Worker prefers the service token and ignores these.
#
#   ./refresh-access-token.sh
#
# Suggested cron, every morning at 09:30:
#   30 9 * * * cd /path/to/ta3leem-mcp/remote && ./refresh-access-token.sh >> /tmp/ta3leem-token.log 2>&1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

OP_URL="https://pm.ta3leem.dev"

# Gitea is deliberately absent. gitea.ta3leem.dev is NOT a Cloudflare Access
# application (cloudflared reports "failed to find Access application"), it is
# publicly reachable and returns its own 403 with
# {"message":"Only signed in user is allowed to call APIs."} until you send a
# Gitea token. Each user's own token covers that, so there is nothing to refresh.

# cron runs with a minimal PATH where /usr/bin/node shadows nvm. That system
# node is too old for wrangler (it needs 22+), so testing "is npx present" is
# the wrong question: it is present and it fails. Test the version instead.
WRANGLER_MIN_NODE=22

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

if [ "$(node_major)" -lt "$WRANGLER_MIN_NODE" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi

if [ "$(node_major)" -lt "$WRANGLER_MIN_NODE" ]; then
  # Newest nvm install, sorted by version rather than ASCII so v9 does not beat v24.
  newest="$(ls -1d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  if [ -n "$newest" ] && [ -x "$newest/node" ]; then
    PATH="$newest:$PATH"
    export PATH
  fi
fi

if [ "$(node_major)" -lt "$WRANGLER_MIN_NODE" ]; then
  echo "Node $WRANGLER_MIN_NODE+ is required by wrangler. Found: $(node -v 2>/dev/null || echo none)"
  echo "Install it, or point PATH at an nvm version, then re-run."
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "MISSING: cloudflared. Install it, then re-run."
  exit 1
fi

# Prints the remaining lifetime of a JWT, or nothing if it cannot be read.
jwt_expiry() {
  python3 - "$1" <<'PY' 2>/dev/null
import base64, json, sys, time
parts = sys.argv[1].split(".")
if len(parts) < 2:
    sys.exit(1)
p = parts[1] + "=" * (-len(parts[1]) % 4)
exp = json.loads(base64.urlsafe_b64decode(p)).get("exp")
if not exp:
    sys.exit(1)
left = exp - int(time.time())
print("expired" if left <= 0 else f"{left // 3600}h {(left % 3600) // 60}m left")
PY
}

pushed=0
failed=0

# $1 = app url, $2 = worker secret name
push_token() {
  local url="$1" secret="$2" token life

  printf '%s ... ' "$secret"
  token="$(cloudflared access token --app="$url" 2>/dev/null | tr -d '\r\n \t')"

  if [ -z "$token" ] || [ "${#token}" -lt 40 ]; then
    echo "FAILED"
    echo "    No Access session for $url."
    echo "    Run: cloudflared access login $url"
    failed=$((failed + 1))
    return 1
  fi

  life="$(jwt_expiry "$token")"
  if [ "$life" = "expired" ]; then
    echo "FAILED (token already expired)"
    echo "    Run: cloudflared access login $url"
    failed=$((failed + 1))
    return 1
  fi

  if printf '%s' "$token" | npx wrangler secret put "$secret" >/dev/null 2>&1; then
    echo "OK (${life:-lifetime unknown})"
    pushed=$((pushed + 1))
    return 0
  fi

  echo "FAILED to write the Worker secret"
  echo "    Check you are logged in: npx wrangler whoami"
  failed=$((failed + 1))
  return 1
}

echo "Refreshing the Cloudflare Access token for the Worker"
push_token "$OP_URL" CF_ACCESS_TOKEN_OPENPROJECT

echo
if [ "$failed" -gt 0 ]; then
  echo "Failed. The Worker keeps its previous token until this succeeds, and OpenProject"
  echo "stops answering once that one expires. Gitea is unaffected."
  exit 1
fi
echo "Updated. Good for about 24 hours. Gitea needs no token and keeps working."

#!/usr/bin/env bash
# SessionStart hook: warn when the Cloudflare Access login for OpenProject is missing or near expiry.

OP_URL="${TA3LEEM_OP_URL:-https://pm.ta3leem.dev}"
WARN_SECONDS=7200
FIX="Run: cloudflared access login $OP_URL"

emit() {
  local msg
  msg=$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  printf '{"systemMessage":"%s"}\n' "$msg"
  exit 0
}

if ! command -v cloudflared >/dev/null 2>&1; then
  emit "ta3leem: cloudflared is not installed, so OpenProject cannot be reached. Install cloudflared, then run: cloudflared access login $OP_URL"
fi

if command -v timeout >/dev/null 2>&1; then
  token=$(timeout 8 cloudflared access token --app="$OP_URL" 2>/dev/null)
else
  token=$(cloudflared access token --app="$OP_URL" 2>/dev/null)
fi
rc=$?

if [ "$rc" -ne 0 ] || [ -z "$token" ]; then
  emit "ta3leem: OpenProject login has expired or you are not logged in. $FIX"
fi

# Token goes through stdin so it never appears in argv or output.
exp=$(printf '%s' "$token" | node -e '
let s = "";
process.stdin.on("data", d => { s += d; });
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(Buffer.from(s.trim().split(".")[1], "base64url").toString("utf8"));
    if (Number.isFinite(p.exp)) process.stdout.write(String(Math.floor(p.exp)));
  } catch (e) {}
});
' 2>/dev/null)

case "$exp" in
  ''|*[!0-9]*) emit "ta3leem: OpenProject login has expired or you are not logged in. $FIX" ;;
esac

left=$(( exp - $(date +%s) ))

if [ "$left" -le 0 ]; then
  emit "ta3leem: OpenProject login has expired. $FIX"
elif [ "$left" -lt 3600 ]; then
  emit "ta3leem: OpenProject login expires in $(( left / 60 )) min. $FIX"
elif [ "$left" -lt "$WARN_SECONDS" ]; then
  emit "ta3leem: OpenProject login expires in $(( left / 3600 )) h. $FIX"
fi

exit 0

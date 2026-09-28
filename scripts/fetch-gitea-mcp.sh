#!/usr/bin/env bash
# Downloads the upstream gitea-mcp build for this machine into DEST_DIR,
# verifies it against the release checksums, and prints the binary's path.
# The file name carries the version, so bumping GITEA_MCP_VERSION fetches the
# new build instead of reusing a stale one. An existing binary is reused.
# The committed binary covers linux x86-64, so there the script does nothing.
# Only the path goes to stdout; launch.sh captures it, and every message goes
# to stderr so an MCP stdio server's stdout stays clean.
#
# Usage: fetch-gitea-mcp.sh DEST_DIR

set -e
DEST="$1"
GITEA_MCP_VERSION="1.3.0"
[ -n "$DEST" ] || { echo "Usage: fetch-gitea-mcp.sh DEST_DIR" >&2; exit 64; }

PLATFORM="$(uname -s)_$(uname -m)"
case "$PLATFORM" in
  Linux_x86_64) exit 0 ;;
  Linux_aarch64) PLATFORM="Linux_arm64" ;;
  Darwin_arm64|Darwin_x86_64|Linux_arm64) ;;
  *)
    echo "Unsupported platform: $PLATFORM. Supported: Linux or macOS, x86-64 or ARM." >&2
    exit 1
    ;;
esac

BIN="$DEST/gitea-mcp-$GITEA_MCP_VERSION"
if [ -x "$BIN" ]; then
  echo "$BIN"
  exit 0
fi

for c in curl tar; do
  command -v "$c" >/dev/null || { echo "MISSING: $c (needed to fetch gitea-mcp for $PLATFORM)" >&2; exit 1; }
done
if command -v sha256sum >/dev/null; then SHA="sha256sum"; else SHA="shasum -a 256"; fi

echo "Fetching gitea-mcp v$GITEA_MCP_VERSION for $PLATFORM..." >&2
REL="https://gitea.com/gitea/gitea-mcp/releases/download/v$GITEA_MCP_VERSION"
TGZ="gitea-mcp_$PLATFORM.tar.gz"
# Temp dir inside DEST keeps the final mv a same-filesystem rename, which is
# atomic, so a concurrent start never sees a half-copied binary.
mkdir -p "$DEST"
TMP="$(mktemp -d "$DEST/.fetch.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if ! curl -fsSL --max-time 120 -o "$TMP/$TGZ" "$REL/$TGZ" \
  || ! curl -fsSL --max-time 30 -o "$TMP/sums.txt" "$REL/gitea-mcp_${GITEA_MCP_VERSION}_checksums.txt"; then
  echo "Download from gitea.com failed. Check your network, then retry." >&2
  exit 1
fi
want="$(grep " $TGZ\$" "$TMP/sums.txt" | awk '{print $1}')"
got="$(cd "$TMP" && $SHA "$TGZ" | awk '{print $1}')"
if [ -z "$want" ] || [ "$want" != "$got" ]; then
  echo "Checksum mismatch for $TGZ. Nothing was installed." >&2
  exit 1
fi

tar -xzf "$TMP/$TGZ" -C "$TMP" gitea-mcp
chmod +x "$TMP/gitea-mcp"
# Gatekeeper quarantines downloads; an unsigned binary would be killed on launch.
if [ "$(uname -s)" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$TMP/gitea-mcp" 2>/dev/null || true
fi
mv "$TMP/gitea-mcp" "$BIN"
echo "Installed $BIN" >&2
echo "$BIN"

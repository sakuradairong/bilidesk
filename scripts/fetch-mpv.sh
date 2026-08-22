#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/vendor/mpv"
REPO="zhongfly/mpv-winbuild"
TAG="${MPV_RELEASE:-latest}"

mkdir -p "$DEST"
if [[ -f "$DEST/libmpv-2.dll" && "${MPV_FORCE:-}" != "1" ]]; then
  echo "already have $DEST/libmpv-2.dll"
  exit 0
fi

if [[ "$TAG" == "latest" ]]; then
  API="https://api.github.com/repos/${REPO}/releases/latest"
else
  API="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
fi

echo "resolving $API"
ASSET_URL="$(curl -fsSL "$API" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for asset in data.get("assets", []):
    name = asset.get("name", "")
    if "mpv-dev-lgpl-x86_64-" in name and "-v3-" not in name and name.endswith(".7z"):
        print(asset["browser_download_url"])
        break
else:
    sys.exit("mpv-dev-lgpl-x86_64 asset not found")
')"

ARCHIVE="$(mktemp -d)/mpv-dev.7z"
echo "downloading $ASSET_URL"
curl -fsSL -o "$ARCHIVE" "$ASSET_URL"

if command -v 7z >/dev/null 2>&1; then
  7z e -y -o"$DEST" "$ARCHIVE" libmpv-2.dll >/dev/null
elif command -v 7zz >/dev/null 2>&1; then
  7zz e -y -o"$DEST" "$ARCHIVE" libmpv-2.dll >/dev/null
else
  echo "need 7z or 7zz to extract libmpv-2.dll" >&2
  exit 1
fi

rm -f "$ARCHIVE"
ls -lh "$DEST/libmpv-2.dll"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/vendor/mpv"
REPO="zhongfly/mpv-winbuild"
DEFAULT_TAG="2026-08-21-49418246f3"
DEFAULT_ASSET="mpv-dev-lgpl-x86_64-20260821-git-49418246f3.7z"
DEFAULT_SHA256="317dfd9ee814be76e5f6e20b45efcc07440389a62b55dd85201829b4880510e0"

if [[ -n "${MPV_RELEASE:-}${MPV_ASSET:-}${MPV_SHA256:-}" ]]; then
  : "${MPV_RELEASE:?set MPV_RELEASE, MPV_ASSET and MPV_SHA256 together}"
  : "${MPV_ASSET:?set MPV_RELEASE, MPV_ASSET and MPV_SHA256 together}"
  : "${MPV_SHA256:?set MPV_RELEASE, MPV_ASSET and MPV_SHA256 together}"
  TAG="$MPV_RELEASE"
  ASSET="$MPV_ASSET"
  EXPECTED_SHA256="${MPV_SHA256,,}"
else
  TAG="$DEFAULT_TAG"
  ASSET="$DEFAULT_ASSET"
  EXPECTED_SHA256="$DEFAULT_SHA256"
fi

mkdir -p "$DEST"
if [[ -f "$DEST/libmpv-2.dll" && "${MPV_FORCE:-}" != "1" ]]; then
  echo "already have $DEST/libmpv-2.dll"
  exit 0
fi

ASSET_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
ARCHIVE="$(mktemp -d)/mpv-dev.7z"
echo "downloading pinned asset $ASSET_URL"
curl -fsSL -o "$ARCHIVE" "$ASSET_URL"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{print tolower($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print tolower($1)}')"
else
  echo "need sha256sum or shasum to verify libmpv" >&2
  exit 1
fi

if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "libmpv checksum mismatch" >&2
  echo "expected: $EXPECTED_SHA256" >&2
  echo "actual:   $ACTUAL_SHA256" >&2
  exit 1
fi
echo "verified sha256:$ACTUAL_SHA256"

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

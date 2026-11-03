#!/bin/sh
# Downloads the in-browser C compiler used by the C Block (clang on WebAssembly, ~28 MB compressed)
# into vendor/clang/, which is git-ignored: the binaries never enter the repository's history.
# The npm tarball is pinned by version and checked against its sha512 before anything is unpacked;
# the compiler's own assets are checked again in the browser against the hashes the package ships.
#
#   scripts/fetch-compiler.sh      (needs npm and node; does nothing if vendor/clang is current)
set -eu

VERSION=0.3.0
INTEGRITY='sha512-huXYRvmE1hwZfykw71W9/5N0Yz0yFhOPreg5cZaWGp29IY+v4w04vXUpXPPJxUftnNF41DzPG4LgoWGFeSxV9g=='

cd "$(dirname "$0")/.."
DEST=vendor/clang

if [ -f "$DEST/.version" ] && [ "$(cat "$DEST/.version")" = "$VERSION" ]; then
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading @live-codes/clang-wasm@$VERSION ..."
npm pack "@live-codes/clang-wasm@$VERSION" --pack-destination "$tmp" --silent >/dev/null
tarball="$tmp/live-codes-clang-wasm-$VERSION.tgz"

actual="sha512-$(node -e "process.stdout.write(require('crypto').createHash('sha512').update(require('fs').readFileSync(process.argv[1])).digest('base64'))" "$tarball")"
if [ "$actual" != "$INTEGRITY" ]; then
  echo "Integrity check failed for @live-codes/clang-wasm@$VERSION" >&2
  echo "  expected $INTEGRITY" >&2
  echo "  got      $actual" >&2
  exit 1
fi

tar -xzf "$tarball" -C "$tmp"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$tmp/package/dist/clang-wasm-toolchain.global.js" "$DEST/toolchain.global.js"
cp -r "$tmp/package/assets" "$DEST/assets"
cp "$tmp/package/LICENSE" "$tmp/package/THIRD-PARTY-NOTICES.md" "$DEST/"
echo "$VERSION" > "$DEST/.version"
echo "C compiler ready in $DEST ($(du -sh "$DEST" | cut -f1))"

#!/bin/sh
# Builds the deployable release archive: compiled API binary, web assets, Caddyfile and updater.
# Usage: sh scripts/build-release.sh <output-directory>   (OFFICE_TARGET defaults to Alpine x86-64)
set -eu

[ $# -eq 1 ] || { printf 'Usage: sh scripts/build-release.sh <output-directory>\n' >&2; exit 2; }
TARGET=${OFFICE_TARGET:-bun-linux-x64-musl}
mkdir -p "$1"
OUT=$(cd "$1" && pwd)
STAGE=$OUT/release
rm -rf "$STAGE" "$OUT/office-service.tar.gz" "$OUT/office-service.tar.gz.sha256"
mkdir -p "$STAGE"

pnpm --filter @office-service/web build
(cd apps/api && bun build --compile --target="$TARGET" main.ts --asset migrations --outfile "$STAGE/office-api")
cp -R apps/web/dist "$STAGE/web"
cp Caddyfile scripts/update-alpine.sh "$STAGE/"
tar -czf "$OUT/office-service.tar.gz" -C "$STAGE" .
(cd "$OUT" && sha256sum office-service.tar.gz > office-service.tar.gz.sha256)

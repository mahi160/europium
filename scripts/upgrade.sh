#!/bin/sh
set +x
set -eu
. ./scripts/operations.sh
begin
[ "$#" -eq 2 ] || fail 'Usage: sh scripts/upgrade.sh API_GHCR_SHA256_REFERENCE WEB_GHCR_SHA256_REFERENCE. Backups must be configured first.'
configure_backup
cp .env "$work/.env"
helper images "$1" "$2" || fail 'Use two reviewed matching-release ghcr.io image references pinned by sha256 digest; existing configuration retained.'
confirm 'Stop the API, verify an encrypted off-server backup, then pull and migrate to these reviewed images? Migration failure leaves the API stopped; no image downgrade reverses a migration.'
compose stop api >/dev/null 2>&1 || fail 'API stop failed; no images changed. Investigate privately and retry.'
stopped=1
backup_run
APP_IMAGE=$1 WEB_IMAGE=$2 docker compose --env-file .env -f compose.yaml -p office-service pull >/dev/null 2>&1 \
  || fail 'Image pull failed after verified backup. Old configuration/data retained; API remains stopped. Retry upgrade or restart the unchanged old API.'
image=$1
volume_mode=
helper migrate || fail 'Migration failed. API remains stopped and original volumes were not deleted. Preserve them and restore the verified backup on a clean replacement; see docs/backups.md. Do not downgrade images against a migrated database.'
mv "$work/next.env" .env || fail 'Configuration replacement failed after migration. API remains stopped; preserve volumes and use the reviewed new images or clean-replacement recovery in docs/backups.md.'
chmod 600 .env
compose up -d --no-build --pull never >/dev/null 2>&1 || fail 'Startup failed after migration; preserve all volumes and .env. Retry startup with the new images or restore the verified backup onto a clean replacement.'
attempt=0
until compose exec -T api node -e 'fetch("http://127.0.0.1:3000/api/setup").then(r => { if (!r.ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; });' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || fail 'New API did not become ready. Keep new images/data; retry startup/readiness privately. Do not image-downgrade. See docs/backups.md.'
  sleep 1
done
printf '%s\n' 'Upgrade completed; API readiness confirmed. Check trusted HTTPS and workflows from an office device.'

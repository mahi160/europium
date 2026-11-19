#!/bin/sh
set +x
set -eu
. ./scripts/operations.sh
begin
[ "$#" -eq 3 ] || fail 'Usage: sh scripts/restore.sh /absolute/backup.office /absolute/passfile LOCALLY_CACHED_ORIGINAL_API_IMAGE. Restore is only for a clean replacement host.'
backup=$1
passfile=$2
image=$3
case "$backup:$passfile" in *','*) fail 'Backup and passfile paths cannot contain commas.' ;; esac
case "$backup" in /*) ;; *) fail 'Supply an explicit absolute backup path.' ;; esac
case "$passfile" in /*) ;; *) fail 'Supply an explicit absolute passfile path.' ;; esac
[ -f "$backup" ] && [ ! -L "$backup" ] && [ -f "$passfile" ] && [ ! -L "$passfile" ] || fail 'Backup and passfile must be existing regular files, not symlinks.'
[ ! -e .env ] && [ ! -L .env ] || fail 'Restore refuses existing configuration. Use a clean replacement host; nothing was replaced.'
for volume in office-service_app-data office-service_caddy-data office-service_caddy-config; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    fail 'Restore refuses existing volumes, even empty ones. Use a clean replacement Docker context/host. No original volume was deleted.'
  fi
done
for container in office-service-api-1 office-service-caddy-1; do
  if docker container inspect "$container" >/dev/null 2>&1; then
    fail 'Restore refuses existing installation containers; use a clean replacement host.'
  fi
done
confirm 'Authenticate this explicit encrypted backup and restore secrets and private CA keys onto this clean replacement? Keep the original host offline; no existing installation will be deleted and services will not start automatically.'
work=$(mktemp -d "$PWD/.office-ops.XXXXXXXX") || fail 'Could not create private staging.'
cp "$backup" "$work/backup.office"
helper unbundle || fail 'Restore authentication/archive/integrity validation failed. No installation volumes changed. Check backup, passfile and matching source/image.'
volume_mode=
helper restore || fail 'Restore copy failed. Original host/backup untouched; partial replacement volumes retained. Do not start them; use another clean replacement and investigate.'
ln "$work/restored/.env" .env || fail 'Could not install restored configuration. Do not start partial replacement; preserve backup and original host.'
chmod 600 .env
printf '%s\n' 'Restore completed without startup. Original secrets, database and CA were restored. Follow docs/backups.md: use original images, start without builds/pulls, verify login/orders/root fingerprint before moving the LAN address.'

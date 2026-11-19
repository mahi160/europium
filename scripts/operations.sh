#!/bin/sh
set +x
set -eu
umask 077

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

confirm() {
  printf '%s Type yes to continue: ' "$1"
  IFS= read -r answer || fail 'No confirmation received.'
  [ "$answer" = yes ] || fail 'Cancelled.'
}

value() {
  awk -v key="$2" 'index($0, key "=") == 1 { count++; value = substr($0, length(key) + 2) }
    END { if (count != 1 || value == "") exit 1; print value }' "$1"
}

compose() {
  docker compose --env-file .env -f compose.yaml -p office-service "$@"
}

helper() {
  volumes=
  case "$1" in
    snapshot|bundle|restore|migrate)
      volumes="--mount type=volume,src=office-service_app-data,dst=/data$volume_mode --mount type=volume,src=office-service_caddy-data,dst=/caddy-data$volume_mode --mount type=volume,src=office-service_caddy-config,dst=/caddy-config$volume_mode"
      ;;
  esac
  docker run --rm --pull never --network none --read-only --user 0:0 \
    --tmpfs /tmp:rw,nosuid,nodev \
    --mount "type=bind,src=$PWD/apps/api/src,dst=/app/apps/api/src,readonly" \
    --mount "type=bind,src=$PWD/apps/api/migrations,dst=/app/apps/api/migrations,readonly" \
    --mount "type=bind,src=$work,dst=/work" \
    --mount "type=bind,src=$passfile,dst=/pass,readonly" \
    $volumes \
    --entrypoint node "$image" node_modules/tsx/dist/cli.mjs apps/api/src/operations-cli.ts "$@" 2>/dev/null
}

cleanup() {
  result=$?
  trap - 0
  if [ -n "${work:-}" ]; then
    helper cleanup >/dev/null || printf '%s\n' 'Private staging cleanup failed. Securely remove only the .office-ops.* staging directory after investigating.' >&2
    rmdir "$work" 2>/dev/null || :
  fi
  rmdir .office-install.lock
  exit "$result"
}

begin() {
  [ -f compose.yaml ] && [ -f apps/api/src/operations-cli.ts ] || fail 'Run from the matching source root.'
  case "$PWD" in *,*) fail 'Deployment path cannot contain commas.' ;; esac
  unset AUTH_SECRET SETUP_TOKEN OFFICE_ADDRESS APP_IMAGE WEB_IMAGE IMAGE_SOURCE VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT COMPOSE_FILE COMPOSE_PROJECT_NAME
  command -v docker >/dev/null 2>&1 || fail 'Docker is required.'
  docker info >/dev/null 2>&1 || fail 'Docker daemon is unavailable; no operation attempted.'
  mkdir .office-install.lock 2>/dev/null || fail 'Installation/backup/upgrade/restore is locked. Confirm the previous process exited before removing the empty .office-install.lock directory.'
  work=
  trap cleanup 0
  trap 'exit 1' HUP INT TERM
  volume_mode=,readonly
}

configure_backup() {
  [ -f .backup.conf ] && [ ! -L .backup.conf ] || fail 'Create protected .backup.conf as described in docs/backups.md.'
  host=$(value .backup.conf BACKUP_HOST) || fail 'Missing unique BACKUP_HOST.'
  remote=$(value .backup.conf BACKUP_DIRECTORY) || fail 'Missing unique BACKUP_DIRECTORY.'
  passfile=$(value .backup.conf BACKUP_PASSFILE) || fail 'Missing unique BACKUP_PASSFILE.'
  printf '%s\n' "$host" | grep -Eq '^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$' || fail 'Use BACKUP_HOST=user@hostname, without SSH options or ports.'
  case "$remote" in /*) ;; *) fail 'BACKUP_DIRECTORY must be absolute.' ;; esac
  case "$remote" in *[!a-zA-Z0-9_./-]*|*/../*|*/..|*/./*|*/.) fail 'Use a simple remote directory without shell syntax or dot segments.' ;; esac
  case "$passfile" in /*) ;; *) fail 'BACKUP_PASSFILE must be absolute.' ;; esac
  case "$passfile" in *,*) fail 'Passfile path cannot contain commas.' ;; esac
  [ -f "$passfile" ] && [ ! -L "$passfile" ] || fail 'Passfile must be an existing regular file, not a symlink.'
  [ -f .env ] && [ ! -L .env ] || fail 'Original protected .env is required.'
  chmod 600 .env .backup.conf
  image=$(value .env APP_IMAGE) || fail 'Missing unique APP_IMAGE.'
  work=$(mktemp -d "$PWD/.office-ops.XXXXXXXX") || fail 'Could not create private staging.'
  helper passfile || fail 'Passfile must have mode 600/400 and contain 32–4096 bytes.'
}

backup_run() {
  cp .env "$work/.env"
  if [ "${stopped:-0}" = 1 ]; then
    helper snapshot || fail 'Stopped-database backup failed. API remains stopped; original data retained.'
  else
    compose exec -T api node --input-type=module < scripts/sqlite-backup.mjs > "$work/office.sqlite" 2>/dev/null \
      || fail 'Online SQLite backup failed; no off-server success. Check API/storage and retry.'
  fi
  helper bundle || fail 'Backup snapshot/encryption failed. Retry if Caddy was changing; no off-server success.'
  name="office-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8).office"
  ssh -oBatchMode=yes -oStrictHostKeyChecking=yes "$host" "umask 077; test -d $remote && test ! -e $remote/$name" >/dev/null 2>&1 \
    || fail 'Backup destination unavailable or collision. Check pinned SSH identity, permissions and directory.'
  scp -B -q -oBatchMode=yes -oStrictHostKeyChecking=yes "$work/backup.office" "$host:$remote/$name" >/dev/null 2>&1 \
    || fail 'Encrypted off-server transfer failed; upgrade blocked. Retry after checking SSH and free space.'
  local_hash=$(openssl dgst -sha256 < "$work/backup.office" | awk '{print $NF}')
  remote_result=$(ssh -oBatchMode=yes -oStrictHostKeyChecking=yes "$host" "chmod 600 $remote/$name && sha256sum $remote/$name" 2>/dev/null) \
    || fail 'Remote checksum command failed; no verified backup.'
  remote_hash=$(printf '%s\n' "$remote_result" | awk '{print $1}')
  [ "${#local_hash}" -eq 64 ] && [ "$remote_hash" = "$local_hash" ] || fail 'Off-server checksum mismatch; no verified backup. Retry and investigate storage/transfer.'
  [ ! -L .backup-receipts ] || fail 'Receipt directory must not be a symlink.'
  mkdir -p .backup-receipts
  chmod 700 .backup-receipts
  printf 'verified_at=%s\nartifact=%s\nsha256=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$local_hash" > ".backup-receipts/$name.receipt"
  printf 'Off-server backup verified: %s sha256=%s\n' "$name" "$local_hash"
}

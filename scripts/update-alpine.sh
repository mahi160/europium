#!/bin/sh
# Installs the newest GitHub release of Office Service unless it is already running or already failed.
# Backs up and migrates the database, switches releases and rolls back if the API does not come up.
# install-alpine.sh installs this as /usr/local/sbin/office-update and runs it from cron every 5 minutes.
set +x
set -eu
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
REPOSITORY=${OFFICE_REPOSITORY:-mahi160/europium}
RELEASES_API=${OFFICE_RELEASES_API:-https://api.github.com/repos/$REPOSITORY/releases}
DOWNLOADS=${OFFICE_DOWNLOADS:-https://github.com/$REPOSITORY/releases/download}
ROOT=/opt/office
DATA=/var/lib/office/office.sqlite
BACKUPS=/var/lib/office-backups
LOCK=/run/office-update.lock

log() {
  printf '%s %s\n' "$(date '+%F %T')" "$1"
}
fail() {
  log "$1" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail 'Run as root inside the Alpine container.'
mkdir "$LOCK" 2>/dev/null || exit 0
trap 'rm -rf "$LOCK" "$ROOT/download"' EXIT

TAG=$(curl -fsS --max-time 30 "$RELEASES_API/latest" |
  grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
case "$TAG" in
  build-*[!0-9a-f-]* | build-) fail "Unexpected latest release tag '$TAG'." ;;
  build-*) ;;
  *) fail "Unexpected latest release tag '$TAG'." ;;
esac
RELEASE=$ROOT/releases/$TAG
PREVIOUS=$(readlink "$ROOT/current" 2>/dev/null || true)
[ "$PREVIOUS" != "$RELEASE" ] || exit 0
[ "$(cat "$ROOT/failed" 2>/dev/null || true)" != "$TAG" ] || exit 0

abandon() {
  printf '%s\n' "$TAG" > "$ROOT/failed"
  fail "$1 $TAG was not installed; it is retried only after a newer release."
}

log "Installing $TAG"
install -d -m 755 "$ROOT" "$ROOT/releases"
install -d -m 700 "$BACKUPS"
rm -rf "$ROOT/download"
mkdir "$ROOT/download"
URL=$DOWNLOADS/$TAG
for file in office-service.tar.gz office-service.tar.gz.sha256; do
  curl -fsSL --max-time 600 -o "$ROOT/download/$file" "$URL/$file" || fail "Download of $file failed."
done
(cd "$ROOT/download" && sha256sum -c office-service.tar.gz.sha256 >/dev/null) || abandon 'Checksum mismatch.'
rm -rf "$RELEASE" "$RELEASE.partial"
mkdir -p "$RELEASE.partial"
tar -xzf "$ROOT/download/office-service.tar.gz" -C "$RELEASE.partial" || abandon 'Archive extraction failed.'
mv "$RELEASE.partial" "$RELEASE"
(
  set -a
  . /etc/conf.d/caddy
  caddy validate --config "$RELEASE/Caddyfile" --adapter caddyfile
) >/dev/null 2>&1 || abandon 'Invalid Caddyfile.'

healthy() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    curl -fs --max-time 2 -o /dev/null http://127.0.0.1:3000/api/setup && return 0
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}
BACKUP=
rollback() {
  log "$1" >&2
  printf '%s\n' "$TAG" > "$ROOT/failed"
  rc-service office-api stop >/dev/null 2>&1 || true
  if [ -n "$BACKUP" ]; then
    # The failed release may have migrated the database; the previous release cannot run against it.
    cp "$BACKUP" "$DATA.restore"
    rm -f "$DATA-wal" "$DATA-shm"
    mv "$DATA.restore" "$DATA"
    chown office:nogroup "$DATA"
    chmod 600 "$DATA"
  fi
  [ -n "$PREVIOUS" ] || fail 'No previous release to roll back to; the API is stopped.'
  ln -sfn "$PREVIOUS" "$ROOT/current"
  install -m 644 "$PREVIOUS/Caddyfile" /etc/caddy/Caddyfile
  rc-service caddy restart >/dev/null 2>&1 || true
  rc-service office-api start >/dev/null 2>&1 || true
  healthy || fail "Rollback to ${PREVIOUS##*/} did not come up; inspect /var/log/office-api.log."
  fail "Rolled back to ${PREVIOUS##*/}; $TAG is retried only after a newer release."
}

rc-service office-api stop >/dev/null 2>&1 || true
if [ -f "$DATA" ]; then
  snapshot=$BACKUPS/office-$(date +%Y%m%d-%H%M%S).sqlite
  "$RELEASE/office-api" snapshot "$DATA" "$snapshot" || rollback 'Database backup failed.'
  BACKUP=$snapshot
  "$RELEASE/office-api" migrate "$DATA" || rollback 'Database migration failed.'
  chown office:nogroup "$DATA"*
fi
ln -sfn "$RELEASE" "$ROOT/current"
if ! cmp -s "$RELEASE/Caddyfile" /etc/caddy/Caddyfile || ! rc-service caddy status >/dev/null 2>&1; then
  install -m 644 "$RELEASE/Caddyfile" /etc/caddy/Caddyfile
  rc-service caddy restart >/dev/null 2>&1 || rollback 'Caddy failed to start.'
fi
rc-service office-api start >/dev/null 2>&1 || rollback 'API failed to start.'
healthy || rollback 'API did not become healthy within 30 seconds.'

rm -f "$ROOT/failed"
for directory in "$ROOT"/releases/*; do
  [ "$directory" = "$RELEASE" ] || [ "$directory" = "$PREVIOUS" ] || rm -rf "$directory"
done
ls -1t "$BACKUPS"/office-*.sqlite 2>/dev/null | tail -n +6 | xargs -r rm -f
log "Installed $TAG"
# Replace this script last, via rename, so the running shell keeps reading the old file.
cp "$RELEASE/update-alpine.sh" /usr/local/sbin/office-update.next
chmod 755 /usr/local/sbin/office-update.next
mv /usr/local/sbin/office-update.next /usr/local/sbin/office-update

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
  IFS= read -r answer || fail 'No confirmation received; nothing further changed.'
  [ "$answer" = yes ] || fail 'Cancelled; nothing further changed.'
}

valid_address() {
  case "$1" in
    ''|*[!a-zA-Z0-9.-]*|localhost|*.localhost) return 1 ;;
  esac
  printf '%s\n' "$1" | awk -F . '
    /^[0-9.]+$/ {
      if (NF != 4) exit 1
      for (i = 1; i <= NF; i++) {
        if ($i == "" || $i > 255 || (length($i) > 1 && substr($i, 1, 1) == "0")) exit 1
      }
      if ($1 == 10 || ($1 == 172 && $2 >= 16 && $2 <= 31) || ($1 == 192 && $2 == 168)) exit 0
      exit 1
    }
    {
      if (length($0) > 253) exit 1
      for (i = 1; i <= NF; i++) {
        if (length($i) < 1 || length($i) > 63 || $i !~ /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/) exit 1
      }
    }
  '
}

valid_image() {
  case "$1" in
    ''|*[!a-z0-9._/@:-]*) return 1 ;;
  esac
  printf '%s\n' "$1" | awk '
    {
      if ($0 !~ /^ghcr[.]io\/[a-z0-9][a-z0-9._\/-]*@sha256:[0-9a-f]+$/) exit 1
      split($0, parts, "@sha256:")
      if (length(parts[2]) != 64) exit 1
    }
  '
}

env_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { count++; value = substr($0, length(key) + 2) }
    END { if (count != 1 || value == "") exit 1; print value }' .env
}

ensure_secret() {
  key=$1
  count=$(awk -v key="$key" 'index($0, key "=") == 1 { count++ } END { print count + 0 }' .env)
  if [ "$count" -eq 0 ]; then
    confirm "Append a missing $key to the protected .env?"
    secret=$(openssl rand -hex 32) || fail 'Secure random generation failed.'
    [ "${#secret}" -eq 64 ] || fail 'Secure random generation failed.'
    printf '\n%s=%s\n' "$key" "$secret" >> .env
    unset secret
  else
    env_value "$key" >/dev/null || fail "Invalid or duplicate $key in .env; repair it privately. No value was logged."
  fi
}

configure_push() {
  count=$(awk '/^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=/ { count++ } END { print count + 0 }' .env)
  if [ "$count" -ne 0 ]; then
    env_value VAPID_PUBLIC_KEY >/dev/null && env_value VAPID_PRIVATE_KEY >/dev/null && env_value VAPID_SUBJECT >/dev/null \
      || fail 'Incomplete or duplicate VAPID configuration; repair it privately. Existing keys were preserved.'
    return
  fi
  [ "${ENABLE_PUSH:-0}" = 1 ] || return 0
  subject=${VAPID_SUBJECT:-}
  case "$subject" in
    mailto:*@*) ;;
    *) fail 'ENABLE_PUSH=1 requires VAPID_SUBJECT=mailto:your-operator@example.com.' ;;
  esac
  case "$subject" in
    *[!a-zA-Z0-9@._:+/-]*) fail 'Use a simple mailto operator address for VAPID_SUBJECT.' ;;
  esac
  image=$(env_value APP_IMAGE) || fail 'Missing APP_IMAGE; VAPID keys were not generated.'
  confirm 'Generate optional push keys using the existing API image and append them to protected .env? Existing keys are never rotated.'
  keys=$(docker run --rm --pull never --network none --read-only --workdir /app/apps/api --entrypoint node "$image" --input-type=module -e '
    import { generateVAPIDKeys } from "web-push";
    const keys = generateVAPIDKeys();
    process.stdout.write(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`);
  ' 2>/dev/null) || fail 'Push key generation failed; no keys were appended.'
  printf '\n%s\nVAPID_SUBJECT=%s\n' "$keys" "$subject" >> .env
  unset keys subject
}

command -v docker >/dev/null 2>&1 || fail 'Docker is missing. Install Docker Engine or Docker Desktop yourself, start it, then rerun this installer.'
docker info >/dev/null 2>&1 || fail 'Docker is not usable. Start the daemon/Desktop, select the intended Docker context, and grant your account Docker access; then rerun.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose is missing or unusable. Install the Docker Compose plugin yourself (docker compose), then rerun.'
command -v openssl >/dev/null 2>&1 || fail 'OpenSSL is required for secure secret generation. Install it yourself, then rerun.'

root=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)
cd "$root"
[ -f compose.yaml ] && [ -f Caddyfile ] && [ -f Dockerfile ] || fail 'Place scripts/install.sh in scripts/ of the matching Office Service source checkout/archive. See docs/deployment.md.'
mkdir .office-install.lock 2>/dev/null || fail 'Another installer may be running. If it was interrupted, confirm it has exited before removing the empty .office-install.lock directory.'
trap 'rmdir .office-install.lock' 0
trap 'exit 1' HUP INT TERM

if [ -e .env ] || [ -L .env ]; then
  [ -f .env ] && [ ! -L .env ] || fail '.env must be a regular file, not a symlink; nothing was replaced.'
  office_address=$(env_value OFFICE_ADDRESS) || fail 'Existing .env has no unique, nonempty OFFICE_ADDRESS. Keep it intact and consult docs/deployment.md; automatic replacement is disabled.'
  valid_address "$office_address" || fail 'Existing OFFICE_ADDRESS must be an unquoted private IPv4 address or DNS hostname. Configuration was not replaced.'
  chmod 600 .env
  ensure_secret AUTH_SECRET
  ensure_secret SETUP_TOKEN
  configure_push
  printf '%s\n' 'Existing configuration preserved. No images pulled/built, application services started/recreated, migrations triggered, or volumes changed.'
  printf 'Configured setup/sign-in URL: https://%s\n' "$office_address"
  printf '%s\n' 'Read docs/deployment.md for trust setup and docs/backups.md for backup-guarded upgrades and recovery.'
  exit 0
fi

for volume in office-service_app-data office-service_caddy-data office-service_caddy-config; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    fail 'Existing Office Service storage found without .env. Restore the original protected configuration; refusing to create a new identity or run migrations.'
  fi
done

printf '%s\n' 'Use a DHCP reservation/static private IPv4 address, or a hostname already resolved by office DNS on every client.'
printf 'Stable LAN address (no scheme, port, or path): '
IFS= read -r office_address || fail 'No LAN address received.'
valid_address "$office_address" || fail 'Invalid LAN address. Use a private IPv4 address (10/8, 172.16/12, 192.168/16) or a valid DNS hostname; IPv6 is not supported by this installer.'

source=${IMAGE_SOURCE:-}
if [ -z "$source" ]; then
  printf 'Image source (local or registry) [local]: '
  IFS= read -r source || fail 'No image source received.'
  source=${source:-local}
fi
case "$source" in
  local)
    app_image=office-service-api:local
    web_image=office-service-web:local
    ;;
  registry)
    app_image=${APP_IMAGE:-}
    web_image=${WEB_IMAGE:-}
    valid_image "$app_image" && valid_image "$web_image" || fail 'Registry mode requires explicit APP_IMAGE and WEB_IMAGE, each ghcr.io/OWNER/IMAGE@sha256:DIGEST (64 lowercase hex digits). Obtain actual published digests from the operator; no registry owner is assumed.'
    ;;
  *) fail 'IMAGE_SOURCE must be local or registry.' ;;
esac

confirm 'Create .env and start this new installation? No existing configuration or storage will be replaced.'
auth_secret=$(openssl rand -hex 32) || fail 'Secure random generation failed.'
setup_token=$(openssl rand -hex 32) || fail 'Secure random generation failed.'
[ "${#auth_secret}" -eq 64 ] && [ "${#setup_token}" -eq 64 ] || fail 'Secure random generation failed.'
(
  set -C
  printf 'OFFICE_ADDRESS=%s\nIMAGE_SOURCE=%s\nAPP_IMAGE=%s\nWEB_IMAGE=%s\nAUTH_SECRET=%s\nSETUP_TOKEN=%s\n' \
    "$office_address" "$source" "$app_image" "$web_image" "$auth_secret" "$setup_token" > .env
) || fail 'Could not create .env without overwriting a file; stopped.'
unset auth_secret setup_token AUTH_SECRET SETUP_TOKEN OFFICE_ADDRESS APP_IMAGE WEB_IMAGE IMAGE_SOURCE

compose() {
  docker compose --env-file .env -f compose.yaml -p office-service "$@"
}

if [ "$source" = local ]; then
  compose build || fail 'Image build failed. .env was preserved; see the interrupted-install recovery instructions in docs/deployment.md.'
else
  compose pull || fail 'Image pull failed. .env was preserved; verify registry access and use the interrupted-install recovery instructions in docs/deployment.md.'
fi
configure_push
compose up -d --no-build --pull never --no-recreate || fail 'Startup failed. Configuration and any created storage were preserved; see docs/deployment.md. Do not delete volumes.'
printf 'Deployment requested at https://%s (readiness is not yet verified).\n' "$office_address"
printf '%s\n' 'Before opening the wizard, export only the public root certificate using the command in docs/deployment.md and establish client trust out of band.'
printf '%s\n' 'Privately open .env to obtain SETUP_TOKEN for first-admin creation. Never paste .env or its secrets into logs, chat, or a URL.'

#!/bin/sh
set +x
set -eu
umask 077

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail 'Run this downloaded script with sudo sh.'
[ -r /etc/os-release ] || fail 'Ubuntu 22.04 or 24.04 LTS is required.'
# This file is owned by the operating system, not downloaded app configuration.
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = ubuntu ] || fail 'Only Ubuntu is supported.'
case "${VERSION_ID:-}" in
  22.04) suite=jammy ;;
  24.04) suite=noble ;;
  *) fail 'Use Ubuntu 22.04 or 24.04 LTS.' ;;
esac
architecture=$(dpkg --print-architecture)
case "$architecture" in
  amd64|arm64) ;;
  *) fail 'Only amd64 and arm64 hosts are supported.' ;;
esac
[ -d /run/systemd/system ] || fail 'A host running systemd is required; do not run this inside a container.'
root=/opt/office-service
[ ! -e "$root" ] && [ ! -L "$root" ] || fail 'Existing /opt/office-service preserved. Use its docs/deployment.md for reruns and docs/backups.md for upgrades; this bootstrap is for first installation only.'

install_docker=yes
if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 || fail 'Existing Docker is not usable. Start/repair it before retrying; it will not be replaced.'
  docker compose version >/dev/null 2>&1 || fail 'Existing Docker needs the Compose plugin. Repair it before retrying.'
  docker buildx version >/dev/null 2>&1 || fail 'Existing Docker needs the Buildx plugin. Repair it before retrying.'
  install_docker=no
else
  for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
    status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || :)
    [ "$status" != 'install ok installed' ] || fail "Conflicting package $package exists. Have the administrator review it; nothing will be automatically removed."
  done
  for file in /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/docker.sources /etc/apt/keyrings/docker.asc; do
    [ ! -e "$file" ] && [ ! -L "$file" ] || fail 'Existing Docker repository configuration found. Have the administrator complete/repair Docker installation; it will not be overwritten.'
  done
fi

printf '%s\n' \
  'This installs prerequisites and, when absent, Docker Engine, Compose and Buildx from Docker official APT packages.' \
  'It enables Docker at boot, downloads mahi160/europium main to /opt/office-service and builds/starts the app.' \
  'Use a dedicated office LAN server. Docker publishes ports 80/443 and can bypass UFW rules.' \
  'No firewall, router, DNS or client certificate trust settings will be changed. Internet access is required.'
printf 'Authorize these host changes? Type yes to continue: '
IFS= read -r answer || fail 'No confirmation received; nothing changed.'
[ "$answer" = yes ] || fail 'Cancelled; nothing changed.'

mkdir -p /opt
mkdir /opt/.office-bootstrap.lock 2>/dev/null || fail 'Another bootstrap may be running. If interrupted, confirm it exited before removing /opt/.office-bootstrap.lock.'
trap 'rmdir /opt/.office-bootstrap.lock' 0
trap 'exit 1' HUP INT TERM

apt-get update
apt-get install -y ca-certificates curl git openssl
if [ "$install_docker" = yes ]; then
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    https://download.docker.com/linux/ubuntu/gpg --output /etc/apt/keyrings/docker.asc
  chmod 644 /etc/apt/keyrings/docker.asc
  (set -C; printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
    "$suite" "$architecture" > /etc/apt/sources.list.d/docker.sources)
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable docker.service
systemctl start docker.service
docker info >/dev/null 2>&1 || fail 'Docker did not become usable. Inspect its service status privately; do not delete data.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose is unavailable.'
docker buildx version >/dev/null 2>&1 || fail 'Docker Buildx is unavailable.'

mkdir "$root" || fail 'Installation directory already exists; it was not overwritten.'
git clone --depth 1 --branch main https://github.com/mahi160/europium.git "$root" \
  || fail 'Source download failed. Keep /opt/office-service for inspection; no existing deployment should be deleted.'
cd "$root"
printf 'Downloaded source commit: '
git rev-parse HEAD
IMAGE_SOURCE=local sh scripts/install.sh

attempt=0
until docker compose --env-file .env -f compose.yaml -p office-service exec -T api node -e \
  'fetch("http://127.0.0.1:3000/api/setup").then(r => { if (!r.ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; });' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || fail 'API readiness check failed. Configuration/data were preserved; inspect the deployment privately. Do not rerun bootstrap or delete volumes.'
  sleep 2
done
printf '%s\n' \
  'API is ready. Deployment files and protected .env are in /opt/office-service.' \
  'Before entering credentials, follow docs/deployment.md to export the public CA certificate and establish trust on each client.' \
  'Privately retrieve SETUP_TOKEN from .env to create the first administrator. Configure backups using docs/backups.md.'

#!/bin/sh
# Installs Office Service natively on Alpine Linux (e.g. a Proxmox LXC) without Docker.
# Run as root from the source checkout: OFFICE_ADDRESS=office.local sh scripts/install-alpine.sh
set +x
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
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

[ "$(id -u)" = 0 ] || fail 'Run as root inside the Alpine container.'
[ -f /etc/alpine-release ] || fail 'This installer supports Alpine Linux only. Use scripts/install.sh for Docker hosts.'
[ -f Caddyfile ] && [ -f pnpm-lock.yaml ] && [ -d apps/api ] || fail 'Run from the root of the Office Service source checkout.'
ADDRESS=${OFFICE_ADDRESS:-}
valid_address "$ADDRESS" || fail 'Set OFFICE_ADDRESS to a private IPv4 address or hostname, e.g. office.local.'
APP=$(pwd)

apk add -q nodejs tini caddy nftables
apk add -q -t .office-build npm python3 make g++
npm install --global --silent pnpm@12.14.0
CI=true /usr/local/bin/pnpm install --frozen-lockfile
/usr/local/bin/pnpm --filter @office-service/web build
rm -rf /srv/office
mkdir -p /srv/office
cp -r apps/web/dist/. /srv/office/
npm uninstall --global --silent pnpm
apk del -q .office-build

id office >/dev/null 2>&1 || adduser -S -D -H -h /var/lib/office -s /sbin/nologin office
install -d -o office -g nogroup -m 700 /var/lib/office

# Existing secrets are never replaced: AUTH_SECRET also protects stored PIN hashes.
if [ ! -f /etc/conf.d/office-api ]; then
  random() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }
  (
    umask 077
    cat > /etc/conf.d/office-api <<EOF
export NODE_ENV=production
export PORT=3000
export APP_ORIGIN=https://$ADDRESS
export DATABASE_PATH=/var/lib/office/office.sqlite
export OFFICE_TIMEZONE=Asia/Dhaka
export AUTH_SECRET=$(random)
export SETUP_TOKEN=$(random)
EOF
  )
fi
chmod 600 /etc/conf.d/office-api

cat > /etc/init.d/office-api <<EOF
#!/sbin/openrc-run
supervisor=supervise-daemon
name="Office Service API"
directory="$APP"
command=/usr/bin/node
command_args="node_modules/tsx/dist/cli.mjs apps/api/src/server.ts"
command_user=office:nogroup
respawn_delay=2
output_log=/var/log/office-api.log
error_log=/var/log/office-api.log
depend() {
	need net localmount
	before caddy
}
start_pre() {
	checkpath -f -o office:nogroup -m 640 /var/log/office-api.log
}
EOF
chmod 755 /etc/init.d/office-api

cp Caddyfile /etc/caddy/Caddyfile
cat > /etc/conf.d/caddy <<EOF
export OFFICE_ADDRESS=$ADDRESS
export SITE_ROOT=/srv/office
export API_UPSTREAM=127.0.0.1:3000
export CADDY_CA_DIR=/var/lib/caddy/.local/share/caddy/pki/authorities/local
EOF

# server.ts listens on every interface; keep the API reachable only through Caddy.
cat > /etc/nftables.nft <<'EOF'
#!/usr/sbin/nft -f
flush ruleset
include "/etc/nftables.d/*.nft"
EOF
rm -f /etc/nftables.d/*.nft
cat > /etc/nftables.d/office.nft <<'EOF'
table inet office {
	chain input {
		type filter hook input priority 0; policy accept;
		iif "lo" accept
		tcp dport 3000 drop
	}
}
EOF

case "$ADDRESS" in
  *.local)
    apk add -q avahi dbus
    sed -i "s/^#\{0,1\}host-name=.*/host-name=${ADDRESS%.local}/" /etc/avahi/avahi-daemon.conf
    rc-update add dbus default >/dev/null
    rc-update add avahi-daemon default >/dev/null
    # Restarting dbus would also restart avahi and race the explicit avahi restart.
    rc-service dbus start
    rc-service avahi-daemon restart
    ;;
esac

for service in nftables office-api caddy; do
  rc-update add "$service" default >/dev/null
  rc-service "$service" restart
done

printf 'Office Service is running at https://%s\nDevices set up trust at http://%s/connect\n' "$ADDRESS" "$ADDRESS"
printf 'The setup token is in /etc/conf.d/office-api (root only). Do not print it into shared logs.\n'

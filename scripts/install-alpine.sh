#!/bin/sh
# One-time setup of Office Service on Alpine Linux (e.g. a Proxmox LXC), without Docker or Node.
# Run as root with update-alpine.sh beside this file: OFFICE_ADDRESS=office.local sh install-alpine.sh
# Installs the latest GitHub release, then cron installs each newer release within 5 minutes.
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
[ -f /etc/alpine-release ] || fail 'This installer supports Alpine Linux only.'
UPDATER=$(dirname -- "$0")/update-alpine.sh
[ -f "$UPDATER" ] || fail 'Place update-alpine.sh beside install-alpine.sh.'
ADDRESS=${OFFICE_ADDRESS:-}
valid_address "$ADDRESS" || fail 'Set OFFICE_ADDRESS to a private IPv4 address or hostname, e.g. office.local.'

# The compiled API needs only musl, libgcc and libstdc++.
apk add -q caddy nftables busybox-openrc curl ca-certificates libgcc libstdc++
# Earlier installs served the frontend from /srv/office.
rm -rf /srv/office

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

cat > /etc/init.d/office-api <<'EOF'
#!/sbin/openrc-run
supervisor=supervise-daemon
name="Office Service API"
directory="/var/lib/office"
command=/opt/office/current/office-api
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

cat > /etc/conf.d/caddy <<EOF
export OFFICE_ADDRESS=$ADDRESS
export SITE_ROOT=/opt/office/current/web
export API_UPSTREAM=127.0.0.1:3000
export CADDY_CA_DIR=/var/lib/caddy/.local/share/caddy/pki/authorities/local
EOF

# The API listens on every interface; keep it reachable only through Caddy.
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

for service in nftables office-api caddy crond; do
  rc-update add "$service" default >/dev/null
done
rc-service nftables restart
install -d /usr/local/sbin
install -m 755 "$UPDATER" /usr/local/sbin/office-update
/usr/local/sbin/office-update
[ -x /opt/office/current/office-api ] || fail 'No release is installed; see the messages above.'
# Apply the service and Caddy configuration written above, even when the latest release was already running.
rc-service office-api restart
rc-service caddy restart

CRON='*/5 * * * * /usr/local/sbin/office-update >>/var/log/office-update.log 2>&1'
{ grep -v 'office-update\|auto-update-alpine' /etc/crontabs/root 2>/dev/null || true; printf '%s\n' "$CRON"; } > /etc/crontabs/root.next
mv /etc/crontabs/root.next /etc/crontabs/root
chmod 600 /etc/crontabs/root
rc-service crond restart

printf 'Office Service is running at https://%s\nDevices set up trust at http://%s/connect\n' "$ADDRESS" "$ADDRESS"
printf 'New releases install automatically within 5 minutes; see /var/log/office-update.log\n'
printf 'The setup token is in /etc/conf.d/office-api (root only). Do not print it into shared logs.\n'

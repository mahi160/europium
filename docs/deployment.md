# Office Service deployment

Office Service runs in one Alpine Linux LXC container (for example a Proxmox CT). The API is a single compiled Bun binary, `office-api`, supervised by OpenRC. Caddy serves the built frontend, proxies `/api/*` to the API and terminates HTTPS with its internal CA. An nftables rule blocks port 3000 from the network, so all traffic goes through Caddy. This is the only supported deployment.

## Prerequisites

- A fresh Alpine 3.24+ container with network access. One core, 512 MB of RAM and 4 GB of disk are enough. The binary targets x86-64 (musl) only.
- A stable private IPv4 address (ideally a DHCP reservation) or a hostname that resolves to the container on every client. `.local` names are served through avahi (mDNS) by the installer; mDNS works within one LAN segment, and many Android browsers cannot resolve `.local`, so use an IP address or DNS name if Android devices must connect.
- Ports 80 and 443 reachable from the office LAN. Port 80 serves only the device-connection page and the public root certificate, and redirects everything else to HTTPS. Do not forward ports from the internet; the service is LAN-only.
- Outbound HTTPS to github.com (release downloads) and, for push notifications, to the platform push services.

## Install

Inside the container, as root:

```sh
apk add curl
base=https://raw.githubusercontent.com/mahi160/europium/deploy/scripts
curl -fsSLO $base/install-alpine.sh
curl -fsSLO $base/update-alpine.sh
OFFICE_ADDRESS=office.local sh install-alpine.sh
```

This runs downloaded code as root; review the scripts first if you have not already. `OFFICE_ADDRESS` is a private IPv4 address or a hostname, without scheme or port.

The installer adds Caddy, nftables, avahi (for `.local` names) and the other packages it needs, creates the unprivileged `office` user, installs the latest GitHub release, starts `office-api`, `caddy` and cron, and registers the auto-update job. Rerunning it is safe: existing secrets are never replaced.

Files on the server:

| Path                            | Contents                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `/etc/conf.d/office-api`        | Configuration and secrets (`AUTH_SECRET`, `SETUP_TOKEN`); root-only, never replaced |
| `/var/lib/office/office.sqlite` | The database                                                                        |
| `/var/lib/caddy`                | Caddy's CA identity, keys and certificates                                          |
| `/opt/office/releases/<tag>`    | Installed releases; `/opt/office/current` points at the running one                 |
| `/var/lib/office-backups`       | Database snapshots taken before each update                                         |
| `/var/log/office-update.log`    | Update log                                                                          |
| `/var/log/office-api.log`       | API log                                                                             |

`AUTH_SECRET` also protects stored PIN hashes; keep it with the database. Caddy's storage defines the root certificate that devices trust; losing it forces every device to trust a new root.

After install, set up device trust (below), then open `https://ADDRESS` and create the first administrator with `SETUP_TOKEN` from `/etc/conf.d/office-api`. Never put the token in a URL, screenshot, ticket or shared log. Setup completion is recorded in the database; changing the token or reinstalling cannot reopen first-admin creation.

## Deploying and auto-update

Push or merge to the `deploy` branch. `.github/workflows/release.yml` checks types, lint and tests, builds the release and publishes a GitHub release named `build-<12-char sha>` containing `office-service.tar.gz` and its `.sha256`. The archive holds `office-api` (with migrations embedded), `web/`, `Caddyfile` and `update-alpine.sh`. The newest five builds are kept.

On the server, cron runs `/usr/local/sbin/office-update` every 5 minutes. If the latest release is newer than the running one, it:

1. downloads the archive and verifies its sha256;
2. extracts it to `/opt/office/releases/<tag>` and validates the Caddyfile;
3. stops the API and snapshots the database to `/var/lib/office-backups` (the five newest are kept);
4. runs migrations, then switches the `/opt/office/current` symlink;
5. restarts Caddy if the Caddyfile changed, then starts the API;
6. health-checks `/api/setup` for up to 30 seconds.

Downtime is a few seconds per update. The updater replaces itself from each successful release. To check immediately instead of waiting, run `office-update`.

Monitor with `tail -f /var/log/office-update.log`. No log lines means there was nothing newer to install.

## Failures and rollback

If any step after download fails, including the health check, the updater restores the database snapshot, switches back to the previous release, restarts the services and records the tag in `/opt/office/failed`. That tag is not retried until a newer release exists. The log states what failed. A checksum mismatch, bad archive or invalid Caddyfile marks the release as failed without touching the running one.

Other rollbacks are not automated. To go back to earlier behaviour, push a revert to `deploy`; it is released and installed like any other change.

## Backups and restore

Before each update the updater saves a consistent snapshot to `/var/lib/office-backups`. These live on the same container, so they protect against a bad update, not against losing the container.

Off-server backups are the operator's job. Back up the whole container, for example with Proxmox `vzdump`, on a schedule, and keep copies elsewhere. A backup contains `/etc/conf.d/office-api` and `/var/lib/caddy`, so protect it like the secrets it holds.

To restore a snapshot manually, as root:

```sh
rc-service office-api stop
cp /var/lib/office-backups/office-YYYYMMDD-HHMMSS.sqlite /var/lib/office/office.sqlite
rm -f /var/lib/office/office.sqlite-wal /var/lib/office/office.sqlite-shm
chown office:nogroup /var/lib/office/office.sqlite
chmod 600 /var/lib/office/office.sqlite
rc-service office-api start
```

Restore only a snapshot taken by the same or an older release than the one running, or migrations will not match. Do not delete the database to recover an account; use the administrator reset flow.

## Configuration

Settings live in `/etc/conf.d/office-api` as `export KEY=value` lines. After editing, run `rc-service office-api restart`.

### Optional hub statistics

Leave `STATS_TOKEN` unset to disable `GET /api/stats`. To enable it, generate a separate 32-byte random token (hex is suitable), add `export STATS_TOKEN=...` to `/etc/conf.d/office-api`, run `rc-service office-api restart`, and store the same value as a server-side secret on the hub. `OFFICE_TIMEZONE` (default and installer value `Asia/Dhaka`) sets the office time zone.

The hub sends the token in an `Authorization: Bearer …` header over HTTPS and must trust the Caddy root CA; do not disable certificate verification. Keep the token out of browsers, URLs and logs. The endpoint returns delivered totals only.

### Optional push notifications

Push needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (for example `mailto:operator@example.com`) in `/etc/conf.d/office-api`, followed by a restart. Without a valid, consistent set, Profile reports notifications as unavailable and nothing else is affected. Changing the keys invalidates existing browser subscriptions. The server and devices need outbound internet access to their platform push services; see `apps/api/README.md` for the exact contracts.

## Connect devices: install the office certificate

Caddy signs the HTTPS certificate with its own local CA, so each device must trust that CA once. Until then, browsers show a certificate warning. Bypassing the warning is not enough: service workers, installation and push require trusted HTTPS.

### Device-connection page

On each phone or computer, open `http://ADDRESS/connect` (for example `http://office.local/connect`). Type the `http://` prefix and the `/connect` path: browsers that try HTTPS first would show the certificate warning instead. The page detects the device (iPhone/iPad, Android, Windows, Mac), offers a **Download certificate** button and lists the exact installation steps in English and Bangla. Its **Open Office Service** button opens the HTTPS app; no warning means the device is set up. A **Print QR poster** button prints a QR code linking to the page for staff phones.

Over plain HTTP, Caddy serves only this page, its static assets and the public root certificate at `/office-root.crt` (as `application/x-x509-ca-cert`). Every other HTTP request redirects to HTTPS. The CA private keys are never served.

**Accepted risk:** the certificate is downloaded over unauthenticated HTTP, as with AdGuard's certificate setup. Someone able to intercept traffic on the office LAN could serve their own certificate and then impersonate the server to that device. This deployment accepts that risk for ease of setup on a trusted office LAN. Where it is not acceptable, distribute the certificate manually as described below and compare its fingerprint, instead of using the connection page.

Installing a root CA grants substantial trust on a device. Install it only on authorized devices, and remove it when the office service is retired. Never disable certificate validation globally.

Notes per platform:

- **iPhone / iPad:** use Safari. Installing the profile alone is insufficient; full trust must be enabled under **Settings → General → About → Certificate Trust Settings**. See Apple's [manual certificate trust instructions](https://support.apple.com/en-us/102390).
- **Android:** browsers cannot install CA certificates directly; the file is saved to Downloads and installed from **Settings → … → Encryption & credentials → Install a certificate → CA certificate**. Menu names vary by vendor. Many Android browsers cannot resolve `.local` names; use an IP address or a DNS name in `OFFICE_ADDRESS` if Android devices must connect.
- **Linux and Firefox:** have the administrator add the certificate to the distribution's CA store; Firefox may need a separate import under **Settings → Privacy & Security → Certificates → View Certificates → Authorities**.
- Managed devices may need IT approval.

### Manual distribution and fingerprint check

The root certificate is `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` in the container, and is also served at `http://ADDRESS/office-root.crt`. To check its fingerprint on the server:

```sh
openssl x509 -in /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt -noout -fingerprint -sha256
```

(`apk add openssl` if it is missing.) Copy **only** `root.crt`. Never export the rest of `/var/lib/caddy`, `root.key` or an intermediate private key. Give the file to clients in person or through an already authenticated channel, and confirm the SHA-256 fingerprint independently. The installation steps on the connection page apply to a manually distributed file as well.

### Complete setup

On each client, reopen the exact configured HTTPS address, such as `https://192.168.1.50`. Confirm that the browser shows no certificate/name warning. The address must match `OFFICE_ADDRESS`; trusting the CA does not make a different IP/name valid.

The sign-in and setup screens link to the device-connection page.

### Employee and staff PINs

Employees and support staff use username plus a four-digit PIN, not a password. Administrators retain passwords. Administrators issue temporary PINs through People, and users must change them at first sign-in. Moving between administrator and non-administrator roles revokes sessions and requires a credential reset appropriate to the new role.

PINs have only 10,000 combinations and are weaker than long passwords. Keep trusted HTTPS, LAN-only access and the persistent per-account attempt limits enabled. Preserve `AUTH_SECRET`: PIN hashing depends on it.

## Install and notify on devices

After establishing trusted HTTPS, open Profile for localized installation and notification setup. Android and desktop browsers may offer an install button; the browser menu also works. iOS/iPadOS 16.4+ requires Safari → Share → Add to Home Screen and launching the installed app before the explicit notification button. Unsupported or denied permission never prevents staff work.

Real Android/iPhone installation, private-CA trust and push delivery remain unverified on hardware.

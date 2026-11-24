# Office Service deployment

## Supported deployment shape

Office Service runs as Linux containers on `linux/amd64` (x86-64) or `linux/arm64` Docker hosts. A Docker Desktop Linux VM can be used, provided the host publishes its ports to the office LAN. This is not a promise of support for every host OS, Windows containers, NAS appliance, or CPU.

The API is one Node 24 process on container port 3000, with SQLite on persistent storage. Caddy serves the built frontend and proxies `/api/*` without stripping the prefix. All browser traffic uses one HTTPS origin. Other paths fall back to the SPA. The API port and Caddy administration port are not published. Both services have `restart: unless-stopped`; Docker itself must be configured by the operator to start after host reboot.

### Prerequisites

- An existing, running Docker Engine or Docker Desktop in Linux-container mode, with a usable `docker` CLI and `docker compose` plugin supporting `up --no-build --pull never --no-recreate`. Compose v2 or later is required; Compose v5.5 is an intended environment. The installer does not install Docker or grant Docker permissions. Docker access is effectively host-administrator access.
- A POSIX shell, ordinary POSIX utilities (including `awk`), and OpenSSL for secure random generation and certificate fingerprints. Use `sh scripts/install.sh`; executable permission is not required. Node and pnpm are not host prerequisites. Images install Node 24 and pnpm 12.14.0; dependency installation is frozen to the repository lockfile and workspace overrides. The Debian Bookworm builder includes Python, make, and g++ for native `better-sqlite3` builds on either architecture. Runtime uses the matching Debian base; Caddy uses the official image.
- A matching trusted source checkout/archive, with `Dockerfile`, `.dockerignore`, `compose.yaml`, `Caddyfile`, `scripts/install.sh`, workspace manifests, lockfile, and application sources. Use a dedicated, operator-owned directory, not a shared writable directory. Keep this directory and `.env` for the lifetime of the installation.
- Outbound network access for initial package/base-image downloads in local mode, or access to the actual published GHCR images in registry mode. Authenticate privately with the registry beforehand if required. No credentials belong in image references or command-line arguments.
- Free TCP ports 80 and 443 on the Docker host; clients need access to TCP 443. Port 80 only redirects to HTTPS. The operator must configure host firewall/Desktop forwarding to allow the office LAN and deny unwanted networks. No router port forwarding or public exposure is needed or recommended.
- A stable private IPv4 LAN address, ideally a DHCP reservation, or a DNS hostname already resolving to that address on every client through existing router/AdGuard DNS. The installer accepts private IPv4 (10/8, 172.16/12, 192.168/16) or DNS labels, without scheme, port, path, whitespace, or shell syntax. IPv6 literals are not supported by this installer. Hostnames must actually resolve to the intended LAN server; syntax validation cannot prove DNS ownership or routing.
- Durable Docker volume storage for the database, WAL, and Caddy CA. Ensure sufficient disk space and protect host/VM storage and backups from other users. Do not place active SQLite files on a shared/network filesystem. The operator must arrange backups before production upgrades.

This provides office-LAN access only, not access from outside the office. Wi-Fi client isolation, guest networks, firewalls, and VPN routing can prevent connectivity. The installer never changes host DNS, certificate trust, firewall/router settings, or system packages. Editing the server's hosts file does not configure DNS on phones.

## Ubuntu one-command bootstrap

For a dedicated Ubuntu 22.04 or 24.04 LTS host using systemd on amd64/arm64, the public repository is `https://github.com/mahi160/europium`. With `curl`, sudo access and internet connectivity already available:

```sh
curl --fail --silent --show-error --location https://raw.githubusercontent.com/mahi160/europium/main/scripts/bootstrap-ubuntu.sh --output office-service-ubuntu.sh && sudo sh office-service-ubuntu.sh
```

This runs downloaded code as root. Review the script before execution if you have not already reviewed the repository; never pipe a remote response directly into a shell. This convenience path follows moving `main`, not an immutable release. For a reviewed immutable source snapshot, use the manual source-checkout method below instead.

The bootstrap asks before making host changes, installs `ca-certificates`, `curl`, `git` and `openssl`, and installs missing Docker Engine, Compose and Buildx through [Docker's official signed Ubuntu APT repository](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository). It enables and starts the Docker systemd service without adding users to the root-equivalent Docker group. It reuses a working Docker installation; unusable Docker, conflicting packages or an unfinished Docker repository configuration stop installation rather than automatically uninstalling or overwriting them.

It clones `main` into root-owned `/opt/office-service`, prints the downloaded source commit and invokes the existing local-build installer below. Enter the stable office LAN IP/hostname and confirm creation/startup. A successful bootstrap confirms API readiness; client HTTPS trust and administrator setup still require the steps below. This does not configure DNS, firewall rules, router forwarding or client trust. Docker-published ports may bypass UFW rules: use a LAN-only host/network policy, and do not expose the server publicly.

Any existing `/opt/office-service`, including an incomplete bootstrap, is preserved and causes a stop before package installation. Do not delete it or its `.env` to force a rerun. For failures after cloning, inspect the retained directory privately and use the interrupted-install guidance below; for a used installation, use `docs/backups.md`. A failed bootstrap may leave installed system packages, signing-key/repository files and running Docker intact. Repair those explicitly rather than expecting automatic rollback. A retained `/opt/.office-bootstrap.lock` may be removed only after confirming the installer has exited. Run subsequent deployment commands from `/opt/office-service` with `sudo` as needed; its protected `.env` is root-owned.

Automated bootstrap tests use external-command stubs and the real application installer. Actual package installation, image builds, reboot behavior and end-to-end office-device access on Ubuntu remain unverified.

## Obtain the installer from a reviewed source snapshot

Download a matching source checkout/archive of `mahi160/europium` at a reviewed immutable commit. The application installer lives at:

```text
https://raw.githubusercontent.com/mahi160/europium/COMMIT/scripts/install.sh
```

Replace `COMMIT` with the reviewed immutable commit. Download and review the script over authenticated HTTPS before running it. Place it at `scripts/install.sh` in that matching source directory. Unlike `bootstrap-ubuntu.sh`, it does not provision the host or download source: a lone `install.sh` does not provide the required deployment artifacts. Do not overwrite an existing deployment's files as an installation shortcut. The manual installer retains the prerequisites listed above; the Ubuntu bootstrap is the explicit host-provisioning exception.

No published GHCR image digests are asserted; local builds do not require GHCR publishing.

## Initial installation

From the matching source root, choose one image source.

### Local build

```sh
IMAGE_SOURCE=local sh scripts/install.sh
```

Enter the stable LAN address when prompted, then type exactly `yes` to authorize creation and startup. The installer builds `office-service-api:local` and `office-service-web:local` for the Docker daemon's architecture; it does not publish images. Local builds are for the reviewed source snapshot. Do not rebuild an existing production installation as an upgrade shortcut.

### Published GHCR images

Use the actual image digest references recorded by the image workflow. Replace all placeholders; do not use `latest` or a mutable version tag:

```sh
IMAGE_SOURCE=registry \
APP_IMAGE='ghcr.io/owner/repository-api@sha256:REPLACE_WITH_64_HEX_DIGEST' \
WEB_IMAGE='ghcr.io/owner/repository-web@sha256:REPLACE_WITH_64_HEX_DIGEST' \
sh scripts/install.sh
```

The two digests must come from the same reviewed release/commit. The installer requires both references explicitly and accepts only GHCR references pinned by SHA-256 digest. It does not invent an owner or claim that images have been published.

`.github/workflows/images.yml` is prepared to build and push both targets for `linux/amd64,linux/arm64` on a `v*` release-tag push or manual workflow dispatch. It uses the lowercase GitHub repository name with `-api` and `-web` suffixes and a `sha-COMMIT` discovery tag. Use the immutable digest references from each job summary for deployment. Registry tags can be overwritten; a tag name alone is not an immutable version. A maintainer must separately authorize running this publishing workflow and configure package access/visibility. Adding the workflow does not publish anything locally.

### Configuration and secrets

The installer creates `.env` under `umask 077`, with mode 600, containing `OFFICE_ADDRESS`, `IMAGE_SOURCE`, `APP_IMAGE`, `WEB_IMAGE`, `AUTH_SECRET`, and `SETUP_TOKEN`. Each generated secret is 32 cryptographically random bytes represented as 64 hexadecimal characters. Secrets are not printed. Privately open `.env` in a local editor to retrieve the setup token and hand it to the intended first administrator through an authenticated private channel. Do not put it in a URL, screenshot, terminal log, ticket, or chat.

Keep installer-managed entries as one unquoted `KEY=value` line per key. The installer never sources or evaluates `.env` as shell code. Do not export competing Compose variables in your operator shell: shell environment overrides `.env` when Compose is run manually. Do not print `docker compose config`, environment dumps, or container inspection output containing secrets into support logs.

The API derives `APP_ORIGIN=https://OFFICE_ADDRESS` and uses `/data/office.sqlite`; there is no separate public API URL. Caddy uses its internal CA even for a configured hostname. No public ACME certificate or purchased domain is required.

### Optional hub statistics

Leave `STATS_TOKEN` unset to disable `GET /api/stats`. To enable it, privately generate a separate 32-byte random token (hex is suitable), save it as `STATS_TOKEN` in the protected Office Service `.env`, and store the same value as a server-side secret on the hub. Optionally set `OFFICE_TIMEZONE` to the office's IANA time zone; the default is `Asia/Dhaka`. Apply these settings through the approved deployment process.

The hub sends the token in the `Authorization: Bearer …` header over HTTPS. Configure its runtime to trust the verified Caddy root CA as described below; do not disable certificate verification. Do not place the token in the browser, a URL, or logs. The endpoint returns delivered totals only and does not grant access to ordering APIs.

## Establish trust before opening the setup wizard

The first visit is not trusted merely because the URL starts with HTTPS. An untrusted web page cannot safely bootstrap its own identity. Follow these instructions offline on the operator-controlled host first. Do not bypass a browser certificate warning or enter credentials before establishing trust.

After Caddy starts and creates its CA, run from the deployment root, with the same Docker context and no competing exported Compose variables:

```sh
umask 077
docker compose --env-file .env -f compose.yaml -p office-service cp caddy:/data/caddy/pki/authorities/local/root.crt public-root.crt
openssl x509 -in public-root.crt -noout -fingerprint -sha256
```

If the certificate does not exist yet, wait for Caddy startup and retry the copy. Inspect startup status privately if it continues to fail. Before repeating the copy over an existing `public-root.crt`, explicitly confirm that replacing that public certificate is intended, or choose a fresh output filename.

Copy **only** `root.crt`, named `public-root.crt` here. Never export the entire CA directory, `/data`, `root.key`, an intermediate private key, or `.env` to clients. The public certificate is not secret, but its authenticity is security-critical. Give it to clients in person (for example, operator-controlled removable media) or through an already authenticated channel such as an existing trusted corporate file service. Confirm the SHA-256 fingerprint with the operator independently, in person or over a separately authenticated channel. Do not fetch the initial certificate from this still-untrusted app and treat that as proof of identity.

Installing a root CA grants substantial trust on a device. Install only the verified office root on authorized devices, and remove it when the office service is retired. Never disable certificate validation globally.

### Desktop

- **Windows:** Import the verified certificate using the certificate import wizard into **Trusted Root Certification Authorities** for the current user (or have IT manage device-wide trust). Confirm the certificate identity before approving.
- **macOS:** Import it using **Keychain Access** into the appropriate login/system keychain, open the certificate's **Trust** settings, and explicitly trust it for SSL. Device-wide changes may require an administrator.
- **Linux:** Have the administrator add it to the distribution's CA store using that distribution's documented procedure. There is no universal trust command for every desktop/browser combination.
- **Firefox:** Depending on browser policy/platform, a separate CA import may be needed under **Settings → Privacy & Security → Certificates → View Certificates → Authorities**. Import the verified root and allow it to identify websites. Restart/reopen the browser if required.

### Android

Open **Settings → Security** (or **Security & privacy**) **→ Encryption & credentials → Install a certificate → CA certificate**, then select the verified `public-root.crt`. Menu names vary by vendor/Android version; installation may require a screen lock and explicit security confirmation. Managed devices may need IT approval. Use a browser that accepts user-installed CAs; not every app trusts them. Never work around failure by disabling TLS validation.

### iPhone / iPad

Open the verified `public-root.crt` received through the trusted transfer path. Install the downloaded profile under **Settings → General → VPN & Device Management** (or **Profile Downloaded**, depending on iOS). Then go to **Settings → General → About → Certificate Trust Settings** and enable **full trust** for this root certificate. Installing the profile alone is insufficient for manually installed roots. Managed-device policy may require IT assistance. See Apple's [manual certificate trust instructions](https://support.apple.com/en-us/102390).

### Complete setup

On each client, reopen the exact configured HTTPS address, such as `https://192.168.1.50`. Confirm that the browser shows no certificate/name warning. The address must match `OFFICE_ADDRESS`; trusting the CA does not make a different IP/name valid.

The app offers English and Bangla device-trust guidance on both desktop and mobile sign-in/setup screens. The existing protected bootstrap form requires the privately supplied `SETUP_TOKEN` to create the first administrator. After successful setup, sign in using the new account. The database records setup completion; changing the token, rerunning the installer, or restarting containers cannot reopen first-admin creation. Do not delete the database to recover an account; use the existing administrator reset flow.

### Employee and staff PINs

Employees and support staff use username plus a four-digit PIN, not a password. Administrators retain passwords. Existing non-admin accounts are signed out by the PIN migration and need a temporary PIN issued through People; accounts and orders are preserved. The user must change that temporary PIN at first sign-in. Moving between administrator and non-administrator roles revokes sessions and requires a credential reset appropriate to the new role.

PINs have only 10,000 combinations and are weaker than long passwords. Keep trusted HTTPS, LAN-only access and the persistent per-account attempt limits enabled. Preserve `AUTH_SECRET` with the original protected configuration: PIN hashing now depends on it. Use the existing backup-guarded upgrade process to apply the migration in production.

## Persistence and reruns

The fixed Compose project is `office-service`. Its named volumes are:

| Volume                        | Contents                                                   |
| ----------------------------- | ---------------------------------------------------------- |
| `office-service_app-data`     | SQLite database, WAL, and related persistent app state     |
| `office-service_caddy-data`   | CA identity, private keys, certificates, and renewal state |
| `office-service_caddy-config` | Caddy persisted configuration                              |

Keep all three, the source/deployment artifacts, and the original protected `.env`. The API runs as the image's non-root `node` user; Docker initializes a new database volume from the image's node-owned `/data` directory. Caddy protects its generated private-key files; restrict access to the Docker daemon, underlying volume storage, and backups. Anyone with Docker/host-administrator access can read them. Do not distribute Caddy storage to clients. Losing it can create a new CA identity and require every client to trust a different root. A container restart must retain the same root fingerprint.

Rerun the same command in the same directory/context:

```sh
sh scripts/install.sh
```

With an existing `.env`, the installer preserves every existing value, tightens its mode to 600, and only offers to append absent secret keys after explicit `yes` confirmation. Empty or duplicate managed entries require private operator repair; they are not silently replaced. It does not pull/build images, start/recreate application services, or trigger migrations on a rerun. The optional push-key step below may run a disposable, read-only, network-disabled API-image container without mounting application data. It preserves volumes and the CA. Image-source environment overrides do not turn a rerun into an upgrade. A missing `.env` with existing named storage is a hard stop: restore the original configuration rather than generate a new identity.

Use [Backups, upgrades and replacement recovery](backups.md) to configure daily encrypted off-server backups, upgrade paired immutable images, and restore onto a clean replacement. Production startup refuses pending migrations on existing databases; `sh scripts/upgrade.sh` requires a newly verified off-server backup before pulling images or explicitly migrating. Do not manually change image references, run `compose up --build`, pull replacement versions, delete volumes, prune deployment storage, or run `docker compose down -v` as recovery. Restore never overwrites an existing installation.

### Interrupted initial installation

A failed build/pull/start leaves `.env` and any created storage intact. A rerun is intentionally inert rather than assuming that no real installation exists. Inspect the failure privately and establish whether an API ever started or any production data exists. Do not remove `.env` to force a fresh run.

Only for a confirmed incomplete, **never-used initial install**, after explicitly approving continuation with the same reviewed source and `.env`, an operator may resume the original operation:

```sh
# Local mode only, same original source snapshot:
docker compose --env-file .env -f compose.yaml -p office-service build
# Registry mode instead, same original immutable references:
docker compose --env-file .env -f compose.yaml -p office-service pull
# Then start only the prepared images, without replacing existing containers:
docker compose --env-file .env -f compose.yaml -p office-service up -d --no-build --pull never --no-recreate
```

Choose only the build or pull command appropriate to the saved mode. If this is an existing/used installation, use the backup-guarded recovery/upgrade procedure in `docs/backups.md` instead. If an installer process was interrupted and left `.office-install.lock`, confirm it has exited before manually removing only that empty lock directory.

## Optional installation and push notifications

Push is opt-in and independent of ordering. For a new install, replace the contact address and run:

```sh
ENABLE_PUSH=1 VAPID_SUBJECT=mailto:operator@example.com IMAGE_SOURCE=local sh scripts/install.sh
```

After preparing the API image, the installer asks before appending generated `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` to mode-600 `.env`. Generation uses the API image's installed `web-push` in a disposable container with no network or data mounts. Values are captured privately, never printed; existing complete VAPID configuration is preserved, never rotated. Without `ENABLE_PUSH=1`, push remains unconfigured. A partial/duplicate existing VAPID configuration stops with a generic repair message rather than overwriting it. Node is still not a host prerequisite.

The same optional command on an existing install can append absent keys using its already-present API image, but does not restart/recreate application services or bypass the backup-guarded upgrade procedure in `docs/backups.md`. An older image without `web-push` cannot generate keys; do not replace a used installation's image without the required backup/upgrade procedure. An already-running API does not read newly appended keys until an approved restart. Keep VAPID keys with the protected deployment identity; changing them invalidates existing browser subscriptions and requires renewed device setup. Do not paste `.env`, private keys or subscription endpoints into logs/chat.

`compose.yaml` passes these optional variables to the API; absent or inconsistent values produce an unavailable notification status in Profile, not a broken application. Only the public VAPID key is exposed by the authenticated API. See `apps/api/README.md` for exact API contracts, reminder semantics and automated verification commands.

After establishing trusted HTTPS, open Profile for localized installation and notification setup. Android/desktop browsers may offer an install button; the browser menu also works. iOS/iPadOS 16.4+ requires Safari → Share → Add to Home Screen and launching the installed app before the explicit notification button. The manifest supplies local PNG icons, maskable artwork and launch colors; the existing phone/tablet/desktop responsive shell is retained. Unsupported/denied permission never prevents staff work.

Both the Node server and each device require internet reachability to the device's platform push service, even though the app remains LAN-only. Supported endpoint hosts are Google `fcm.googleapis.com`, Mozilla `updates.push.services.mozilla.com`, and Apple `web.push.apple.com`/single-label `*.push.apple.com`; no private-LAN or arbitrary provider is allowed. The server needs outbound HTTPS to those services. Device/firewall platform connectivity and certificate trust must be confirmed on the actual OS; no inbound internet port forwarding is needed. Private-CA trust, including full trust on iOS, is necessary but does not prove OS push delivery.

Pending requests initially alert active subscribed staff, then every five minutes; acceptance/rejection/cancellation stop reminders, and admin requeue restarts them. Missed intervals are not replayed after downtime. Employees receive localized lifecycle updates and applicable reasons, excluding their own cancellation. Notifications already handed to an external service cannot be recalled, including after logout. Logout/reset/deactivation stop future sends to revoked sessions. Transport failure never rolls back orders. Assets alone are cached; authenticated APIs and offline submissions are not cached or queued.

**Unverified on real hardware:** Android/iPhone installation and launch, private-CA certificate trust, iOS Home Screen push, explicit native permissions, initial/five-minute reminders, and notification navigation with expired sessions. No Android/iPhone hardware evidence was available; browser simulations and injected external transport tests are not substitutes. The real-device acceptance checklist and precise check commands are in `apps/api/README.md`.

## Verification handoff

No checks or builds were run for this implementation; the caller owns final verification. The supplied target environment is Docker Desktop on macOS with a `linux/aarch64` daemon, Compose v5.5, Node 24, and pnpm 12.14.0. This environment was reported, not runtime-verified here. No host architecture is recorded as tested yet, and no images have been published by this work.

The caller should record evidence separately for a clean install, trusted browser access and first-admin completion, missing/unusable Docker and missing Compose failures, invalid address rejection, container restart with unchanged database and root fingerprint, and an inert installer rerun with unchanged secrets/configuration/CA. Validate both native image architectures before claiming multi-architecture runtime support. Shell syntax, image builds, Compose validation, locale/type checks, real device certificate trust, and backup-guarded upgrades remain unverified by this implementation. Backup/upgrade/restore commands, test coverage, operator failure recovery, and the real-Docker verification handoff are in `docs/backups.md`.

# Backups, upgrades and replacement recovery

Run these commands from the protected deployment source root, with the same Docker context used for installation. Never use `set -x`, print `.env`, or paste private keys, container environment dumps or subscriptions into support logs. Do not run the installer to upgrade. Installer reruns remain inert. All operations share the installer's atomic-directory lock, `.office-install.lock`; concurrent operations fail rather than overlap. If a process was interrupted, establish that it has exited before removing only that empty lock directory.

## Prerequisites and retained material

The host needs Docker with Compose, POSIX `sh`, `awk`, `grep`, `mktemp`, OpenSSL, and OpenSSH `ssh`/`scp`. Node is not required on the host. Helpers use Node 24, the installed `better-sqlite3`, and GNU tar in the cached API image, with networking disabled and root access only to read/copy protected volumes. The helper source and migrations are bind-mounted from the matching reviewed checkout; this also permits backing up an already-installed ticket-04 image without replacing it first. Image upgrades accept two matching-release GHCR SHA-256 digest references, not mutable tags. Local builds are supported for initial installation, not as an upgrade bypass.

Keep matching source, both original image references (and access to their images), the passphrase file, and each encrypted backup independently of the production host. For a local installation, retain both original images in a protected offline image archive using your existing Docker image retention procedure. A database backup cannot reconstruct an unavailable image. Do not move the production installation to another CPU architecture unless both matching images support it.

The intended host architectures remain Linux `amd64` and `arm64`, including a Docker Desktop Linux VM. The caller reported a working `linux/aarch64` daemon and a ticket-04 web-image build; those reports do not verify these workflows or a clean installation. No host Node, age, queue, or administration platform is introduced.

Backups contain:

- A consistent SQLite online snapshot, including accounts, credential hashes, sessions, menu, orders, lifecycle audit, and push state. A live `cp` of SQLite/WAL is never used.
- The original complete `.env`, including `AUTH_SECRET`, `SETUP_TOKEN`, optional VAPID keys, stable address and image references.
- Complete persistent Caddy `/data` and `/config`, including root and intermediate CA private keys and certificates. Both storage trees must remain byte-stable across copying; a concurrent renewal/config change aborts the backup and requires retry. All four local CA identity files must exist. Caddy can remain active during daily backups.

Only the public `root.crt` may be distributed to clients. Never distribute the bundle, passphrase, `.env`, Caddy directories or any private key to clients. Anyone holding both the bundle and passphrase can impersonate the installation. Protect Docker access and the host directory; mode bits do not protect against a host administrator.

## Configure an actual off-server destination

Provision a separate trusted backup server, a dedicated restricted SSH account, an existing private backup directory with mode 700, and `sha256sum` on that server. This must actually be a different machine/storage failure domain, not localhost, a local alias or a mounted directory on this host. Confirm its host-key fingerprint independently, install it in the operator's known-hosts file, and configure noninteractive key authentication. Use SSH configuration for a nondefault port or identity file; script arguments cannot contain SSH options. Restrict SSH keys on both ends. Do not put credentials in the hostname, remote path or configuration file.

Create a high-entropy passphrase file outside the checkout, with an absolute path:

```sh
umask 077
openssl rand -hex 32 > /protected/operator/office-backup.pass
chmod 600 /protected/operator/office-backup.pass
```

Use an existing operator-owned protected directory. The file must be regular, not a symlink, with no group/other permissions and 32–4096 bytes. Its complete bytes, including any trailing newline, are the passphrase. Escrow an identical copy separately from backups and the production host through an authenticated private channel. A lost passphrase cannot be recovered. It is read from a read-only file mount, never from environment variables or command-line secret values; Docker inspection reveals only its path, not its contents.

Create mode-600 `.backup.conf` in the deployment root using a private editor:

```text
BACKUP_HOST=office-backup@backup.example.com
BACKUP_DIRECTORY=/srv/private-office-backups
BACKUP_PASSFILE=/protected/operator/office-backup.pass
```

Use exactly one unquoted, nonempty line per key. The file is parsed, never sourced. Hostnames accept `user@hostname` with ordinary letters/digits/dots/dashes/underscores in the user; remote directories accept only absolute simple paths without spaces, shell syntax or dot segments. Deployment/passphrase paths cannot contain commas. The script does not create the remote directory or alter SSH trust. Backups use strict known-host verification and batch mode; SSH failures stop the operation. Do not configure competing exported Compose variables in the operator shell.

## Daily backup and monitoring

```sh
sh scripts/backup.sh
```

The script runs `docker compose exec -T api` against the running API, opening its existing `/data/office.sqlite` directly with `better-sqlite3` in read-only mode and calling `backup()`. It never calls the application's migrating database opener. The snapshot must pass SQLite `integrity_check` and `foreign_key_check` before packaging. Writes can continue; sustained writes may delay/restart SQLite's online backup. A stopped/missing API causes daily backup to fail, not silently fall back to copying files.

The tar archive is encrypted using Node's standard AES-256-GCM implementation and a fresh random 16-byte scrypt salt and 12-byte nonce. Format version `OFFICE01` uses scrypt's Node 24 defaults (N=16384, r=8, p=1), a 32-byte derived key, and a 16-byte authentication tag. The entire 36-byte version/salt/nonce header is authenticated. Decryption must authenticate completely before archive listing/extraction or installation changes. This is authenticated encryption, not unauthenticated `openssl enc` or a home-grown encryption/MAC construction.

A unique encrypted `.office` file is transferred with SCP. The remote server then sets mode 600 and computes SHA-256 over the actual stored file. Success requires that checksum to match the local encrypted artifact. Only then does the command exit successfully, print `Off-server backup verified`, and write a mode-600 `.backup-receipts/NAME.receipt` containing verification time, artifact basename and encrypted-artifact hash. A local archive alone, an SCP exit alone, or an old receipt cannot authorize an upgrade. Receipts are operational evidence, not signed attestations or reusable migration tokens. Transfer logs never include secret values. Interrupted/failed transfers can leave unusable remote files; do not treat them as verified backups.

Private plaintext staging is created under mode-700 `.office-ops.*` and removed by a container cleanup handler on normal exit/failure/signals. A host power loss, SIGKILL, or failed Docker daemon can leave staging behind. Restrict access, confirm no operation is active, then remove only that staging directory using privileged operator access if needed. Do not remove original volumes or `.env`. Plaintext removal is not guaranteed physical secure erasure on SSD/VM filesystems; use encrypted host storage.

Example daily operator crontab entry (replace paths; create the protected log beforehand):

```cron
15 2 * * * cd /srv/office-service && /bin/sh scripts/backup.sh >> /protected/operator/office-backup.log 2>&1
```

Configure cron's PATH to include Docker, OpenSSH and OpenSSL, and run as the same Docker-authorized operator with the correct context and known-hosts file. POSIX atomic `mkdir` locking works without Linux `flock` and is shared with install/upgrade/restore. Arrange cron failure mail or your existing host monitoring, review exit failures and daily receipt timestamps, and periodically compare the remote file checksum with its receipt. A receipt proves transfer at that time, not future retention. Set and monitor a remote retention/disk-capacity policy; scripts never delete old backups. Rehearse restores regularly and after release changes. Daily backup implies up to a day's data loss after a total host failure, more if scheduled jobs have failed.

## Backup-guarded image upgrade

Prepare the matching reviewed release source locally without changing `.env`, volumes, or running images. Keep backup configuration, known-host trust and cached old images available. Do not pull/build the new images beforehand as an upgrade procedure. Pass the actual paired published references:

```sh
sh scripts/upgrade.sh \
  'ghcr.io/owner/repository-api@sha256:REPLACE_WITH_64_HEX_DIGEST' \
  'ghcr.io/owner/repository-web@sha256:REPLACE_WITH_64_HEX_DIGEST'
```

Type exactly `yes`. The script validates references, gracefully stops the API to prevent writes after the recovery point, takes a consistent snapshot through a disposable helper on the same volume, verifies encrypted off-server transfer, then and only then pulls the new images. Caddy remains active, but ordering is unavailable during maintenance. A failed backup prevents all image pulls and migration. No old receipt or environment bypass is trusted.

After transfer succeeds, an explicit migration CLI in the new image applies the checked-out migrations transactionally. Only after migration and integrity verification succeed is `.env` atomically replaced with its original secret/address/VAPID values and the new image references. Startup uses already-prepared images, never builds/pulls implicitly. The API readiness request must succeed before the script reports upgrade completion. If the API is still starting, the command fails actionably rather than claiming readiness; check it privately and retry startup/readiness with the same new images, not an image downgrade. Confirm Caddy/trusted HTTPS and ordering from a client as well.

Production normal startup initializes a genuinely new database, but refuses unapplied migrations on an existing database without changing its contents. A normal restart with an already-applied schema is allowed. The only migration entry point used by the upgrade procedure is the explicit CLI after that invocation's successful off-server backup. An administrator with Docker access could bypass scripts; scripts are not a security boundary against the host owner. Do not invoke the migration CLI manually or recreate services with unapproved images.

Failure recovery:

- **Backup failure:** API stays stopped; existing data/config/images remain. Repair SSH/storage/passphrase issues and retry the upgrade. If abandoning the upgrade, restart the unchanged old API only, using the original `.env` and cached old images.
- **Pull failure:** Verified backup exists, original configuration/data remain and API stays stopped. Repair registry access and retry. Restarting the unchanged old API is safe only before any migration has run.
- **Migration failure:** Preserve stopped original volumes and configuration. The migration transaction rolls back SQL errors, but never assume a subsequent image downgrade reverses a migration or any completed changes. Investigate privately; either fix the release and repeat the backup-guarded procedure or restore the verified pre-upgrade backup onto a clean replacement.
- **Startup/readiness failure after migration:** Keep new configuration and all volumes. Retry startup with those exact new images after correcting the cause, or use clean-replacement restore. Do not run an old image against migrated data.

For an unchanged old API before migration, or retrying the exact new deployment after migration:

```sh
docker compose --env-file .env -f compose.yaml -p office-service up -d --no-build --pull never
docker compose --env-file .env -f compose.yaml -p office-service exec -T api node -e 'fetch("http://127.0.0.1:3000/api/setup").then(r => { if (!r.ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; });'
```

This is recovery, not permission to replace images without a verified backup. No scripts delete original databases/volumes, prune storage or claim automatic rollback.

## Restore onto a clean replacement

Use a new trusted host/Docker context with no Office Service containers, `.env`, or any of its three named volumes, even empty ones. Restore refuses existing installations instead of offering destructive replacement. Keep the original host offline during cutover to prevent divergent writes and duplicate background push sends. Prepare the exact source release and cached original API/web images corresponding to the chosen backup. Fetch the encrypted file from the backup server through authenticated SSH and compare its SHA-256 to the recorded receipt. Restore the separately escrowed passphrase file with mode 600. Do not run the installer first.

Use the explicit absolute artifact/passphrase paths and the original, locally cached API reference:

```sh
sh scripts/restore.sh \
  /protected/recovery/office-TIMESTAMP-RANDOM.office \
  /protected/recovery/office-backup.pass \
  'ghcr.io/owner/repository-api@sha256:ORIGINAL_64_HEX_DIGEST'
```

For an original local install, the third argument is its retained original `office-service-api:local` image, not a freshly rebuilt version. Type exactly `yes`. Helpers never pull an image during restore. Authentication, archive-path/type validation, database integrity and CA completeness are checked in private staging before any installation volume is created. Archive extraction permits only the expected database, configuration and Caddy trees, regular files/directories; traversal, symlinks, hardlinks, duplicate entries and special files are rejected. Only then are new empty volumes populated and the restored `.env` installed without overwriting an existing file. The database is assigned to the API's UID/GID 1000. Caddy private-file permissions remain restricted. No service starts automatically.

If authentication/validation fails, fix the artifact/passphrase/source selection and retry; installation storage is untouched. If copying fails, partial replacement volumes are retained and services remain unstarted. Preserve the original host and backup and use another clean replacement; never delete original storage to make a retry pass. Deployment secrets and passphrases must not be written to incident logs.

On successful restore, with the backup's original image references still in `.env`:

```sh
docker compose --env-file .env -f compose.yaml -p office-service up -d --no-build --pull never
```

Do not build, migrate, rotate secrets/keys or substitute new images during this recovery. Reassign the original stable `OFFICE_ADDRESS` only after taking the old server offline. If that address cannot be retained, plan a separate origin/DNS/push-subscription migration; this restore does not invent one.

Before accepting writes, copy **only the public root certificate** as described in `deployment.md` to a fresh filename and compare its OpenSSL SHA-256 fingerprint with the original independently recorded fingerprint. Byte-identical original CA storage is restored, so already-trusting devices should not require a new root. Verify this on actual office devices without bypassing TLS warnings. Confirm login with an existing account, saved order contents/status/history, and optional push configuration. Restart containers and reconfirm login, orders and root fingerprint. Then configure daily backup on the replacement with the retained passphrase and a real separate destination. Keep the original host/storage offline until recovery has been accepted under the operator's retention policy.

## Caller verification handoff

No checks were run for this implementation, as instructed. These are prepared commands, not recorded successful outcomes:

```sh
pnpm exec vp test apps/api/src/operations.test.ts apps/api/src/operations-scripts.test.ts
pnpm typecheck
sh -n scripts/operations.sh scripts/backup.sh scripts/upgrade.sh scripts/restore.sh scripts/install.sh
```

`operations.test.ts` exercises real SQLite online backup concurrent with API order creation, login after restart/clean restore, complete prior order status/content/audit, configuration/VAPID and CA byte identity, empty-target protection, authenticated-encryption tampering/wrong keys, unsafe archives and production migration gating. `operations-scripts.test.ts` runs the real shell scripts with only external Docker/SSH/SCP boundaries replaced: transfer/checksum ordering before pull/migration/startup, transfer/checksum failures blocking upgrades, migration-failure recovery, secret-free output and existing-target refusal. These do not prove actual Docker mounts, SSH transfer, cron execution, OS client trust or native images work.

On a disposable real deployment, the caller must record commands, exit codes and decisive non-secret outcomes for:

1. Clean installation and first-admin login; this remains unverified despite the reported web-image build.
2. Concurrent real order submissions during `sh scripts/backup.sh`, successful remote SHA-256 comparison and a receipt; inspect restored data for complete order/item/audit transactions.
3. A container restart with unchanged login/orders and independently recorded root fingerprint.
4. A reviewed paired-image `upgrade.sh` success after verified off-server transfer, unchanged secrets/CA and successful client workflows.
5. A deliberately unavailable SSH destination causing nonzero upgrade exit with no pulls/migrations/startup, and a failing migration leaving the API stopped with originals retained.
6. `restore.sh` with explicit paths on a clean replacement, existing-account login and prior order contents/status/audit, identical root/key bytes and actual device trust; then restart and repeat. Also prove wrong-passphrase/tampered-artifact rejection leaves no installation volumes.
7. At least one unattended cron execution and operator-visible failed-job monitoring. Exercise both intended architectures before claiming multi-architecture runtime support.

Actual encrypted off-server transfer, migration/startup under Docker, restore/cutover, device CA trust and the automated tests above are unverified until the caller executes and records them. Do not mark the ticket's demonstration/verification criteria complete based solely on prepared tests or this document.

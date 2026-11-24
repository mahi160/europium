# Implementation verification

Production-readiness tickets 01–13 are implemented. No registry publication, production migration, live deployment cutover, or real-phone verification was performed.

## Production-readiness checks

Verified at `b116ce0`:

| Command | Outcome |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 96 passed across 16 files. |
| `pnpm exec playwright test` | 22 passed. |
| `pnpm exec playwright test --config playwright.ui.config.ts` | 20 passed. |
| `pnpm --filter @office-service/web build` | Passed. Nonblocking bundle-size and plugin deprecation warnings remain. |
| `pnpm exec playwright test --config playwright.pwa.config.ts` | 9 passed, including two-build activation, old precache cleanup, and protection for unsent drafts and open dialogs. |

## Ticket 14: Real-device acceptance

Run these steps on the office network with an Android phone using Chrome and an iPhone using Safari. Use test employee and staff accounts and two approved builds. Record the build IDs, device model, OS and browser versions, elapsed times, and failures below. Do not include credentials, push endpoints, or private keys.

1. On each phone, trust the office root CA using [the deployment guide](deployment.md). Confirm the office HTTPS address opens without a certificate warning. Install from Chrome on Android, or use **Share → Add to Home Screen** on iPhone. Launch the installed app.
2. Sign in as staff and enable notifications explicitly. Lock both screens, then place a test order from a separate employee session. Record the time until the initial push. Tap it and verify it opens the staff queue. Lock both screens again without accepting the order; verify the reminder arrives after about five minutes. Complete or reject the test order after recording the results.
3. Leave the installed app open with no unsent draft or open dialog. Deploy the second approved build through the office upgrade process, then return the app to the foreground. Verify the new build loads without reinstalling. Repeat with a draft if another approved build is available: verify the update notice appears, the draft remains intact, and the app updates after sending or clearing it and tapping Reload.

| Device / OS / browser | Builds | HTTPS and install | Locked push / tap | Five-minute reminder | Update without reinstall | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Android / not recorded / Chrome | Not tested | Not tested | Not tested | Not tested | Not tested | Pending device run. |
| iPhone / not recorded / Safari Home Screen | Not tested | Not tested | Not tested | Not tested | Not tested | Pending device run. |

## Earlier recorded checks

| Command | Outcome |
| --- | --- |
| `pnpm test` | 78 passed across 12 files after the approved authorization-test correction. |
| `pnpm exec playwright test`; focused `pnpm exec playwright test e2e/accounts.spec.ts e2e/fulfillment.spec.ts` rerun | All ten journeys verified: nine passed in the full run; the failing fulfillment journey and its preceding account journey both passed after the select-label fix. |
| `pnpm exec playwright test --config playwright.pwa.config.ts` | All five passed, including new initially-denied notification coverage. |
| `pnpm typecheck` | Passed after all implementation changes. |
| `pnpm lint` | Passed with one nonblocking unnecessary-spread warning in `apps/api/src/events.test.ts:117`. |
| `pnpm --filter @office-service/web build` | Passed, including vite-plugin-pwa injectManifest generation. Nonblocking main-chunk-size and plugin deprecation warnings remain. |
| `sh -n scripts/operations.sh scripts/backup.sh scripts/upgrade.sh scripts/restore.sh scripts/install.sh` | Passed. |
| `docker compose -f compose.yaml config --no-env-resolution --no-interpolate --quiet` | Passed. |
| `docker build --target web -t office-service-web:verification .` | Passed on Linux ARM64 before the PWA changes. Not evidence of the final PWA web image. |
| `docker build --target api -t office-service-api:verification .` | Passed on Linux ARM64 after ticket 07. |
| `docker run --rm -e OFFICE_ADDRESS=192.168.50.20 office-service-web:verification caddy validate --config /etc/caddy/Caddyfile` | Passed. This validates configuration, not trusted LAN browser access. |

A disposable native ARM64 API-image smoke check also ran with `NODE_ENV=production`: initialize a database, create an administrator using random test credentials, close/reopen it, sign in again, and make a consistent SQLite snapshot. A second container successfully ran `operations-cli.ts snapshot` with the stopped database volume mounted read-only and a read-only container root. Both exited zero. Only the check's own temporary volume and staging directory were removed. This proves native module loading and those persistence/backup paths, not a complete Compose installation or actual container restart/cutover.

The ten focused ticket-07 tests passed. They exercise real SQLite backup concurrent with order creation, login and full order/audit restoration, authenticated encryption, CA-byte preservation, archive validation, production migration gating, and shell workflow ordering with external Docker/SSH/SCP boundaries replaced. They do not prove actual off-server transfer or actual device certificate trust.

Chromium screenshots were inspected for the desktop and Bengali phone profile, and desktop/phone staff queues. Browser ordering checks enforce a typical preconfigured order in under 15 seconds at 1440px and 390px. Realtime checks cover ready/refetch races, missed events, native reconnect, heartbeat recovery, offline command guards, foreground return, session revocation and uncertain-response idempotency.

## Resolved automated failures

The user explicitly approved correcting contradictory test expectations and fixtures while retaining employee isolation and adding initially-denied notification coverage. Application authorization and notification safeguards were not relaxed.

1. The ordering test now verifies required staff/admin access to pending-order details, while a separate employee is denied both detail access and cancellation. Privileged users' personal-order lists still exclude another employee's order, and staff/admin cannot cancel that employee's pending order.
2. The fulfillment fixture explicitly sets its administrator's saved language before asserting English content, independently of the preceding bilingual account journey. This exposed a real form-label issue: wrapping select options inside labels prevented exact label lookup. Queue status/assignee filters and the same menu-category pattern now use separate labels and controls linked with instance-specific `htmlFor`/`id`, following the existing form style. The employee-to-staff-to-admin-requeue journey now passes without weakening its selectors.
3. The scripted permission-rejection test explicitly starts at `default` and changes to `denied` after the user's button click. A separate test starts at `denied`, verifies that permission is never requested, and proves staff can still accept work. Both run against the production PWA build. Real browser/OS permission prompts and device delivery still require hardware evidence.

No known automated test failures remain. The checks above do not replace the deployment/device acceptance checks below.

## Unverified acceptance evidence

- A clean installer run, rerun, real Compose container restart and certificate-trusted LAN browser access.
- Published paired AMD64/ARM64 images and AMD64 runtime compatibility. The workflow is prepared but was not executed.
- A scheduled daily execution, actual encrypted SSH/SCP transfer to a separate backup host, successful paired-image upgrade and clean replacement-host restore.
- Actual retained CA trust on office devices after restore. Tests preserve CA bytes; they cannot establish OS trust.
- Supported Android and iPhone Home Screen installation, private-CA HTTPS, initial/reminder push delivery and notification navigation on hardware.
- A complete final visual-inspector/formatting gate. Screenshots were inspected manually; no automated formatting rewrite was performed.

Use the deployment and backup documents for the operator-controlled checks. Failed or missing evidence must not be treated as production acceptance.

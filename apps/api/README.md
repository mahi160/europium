# Backend contract

The backend runs on Bun 1.4.5 (`bun:sqlite`) at port 3000. Install with `pnpm install`, then run `pnpm dev:api` (development, `bun --watch apps/api/main.ts`) or `pnpm exec vp run api:start`. Production ships as the compiled `office-api` binary with migrations embedded; `office-api migrate <db>` and `office-api snapshot <db> <dest>` are its maintenance subcommands. Configure these environment variables before starting:

- `AUTH_SECRET`: a random secret of 32–256 characters.
- `SETUP_TOKEN`: a separate operator-held random token of 32–256 characters. Give it only to the person initializing the service; do not bundle it into frontend code.
- `APP_ORIGIN`: the exact browser origin, without a trailing slash; use `http://localhost:5173` in development and HTTPS in production.
- `DATABASE_PATH`: the persistent SQLite file path.

Vite's development proxy forwards `/api` from port 5173 to port 3000. Use same-origin requests and cookies, not the Better Auth browser client. No raw Better Auth router is mounted. All mutations require `Origin: APP_ORIGIN`, `Content-Type: application/json`, and a JSON body (including `{}` for logout). Bodies are limited to 16 KiB of actual streamed bytes. Do not expose production sessions over plain HTTP.

## Routes

All paths below are exact. Successful responses are JSON except the SSE stream; setup and user creation return 201, and the other routes in this table return 200.

| Method | Path                          | Request type        | Response type                 | Permission                                   |
| ------ | ----------------------------- | ------------------- | ----------------------------- | -------------------------------------------- |
| GET    | /api/setup                    | None                | SetupStatusResponse           | Public                                       |
| POST   | /api/setup                    | SetupInput          | UserResponse                  | Operator token; uninitialized only           |
| POST   | /api/auth/login               | LoginInput          | UserResponse                  | Public                                       |
| POST   | /api/auth/logout              | Empty object        | SuccessResponse               | Signed in, including temporary password      |
| GET    | /api/auth/get-session         | None                | SessionResponse               | Public; user is null without a valid session |
| GET    | /api/events                   | None                | SSE: ready, heartbeat, change | Same-origin; signed in; password changed     |
| POST   | /api/auth/change-password     | ChangePasswordInput | UserResponse                  | Signed in, including temporary password      |
| PATCH  | /api/me                       | UpdateProfileInput  | UserResponse                  | Signed in; password changed                  |
| GET    | /api/users                    | None                | UsersResponse                 | Administrator; password changed              |
| POST   | /api/users                    | CreateUserInput     | UserResponse                  | Administrator; password changed              |
| PATCH  | /api/users/:id                | UpdateUserInput     | UserResponse                  | Administrator; password changed              |
| POST   | /api/users/:id/reset-password | ResetPasswordInput  | SuccessResponse               | Administrator; password changed              |

Setup does not sign the administrator in. Log in afterwards. Login sets an HttpOnly, SameSite=Lax session cookie (Secure with an HTTPS origin). Session tokens and synthetic emails are never returned in JSON.

## Shared types

Schemas and types are exported by `@office-service/shared` from `packages/shared/src/index.ts`.

- `Role`: `employee | staff | admin`. These administration permissions do not prohibit personal ordering by any role.
- `Language`: `bn | en`. The database default is Bengali.
- `PublicUser`: `{ id, name, username, role, language, floor, desk, isActive, mustChangePassword }`.
- `SetupInput`: `{ name, username, password, language, floor, desk, setupToken }`.
- `LoginInput`: `{ username, password }`.
- `CreateUserInput`: `{ name, username, password, role, language, floor, desk }`.
- `UpdateProfileInput`: a nonempty subset of `{ name, language, floor, desk }`.
- `UpdateUserInput`: a nonempty subset of `{ name, role, language, floor, desk, isActive }`.
- `ChangePasswordInput`: `{ currentPassword, newPassword }`, which must differ.
- `ResetPasswordInput`: `{ newPassword }`.
- `UserResponse`: `{ user: PublicUser }`.
- `SessionResponse`: `{ user: PublicUser | null }`.
- `UsersResponse`: `{ users: PublicUser[] }`.
- `SetupStatusResponse`: `{ setupRequired: boolean }`.
- `SuccessResponse`: `{ success: true }`.
- `ApiError`: `{ error: { code: ApiErrorCode } }`. Error codes are stable translation keys, defined by `apiErrorCodeSchema`; no backend exception text or stack is exposed.

Usernames are trimmed, lowercased ASCII letters/digits/underscores, 3–32 characters. Names are trimmed, 1–100 characters; floor and desk are trimmed, 0–100 characters (empty string clears them). Administrators use 12–128-character passwords, never trimmed. Employees and staff use exactly four ASCII digits as a PIN, preserved as a string with leading zeros. Creation validates against the requested role; change/reset validates against the current database role. An omitted creation credential defaults to the temporary PIN `0000` for employees/staff, while administrators must supply a valid password. The browser prefills that temporary PIN and allows an override. Non-admin passwords are not accepted. The mandatory first change rejects an unchanged PIN/password with `CREDENTIAL_UNCHANGED`; malformed inputs still return `VALIDATION_ERROR`.

For API compatibility, the `password`, `currentPassword`, `newPassword`, `mustChangePassword`, `/change-password` and `/reset-password` names also carry PINs and their change requirements for non-admin accounts. The browser labels them as PINs. The server derives a username-bound HMAC-SHA256 value using `AUTH_SECRET` before applying Better Auth's salted password hash to a PIN. This keeps a database-only leak from enabling direct enumeration of all 10,000 PINs; it does not protect weak PINs if the server secret is also compromised. Preserve the original `AUTH_SECRET`; changing it requires issuing new PINs. Administrator password hashing and its minimum length remain unchanged.

Unknown input properties are rejected. Profile updates cannot change roles or active/credential flags.

## Security and persistence

Setup hashes the password before a synchronous SQLite immediate transaction that creates the administrator, credential account, and singleton setup row atomically. The database lock and unique singleton protect setup across processes. No asynchronous callback is passed to a SQLite transaction. Versioned Drizzle SQL migrations and their journal live in `migrations/`; they run under the same cross-process write lock. Production startup initializes a new database but refuses pending migrations on an existing database. The server updater snapshots the database and runs `office-api migrate` before switching releases; see `../../docs/deployment.md`.

Better Auth provides username authentication, password hashing, cookie signing, and database-backed sessions. Its email/password signup is disabled. Internal synthetic emails exist only to satisfy its account schema. The admin plugin's create-user API is called privately with the administrator's session headers; public admin/signup/update/password endpoints are not mounted. Installed-source review confirms that createUser can also run server-only without headers, while setUserPassword and banUser require session headers. Reset, deactivation, and password-change wrappers write credentials, flags, and revocations in synchronous transactions rather than exposing those raw operations; setUserPassword itself does not revoke sessions.

Sessions have a fixed 30-day maximum, multiple devices are supported, and cookie caching/session refresh are disabled. Logout revokes the current session. Password changes retain the current session and revoke every other device. Administrator resets revoke every session and set `mustChangePassword`; deactivation bans login and revokes every session without deleting the user. Reactivation does not restore revoked sessions. Fresh database checks enforce roles, active status, and first-password restrictions. Administrator-created users must change their temporary PIN or password; the setup administrator need not. The last active administrator cannot be demoted or deactivated. Migration `0004_pin_credentials` revokes existing non-admin sessions and marks those accounts as requiring a new credential, without deleting accounts or order history. Old non-admin password hashes remain inaccessible through the login wrapper and are overwritten when an administrator issues a temporary PIN. Moving across the administrator/non-administrator role boundary clears the old credential, revokes all sessions and requires an administrator-issued credential of the new kind. Employee/staff role changes keep their PIN.

Setup and login retain SQLite-backed global fixed-minute limits of 10 and 30 requests respectively, including invalid requests. Login additionally shares a five-attempt, fixed-15-minute per-account bucket with current-PIN/password verification. Usernames are normalized before selecting that bucket; unknown usernames receive the same account limit. A successful login/change or an administrator credential reset clears that account bucket. Five failed attempts block even a correct credential until the next window or an administrator reset. All limits persist across backend instances and do not trust forwarded client IP headers. Authenticated sessions are still required for credential changes; a reset revokes all sessions, and a self-change retains only the current one.

## Hub statistics

`GET /api/stats` requires the hub's `Authorization: Bearer …` header. It returns 404 if `STATS_TOKEN` is unset and 401 if the token is missing or incorrect. User sessions do not grant access, and the stats token does not grant access to other routes.

The response contains `generatedAt` (Unix milliseconds), `today: { orders, items }`, and `week: { items, topItems, busiestHour }`. Only Delivered orders count, based on completion time in `OFFICE_TIMEZONE` (default `Asia/Dhaka`). The week starts Monday at local midnight. Item counts sum quantities; the top five names use order-time item snapshots, sorted by quantity then name. Busiest hour counts delivered orders by local hour (0–23), chooses the earlier hour on ties, and is `null` with no deliveries. Individual orders and requester data are not returned.

## Realtime updates

`GET /api/events` is a same-origin, cookie-authenticated SSE stream for signed-in users who have changed their temporary password. A supplied Origin must match `APP_ORIGIN`; Fetch Metadata indicating a different origin (including same-site subdomains) is rejected. Commands remain ordinary HTTP requests. A single backend keeps only live subscriptions in memory; SQLite remains authoritative. There is no broker, replay log, or client-side order store.

After registration, the server sends `event: ready`, then `event: heartbeat` every 15 seconds and `event: change` after committed changes. A change can carry only its kind (`menu`, `order`, or `user`) as a refresh hint. A coalesced change, ready, and heartbeat send `data: {}`; ready also supplies `retry: 3000`. No identifiers, personal content, or session tokens are sent. Changes are coalesced under backpressure, not replayed. Employee notifications cover their own orders; staff notifications follow the pending queue, current assignment, and permitted terminal history. Removal from the pending queue invalidates its previous viewers too. Administrators see all changes; menu changes reach all authorized users. Replays, failed transactions, and unchanged menu/profile updates do not publish.

Every send and heartbeat checks the current database session, expiry, active/password flags, and role. Revocation or a changed role terminates the stream. Disconnect, request abort, backpressure timeout, and `createApp.close()` remove subscriptions and heartbeat timers. Server shutdown closes streams before waiting for HTTP connections.

The authenticated shell uses native EventSource reconnection and a 45-second heartbeat watchdog. It reconciles session and query data on ready after each connection, checks session on heartbeat or error, and uses change hints to refresh the affected query families. Registration before ready plus authoritative refetch avoids the initial fetch/subscription gap; reconnect requires no replay. Reconciliation invalidates only the current user's scoped menu, orders, work-orders, and users queries, and refreshes the session query. A failed session fetch does not mean logout and does not delete a saved draft. Offline commands are rejected before fetch; form submissions, saved-language changes, and logout controls are disabled, never queued. Uncertain order responses retain the frozen draft and original idempotency key for explicit retry.

Mobile operating systems can suspend both SSE and JavaScript timers while an app sleeps. Live delivery is not guaranteed during suspension. Pagehide closes the stream and watchdog. Foreground visibility, pageshow, and focus leave a healthy stream alone and open a connection only if needed. A quick reconnect can keep the Live badge while reconciling; Retry appears only when disconnected or offline.

## Installation and Web Push

The production frontend uses `vite-plugin-pwa@2.0.0` with a custom `injectManifest` worker. Its installed peer range includes Vite 8; this workspace keeps the `vite@*` override to `@voidzero-dev/vite-plus-core@8.3.8000`. Installed plugin source uses Vite's `build` API for the worker. This is a source/peer compatibility review, not a successful build claim. Local PNG icons are included at 192, 512 and Apple touch sizes, including a maskable 512 icon; regenerate them with `node scripts/generate-icons.mjs`. The manifest supplies the launch background/icon and the existing responsive shell preserves Hind Siliguri and the green/white palette. It does not claim device-specific iPhone splash-screen verification.

Optional environment configuration:

- `VAPID_PUBLIC_KEY`: uncompressed P-256 public key in unpadded base64url.
- `VAPID_PRIVATE_KEY`: matching P-256 private key in unpadded base64url.
- `VAPID_SUBJECT`: operator contact, normally `mailto:operator@example.com` (or a valid HTTPS contact URL).

All three must be valid and consistent. Missing/inconsistent configuration disables notifications only; login, ordering and staff work remain available, and Profile explains the unavailable state. The API never returns the private key, session tokens or subscription records. Do not log push errors: provider errors can contain endpoints or payloads. The server logs only a generic scheduling failure.

| Method | Path                   | Contract                                                                                     |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------- |
| GET    | /api/push/config       | Authenticated; `{ publicKey: string \| null }`                                               |
| POST   | /api/push/subscription | Authenticated, changed password; `{ endpoint, keys: { p256dh, auth } }`; `{ success: true }` |
| DELETE | /api/push/subscription | Same permissions; `{ endpoint }`; deletes only the current session's binding                 |

Subscriptions are unique by endpoint and bound to the current user and database session. Re-registering a device safely replaces its previous account/session binding; the old session cannot delete the new binding. An already-approved browser subscription is rebound after sign-in without requesting permission again. Profile's explicit button is the only permission request or new browser subscription path. Logout cascades the current session's subscriptions; reset/deactivation cascade all revoked sessions, and password change retains only the current session. Expired, inactive, temporary-password and demoted staff recipients are rechecked before each external send. Already accepted external pushes cannot be recalled after a status change, logout or account switch.

Only HTTPS endpoints on `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com` and single-label `*.push.apple.com` are supported. Credentials, custom ports, fragments, private-LAN endpoints and arbitrary providers are rejected; there is no configurable SSRF bypass or private push provider. P-256 points are validated, subscription keys are bounded canonical base64url, and HTTP bodies retain the global 16 KiB limit. Provider redirects are not followed by the installed transport. Operators must keep DNS/network egress trustworthy.

SQLite migration `0003_push` installs transactional history triggers: every committed pending generation has a durable schedule, nonpending transitions remove it immediately, and employee transitions have a durable output row. This avoids a commit-to-schedule gap. One interval in the server entry point polls every second; `createApp` starts no reminder timer. Each pending generation initially alerts all active subscribed **staff** (not administrators), then alerts every five minutes. Requeue restarts the initial alert and five-minute schedule. Existing pending orders on upgrade start with a reminder. A late tick sends one alert and schedules the next for five minutes from that tick, never replays missed intervals. Each external staff send rechecks pending status and the exact history generation, including after another send yields.

When staff accepts a request, other active subscribed staff (excluding the acceptor and the requester) receive a `claimed` push naming who requested it and who accepted it; it links to `/work` and is skipped if the request has moved on. Staff also see the same notice in the work queue: `GET /api/work/acceptances` returns up to five claims by others from the last ten minutes that are still accepted, refreshed through the existing realtime invalidation.

Employee output covers acceptance, delivery, rejection, and requeue, including each event's reason when present; requester cancellation produces no output. Rapid transitions retain their historical employee messages rather than pretending an earlier event did not happen. Text comes from `packages/shared/src/notifications.ts`, formatted in the worker using each recipient's saved language at send time. Staff payloads intentionally carry only event kind, language and a safe order target, no free-text notes, reasons, credentials or personal details. Employee payloads add the applicable reason.

Push is best-effort, not an order transaction dependency. Schedules/output are claimed durably before transport; a crash at that boundary may lose that alert, never an order, and does not create an external-send replay. Errors do not roll back orders; 404/410 prune the matching invalid device, other failures retain the subscription for future events/reminders. A transport timeout is ten seconds; push TTL is 60 seconds. There is no delivery receipt or guarantee of exactly-once external delivery. Run only the supported single API process/loop.

Clicks accept only same-origin `/orders?order=UUID` or `/work?order=UUID`. The route retains the target while showing sign-in for an expired session, then fetches the normal authorized detail endpoint independently of queue filters. Another account receives not-found, not the order. Cached assets contain no account data. The worker precaches build assets and serves the shell only for known application navigation paths; it does not intercept/cache authenticated APIs, queue commands, or report offline submissions as successful.

Use trusted HTTPS and allow **both server and devices** internet access to their platform push services even when the app itself is LAN-only. iOS/iPadOS 16.4+ requires Safari → Share → Add to Home Screen, then launch that app and explicitly enable notifications. A private CA must be installed and fully trusted; trust in Safari alone is not evidence that platform push works. Denied/unsupported notifications do not block staff workflows.

### Ticket 06 verification handoff

Prepared integration coverage in `src/push.test.ts` uses real temporary SQLite, real authentication and an injected **external** push transport/clock, not mocked project modules. It covers pending-only timing, stop/requeue races between sends, durable restart, no downtime replay, localization/reasons, failures, pruning, session rebinding, logout, reset/deactivation/expiry, strict validation and disabled configuration. Shared tests cover translation resources and safe targets. `e2e-pwa/installation.spec.ts` uses the built worker and real HTTP routes for manifest/PNG/cache boundaries, mobile-width layout, explicit permission denial (OS boundary only), sign-in target preservation and authorized focused detail. Its permission simulation is not real delivery evidence.

The caller owns final verification; no tests, typecheck, lint, formatting check or build were run for ticket 06. Exact commands from the repository root:

```sh
bun --bun vitest run apps/api/src/push.test.ts packages/shared/src/notifications.test.ts apps/web/src/locales/resources.test.ts
pnpm typecheck
pnpm lint
pnpm fmt --check
pnpm --filter @office-service/web build
pnpm exec playwright test --config playwright.pwa.config.ts
```

The PWA browser configuration builds and previews the production app on localhost:5184 with a separate real backend on localhost:3014 and ephemeral generated VAPID keys. These keys are never printed. The existing browser configuration remains unchanged. Known legacy ticket-02 pending-detail and fulfillment-language fixture assertions are left untouched.

**Unverified:** real supported Android and iPhone installation, launch appearance, certificate trust, iOS Home Screen/private-CA HTTPS behavior, explicit native permission, actual initial/reminder delivery and OS notification-click navigation. No hardware was available. On each real device, establish certificate trust, install/launch from Home Screen, enable explicitly, submit a pending request, observe initial and five-minute alerts, accept/reject/cancel to stop reminders, requeue to restart, test saved Bengali/English text and reasons, and open the notification after session expiry. Also confirm logout/reset/deactivation stop future device sends and no other account can view the target. Keep this criterion unverified until that evidence exists.

## Integration tests

`createApp(config)` exports `{ app, db, sqlite, auth, close }` and applies persistent migrations in development/tests or for a new production database; existing production databases are migrated explicitly by `office-api migrate` during the update. Tests use real temporary SQLite files and real Better Auth, without mocking application modules. They cover setup races on independent connections, durable sessions, login/logout, reset/deactivation revocation, first-password gates, role enforcement, last-administrator protection, strict validation, body limits, Origin checks, and shared rate limiting.

`src/events.test.ts` prepares real SQLite/SSE coverage for authorized notifications, content-free frames, idempotent replay, ready reconciliation, missed events, server restart, expiry, revocation, role changes, and stream cleanup. `src/events-recovery.test.ts` adds origin enforcement, transaction rollback without publication, and HTTP reset/deactivation/logout terminating concurrent subscriptions. `e2e/realtime.spec.ts` prepares independent employee/staff live views, network recovery, revocation, and frozen-draft retries. `e2e/realtime-recovery.spec.ts` adds a real-response fetch/event race, page-return reconciliation, suspended status, offline command controls, native reconnect without retry clicks, and a heartbeat-watchdog replacement after simulated device sleep. Both realtime browser fixtures conditionally initialize the office, create unique users, and explicitly save English for the administrator.

Tests, typechecking, linting, and formatting have deliberately not been run; the frontend caller owns final verification. The prepared commands are `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm fmt --check`.

# ARCHITECTURE — Mesh Fire Detection Backend

How the backend is built. Requirements live in `SPEC.md`; conventions in
`AGENTS.md`; running it in production in `DEPLOYMENT.md`.

## Overview

```
Mesh nodes ──LoRa──> Gateway node ──MQTT/TCP──> Mosquitto (MQTT broker)
                                                        │
                                                        ▼
                                          ┌───────────────────────────┐
Website / users ──HTTPS──> Cloudflare ──> Caddy ─────> │ Node 24 app (one process) │
                                          │             │   HTTP routes (Hono)      │
                                          │             │   MQTT subscriber         │
                                          │             │   Scheduled jobs          │
                                          │             │        │                  │
                                          │             │   Services → Repos        │
                                          │             └────────┬──────────────────┘
                                          │                      ▼
                                          │            SQLite ──Litestream──> object storage
```

Everything runs on one VPS. The app is a single Node process containing the
HTTP server, the MQTT subscriber, and the scheduled jobs.

Cloudflare proxies the website and HTTP API only. Gateway MQTT traffic uses
the DNS-only hostname `mqtt.meshfiredetection.org`, which resolves directly to
the VPS; it does not pass through Cloudflare, Caddy, or the HTTP application.
Mosquitto and the Node app are separate processes on the same VPS. The app
subscribes to Mosquitto through its loopback-only listener.

### Notehub entry point

The backend has an opt-in Notehub adapter for this additional path:

```text
Sensor → LoRa → gateway firmware → Notecard → Notehub → HTTPS API
    → validated shared ingest logic → SQLite
```

`NOTEHUB_ENABLED` enables the adapter and requires `MESH_CHANNEL_KEY`, independently
of MQTT. `mesh/notehub/routes.ts` declares public session access with a mandatory
machine credential guard before bounded body parsing and Zod validation. It
accepts `POST /v1/ingest/notehub`; user/admin sessions grant no submission rights.
The service authenticates a gateway-specific bearer token by SHA-256 hash,
checks the Notehub Notecard UID and encrypted envelope's gateway node number,
and decodes telemetry with the same decoder as MQTT.

One outer SQLite transaction covers each batch: authorization, duplicate checks,
shared ingest storage, and durable Notehub receipts. Shared ingest separates
storage from evaluation so alerts run only after the outer commit. Notehub uses
the sensor timestamp (or Notehub capture time for clockless history); MQTT keeps
server receipt-time semantics. History-only readings and device metrics carry
`liveEligible = false`; live battery lookup and rule duration queries exclude
them. Last-heard updates are monotonic.

`notehub_events` stores the globally unique event ID, gateway ID, normalized
content hash, capture time, and server receipt time. `notehub_samples` stores
permanent fingerprints for timestamped source telemetry. `packets_seen.sourceHash`
allows newly decoded MQTT packets to be reconciled with Notehub. MQTT checks
permanent Notehub fingerprints before its ordinary 24-hour packet check. Existing
packet rows have a null hash; clockless cross-path deduplication retains the
24-hour limitation. No records are automatically pruned.

The adapter accepts a single event or an atomic batch of 16, with a 64 KiB body
limit and 4096-byte envelope limit. It returns 200 with `{ inserted, duplicates }`,
400 for invalid data, 401 for missing/invalid credentials, 403 for identity or
enablement failures, 409 for conflicting identities, 413 for request size, and
503 for disabled ingest or storage failure. Retries cannot partially commit.
`/health` includes Notehub status and the latest newly recorded event receipt;
storage failure makes health fail until a successful delivery. Waiting for the
first event is explicit. External monitoring must check receipt freshness.

The Notecard firmware transport and hardware verification remain dependencies.
See [the contract and deployment runbook](NOTEHUB.md) and
[implementation checklist](plans/notecard-ingest.md).

## Source layout

```
src/
  index.ts            entry point: config, ingest, jobs, HTTP, shutdown
  app/                env.ts, runtime.ts, services.ts (wiring), server.ts (routes),
                      jobs.ts, createAdmin.ts (CLI)
  shared/
    auth/             Better Auth instance; session, access guards, roles,
                      and who may receive a sign-in code
    db/               connection, Drizzle schema, migrations runner
    email/            sender interface, Resend adapter, local preview, templates
    http/             error handler, validation, rate limits
    errors.ts         DomainError, thrown by services
    logger.ts, time.ts
  health/             GET /health
  users/              users and invites
  mesh/
    nodes/            registration, the people on a node, approximate positions
    gateways/         which nodes may forward packets
    ingest/           decode.ts, payloads.ts, subscriber.ts (MQTT), service, repo
    network/          builds /api/network.json
    notehub/          HTTPS adapter, cloud identity checks, durable receipts
    readings/         sensor and battery history
    meshId.ts
  alerts/
    rules/            user alert rules
    lifecycle/        alerts, their status changes and events
    evaluation/       rule evaluation on readings, system alert sweep
migrations/           generated SQL (drizzle-kit); never edit a committed one
config/build/         build config, Vitest, Drizzle, contract and runtime checks, hooks
config/deploy/        Caddy, systemd, Mosquitto, Litestream, release script
```

Features are grouped under `mesh/` and `alerts/` to stay within the 7-entries
folder cap.

The development API console is mounted at `/dev` only when `DEV_CONSOLE` is set,
and is absent otherwise. `src/shared/http/validate.ts` registers each Zod schema
as it validates, and `src/shared/http/devConsole.ts` builds the OpenAPI document
from the routes registered on the running app, so the document is derived from
the code rather than maintained beside it. Routes taking no input are included
explicitly, and `/api/network.json` is kept despite looking like a static file.

`tsconfig.json` checks source, tooling, and tests without emitting files.
`config/build/tsconfig.build.json` builds only `src/` into `dist/`. Native package
imports (`#src/*`) resolve to TypeScript with the `development` condition and to
compiled JavaScript otherwise. `@types/node` tracks Node 24.

## Layers

| Layer        | Job                      | Rules                                                               |
| ------------ | ------------------------ | ------------------------------------------------------------------- |
| Routes       | HTTP endpoints           | Thin. Declare access, validate, call a service, return.             |
| Auth         | Sessions and role checks | Every route declares `public`, `user`, or `admin`.                  |
| Validation   | Zod schemas              | Runs before any logic, for HTTP and MQTT alike.                     |
| Services     | Business logic           | No SQL, no HTTP objects. Throw `DomainError` for expected failures. |
| Repositories | All database access      | No business rules.                                                  |
| Database     | SQLite via Drizzle       | Migrations only; never hand-edited.                                 |

The MQTT subscriber sits beside the routes as a second entry point. It decodes
and validates packets, then calls the ingest service.

Repos and services are factories (`createNodeRepo(db)`,
`createNodeService({ repo, clock })`) wired together in `app/services.ts`.
A `Clock` is injected wherever "now" matters, so tests control time.
better-sqlite3 is synchronous, so repos and most services are too; this lets
ingest and alert evaluation run inside real transactions.

## Stack

| Role                | Choice                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| Runtime             | Node 24, TypeScript (ES2025 target), ESM                                      |
| HTTP                | Hono + `@hono/node-server`                                                    |
| Validation          | Zod + `@hono/zod-validator`                                                   |
| API docs            | Deferred (`@hono/zod-openapi` when needed)                                    |
| Database            | SQLite via `better-sqlite3` (WAL mode)                                        |
| ORM and migrations  | Drizzle ORM + `drizzle-kit`                                                   |
| Auth                | Better Auth: emailed sign-in codes, sessions, admin plugin for roles and bans |
| MQTT client         | `mqtt` (MQTT.js)                                                              |
| Packet decoding     | `@meshtastic/protobufs` + `@bufbuild/protobuf`; AES-CTR via `node:crypto`     |
| Rate limiting       | `hono-rate-limiter` (in memory); Better Auth's own limiter on sign-in         |
| Transactional email | Resend, behind a provider interface (see `SPEC.md`)                           |
| Logging             | `pino`                                                                        |
| Config              | `node --env-file`, validated by Zod in `src/app/env.ts`                       |
| Scheduled jobs      | `setInterval` inside the app                                                  |
| Tests               | Vitest, in-memory SQLite, `app.request()`                                     |
| Tooling             | tsx, ESLint, Prettier, Knip, Husky (same as web repo)                         |

## Ingest pipeline

1. The subscriber listens to `MQTT_TOPIC` (e.g. `msh/US/2/e/#`) on our broker.
2. Decode the `ServiceEnvelope`. Drop plaintext packets. Decrypt with the
   channel key: AES-CTR (128 or 256 bit), nonce = packet ID as uint64 LE, then
   sender node number as uint32 LE, then four zero bytes.
3. Decode the `Data` message and its payload by port (telemetry, NeighborInfo,
   Position, NodeInfo; anything else is `other`). Validate the result with Zod.
   Drop and log anything malformed.
4. Check the envelope's gateway is a registered, enabled gateway node.
5. Look up the sender's node number. Drop and log if unregistered or disabled.
6. Drop the packet if the same (`fromNodeNum`, `packetId`) was accepted in the
   last 24 hours.
7. In one transaction: record the packet in `packets_seen`, then route by
   payload:
    - Telemetry → `readings` (every set numeric field), and device metrics
      also → `device_metrics`
    - NeighborInfo → `link_observations` (SNR only)
    - Position and NodeInfo → the node's `reported*` fields
    - If the gateway heard the sender directly (`hopStart == hopLimit`), a
      `link_observations` row from sender to gateway with SNR and RSSI
    - Update the node's `lastHeardAt`
8. After commit, evaluate alert rules for the new readings. A failure there is
   logged and never loses the stored data.

Decoding is pure and tested with packet fixtures built by the same protobuf
and encryption code the firmware uses; no broker is needed.

## Data model

All timestamps are UTC epoch milliseconds. Column names are snake_case in SQL.
Nothing cascades deletes.

**users, sessions, accounts, verifications**: managed by Better Auth with the
admin plugin. `users.role` is `admin` or `user`; `users.banned` means disabled.
`users.status` is ours: `subscriber` or `member`, and only a member can sign in
or hold a usable session (`src/shared/auth/membership.ts`). `users.deletedAt` marks an
account its owner deleted: the row stays for the data that points at it,
scrubbed and unable to sign in (see `erase` in `src/users/repo.ts`).

**invites**: the allowlist. `id`, `email` (unique), `role`, `invitedById`,
`acceptedAt`, `acceptedUserId`, `createdAt`. No token and no expiry: the emailed
code proves the address, and an admin withdraws an invite by deleting it.
`users.nodeJoinRequestedAt` marks the other way to be eligible: asking to join
with a node the browser connected.

**node_members**: the people on a node, all equal. `nodeId`, `userId`,
`addedAt`; primary key `(nodeId, userId)`.

**subscriptions**: project updates, one per person. `userId`, `status`
(`unconfirmed`, `confirmed`, `unsubscribed`), `source` (`footer`, `join`,
`account`, `default`), `consentText`, `confirmTokenHash`, `confirmSentAt`, `confirmedAt`,
`unsubscribedAt`.

**nodes**

| Column                                                                                     | Notes                                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `id`                                                                                       | Primary key: `n-0001` assigned by the server, or chosen by an admin (`cel-01`)     |
| `nodeNum`                                                                                  | Meshtastic node number. Unique.                                                    |
| `hardwareId`                                                                               | Meshtastic `MyNodeInfo.device_id`; survives a reflash. Unique, nullable            |
| `name`, `type`                                                                             | `type` is `base`, `cellular`, `sensor`, `vision`, or null until set                |
| `longitude`, `latitude`, `elevationM`, `antennaHeightM`                                    | Exact location, nullable until deployed                                            |
| `exactPosition`                                                                            | Show the position exactly to everyone; off by default                              |
| `hardware`, `firmware`, `deployedOn`, `note`                                               | Nullable                                                                           |
| `enabled`                                                                                  | Disabled nodes are ignored at ingest and hidden from the map                       |
| `lastHeardAt`                                                                              | Updated monotonically by accepted MQTT packets and eligible live Notehub telemetry |
| `reportedName`, `reportedLongitude`, `reportedLatitude`, `reportedAltitudeM`, `reportedAt` | Last NodeInfo / Position from the node                                             |
| `createdAt`, `updatedAt`                                                                   |                                                                                    |

**gateways**: `nodeId` (primary key), nullable unique `mqttUsername`, nullable
unique `notecardUid`, nullable unique `notehubTokenHash`, `enabled`, timestamps.
At least one transport identity is required by the service. Broker credentials
themselves live in Mosquitto's password file. Notehub tokens are write-only
admin inputs, never returned by registration/list/update responses.

**packets_seen**: `fromNodeNum`, `packetId`, `gatewayId`, `receivedAt`.
Indexed on (`fromNodeNum`, `packetId`, `receivedAt`); not unique (see ingest).

**device_metrics**: `nodeId`, `recordedAt`, `batteryPct`, `voltage`,
`uptimeS`, `liveEligible` (true for existing and MQTT data).

**node_events**: what a browser saw happen to a node while connected: `nodeId`,
`kind` (`connected`, `disconnected`, `restarted`, `malformed`), `at`,
`uploadedById`. Unique on node, kind and time.

**readings**: one row per value, so alert rules work on any metric.

| Column                 | Notes                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| `nodeId`, `recordedAt` | Indexed together, and with `metric`                                       |
| `metric`               | Sensor-provided name, e.g. `environmentMetrics.temperature`               |
| `value`                | Real number                                                               |
| `measuredAt`           | The sensor's own clock, when it has one; matches a reading across sources |
| `source`               | `mqtt`, `notehub` or `browser`; null for rows from before it was kept     |
| `uploadedById`         | Who sent a browser's copy                                                 |
| `liveEligible`         | False for delayed, out-of-order, future, or clockless Notehub history     |

**link_observations**: `fromNodeId`, `toNodeId`, `observedAt`, `snr`,
`rssi` (nullable). The feed uses the newest observation per unordered pair,
with RSSI from the newest observation that had one.

**alert_rules**: `id`, `ownerId`, `nodeId` (null means all nodes),
`metric`, `comparison` (`above` or `below`), `threshold`, `durationS`,
`cooldownS`, `enabled`, `deletedAt` (soft delete), timestamps.

**alerts**

| Column                                   | Notes                                       |
| ---------------------------------------- | ------------------------------------------- |
| `id`                                     |                                             |
| `kind`                                   | `rule`, `offline`, `low_battery`            |
| `ruleId`                                 | Null for system alerts                      |
| `nodeId`                                 |                                             |
| `status`                                 | `open`, `acknowledged`, `resolved`          |
| `triggerValue`, `openedAt`, `resolvedAt` | For `offline`, the minutes since last heard |

**alert_events**: `alertId`, `status`, `actorId` (null when the system acted),
`at`, `note`. Full history of each alert.

**notification_channels**: `userId`, `kind`, `target`, `enabled`. Empty until
notifications are built.

Nothing is deleted automatically. If `readings` grows large, add indexes or
summary tables; do not prune without a decision in `SPEC.md`.

## API

Versioned under `/v1`, except the website feed and health check. Errors are
`{ error: { code, message } }`. List endpoints return `{ <items>: [...] }`;
single resources return `{ <item>: {...} }`.

**Public**

| Method | Path                                       | Returns                                                                                                                                           |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/network.json`                        | `{ nodes: MeshNode[], links: MeshLink[] }`, cached 30 s                                                                                           |
| GET    | `/health`                                  | App, database, and MQTT state; 503 when failing                                                                                                   |
| POST   | `/v1/join`                                 | `{ email, name, withNode? }` → a join code if invited or `withNode`, a sign-in code if already a member, else nothing; always `{ success: true }` |
| POST   | `/v1/subscribe`                            | `{ email }` → a confirmation link unless confirmed or sent in the last day; always `{ success: true }`                                            |
| POST   | `/v1/subscribe/confirm`                    | `{ token }` from that link; 400 once used or after a week                                                                                         |
| POST   | `/v1/auth/email-otp/verify-email`          | `{ email, otp }` → verifies a join code, makes the person a member, signs them in                                                                 |
| POST   | `/v1/auth/email-otp/send-verification-otp` | Emails a sign-in code, to a member only                                                                                                           |
| POST   | `/v1/auth/sign-in/email-otp`               | Exchanges the code for a session                                                                                                                  |
| *      | `/v1/auth/*`                               | Better Auth: `sign-out`, `get-session`, …                                                                                                         |

**User** (logged in)

| Method        | Path                                       | Purpose                                                                                                               |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| GET           | `/v1/nodes/:id/readings?metric=&from=&to=` | Sensor history (default last 24 h, max 31 days, 10,000 rows); 404 if you cannot see the node                          |
| GET           | `/v1/nodes/:id/metrics?from=&to=`          | Battery and uptime history                                                                                            |
| POST          | `/v1/nodes/:id/upload`                     | A browser's copy of readings, events and settings, for the node's people and admins; never live                       |
| GET           | `/v1/nodes/:id/events`                     | Connections, restarts and faults, newest first, for the node's people and admins                                      |
| GET, POST     | `/v1/alert-rules`                          | List (own; admins see all) or create own rules                                                                        |
| PATCH, DELETE | `/v1/alert-rules/:id`                      | Edit or remove own rule                                                                                               |
| GET           | `/v1/alerts?status=`                       | System alerts plus own rule alerts (admins see all), newest 500                                                       |
| PATCH         | `/v1/alerts/:id`                           | `{ status: acknowledged                                                                                               | resolved, note? }` |
| PATCH         | `/v1/me`                                   | `{ name }` → renames yourself; the address and role cannot be changed here                                            |
| GET, PATCH    | `/v1/me/subscription`                      | Own updates setting; `{ subscribed }` turns it on or off                                                              |
| DELETE        | `/v1/me`                                   | Deletes your account (SPEC, Leaving); 409 for the only admin                                                          |
| GET           | `/v1/me/sessions`                          | Where you are signed in, `current` marking this browser; never tokens                                                 |
| DELETE        | `/v1/me/sessions`                          | Signs you out everywhere, this browser included                                                                       |
| DELETE        | `/v1/me/sessions/:id`                      | Ends one of your sessions; 404 if it is not yours                                                                     |
| GET           | `/v1/me/sign-in-methods`                   | `{ methods: [{ kind, removable }] }`, kind `code` or `google`; the emailed code is always there and never removable   |
| DELETE        | `/v1/me/sign-in-methods/google`            | Unlinks Google; 404 if it was not linked. Linking is Better Auth's `POST /v1/auth/link-social`, same address only     |
| GET           | `/v1/nodes`                                | Every visible node, each with `mine`; `details` only on your own                                                      |
| GET, PATCH    | `/v1/nodes/:id`                            | View; edit if you are on it (mesh ID and enabling are admin-only; firmware is not editable)                           |
| GET, POST     | `/v1/me/nodes`                             | Nodes you are on; `{ nodes: [{ nodeNum, name?, hardware?, firmware?, hardwareId?, type? }] }` registers or joins each |

**Admin**

| Method    | Path                   | Purpose                                                                              |
| --------- | ---------------------- | ------------------------------------------------------------------------------------ |
| POST      | `/v1/nodes`            | Register a node with a chosen ID                                                     |
| PATCH     | `/v1/nodes/:id`        | Edit any node, including its mesh ID and enabling                                    |
| GET, POST | `/v1/gateways`         | List or register gateways                                                            |
| PATCH     | `/v1/gateways/:nodeId` | Change MQTT username/Notecard UID, rotate or revoke Notehub token, enable or disable |
| DELETE    | `/v1/gateways/:nodeId` | Stop a node being a gateway, freeing its Notecard UID for another node               |
| GET, POST | `/v1/users`            | List users; invite an address (`{ email, role }`, sends nothing)                     |
| GET       | `/v1/invites`          | Invites not yet used                                                                 |
| DELETE    | `/v1/invites/:id`      | Withdraw an unused invite                                                            |
| PATCH     | `/v1/users/:id`        | Change role, disable                                                                 |

Rate limits: 600 requests per 15 minutes per client on `/v1/*`, 120 per minute
on the map feed, 10 per 15 minutes on joining, subscribing, and on code
requests and verification, plus Better Auth's
sign-in limiter.

## Network feed assembly

- Nodes come from the enabled rows of `nodes` that have everything `MeshNode`
  needs, at the positions anyone may see (`src/mesh/nodes/position.ts`), with
  `status`, `batteryPct`, and
  `lastHeartbeatMin` computed from `lastHeardAt` and the latest non-null
  `device_metrics.batteryPct` at request time.
- Links come from `link_observations` within `LINK_WINDOW_MIN`, between
  enabled nodes. `distanceKm` is the great-circle distance between
  the positions shown, rounded to 0.01 km.
- The response is cached in memory for 30 seconds.

## Alert evaluation

- **On each reading:** load enabled, undeleted rules for that metric on that
  node or all nodes. For each rule:
    - Condition no longer holds and an unresolved alert exists → resolve it.
    - Condition holds, no unresolved alert, the matching streak (readings since
      the last non-matching one) spans at least `durationS`, and the rule's last
      alert for this node opened at least `cooldownS` ago → open an alert.
- **Every 5 minutes (job, and once at startup):** open `offline` alerts for
  enabled nodes heard before but not within `STATUS_OFFLINE_MIN`; resolve
  them when heard again. Open `low_battery` alerts when the latest battery is
  below `LOW_BATTERY_PCT`; resolve when it recovers. Resolve system alerts for
  disabled nodes.
- All status changes write an `alert_events` row.

## Deployment

See `DEPLOYMENT.md` for the runbook.

- **Server:** one Hetzner VPS, Ubuntu LTS.
- **Processes:** the app (systemd), Mosquitto, Caddy (HTTPS, reverse proxy),
  Litestream.
- **Domain:** `api.meshfiredetection.org` → Caddy → app on `127.0.0.1:3000`.
  Mosquitto serves the backend on loopback and gateways on their own port;
  TLS once gateway hardware is confirmed to handle it.
- **Backups:** Litestream streams SQLite to object storage (Cloudflare R2 or
  Backblaze B2). A restore is tested before launch.
- **Monitoring:** an external uptime check on `/health` (503 when failing).
- **Deploys:** GitHub Actions runs `npm run check`, then `npm run check:runtime`
  against the compiled entry point with a temporary SQLite database and MQTT
  disabled. It verifies health, the empty network feed, and clean SIGTERM
  shutdown. `npm run check:contract` compares the actual exported `MeshNode`
  and `MeshLink` types with the web repo at a commit pinned in `ci.yml`, bumped
  in whichever pull request adopts a change to the shape; locally it defaults to
  the sibling `../web` checkout, so it compares against whatever is checked out
  there. On `main`, a second
  workflow builds, uploads a release over SSH, installs production
  dependencies, switches the `current` symlink, restarts, and checks `/health`.
  Migrations run at startup.
- **Optional:** a nightly GitHub Action commits a public snapshot of
  `network.json` for transparency. GitHub is never the live data store.

## Environment variables

| Name                                         | Purpose                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`                               | HTTP listen address (default `127.0.0.1:3000`)                                              |
| `LOG_LEVEL`                                  | pino level (default `info`)                                                                 |
| `DATABASE_PATH`                              | SQLite file path                                                                            |
| `DEV_CONSOLE`                                | Mounts the API console at `/dev` (default off; development only)                            |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | Subscriber connection; unset `MQTT_URL` disables MQTT ingest                                |
| `MQTT_TOPIC`                                 | e.g. `"msh/US/2/e/#"` (quote it in env files)                                               |
| `MESH_CHANNEL_KEY`                           | Base64 channel key (16 or 32 bytes), required with `MQTT_URL` or `NOTEHUB_ENABLED`          |
| `NOTEHUB_ENABLED`                            | Enable authenticated Notehub HTTPS ingest (default false); also requires `MESH_CHANNEL_KEY` |
| `RESEND_API_KEY`                             | Sending; unset writes messages to `EMAIL_PREVIEW_DIR` instead                               |
| `EMAIL_FROM`                                 | The sender address, required with `RESEND_API_KEY`                                          |
| `EMAIL_REPLY_TO`                             | Where replies go; optional                                                                  |
| `EMAIL_PREVIEW_DIR`                          | Where unsent messages are written (default `tmp/mail`)                                      |
| `AUTH_SECRET`                                | Session signing, 32+ characters                                                             |
| `AUTH_URL`                                   | Public URL of the API                                                                       |
| `CORS_ORIGIN`                                | The website's origin                                                                        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`   | Google sign-in's OAuth client; set both or neither, unset turns Google off                  |
| `STATUS_DEGRADED_MIN`, `STATUS_OFFLINE_MIN`  | Node status thresholds                                                                      |
| `LOW_BATTERY_PCT`                            | Degraded status and low battery alerts                                                      |
| `LINK_WINDOW_MIN`                            | How old a link observation may be to appear on the map                                      |

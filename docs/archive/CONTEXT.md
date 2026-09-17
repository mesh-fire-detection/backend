# CONTEXT — Planning conversation summary

A summary of the planning chat that produced [AGENTS.md](../../AGENTS.md), [SPEC.md](../SPEC.md), and
[ARCHITECTURE.md](../ARCHITECTURE.md). It records the questions asked, the owner's answers, and the
reasoning behind each choice, so later work doesn't reopen settled questions.
[SPEC.md](../SPEC.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) are the source of truth. If this file disagrees
with them, they win.

## The request

The project owner asked for a backend for the Mesh Fire Detection network
(website repo: `mesh-fire-detection/web`) with these requirements:

- Node 24 and TypeScript
- Stores data
- An API that receives data from devices
- Validation of device identity, plus device registration
- An API for the frontend
- An API for alerts
- As cheap to run as possible

## What was learned from the web repo

- React + Vite site on GitHub Pages, Node >= 24, ESM, TypeScript 6.
- Tooling: Vitest, tsx, ESLint (no warnings allowed), Prettier (4-space indent,
  no semicolons, single quotes, width 100), Knip, Husky, lint-staged.
- `../../AGENTS.md` rules: feature-first folders, at least 2 and at most 7 entries per
  folder under `src/`, tests in `tests/` mirroring `src/`, never commit unless
  asked, never discard uncommitted changes.
- `src/core/content/network/network.ts` defines `MeshNode` and `MeshLink` and a
  `SOURCE` object whose endpoint is `/api/network.json`. The site currently shows
  14 sample nodes on the "Rattlesnake Ridge branch". Switching to live data is
  meant to be a one-line change.
- Node types: `base`, `cellular`, `sensor`, `vision`. Statuses: `online`,
  `degraded`, `offline`. Sample firmware version is `2.5.9`.

## Questions asked and answers given

| Question | Owner's answer | Result |
| --- | --- | --- |
| How does data reach the server? | Asked for more detail on MQTT | MQTT uplink chosen as the preferred path (see below) |
| What do devices send? | Sensor readings (AQI, humidity, temperature, etc.) and some low-rate cameras | Telemetry drives the design; camera handling deferred |
| How do devices prove identity? | Default is fine; registered devices need IDs | Registered-device allowlist; signing adapted for MQTT (see below) |
| Who can register and see data? | Admins and users, fewer than 100 | Real accounts with `admin` and `user` roles |
| What triggers alerts? | Users set their own rules per use case (e.g. a firefighter wants temperature or AQI thresholds at a specific node). No notifications yet, but they will come. | User-defined alert rules, plus system alerts; notification table reserved |
| Scale? | About 100 nodes in year one | One small server is plenty |
| Hosting? | Will pay for Hetzner; also considered running the backend on GitHub and committing data there | Hetzner chosen; GitHub rejected as the live store (see below) |
| Retention? | Keep as long as possible, don't delete | No automatic deletion anywhere |
| Where does the code live? | New repo, same conventions | `mesh-fire-detection/backend` |
| Camera nodes? | Deferred to a later discussion | Listed as an open question |

## Key reasoning

### MQTT ingest

- Meshtastic nodes have no internet access. A gateway node (e.g. `cel-01`)
  behind an LTE router forwards packets using Meshtastic's built-in MQTT module.
- This works without custom firmware. Meshtastic already sends device metrics
  (battery), environment and air-quality telemetry, NeighborInfo (which nodes
  hear each other, with SNR), Position, and NodeInfo. That covers most of the
  `MeshNode` / `MeshLink` feed.
- Meshtastic firmware 2.8 removed JSON publishing, so the server must decode
  protobuf `ServiceEnvelope` messages with `@meshtastic/protobufs`.
- Use our own Mosquitto broker on the same VPS. Never use the public
  `mqtt.meshtastic.org` broker, which is the firmware default.
- Keep MQTT encryption enabled. If it's disabled, packets reach the broker
  unencrypted even when the channel has a key.
- One report online says TLS can cause reboot loops on some devices. Test TLS
  on the real hardware before relying on it.
- The phone-app MQTT proxy is fine for testing, but not for unattended sites.

### Device identity trade-off

- The original default was a secret key per device, with each message signed
  (HMAC).
- Standard Meshtastic channel packets are not signed per node, so that default
  doesn't carry over to MQTT. Anyone with the channel key could send packets
  claiming to be any node ID.
- Chosen approach: a private channel key, separate broker credentials per
  gateway with topic ACLs, and an allowlist of registered node numbers.
- Per-node signing is deferred; it would need custom firmware or a custom
  payload. HMAC signing still applies if any gateway ever posts over HTTP.

### Why not GitHub as the backend

- GitHub can't hold a persistent MQTT connection or receive device requests
  without putting a GitHub token on field hardware.
- Scheduled GitHub Actions runs can be delayed or skipped, which is
  unacceptable for fire alerts.
- Git isn't built for frequent concurrent writes.
- GitHub is still useful for an optional nightly public snapshot of
  `network.json`.

### Why Hono over Express

- Hono: TypeScript types built in, official Zod integration, small and fast,
  runs on Node or Cloudflare Workers, and tests routes via `app.request()`
  with no server.
- Express: a much larger ecosystem and more documentation, but its types come
  from a separate community package, validation needs extra glue code, and
  tests need `supertest`.
- Either framework handles 100 nodes. Hono was chosen for type safety and less
  glue code.

### Other stack choices and what was avoided

- SQLite via `better-sqlite3`, Drizzle for queries and migrations, Better Auth
  for accounts, `pino` for logging, Litestream for backups, Caddy for HTTPS.
- Node's built-in `node:sqlite` was considered and skipped because it is still
  marked experimental.
- Avoided: Express, Prisma (heavy query engine), managed Postgres or Redis
  (monthly cost), and serverless setups needing paid database add-ons.
- The repository layer is the only code to rewrite if Postgres is ever needed.

### Storage estimate

At roughly 100 nodes reporting every 15 minutes, with about 500 bytes per
report, storage grows by about 5 MB a day, under 2 GB a year. Keeping all data
forever is fine. Images would be the only fast-growing data.

### User alert rules

- A rule stores: owner, target node (or all nodes), metric, above/below,
  threshold, how long the condition must hold, cooldown, and an enabled flag.
- Example: "temperature above 60°C at `sen-07` for 10 minutes."
- Readings are stored one value per row, so rules work on any metric.

## Open questions (also in SPEC.md)

- Camera nodes: how they connect, and whether images are sent. LoRa packets
  hold only about 200 bytes.
- Link RSSI: NeighborInfo reports SNR only. The website's `MeshLink.rssi` may
  need to become nullable.
- Firmware version: not in regular telemetry.
- AQI: compute from PM2.5 (US EPA formula) or use the sensor's IAQ value.
- Node status thresholds: placeholders are 30 minutes (degraded) and 2 hours
  (offline).
- Whether any gateway will use HTTP instead of MQTT.

## Build session answers

Questions asked while building the first version, and the owner's answers:

| Question | Owner's answer | Result |
| --- | --- | --- |
| Link RSSI when only SNR is known | Nullable RSSI | `MeshLink.rssi` becomes nullable; the web type must change |
| How to produce AQI | Keep metrics generic; they depend on each device and sensor | Readings use sensor-provided names; no derived AQI |
| How admins add users | One-time invite link | Admin gets a single-use token; invitee sets name and password |
| Firmware version source | Set at registration | Admin-entered device field |
| Website origin | `meshfiredetection.org` | Same-site cookies with `api.meshfiredetection.org` |
| Build OpenAPI now | Defer | Zod validation only; OpenAPI later |

## Suggested next steps

1. Create `mesh-fire-detection/backend` and commit these docs.
2. Scaffold the project, copying tooling config from the web repo.
3. Build in this order: database and migrations → devices (admin) → ingest
   (decoder with packet fixtures, then the MQTT subscriber) → network feed →
   auth → readings → alert rules and jobs → deployment.
4. Resolve open questions as each area is reached.

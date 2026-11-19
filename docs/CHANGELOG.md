# Changelog

Notable changes to the backend, by release. How releases are cut is in
[RELEASING.md](RELEASING.md). Entries that add a database migration say so.

## Unreleased

## 0.4.0 — 2026-11-18

**Migration 0017** adds two columns to `nodes`: `browser_heard_at` and
`power_source`. Nothing is backfilled. It runs on deploy after `release.sh`
takes its pre-release copy. Rolling back to 0.3.1 by redeploying is not safe
across it; restore that copy instead. Release the website's 0.5.0 after this:
it reads `late`, `heardVia` and `power`.

### Changed

- Node status is about connection only: `online`, `late` (was `degraded`) and
  `offline`, by when the node was last heard by any path. A low battery no
  longer makes a node late. **Breaking** for clients that check `degraded`.
- A browser uploading a node's readings counts as hearing it, and `heardVia`
  on `/v1/nodes` says how it was last heard: through a gateway (named), a
  gateway's own Wi-Fi or Notecard, or a browser (only for its people and
  admins).
- The battery level is stored as the firmware sends it: 101, which means
  plugged in or no battery, is no longer saved as 100.

### Added

- `power` on `/v1/nodes`: plugged in, charging, battery percentage and whether
  the battery is ok, low, missing or unknown. A battery is low only when the
  node is not plugged in, and low battery alerts follow that.
- `powerSource` (`battery`, `solar`, `mains`) for a node's people to set. `mains`
  means always plugged in, for boards that cannot detect USB.

## 0.3.1 — 2026-11-17

Fixes for the field test. No migrations; rolling back to 0.3.0 by redeploying
is safe.

### Fixed

- Notehub readings are timed by when the gateway heard them, its `rx_time`,
  falling back to the Notecard's capture time when the gateway had no clock,
  and never later than the server received them. The sensor's own clock no
  longer decides anything: a node without GPS often has none, and its readings
  were stored in 1970 or refused. It is still kept as `measuredAt`. A late or
  out-of-order packet now moves last-heard forward too. No migration.
- A node's path times each route by that node's own packets, per gateway and
  per way in (MQTT or Notehub), instead of by whatever else the gateway
  forwarded. A route the node never took is left out. No migration.

### Changed

- A node's path, and the nodes around it, look back 30 days instead of 7.
  Roles and connections on `/v1/nodes` stay at 7.

## 0.3.0 — 2026-11-09

Gateways and the paths readings take. **Four migrations, 0013–0016:** new
tables, columns and indexes, and 0014 also labels existing packets. They run
on deploy after `release.sh` takes its pre-release copy. Rolling back to
0.2.1 by redeploying is not safe across them; restore that copy instead.

### Added

- An event log (#36): a short, structured record of the system's health,
  read by admins at `GET /v1/events`. Rejected packets and failures are
  counted rather than repeated, silent gateways are noticed, and events are
  kept for 90 days. **Migration 0013** adds the `events` table and indexes
  on when each gateway last delivered.
- `DELETE /v1/gateways/:nodeId` stops a node being a gateway, so a Notecard
  can move to another board. No migration.
- `GET /v1/gateways/status` (#37): each gateway's paths, MQTT and Notecard,
  when each last delivered, refusals in the last 24 hours, and the broker's
  state. **Migration 0014** records which path delivered each packet and labels
  earlier ones exactly.
- `roles` and `connections` on `/v1/nodes` (#51): what a node does, from what it
  has shown in the last 7 days (`base`, `gateway`, `sensor`, `vision`), and how
  its data reaches the backend (MQTT, Notecard with its network, browser).
  **Migration 0015** keeps Notehub's `transport` per event. `type` is unchanged
  for now.
- A node's path to the server, `GET /v1/nodes/:id/path`: which gateways
  delivered its packets and over how many hops, the gateway's signal when it
  heard the node directly, how each gateway reaches the server, and the nodes
  around it. `connections` now includes `mesh`, one per delivering gateway.
  **Migration 0016** records the hops each packet took.

### Changed

- `createAdmin` no longer writes the new admin's email address to the log.

### Fixed

- A gateway shows as offline while it forwards readings (#37). Any delivery it
  makes now counts as hearing it, so its status, the map and offline alerts
  agree.
- A node with a Notecard on its gateway is shown as `cellular`, not the type
  it was first registered with (often `sensor`, from the firmware's default
  name). Moving the Notecard moves the type with it.

## 0.2.1 — 2026-11-08

### Changed

- Dependencies updated within their major versions (#38), including
  better-auth 1.7.18, drizzle-orm 0.45.4, hono 4.13.17 and zod 4.6.7.
  TypeScript 7, `@types/node` 26 and eslint-plugin-unicorn 79 are held,
  with reasons in #47. No migrations.

## 0.2.0 — 2026-11-08

The first tagged release. Until now every merge to `main` deployed, so most of
this already ran in production while `/health` still said 0.1.1. Only the
account changes and migration 0012 are new to the server.

### Added

- Your sessions on `/v1/me/sessions`: see where you are signed in, end one
  session, or sign out everywhere. Tokens never leave the server.
- Your sign-in methods on `/v1/me/sign-in-methods`: the emailed code, which
  cannot be removed, and Google, which can.
- Deleting your own account, `DELETE /v1/me` (SPEC, Leaving). **Migration
  0012** adds `users.deleted_at`; it is additive.
- Sign in and join with Google (#41).
- Membership: sign in with an emailed code, join by invitation or with a node
  you connected, and project updates (#31, #32).
- Members register nodes and are listed on them; approximate positions for
  everyone else; a browser's copy of a node's readings is accepted.

### Changed

- Deploys run when a GitHub Release is published, not on every merge to `main`
  (#42). Running Deploy by hand with an earlier tag rolls back to it.
- Sessions last seven days from last use, set explicitly (#15 Q18).

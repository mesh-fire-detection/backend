# SPEC — Mesh Fire Detection Backend

What the backend must do, and the decisions behind it. `ARCHITECTURE.md`
covers how. Items marked **Open** are not decided; do not build past them
without asking.

## Context

Mesh Fire Detection is a wildfire-detection network of Meshtastic (LoRa) nodes.
The website (`mesh-fire-detection/web`, React on GitHub Pages) currently shows
sample data and is built to switch to a live feed at `/api/network.json`. This
repo is that live backend.

Node types, from the site: `base`, `cellular` (gateway with LTE backhaul),
`sensor`, `vision` (low-rate camera).

## Goals

1. Receive data from the mesh and store it.
2. Accept data only from registered devices.
3. Let admins register and manage devices.
4. Serve the network map and sensor data to the website.
5. Let users define their own alert rules and see the alerts they trigger.
6. Run as cheaply as possible.

## Non-goals (for now)

- Sending notifications (email, SMS, push). Design for it; do not build it.
- Camera image upload and storage. See Open questions.
- Controlling or configuring nodes from the server (no MQTT downlink).
- Multi-server or high-availability deployment.
- Derived metrics such as AQI. See Sensor metrics.

## Scale

- About 100 nodes in the first year.
- Fewer than 100 user accounts.
- Assume each node reports telemetry every 15 minutes or so. That is roughly
  10,000 messages a day, which a single small server handles easily.

## Decisions

| Topic | Decision |
| --- | --- |
| Runtime | Node 24, TypeScript, ESM |
| Repo | New repo, same conventions as the web repo |
| Hosting | One Oracle Cloud Always Free instance ($0). GitHub is not the live backend. |
| Database | SQLite, continuously backed up off-server |
| Ingest | Meshtastic MQTT uplink to our own Mosquitto broker (see Ingest) |
| Retention | Keep all data indefinitely. Nothing is deleted automatically. |
| Accounts | Email and password, two roles: `admin` and `user`, created by invite link |
| Map feed | `/api/network.json` is public and read-only |
| Sensor metrics | Generic: stored under the name the sensor reports; no fixed list |
| Link RSSI | Nullable; real values only, never estimated |
| Firmware version | Entered by admins at registration |
| Alerts | User-defined rules plus system alerts; stored with a status; no notifications yet |
| Website origin | `https://meshfiredetection.org`; API at `api.meshfiredetection.org` |
| API docs | OpenAPI generation deferred; routes validate with Zod so it can be added later |

## Ingest

Nodes do not talk to the internet directly. A gateway node (e.g. `cel-01`)
has internet access through an LTE router and forwards mesh packets to our
MQTT broker using Meshtastic's built-in MQTT module.

- Packets arrive as Meshtastic protobuf `ServiceEnvelope` messages. Current
  firmware (2.8+) no longer publishes JSON, so the server decodes protobufs.
- The public broker (`mqtt.meshtastic.org`) is never used.
- MQTT encryption is enabled; the server decrypts with the private channel key.
  Plaintext packets are dropped, and the server refuses to start with a
  default (1-byte) channel key.
- The gateway named in the envelope must be a registered, enabled gateway.
- Packets used:
    - Telemetry, device metrics: battery, voltage, uptime.
    - Telemetry of any kind (environment, air quality, power, health, …):
      every numeric field the sensor sets (see Sensor metrics).
    - NeighborInfo: which nodes hear each other, with SNR.
    - Position and NodeInfo: location and names, stored as "reported" values.
      Registered values win on the map.
    - Anything else still counts as hearing from the node.
- Meshtastic delivers duplicate packets. The server stores a packet once per
  sender node number and packet ID within 24 hours. Packet IDs are random
  32-bit numbers and eventually repeat, so they are not unique forever.
- Receive time is the server's clock, not the node's.

## Sensor metrics

Nodes carry different sensors, so the backend does not define a list of
metrics. Each numeric telemetry field a node sets is stored as one reading
named `<telemetry type>.<field>`, for example:

- `environmentMetrics.temperature`
- `environmentMetrics.relativeHumidity`
- `airQualityMetrics.pm25Standard`
- `deviceMetrics.batteryLevel`

New sensors and firmware fields are picked up without code changes. Fields a
sensor does not set are not stored. Float sensor values are rounded to
float32 precision. No derived values (such as US EPA AQI) are computed; add
them only by a decision here.

## Device identity

Every device must be registered before its data is accepted.

- A device has a human ID (`cel-01`, matching the site) and a Meshtastic node
  number (`!a1b2c3d4`). Both are unique.
- Packets from unregistered or disabled node numbers are dropped and logged.
- Network security has three parts:
    1. A private channel key shared only by our nodes.
    2. Separate broker credentials per gateway, with topic ACLs.
    3. The registered-device allowlist above (for senders and gateways).
- Known limitation: standard Meshtastic channel packets are not signed per
  node, so someone holding the channel key could impersonate a node ID.
  Per-device message signing is deferred. If ingest ever moves to HTTP, each
  request is signed with the device's secret key (HMAC-SHA256) and timestamped.

## Users and roles

| Role | Can |
| --- | --- |
| public (no login) | View the network map and `/health` |
| `user` | Everything public, plus sensor history, own alert rules, alerts |
| `admin` | Everything, plus device registration, gateways, users, all rules and alerts |

- There is no open sign-up. An admin invites an email address with a role and
  receives a single-use link token (valid 7 days) to send by hand. The invitee
  chooses a name and password (12+ characters) when accepting.
- The first admin is created on the server with `npm run user:create-admin`.
- Admins can change a user's role or disable them; disabling signs them out
  everywhere. Admins cannot change their own role or access.

## Node status

Derived at read time from the last packet received, never stored:

- `online`: heard within 30 minutes.
- `degraded`: heard within 2 hours, or battery below 20%.
- `offline`: not heard for 2 hours or more, or never heard.

Thresholds live in config. **Open:** confirm these values against the real
reporting interval.

## Alerts

Two kinds of alert, one table:

- **System alerts**, created by the server: node offline, low battery.
  Visible to all users. A node must have been heard at least once before it
  can raise an offline alert.
- **Rule alerts**, created by a user's rule. Visible to that user and admins.

A user alert rule has:

- Owner
- Target: one node, or all nodes
- Metric: any metric name (see Sensor metrics)
- Comparison: `above` or `below` (strictly)
- Threshold
- Duration: how long the condition must hold before firing (default 0: the
  first matching reading)
- Cooldown: minimum time after an alert opens before the same rule can open
  another for the same node (default 15 minutes)
- Enabled flag

Example: a firefighter creates "temperature above 60°C at `sen-07` for 10
minutes."

Deleting a rule stops it firing but keeps it, so its alerts keep their
history and owner.

Alert lifecycle: `open` → `acknowledged` → `resolved`, or `open` → `resolved`.
An alert resolves automatically when the condition clears (the node comes
back, the reading no longer matches, the device is disabled), and can also be
resolved by hand. Every change is recorded with who made it (or the system),
when, and an optional note.

Notifications are future work, but the data model includes a notification
channel table so adding them later needs no restructuring.

## Website contract

`GET /api/network.json` returns nodes and links shaped exactly like
`MeshNode` and `MeshLink` in the web repo
(`src/core/content/network/network.ts`):

- `MeshNode`: `id`, `name`, `type`, `status`, `position` as
  `[longitude, latitude]`, `elevationM`, `antennaHeightM`, `batteryPct`
  (null if never reported), `lastHeartbeatMin` (null if never heard),
  `firmware`, `deployedOn`, optional `note`. Only enabled devices appear.
- `MeshLink`: `from`, `to`, `rssi` (dBm, **nullable**), `snr` (dB),
  `distanceKm`.

`MeshLink.rssi` is `number | null` in both repositories. RSSI is only known when
the gateway hears a node directly; NeighborInfo reports SNR only. Backend CI
checks the exported network types against the web repo's `main` branch.

The site is hosted on a different origin, so the API sets CORS for the site's
domain. Both share `meshfiredetection.org`, so session cookies are same-site.

## Open questions

- **Camera nodes.** How vision nodes connect, and whether images are sent at
  all. LoRa packets hold only about 200 bytes. Deferred.
- **Status thresholds.** See Node status.
- **HTTP fallback.** Whether any gateway will post over HTTP instead of MQTT.
- **Gateway TLS.** Test MQTT over TLS on the real gateway hardware before
  switching the broker's field listener to TLS.
- **Real-packet check.** Decryption and decoding are tested against packets
  built to the Meshtastic spec. Confirm with a packet captured from real
  hardware before relying on alerts.

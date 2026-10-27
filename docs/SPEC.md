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
| Hosting | One Hetzner VPS (~$5/month). GitHub is not the live backend. |
| Database | SQLite, continuously backed up off-server |
| Ingest | Meshtastic MQTT uplink; opt-in authenticated Notehub HTTPS adapter for Blues gateways (see Ingest) |
| Retention | Keep all data indefinitely. Nothing is deleted automatically. |
| Accounts | A code emailed to a member; two roles, `admin` and `user`. Members join by invitation, or with a node they connected |
| Map feed | `/api/network.json` is public and read-only |
| Sensor metrics | Generic: stored under the name the sensor reports; no fixed list |
| Link RSSI | Nullable; real values only, never estimated |
| Firmware version | Entered by admins at registration |
| Alerts | User-defined rules plus system alerts; stored with a status; no notifications yet |
| Website origin | `https://meshfiredetection.org`; API at `api.meshfiredetection.org` |
| Transactional email | Resend, behind a provider interface. See Email. |
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
- For MQTT, receive time is the server's clock, not the node's.

### Blues Notecard / Notehub integration

The backend provides an opt-in `POST /v1/ingest/notehub` adapter for cellular
gateways using Blues Notecard and Notehub. Gateway firmware must queue the
original encrypted Meshtastic ServiceEnvelope in an untemplated `mesh.qos`
Note's body using the [version 1 contract](NOTEHUB.md). The firmware transport
and real hardware delivery remain follow-up work; implementing this adapter
does not establish a working cellular gateway.

The following decisions were approved on October 23, 2026:

- Authenticate Notehub delivery over HTTPS with a separate high-entropy bearer
  credential per gateway. Store only its SHA-256 hash. Trust Notehub to supply
  the Notecard UID; require that UID and the envelope gateway node number to
  match the registered, enabled gateway. Sender devices must also be registered
  and enabled. Browser sessions cannot authorize this endpoint.
- Keep the original channel encryption and existing telemetry metric names.
  Accept telemetry only in this first adapter. MQTT behavior for other packet
  types remains unchanged.
- Store sensor telemetry time as the reading's `recordedAt`, Notehub capture
  time and backend receipt time in the delivery record. Missing sensor time
  falls back to Notehub capture time and is always history-only. Reject capture
  or sensor times more than five minutes into the future, or sensor time more
  than five minutes after Notehub capture.
- Readings older than five minutes at receipt, future readings, and readings
  older than the sender's last-heard time are history-only. They cannot change
  last-heard, the live battery value, or live alerts, including later rule
  duration calculations. Recent readings with a sensor clock use sensor time
  for last-heard; last-heard never moves backward.
- Accept one event or an atomic batch of up to 16, with a 64 KiB request limit
  and at most 4096 decoded bytes per envelope. A 200 response follows commit
  and reports inserted packets and duplicates. Invalid batches write nothing.
  Database failures return a retryable 503. Store before evaluating alerts.
- Keep event IDs and content hashes permanently. Reuse of an event ID with
  changed content returns 409. For timestamped telemetry, fingerprint the
  sender, packet ID, and original decrypted Data bytes, retaining that identity
  indefinitely across Notehub and newly decoded MQTT traffic. Same sender and
  packet ID with changed content inside MQTT's 24-hour window returns 409 on
  Notehub delivery. Legacy MQTT rows and clockless packets have only the
  24-hour cross-path packet check; repeating the same Notehub event is always
  idempotent. The limitations are explicit in the runbook.

Gateway records can carry an MQTT username, a unique Notecard UID, or both.
Notecard registration and credential provisioning are explicit admin actions;
an MQTT username is not required for Notecard gateways. No cloud resources are
created automatically. See [setup and failure handling](NOTEHUB.md) and the
[implementation plan](plans/notecard-ingest.md) for outstanding firmware and
hardware work.

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
  Per-device message signing is deferred. Direct device HTTP ingest, if added,
  requires timestamped HMAC-SHA256 signatures. Notehub delivery is the approved
  exception: its per-gateway HTTPS credential authenticates the cloud service,
  with identity binding and durable deduplication as described above.

## Users and roles

| Role | Can |
| --- | --- |
| public (no login) | View the network map and `/health` |
| `user` | Everything public, plus sensor history, own alert rules, alerts |
| `admin` | Everything, plus device registration, gateways, users, all rules and alerts |

### Signing in

A person types their address and receives a six-digit code, good for ten
minutes and three attempts.

**A code and no link.** A link saves one tap when mail and browser share a
device, and costs three things: the code appears in a URL and so in browser
history, a landing page is needed to stop mail security scanners spending the
token before the person arrives, and it helps not at all when someone reads
mail on a phone and browses on a laptop. Phones offer codes straight from the
notification now, which was most of the argument for links in the first place.

Adding one later is small, and the token design does not change: whatever
carries the code, there is one code, one expiry and one attempt counter.

Only a member receives anything. Every person is one row with a status:
a `subscriber` can never sign in, a `member` can unless disabled. An address
that is not a member gets a byte-identical response and no email, so the
endpoint cannot be used to discover who has an account. A session held by
anyone who is not a member counts as signed out.

### Joining

Two ways in (backend#9): an address an admin has invited, or a node the person
connected on the website (arrives with device registration, backend#12).

An invitation puts an address on the allowlist and sends nothing. The person
asks to join with their address and name and receives a six-digit code, the
same kind as for signing in; entering it makes them a member with the role the
invite named, marks the invite used, and signs them in. One transaction does
both, and it runs on Better Auth's own verification step, so there is no route
to a verified address that skips it.

Asking to join answers every address the same way. An invited address gets a
join code; a member gets a sign-in code instead, so they are not stuck; anyone
else gets nothing, and nothing about them is stored. An invite withdrawn while
its code is unused makes the code worthless.

Requests for a code are rate limited more tightly than the rest of the API,
because each one spends from a daily email allowance shared by everybody.

- Passwords remain enabled but unadvertised, for the bootstrap admin created
  with `npm run user:create-admin` on a fresh server. The website never offers
  them, and they are expected to go once that script no longer needs them.
- There is no open sign-up: only an invitation or a connected node makes someone
  a member.
- Admins can change a user's role or disable them; disabling signs them out
  everywhere. Admins cannot change their own role or access.

## Email

The backend sends transactional email: sign-in codes now, and alert
notifications when those are built. Marketing email is not in scope.

**Provider: Resend.** Chosen for a free tier that covers our volume, a small
Node API, and domain setup we can complete ourselves. The runner-up is Amazon
SES, which is cheaper per message at volume but needs an AWS account and
production-access approval. Prices and allowances were compared in issue #15
on 2026-10-14; recheck before relying on them.

The provider sits behind an interface in the backend, so switching is a config
change and a new adapter, not a rewrite. Nothing outside that module knows
which provider is in use.

**Volume and the daily cap.** Resend's free tier allows 3,000 messages a month
but no more than 100 a day. With fewer than 100 accounts that is comfortable
for sign-in codes, but the daily cap is the limit that would bite first: a
hundred people signing in on the same day, plus resends, would reach it. When
the system sends notifications as well, the cap is reached sooner.

Rules that follow from this:

- The backend never silently stops sending. If the provider rejects a message
  because an allowance is exhausted, that is logged as an error and surfaced
  on `/health`, because a sign-in code that never arrives looks like a broken
  login.
- Review usage before enabling notifications, and move to a paid plan or to
  SES rather than letting codes fail.

**Failure handling.** A send is retried once, and only when the request never
completed, using the provider's idempotency key so a timed-out request that was
in fact accepted cannot deliver twice. A rejection is not retried: it is our
mistake or an exhausted allowance, and repeating it only burns more of what is
left. There is no queue surviving a restart, because a code expires in minutes
and delivering it afterwards is worthless.

**Local development.** Without an API key the backend writes messages to
`EMAIL_PREVIEW_DIR` and lists them at `/dev/mail`, which exists only when
`DEV_CONSOLE` is on. Logs record that a message was sent and under which
template, never the recipient and never the code: a code in a log file is a
code anyone with the log can use.

**Privacy.** Email addresses are personal data and leave our server when a
message is sent. Send only what the message needs, never log an address or a
code, and keep the provider's own logs in mind when deciding what to put in a
message body.

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
checks the exported network types against the web repo at a commit pinned in
`ci.yml`.

### Changing the shape

The two repositories deploy separately, so no single merge can change both at
once. Change the shape in three steps rather than two, so that every state in
between is valid:

1. Add the new field to the backend as optional, and merge. The website does
   not know about it yet, which is fine.
2. Adopt it on the website, and merge. In the same pull request on the backend,
   bump the pinned commit so CI compares against the website that uses it.
3. Tighten or remove the old field once nothing reads it.

Renaming a field in place is the one move to avoid: it requires both
repositories to merge simultaneously, and they cannot. Add, migrate, remove.

The site is hosted on a different origin, so the API sets CORS for the site's
domain. Both share `meshfiredetection.org`, so session cookies are same-site.

## Open questions

- **Camera nodes.** How vision nodes connect, and whether images are sent at
  all. LoRa packets hold only about 200 bytes. Deferred.
- **Status thresholds.** See Node status.
- **Notecard field verification.** Implement the gateway firmware transport and
  capture a real Notehub event to verify the [adapter contract](NOTEHUB.md).
  Measure latency, durable queue behavior, and event costs before fleet rollout.
  Direct gateway HTTP fallback remains undecided.
- **Gateway TLS.** Test MQTT over TLS on the real gateway hardware before
  switching the broker's field listener to TLS.
- **Real-packet check.** Decryption and decoding are tested against packets
  built to the Meshtastic spec. Confirm with a packet captured from real
  hardware before relying on alerts.

# Blues Notecard / Notehub ingestion API

The backend accepts Notehub HTTPS deliveries. The gateway firmware transport
and a real hardware delivery test are still pending in [issue #24](https://github.com/mesh-fire-detection/backend/issues/24).
Keep `NOTEHUB_ENABLED=false` until the deployment is provisioned for testing.

## Connection and trust

```text
Sensor → LoRa → cellular gateway → Notecard → Notehub
    → HTTPS POST /v1/ingest/notehub → shared ingest services → SQLite
```

Notehub authenticates to the backend with a separate bearer credential for each
gateway. The backend stores its SHA-256 hash, binds it to the gateway's Notecard
UID, and checks the original encrypted ServiceEnvelope's gateway node number.
The original sender must also be registered and enabled. This trusts Notehub's
device metadata; it is not end-to-end device signing. Holding the mesh channel
key can still permit sender impersonation, as described in SPEC.

## Provisioning

1. Set `NOTEHUB_ENABLED=true` and the private base64 `MESH_CHANNEL_KEY` in the
   server environment. The key must be 16 or 32 bytes. `MQTT_URL` can remain
   empty for a Notehub-only deployment. Restart the backend after configuration.
2. Register each sensor and the cellular gateway through the existing admin
   `POST /v1/devices` API, using their actual Meshtastic node IDs.
3. Generate a different random credential for each gateway, for example 32
   random bytes encoded as base64url. The API accepts 43–128 letters, digits,
   underscores, or hyphens. Do not reuse the channel key or an account password.
4. Register the gateway with `POST /v1/gateways` as an authenticated admin:

    ```json
    {
        "deviceId": "cel-01",
        "notecardUid": "dev:860322068012345",
        "notehubToken": "<gateway-specific-random-base64url-credential>"
    }
    ```

    Replace both placeholder identities with the real values. The token must
    meet the format above. `mqttUsername` is optional for a Notecard gateway.
    An existing MQTT gateway can instead be updated using
    `PATCH /v1/gateways/cel-01` with `notecardUid` and `notehubToken`; its MQTT
    username and broker credentials continue working.

5. Configure the Notecard's Notehub project using the Blues provisioning
   procedure. In Notehub, create a General HTTP/HTTPS route to
   `https://api.meshfiredetection.org/v1/ingest/notehub`. Route only `mesh.qos`
   notes from this gateway, using a fleet restricted to its Notecard. Keep the
   full event JSON with **No Transformation**. Do not use Body Only, Payload
   Only, or a transform that replaces the cloud device/event identity.
6. Store the credential as a Notehub project Secret and set the route header:

    ```text
    Authorization: Bearer [$$gateway_cel_01_token]
    ```

    Use a separate route/secret for each gateway. Never use a plaintext
    environment variable as secret storage. Also send `Content-Type:
 application/json`. Keep cloud access and credential configuration limited
    to the operators responsible for the gateway.

7. Implement the firmware producer below and validate a real event. Record
   firmware build, sanitized configuration, readings at each stage, and recovery
   behavior before enabling operational alert reliance.

The token is write-only in the admin API and is never included in gateway
responses. Rotate it by PATCHing a new `notehubToken`, then updating the Notehub
Secret. The old token stops working immediately, so pause delivery during the
change and reroute failures afterward. There is no overlapping-key grace period.
Set `notehubToken: null` to revoke it. Disable the gateway or its device to stop
accepting its events. Coordinate Notecard UID changes with route provisioning.

Registration does not create a Notehub account, fleet, route, secret, or gateway
firmware configuration. Existing MQTT gateways still need their Mosquitto
password and ACL setup from [MQTT.md](MQTT.md).

## Firmware producer contract, version 1

Receive the mesh packet and build the same binary Meshtastic ServiceEnvelope
used by MQTT: preserve the original encrypted packet, sender node number,
packet ID, channel identity, and forwarding gateway ID. Encode the envelope
as canonical padded base64 inside the Note's JSON **body**:

```json
{
    "req": "note.add",
    "file": "mesh.qos",
    "body": {
        "version": 1,
        "envelope": "<base64-of-original-encrypted-ServiceEnvelope>"
    }
}
```

Use an untemplated Note. The example deliberately uses `body.envelope`, not
the separate `payload` property, whose untemplated binary size limit is 256
bytes. Confirm actual supported Note sizes against the installed Notecard
firmware; the backend limit does not establish a hardware capacity. `.qos`
selects the secure outbound queue. Keep queued data until the Notecard accepts
it durably; retries must preserve original sample identity and timestamps.
Gateway power-loss buffering, full queues, recovery/backoff, batching latency,
event cost, and power consumption still require firmware implementation and
measurement. There is no backend-to-device configuration or command channel.

Notehub adds cloud metadata and sends this shape to the backend:

```json
{
    "event": "dfa3747d-688b-4250-935b-5dd60354313c",
    "device": "dev:860322068012345",
    "file": "mesh.qos",
    "when": 1792771200,
    "body": {
        "version": 1,
        "envelope": "<base64-of-original-encrypted-ServiceEnvelope>"
    }
}
```

This illustrates the contract; placeholder envelopes are not valid packets and
the sample time is not a deployment setting. `event` is Notehub's UUID,
`device` is its Notecard UID, and `when` is its UTC Unix capture time in seconds.
Additional top-level Notehub metadata is ignored. The body is strict. The
adapter accepts telemetry only, with the same private channel encryption as
MQTT. Do not forward plaintext or re-label the sender as the cellular gateway.

The endpoint also accepts a JSON array of 1–16 events for the same authenticated
gateway. The entire request is atomic, with a 64 KiB body limit and 4096 bytes
per decoded envelope. A batch containing one invalid event writes nothing.
Preserve chronological order when batching; readings older than an already
accepted last-heard time are history-only.

## Timestamps, history, and alerts

- `readings.recordedAt` uses the original sensor Telemetry `time`, in UTC.
  `notehub_events` separately retains Notehub capture and backend receipt times.
- If the sensor timestamp is zero/missing, use Notehub capture time for history
  and exclude the reading from all live behavior. Clock quality is not proven
  by a nonzero timestamp; verify real device clocks during provisioning.
- Readings more than five minutes old on arrival, earlier than the sender's
  last-heard time, or slightly in the future are history-only. They are available
  through existing readings/metrics history APIs but do not change last-heard,
  map battery state, or live alerts. Future capture/sensor timestamps more than
  five minutes ahead are rejected, as are sensor times more than five minutes
  after Notehub capture. Last-heard never moves backward.
- Archived readings do not extend or break a later live rule's duration streak.
  Recent eligible telemetry uses the existing alert evaluator after commit.
  MQTT continues to use backend receipt time.
- History APIs retain their existing response shape: `recordedAt` is the
  timestamp above. Source/receipt metadata and eligibility are stored internally;
  no public map or history response fields are added in this change.

## Responses, retries, and duplicates

Successful delivery returns HTTP 200 after the database transaction commits:

```json
{ "inserted": 1, "duplicates": 0 }
```

Counts refer to packets/events, not individual metric rows. One PM packet can
create multiple readings. A repeat can return `{ "inserted": 0, "duplicates": 1 }`.

| Status  | Meaning                                                                | Operator/client action                                     |
| ------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| 200     | Stored or already accepted                                             | Acknowledge delivery                                       |
| 400     | Invalid schema, encoding, packet, file/version, or timestamps          | Correct producer/configuration; inspect rejected event     |
| 401     | Missing, invalid, or revoked credential                                | Correct route Secret/header                                |
| 403     | Notecard/envelope identity mismatch or unknown/disabled sender/gateway | Correct registration and enablement before rerouting       |
| 409     | Event or recent packet ID reused with different content                | Investigate producer identity reuse; do not overwrite data |
| 413     | Request exceeds 64 KiB                                                 | Reduce batch/request size                                  |
| 429     | Existing API rate limit reached                                        | Retry with backoff                                         |
| 500/503 | Backend unavailable, disabled, or storage failure                      | Restore service/configuration and retry unchanged delivery |

Errors use `{ "error": { "code": "...", "message": "..." } }`.
Verify Notehub's actual retry and route-failure behavior in the provisioned
project; the endpoint does not configure it. Retain failed events for rerouting
after fixing permanent errors. Notifications and a backend retry queue are not
part of this adapter. An alert evaluation failure is logged after storage and
does not cause accepted readings to be rolled back.

Event IDs and content hashes persist indefinitely, including through restarts.
Timestamped source packets are fingerprinted from original sender, packet ID,
and decrypted Data bytes, preserving the sensor timestamp. This deduplicates
across gateways and both newly decoded transports without treating random packet
IDs as globally unique. MQTT keeps its normal 24-hour sender/packet-ID check as
well. A Notehub event's cloud metadata outside the contract does not change its
content identity.

Limitations: pre-upgrade MQTT rows have no source fingerprint. Clockless packets
also lack a reliable permanent cross-event sample identity; their cross-path
deduplication is limited to the existing 24-hour packet window. Repeating their
same Notehub event is still permanently idempotent. Do not promise perfect
historical reconciliation for either case. Source timestamp/packet-ID reuse
with identical bytes is indistinguishable from retransmission.

## Monitoring and verification

`GET /health` includes:

```json
{
    "notehub": {
        "status": "waiting",
        "lastReceivedAt": null
    }
}
```

Status is `disabled` without backend enablement and provisioned credentials,
`waiting` before the first stored event, `ok` after delivery, or `failing` after
storage failure. Storage failure also produces HTTP 503 on health, and clears
after a successful delivery. The latest receipt is persisted, but in-process
failure state resets on restart. Invalid callers cannot set storage failure
state merely by submitting bad payloads.

`ok` does not prove new readings are arriving. Monitor `lastReceivedAt` against
the measured reporting cadence; replaying existing event IDs does not refresh it. Existing
device offline alerts remain responsible for node freshness. Logs include safe
gateway/rejection metadata and never the bearer token, channel key, signatures,
or raw request body.

Automated checks cover in-memory route/storage behavior, failure rollback,
credential rotation, timestamps/alerts, cross-transport duplicates, an isolated
database reopen, and upgrade from the original schema with MQTT data. Run:

```sh
npm run check
npm run check:runtime
npm run check:contract
```

Before field use, capture a real encrypted packet and a Notehub event from the
intended firmware and prove PMSA003I → LoRa → Notecard → Notehub → SQLite values
match. Test network interruption, power loss, replay, key/credential changes,
and backend restart. Do not equate synthetic fixtures with hardware evidence.

## Provider references

- [Blues HTTP/HTTPS routing](https://dev.blues.io/guides-and-tutorials/routing-data-to-cloud/general-http-https/)
- [Notehub route Secrets and transformations](https://dev.blues.io/notehub/notehub-walkthrough/)
- [Notehub event fields](https://dev.blues.io/api-reference/notehub-api/event-api/)
- [Notecard secure queues and payload limits](https://dev.blues.io/notecard/notecard-walkthrough/essential-requests/)

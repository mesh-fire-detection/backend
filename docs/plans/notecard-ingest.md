# Blues Notecard / Notehub ingestion

Status: backend adapter implemented October 23, 2026; firmware transport and
real hardware verification remain pending.

Implementation task: [backend #24](https://github.com/mesh-fire-detection/backend/issues/24).

## Goal and delivery path

Collect particle measurements on a registered sensor node, send them over
Meshtastic LoRa to a registered cellular gateway, and store them in the backend:

```text
PMSA003I → sensor firmware → Meshtastic LoRa → cellular gateway
    → Blues Notecard → Notehub → authenticated HTTPS API → SQLite
```

The RAK13102 / Notecard hardware is listed in the hardware repository. Its
firmware transport is still missing. The existing backend accepts encrypted
Meshtastic protobuf ServiceEnvelope messages through MQTT; it does not accept
Notehub events until this adapter change. Implementing the backend route alone
does not complete this flow.

This change adds a Notehub path alongside MQTT. It does not claim a working
cellular gateway or change the current MQTT runtime contract. Related open
decisions are tracked in [backend issue #15](https://github.com/mesh-fire-detection/backend/issues/15),
especially Q02, Q22, Q23, Q24, Q32, and Q33.

## Existing functionality to reuse

- Admin registration through `POST /v1/devices` for sensors and the gateway.
- Explicit gateway authorization through `POST /v1/gateways`.
- Enabled-device checks, numeric telemetry extraction, transactional storage,
  readings history, and alert evaluation.
- Existing metric names such as `airQualityMetrics.pm25Standard` and
  `airQualityMetrics.pm25Environmental`. Preserve zero values and omit absent
  fields; do not introduce a separate particle-only table.

Gateway registration now accepts a Notecard UID without an MQTT username, plus
an explicitly provisioned, write-only Notehub credential. New Drizzle migrations
and a legacy-data upgrade test cover existing MQTT gateways. See the
[implemented API contract and runbook](../NOTEHUB.md).

The user approved per-gateway Notehub HTTPS credentials and storage of delayed
readings as history on October 23, 2026. SPEC and ARCHITECTURE record the selected
contract. The questions below document the original decision checklist; the
runbook describes implemented behavior and remaining identity limitations.

## Implemented contract

1. Version 1 accepts the original encrypted Meshtastic ServiceEnvelope in an
   untemplated `mesh.qos` Note's `body.envelope` base64 field. Notehub sends full
   event JSON. Real producer/event capture remains a firmware/hardware task.
2. Notehub authenticates with a separate HTTPS bearer credential for each
   gateway. Only its hash is stored. Both Notecard UID and envelope gateway ID
   must match registration. Browser sessions cannot submit telemetry. The user
   approved this exception to direct-device HTTP HMAC signing in SPEC.
3. Event IDs/content hashes persist permanently, with conflicts rejected.
   Timestamped source telemetry uses durable fingerprints across new MQTT and
   Notehub traffic. Clockless packets and pre-upgrade MQTT history retain the
   documented 24-hour cross-path limitation.
4. Sensor time is stored for Notehub readings, with separate delivery capture
   and receipt times. Readings delayed more than five minutes, out of order,
   slightly future-dated, or without a sensor clock are history-only. They do
   not affect last-heard, live battery, or alert evaluation/duration queries.
5. The endpoint accepts one event or atomic batches of up to 16 within 64 KiB.
   Successful acknowledgement follows commit. Transient storage failures roll
   back and return 503; repeats return duplicate counts. Firmware durable
   queues, overflow, latency, and backoff remain to implement and measure.
6. `POST /v1/ingest/notehub` explicitly declares public browser-session access
   with a mandatory machine credential guard before parsing/validation. The
   existing anonymous-access audit verifies it still returns 401 without a
   Notehub credential.

## Implementation work

### Firmware dependency

- Add the Notecard driver/transport to the shared RAK4631 firmware with an
  explicit gateway configuration and Notehub project provisioning.
- Forward received mesh telemetry while preserving original sender identity.
- Implement durable buffering and recovery across cellular outages and power
  loss, with observable queue overflow and bounded retry behavior.
- Verify PMSA003I warm-up, valid particle measurements, and actual LoRa delivery
  on the intended boards. Measure event count, payload volume, latency, and
  power use before choosing batching and fleet settings.

### Backend delivered; deployment provisioning pending

- Add an authenticated HTTPS endpoint for Notehub events; validate credentials,
  request size, and the complete payload with Zod before ingest logic.
- Map the authenticated Notecard to an enabled gateway and require every
  original sensor sender to be registered and enabled. Keep registration
  admin-only; gateway registration must not silently provision cloud secrets.
- Normalize accepted events into shared ingest logic. Preserve MQTT behavior
  and avoid duplicating SQL in routes or adding Notehub-specific rules to repos.
- Persist deduplication identity and readings atomically. Return retryable
  errors on storage failure, with no partial writes or premature success.
- Keep existing history and map contracts compatible. Add migrations only for
  agreed identity, timestamp, or delivery metadata requirements.
- Add safe rejection/failure logs and ingest readiness/freshness monitoring.
  Never log channel keys, credentials, signatures, or complete raw requests.
- Document Notehub route setup, credentials, registration, deployment config,
  retry troubleshooting, and recovery. Recheck provider limits/costs before
  fleet rollout; do not assume one Notehub event per metric is necessary.

## Acceptance criteria

- [ ] Payload, authentication, identity, timestamps, batching, and retry decisions
      are recorded in SPEC and ARCHITECTURE, with matching firmware documentation.
- [x] Registered and enabled sensor/gateway events store the expected PM values
      and can be queried through the existing readings API.
- [x] Missing/invalid authentication, gateway identity spoofing, malformed or
      oversized input, and unregistered/disabled senders or gateways are rejected
      without storing readings.
- [x] Repeated events, overlapping batches, and cross-gateway/transport duplicates
      follow the documented idempotency policy, including after backend restart.
- [x] A database failure rolls back the batch and allows a successful retry.
- [x] Delayed/out-of-order samples and invalid clocks follow the recorded policy
      without incorrectly changing node freshness or live alerts.
- [x] Route tests use Hono `app.request()` and fresh in-memory SQLite databases;
      deterministic fixtures cover authentication, retries, zero/absent values,
      and relevant alert behavior. No live broker or Notehub account is needed.
      Separate isolated file-database tests verify reopen and legacy migration.
- [x] Existing MQTT tests and `npm run check`, `npm run check:runtime`, and
      `npm run check:contract` pass.
- [ ] A real PMSA003I measurement travels through LoRa, Notecard, Notehub, and
      the API into SQLite. Record firmware versions, sanitized configuration,
      values at each stage, and recovery evidence for cellular interruption,
      gateway power loss, backend restart, and cloud redelivery.

## References

- [Current MQTT onboarding](../MQTT.md)
- [Firmware gateway gap and hardware evidence](https://github.com/mesh-fire-detection/firmware/blob/main/MESH_FIRE_DETECTION.md)
- [Hardware inventory](https://github.com/mesh-fire-detection/hardware/blob/main/initial-nodes.md)
- [Blues Notehub MQTT routing](https://dev.blues.io/guides-and-tutorials/routing-data-to-cloud/mqtt/)

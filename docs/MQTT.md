# MQTT Device Connection API

This document describes how a Meshtastic gateway connects to the Mesh Fire
Detection MQTT broker and forwards packets from the private mesh. It is an
uplink-only interface: the backend does not publish commands or configuration
to devices.

Regular mesh nodes do **not** connect to the broker. They communicate over
LoRa with a registered gateway. A gateway with LTE or another Internet
connection forwards mesh traffic to the broker using Meshtastic's MQTT module.

## Before connecting

An administrator must complete these steps before configuring the gateway:

1. Register the gateway as a device with `POST /v1/devices`. Its Meshtastic
   node ID and its device ID must be unique.
2. Register that device as a gateway with `POST /v1/gateways`, including a
   unique `mqttUsername`.
3. Create the matching Mosquitto password-file user and give it a topic ACL.
   The username in Mosquitto must exactly match `mqttUsername`.
4. Add every sender node that should be accepted with `POST /v1/devices` and
   keep it enabled.

The broker credentials authenticate the gateway. The device allowlist is a
separate check: a packet is accepted only when both its forwarding gateway and
its sender are registered and enabled.

## Connection settings

| Setting | Value |
| --- | --- |
| Broker host | `mqtt.meshfiredetection.org` |
| Field port | `8883` |
| Transport | MQTT over TLS, with username and password authentication |
| Certificate | Public Let's Encrypt certificate for `mqtt.meshfiredetection.org`; no client certificate required |
| Root topic | `msh/US` |
| Publish topic | `msh/US/2/e/+/&lt;gateway-node-id&gt;` |
| Payload format | Binary Meshtastic protobuf `ServiceEnvelope` |
| QoS | `1` |
| JSON publishing | Disabled |
| MQTT encryption | Enabled on the private channel |

## Cloudflare DNS and network path

Use `mqtt.meshfiredetection.org` as the broker hostname. In Cloudflare DNS,
its A and/or AAAA record must point to the VPS public IP and be set to **DNS
only** (the gray-cloud status). This is a separate record from
`api.meshfiredetection.org`, which remains **Proxied** (orange cloud) for the
website and HTTP API.

DNS only means Cloudflare answers the DNS request with the VPS address but
does not proxy the connection. The actual field path is:

```text
Gateway → mqtt.meshfiredetection.org DNS lookup → server public IP:8883 → Mosquitto
```

It is not an HTTPS connection and does not pass through Cloudflare's normal
proxy, Caddy, or the Node HTTP application. This means gateway clients can
discover the VPS public IP. That is an expected trade-off of direct MQTT and
is protected by the broker authentication and topic ACLs below.

Do not enable the orange cloud for `mqtt.meshfiredetection.org`: standard
Cloudflare proxying does not carry raw MQTT/TCP. Cloudflare Spectrum could
proxy MQTT as Layer-4 TCP, but it is not used by this deployment.

Inbound TCP `8883` must be permitted in **both** firewall layers on Oracle: the
VCN security list and the instance's own iptables rules. It is normally open to
all source addresses because cellular gateway addresses are dynamic. That does
not grant publishing access: Mosquitto rejects clients that do not
authenticate, and the ACL restricts each authenticated gateway to its own
topic. Port `1883` must never be exposed publicly; it is bound to `127.0.0.1`
for the local backend subscriber only.

TLS protects the broker credentials and the connection metadata in transit.
That is a separate layer from the private Meshtastic channel key, which
encrypts the packet payload: a stolen broker password alone lets an attacker
publish to one gateway's topic, but the backend drops anything it cannot
decrypt with the channel key, and drops packets from unregistered senders.

`docs/DEPLOYMENT.md` records that some gateway firmware has reboot-looped with
TLS enabled. Verify TLS on a single device before configuring the rest. If the
hardware genuinely cannot do TLS, the plain `1884` listener in
`config/deploy/mosquitto.conf` is the documented retreat — uncomment it, open
`1884` instead of `8883`, and record the decision, understanding that broker
credentials then cross the network in the clear.

`<gateway-node-id>` is the gateway's Meshtastic node ID in its MQTT topic
form, for example `!0a000001`. The broker ACL must grant a gateway permission
to publish only to its own final topic segment:

```text
user gw-cel-01
topic write msh/US/2/e/+/!0a000001
```

The application subscribes to `msh/US/2/e/#`. A gateway must not publish to
the public Meshtastic broker or use the public broker's topic as a substitute.

## Meshtastic gateway configuration

In the gateway's Meshtastic MQTT module, configure:

- The deployment-provided broker host and field port.
- The individual MQTT username and password assigned to that gateway.
- Root topic `msh/US`.
- Uplink enabled only for the private channel.
- MQTT encryption enabled.
- JSON disabled, so the gateway publishes protobuf envelopes.

Do not configure a downlink topic or enable broker-based remote control. The
backend deliberately has no MQTT downlink API.

## Packet requirements and processing

Each MQTT message must contain an encrypted Meshtastic `ServiceEnvelope`.
The backend decrypts the packet with the shared private-channel key, then
validates it before storing anything. Plaintext, malformed, oversized, or
wrong-key messages are dropped.

The following payloads are processed:

- Telemetry: each present numeric field becomes a reading, including device
  metrics such as battery, voltage, and uptime.
- NeighborInfo: records observed mesh links and SNR.
- Position and NodeInfo: records values reported by the node; the
  administrator-registered map values remain authoritative.
- Other valid payloads: update the sender's last-heard time only.

The backend uses its receipt time, not the device clock. Meshtastic may deliver
the same packet through several paths or gateways; a packet with the same
sender node number and packet ID is accepted only once within 24 hours.

## Acceptance rules

A message is stored only when all of the following are true:

1. It is no more than 4096 bytes and decodes as an encrypted, valid packet.
2. The gateway named by the envelope is a registered, enabled gateway.
3. The packet sender is a registered, enabled device.
4. The sender and packet ID have not already been accepted in the previous
   24 hours.

Rejected packets do not receive a protocol response. They are logged by the
backend with a rejection reason. Repeated delivery is expected with QoS 1 and
with mesh routing, so gateways should allow MQTT client reconnects and retries.

## Security notes

- Use one broker credential per gateway; never share credentials between
  gateways.
- Restrict each credential to its exact publish topic using a Mosquitto ACL.
- Keep the private channel key secret. The backend requires a non-default
  base64 AES key of 16 or 32 bytes.
- Broker TLS is a deployment rollout decision. Until port `8883` is explicitly
  enabled, use only the supplied field port and secure the gateway's network
  access appropriately.
- Standard Meshtastic channel packets are not individually signed. Anyone who
  possesses the channel key could impersonate a node ID, so access to that key
  must be tightly controlled.

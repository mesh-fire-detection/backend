# DEPLOYMENT — Runbook

How to stand up and run the backend on one Hetzner VPS. Files referenced here
live in `config/deploy/`.

## 1. Server

1. Create an Ubuntu LTS VPS. Point `api.meshfiredetection.org` and
   `mqtt.meshfiredetection.org` (A/AAAA) at it.
2. Firewall: allow 22, 80, 443, and the Mosquitto field port (1884, or 8883
   once TLS is enabled). Nothing else. Do not allow 1883 from the Internet.
3. Install Node 24 (NodeSource), Caddy, Mosquitto, and Litestream.
4. Create users and directories:

    ```sh
    sudo useradd --system --home /var/lib/mesh-backend mesh
    sudo useradd --create-home deploy
    sudo mkdir -p /opt/mesh-backend/releases /var/lib/mesh-backend /etc/mesh-backend
    sudo chown -R deploy:deploy /opt/mesh-backend
    sudo chown mesh:mesh /var/lib/mesh-backend
    ```

5. Let `deploy` restart the service and nothing else:

    ```sh
    echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mesh-backend' | sudo tee /etc/sudoers.d/mesh-backend
    ```

## 2. Cloudflare DNS and MQTT routing

Cloudflare is the authoritative DNS provider for both hostnames, but it only
proxies the HTTP service. Configure these records in the Cloudflare DNS
dashboard:

| Hostname | Record | Target | Cloudflare proxy status | Traffic path |
| --- | --- | --- | --- | --- |
| `api.meshfiredetection.org` | A and/or AAAA | VPS public IP | Proxied (orange cloud) | Cloudflare → Caddy → Node app |
| `mqtt.meshfiredetection.org` | A and/or AAAA | Same VPS public IP | DNS only (gray cloud) | Gateway → Mosquitto |

The gray-cloud setting is required because the normal Cloudflare proxy carries
HTTP/HTTPS traffic, not raw MQTT/TCP. The gateway resolves
`mqtt.meshfiredetection.org` through Cloudflare DNS, then opens a direct TCP
connection to the VPS. It does not connect through Caddy, the HTTP API, or an
HTTPS URL.

The direct MQTT hostname necessarily exposes the VPS public IP to gateway
clients. Do not change `mqtt.meshfiredetection.org` to Proxied unless the
deployment intentionally adopts Cloudflare Spectrum, a separate Layer-4 TCP
proxy product; Spectrum is not part of this deployment.

Open the field port in both firewall layers:

- In the Hetzner Cloud Firewall, add an inbound TCP rule for port `1884`.
- On the VPS firewall, allow the same port; with UFW, run
  `sudo ufw allow 1884/tcp`.
- Do not add an inbound rule for port `1883`. Its Mosquitto listener binds to
  `127.0.0.1` and is only for the local Node backend.

Gateway LTE source addresses are normally dynamic, so the field-port firewall
rule cannot reliably restrict access by source IP. Access is instead enforced
by Mosquitto: every gateway has a distinct username and password, and its ACL
permits publishing only to that gateway's topic. An unauthenticated Internet
client may reach the TCP port, but cannot publish packets.

The current field listener is direct MQTT/TCP on `1884`; it is not HTTPS and
does not use transport TLS. Meshtastic private-channel encryption protects the
packet payload but does not protect MQTT connection metadata or broker
credentials in transit. Once TLS has been tested on actual gateway hardware,
configure Mosquitto with a certificate for `mqtt.meshfiredetection.org`, enable
its `8883` listener, change the firewall rule to `8883/TCP`, move gateways to
`mqtts://mqtt.meshfiredetection.org:8883`, and remove public access to `1884`.

## 3. Configuration

Create `/etc/mesh-backend/env` (owner `root:mesh`, mode `640`) from
`config/.env.example`:

```sh
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=/var/lib/mesh-backend/mesh.db
AUTH_SECRET=<32+ random characters>
AUTH_URL=https://api.meshfiredetection.org
CORS_ORIGIN=https://meshfiredetection.org
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=mesh-backend
MQTT_PASSWORD=<broker password>
MQTT_TOPIC="msh/US/2/e/#"
MESH_CHANNEL_KEY=<the mesh channel's private key, base64>
```

Quote `MQTT_TOPIC`: unquoted, `#` starts a comment. The app refuses to start
if the topic looks truncated or the channel key is a default key.

## 4. Services

- **Caddy:** copy `Caddyfile` to `/etc/caddy/Caddyfile`, `sudo systemctl reload caddy`.
- **Mosquitto:** copy `mosquitto.conf` to `/etc/mosquitto/conf.d/mesh.conf` and
  `mosquitto.acl` to `/etc/mosquitto/acl`. Create broker users:

    ```sh
    sudo mosquitto_passwd -c /etc/mosquitto/passwd mesh-backend
    sudo mosquitto_passwd /etc/mosquitto/passwd gw-cel-01
    sudo systemctl enable mosquitto
    sudo systemctl restart mosquitto
    ```

- **App:** copy `mesh-backend.service` to `/etc/systemd/system/`, then
  `sudo systemctl daemon-reload && sudo systemctl enable mesh-backend`.
- **Litestream:** copy `litestream.yml` to `/etc/litestream.yml`, put the
  bucket credentials in `/etc/default/litestream`, and
  `sudo systemctl enable --now litestream`.

## 5. First deploy

1. In GitHub, create the `production` environment with secrets
   `DEPLOY_HOST`, `DEPLOY_USER` (`deploy`), `DEPLOY_SSH_KEY`, and
   `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan api.meshfiredetection.org`).
2. Push to `main`. CI runs `npm run check`; the Deploy workflow uploads the
   release and runs `release.sh`, which installs production dependencies,
   switches `/opt/mesh-backend/current`, restarts, and checks `/health`.
   Database migrations run when the app starts.
3. Create the first admin on the server:

    ```sh
    cd /opt/mesh-backend/current
    sudo -u mesh node --env-file=/etc/mesh-backend/env dist/app/createAdmin.js \
        --email you@example.org --name "Your Name"
    ```

    Type the password when prompted.

## 6. Adding a gateway

1. Register the device (`POST /v1/devices`) and the gateway
   (`POST /v1/gateways` with its `mqttUsername`).
2. Create the broker user with `mosquitto_passwd`, add an ACL block allowing
   it to publish only under its own node ID, and restart Mosquitto.
3. On the gateway node, in the Meshtastic MQTT module: our broker address and
   field port, its username and password, **encryption enabled**, JSON off,
   and the root topic `msh/US`. Enable uplink on the private channel only.

## 7. Operations

- **Logs:** `journalctl -u mesh-backend -f` (JSON lines). Dropped packets are
  logged with a `reason`; `unregistered_node` and `unknown_gateway` are
  warnings.
- **Health:** point an external uptime monitor at
  `https://api.meshfiredetection.org/health`. It returns 503 when the database
  or broker connection is down.
- **Rollback:** `ln -sfn /opt/mesh-backend/releases/<previous> /opt/mesh-backend/current`
  then restart. Only roll back across releases without new migrations.
- **Restore test (before launch, then yearly):**

    ```sh
    litestream restore -config /etc/litestream.yml -o /tmp/restore.db /var/lib/mesh-backend/mesh.db
    sqlite3 /tmp/restore.db 'SELECT COUNT(*) FROM readings;'
    ```

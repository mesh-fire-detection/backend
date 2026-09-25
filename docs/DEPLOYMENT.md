# DEPLOYMENT — Runbook

How to stand up and run the backend on one Oracle Cloud Always Free instance.
Files referenced here
live in `config/deploy/`.

## 1. Server (Oracle Cloud Always Free)

Always Free covers this workload at no cost, with 10 TB of monthly egress —
enough that Litestream's continuous replication is not a concern. Google Cloud's
equivalent free tier allows 1 GB/month, which Litestream alone would exhaust.

1. **Upgrade the tenancy to Pay-As-You-Go.** Always Free resources stay free and
   the bill stays zero, but Oracle stops reclaiming instances it judges idle.
   A quiet week must not cost us the alerting backend.
2. Create the instance with Ubuntu LTS:
    - Preferred: `VM.Standard.A1.Flex`, 4 OCPU / 24 GB (Ampere, arm64). Far more
      than this needs, and free.
    - If Oracle reports "Out of host capacity" — common for A1 — either retry in
      another availability domain or fall back to `VM.Standard.E2.1.Micro`
      (x86, 1 GB). On the micro shape add swap before installing anything, since
      the app, broker, Caddy and Litestream share 1 GB:

        ```sh
        sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
        sudo mkswap /swapfile && sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
        ```

    Both architectures work: `better-sqlite3` ships a `linux-arm64` prebuild,
    and Caddy, Mosquitto, Litestream and Node 24 all publish arm64 builds. The
    prebuild is only used because `.npmrc` sets `ignore-scripts=true`; without
    it npm tries `node-gyp rebuild` and the install fails on a machine with no
    compiler.
3. **Reserve the public IP** (Networking → Reserved IPs, then attach it) so it
   survives a stop/start. An ephemeral IP changes and breaks both DNS records.
4. Open the ports in **both** layers. Doing only the first is the most common
   Oracle mistake, and the symptom — console says open, connections still hang —
   looks like a broken service:

    - **VCN Security List or NSG**, in the Oracle console: ingress TCP 80, 443
      and 8883 from `0.0.0.0/0`.
    - **The instance firewall.** Oracle's Ubuntu images ship pre-seeded iptables
      rules ending in a catch-all REJECT, persisted by `netfilter-persistent`.
      A rule appended after that REJECT never matches, so insert before it:

        ```sh
        sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
        sudo iptables -I INPUT 7 -p tcp --dport 443 -j ACCEPT
        sudo iptables -I INPUT 8 -p tcp --dport 8883 -j ACCEPT
        sudo netfilter-persistent save
        ```

        Check the position first with `sudo iptables -L INPUT -n --line-numbers`
        and adjust the indices so the new rules sit above the REJECT.

    - Never open 1883. Its listener binds to `127.0.0.1` for the local backend.

5. Install Node 24 (NodeSource), Caddy, Mosquitto, Litestream, and Certbot with
   its Cloudflare DNS plugin.
6. Create users and directories:

    ```sh
    sudo useradd --system --home /var/lib/mesh-backend mesh
    sudo useradd --create-home deploy
    sudo mkdir -p /opt/mesh-backend/releases /var/lib/mesh-backend /etc/mesh-backend
    sudo chown -R deploy:deploy /opt/mesh-backend
    sudo chown mesh:mesh /var/lib/mesh-backend
    ```

7. Let `deploy` restart the service and nothing else:

    ```sh
    echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mesh-backend' | sudo tee /etc/sudoers.d/mesh-backend
    ```

## 2. Cloudflare DNS and MQTT routing

Cloudflare is the authoritative DNS provider for both hostnames, but it only
proxies the HTTP service. Configure these records:

| Hostname | Record | Target | Cloudflare proxy status | Traffic path |
| --- | --- | --- | --- | --- |
| `api.meshfiredetection.org` | A and/or AAAA | Reserved public IP | Proxied (orange cloud) | Cloudflare → Caddy → Node app |
| `mqtt.meshfiredetection.org` | A and/or AAAA | Same IP | DNS only (gray cloud) | Gateway → Mosquitto |

Set the zone's SSL/TLS mode to **Full (strict)** so the proxied leg validates
Caddy's certificate rather than accepting anything.

The gray-cloud setting is required because the normal Cloudflare proxy carries
HTTP/HTTPS traffic, not raw MQTT/TCP. The gateway resolves
`mqtt.meshfiredetection.org` through Cloudflare DNS, then opens a direct TLS
connection to the server. It does not pass through Caddy or the HTTP API.

Do not change `mqtt.meshfiredetection.org` to Proxied unless the deployment
intentionally adopts Cloudflare Spectrum, a separate Layer-4 TCP proxy product;
Spectrum is not part of this deployment.

This hostname necessarily exposes the server's public IP, which also means the
API origin is reachable without passing through Cloudflare. That is why the
Caddyfile declares Cloudflare's ranges as `trusted_proxies` and sets `X-Real-IP`
itself: a forwarding header a client could set must never decide rate limiting.

### Broker certificate

`mqtt.meshfiredetection.org` is gray-cloud, so it has no Cloudflare edge
certificate, and HTTP-01 would need port 80 answering on that name. Use DNS-01
with a Cloudflare API token scoped to `Zone:DNS:Edit` for this zone only:

```sh
sudo install -d -m 700 /etc/letsencrypt
printf 'dns_cloudflare_api_token = %s
' "$TOKEN"     | sudo tee /etc/letsencrypt/cloudflare.ini > /dev/null
sudo chmod 600 /etc/letsencrypt/cloudflare.ini

sudo cp config/deploy/mosquitto-certs.sh     /etc/letsencrypt/renewal-hooks/deploy/mosquitto-certs.sh
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/mosquitto-certs.sh

sudo certbot certonly --dns-cloudflare     --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini     -d mqtt.meshfiredetection.org
```

Mosquitto cannot read `/etc/letsencrypt/live`, so the deploy hook copies the
certificate to `/etc/mosquitto/certs` and sends SIGHUP. Certbot runs the hook on
issue and on every renewal.

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

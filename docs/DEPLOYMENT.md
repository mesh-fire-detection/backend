# DEPLOYMENT — Runbook

How to stand up and run the backend on one small VPS. Files referenced here
live in `config/deploy/`. The steps below are the ones used for the first
production deploy on October 9, 2026; each "Nuance" note records something
that broke and how it was fixed.

## Current production

| Item            | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Server          | DigitalOcean droplet, Ubuntu 24.04, 1 vCPU / 512 MB RAM / 10 GB, NYC1   |
| Public IP       | `137.184.129.131`                                                       |
| API             | `https://api.meshfiredetection.org` (Cloudflare proxied → Caddy → Node) |
| MQTT field port | `mqtt.meshfiredetection.org:1884` (DNS only, direct to Mosquitto)       |
| Website         | `https://meshfiredetection.org` (GitHub Pages behind Cloudflare)        |
| Deploys         | GitHub Actions `Deploy` workflow, SSH as `root`                         |

Installed versions at first deploy: Node 24.21, Caddy 2.11.7, Mosquitto 2.0.18,
Litestream 0.5.17.

Secrets are never written to this repository. On the server they live in:

- `/etc/mesh-backend/env` — app config, `AUTH_SECRET`, broker password,
  `MESH_CHANNEL_KEY`.
- `/etc/mosquitto/passwd` — hashed broker logins.
- `/root/mqtt-gateway-credentials.txt` — the plaintext password for the
  `gw-cel-01` gateway login, kept so it can be typed into the gateway.

## 1. Server

1. Create an Ubuntu 24.04 VPS and add your SSH key for `root`.
2. **Swap.** With 512 MB RAM, `npm ci` and compiling `better-sqlite3` can run out
   of memory. Add 2 GB of swap:

    ```sh
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ```

3. **Packages.**

    ```sh
    apt-get update
    apt-get install -y curl gnupg ca-certificates rsync sqlite3 \
        mosquitto mosquitto-clients build-essential python3
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs
    ```

    > **Nuance — `build-essential` is required.** `better-sqlite3` has no
    > prebuilt binary for every Node 24 minor version. When none matches, `npm ci`
    > compiles it and fails with `gyp ERR! not found: make`. The first deploy
    > failed this way.

4. **Caddy** from its GitHub release:

    ```sh
    v=2.11.7
    curl -fsSLO https://github.com/caddyserver/caddy/releases/download/v$v/caddy_${v}_linux_amd64.deb
    dpkg -i caddy_${v}_linux_amd64.deb && rm caddy_${v}_linux_amd64.deb
    install -d -o caddy -g caddy /var/log/caddy
    ```

    > **Nuance — the Caddy apt repository returned `402 Payment Required`**
    > (dl.cloudsmith.io), so the documented apt install did not work. The
    > GitHub `.deb` does not create `/var/log/caddy`; without it Caddy fails to
    > start because the Caddyfile writes `api.log` there.
    >
    > **Nuance — do not run `caddy validate` as root before the first start.**
    > It creates `/var/log/caddy/api.log` owned by root, and Caddy (running as
    > `caddy`) then fails with `permission denied`. Fix:
    > `chown caddy:caddy /var/log/caddy/api.log`.

5. **Litestream** from its GitHub release, checksum verified:

    ```sh
    v=0.5.17
    curl -fsSLO https://github.com/benbjohnson/litestream/releases/download/v$v/litestream-$v-linux-x86_64.deb
    curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v$v/checksums.txt \
        | grep "litestream-$v-linux-x86_64.deb" | sha256sum -c -
    dpkg -i litestream-$v-linux-x86_64.deb
    ```

6. **App user and directories.** The app runs as a no-login system user
   `mesh`, so a bug in the app does not give root. Deploys run as `root`; there
   is no separate `deploy` user.

    ```sh
    useradd --system --home /var/lib/mesh-backend --shell /usr/sbin/nologin mesh
    mkdir -p /opt/mesh-backend/releases /var/lib/mesh-backend /etc/mesh-backend
    chown mesh:mesh /var/lib/mesh-backend
    ```

7. **Firewall.** The DigitalOcean droplet had no cloud firewall; UFW is used:

    ```sh
    ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 1884/tcp
    ufw --force enable
    ```

    Never open `1883`: that Mosquitto listener is bound to `127.0.0.1` for the
    backend only.

## 2. Configuration

Create `/etc/mesh-backend/env` (owner `root:mesh`, mode `640`):

```sh
HOST=127.0.0.1
PORT=3000
LOG_LEVEL=info
DATABASE_PATH=/var/lib/mesh-backend/mesh.db
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=https://api.meshfiredetection.org
CORS_ORIGIN=https://meshfiredetection.org
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=mesh-backend
MQTT_PASSWORD=<broker password for mesh-backend>
MQTT_TOPIC="msh/US/2/e/#"
MESH_CHANNEL_KEY=<base64 private channel key>
```

- Quote `MQTT_TOPIC`: unquoted, `#` starts a comment.
- The app refuses to start with an empty or default `MESH_CHANNEL_KEY`. A
  deploy before the key is set fails its health check.
- Generate the channel key once with `openssl rand -base64 32`. The same key
  must be installed on every sensor node and gateway; how it reaches the
  devices is still open (see "Open items").

## 3. Services

- **Mosquitto:**

    ```sh
    cp config/deploy/mosquitto.conf /etc/mosquitto/conf.d/mesh.conf
    install -m 640 -o root -g mosquitto config/deploy/mosquitto.acl /etc/mosquitto/acl
    touch /etc/mosquitto/passwd && chown root:mosquitto /etc/mosquitto/passwd && chmod 640 /etc/mosquitto/passwd
    mosquitto_passwd -b /etc/mosquitto/passwd mesh-backend '<password>'
    mosquitto_passwd -b /etc/mosquitto/passwd gw-cel-01 '<password>'
    systemctl enable mosquitto && systemctl restart mosquitto
    ```

    > **Nuance — Ubuntu's `/etc/mosquitto/mosquitto.conf` already sets
    > `persistence` and `persistence_location`.** Repeating
    > `persistence_location` in `conf.d` stops Mosquitto from starting, so our
    > `mosquitto.conf` no longer sets them.

    Check that anonymous clients are rejected:
    `mosquitto_sub -h 127.0.0.1 -p 1883 -t test -W 1` must print
    `not authorised`.

- **Caddy:** copy `Caddyfile` to `/etc/caddy/Caddyfile`, then
  `systemctl restart caddy`.
- **App:** copy `mesh-backend.service` to `/etc/systemd/system/`, then
  `systemctl daemon-reload && systemctl enable mesh-backend`. It starts on the
  first deploy.
- **Litestream:** installed, **not yet enabled** (no bucket yet). Copy
  `litestream.yml` to `/etc/litestream.yml`, put the bucket credentials in
  `/etc/default/litestream`, and `systemctl enable --now litestream`. Litestream
  0.5 changed its config format; check `litestream.yml` against the 0.5
  documentation when enabling it. **Until then the database has no backup.**

## 4. Cloudflare

DNS records (zone `meshfiredetection.org`):

| Name   | Type | Content           | Proxy status           |
| ------ | ---- | ----------------- | ---------------------- |
| `api`  | A    | `137.184.129.131` | Proxied (orange cloud) |
| `mqtt` | A    | `137.184.129.131` | DNS only (grey cloud)  |

`mqtt` must be grey: Cloudflare's proxy carries only HTTP(S), so an orange
`mqtt` record sends gateways to Cloudflare instead of Mosquitto. A grey record
publishes the server IP by design.

SSL/TLS settings:

- **Encryption mode: Full.** Set it explicitly; do not leave "Automatic", which
  started on Flexible.
- **Edge Certificates → Always Use HTTPS: On.** This redirects plain HTTP for
  the website; the API already redirects through Caddy.
- HSTS: leave off until everything has been stable for a while.
- Optional: a Configuration Rule setting SSL to **Full (strict)** for hostname
  `api.meshfiredetection.org` only.

> **Nuance — Flexible causes a redirect loop on the API.** Cloudflare connects
> to the origin over HTTP, Caddy redirects to HTTPS, and the browser receives
> the redirect again (`308` forever).
>
> **Nuance — Full (strict) breaks the website.** The site is on GitHub Pages
> behind the Cloudflare proxy, so GitHub never issued a certificate for
> `meshfiredetection.org` (`https_certificate: null`). The origin presents the
> generic `*.github.io` certificate, and strict mode answers with "Invalid SSL
> certificate". Full encrypts both hops without validating the origin
> certificate; use the per-hostname rule above to keep strict validation for
> the API.
>
> **Nuance — Caddy only gets its certificate once DNS exists.** Before the
> records were added, Let's Encrypt returned `NXDOMAIN` and Caddy backed off.
> `systemctl restart caddy` retries immediately.
>
> **Nuance — browsing the bare IP fails** with `ERR_SSL_PROTOCOL_ERROR`. Caddy
> serves a certificate only for `api.meshfiredetection.org`. This is expected.
>
> **Nuance — a computer that looked up the name before the record existed caches
> the miss.** On macOS: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`,
> then restart the browser.

### Email records

Transactional email goes through Resend (see `SPEC.md`). Add the domain in the
Resend dashboard and copy the generated values; the records below are the shape
to expect, not values to type in.

| Name                | Type | Content                      | Proxy status |
| ------------------- | ---- | ---------------------------- | ------------ |
| `send`              | TXT  | SPF, authorising Resend       | n/a          |
| `resend._domainkey` | TXT  | DKIM public key               | n/a          |
| `send`              | MX   | Resend's bounce host          | n/a          |
| `_dmarc`            | TXT  | `v=DMARC1; p=none; rua=...`   | n/a          |

Send from the `send` subdomain rather than the root, so a problem with
automated mail cannot damage the reputation of the domain used for ordinary
correspondence.

> **Nuance — the proxy does not apply to mail.** TXT and MX records have no
> proxy setting; the orange cloud is an HTTP feature. Adding mail records does
> not change how `api` or the website is served.

> **Nuance — start DMARC at `p=none`.** A strict policy before SPF and DKIM are
> confirmed working will send legitimate sign-in codes to spam. Read the
> reports for a few weeks, then tighten.

The API key is a secret: it belongs in `/etc/mesh-backend/env` with the others,
never in the repository.

## 5. GitHub deploys

The `production` environment of `mesh-fire-detection/backend` holds:

| Secret               | Value                                                            |
| -------------------- | ---------------------------------------------------------------- |
| `DEPLOY_HOST`        | `137.184.129.131`                                                |
| `DEPLOY_USER`        | `root`                                                           |
| `DEPLOY_SSH_KEY`     | private key whose public half is in `/root/.ssh/authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan 137.184.129.131`                          |

Create the deploy key once, on the server or a laptop, then remove the private
half from wherever it was created after pasting it into GitHub:

```sh
ssh-keygen -t ed25519 -N '' -C github-deploy -f mesh_deploy
cat mesh_deploy.pub >> /root/.ssh/authorized_keys   # on the server
```

`DEPLOY_KNOWN_HOSTS` lets the runner verify it is talking to the real server.
Without it, `ssh` stops at the host-key prompt. Rebuilding the server changes
its host key; run `ssh-keyscan` again and update the secret.

A push to `main` runs CI; when CI passes, the Deploy workflow builds, uploads the
release to `/opt/mesh-backend/releases/<sha>`, and runs `release.sh`. That script
installs production dependencies, switches `/opt/mesh-backend/current`, restarts
the service, and checks `/health`. Database migrations run when the app starts.

> **Nuance — an empty `SSH` target.** The first Deploy runs failed with an
> `ssh` usage message: the secrets had not been created, so `user@host` was
> empty. To retry a deploy for the same commit, re-run the failed Deploy run
> (`gh run rerun <id>`); the workflow has no manual trigger.

## 6. First admin

```sh
ssh -t root@137.184.129.131 'cd /opt/mesh-backend/current && sudo -u mesh node --env-file=/etc/mesh-backend/env dist/app/createAdmin.js --email you@example.org --name "Your Name"'
```

Type the password when prompted (12–128 characters).

## 7. Verification

```sh
ssh root@137.184.129.131 curl -s http://127.0.0.1:3000/health   # on the server
curl -s https://api.meshfiredetection.org/health                 # through Cloudflare
```

Both must return `{"status":"ok","database":"ok","mqtt":"connected"}`.
`http://api.meshfiredetection.org` must redirect to HTTPS.

## 8. Adding a gateway

1. Register the device (`POST /v1/devices`) and the gateway
   (`POST /v1/gateways` with its `mqttUsername`).
2. Create the broker user with `mosquitto_passwd`, add an ACL block allowing
   it to publish only under its own node ID, and restart Mosquitto.
3. On the gateway node, in the Meshtastic MQTT module: broker
   `mqtt.meshfiredetection.org`, port `1884`, its username and password,
   **encryption enabled**, JSON off, and the root topic `msh/US`. Enable uplink
   on the private channel only.

The field listener is plain MQTT/TCP on `1884`. Meshtastic channel encryption
protects packet payloads but not broker credentials in transit. Once TLS has
been tested on gateway hardware, enable Mosquitto's `8883` listener with a
certificate for `mqtt.meshfiredetection.org`, open `8883/tcp`, move gateways to
`mqtts://mqtt.meshfiredetection.org:8883`, and close `1884`.

## 9. Operations

- **Logs:** `journalctl -u mesh-backend -f` (JSON lines). Dropped packets are
  logged with a `reason`; `unregistered_node` and `unknown_gateway` are
  warnings. Caddy: `journalctl -u caddy` and `/var/log/caddy/api.log`.
- **Health:** point an external uptime monitor at
  `https://api.meshfiredetection.org/health`. It returns 503 when the database
  or broker connection is down.
- **Rollback:** `ln -sfn /opt/mesh-backend/releases/<previous> /opt/mesh-backend/current`
  then `systemctl restart mesh-backend`. Only roll back across releases without
  new migrations.
- **Restore test (once Litestream is enabled, then yearly):**

    ```sh
    litestream restore -config /etc/litestream.yml -o /tmp/restore.db /var/lib/mesh-backend/mesh.db
    sqlite3 /tmp/restore.db 'SELECT COUNT(*) FROM readings;'
    ```

## Open items

- **Backups:** create an R2 or B2 bucket and enable Litestream.
- **Email:** create the Resend account, verify `send.meshfiredetection.org`,
  and put the API key in `/etc/mesh-backend/env`. Nothing sends mail until
  then; the code lands with #8.
- **Channel key on devices:** the public firmware and the website's `/firmware`
  build must not contain the key. Options under discussion: a private local
  firmware build with the key in an ignored file, or a provisioning step on the
  website for logged-in admins.
- **Gateway transport:** a RAK13102 Notecard routes through Blues Notehub and
  cannot reach Mosquitto directly; no packets arrive over MQTT until a gateway
  can connect to port `1884`.
- **`node:sqlite`:** switching from `better-sqlite3` would remove the compiler
  requirement, but needs Drizzle 1.0, which is still a release candidate.
- **Audit findings** in [backend-2026-10-04.md](reviews/backend-2026-10-04.md),
  especially BE-01 (admin role self-removal) and BE-08 (health ignores
  subscription failure), before relying on alerts.

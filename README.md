# Mesh Fire Detection Backend

Node 24 / TypeScript backend for the Meshtastic fire-detection mesh. It stores
MQTT uplink packets in SQLite, serves the network map, and evaluates alert rules.

## Local development

Use Node 24 (`nvm use` if you have nvm), then:

```sh
npm ci
cp config/.env.example .env
```

Set `AUTH_SECRET` in `.env` to a random value of at least 32 characters. Generate
one with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep `MQTT_URL` empty to develop without a broker. The other local defaults use
`127.0.0.1:3000`, the website origin `http://localhost:5173`, and `data/mesh.db`.
SQLite migrations run automatically when the app opens the database.

```sh
npm run dev
```

Public endpoints: `GET /health` and `GET /api/network.json`. A fresh database
returns an empty network. Accounts are created by invite; there is no open signup.
To create the first admin, build and run:

```sh
npm run build
npm run user:create-admin -- --email you@example.org --name 'Your Name'
```

The CLI prompts for a password of 12–128 characters.

## Checks and production build

```sh
npm run check
```

`check` runs type checks, formatting, structure checks, ESLint, Knip, Vitest, and
the build.

```sh
npm run build
npm start
```

The build writes compiled JavaScript to `dist/`.

## Documentation

- [Requirements and decisions](docs/SPEC.md)
- [Architecture and API](docs/ARCHITECTURE.md)
- [Deployment and backups](docs/DEPLOYMENT.md)
- [MQTT and gateway setup](docs/MQTT.md)
- [Code quality standards](AGENTS.md)

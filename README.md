# Mesh Fire Detection Backend

Node 24 / TypeScript backend for the Meshtastic fire-detection mesh. It stores
MQTT uplink packets in SQLite, serves the network map, and evaluates alert rules.

## Local development

Use Node 24 (`nvm use` if you have nvm), then:

```sh
npm ci
npm run prepare
cp config/.env.example .env
```

`.npmrc` sets `ignore-scripts=true`, so dependency install scripts do not run.
`better-sqlite3` ships prebuilt binaries for every platform but declares no
install script, so npm would otherwise fall back to `node-gyp rebuild` and
demand a C++ toolchain to rebuild what is already there — which fails on
Windows, where that toolchain is not a normal prerequisite. Nothing here needs
those scripts. The trade-off is that `npm ci` no longer installs the Git hooks,
so run `npm run prepare` once after cloning.

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
npm run check:runtime
```

`check` runs type checks, formatting, structure checks, ESLint, Knip, Vitest, and
the build. `check:runtime` starts the compiled app with an isolated temporary
database and a free loopback port, checks health and the network feed, then checks
shutdown with SIGTERM. It does not load `.env` or connect to MQTT.

To check the API types against a local checkout of the website:

```sh
npm run check:contract -- ../web
```

The path defaults to `../web`. This checks the actual `MeshNode` and `MeshLink`
types in both repositories, including field names, nullability, and optional
fields; installing the website's dependencies is not required. Backend CI runs
this against the website's `main` branch as well as the runtime check.

```sh
npm run build
npm start
```

The build uses `config/build/tsconfig.build.json` and writes `dist/`. Imports use
the native `#src/*` alias in `package.json`: `src/*.ts` in development and
`dist/*.js` in production. Node types track the runtime's major version, 24.

## Documentation

- [Requirements and decisions](docs/SPEC.md)
- [Architecture and API](docs/ARCHITECTURE.md)
- [Deployment and backups](docs/DEPLOYMENT.md)
- [MQTT and gateway setup](docs/MQTT.md)
- [Code quality standards](AGENTS.md)

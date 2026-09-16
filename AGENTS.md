# AGENTS.md — Code Quality Standards (Backend)

Backend for Mesh Fire Detection. Read `docs/SPEC.md` (what to build and why) and
`docs/ARCHITECTURE.md` (how it is built) before making changes. If a change
contradicts either document, stop and ask instead of guessing; if a decision
changes, update the document in the same change.

## Purpose

- Keep the codebase maintainable, reliable, and easy to evolve.
- Optimize for clarity first, then performance and flexibility.
- This system may carry fire alerts. Correctness and predictable failure beat
  cleverness and speed.

## Formatting

- Use 4-space indentation in all files (Prettier `tabWidth: 4`).
- Prettier config matches the web repo: no semicolons, single quotes,
  `trailingComma: es5`, `printWidth: 100`.

## Core Quality Principles

- Prefer simple solutions over clever ones.
- Make behavior explicit; avoid hidden coupling between modules.
- Keep changes small, scoped, and reversible.
- Leave touched code cleaner than it was before.
- Add a dependency only when it removes real work; say why in the PR.

## Source Tree Organization

- Group by feature first, then by technical role inside that feature.
- Each feature uses the same file roles:
  `routes.ts` (HTTP only), `service.ts` (logic), `repo.ts` (SQL only),
  `schema.ts` (Zod schemas and the types derived from them).
- Layers call downward only: routes → service → repo. Routes never touch the
  database. Repos never contain business rules.
- Folders under `src/` need at least two entries; no single-file directories.
  Cap is 7 entries per folder. Related features are grouped (`mesh/`,
  `alerts/`) to stay under the cap.

```
src/
  index.ts
  app/          env, runtime, service wiring, server, jobs, admin CLI
  shared/
    auth/       sessions, roles, guards
    db/         connection, Drizzle schema, migrations runner
    http/       error handling, validation, rate limits
  health/       GET /health
  users/        accounts and invites
  mesh/
    devices/    registration and device admin
    gateways/   devices allowed to forward packets
    ingest/     MQTT subscriber, packet decoding, dedupe
    network/    builds /api/network.json
    readings/   sensor history queries
  alerts/
    rules/      user alert rules
    lifecycle/  alerts and their status history
    evaluation/ rule evaluation and the system alert sweep
```

## TypeScript Standards

- Strict mode. No `any`; use `unknown` and narrow.
- Types are derived from Zod schemas (`z.infer`) or Drizzle tables, never
  restated by hand.
- Public API response types match the web repo's `MeshNode` and `MeshLink`
  exactly. Changing them is a breaking change for the site.
- Prefer `readonly` shapes and immutable updates.
- Remove dead code and unused exports immediately (Knip fails the build).

## API Rules

- Every request body, query string, route param, and incoming MQTT payload is
  validated with Zod before any logic runs.
- Every route declares its access level: `public`, `user`, or `admin`.
  There is no implicit default.
- Errors return `{ error: { code, message } }` with the correct HTTP status.
  Never leak stack traces or SQL.
- Timestamps are ISO 8601 UTC in responses and stored as UTC.
- Units are metric and named in fields (`temperatureC`, `elevationM`).

## Data Rules

- Data is never deleted automatically. No pruning or TTL jobs without an
  explicit decision recorded in `docs/SPEC.md`.
- Schema changes go through Drizzle migrations. Never edit a migration that
  has been committed.
- Secrets (device keys, passwords) are never logged.

## Lint Severity

- There is no `warn`. A rule either blocks the build or is switched off
  explicitly, next to a comment saying why.

## Mandatory Quality Gates

- Run `npm run check` before commit. It runs type checks, lint, tests, and the
  build.
- During iteration, the minimum gate is `npm run check:types`, `npm run lint`,
  and `npm test`.
- If a gate fails, fix the issue and rerun before continuing.

## Testing

- Tests live in `tests/`, mirroring `src/`.
- Use Vitest with an in-memory SQLite database; each test gets a fresh one.
- Test routes through Hono's `app.request()`; no real network.
- Test MQTT ingest by feeding encoded packet fixtures to the decoder and
  service, not by running a broker (`tests/support/packets.ts` builds them).
- Every alert rule behavior (threshold, duration, cooldown, resolve) has a test.
- Every route has a test for its access level, including the rejected case.
  `tests/app/access.test.ts` also checks every non-public route rejects
  anonymous calls.

## Absolute Git Safety Rule

- Never run commands that discard local uncommitted changes (`git checkout --`,
  `git restore`, `git reset --hard`, `git clean -fd`).
- Never commit unless the user explicitly asks.

## Definition of Done

- Type checks, lint, tests, and build pass.
- `docs/` reflects any changed decision.
- No dead code, no temporary workarounds, no unexplained rule suppressions.

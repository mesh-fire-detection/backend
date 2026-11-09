# Changelog

Notable changes to the backend, by release. How releases are cut is in
[RELEASING.md](RELEASING.md). Entries that add a database migration say so.

## Unreleased

### Added

- `DELETE /v1/gateways/:nodeId` stops a node being a gateway, so a Notecard
  can move to another board. No migration.

### Fixed

- A node with a Notecard on its gateway is shown as `cellular`, not the type
  it was first registered with (often `sensor`, from the firmware's default
  name). Moving the Notecard moves the type with it.

## 0.2.1 — 2026-11-08

### Changed

- Dependencies updated within their major versions (#38), including
  better-auth 1.7.18, drizzle-orm 0.45.4, hono 4.13.17 and zod 4.6.7.
  TypeScript 7, `@types/node` 26 and eslint-plugin-unicorn 79 are held,
  with reasons in #47. No migrations.

## 0.2.0 — 2026-11-08

The first tagged release. Until now every merge to `main` deployed, so most of
this already ran in production while `/health` still said 0.1.1. Only the
account changes and migration 0012 are new to the server.

### Added

- Your sessions on `/v1/me/sessions`: see where you are signed in, end one
  session, or sign out everywhere. Tokens never leave the server.
- Your sign-in methods on `/v1/me/sign-in-methods`: the emailed code, which
  cannot be removed, and Google, which can.
- Deleting your own account, `DELETE /v1/me` (SPEC, Leaving). **Migration
  0012** adds `users.deleted_at`; it is additive.
- Sign in and join with Google (#41).
- Membership: sign in with an emailed code, join by invitation or with a node
  you connected, and project updates (#31, #32).
- Members register nodes and are listed on them; approximate positions for
  everyone else; a browser's copy of a node's readings is accepted.

### Changed

- Deploys run when a GitHub Release is published, not on every merge to `main`
  (#42). Running Deploy by hand with an earlier tag rolls back to it.
- Sessions last seven days from last use, set explicitly (#15 Q18).

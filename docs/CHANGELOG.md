# Changelog

Notable changes to the backend, by release. How releases are cut is in
[RELEASING.md](RELEASING.md). Entries that add a database migration say so.

## Unreleased

### Changed

- Deploys run when a GitHub Release is published, not on every merge to `main`
  (#42). Running Deploy by hand with an earlier tag rolls back to it.

# RELEASING — How the backend ships

Merging to `main` does not deploy. Publishing a GitHub Release does (#42):
merges collect on `main`, and a release is the decision to ship them. The
website releases the same way (web#21).

Versions are [semantic](https://semver.org): `vMAJOR.MINOR.PATCH`. Before 1.0,
a new feature or a migration bumps MINOR and a fix bumps PATCH. The version
lives in `package.json`, and `/health` reports it, so the server always says
which release it is running.

## Cutting a release

1. **Open a release pull request** from `main`, titled `chore(release): vX.Y.Z`:
    - `npm version X.Y.Z --no-git-tag-version`, which updates `package.json` and
      `package-lock.json`.
    - In `docs/CHANGELOG.md`, rename `Unreleased` to `X.Y.Z — YYYY-MM-DD` and
      start a new, empty `Unreleased` above it. Say which entries add a
      **migration**: those cannot be rolled back by redeploying.

    It is a pull request because it touches `package.json`, and CI checks it
    like any other.

2. **Squash-merge it.**

3. **Publish the release** on that merge commit:

    ```sh
    gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file <notes>
    ```

    Paste the changelog section as the notes. `--generate-notes` adds the list
    of pull requests, if wanted.

4. **Watch the Deploy run** (`gh run watch`). It refuses a tag that is not
   `vX.Y.Z`, that disagrees with `package.json`, or that is not on `main`, then
   runs `npm run check` on exactly that commit and deploys it. Afterwards,
   `https://api.meshfiredetection.org/health` reports the new version.

A **prerelease** never deploys.

When a feature spans both repositories, release the backend first: the
website calls its new routes.

## Rolling back

Run Deploy by hand with the previous tag:

```sh
gh workflow run deploy.yml -f tag=vX.Y.Z
```

That builds and deploys the earlier release exactly as before. **Not across a
migration:** the database has already moved on, and the old code may not
understand it. Fix forward instead, or restore the copy `release.sh` took
before migrating (`/var/lib/mesh-backend/pre-release/`). See
[DEPLOYMENT.md](DEPLOYMENT.md).

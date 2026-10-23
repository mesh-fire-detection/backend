#!/usr/bin/env bash
# Runs on the server. Installs an uploaded release and switches to it.
# Usage: release.sh <release-dir>
set -euo pipefail

release_dir="$1"
app_root=/opt/mesh-backend

cd "$release_dir"
NODE_ENV=production npm ci --omit=dev --no-audit --no-fund

# Keep the previous release for a quick manual rollback: point `current` back.
ln -sfn "$release_dir" "$app_root/current.new"
mv -Tf "$app_root/current.new" "$app_root/current"

sudo systemctl restart mesh-backend

# Wait for the service rather than guessing at it. A fixed sleep made every
# deploy report failure while the release was in fact fine: the app migrates
# SQLite and opens its port in its own time, and three seconds is not it on a
# 512 MB droplet. Poll until it answers, and fail only if it never does.
deadline=$((SECONDS + 60))
until curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/health; do
    if (( SECONDS >= deadline )); then
        echo "The service did not become healthy within 60 seconds." >&2
        systemctl --no-pager --lines=40 status mesh-backend >&2 || true
        exit 1
    fi
    sleep 2
done

# Keep the five newest releases.
ls -1dt "$app_root"/releases/* | tail -n +6 | xargs -r rm -rf

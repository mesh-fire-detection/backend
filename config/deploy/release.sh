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
sleep 3
curl --fail --silent --show-error http://127.0.0.1:3000/health

# Keep the five newest releases.
ls -1dt "$app_root"/releases/* | tail -n +6 | xargs -r rm -rf

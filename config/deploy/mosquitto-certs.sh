#!/usr/bin/env bash
# /etc/letsencrypt/renewal-hooks/deploy/mosquitto-certs.sh
#
# Certbot deploy hook. Mosquitto runs as an unprivileged user and cannot read
# /etc/letsencrypt/live, so copy the certificate where it can and reload.
# Certbot runs deploy hooks only when a certificate was actually renewed.
set -euo pipefail

domain=mqtt.meshfiredetection.org
live=/etc/letsencrypt/live/$domain
certs=/etc/mosquitto/certs

# Renewals of other certificates on this host must not touch Mosquitto.
[ "${RENEWED_LINEAGE:-$live}" = "$live" ] || exit 0

install -d -o root -g mosquitto -m 750 "$certs"
install -o root -g mosquitto -m 640 "$live/fullchain.pem" "$certs/fullchain.pem"
install -o root -g mosquitto -m 640 "$live/privkey.pem" "$certs/privkey.pem"

# SIGHUP makes Mosquitto reread its certificates without dropping connections.
systemctl kill -s HUP mosquitto

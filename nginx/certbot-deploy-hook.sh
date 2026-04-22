#!/usr/bin/env sh
# =============================================================================
# FireISP 5.0 — Certbot deploy hook
#
# Automatically called by `certbot renew` when a certificate is successfully
# renewed.  Copies the renewed certificate and private key into the
# ./nginx/certs/ bind-mount so that the nginx container picks them up on its
# next periodic reload (every 6 hours).
#
# This script is mounted read-only into the certbot container at:
#   /etc/letsencrypt/renewal-hooks/deploy/copy-certs.sh
#
# Environment variables provided by certbot at hook time:
#   RENEWED_LINEAGE  — path to the renewed cert lineage, e.g.
#                      /etc/letsencrypt/live/isp.example.com
#   RENEWED_DOMAINS  — space-separated list of renewed domain names
# =============================================================================
set -e

if [ -z "$RENEWED_LINEAGE" ]; then
  echo "[certbot-deploy-hook] RENEWED_LINEAGE is not set — skipping." >&2
  exit 0
fi

# /certs is the ./nginx/certs bind-mount (see docker-compose.prod.yml)
DEST="/certs"

if [ ! -d "$DEST" ]; then
  echo "[certbot-deploy-hook] Destination $DEST not found — skipping." >&2
  exit 0
fi

cp "$RENEWED_LINEAGE/fullchain.pem" "$DEST/fullchain.pem"
cp "$RENEWED_LINEAGE/privkey.pem"   "$DEST/privkey.pem"
chmod 644 "$DEST/fullchain.pem"
chmod 640 "$DEST/privkey.pem"

echo "[certbot-deploy-hook] Renewed certs for $RENEWED_DOMAINS copied to $DEST."
echo "[certbot-deploy-hook] nginx will reload within 6 hours and pick up the new certificate."

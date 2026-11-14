#!/usr/bin/env bash
# Deploy RideOn to seamengine.com/rideon (separate worker; the main seamengine site is untouched)
set -e; cd "$(dirname "$0")"
set -a; source <(grep -E "^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)=" "C:/Users/erolm/.claude/secrets/credentials.env" | tr -d '\r'); set +a
G:/MUSICTRANSITION/seamengine/node_modules/.bin/wrangler deploy 2>&1 | tail -2

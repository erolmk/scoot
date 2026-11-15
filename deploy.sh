#!/usr/bin/env bash
# Deploy SCoot to both addresses: seamengine.com/scoot (worker "rideon") and scootusc.pages.dev (Pages project "scootusc").
set -e; cd "$(dirname "$0")"
set -a; source <(grep -E "^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)=" "C:/Users/erolm/.claude/secrets/credentials.env" | tr -d '\r'); set +a
W=G:/MUSICTRANSITION/seamengine/node_modules/.bin/wrangler
$W deploy 2>&1 | tail -2
# The Pages copy serves public/scoot at its root and runs the same worker.js (advanced mode), so the AI checks work there too.
rm -rf pages/dist && mkdir -p pages/dist && cp -r public/scoot/* pages/dist/ && cp worker.js pages/dist/_worker.js
(cd pages && $W pages deploy --project-name scootusc --branch main --commit-dirty=true 2>&1 | tail -1)

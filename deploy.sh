#!/usr/bin/env bash
# Deploy Life Kanban to Cloudflare Pages (https://life-kanban.pages.dev).
#
# The Pages project is a DIRECT UPLOAD project (not git-connected), so pushing
# to GitHub does NOT update it — you must run this script. GitHub Pages
# (tombozza.github.io/lifelist) does auto-deploy on push, so the two can drift
# apart if you forget.
#
# Usage:  ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

# Two Cloudflare accounts are now signed in, and wrangler refuses to guess in a
# non-interactive shell. Pin Tom's (see the root CLAUDE.md) or every deploy stops
# with "More than one account available".
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-a5ff0413b8715c423a0aef7438557f54}"

# Stage only the site files — deploying the repo root would also upload .claude
# (wrangler ignores .gitignore, and Pages direct upload ignores .assetsignore).
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp index.html app.js styles.css sw.js manifest.json "$STAGE"/
cp -R icons "$STAGE"/icons
cp -R vendor "$STAGE"/vendor
# Pages Functions (the /api backend that replaced Supabase) must ship too.
cp -R functions "$STAGE"/functions

echo "Deploying $(grep -m1 CACHE_NAME sw.js) …"
npx wrangler@latest pages deploy "$STAGE" \
  --project-name=life-kanban --branch=main --commit-dirty=true

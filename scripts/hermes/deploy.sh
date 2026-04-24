#!/usr/bin/env bash
# Deploy the Hermes router to Railway.
#
# This script is intentionally minimal — Railway's deploy model is
# "push from local or from GitHub". For HomeHub we use the Railway CLI
# `railway up` to push from this working tree. Env vars and secrets
# live in the Railway service config (set via dashboard or `railway
# variables set`).
#
# Prereqs:
#   1. `railway login` (done once)
#   2. `railway link` from apps/hermes-router to the hermes-router
#      service (done once per machine)
#   3. E2B template built (one-time): see apps/hermes-host/README
#
# Usage:
#   bash scripts/hermes/deploy.sh
#
# What this does NOT do:
#   - Create the Railway service for you (create it in the Railway UI,
#     pick "Deploy from repo → apps/hermes-router")
#   - Set Railway env vars (see printed checklist below)
#   - Apply Supabase migrations (run `supabase db push` from
#     packages/db after linking your project)
#
# What this DOES do:
#   - Build + push the router image via Railway
#   - Print the required env-var checklist
#   - Remind you about the E2B template build

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}/apps/hermes-router"

if ! command -v railway >/dev/null 2>&1; then
  echo "ERROR: Railway CLI not found. Install: https://docs.railway.com/guides/cli" >&2
  exit 1
fi

echo "┌─────────────────────────────────────────────────────────────"
echo "│ Deploying apps/hermes-router to Railway"
echo "└─────────────────────────────────────────────────────────────"
railway up --detach

echo ""
echo "┌─────────────────────────────────────────────────────────────"
echo "│ Post-deploy checklist"
echo "├─────────────────────────────────────────────────────────────"
echo "│ 1. Set these env vars on the hermes-router Railway service"
echo "│    (Railway dashboard → Variables, or \`railway variables set\`):"
echo "│"
echo "│      SUPABASE_URL                     = https://<ref>.supabase.co"
echo "│      SUPABASE_SERVICE_ROLE_KEY        = <service_role key>"
echo "│      HOMEHUB_SUPABASE_URL             = https://<ref>.supabase.co"
echo "│      HOMEHUB_SUPABASE_ANON_KEY        = <public anon key>"
echo "│      HOMEHUB_SUPABASE_JWT_SECRET      = <Legacy HS256 from Supabase>"
echo "│      HOMEHUB_OPENROUTER_API_KEY       = <OpenRouter key>"
echo "│      HERMES_DEFAULT_MODEL             = deepseek/deepseek-v4-pro"
echo "│      HERMES_TOOLSETS                  = skills,terminal"
echo "│      E2B_API_KEY                      = <E2B key>"
echo "│      E2B_TEMPLATE                     = homehub-hermes"
echo "│      HERMES_STORAGE_BUCKET            = hermes-state"
echo "│      HERMES_SHARED_SECRET             = \$(openssl rand -hex 32)"
echo "│      HOMEHUB_PROXY_SECRET             = \$(openssl rand -hex 32)"
echo "│      HOMEHUB_PROVISION_SECRET         = \$(openssl rand -hex 32)"
echo "│"
echo "│ 2. Build the E2B template (one-time, and on template changes):"
echo "│      E2B_API_KEY=<key> pnpm --filter @homehub/hermes-host template:build"
echo "│"
echo "│ 3. Apply Supabase migrations (0016 + 0017 for Storage bucket + RLS):"
echo "│      (cd packages/db && supabase db push)"
echo "│"
echo "│ 4. Set Vercel env on apps/web:"
echo "│      HOMEHUB_USE_HERMES_ROUTER=1"
echo "│      HOMEHUB_HERMES_ROUTER_URL=https://<router>.up.railway.app"
echo "│      HOMEHUB_HERMES_ROUTER_SECRET=<HOMEHUB_PROXY_SECRET from above>"
echo "│      HOMEHUB_HERMES_PROVISION_SECRET=<HOMEHUB_PROVISION_SECRET>"
echo "└─────────────────────────────────────────────────────────────"

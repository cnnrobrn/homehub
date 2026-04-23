#!/usr/bin/env bash
# Shut down every Hermes-related GCP resource.
#
# Safe to run any time — it only touches resources named with the
# `hermes` prefix or matching bucket name. If you have other Hermes
# stuff in the project you don't want deleted, edit this script first.
#
# Destroys:
#   - GCS bucket homehub-hermes-state-prod (and everything in it)
#   - Secret Manager: hermes-* secrets
#   - Artifact Registry repo `hermes`
#   - Service account hermes-router-sa@homehub-494013.iam.gserviceaccount.com
#
# This is **destructive**. Run the export below first if you want to
# preserve anything.

set -euo pipefail

PROJECT=homehub-494013
REGION=us-central1

echo "┌─────────────────────────────────────────────────────────────"
echo "│ Shutting down Hermes GCP resources in ${PROJECT}"
echo "└─────────────────────────────────────────────────────────────"

# ── GCS bucket ──────────────────────────────────────────────────────
echo "=== GCS bucket: gs://homehub-hermes-state-prod ==="
if gcloud storage buckets describe "gs://homehub-hermes-state-prod" \
    --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud storage rm --recursive "gs://homehub-hermes-state-prod" \
    --project="${PROJECT}" --quiet 2>&1 | tail -3 || true
fi

# ── Secret Manager ──────────────────────────────────────────────────
echo "=== Secret Manager: hermes-* ==="
for s in \
  hermes-proxy-secret \
  hermes-provision-secret \
  hermes-shared-secret \
  hermes-openrouter-key \
  hermes-supabase-service-role-key \
  hermes-supabase-anon-key \
  hermes-supabase-jwt-secret \
  hermes-e2b-api-key; do
  if gcloud secrets describe "${s}" --project="${PROJECT}" >/dev/null 2>&1; then
    echo "deleting secret ${s}"
    gcloud secrets delete "${s}" --project="${PROJECT}" --quiet
  fi
done

# ── Artifact Registry ───────────────────────────────────────────────
echo "=== Artifact Registry: hermes ==="
if gcloud artifacts repositories describe hermes \
    --project="${PROJECT}" --location="${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories delete hermes \
    --project="${PROJECT}" --location="${REGION}" --quiet
fi

# ── Service account ─────────────────────────────────────────────────
echo "=== Service account: hermes-router-sa ==="
SA="hermes-router-sa@${PROJECT}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "${SA}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts delete "${SA}" --project="${PROJECT}" --quiet
fi

echo ""
echo "┌─────────────────────────────────────────────────────────────"
echo "│ Done. GCP has nothing Hermes-shaped left."
echo "│ Router is now Railway, state is Supabase Storage, sandboxes are E2B."
echo "└─────────────────────────────────────────────────────────────"

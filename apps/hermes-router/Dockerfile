# syntax=docker/dockerfile:1.7
# Multi-stage build for @homehub/hermes-router.
#
# Mirrors apps/workers/*/Dockerfile but copies apps/hermes-router
# instead of apps/workers. Build context is the repo root (Railway
# uploads the whole archive), so paths are relative to repo root.
#
# Node pin matches CI (.github/workflows/ci.yml NODE_VERSION).
ARG SERVICE_NAME=hermes-router

# ---- builder ----------------------------------------------------------------
FROM node:20.18.0-alpine AS builder
ARG SERVICE_NAME
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
# Bundled corepack on node:20.18.0-alpine ships stale npm-registry
# signing keys; upgrade before enabling so signature verification
# against the current registry keys succeeds.
RUN npm install -g corepack@latest && corepack enable

WORKDIR /workspace

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/hermes-router apps/hermes-router

RUN pnpm install --frozen-lockfile --filter "@homehub/${SERVICE_NAME}..."
# `...` makes pnpm build workspace deps (shared/db/worker-runtime) in
# topo order before the service itself; without it, deploy packs
# workspace deps whose `files: ["dist"]` directories are empty.
RUN pnpm --filter "@homehub/${SERVICE_NAME}..." build
RUN pnpm --filter "@homehub/${SERVICE_NAME}" deploy --prod /out

# ---- runtime ----------------------------------------------------------------
FROM node:20.18.0-alpine AS runtime
ARG SERVICE_NAME
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --from=builder /out /app

EXPOSE 8080
CMD ["node", "dist/main.js"]

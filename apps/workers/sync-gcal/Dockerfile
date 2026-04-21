# syntax=docker/dockerfile:1.7
# Multi-stage build for a HomeHub worker service.
# ------------------------------------------------------------------
# This Dockerfile is intentionally copy-pasted across every worker in
# apps/workers/* and apps/mcp/*. The only thing that changes between
# services is the SERVICE_NAME build-arg below. A generator would save
# repetition but cost clarity; see scripts/agents/infra-platform.md.
#
# Node pin matches CI (.github/workflows/ci.yml NODE_VERSION).
# ------------------------------------------------------------------
ARG SERVICE_NAME=worker-sync-gcal

# ---- builder ----------------------------------------------------------------
FROM node:20.19.0-alpine AS builder
ARG SERVICE_NAME
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /workspace

# Copy workspace manifests first for better Docker layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/workers apps/workers
COPY apps/mcp apps/mcp

RUN pnpm install --frozen-lockfile --filter "@homehub/${SERVICE_NAME}..."
RUN pnpm --filter "@homehub/${SERVICE_NAME}" build
RUN pnpm --filter "@homehub/${SERVICE_NAME}" deploy --prod /out

# ---- runtime ----------------------------------------------------------------
FROM node:20.19.0-alpine AS runtime
ARG SERVICE_NAME
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

# `pnpm deploy --prod` produced a self-contained bundle at /out.
COPY --from=builder /out /app

EXPOSE 8080
CMD ["node", "dist/main.js"]

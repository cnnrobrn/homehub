# syntax=docker/dockerfile:1.7
# Multi-stage build for a HomeHub worker service.
# ------------------------------------------------------------------
# Copy-pasted across every service under apps/workers/* and apps/mcp/*.
# Only the SERVICE_NAME build-arg changes per service.
#
# Node pin matches CI (.github/workflows/ci.yml NODE_VERSION).
# ------------------------------------------------------------------
ARG SERVICE_NAME=worker-foreground-agent

# ---- builder ----------------------------------------------------------------
FROM node:20.19.0-alpine AS builder
ARG SERVICE_NAME
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /workspace

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

COPY --from=builder /out /app

EXPOSE 8080
CMD ["node", "dist/main.js"]

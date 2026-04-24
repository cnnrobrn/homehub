# syntax=docker/dockerfile:1.7
# Local-dev Docker build of the Hermes sandbox image.
#
# In production the sandbox runs as an E2B Firecracker microVM built
# from `template.ts`. This Dockerfile is a parallel definition for
# running the same entrypoint locally with `docker run`, or for future
# migration to a Docker-based sandbox platform (e.g. Cloud Run
# Sandboxes when they GA).
#
# Same contract as the E2B template:
#   - state hydrate/persist via curl against Supabase Storage
#   - no GCP dependencies
#   - Hermes at /opt/hermes-agent, skills baked at /opt/hermes-skills-base

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HERMES_HOME=/tmp/hermes

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git curl ca-certificates build-essential \
        ffmpeg ripgrep rsync \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv

ARG HERMES_REF=main
RUN git clone --depth 1 --branch "${HERMES_REF}" \
        https://github.com/NousResearch/hermes-agent.git /opt/hermes-agent \
    && cd /opt/hermes-agent \
    && uv venv /opt/hermes-agent/venv --python 3.11 \
    && VIRTUAL_ENV=/opt/hermes-agent/venv \
       uv pip install -e "." \
    && rm -rf /root/.cache

# Paths relative to the build context (apps/hermes-host/).
COPY skills-base /opt/hermes-skills-base
COPY server /opt/hermes-host/server
COPY bin/homehub /usr/local/bin/homehub
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /usr/local/bin/homehub

# No ENTRYPOINT: E2B boots a long-running shell by default, and the
# router invokes /entrypoint.sh per-turn via `commands.run`. A baked-in
# ENTRYPOINT would try to run at sandbox start before HOUSEHOLD_ID /
# HERMES_STORAGE_* envs are set, and its `: "${HOUSEHOLD_ID:?...}"`
# guard would exit 1 — which E2B treats as a failed template.

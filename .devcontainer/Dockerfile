FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

ARG OPENCODE_VERSION=2.1.3

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@opencode/cli@${OPENCODE_VERSION}"

USER node

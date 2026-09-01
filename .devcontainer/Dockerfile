FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb libgtk-3-0 libwebkit2gtk-4.0-37 libasound2 \
  && rm -rf /var/lib/apt/lists/*
USER node

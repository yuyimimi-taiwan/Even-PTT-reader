FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates gnupg xvfb libgtk-3-0 libwebkit2gtk-4.0-37 libasound2 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
USER vscode

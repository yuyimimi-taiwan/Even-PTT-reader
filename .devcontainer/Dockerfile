FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb libgtk-3-0 libwebkit2gtk-4.1-0 libasound2 \
  && rm -rf /var/lib/apt/lists/*
USER vscode

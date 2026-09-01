FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends software-properties-common curl ca-certificates gnupg \
  && add-apt-repository -y universe \
  && apt-get update \
  && apt-get install -y --no-install-recommends xvfb libgtk-3-0 libwebkit2gtk-4.1-0 libasound2 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
USER vscode

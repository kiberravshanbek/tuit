#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "[1/5] apt update"
sudo apt-get update -y

echo "[2/5] install core packages"
sudo apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  nginx \
  certbot \
  python3-certbot-nginx

echo "[3/5] install docker + compose plugin"
if ! dpkg -s docker.io >/dev/null 2>&1; then
  sudo apt-get install -y docker.io
fi

if ! docker compose version >/dev/null 2>&1; then
  sudo apt-get install -y docker-compose-plugin || sudo apt-get install -y docker-compose-v2
fi

echo "[4/5] enable docker service"
sudo systemctl enable --now docker

echo "[5/5] add current user to docker group"
sudo usermod -aG docker "$USER"

echo
echo "Done. Re-login (or run: newgrp docker) before using docker without sudo."

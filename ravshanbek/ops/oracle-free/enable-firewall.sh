#!/usr/bin/env bash
set -euo pipefail

echo "Allowing required ports (SSH/HTTP/HTTPS)"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

echo "Enabling UFW"
sudo ufw --force enable

echo "UFW status:"
sudo ufw status verbose

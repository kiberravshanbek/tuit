#!/usr/bin/env bash
set -euo pipefail

LE_EMAIL="${1:-}"
ADMIN_USER_VALUE="${2:-}"
ADMIN_PASS_VALUE="${3:-}"
APP_DIR="${4:-/opt/olimpiada}"
PUBLIC_IP="${5:-}"

if [[ -z "$LE_EMAIL" || -z "$ADMIN_USER_VALUE" || -z "$ADMIN_PASS_VALUE" ]]; then
  echo "Usage: $0 <letsencrypt_email> <admin_user> <admin_pass> [app_dir] [public_ip]" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "App directory not found: $APP_DIR" >&2
  exit 1
fi

if [[ -z "$PUBLIC_IP" ]]; then
  if command -v curl >/dev/null 2>&1; then
    PUBLIC_IP="$(curl -fsS https://api.ipify.org || true)"
  fi
fi

if [[ -z "$PUBLIC_IP" ]]; then
  echo "Could not detect public IP automatically." >&2
  echo "Please pass it as 5th argument, for example: 129.146.10.20" >&2
  exit 1
fi

if ! [[ "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Invalid IPv4 address: $PUBLIC_IP" >&2
  exit 1
fi

DOMAIN="${PUBLIC_IP//./-}.sslip.io"

cd "$APP_DIR"
chmod +x ops/oracle-free/quick-deploy.sh
./ops/oracle-free/quick-deploy.sh "$DOMAIN" "$LE_EMAIL" "$ADMIN_USER_VALUE" "$ADMIN_PASS_VALUE" "$APP_DIR"

echo
echo "Generated global domain: https://${DOMAIN}"
echo "Student registration:    https://${DOMAIN}/"
echo "Student test page:       https://${DOMAIN}/test.html"
echo "Admin panel:             https://${DOMAIN}/login.html"

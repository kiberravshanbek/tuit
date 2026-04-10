#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
UPSTREAM_HOST="${UPSTREAM_HOST:-127.0.0.1}"
UPSTREAM_PORT="${UPSTREAM_PORT:-3000}"
SITE_NAME="olimpiada"
NGINX_SITE="/etc/nginx/sites-available/${SITE_NAME}.conf"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: $0 <domain> <email>" >&2
  exit 1
fi

echo "[1/5] install nginx/certbot if needed"
sudo apt-get update -y
sudo apt-get install -y nginx certbot python3-certbot-nginx

echo "[2/5] write nginx site config"
sudo tee "$NGINX_SITE" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 10m;

    location / {
        proxy_pass http://${UPSTREAM_HOST}:${UPSTREAM_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

echo "[3/5] enable nginx site"
sudo ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/${SITE_NAME}.conf"
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  sudo rm -f /etc/nginx/sites-enabled/default
fi
sudo nginx -t
sudo systemctl reload nginx

echo "[4/5] issue TLS certificate"
sudo certbot --nginx --non-interactive --agree-tos --email "$EMAIL" -d "$DOMAIN" --redirect

echo "[5/5] show certbot timer status"
sudo systemctl status certbot.timer --no-pager || true

echo "Done. HTTPS is active on https://${DOMAIN}"

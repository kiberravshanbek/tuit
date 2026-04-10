#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
LE_EMAIL="${2:-}"
ADMIN_USER_VALUE="${3:-}"
ADMIN_PASS_VALUE="${4:-}"
APP_DIR="${5:-/opt/olimpiada}"

if [[ -z "$DOMAIN" || -z "$LE_EMAIL" || -z "$ADMIN_USER_VALUE" || -z "$ADMIN_PASS_VALUE" ]]; then
  echo "Usage: $0 <domain> <letsencrypt_email> <admin_user> <admin_pass> [app_dir]" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "App directory not found: $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/.env.example" ]]; then
  echo ".env.example not found in $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/docker-compose.yml" ]]; then
  echo "docker-compose.yml not found in $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/ops/oracle-free/install-prereqs.sh" ]]; then
  echo "Expected ops scripts not found in $APP_DIR/ops/oracle-free" >&2
  exit 1
fi

escape_sed() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

SESSION_SECRET_VALUE="${SESSION_SECRET:-}"
if [[ -z "$SESSION_SECRET_VALUE" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    SESSION_SECRET_VALUE="$(openssl rand -hex 32)"
  else
    SESSION_SECRET_VALUE="$(head -c 48 /dev/urandom | base64 | tr -d '\n' | cut -c1-64)"
  fi
fi

SQLITE_DB_PATH_VALUE="${SQLITE_DB_PATH:-/opt/olimpiada/data/olimpiada.db}"

cd "$APP_DIR"

echo "[1/6] Install prerequisites"
chmod +x ops/oracle-free/install-prereqs.sh
./ops/oracle-free/install-prereqs.sh

echo "[2/6] Prepare .env"
cp -f .env.example .env
sed -i "s/^NODE_ENV=.*/NODE_ENV=production/" .env
sed -i "s/^PORT=.*/PORT=3000/" .env
sed -i "s/^SQLITE_DB_PATH=.*/SQLITE_DB_PATH=$(escape_sed "$SQLITE_DB_PATH_VALUE")/" .env
sed -i "s/^ADMIN_USER=.*/ADMIN_USER=$(escape_sed "$ADMIN_USER_VALUE")/" .env
sed -i "s/^ADMIN_PASS=.*/ADMIN_PASS=$(escape_sed "$ADMIN_PASS_VALUE")/" .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(escape_sed "$SESSION_SECRET_VALUE")/" .env

echo "[3/6] Deploy app"
chmod +x ops/oracle-free/deploy-app.sh
./ops/oracle-free/deploy-app.sh "$APP_DIR"

echo "[4/6] Enable firewall"
chmod +x ops/oracle-free/enable-firewall.sh
./ops/oracle-free/enable-firewall.sh

echo "[5/6] Setup Nginx + SSL"
chmod +x ops/oracle-free/setup-nginx-ssl.sh
./ops/oracle-free/setup-nginx-ssl.sh "$DOMAIN" "$LE_EMAIL"

echo "[6/6] Final checks"
curl -fsS "https://${DOMAIN}/api/health" >/dev/null
echo "Deployment successful: https://${DOMAIN}"
echo "Student registration: https://${DOMAIN}/"
echo "Student test page:    https://${DOMAIN}/test.html"
echo "Admin panel:          https://${DOMAIN}/login.html"

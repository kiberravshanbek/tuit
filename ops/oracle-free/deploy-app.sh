#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/olimpiada}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return 0
  fi
  sudo docker compose "$@"
}

if [[ ! -d "$APP_DIR" ]]; then
  echo "App directory not found: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -f ".env" ]]; then
  echo ".env file not found in $APP_DIR. Create it from .env.example first." >&2
  exit 1
fi

mkdir -p "$APP_DIR/data"

echo "[1/3] build and start containers"
compose up -d --build

echo "[2/3] check container status"
compose ps

echo "[3/3] health check"
for i in {1..20}; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Health OK: $HEALTH_URL"
    exit 0
  fi
  sleep 2
done

echo "Health check failed: $HEALTH_URL" >&2
compose logs --tail=120
exit 1

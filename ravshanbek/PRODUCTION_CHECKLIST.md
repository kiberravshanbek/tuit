# Production Security Checklist

## 1. Secrets and Environment

- [ ] Create `.env` from `.env.example`.
- [ ] Set `NODE_ENV=production`.
- [ ] Set strong `ADMIN_USER` and `ADMIN_PASS` (at least 12 chars, no default values).
- [ ] Set `SESSION_SECRET` with a random value of at least 32 chars.
- [ ] Set `SQLITE_DB_PATH` to a persistent disk location (for example `/app/data/olimpiada.db`).
- [ ] Verify `.env` is not committed to git (`.gitignore` contains `.env`).

## 2. Runtime and Dependencies

- [ ] Use Node.js LTS version compatible with the project.
- [ ] Run `npm install` and ensure install finishes without build errors.
- [ ] Run `npm audit --omit=dev` and confirm no high/critical vulnerabilities.
- [ ] Keep `package-lock.json` in sync with `package.json`.

## 3. Network and Transport

- [ ] Run behind HTTPS (reverse proxy or load balancer).
- [ ] Enable HTTP -> HTTPS redirect at proxy level.
- [ ] Restrict inbound ports (only required ports open).
- [ ] If reverse proxy is used, preserve client IP safely (trusted proxy setup).

## 4. Application Security Controls

- [ ] Confirm login brute-force protection works (`429` after repeated failures).
- [ ] Confirm CSRF same-origin check blocks cross-origin write requests (`403`).
- [ ] Confirm test submit requires valid `attemptToken` (`403` for invalid token).
- [ ] Confirm anti-cheat event logging works (`/api/test/event`) and tab-switch auto-finish threshold is set (`TAB_SWITCH_MAX_ALLOWED`).
- [ ] Confirm question subset size (`TEST_QUESTION_COUNT`) matches exam policy.
- [ ] Confirm kiosk heartbeat endpoint works (`/api/test/heartbeat`) and timeout (`KIOSK_HEARTBEAT_TIMEOUT_SEC`) is tuned.
- [ ] Confirm force-finish endpoint works (`/api/test/force-finish`) when kiosk app focus is lost.
- [ ] Confirm admin routes require authentication (`401` without session).
- [ ] Confirm file upload accepts only `.xlsx` and size is limited.

## 5. Data and Backups

- [ ] Set regular backups for `olimpiada.db`.
- [ ] If hosted in container/PaaS, verify persistent volume is mounted to DB directory.
- [ ] Test restore process from backup before go-live.
- [ ] Protect backup storage with access controls.

## 6. Observability and Operations

- [ ] Capture server logs centrally (with rotation).
- [ ] Monitor 4xx/5xx rates and failed login spikes.
- [ ] Add uptime and health monitoring.
- [ ] Document incident response contacts and rollback steps.

## 7. Final Go-Live Verification

- [ ] Start app with production env and verify startup succeeds.
- [ ] Verify registration, login, question CRUD, test flow, and exports.
- [ ] Verify `Cache-Control: no-store` on API/auth/admin responses.
- [ ] Remove any test accounts/questions created during validation.

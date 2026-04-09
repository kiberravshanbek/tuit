# Free Hosting Deployment Guide

This project is ready for global deployment. Recommended flow:

- Registration page: `/`
- Test page (share separately): `/test.html`
- Admin page: `/login.html`

## 1) Railway (fast launch)

Use this when you need a quick public URL.

1. Push this project to GitHub.
2. In Railway, create a new project and deploy from your GitHub repo.
3. Add environment variables:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `ADMIN_USER=...`
   - `ADMIN_PASS=...`
   - `SESSION_SECRET=...` (32+ chars)
   - `SQLITE_DB_PATH=/app/data/olimpiada.db`
   - Optional exam config:
     - `TEST_DURATION_MIN=30`
     - `TEST_QUESTION_COUNT=30`
     - `TAB_SWITCH_MAX_ALLOWED=2`
4. Attach a Railway Volume and set mount path to `/app/data`.
5. Generate a public domain in Railway Networking.
6. Verify:
   - `https://<your-domain>/api/health`
   - `https://<your-domain>/`
   - `https://<your-domain>/test.html`

Notes:

- Railway free usage is credit-based; monitor monthly usage in dashboard.
- Keep 1 replica for free-tier style usage.

## 2) Oracle Cloud Always Free VM (more control)

Use this when you need stronger stability with SQLite persistence.

Quick path (single command after repo upload):

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/quick-deploy.sh
./ops/oracle-free/quick-deploy.sh your-domain.com admin@your-domain.com admin_login 'StrongPass123!'
```

If you do not have a domain yet, auto-generate global domain from public IP:

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/quick-deploy-ip-domain.sh
./ops/oracle-free/quick-deploy-ip-domain.sh admin@your-email.com admin_login 'StrongPass123!'
```

1. Create an Ubuntu VM in OCI Always Free.
2. Copy this repo to `/opt/olimpiada`, then run setup scripts:

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/install-prereqs.sh
./ops/oracle-free/install-prereqs.sh
```

3. Copy project to VM and create `.env` from `.env.example`:

```bash
cp .env.example .env
```

4. Fill required secrets in `.env` (`ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET`) and set:

```bash
SQLITE_DB_PATH=/opt/olimpiada/data/olimpiada.db
```

5. Start service:

```bash
chmod +x ops/oracle-free/deploy-app.sh
./ops/oracle-free/deploy-app.sh /opt/olimpiada
```

6. Open host firewall ports:

```bash
chmod +x ops/oracle-free/enable-firewall.sh
./ops/oracle-free/enable-firewall.sh
```

7. Set domain DNS to VM public IP, then configure HTTPS:

```bash
chmod +x ops/oracle-free/setup-nginx-ssl.sh
./ops/oracle-free/setup-nginx-ssl.sh your-domain.com admin@your-domain.com
```

8. Detailed Oracle instructions:

- `ops/oracle-free/README.md`

## Student Flow (requested)

Current behavior in this codebase:

- Main page only handles registration.
- Main page no longer shows "Start Test" button.
- Students can access test only via separate link (`/test.html`) and enter their registered email.

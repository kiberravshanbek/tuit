# Oracle Always Free Deployment (Ubuntu)

This folder contains practical scripts to run this project on an Oracle Cloud Always Free Ubuntu VM.

Recommended app location on VM:

- `/opt/olimpiada`

## One-command quick deploy

If code is already in `/opt/olimpiada`, run:

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/quick-deploy.sh
./ops/oracle-free/quick-deploy.sh your-domain.com admin@your-domain.com admin_login 'StrongPass123!'
```

The script performs install, `.env` generation, app deploy, firewall, and HTTPS setup.

No custom domain yet? Use auto global domain from server public IP (`sslip.io`):

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/quick-deploy-ip-domain.sh
./ops/oracle-free/quick-deploy-ip-domain.sh admin@your-email.com admin_login 'StrongPass123!'
```

It will generate domain like:

- `https://129-146-10-20.sslip.io`

## 0) OCI side requirements

In Oracle Cloud, before SSH:

1. Create Ubuntu VM on Always Free eligible shape.
2. Attach a public IP.
3. Open inbound rules in VCN Security List or NSG:
   - TCP `22` (SSH)
   - TCP `80` (HTTP)
   - TCP `443` (HTTPS)

## 1) Install runtime packages on VM

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/install-prereqs.sh
./ops/oracle-free/install-prereqs.sh
```

This installs Docker, Compose plugin, Nginx, Certbot, UFW, and enables Docker.

## 2) Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

- `NODE_ENV=production`
- `ADMIN_USER=...`
- `ADMIN_PASS=...` (12+ chars)
- `SESSION_SECRET=...` (32+ chars)
- `SQLITE_DB_PATH=/opt/olimpiada/data/olimpiada.db`

## 3) Deploy app container

```bash
chmod +x ops/oracle-free/deploy-app.sh
./ops/oracle-free/deploy-app.sh /opt/olimpiada
```

The script builds and runs `docker compose`, then checks `http://127.0.0.1:3000/api/health`.

## 4) Enable host firewall

```bash
chmod +x ops/oracle-free/enable-firewall.sh
./ops/oracle-free/enable-firewall.sh
```

## 5) Domain + HTTPS

Point your DNS A record to VM public IP, then run:

```bash
chmod +x ops/oracle-free/setup-nginx-ssl.sh
./ops/oracle-free/setup-nginx-ssl.sh your-domain.com admin@your-domain.com
```

This:

- configures Nginx reverse proxy to `127.0.0.1:3000`
- issues Let's Encrypt certificate
- forces HTTPS redirect

## 6) Verify

- `https://your-domain.com/api/health`
- `https://your-domain.com/` (registration only)
- `https://your-domain.com/test.html` (share separately for students)
- `https://your-domain.com/login.html` (admin only)

## 7) Common operations

```bash
# Restart app
cd /opt/olimpiada && docker compose restart

# Rebuild and redeploy after updates
cd /opt/olimpiada && ./ops/oracle-free/deploy-app.sh /opt/olimpiada

# Logs
cd /opt/olimpiada && docker compose logs -f --tail=200
```

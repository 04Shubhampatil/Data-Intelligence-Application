# Production deployment — Hostinger Linux VPS

Target: one Ubuntu 22.04/24.04 VPS (2 vCPU / 4 GB RAM recommended; the sync worker runs a headless Chromium), Docker Compose, Nginx with Let's Encrypt, MySQL 8 in a container with a persistent volume, daily backups.

Services (see `docker-compose.yml`):

| Service | Image | Role |
|---|---|---|
| `nginx` | nginx:1.27 | HTTPS termination, reverse proxy, rate limits, security headers |
| `web` | built from `docker/web.Dockerfile` | Next.js app (standalone, non-root) |
| `worker` | built from `docker/worker.Dockerfile` | Sync worker (Playwright Chromium, non-root) |
| `migrate` | same image as worker | One-shot: `prisma migrate deploy` + seed roles/first admin |
| `mysql` | mysql:8.4 | Database, volume `mysql_data`, **not** published to the internet |
| `certbot` | certbot | Certificate renewal loop |
| `backup` | mysql:8.4 | Daily `mysqldump` to `./backups`, 14-day retention |

---

## 1. Prepare the VPS (once)

SSH in as root (or a sudo user), then:

```bash
apt-get update && apt-get upgrade -y
```

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
apt-get install -y git ufw fail2ban
```

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Create a non-root deploy user and let it run Docker:

```bash
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
```

Point your domain's **A record** (e.g. `hr.example.com`) at the VPS IP and wait until `dig +short hr.example.com` returns it.

## 2. Get the code and configure

As the `deploy` user:

```bash
git clone <your-repository-url> ~/data-intelligence && cd ~/data-intelligence
```

```bash
cp .env.production.example .env && chmod 600 .env
```

Edit `.env` and set every value. Generate secrets with:

```bash
openssl rand -base64 33
```

```bash
openssl rand -base64 32
```

Rules:
- `CREDENTIALS_ENCRYPTION_KEY` must be **the same** on the VPS and on the PC you use for `source:login` (it protects the MahaHRD session that you transfer in step 6).
- `SEED_ADMIN_PASSWORD` is used only on the first start; change it after the first login.
- Keep `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` different.

## 3. First start with HTTP only (to obtain the certificate)

```bash
NGINX_TEMPLATES=./docker/nginx/templates-http-only docker compose up -d --build
```

Check that migrations ran and the app is healthy:

```bash
docker compose logs migrate
```

```bash
curl -s http://localhost/api/health
```

Issue the certificate (replace the domain and email):

```bash
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d hr.example.com --email admin@example.com --agree-tos --no-eff-email
```

## 4. Switch to HTTPS

```bash
docker compose up -d --force-recreate nginx
```

(Without `NGINX_TEMPLATES` the full HTTPS template is used.) Verify:

```bash
curl -sI https://hr.example.com | head -n 5
```

Open `https://hr.example.com`, sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then change the password.

## 5. Create the source connection

```bash
docker compose exec worker npx tsx apps/worker/src/cli/setup-source.ts
```

Review the printed field policy. Contact fields stay off until the data owner approves them.

## 6. Sign in to MahaHRD and transfer the session

The VPS has no screen, so the manual sign-in happens on your PC:

```bash
npm run source:login
```

```bash
npm run source:session:export -- session.enc
```

```bash
scp session.enc deploy@<vps-ip>:~/data-intelligence/
```

On the VPS:

```bash
docker compose cp session.enc worker:/tmp/session.enc && docker compose exec worker npx tsx apps/worker/src/cli/session-transfer.ts import /tmp/session.enc
```

```bash
rm -f session.enc && docker compose exec worker rm -f /tmp/session.enc
```

The file is AES-256-GCM ciphertext (it can only be read with the same `CREDENTIALS_ENCRYPTION_KEY`), but delete both copies anyway. MahaHRD sessions last roughly 10 hours; a sync that finds the session expired pauses as **Needs sign-in** and can be resumed after you repeat this step.

## 7. Run a sync

From **Data Synchronization** in the web app (the `worker` container picks jobs up within seconds), or from the VPS:

```bash
docker compose exec worker npx tsx apps/worker/src/cli/sync.ts district BULDHANA
```

## 8. Operations

**Logs**

```bash
docker compose logs -f --tail=100 web worker
```

**Update to a new version**

```bash
git pull && docker compose up -d --build
```

Migrations run automatically (the `migrate` service) before `web` and `worker` start.

**Backups** land in `./backups/*.sql.gz` daily; copy them off the VPS (e.g. a cron `rsync`/`rclone` to object storage). Restore:

```bash
gunzip -c backups/ai_automation-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" ai_automation
```

**Health**: `GET /api/health` returns `{ ok: true, db: "up" }`; Docker restarts `web` if it fails three times. All services use `restart: unless-stopped`.

**Resource limits**: the worker needs ~1 GB RAM while Chromium runs (`shm_size: 1gb` is set). On a 4 GB VPS run one sync at a time (the app enforces one active job per source).

## 9. Security checklist

- [ ] Only ports 22, 80, 443 open (`ufw status`); MySQL is not published.
- [ ] `.env` is `chmod 600`, owned by `deploy`, and not in git.
- [ ] Seed admin password changed; extra users created with the least role needed (VIEWER / ADMIN).
- [ ] `CREDENTIALS_ENCRYPTION_KEY` backed up somewhere safe — without it saved sessions are unreadable (nothing else depends on it).
- [ ] Written authorization from the MahaHRD owner is on file; the field policy matches what was approved.
- [ ] AI provider key rotated if it was ever pasted into a chat or ticket.
- [ ] Backups copied off-box and a restore tested once.
- [ ] `apt-get upgrade` and `docker compose pull` on a schedule.

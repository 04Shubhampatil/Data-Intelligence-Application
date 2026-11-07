# brtechnobizz.tech — two apps behind one Node.js router

**Status:** live since 2026-11-07 04:36 UTC. Server: CloudPanel VPS 187.127.140.79, user `brtechnobizz` (no root).
Switch-over gap for MahaPanchayat: 1.3 s. Backups taken first: `~/backups/router-20261107-043017/`.

| pm2 process | Listens on | Serves |
|---|---|---|
| `router` | 127.0.0.1:3000 | everything nginx sends; routes by path |
| `mahapanchayat` | *:3002 | `brtechnobizz.tech/egram` (`~/htdocs/brtechnobizz.tech`, `npm start -- -p 3002`) |
| `resourcedata` | 127.0.0.1:3010 | `brtechnobizz.tech/resourcedata` (`~/resourcedata`, deploy with `scripts/deploy-resourcedata.ps1 -BasePath /resourcedata`) |

The old `egram` pm2 entry (port 3000) was removed after verification; the rollback below recreates it.

## Why

nginx sends every request for `brtechnobizz.tech` to `127.0.0.1:3000`. A `location ^~ /resourcedata` block saved in
CloudPanel's Vhost does not take effect (nginx reloaded, routing unchanged; the active config cannot be read without
root). A small router on port 3000 does the path routing instead, with no nginx, DNS or CloudPanel change.

## Target architecture

```
Browser ──HTTPS──> nginx (CloudPanel, unchanged) ──> 127.0.0.1:3000  router (pm2 "router")
                                                         ├─ /resourcedata, /resourcedata/*  ──> 127.0.0.1:3010  Data Intelligence (pm2 "resourcedata")
                                                         └─ everything else (/egram …)      ──> 127.0.0.1:3002  MahaPanchayat     (pm2 "mahapanchayat")
```

Paths are forwarded unchanged; the Host header and nginx's X-Forwarded-* headers are kept; WebSockets are proxied.
Code: `deploy/brtechnobizz-router/` (router.js, package.json, ecosystem.config.cjs, test-routing.js).

## Inspection (2026-11-07)

| Item | Found |
|---|---|
| MahaPanchayat | pm2 `egram` (id 0), cwd `~/htdocs/brtechnobizz.tech`, `npm start -- -p 3000`, Next 15, basePath `/egram` from its `.env`, DB `egramqrdb` reachable, no in-process schedulers |
| Data Intelligence | pm2 `resourcedata` (id 1), `~/resourcedata/app/apps/web/server.js`, 127.0.0.1:3010, settings `~/resourcedata/.env`, DB up |
| Ports | 3000 = egram (all interfaces), 3010 = Data Intelligence, **3002 free** |
| Reboot persistence | crontab `@reboot … pm2 resurrect` → `pm2 save` persists |
| Memory | ~2.3 GB available (a second MahaPanchayat instance needs ~100 MB) |

## Steps (each one checked before the next; MahaPanchayat stays up until step 5)

1. **Backups** → `~/backups/router-<timestamp>/`: `~/.pm2/dump.pm2`, `pm2 jlist`, crontab, both `.env` files (copies only).
2. **Data Intelligence under `/resourcedata`**: restore the path settings (`AUTH_URL=https://brtechnobizz.tech/resourcedata/api/auth`,
   `NEXT_PUBLIC_BASE_PATH=/resourcedata`) and redeploy with `scripts/deploy-resourcedata.ps1 -BasePath /resourcedata`
   (health-checked, rolls back by itself). Not public yet, so no visible effect.
3. **MahaPanchayat on 3002 (second instance)**: `pm2 start ~/router/ecosystem.config.cjs --only mahapanchayat`.
   Same folder, build, `.env` and database; the original `egram` on 3000 keeps serving. Check `/egram`, `/egram/`, `/egram/admin/login` on 3002.
4. **Router dry run on port 3005**: `npm ci` in `~/router`, start a temporary `router-test` (PORT=3005); check that `/egram…` reaches 3002 and
   `/resourcedata…` reaches 3010 (GET, POST, cookies, redirects); then remove `router-test`.
5. **Switch (≈1–2 s for MahaPanchayat)**: in one command `pm2 stop egram && pm2 start ~/router/ecosystem.config.cjs --only router`.
   If the router does not answer within seconds: `pm2 stop router && pm2 start egram` (automatic in the switch script).
6. **Verify publicly** (checklist below). On success: `pm2 delete egram` (removes only the stopped pm2 entry — no code, files,
   `.env` or data are touched; it would otherwise fight the router for port 3000 after a reboot), then `pm2 save`.

## Test checklist

`/egram`, `/egram/`, `/resourcedata`, `/resourcedata/`; sign-in/sign-out on both; dashboard navigation; nested-route refresh; API calls;
images; document view and download; uploads; cookies/session; database reads/writes; browser console; `pm2 restart router` and
`pm2 restart mahapanchayat` recovery.

## Rollback (exact commands, as `brtechnobizz`)

```bash
source ~/.nvm/nvm.sh
pm2 stop router
pm2 start egram 2>/dev/null || pm2 start npm --name egram --cwd /home/brtechnobizz/htdocs/brtechnobizz.tech -- start -- -p 3000
pm2 delete router mahapanchayat
pm2 save
```

MahaPanchayat is then exactly as before (port 3000, all interfaces). Data Intelligence keeps running on 3010 and is simply not public.

# Data Intelligence — handover

Live site: **https://brtechnobizz.tech/resourcedata** (MahaPanchayat stays at https://brtechnobizz.tech/egram).

## For the client — everything is done in the website

Sign in with your **username** (not an email). The first account is `superadmin`.

| Task | Where |
|---|---|
| Change your own password | Your name (top right) → **Change password** |
| Create users (District Admins, District Viewers, Viewers, Admins) | **Settings → Users** — give each a username and a temporary password; they change it themselves |
| Reset someone's password | **Settings → Users** → the user's row |
| Connect to MahaHRD (once) | **Settings → Source connection** → MahaHRD username + password → **Save and test** |
| Check the MahaHRD connection | **Settings → Source connection** → **Test connection** |
| Fetch new data from MahaHRD | **Data Synchronization → Start a sync** (one district first, then all) |
| Automatic nightly/weekly syncs | **Data Synchronization → Schedules** |
| Continue a paused sync | **Data Synchronization** → the job → **Resume** |
| Choose which documents are collected | **Settings → Source connection → Documents collected from the source** |

**MahaHRD sign-in.** The sync signs in to MahaHRD by itself with the account saved in Settings (password stored
encrypted, never shown again). It signs in again when a session expires, also in the middle of a sync. If MahaHRD
refuses the password (for example after it was changed on MahaHRD), the sync pauses and **Settings → Source connection**
shows MahaHRD's own message — save the new password there and press **Resume** on the paused job.
Use a MahaHRD account the data owner has authorised for this purpose.

Nobody needs a terminal for daily use.

## For the technical maintainer

Server: CloudPanel VPS 187.127.140.79, user `brtechnobizz`, SSH key `hostinger_deploy_ed25519`. No root is needed for anything below.

| pm2 process | Port | What |
|---|---|---|
| `router` | 127.0.0.1:3000 | nginx sends the whole domain here; `/resourcedata…` → 3010, everything else → MahaPanchayat (see `docs/BRTECHNOBIZZ-ROUTER.md`) |
| `mahapanchayat` | 3002 | MahaPanchayat (`~/htdocs/brtechnobizz.tech`) |
| `resourcedata` | 127.0.0.1:3010 | this website (`~/resourcedata/app`) |
| `resourcedata-worker` | — | MahaHRD sync worker (`~/resourcedata/worker`): syncs, schedules, automatic sign-in, retention clean-up |

Files on the server (all private to the `brtechnobizz` user):
- `~/resourcedata/.env` — settings for the website and the worker (database, `CREDENTIALS_ENCRYPTION_KEY`, document folder). **Back up the encryption key**: without it saved passwords, profile details and identity documents cannot be read.
- `~/resourcedata/data/files` — employee photos and documents (19 GB in Nov 2026).
- `~/resourcedata/pw-browsers`, `~/resourcedata/chromium-libs` — headless Chromium and the 11 Ubuntu libraries it needs, unpacked without root.
- `~/backups/` — copies taken before each server change.

Deploying a new version (from a PC with this repository):

```bash
powershell -ExecutionPolicy Bypass -File scripts\deploy-resourcedata.ps1 -BasePath /resourcedata
```

```bash
powershell -ExecutionPolicy Bypass -File scripts\deploy-worker-resourcedata.ps1
```

The website script builds, uploads, restarts and rolls back by itself if the health check fails. The worker script
reinstalls and restarts the worker; a running sync pauses at its checkpoint and resumes.

Database changes: new Prisma migrations must be applied to the live database before deploying the website. The live
MySQL is case-sensitive about table names — write migrations with the schema's names (`User`, `Candidate`, …).

Useful commands on the server (`source ~/.nvm/nvm.sh` first): `pm2 ls`, `pm2 logs resourcedata-worker`, `pm2 restart resourcedata-worker`.

#!/usr/bin/env sh
# One-shot: apply pending migrations, then seed roles + first admin (idempotent).
set -eu
cd /repo
echo "[migrate] applying migrations…"
npx prisma migrate deploy --config packages/db/prisma.config.ts
if [ -n "${SEED_ADMIN_EMAIL:-}" ] && [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  echo "[migrate] seeding roles and admin…"
  npx tsx packages/db/prisma/seed.ts
else
  echo "[migrate] SEED_ADMIN_* not set — skipping seed."
fi
echo "[migrate] done."

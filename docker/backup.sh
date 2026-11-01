#!/usr/bin/env sh
# Daily MySQL dump with 14-day retention. Runs inside the `backup` service (mysql image).
set -eu
: "${MYSQL_HOST:=mysql}" "${MYSQL_DATABASE:?}" "${MYSQL_USER:?}" "${MYSQL_PASSWORD:?}" "${BACKUP_KEEP_DAYS:=14}"
mkdir -p /backups
while true; do
  stamp=$(date +%Y%m%d-%H%M%S)
  file="/backups/${MYSQL_DATABASE}-${stamp}.sql.gz"
  if mysqldump -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE" | gzip > "$file"; then
    echo "[backup] wrote $file ($(du -h "$file" | cut -f1))"
  else
    echo "[backup] FAILED at $stamp" >&2; rm -f "$file"
  fi
  find /backups -name "*.sql.gz" -mtime +"$BACKUP_KEEP_DAYS" -delete
  sleep 86400
done

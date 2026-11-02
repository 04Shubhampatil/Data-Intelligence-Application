#!/usr/bin/env sh
# Backups, run inside the `backup` service (mysql image):
#  - daily MySQL dump, kept BACKUP_KEEP_DAYS days (default 14);
#  - weekly archive of the private documents volume (candidate photos/documents),
#    kept BACKUP_FILES_KEEP archives (default 4). Files are content-addressed and
#    never edited in place, so a weekly full archive is enough.
set -eu
: "${MYSQL_HOST:=mysql}" "${MYSQL_DATABASE:?}" "${MYSQL_USER:?}" "${MYSQL_PASSWORD:?}" "${BACKUP_KEEP_DAYS:=14}" "${BACKUP_FILES_KEEP:=4}" "${FILES_DIR:=/files}"
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

  # Documents: one archive per week (when no archive is younger than 6 days).
  if [ -d "$FILES_DIR" ] && [ -z "$(find /backups -maxdepth 1 -name 'files-*.tar.gz' -mtime -6 2>/dev/null)" ]; then
    archive="/backups/files-${stamp}.tar.gz"
    if tar -czf "$archive" -C "$FILES_DIR" .; then
      echo "[backup] wrote $archive ($(du -h "$archive" | cut -f1))"
    else
      echo "[backup] documents archive FAILED at $stamp" >&2; rm -f "$archive"
    fi
    # Keep only the newest BACKUP_FILES_KEEP archives.
    ls -1t /backups/files-*.tar.gz 2>/dev/null | tail -n +"$((BACKUP_FILES_KEEP + 1))" | xargs -r rm -f
  fi
  sleep 86400
done

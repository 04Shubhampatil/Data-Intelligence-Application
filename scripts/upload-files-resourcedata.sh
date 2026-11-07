#!/usr/bin/env bash
# Uploads the private document store (data/files/candidates/<id>/…) to the production server in batches.
# Resumable: every finished batch is recorded on the server in ~/resourcedata/data/.uploaded, and a rerun
# skips those candidates. Run from the repo root in Git Bash:
#   bash scripts/upload-files-resourcedata.sh
set -euo pipefail
KEY="$HOME/.ssh/hostinger_deploy_ed25519"
HOST="brtechnobizz@187.127.140.79"
SRC="data/files/candidates"
BATCH=150
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ServerAliveInterval=30 "$HOST")

[ -d "$SRC" ] || { echo "No $SRC folder — run from the repo root."; exit 1; }
"${SSH[@]}" 'mkdir -p ~/resourcedata/data/files/candidates && chmod 700 ~/resourcedata/data ~/resourcedata/data/files && touch ~/resourcedata/data/.uploaded'
DONE=$(mktemp); TODO=$(mktemp)
"${SSH[@]}" 'cat ~/resourcedata/data/.uploaded' | tr -d '\r' | sort -u > "$DONE"
ls "$SRC" | tr -d '\r' | sort > "$TODO.all"
comm -23 "$TODO.all" "$DONE" > "$TODO"
TOTAL=$(wc -l < "$TODO.all"); LEFT=$(wc -l < "$TODO")
echo "$(date '+%H:%M:%S') candidates with files: $TOTAL · already uploaded: $((TOTAL - LEFT)) · to upload: $LEFT"

n=0
while [ -s "$TODO" ]; do
  head -n $BATCH "$TODO" > "$TODO.batch"
  # Stream the batch as one tar (files are images/PDFs, so no compression). A failed transfer stops the
  # script before the batch is recorded, so a rerun sends that batch again.
  set +e
  tar -cf - -C "$SRC" -T "$TODO.batch" | "${SSH[@]}" 'tar -xf - -C ~/resourcedata/data/files/candidates'
  status=("${PIPESTATUS[@]}")
  set -e
  if [ "${status[0]}" != "0" ] || [ "${status[1]}" != "0" ]; then
    echo "$(date '+%H:%M:%S') batch failed (tar ${status[0]}, upload ${status[1]}). Run the script again to resume."
    exit 1
  fi
  "${SSH[@]}" "cat >> ~/resourcedata/data/.uploaded" < "$TODO.batch"
  n=$((n + $(wc -l < "$TODO.batch")))
  tail -n +$((BATCH + 1)) "$TODO" > "$TODO.next"; mv "$TODO.next" "$TODO"
  echo "$(date '+%H:%M:%S') uploaded $n / $LEFT"
done
rm -f "$DONE" "$TODO" "$TODO.all" "$TODO.batch"
echo "$(date '+%H:%M:%S') done. Server size: $("${SSH[@]}" 'du -sh ~/resourcedata/data/files | cut -f1')"

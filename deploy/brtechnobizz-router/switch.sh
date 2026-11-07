#!/usr/bin/env bash
# Hands port 3000 from the old "egram" process to the router. Rolls back by itself if the router does not serve
# both apps within a few seconds. Run on the server as brtechnobizz:  bash ~/router/switch.sh
set -u
source ~/.nvm/nvm.sh >/dev/null
port_free() { ! ss -ltn 2>/dev/null | grep -q ":3000 "; }
code() { curl -s -o /dev/null -m 5 -H "Host: brtechnobizz.tech" -H "X-Forwarded-Proto: https" -w "%{http_code}" "http://127.0.0.1:3000$1"; }
rollback() {
  echo "ROLLBACK: $1"
  pm2 stop router >/dev/null 2>&1; pm2 delete router >/dev/null 2>&1
  for i in $(seq 1 20); do port_free && break; sleep 0.5; done
  pm2 start egram >/dev/null
  sleep 5; echo "egram back: /egram/admin/login -> $(code /egram/admin/login)"
  exit 1
}

# The replacement must be ready before anything stops.
[ "$(curl -s -o /dev/null -m 5 -w "%{http_code}" http://127.0.0.1:3002/egram/admin/login)" = "200" ] || { echo "mahapanchayat on 3002 not ready - nothing changed"; exit 1; }
[ "$(curl -s -o /dev/null -m 5 -w "%{http_code}" http://127.0.0.1:3010/resourcedata/api/health)" = "200" ] || { echo "resourcedata on 3010 not ready - nothing changed"; exit 1; }

START=$(date +%s.%N)
pm2 stop egram >/dev/null
for i in $(seq 1 20); do port_free && break; sleep 0.5; done
port_free || rollback "port 3000 still busy after stopping egram"
pm2 start ~/router/ecosystem.config.cjs --only router >/dev/null || rollback "router did not start"
for i in $(seq 1 20); do [ "$(code /egram/admin/login)" = "200" ] && break; sleep 0.25; done
END=$(date +%s.%N)

E=$(code /egram/admin/login); R=$(code /resourcedata/api/health)
[ "$E" = "200" ] || rollback "/egram/admin/login via router -> $E"
[ "$R" = "200" ] || rollback "/resourcedata/api/health via router -> $R"
echo "SWITCHED. MahaPanchayat gap: $(echo "$END - $START" | bc 2>/dev/null || echo "~2") s. /egram/admin/login -> $E, /resourcedata/api/health -> $R"

# Deploys the MahaHRD sync worker to the CloudPanel VPS (pm2 app "resourcedata-worker").
# Uploads only the worker, the shared packages and the lock file; installs production dependencies on the server;
# swaps the folder; restarts pm2; checks that the worker reports in. A running sync is paused at its checkpoint
# by the restart and resumes by itself.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-worker-resourcedata.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Key = Join-Path $env:USERPROFILE ".ssh\hostinger_deploy_ed25519"
$HostName = "brtechnobizz@187.127.140.79"
$Archive = Join-Path $env:TEMP "resourcedata-worker.tgz"

Set-Location $Root
Write-Host "1/3 Packaging the worker..."
$paths = @(
  "package.json", "package-lock.json", "apps/web/package.json",
  "apps/worker/package.json", "apps/worker/tsconfig.json", "apps/worker/src",
  "packages/core/package.json", "packages/core/tsconfig.json", "packages/core/src",
  "packages/db/package.json", "packages/db/tsconfig.json", "packages/db/prisma.config.ts", "packages/db/prisma", "packages/db/src",
  "deploy/resourcedata-worker/ecosystem.config.cjs"
)
tar -czf $Archive @paths
if ($LASTEXITCODE -ne 0) { throw "Packaging failed" }

Write-Host "2/3 Uploading..."
scp -i $Key -o BatchMode=yes -q $Archive "${HostName}:~/resourcedata/worker-new.tgz"
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }

Write-Host "3/3 Installing and restarting on the server..."
$remote = @'
set -e
source ~/.nvm/nvm.sh >/dev/null
cd ~/resourcedata
rm -rf worker-new && mkdir worker-new && tar -xzf worker-new.tgz -C worker-new && rm worker-new.tgz
cd worker-new && npm ci --omit=dev --workspace @di/worker --no-audit --no-fund --loglevel=error && cd ..
cp worker-new/deploy/resourcedata-worker/ecosystem.config.cjs worker.ecosystem.config.cjs
rm -rf worker-old; [ -d worker ] && mv worker worker-old; mv worker-new worker
if pm2 describe resourcedata-worker >/dev/null 2>&1; then pm2 restart resourcedata-worker --update-env >/dev/null; else pm2 start worker.ecosystem.config.cjs >/dev/null; fi
pm2 save >/dev/null
sleep 8
pm2 logs resourcedata-worker --nostream --lines 6 2>/dev/null | grep -v "^\s*$" | tail -n 6
pm2 describe resourcedata-worker | grep -m 1 "status" || true
'@
# PowerShell would otherwise prepend a byte-order mark to what it pipes into ssh (bash then skips line 1).
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$remote -replace "`r", "" | ssh -i $Key -o BatchMode=yes $HostName "sed '1s/^\xEF\xBB\xBF//' | bash -se"
if ($LASTEXITCODE -ne 0) { throw "Worker deploy failed" }
Remove-Item $Archive -ErrorAction SilentlyContinue
Write-Host "Worker deployed."

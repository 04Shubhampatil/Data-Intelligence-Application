# Deploys the web app to https://resourcedata.brtechnobizz.tech (CloudPanel VPS, pm2 app "resourcedata", port 3010).
# Builds here (the server has 1 CPU), uploads one archive, swaps the app folder, restarts pm2, checks health.
# The server's settings live in ~/resourcedata/.env and are never touched by this script.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-resourcedata.ps1
# Served under a path instead (e.g. example.com/resourcedata)? Pass -BasePath /resourcedata and set the same
# NEXT_PUBLIC_BASE_PATH and AUTH_URL path in the server's .env.
param([string]$BasePath = "")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Key = Join-Path $env:USERPROFILE ".ssh\hostinger_deploy_ed25519"
$HostName = "brtechnobizz@187.127.140.79"
$Archive = Join-Path $env:TEMP "resourcedata-app.tgz"

Set-Location $Root
Write-Host "1/4 Building$(if ($BasePath) { " with base path $BasePath" } else { ' (no base path)' })..."
$env:NEXT_PUBLIC_BASE_PATH = $BasePath; $env:NODE_ENV = "production"; $env:NEXT_TELEMETRY_DISABLED = "1"
npm run build -w web
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Remove-Item Env:NEXT_PUBLIC_BASE_PATH, Env:NODE_ENV -ErrorAction SilentlyContinue

Write-Host "2/4 Packaging..."
$Standalone = Join-Path $Root "apps\web\.next\standalone"
$StaticDest = Join-Path $Standalone "apps\web\.next\static"
if (Test-Path $StaticDest) { Remove-Item -Recurse -Force $StaticDest }
Copy-Item -Recurse (Join-Path $Root "apps\web\.next\static") $StaticDest
$Sharp = Join-Path $Standalone "node_modules\@img\sharp-win32-x64"   # Windows-only binary; the app does not optimise images
if (Test-Path $Sharp) { Remove-Item -Recurse -Force $Sharp }
tar -czf $Archive -C $Standalone .
if ($LASTEXITCODE -ne 0) { throw "Packaging failed" }

Write-Host "3/4 Uploading..."
scp -i $Key -o BatchMode=yes -q $Archive "${HostName}:~/resourcedata/app-new.tgz"
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }

Write-Host "4/4 Swapping and restarting..."
$remote = @'
set -e
source ~/.nvm/nvm.sh >/dev/null
cd ~/resourcedata
rm -rf app-new && mkdir app-new && tar -xzf app-new.tgz -C app-new && rm app-new.tgz
rm -rf app-old && mv app app-old && mv app-new app
pm2 restart resourcedata --update-env >/dev/null && pm2 save >/dev/null
sleep 6
code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 http://127.0.0.1:3010__BASE__/api/health)
if [ "$code" != "200" ]; then
  echo "Health check failed ($code); rolling back"
  rm -rf app && mv app-old app && pm2 restart resourcedata >/dev/null
  exit 1
fi
echo "Deployed. Health: $code. Previous version kept in ~/resourcedata/app-old"
'@
# PowerShell would otherwise prepend a byte-order mark to what it pipes into ssh (bash then skips line 1).
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
($remote -replace "`r", "") -replace "__BASE__", $BasePath | ssh -i $Key -o BatchMode=yes $HostName "bash -s"
if ($LASTEXITCODE -ne 0) { throw "Deploy failed (rolled back)" }
Remove-Item $Archive -ErrorAction SilentlyContinue

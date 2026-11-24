# Sets a new password for the Super Admin (or another user) when it has been forgotten.
#
#   powershell -ExecutionPolicy Bypass -File scripts\reset-superadmin-password.ps1             # live site
#   powershell -ExecutionPolicy Bypass -File scripts\reset-superadmin-password.ps1 -Local      # local database
#   powershell -ExecutionPolicy Bypass -File scripts\reset-superadmin-password.ps1 -Username jdoe
#
# You type the new password twice (hidden). It goes to the server through the encrypted SSH connection,
# is never shown, never saved in a file, and never put on a command line. Same rules as the Change
# password page: at least 12 characters, with a lowercase letter, an uppercase letter and a number.
# Also clears a sign-in lockout and re-enables the account. Needs the deploy SSH key on this computer.
param(
  [string]$Username = "superadmin",
  [switch]$Local
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Key = "$HOME\.ssh\hostinger_deploy_ed25519"
$HostName = "brtechnobizz@187.127.140.79"
$Target = if ($Local) { "the LOCAL database" } else { "the LIVE site (brtechnobizz.tech/resourcedata)" }

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-PolicyProblem([string]$Pw) {
  if ($Pw.Length -lt 12) { return "Use at least 12 characters" }
  if ($Pw.Length -gt 200) { return "Use at most 200 characters" }
  if ($Pw -cnotmatch "[a-z]") { return "Include a lowercase letter" }
  if ($Pw -cnotmatch "[A-Z]") { return "Include an uppercase letter" }
  if ($Pw -notmatch "\d") { return "Include a number" }
  return $null
}

Write-Host ""
Write-Host "Reset the password for user '$Username' on $Target." -ForegroundColor Cyan
Write-Host "Rules: at least 12 characters, with a lowercase letter, an uppercase letter and a number."
Write-Host ""

$password = $null
while (-not $password) {
  $first = Read-Secret "New password"
  $problem = Get-PolicyProblem $first
  if ($problem) { Write-Host "  $problem. Try again." -ForegroundColor Yellow; continue }
  $second = Read-Secret "Type it again"
  if ($first -cne $second) { Write-Host "  The two passwords don't match. Try again." -ForegroundColor Yellow; continue }
  $password = $first
}
$first = $null; $second = $null

# No byte-order mark in front of the password when it is piped to ssh / node.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

try {
  if ($Local) {
    $password | node "$Root\scripts\reset-password.cjs" "$Root\.env" "$Root" $Username
  } else {
    Write-Host "Connecting to the server..."
    scp -q -i $Key -o BatchMode=yes "$Root\scripts\reset-password.cjs" "${HostName}:resourcedata/reset-password.cjs"
    if ($LASTEXITCODE -ne 0) { throw "Could not reach the server (is the deploy SSH key at $Key?)." }
    $remote = 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh >/dev/null 2>&1; ' +
      "node ~/resourcedata/reset-password.cjs ~/resourcedata/.env ~/resourcedata/worker '$($Username -replace "[^A-Za-z0-9._-]", '')'"
    $password | ssh -i $Key -o BatchMode=yes $HostName $remote
  }
  $code = $LASTEXITCODE
} finally {
  $password = $null
  [GC]::Collect()
}

if ($code -eq 0) {
  Write-Host ""
  Write-Host "Done. Sign in as '$Username' with the new password." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "The password was NOT changed (see the message above)." -ForegroundColor Red
  exit $code
}

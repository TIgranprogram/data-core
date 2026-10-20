# Personal Data Core — one-command deploy (Windows)
# Usage (from repo root OR from this folder):
#   .\deploy\synology\deploy.ps1
#   .\deploy\synology\deploy.ps1 -Wipe
#   .\deploy\synology\deploy.ps1 -SkipBuild
#   .\deploy\synology\deploy.ps1 -SkipPreflight

param(
    [switch]$Wipe,
    [switch]$SkipBuild,
    [switch]$SkipPreflight
)

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $Here "..\..")).Path
Set-Location $Root

Write-Host ""
Write-Host "=== Data Core deploy.ps1 ===" -ForegroundColor Cyan
Write-Host "  Root: $Root"
Write-Host ""

$config = Join-Path $Here "config.env"
if (-not (Test-Path $config)) {
    Write-Host "[FAIL] Missing deploy/synology/config.env" -ForegroundColor Red
    Write-Host "  copy deploy\synology\config.env.example deploy\synology\config.env" -ForegroundColor Yellow
    Write-Host "  Fill secrets, then re-run. See deploy/synology/README.md" -ForegroundColor Yellow
    exit 1
}

# Ensure paramiko
python -c "import paramiko" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing paramiko..." -ForegroundColor Yellow
    pip install -r (Join-Path $Here "requirements.txt")
}

if (-not $SkipPreflight) {
    $pre = Join-Path $Here "preflight.ps1"
    if (Test-Path $pre) {
        Write-Host "Running preflight..." -ForegroundColor Cyan
        & $pre
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] Preflight failed. Fix issues or use -SkipPreflight" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    }
}

$argsList = @()
if ($Wipe) {
    Write-Host ""
    Write-Host "WARNING: -Wipe will DELETE /opt/data-core + mongo data on the VM." -ForegroundColor Red
    Write-Host "Only use while the system is NOT in real production use." -ForegroundColor Red
    $argsList += "--wipe"
}
if ($SkipBuild) { $argsList += "--skip-build" }

Write-Host "python deploy/synology/deploy.py $($argsList -join ' ')" -ForegroundColor Cyan
python (Join-Path $Here "deploy.py") @argsList
exit $LASTEXITCODE

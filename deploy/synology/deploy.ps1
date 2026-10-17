# KPPDF 8.0 — one-command deploy (Windows)
# Usage (from repo root OR from this folder):
#   .\deploy\synology\deploy.ps1
#   .\deploy\synology\deploy.ps1 -Seed
#   .\deploy\synology\deploy.ps1 -Wipe -Seed
#   .\deploy\synology\deploy.ps1 -SkipBuild

param(
    [switch]$Seed,
    [switch]$Wipe,
    [switch]$SkipBuild,
    [switch]$SkipPreflight
)

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $Here "..\..")).Path
Set-Location $Root

Write-Host ""
Write-Host "=== KPPDF 8.0 deploy.ps1 ===" -ForegroundColor Cyan
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

# Deploy gate: TZ-OPS-310 always required (even with -SkipPreflight)
$ops310 = Join-Path $Root "tasks\_archive\2026-08\TZ-OPS-310.done.md"
if (-not (Test-Path $ops310)) {
    Write-Host "[FAIL] TZ-OPS-310 server harden not archived." -ForegroundColor Red
    Write-Host "  Do first (VPN OFF): tasks/_backlog/ops/PROMPT-OPS-310-HARDEN.md" -ForegroundColor Yellow
    Write-Host "  Spec: tasks/_backlog/ops/TZ-OPS-310-server-harden-before-deploy.md" -ForegroundColor Yellow
    exit 1
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
if ($Seed) { $argsList += "--seed" }
if ($Wipe) {
    Write-Host ""
    Write-Host "WARNING: -Wipe will DELETE /opt/kppdf-8.0 + mongo data on the VM." -ForegroundColor Red
    Write-Host "Only use while the system is NOT in real production use." -ForegroundColor Red
    $argsList += "--wipe"
}
if ($SkipBuild) { $argsList += "--skip-build" }

Write-Host "python deploy/synology/deploy.py $($argsList -join ' ')" -ForegroundColor Cyan
python (Join-Path $Here "deploy.py") @argsList
exit $LASTEXITCODE

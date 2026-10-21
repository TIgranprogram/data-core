# pull-backup.ps1 - copy the latest data-core backup from the VM to this Windows PC (off-NAS copy).
#
# What it does (idempotent, safe to run any time):
#   1. Finds the newest /var/lib/datacore/backups/mongo-<ts> on the VM (made by cron 03:00, backup.sh).
#   2. Packs mongo-<ts> (+ uploads-<ts> if present) into /tmp on the VM, downloads it via scp
#      to $Dest\datacore-<ts>.tgz, verifies the archive, removes the temp file on the VM.
#   3. Deletes local archives older than $KeepDays days.
# Skips the download if datacore-<ts>.tgz already exists locally.
#
# SSH host/user/key are read from deploy/synology/config.env (gitignored) - nothing secret is stored here.
# Scheduled daily by register-task.ps1. Log: $Dest\pull.log
# Restore: see deploy/backup-pull/README.md

param(
    [string]$Dest = "D:\datacore-backups",
    [int]$KeepDays = 30
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigFile = Join-Path $RepoRoot "deploy\synology\config.env"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Log = Join-Path $Dest "pull.log"

function Log([string]$msg) {
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $msg
    Add-Content -Path $Log -Value $line -Encoding UTF8
    Write-Host $line
}

function Get-Cfg([string]$key) {
    $line = Get-Content $ConfigFile | Where-Object { $_ -match ("^" + $key + "=") } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -replace ("^" + $key + "="), "").Trim().Trim('"').Trim("'")
}

try {
    if (-not (Test-Path $ConfigFile)) { throw "config.env not found: $ConfigFile" }
    $VmHost = Get-Cfg "DEPLOY_HOST"
    $VmUser = Get-Cfg "DEPLOY_USER"
    $Key = Get-Cfg "DEPLOY_SSH_KEY"
    if ($Key -like "~*") { $Key = $Key -replace "^~", $env:USERPROFILE }
    if (-not $VmHost -or -not $VmUser) { throw "DEPLOY_HOST / DEPLOY_USER missing in config.env" }

    $SshOpts = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "StrictHostKeyChecking=accept-new")
    if ($Key) { $SshOpts += @("-i", $Key) }
    $Target = "$VmUser@$VmHost"

    $latest = (& ssh.exe @SshOpts $Target "ls -1d /var/lib/datacore/backups/mongo-* 2>/dev/null | tail -1").Trim()
    if ($LASTEXITCODE -ne 0 -or -not $latest) { throw "cannot list backups on VM (ssh exit $LASTEXITCODE)" }
    $ts = ($latest -split "/")[-1] -replace "^mongo-", ""
    $file = Join-Path $Dest ("datacore-" + $ts + ".tgz")

    if (Test-Path $file) {
        Log "up to date: datacore-$ts.tgz already present"
    } else {
        $remoteTmp = "/tmp/datacore-pull-$ts.tgz"
        # No double quotes inside: Windows PowerShell 5.1 mangles them when passing args to ssh.exe.
        $pack = "cd /var/lib/datacore/backups && tar -czf $remoteTmp mongo-$ts `$(test -d uploads-$ts && echo uploads-$ts) && echo PACKED"
        $out = (& ssh.exe @SshOpts $Target $pack) -join ""
        if ($out -notmatch "PACKED") { throw "pack failed on VM: $out" }
        $tmp = $file + ".part"
        & scp.exe -q @SshOpts ("${Target}:" + $remoteTmp) $tmp
        $scpExit = $LASTEXITCODE
        & ssh.exe @SshOpts $Target "rm -f $remoteTmp" | Out-Null
        if ($scpExit -ne 0 -or -not (Test-Path $tmp)) { throw "scp failed (exit $scpExit)" }
        & tar.exe -tzf $tmp | Out-Null
        if ($LASTEXITCODE -ne 0) { Remove-Item $tmp -Force; throw "downloaded archive is corrupt" }
        Move-Item $tmp $file -Force
        $kb = [math]::Round((Get-Item $file).Length / 1KB)
        Log "downloaded datacore-$ts.tgz ($kb KB)"
    }

    $old = Get-ChildItem $Dest -Filter "datacore-*.tgz" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) }
    foreach ($f in $old) { Remove-Item $f.FullName -Force; Log ("rotated out " + $f.Name) }
    exit 0
} catch {
    Log ("ERROR: " + $_.Exception.Message)
    exit 1
}

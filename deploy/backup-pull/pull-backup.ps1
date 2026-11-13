# pull-backup.ps1 - copy the latest data-core backup from the VM to this Windows PC (off-NAS copy).
#
# What it does (idempotent, safe to run any time):
#   1. Finds the newest /var/lib/datacore/backups/mongo-<ts> on the VM (made by cron 03:00, backup.sh).
#   2. Packs mongo-<ts> (+ uploads-<ts> if present) into /tmp on the VM, downloads it via scp
#      to $Dest\datacore-<ts>.tgz, verifies the archive, removes the temp file on the VM.
#   3. Keeps only the newest verified archive: all other datacore-*.tgz are deleted (owner rule 2026-11-13:
#      no pile of old versions on the PCs). Old ones are removed only after the new one is present and verified.
# Skips the download if datacore-<ts>.tgz already exists locally.
#
# SSH host/user/key are read from deploy/synology/config.env (gitignored) - nothing secret is stored here.
# Scheduled daily by register-task.ps1. Log: $Dest\pull.log
# Restore: see deploy/backup-pull/README.md

param(
    [string]$Dest = "D:\datacore-backups",
    [int]$KeepDays = 0   # not used since 2026-11-13 (only the newest archive is kept); left for old task arguments
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
    # VM and KEY in the environment: login from the work PC through the VPS (the same names as release.sh).
    if ($env:VM) {
        $Target = $env:VM
        $Key = $env:KEY
    } else {
        if (-not (Test-Path $ConfigFile)) { throw "config.env not found: $ConfigFile" }
        $VmHost = Get-Cfg "DEPLOY_HOST"
        $VmUser = Get-Cfg "DEPLOY_USER"
        $Key = Get-Cfg "DEPLOY_SSH_KEY"
        if ($Key -like "~*") { $Key = $Key -replace "^~", $env:USERPROFILE }
        if (-not $VmHost -or -not $VmUser) { throw "DEPLOY_HOST / DEPLOY_USER missing in config.env" }
        $Target = "$VmUser@$VmHost"
    }

    $SshOpts = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "StrictHostKeyChecking=accept-new")
    if ($Key) { $SshOpts += @("-i", $Key) }

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
        # A2 (C042): 6.11.2026 бэкап скачался обрезанным (Unexpected EOF) — теперь размер сверяется с файлом
        # на VM, проверка архива, и до 3 попыток скачивания вместо одной. Битый .part не остаётся.
        $remoteSizeText = (& ssh.exe @SshOpts $Target "stat -c %s $remoteTmp 2>/dev/null").Trim()
        $remoteSize = 0
        if ($remoteSizeText -match '^\d+$') { $remoteSize = [long]$remoteSizeText }
        $tmp = $file + ".part"
        $ok = $false
        for ($try = 1; $try -le 3; $try++) {
            if (Test-Path $tmp) { Remove-Item $tmp -Force }
            & scp.exe -q @SshOpts ("${Target}:" + $remoteTmp) $tmp
            $scpExit = $LASTEXITCODE
            if ($scpExit -ne 0 -or -not (Test-Path $tmp)) { Log ("download attempt " + $try + ": scp failed (exit " + $scpExit + ")"); Start-Sleep -Seconds 5; continue }
            $got = (Get-Item $tmp).Length
            if ($remoteSize -gt 0 -and $got -ne $remoteSize) { Log ("download attempt " + $try + ": short file, got " + $got + " of " + $remoteSize + " bytes"); Start-Sleep -Seconds 5; continue }
            & (Join-Path $env:SystemRoot "System32\tar.exe") -tzf $tmp | Out-Null
            if ($LASTEXITCODE -ne 0) { Log ("download attempt " + $try + ": archive is corrupt"); Start-Sleep -Seconds 5; continue }
            $ok = $true
            break
        }
        & ssh.exe @SshOpts $Target "rm -f $remoteTmp" | Out-Null
        if (-not $ok) {
            if (Test-Path $tmp) { Remove-Item $tmp -Force }
            throw "download failed after 3 attempts: datacore-$ts.tgz (size " + $remoteSize + " bytes on VM)"
        }
        Move-Item $tmp $file -Force
        $kb = [math]::Round((Get-Item $file).Length / 1KB)
        Log "downloaded datacore-$ts.tgz ($kb KB)"
    }

    if (-not (Test-Path $file)) { throw "newest archive missing after download: $file" }
    $old = Get-ChildItem $Dest -Filter "datacore-*.tgz" | Where-Object { $_.FullName -ne (Get-Item $file).FullName }
    foreach ($f in $old) { Remove-Item $f.FullName -Force; Log ("rotated out " + $f.Name) }
    exit 0
} catch {
    Log ("ERROR: " + $_.Exception.Message)
    exit 1
}

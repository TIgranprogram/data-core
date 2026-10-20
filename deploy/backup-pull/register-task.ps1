# register-task.ps1 - register (or update) the daily Windows task that runs pull-backup.ps1.
# Daily at 10:00; if the PC was off at that time, runs as soon as it is on (StartWhenAvailable).
# Runs as the current user (needs the user's SSH key). Re-run safely to update.
# Remove: Unregister-ScheduledTask -TaskName "DataCore backup pull" -Confirm:$false

$TaskName = "DataCore backup pull"
$Script = Join-Path $PSScriptRoot "pull-backup.ps1"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"" + $Script + "`"")
$Trigger = New-ScheduledTaskTrigger -Daily -At 10:00
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Copy latest data-core backup from VM to D:\datacore-backups (keep 30 days)" -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State

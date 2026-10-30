# Daily refresh of the Sportin copy. Run once on the home PC:
#   powershell -ExecutionPolicy Bypass -File SRV-ERP\register-refresh-task.ps1
# Runs at 11:00, after "DataCore backup pull" (10:00). PC off: runs at next start.
# Updates database and new photos only. Code: refresh-copy.sh --code.
# ASCII only: Windows PowerShell 5.1 misreads UTF-8 without BOM.
$Bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path $Bash)) { throw "Git Bash not found: $Bash" }
$Run = 'cd /d/data-core && bash SRV-ERP/refresh-copy.sh >> /d/datacore-backups/refresh.log 2>&1'
$Action = New-ScheduledTaskAction -Execute $Bash -Argument "-lc `"$Run`""
$Trigger = New-ScheduledTaskTrigger -Daily -At 11:00
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'DataCore copy refresh' -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Write-Output 'OK: task DataCore copy refresh created.'

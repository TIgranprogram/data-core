# Creates the Windows task "DataCore night": daily 23:30, runs `node tools\dc.mjs night`.
# ASCII only. Runs as the current user, only while logged on. No catch-up start after power-on
# (StartWhenAvailable is off). Does not change any system or security settings.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $root 'tools\dc.mjs') + '" night') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At '23:30'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable:$false -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'DataCore night' -Action $action -Trigger $trigger -Settings $settings -Description 'dc night: nightly checks on origin/main' -Force | Out-Null
Write-Host 'Task "DataCore night" created: daily 23:30 (only if the PC is on).'

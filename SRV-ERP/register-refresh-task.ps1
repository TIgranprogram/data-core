# Ежедневное обновление копии на Sportin. Запустить один раз на домашнем ПК:
#   powershell -ExecutionPolicy Bypass -File SRV-ERP\register-refresh-task.ps1
# Задача идёт в 11:00, после «DataCore backup pull» (10:00). ПК выключен — запуск при следующем включении.
# Обновляет только базу и новые фото. Код на копию выкладывается отдельно: refresh-copy.sh --code.
$Bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path $Bash)) { throw "Не найден Git Bash: $Bash" }
$Run = 'cd /d/data-core && bash SRV-ERP/refresh-copy.sh >> /d/datacore-backups/refresh.log 2>&1'
$Action = New-ScheduledTaskAction -Execute $Bash -Argument "-lc `"$Run`""
$Trigger = New-ScheduledTaskTrigger -Daily -At 11:00
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'DataCore copy refresh' -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Write-Output 'Готово: задача DataCore copy refresh создана.'

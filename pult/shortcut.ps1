# Creates a desktop shortcut for the DataCore control panel. ASCII only.
# The shortcut opens Pult.cmd, which asks for admin rights itself.
param([string]$Name = 'Pult DataCore')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop ($Name + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = Join-Path $PSScriptRoot 'Pult.cmd'
$s.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$s.IconLocation = (Join-Path $PSScriptRoot 'ui\icon.ico') + ',0'
$s.WindowStyle = 7
$s.Description = 'DataCore control panel'
$s.Save()
Write-Host "Shortcut created: $link"

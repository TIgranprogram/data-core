# Creates shortcuts for the DataCore control panel. ASCII only.
#   -Where desktop   desktop shortcut (asks for admin rights itself)
#   -Where startmenu Start menu entry
#   -Where startup   open the panel when Windows starts (normal rights, no UAC prompt at every logon)
#   -Where all       all three (default)
#   -Remove          remove the shortcut(s) instead
param([string]$Name = 'Pult DataCore', [string]$Where = 'all', [switch]$Remove)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$shell = New-Object -ComObject WScript.Shell
$places = @{
  desktop   = @{ Dir = [Environment]::GetFolderPath('Desktop');  Args = '' }
  startmenu = @{ Dir = [Environment]::GetFolderPath('Programs'); Args = '' }
  startup   = @{ Dir = [Environment]::GetFolderPath('Startup');  Args = '--no-admin' }
}
$keys = if ($Where -eq 'all') { @('desktop', 'startmenu', 'startup') } else { @($Where) }
foreach ($k in $keys) {
  if (-not $places.ContainsKey($k)) { Write-Host "Unknown place: $k (desktop, startmenu, startup, all)"; exit 2 }
  $p = $places[$k]
  $link = Join-Path $p.Dir ($Name + '.lnk')
  if ($Remove) {
    if (Test-Path $link) { Remove-Item $link -Force; Write-Host "Removed: $link" } else { Write-Host "Not found: $link" }
    continue
  }
  $s = $shell.CreateShortcut($link)
  $s.TargetPath = Join-Path $PSScriptRoot 'Pult.cmd'
  $s.Arguments = $p.Args
  $s.WorkingDirectory = Split-Path -Parent $PSScriptRoot
  $s.IconLocation = (Join-Path $PSScriptRoot 'ui\icon.ico') + ',0'
  $s.WindowStyle = 7
  $s.Description = 'DataCore control panel'
  $s.Save()
  Write-Host "Created: $link"
}

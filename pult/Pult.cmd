@echo off
rem DataCore control panel launcher. ASCII only. Double-click, or use the desktop shortcut.
rem   Pult.cmd            - asks for admin rights, then opens the window
rem   Pult.cmd --no-admin - opens the window with normal rights
rem If admin rights are declined, the window still opens with normal rights.
setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install Node 20+ from https://nodejs.org
  pause
  exit /b 1
)

if /i "%~1"=="--no-admin" goto run
net session >nul 2>&1
if not errorlevel 1 goto run
powershell -NoProfile -Command "try { Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('\"' + '%~f0' + '\" --no-admin') -Verb RunAs -WindowStyle Hidden -WorkingDirectory (Get-Location) -ErrorAction Stop; exit 0 } catch { exit 1 }"
if not errorlevel 1 exit /b 0

:run
powershell -NoProfile -Command "Start-Process node -ArgumentList 'pult/server.mjs' -WorkingDirectory (Get-Location) -WindowStyle Hidden"
exit /b 0

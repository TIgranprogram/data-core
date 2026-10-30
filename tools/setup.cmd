@echo off
rem DataCore tools setup. ASCII only. Checks the tools; registers nothing by itself.
rem   tools\setup.cmd        - check only
rem   tools\setup.cmd task   - check, then create Windows task "DataCore night" (daily 23:30)
setlocal
set FAIL=0
set "DCDIR=%~dp0"

where node >nul 2>&1
if errorlevel 1 (echo [!!] Node.js not found - install Node 20+ & set FAIL=1) else (echo [ok] Node.js)

where git >nul 2>&1
if errorlevel 1 (echo [!!] Git not found & set FAIL=1) else (echo [ok] Git)

set "GITBASH="
for /f "delims=" %%g in ('where git 2^>nul') do if not defined GITBASH for %%d in ("%%~dpg..") do if exist "%%~fd\bin\bash.exe" set "GITBASH=%%~fd\bin\bash.exe"
if not defined GITBASH goto nobash
echo [ok] Git Bash found
goto bashdone
:nobash
echo [!!] Git Bash not found - set DC_BASH to bash.exe
set FAIL=1
:bashdone

docker info >nul 2>&1
if errorlevel 1 (echo [!!] Docker is not running or not installed & set FAIL=1) else (echo [ok] Docker is running)

set "EDGE="
set "PF86=%ProgramFiles(x86)%"
if exist "%PF86%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%PF86%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE goto noedge
echo [ok] Edge found
goto edgedone
:noedge
echo [!!] Edge not found - set EDGE to the path of msedge.exe
set FAIL=1
:edgedone

if exist "D:\datacore-backups" goto bkok
echo [!!] D:\datacore-backups is missing - set DC_BACKUPS
set FAIL=1
goto bkdone
:bkok
echo [ok] backups folder
:bkdone

if "%FAIL%"=="1" goto failed
echo.
echo All checks passed. Try: dc stand status, dc night --quick
if /i "%~1"=="task" powershell -NoProfile -ExecutionPolicy Bypass -File "%DCDIR%setup-task.ps1"
if /i not "%~1"=="task" echo To create the 23:30 task run: tools\setup.cmd task
exit /b 0

:failed
echo.
echo Checks failed. Fix the lines marked [!!] and run again.
exit /b 1

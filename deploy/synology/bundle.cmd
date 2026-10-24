@echo off
rem Переносной пакет data-core (БЗ-13): меню сборки/проверки. Нужен Git for Windows (Git Bash).
rem Пакет содержит секреты; хранится в C:\datacore-bundles, в репозиторий не класть.
chcp 65001 >nul
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo Git Bash не найден. Установите Git for Windows.
  pause
  exit /b 1
)
"%GITBASH%" "%~dp0bundle-pc.sh" %*
pause

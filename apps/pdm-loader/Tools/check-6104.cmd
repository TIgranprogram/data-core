@echo off
setlocal
cd /d "%~dp0.."
dotnet run -c Release --no-build -- check-6104 %*
if errorlevel 1 (
  echo Сборка...
  dotnet build -c Release
  dotnet run -c Release --no-build -- check-6104 %*
)
exit /b %ERRORLEVEL%

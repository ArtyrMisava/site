@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title DUS - Local Map

if not exist "%~dp0offline-site\index.html" (
  echo ERROR: The offline-site folder is missing.
  echo Extract the entire ZIP archive before starting DUS.
  echo.
  pause
  exit /b 1
)

if exist "%~dp0runtime\DUS_SERVER.exe" goto native_server

echo WARNING: Portable DUS Server is missing.
echo Falling back to the PowerShell compatibility server.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-server.ps1" -Root "%~dp0offline-site"
set "DUS_EXIT_CODE=%ERRORLEVEL%"
goto finished

:native_server
"%~dp0runtime\DUS_SERVER.exe" --root "%~dp0offline-site" --data "%~dp0site-data\dus-data.json" --port 4173
set "DUS_EXIT_CODE=%ERRORLEVEL%"

:finished
if not "%DUS_EXIT_CODE%"=="0" (
  echo.
  echo DUS could not be started. See the message above.
  echo.
  pause
)

endlocal & exit /b %DUS_EXIT_CODE%

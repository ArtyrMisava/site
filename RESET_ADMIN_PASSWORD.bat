@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title DUS - Reset Administrator Access

if not exist "%~dp0runtime\DUS_SERVER.exe" (
  echo ERROR: runtime\DUS_SERVER.exe is missing.
  echo Reinstall the current DUS update package.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo DUS - ADMINISTRATOR ACCESS RESET
echo ============================================================
echo.
echo 1. Close the DUS browser windows.
echo 2. Close the DUS server window.
echo 3. Type RESET below.
echo.
echo Map points, vehicles, routes and settings will be preserved.
echo Only the administrator name, PIN hash and active login are reset.
echo.
set /p "DUS_CONFIRM=Type RESET to continue: "
if /I not "%DUS_CONFIRM%"=="RESET" (
  echo.
  echo Cancelled. Nothing was changed.
  pause
  exit /b 0
)

taskkill /F /IM DUS_SERVER.exe >nul 2>&1
"%~dp0runtime\DUS_SERVER.exe" --data "%~dp0site-data\dus-data.json" --reset-admin
set "DUS_EXIT_CODE=%ERRORLEVEL%"
echo.
if "%DUS_EXIT_CODE%"=="0" (
  echo Reset completed. Start DUS and create a new administrator PIN.
) else (
  echo Reset failed. Your map data was not intentionally deleted.
)
echo.
pause
endlocal & exit /b %DUS_EXIT_CODE%

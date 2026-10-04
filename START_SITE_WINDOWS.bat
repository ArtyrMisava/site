@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ================================================
echo   LOKUS - LOCAL COMPANY MAP
echo ================================================
echo.

if not exist "%~dp0offline-site\index.html" (
  echo ERROR: The offline-site folder is missing.
  echo Extract the entire ZIP archive before starting the site.
  echo.
  pause
  exit /b 1
)

echo Starting the site in your browser...
echo Keep this window open while you use the site.
echo To stop the site, press Ctrl+C or close this window.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-server.ps1" -Root "%~dp0offline-site"

if errorlevel 1 (
  echo.
  echo The site could not be started.
  echo See the error above or install Node.js LTS and run npm install.
  echo.
  pause
)

endlocal

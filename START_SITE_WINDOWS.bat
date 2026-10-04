@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0offline-site\index.html" (
  echo ERROR: The offline-site folder is missing.
  echo Extract the entire ZIP archive before starting DUS.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-server.ps1" -Root "%~dp0offline-site"
set "DUS_EXIT_CODE=%ERRORLEVEL%"

if not "%DUS_EXIT_CODE%"=="0" (
  echo.
  echo DUS could not be started. See the message above.
  echo.
  pause
)

endlocal & exit /b %DUS_EXIT_CODE%

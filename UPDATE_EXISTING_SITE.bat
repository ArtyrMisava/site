@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title DUS - Update Existing Installation

set "DUS_SOURCE=%~dp0"
if not exist "%DUS_SOURCE%offline-site\index.html" goto source_error
if not exist "%DUS_SOURCE%runtime\DUS_SERVER.exe" goto source_error

echo ============================================================
echo DUS - UPDATE EXISTING INSTALLATION
echo ============================================================
echo.
echo Close the old DUS browser and server windows before continuing.
echo Enter or drag the OLD DUS folder into this window.
echo Example: C:\Users\User\Desktop\DUS

echo.
set /p "DUS_TARGET=Old DUS folder: "
set "DUS_TARGET=%DUS_TARGET:"=%"
if "%DUS_TARGET%"=="" goto target_error
for %%I in ("%DUS_TARGET%") do set "DUS_TARGET=%%~fI"
if not exist "%DUS_TARGET%\offline-site\index.html" goto target_error

echo.
echo Old site: %DUS_TARGET%
echo New files: %DUS_SOURCE%
echo.
echo The site-data folder will NOT be replaced.
echo Browser data from an older version will migrate on first launch.
pause

taskkill /F /IM DUS_SERVER.exe >nul 2>&1

if exist "%DUS_TARGET%\update-backup" rmdir /S /Q "%DUS_TARGET%\update-backup"
mkdir "%DUS_TARGET%\update-backup" >nul 2>&1
robocopy "%DUS_TARGET%\offline-site" "%DUS_TARGET%\update-backup\offline-site" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_error
if exist "%DUS_TARGET%\START_SITE_WINDOWS.bat" copy /Y "%DUS_TARGET%\START_SITE_WINDOWS.bat" "%DUS_TARGET%\update-backup\START_SITE_WINDOWS.bat" >nul

robocopy "%DUS_SOURCE%offline-site" "%DUS_TARGET%\offline-site" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_error
robocopy "%DUS_SOURCE%runtime" "%DUS_TARGET%\runtime" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_error
if not exist "%DUS_TARGET%\scripts" mkdir "%DUS_TARGET%\scripts" >nul 2>&1
copy /Y "%DUS_SOURCE%scripts\local-server.ps1" "%DUS_TARGET%\scripts\local-server.ps1" >nul
copy /Y "%DUS_SOURCE%START_SITE_WINDOWS.bat" "%DUS_TARGET%\START_SITE_WINDOWS.bat" >nul
copy /Y "%DUS_SOURCE%RESET_ADMIN_PASSWORD.bat" "%DUS_TARGET%\RESET_ADMIN_PASSWORD.bat" >nul
copy /Y "%DUS_SOURCE%UPDATE_EXISTING_SITE.bat" "%DUS_TARGET%\UPDATE_EXISTING_SITE.bat" >nul
if exist "%DUS_SOURCE%WINDOWS_START_RU.txt" copy /Y "%DUS_SOURCE%WINDOWS_START_RU.txt" "%DUS_TARGET%\WINDOWS_START_RU.txt" >nul
if exist "%DUS_SOURCE%README.md" copy /Y "%DUS_SOURCE%README.md" "%DUS_TARGET%\README.md" >nul

if not exist "%DUS_TARGET%\site-data" mkdir "%DUS_TARGET%\site-data" >nul 2>&1

echo.
echo ============================================================
echo UPDATE COMPLETED
echo ============================================================
echo Previous program files: %DUS_TARGET%\update-backup
echo Personal data folder:   %DUS_TARGET%\site-data
echo.
echo Start the updated site with:
echo %DUS_TARGET%\START_SITE_WINDOWS.bat
echo.
pause
exit /b 0

:source_error
echo ERROR: This update package is incomplete.
echo Extract the full new DUS ZIP archive and run this file again.
echo.
pause
exit /b 1

:target_error
echo.
echo ERROR: The selected folder is not an existing DUS installation.
echo It must contain offline-site\index.html.
echo.
pause
exit /b 1

:copy_error
echo.
echo ERROR: Windows could not copy all update files.
echo The previous program copy is in %DUS_TARGET%\update-backup.
echo The site-data folder was not deleted.
echo.
pause
exit /b 1

@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title ДУС - локальная карта
color 0B
cls

echo.
echo        +----------------------------------------------------------+
echo.
echo                    ####      ##    ##     ######
echo                   ##  ##     ##    ##    ##
echo                   ##  ##      ##  ##     ##
echo                   ##  ##       ####      ##
echo                   ##  ##        ##       ##
echo                 ########       ##        ##
echo                 ##    ##      ##          ######
echo.
echo                              Д У С
echo                     ЛОКАЛЬНАЯ КАРТА ОБЪЕКТОВ
echo.
echo        +----------------------------------------------------------+
echo.

if not exist "%~dp0offline-site\index.html" (
  echo ОШИБКА: не найдена папка offline-site с файлами сайта.
  echo Полностью распакуйте весь ZIP-архив ДУС и запустите файл снова.
  echo.
  pause
  exit /b 1
)

if exist "%~dp0runtime\node.exe" if exist "%~dp0server\dus-server.cjs" goto native_server

echo ВНИМАНИЕ: переносной сервер ДУС не найден.
echo Запускается резервный сервер совместимости через PowerShell.
echo Отдельно устанавливать программы не требуется.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-server.ps1" -Root "%~dp0offline-site" -NoBanner
set "DUS_EXIT_CODE=%ERRORLEVEL%"
goto finished

:native_server
echo Запуск локального сервера. Сейчас откроется браузер...
echo.
"%~dp0runtime\node.exe" "%~dp0server\dus-server.cjs" --root "%~dp0offline-site" --data "%~dp0site-data\dus-data.json" --port 4173 --no-banner
set "DUS_EXIT_CODE=%ERRORLEVEL%"

:finished
if not "%DUS_EXIT_CODE%"=="0" (
  echo.
  echo ОШИБКА: сайт ДУС не удалось запустить.
  echo Причина указана выше. Проверьте, что архив распакован полностью.
  echo.
  pause
)

endlocal & exit /b %DUS_EXIT_CODE%

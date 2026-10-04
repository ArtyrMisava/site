@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title ДУС - локальная карта
cls

color 0B
echo.
echo             ДДДДД       У     У        ССССС
echo            Д     Д      У     У       С
echo            Д     Д      У     У       С
echo            Д     Д       У   У        С
echo            Д     Д        У У         С
echo          ДДДДДДДДД         У           ССССС
echo          Д       Д        У
echo.
echo                 Л О К А Л Ь Н А Я   К А Р Т А
echo =================================================================
echo.
color 07

if not exist "%~dp0offline-site\index.html" (
  echo ОШИБКА: папка offline-site не найдена.
  echo Полностью распакуйте ZIP-архив перед запуском ДУС.
  echo.
  pause
  exit /b 1
)

echo Запускаем ДУС в браузере...
echo Не закрывайте это окно во время работы с сайтом.
echo Для остановки нажмите Ctrl+C или закройте окно.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-server.ps1" -Root "%~dp0offline-site"

if errorlevel 1 (
  echo.
  echo Не удалось запустить ДУС.
  echo Проверьте сообщение об ошибке выше.
  echo.
  pause
)

endlocal

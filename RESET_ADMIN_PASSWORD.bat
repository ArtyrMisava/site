@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title ДУС - сброс доступа администратора
color 0E
cls

echo ============================================================
echo              Д У С - СБРОС ДОСТУПА АДМИНИСТРАТОРА
echo ============================================================
echo.

if not exist "%~dp0runtime\node.exe" (
  echo ОШИБКА: не найден файл runtime\node.exe.
  echo Полностью распакуйте актуальный архив ДУС или повторите обновление.
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0server\dus-server.cjs" (
  echo ОШИБКА: не найден файл server\dus-server.cjs.
  echo Полностью распакуйте актуальный архив ДУС или повторите обновление.
  echo.
  pause
  exit /b 1
)

echo Перед сбросом:
echo   1. Закройте вкладки ДУС в браузере.
echo   2. Закройте окно запущенного сервера ДУС.
echo   3. Ниже введите слово СБРОС.
echo.
echo БУДУТ УДАЛЕНЫ:
echo   - имя и ПИН-код администратора;
echo   - код восстановления и активный вход.
echo.
echo БУДУТ СОХРАНЕНЫ:
echo   - точки и списки людей;
echo   - машины и маршруты;
echo   - линия боевого соприкосновения и настройки карты.
echo.
set /p "DUS_CONFIRM=Для продолжения введите СБРОС: "
if /I "%DUS_CONFIRM%"=="СБРОС" goto confirmed
if /I "%DUS_CONFIRM%"=="RESET" goto confirmed

echo.
echo Сброс отменён. Никакие данные не изменены.
echo.
pause
exit /b 0

:confirmed
echo.
echo Закрытие старого сервера и сброс данных доступа...
taskkill /F /T /FI "WINDOWTITLE eq ДУС - локальная карта" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq DUS - Local Map" >nul 2>&1
"%~dp0runtime\node.exe" "%~dp0server\dus-server.cjs" --data "%~dp0site-data\dus-data.json" --reset-admin
set "DUS_EXIT_CODE=%ERRORLEVEL%"
echo.
if "%DUS_EXIT_CODE%"=="0" (
  echo ГОТОВО: доступ администратора сброшен.
  echo Запустите ДУС и создайте нового администратора с новым ПИН-кодом.
) else (
  echo ОШИБКА: сброс выполнить не удалось.
  echo Рабочие данные карты намеренно не удалялись.
)
echo.
pause
endlocal & exit /b %DUS_EXIT_CODE%

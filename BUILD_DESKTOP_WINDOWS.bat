@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title ДУС - сборка приложения для Windows
color 0B
cls

echo ============================================================
echo              Д У С - СБОРКА ПРИЛОЖЕНИЯ WINDOWS
echo ============================================================
echo.
echo Будет создан переносной EXE без установки и прав администратора.
echo Для сборки требуется Node.js 22 или новее и подключение к интернету.
echo Готовое приложение после сборки работает полностью без интернета.
echo.

if not exist "%~dp0package.json" goto source_error
where node >nul 2>&1
if errorlevel 1 goto node_error
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_error

echo [1/4] Установка проверенных зависимостей...
call npm ci --no-audit --no-fund
if errorlevel 1 goto build_error

echo.
echo [2/4] Проверка исходного кода и локального сервера...
call npm run desktop:check
if errorlevel 1 goto build_error

echo.
echo [3/4] Сборка переносного приложения Windows x64...
call npm run desktop:pack:win
if errorlevel 1 goto build_error

set "DUS_EXE="
for %%F in ("%~dp0build\desktop\DUS-*-portable.exe") do set "DUS_EXE=%%~fF"
if not defined DUS_EXE goto build_error
if not exist "%DUS_EXE%" goto build_error

echo.
echo [4/4] Создание контрольной суммы SHA-256...
certutil -hashfile "%DUS_EXE%" SHA256 > "%DUS_EXE%.sha256.txt"
if errorlevel 1 goto build_error

echo.
echo ============================================================
echo                     СБОРКА ЗАВЕРШЕНА
echo ============================================================
echo Готовое приложение:
echo %DUS_EXE%
echo.
echo Контрольная сумма:
echo %DUS_EXE%.sha256.txt
echo.
pause
exit /b 0

:source_error
echo ОШИБКА: не найден package.json.
echo Запускайте этот файл из полной папки исходного кода ДУС.
goto failed

:node_error
echo ОШИБКА: не найден Node.js или npm.
echo Установите Node.js 22 или новее и повторите сборку.
goto failed

:build_error
echo.
echo ОШИБКА: собрать приложение не удалось.
echo Причина указана выше. Исходные данные и site-data не изменены.

:failed
echo.
pause
exit /b 1

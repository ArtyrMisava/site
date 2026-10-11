@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title ДУС - обновление установленного сайта
color 0A
cls

set "DUS_SOURCE=%~dp0"
if not exist "%DUS_SOURCE%offline-site\index.html" goto source_error
if not exist "%DUS_SOURCE%runtime\node.exe" goto source_error
if not exist "%DUS_SOURCE%server\dus-server.cjs" goto source_error

echo ============================================================
echo                    Д У С - ОБНОВЛЕНИЕ
echo ============================================================
echo.
echo Этот файл перенесёт новую версию программы в старую папку ДУС.
echo Ваши точки, люди, машины, маршруты, линия и данные доступа
echo из папки site-data заменены или удалены НЕ БУДУТ.
echo.
echo Перед продолжением закройте сайт и окно сервера старой версии.
echo Затем введите путь к СТАРОЙ папке ДУС или перетащите папку сюда.
echo Пример: C:\Users\User\Desktop\ДУС
echo.
set /p "DUS_TARGET=Путь к старой папке ДУС: "
set "DUS_TARGET=%DUS_TARGET:"=%"
if "%DUS_TARGET%"=="" goto target_error
for %%I in ("%DUS_TARGET%") do set "DUS_TARGET=%%~fI"
if not exist "%DUS_TARGET%\offline-site\index.html" goto target_error

echo.
echo Старая установка: %DUS_TARGET%
echo Новая версия:      %DUS_SOURCE%
echo.
echo Папка site-data останется без изменений.
echo Перед заменой будет создана резервная копия update-backup.
echo.
set /p "DUS_CONTINUE=Для начала обновления введите ДА: "
if /I "%DUS_CONTINUE%"=="ДА" goto update_start
if /I "%DUS_CONTINUE%"=="YES" goto update_start
goto cancelled

:update_start
echo.
echo [1/5] Закрытие запущенного сервера ДУС...
taskkill /F /T /FI "WINDOWTITLE eq ДУС - локальная карта" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq DUS - Local Map" >nul 2>&1

echo [2/5] Создание резервной копии старой программы...
if exist "%DUS_TARGET%\update-backup" rmdir /S /Q "%DUS_TARGET%\update-backup"
mkdir "%DUS_TARGET%\update-backup" >nul 2>&1
robocopy "%DUS_TARGET%\offline-site" "%DUS_TARGET%\update-backup\offline-site" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_error
if exist "%DUS_TARGET%\START_SITE_WINDOWS.bat" copy /Y "%DUS_TARGET%\START_SITE_WINDOWS.bat" "%DUS_TARGET%\update-backup\START_SITE_WINDOWS.bat" >nul

echo [3/5] Копирование новой версии сайта и карты...
robocopy "%DUS_SOURCE%offline-site" "%DUS_TARGET%\offline-site" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_error

echo [4/5] Обновление переносного сервера...
robocopy "%DUS_SOURCE%runtime" "%DUS_TARGET%\runtime" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_error
robocopy "%DUS_SOURCE%server" "%DUS_TARGET%\server" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_error
if not exist "%DUS_TARGET%\scripts" mkdir "%DUS_TARGET%\scripts" >nul 2>&1
copy /Y "%DUS_SOURCE%scripts\local-server.ps1" "%DUS_TARGET%\scripts\local-server.ps1" >nul

echo [5/5] Обновление команд запуска и справки...
copy /Y "%DUS_SOURCE%START_SITE_WINDOWS.bat" "%DUS_TARGET%\START_SITE_WINDOWS.bat" >nul
copy /Y "%DUS_SOURCE%RESET_ADMIN_PASSWORD.bat" "%DUS_TARGET%\RESET_ADMIN_PASSWORD.bat" >nul
copy /Y "%DUS_SOURCE%UPDATE_EXISTING_SITE.bat" "%DUS_TARGET%\UPDATE_EXISTING_SITE.bat" >nul
if exist "%DUS_SOURCE%WINDOWS_START_RU.txt" copy /Y "%DUS_SOURCE%WINDOWS_START_RU.txt" "%DUS_TARGET%\WINDOWS_START_RU.txt" >nul
if exist "%DUS_SOURCE%README.md" copy /Y "%DUS_SOURCE%README.md" "%DUS_TARGET%\README.md" >nul
if not exist "%DUS_TARGET%\site-data" mkdir "%DUS_TARGET%\site-data" >nul 2>&1

echo.
echo ============================================================
echo                  ОБНОВЛЕНИЕ ЗАВЕРШЕНО
echo ============================================================
echo Резервная копия программы: %DUS_TARGET%\update-backup
echo Личные данные сохранены в:  %DUS_TARGET%\site-data
echo.
echo Теперь запустите обновлённый сайт файлом:
echo %DUS_TARGET%\START_SITE_WINDOWS.bat
echo.
pause
exit /b 0

:cancelled
echo.
echo Обновление отменено. Никакие файлы не изменены.
echo.
pause
exit /b 0

:source_error
echo ============================================================
echo                    ОШИБКА ОБНОВЛЕНИЯ
echo ============================================================
echo В новой папке отсутствуют необходимые файлы ДУС.
echo Полностью распакуйте новый ZIP-архив и запустите этот файл снова.
echo.
pause
exit /b 1

:target_error
echo.
echo ОШИБКА: выбранная папка не является старой установкой ДУС.
echo В ней должна находиться папка offline-site с файлом index.html.
echo Проверьте путь и запустите обновление снова.
echo.
pause
exit /b 1

:copy_error
echo.
echo ОШИБКА: Windows не удалось скопировать все файлы обновления.
echo Старая версия программы находится в папке:
echo %DUS_TARGET%\update-backup
echo Папка site-data намеренно не удалялась и не заменялась.
echo.
pause
exit /b 1

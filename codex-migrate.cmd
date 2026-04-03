@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "NODE_EXE=%APP_DIR%\runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo Missing bundled runtime: "%NODE_EXE%"
  echo.
  pause
  exit /b 1
)
if "%~1"=="" goto interactive

"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\src\cli.js" %*
exit /b %ERRORLEVEL%

:interactive
title Codex Session Migrator CLI
cls
echo Codex Session Migrator
echo.
echo 1. Open web app
echo 2. Repair Codex indexes
echo 3. Run health check ^(doctor^)
echo 4. One-click desktop self-heal
echo 5. Show CLI help
echo 6. Exit
echo.
set /p MENU_CHOICE=Choose an action [1-6]:

if "%MENU_CHOICE%"=="1" goto open_ui
if "%MENU_CHOICE%"=="2" goto repair_indexes
if "%MENU_CHOICE%"=="3" goto run_doctor
if "%MENU_CHOICE%"=="4" goto self_heal
if "%MENU_CHOICE%"=="5" goto show_help
if "%MENU_CHOICE%"=="6" exit /b 0

echo.
echo Invalid selection.
echo.
pause
goto interactive

:open_ui
call "%ROOT_DIR%Codex Session Migrator.cmd"
exit /b %ERRORLEVEL%

:repair_indexes
call "%ROOT_DIR%Repair Codex Indexes.cmd"
exit /b %ERRORLEVEL%

:self_heal
call "%ROOT_DIR%Codex Desktop One-Click Self Heal.cmd"
exit /b %ERRORLEVEL%

:run_doctor
cls
echo Codex Session Migrator - Doctor
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\src\cli.js" doctor
echo.
pause
exit /b %ERRORLEVEL%

:show_help
cls
echo Codex Session Migrator - CLI Help
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\src\cli.js" help
echo.
echo Double-click tips:
echo - Use option 1 to open the browser UI
echo - Use option 2 if migrated sessions are not visible in CodexManager
echo - Use this script in a terminal for commands like: doctor, repair, migrate, restore
echo.
pause
exit /b 0

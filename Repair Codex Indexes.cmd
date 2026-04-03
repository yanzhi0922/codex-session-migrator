@echo off
setlocal
title Codex Session Migrator - Repair
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "NODE_EXE=%APP_DIR%\runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo Missing bundled runtime: "%NODE_EXE%"
  pause
  exit /b 1
)
echo Repairing Codex session indexes...
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\src\cli.js" repair %*
echo.
echo Running a follow-up health check...
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\src\cli.js" doctor
echo.
pause

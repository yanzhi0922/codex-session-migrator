@echo off
setlocal
title Codex Session Migrator
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "NODE_EXE=%APP_DIR%\runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo Missing bundled runtime: "%NODE_EXE%"
  pause
  exit /b 1
)
echo Starting Codex Session Migrator...
echo Browser UI will open automatically. Close this window to stop the local service.
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\src\cli.js" serve --open %*

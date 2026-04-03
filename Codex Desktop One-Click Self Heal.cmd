@echo off
setlocal EnableExtensions
title Codex Desktop - One-Click Self Heal

set "PKG_ID=OpenAI.Codex_2p2nqsd0c76g0"
set "APP_LAUNCH=shell:AppsFolder\%PKG_ID%!App"
set "PKG_ROOT=%LOCALAPPDATA%\Packages\%PKG_ID%"
set "ROAMING_CODEX=%PKG_ROOT%\LocalCache\Roaming\Codex"
set "LOCAL_STORAGE=%ROAMING_CODEX%\Local Storage"
set "SESSION_STORAGE=%ROAMING_CODEX%\Session Storage"
set "INDEXED_DB=%ROAMING_CODEX%\IndexedDB"
set "BACKUP_ROOT=%USERPROFILE%\.codex\self-heal-backups"

if /I "%~1"=="--help" goto usage

echo Codex Desktop One-Click Self Heal
echo.
echo This script will:
echo   1. Stop Codex Desktop processes (Codex.exe / codex.exe only)
echo   2. Backup desktop cache state
echo   3. Clear stale desktop cache state
echo   4. Restart Codex Desktop
echo.
echo It does NOT modify your core session data under "%USERPROFILE%\.codex\sessions".
echo.

if not exist "%PKG_ROOT%" (
  echo Cannot find Codex Desktop package directory:
  echo   "%PKG_ROOT%"
  echo.
  echo Make sure Codex Desktop is installed, then run this script again.
  echo.
  pause
  exit /b 1
)

echo [1/4] Stopping Codex Desktop processes...
for %%P in (Codex.exe codex.exe) do (
  taskkill /F /T /IM %%P >nul 2>&1
)
echo Stopped any running Codex desktop processes.

echo.
echo [2/4] Backing up desktop cache state...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'; $backupDir = Join-Path '%BACKUP_ROOT%' ('codex-desktop-' + $stamp); New-Item -ItemType Directory -Path $backupDir -Force | Out-Null; $targets = @('%LOCAL_STORAGE%','%SESSION_STORAGE%','%INDEXED_DB%'); foreach ($path in $targets) { if (Test-Path $path) { $name = Split-Path $path -Leaf; Copy-Item -Path $path -Destination (Join-Path $backupDir $name) -Recurse -Force -ErrorAction Stop; Write-Host ('Backed up: ' + $path); } else { Write-Host ('Skip missing: ' + $path); } }; Set-Content -Path (Join-Path $backupDir 'readme.txt') -Value 'Created by Codex Desktop One-Click Self Heal.' -Encoding UTF8; Write-Host ('Backup directory: ' + $backupDir)"
if errorlevel 1 goto fail

echo.
echo [3/4] Clearing stale desktop cache state...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$paths = @('%LOCAL_STORAGE%','%SESSION_STORAGE%','%INDEXED_DB%'); foreach ($path in $paths) { if (Test-Path $path) { Remove-Item -Path $path -Recurse -Force -ErrorAction Stop; Write-Host ('Removed: ' + $path); } }; foreach ($path in $paths) { New-Item -ItemType Directory -Path $path -Force | Out-Null }"
if errorlevel 1 goto fail

echo.
echo [4/4] Starting Codex Desktop...
start "" explorer.exe "%APP_LAUNCH%"
echo.
echo Self-heal complete.
echo If a screen is still stuck, run this script once more and then open a fresh chat tab.
echo.
pause
exit /b 0

:usage
echo Usage:
echo   %~nx0
echo.
echo This script performs a full desktop self-heal workflow.
echo.
exit /b 0

:fail
echo.
echo Self-heal failed.
echo Please keep this window open and share the output for diagnosis.
echo.
pause
exit /b 1
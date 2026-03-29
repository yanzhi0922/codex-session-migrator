#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const CACHE_ROOT = path.join(DIST_ROOT, '.cache');
const STAGE_ROOT = path.join(DIST_ROOT, '.stage');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const APP_NAME = 'Codex Session Migrator';
const APP_SLUG = 'Codex-Session-Migrator';
const TARGET_PLATFORM = 'windows';
const TARGET_ARCH = 'x64';
const BUNDLE_NAME = `${APP_SLUG}-${PACKAGE_JSON.version}-${TARGET_PLATFORM}-${TARGET_ARCH}-portable`;
const PORTABLE_ROOT = path.join(STAGE_ROOT, BUNDLE_NAME);
const APP_ROOT = path.join(PORTABLE_ROOT, 'app');
const RUNTIME_ROOT = path.join(APP_ROOT, 'runtime');
const ZIP_OUTPUT_PATH = path.join(DIST_ROOT, `${BUNDLE_NAME}.zip`);
const NODE_DIST_INDEX_URL = 'https://nodejs.org/dist/index.json';

function ensureWindows() {
  if (process.platform !== 'win32') {
    throw new Error('Portable Windows builds must be created on Windows.');
  }
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function resetDirectory(directoryPath) {
  fs.rmSync(directoryPath, { recursive: true, force: true });
  fs.mkdirSync(directoryPath, { recursive: true });
}

function compareVersions(left, right) {
  const leftParts = String(left).replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
  const rightParts = String(right).replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function requestBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(requestBuffer(response.headers.location));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Request failed for ${url} (${response.statusCode})`));
        response.resume();
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function fetchJson(url) {
  const buffer = await requestBuffer(url);
  return JSON.parse(buffer.toString('utf8'));
}

async function downloadFile(url, destinationPath) {
  ensureDirectory(path.dirname(destinationPath));
  if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
    return destinationPath;
  }

  const buffer = await requestBuffer(url);
  fs.writeFileSync(destinationPath, buffer);
  return destinationPath;
}

function resolveNodeRelease(indexEntries) {
  const explicitVersion = process.env.CSM_NODE_VERSION
    ? (String(process.env.CSM_NODE_VERSION).startsWith('v')
      ? String(process.env.CSM_NODE_VERSION)
      : `v${process.env.CSM_NODE_VERSION}`)
    : '';

  const filteredEntries = indexEntries
    .filter((entry) => entry && entry.version && Array.isArray(entry.files))
    .filter((entry) => entry.files.includes('win-x64-zip'))
    .filter((entry) => Number(String(entry.version).replace(/^v/i, '').split('.')[0]) >= 24);

  if (explicitVersion) {
    const match = filteredEntries.find((entry) => entry.version === explicitVersion);
    if (!match) {
      throw new Error(`Requested Node runtime ${explicitVersion} was not found in the official dist index.`);
    }
    return match;
  }

  const latestLts = filteredEntries
    .filter((entry) => entry.lts)
    .sort((left, right) => compareVersions(right.version, left.version))[0];

  if (!latestLts) {
    throw new Error('No suitable Windows x64 LTS Node runtime was found.');
  }

  return latestLts;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function verifyChecksum(archivePath, shasumsText, archiveName) {
  const expectedLine = String(shasumsText)
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(`  ${archiveName}`));

  if (!expectedLine) {
    throw new Error(`Could not find SHA256 checksum for ${archiveName}.`);
  }

  const expectedHash = expectedLine.trim().split(/\s+/)[0].toLowerCase();
  const actualHash = sha256File(archivePath).toLowerCase();

  if (actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch for ${archiveName}. Expected ${expectedHash}, received ${actualHash}.`);
  }
}

function runPowerShell(script) {
  const result = spawnSync('powershell', ['-NoLogo', '-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'PowerShell command failed.');
  }

  return result.stdout.trim();
}

function expandArchive(archivePath, destinationPath) {
  ensureDirectory(path.dirname(destinationPath));
  fs.rmSync(destinationPath, { recursive: true, force: true });
  const literalArchivePath = archivePath.replace(/'/g, "''");
  const literalDestinationPath = destinationPath.replace(/'/g, "''");
  runPowerShell(`Expand-Archive -LiteralPath '${literalArchivePath}' -DestinationPath '${literalDestinationPath}' -Force`);
}

function compressDirectory(sourcePath, zipPath) {
  fs.rmSync(zipPath, { force: true });
  ensureDirectory(path.dirname(zipPath));
  const literalSourcePath = sourcePath.replace(/'/g, "''");
  const literalZipPath = zipPath.replace(/'/g, "''");
  runPowerShell(`Compress-Archive -LiteralPath '${literalSourcePath}' -DestinationPath '${literalZipPath}' -CompressionLevel Optimal -Force`);
}

function copyRequiredPaths() {
  const mappings = [
    ['src', path.join(APP_ROOT, 'src')],
    ['public', path.join(APP_ROOT, 'public')],
    ['README.md', path.join(PORTABLE_ROOT, 'README.md')],
    ['CHANGELOG.md', path.join(PORTABLE_ROOT, 'CHANGELOG.md')],
    ['LICENSE', path.join(PORTABLE_ROOT, 'LICENSE')],
    ['package.json', path.join(APP_ROOT, 'package.json')]
  ];

  for (const [relativeSource, destinationPath] of mappings) {
    const absoluteSource = path.join(REPO_ROOT, relativeSource);
    fs.cpSync(absoluteSource, destinationPath, { recursive: true });
  }
}

function writeTextFile(filePath, content) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content.replace(/\n/g, '\r\n'), 'utf8');
}

function createLaunchers(nodeVersion) {
  const mainLauncher = `@echo off
setlocal
title ${APP_NAME}
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "NODE_EXE=%APP_DIR%\\runtime\\node.exe"
if not exist "%NODE_EXE%" (
  echo Missing bundled runtime: "%NODE_EXE%"
  pause
  exit /b 1
)
echo Starting ${APP_NAME}...
echo Browser UI will open automatically. Close this window to stop the local service.
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\\src\\cli.js" serve --open %*
`;

  const cliLauncher = `@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "NODE_EXE=%APP_DIR%\\runtime\\node.exe"
if not exist "%NODE_EXE%" (
  echo Missing bundled runtime: "%NODE_EXE%"
  echo.
  pause
  exit /b 1
)
if "%~1"=="" goto interactive

"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\\src\\cli.js" %*
exit /b %ERRORLEVEL%

:interactive
title ${APP_NAME} CLI
cls
echo ${APP_NAME}
echo.
echo 1. Open web app
echo 2. Repair Codex indexes
echo 3. Run health check ^(doctor^)
echo 4. Show CLI help
echo 5. Exit
echo.
set /p MENU_CHOICE=Choose an action [1-5]:

if "%MENU_CHOICE%"=="1" goto open_ui
if "%MENU_CHOICE%"=="2" goto repair_indexes
if "%MENU_CHOICE%"=="3" goto run_doctor
if "%MENU_CHOICE%"=="4" goto show_help
if "%MENU_CHOICE%"=="5" exit /b 0

echo.
echo Invalid selection.
echo.
pause
goto interactive

:open_ui
call "%ROOT_DIR%${APP_NAME}.cmd"
exit /b %ERRORLEVEL%

:repair_indexes
call "%ROOT_DIR%Repair Codex Indexes.cmd"
exit /b %ERRORLEVEL%

:run_doctor
cls
echo ${APP_NAME} - Doctor
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\\src\\cli.js" doctor
echo.
pause
exit /b %ERRORLEVEL%

:show_help
cls
echo ${APP_NAME} - CLI Help
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\\src\\cli.js" help
echo.
echo Double-click tips:
echo - Use option 1 to open the browser UI
echo - Use option 2 if migrated sessions are not visible in CodexManager
echo - Use this script in a terminal for commands like: doctor, repair, migrate, restore
echo.
pause
exit /b 0
`;

  const repairLauncher = `@echo off
setlocal
title ${APP_NAME} - Repair
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "NODE_EXE=%APP_DIR%\\runtime\\node.exe"
if not exist "%NODE_EXE%" (
  echo Missing bundled runtime: "%NODE_EXE%"
  pause
  exit /b 1
)
echo Repairing Codex session indexes...
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\\src\\cli.js" repair %*
echo.
echo Running a follow-up health check...
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%APP_DIR%\\src\\cli.js" doctor
echo.
pause
`;

  const startHere = `${APP_NAME}
Version: ${PACKAGE_JSON.version}
Bundled Node runtime: ${nodeVersion}

Quick start
1. Double-click "Codex Session Migrator.cmd"
2. Keep that window open while you use the browser UI
3. If migrated sessions are still invisible in CodexManager, run "Repair Codex Indexes.cmd"

Included launchers
- Codex Session Migrator.cmd : starts the local web app and opens your browser
- codex-migrate.cmd          : CLI wrapper with a no-flash double-click menu
- Repair Codex Indexes.cmd   : rebuilds missing thread indexes and runs a health check
`;

  writeTextFile(path.join(PORTABLE_ROOT, 'Codex Session Migrator.cmd'), mainLauncher);
  writeTextFile(path.join(PORTABLE_ROOT, 'codex-migrate.cmd'), cliLauncher);
  writeTextFile(path.join(PORTABLE_ROOT, 'Repair Codex Indexes.cmd'), repairLauncher);
  writeTextFile(path.join(PORTABLE_ROOT, 'START HERE.txt'), startHere);
}

function writePortableManifest(nodeRelease) {
  const manifest = {
    appName: APP_NAME,
    version: PACKAGE_JSON.version,
    builtAt: new Date().toISOString(),
    nodeRuntime: {
      version: nodeRelease.version,
      lts: nodeRelease.lts || null,
      files: nodeRelease.files
    },
    artifact: {
      folder: BUNDLE_NAME,
      zipFile: path.basename(ZIP_OUTPUT_PATH)
    }
  };

  fs.writeFileSync(
    path.join(PORTABLE_ROOT, 'portable-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

function findExtractedNodeRoot(extractedParentPath) {
  const entries = fs.readdirSync(extractedParentPath, { withFileTypes: true });
  const directoryEntry = entries.find((entry) => entry.isDirectory());
  if (!directoryEntry) {
    throw new Error('The downloaded Node archive did not contain an extractable directory.');
  }
  return path.join(extractedParentPath, directoryEntry.name);
}

async function main() {
  ensureWindows();
  ensureDirectory(DIST_ROOT);
  ensureDirectory(CACHE_ROOT);
  resetDirectory(STAGE_ROOT);
  resetDirectory(PORTABLE_ROOT);
  ensureDirectory(APP_ROOT);
  ensureDirectory(RUNTIME_ROOT);

  const indexEntries = await fetchJson(NODE_DIST_INDEX_URL);
  const nodeRelease = resolveNodeRelease(indexEntries);
  const archiveName = `node-${nodeRelease.version}-win-x64.zip`;
  const archiveUrl = `https://nodejs.org/dist/${nodeRelease.version}/${archiveName}`;
  const shasumsUrl = `https://nodejs.org/dist/${nodeRelease.version}/SHASUMS256.txt`;
  const archivePath = path.join(CACHE_ROOT, archiveName);
  const shasumsPath = path.join(CACHE_ROOT, `SHASUMS256-${nodeRelease.version}.txt`);

  console.log(`Using bundled runtime ${nodeRelease.version}${nodeRelease.lts ? ` (${nodeRelease.lts})` : ''}`);
  await downloadFile(archiveUrl, archivePath);
  await downloadFile(shasumsUrl, shasumsPath);
  verifyChecksum(archivePath, fs.readFileSync(shasumsPath, 'utf8'), archiveName);

  const extractRoot = path.join(STAGE_ROOT, 'node-runtime');
  expandArchive(archivePath, extractRoot);
  const extractedNodeRoot = findExtractedNodeRoot(extractRoot);
  fs.cpSync(extractedNodeRoot, RUNTIME_ROOT, { recursive: true });

  copyRequiredPaths();
  createLaunchers(nodeRelease.version);
  writePortableManifest(nodeRelease);
  compressDirectory(PORTABLE_ROOT, ZIP_OUTPUT_PATH);

  console.log(`Portable folder: ${PORTABLE_ROOT}`);
  console.log(`Portable zip: ${ZIP_OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

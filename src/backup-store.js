'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatTimestamp, slugify } = require('./format');

const BACKUP_ROOT_NAME = '__backups__';
const FILES_DIR_NAME = 'files';
const MANIFEST_FILE_NAME = 'manifest.json';

function getBackupRoot(sessionsDir) {
  return path.join(sessionsDir, BACKUP_ROOT_NAME);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function createBackupId(label) {
  const timestamp = formatTimestamp(new Date()).replace(/[-: ]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${timestamp}-${slugify(label)}-${suffix}`;
}

function createBackupSnapshot(sessionsDir, entries, metadata = {}) {
  const backupRoot = ensureDir(getBackupRoot(sessionsDir));
  const backupId = createBackupId(metadata.label || metadata.reason || 'migration');
  const backupDir = ensureDir(path.join(backupRoot, backupId));
  const filesDir = ensureDir(path.join(backupDir, FILES_DIR_NAME));
  const createdAt = new Date().toISOString();

  const manifest = {
    backupId,
    createdAt,
    sessionsDir,
    label: metadata.label || 'migration',
    reason: metadata.reason || null,
    sourceProvider: metadata.sourceProvider || null,
    targetProvider: metadata.targetProvider || null,
    notes: metadata.notes || null,
    entryCount: entries.length,
    entries: []
  };

  for (const entry of entries) {
    const relativePath = entry.relativePath;
    const sourcePath = entry.filePath;
    const backupRelativePath = relativePath.replace(/\\/g, '/');
    const destinationPath = path.join(filesDir, backupRelativePath);

    ensureDir(path.dirname(destinationPath));
    fs.copyFileSync(sourcePath, destinationPath);

    manifest.entries.push({
      id: entry.id || null,
      relativePath,
      backupRelativePath,
      provider: entry.provider || null,
      timestamp: entry.timestamp || null,
      cwd: entry.cwd || null
    });
  }

  fs.writeFileSync(
    path.join(backupDir, MANIFEST_FILE_NAME),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return {
    backupId,
    backupDir,
    filesDir,
    manifest
  };
}

function loadBackupManifest(backupDir) {
  const manifestPath = path.join(backupDir, MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found: ${manifestPath}`);
  }

  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function listBackupSnapshots(sessionsDir) {
  const backupRoot = getBackupRoot(sessionsDir);
  if (!fs.existsSync(backupRoot)) {
    return [];
  }

  const entries = fs.readdirSync(backupRoot, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const backupDir = path.join(backupRoot, entry.name);
    try {
      const manifest = loadBackupManifest(backupDir);
      results.push({
        backupId: manifest.backupId || entry.name,
        backupDir,
        createdAt: manifest.createdAt || '',
        label: manifest.label || 'migration',
        reason: manifest.reason || null,
        sourceProvider: manifest.sourceProvider || null,
        targetProvider: manifest.targetProvider || null,
        entryCount: manifest.entryCount || (manifest.entries ? manifest.entries.length : 0)
      });
    } catch (error) {
      const stat = fs.statSync(backupDir);
      results.push({
        backupId: entry.name,
        backupDir,
        createdAt: stat.mtime.toISOString(),
        label: 'legacy-backup',
        reason: error.message,
        sourceProvider: null,
        targetProvider: null,
        entryCount: 0
      });
    }
  }

  return results.sort((left, right) => {
    return String(right.createdAt).localeCompare(String(left.createdAt));
  });
}

module.exports = {
  BACKUP_ROOT_NAME,
  FILES_DIR_NAME,
  MANIFEST_FILE_NAME,
  createBackupSnapshot,
  getBackupRoot,
  listBackupSnapshots,
  loadBackupManifest
};

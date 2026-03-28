'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  getAllSessions,
  getSessionsDir,
  parseFirstLine,
  validateProviderName,
  validateSessionPath
} = require('./scanner');
const { createTranslator } = require('./i18n');
const {
  createBackupSnapshot,
  getBackupRoot,
  loadBackupManifest
} = require('./backup-store');
const {
  repairSessionIndexes,
  syncThreadProviderIndexes
} = require('./session-indexes');

function resolveTranslator(options = {}) {
  if (typeof options.t === 'function') {
    return {
      locale: options.locale || 'en',
      t: options.t
    };
  }

  return createTranslator(options.locale);
}

function normalizeSelection(selection) {
  if (Array.isArray(selection)) {
    return { filePaths: selection };
  }
  return selection && typeof selection === 'object' ? selection : {};
}

function mapSessionsByPath(items) {
  return new Map(items.map((item) => [path.resolve(item.filePath), item]));
}

function resolveSelectedSessions(sessionsDir, selection, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const normalizedSelection = normalizeSelection(selection);
  const { locale, t } = resolveTranslator(options);
  const allItems = getAllSessions(dir, {
    includePreview: Boolean(normalizedSelection.search),
    locale
  });
  const byPath = mapSessionsByPath(allItems);
  const hasExplicitSelection = (
    Array.isArray(normalizedSelection.filePaths) && normalizedSelection.filePaths.length > 0
  ) || (
    Array.isArray(normalizedSelection.ids) && normalizedSelection.ids.length > 0
  ) || Boolean(normalizedSelection.provider) || Boolean(normalizedSelection.search);

  let selected = allItems;

  if (Array.isArray(normalizedSelection.filePaths) && normalizedSelection.filePaths.length) {
    selected = normalizedSelection.filePaths.map((filePath) => {
      const resolved = validateSessionPath(filePath, dir, { t, locale });
      return byPath.get(resolved);
    }).filter(Boolean);
  } else if (Array.isArray(normalizedSelection.ids) && normalizedSelection.ids.length) {
    const idSet = new Set(normalizedSelection.ids.map((value) => String(value)));
    selected = allItems.filter((item) => idSet.has(item.id));
  } else {
    if (!hasExplicitSelection && !normalizedSelection.allowAll) {
      throw new Error(t('errors.fullLibraryRefused'));
    }

    if (normalizedSelection.provider && normalizedSelection.provider !== 'all') {
      selected = selected.filter((item) => item.provider === normalizedSelection.provider);
    }

    if (normalizedSelection.search) {
      const query = String(normalizedSelection.search).trim().toLowerCase();
      selected = selected.filter((item) => {
        return [item.id, item.provider, item.relativePath, item.cwd, item.preview || '']
          .some((value) => String(value || '').toLowerCase().includes(query));
      });
    }
  }

  const limit = normalizedSelection.limit ? Math.max(1, Number(normalizedSelection.limit)) : 0;
  return limit ? selected.slice(0, limit) : selected;
}

function readSessionFileParts(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^([^\n\r]*)(\r?\n)?([\s\S]*)$/);
  return {
    content,
    firstLine: match ? match[1] : '',
    newline: match ? (match[2] || '') : '',
    remainder: match ? match[3] : ''
  };
}

function rewriteProviderInFile(filePath, targetProvider, options = {}) {
  const { t } = resolveTranslator(options);
  const { firstLine, newline, remainder } = readSessionFileParts(filePath);
  if (!firstLine) {
    throw new Error(t('errors.sessionFileEmpty'));
  }

  let record;
  try {
    record = JSON.parse(firstLine);
  } catch {
    throw new Error(t('errors.firstLineInvalidJson'));
  }

  if (record.type !== 'session_meta' || !record.payload || typeof record.payload !== 'object') {
    throw new Error(t('errors.firstLineNotSessionMeta'));
  }

  const previousProvider = record.payload.model_provider || 'unknown';
  record.payload.model_provider = targetProvider;
  const nextContent = `${JSON.stringify(record)}${newline}${remainder}`;
  const tempPath = `${filePath}.tmp-${crypto.randomBytes(4).toString('hex')}`;

  fs.writeFileSync(tempPath, nextContent, 'utf8');
  fs.renameSync(tempPath, filePath);

  return previousProvider;
}

function buildPreview(items, targetProvider) {
  return items.map((item) => ({
    id: item.id,
    filePath: item.filePath,
    relativePath: item.relativePath,
    from: item.provider,
    to: targetProvider,
    skipped: item.provider === targetProvider
  }));
}

function previewMigration(sessionsDir, selection, targetProvider, options = {}) {
  const { locale, t } = resolveTranslator(options);
  const nextProvider = validateProviderName(targetProvider, { t, locale });
  const items = resolveSelectedSessions(sessionsDir, selection, { t, locale });
  const preview = buildPreview(items, nextProvider);

  return {
    sessionsDir: getSessionsDir(sessionsDir),
    targetProvider: nextProvider,
    totalSelected: items.length,
    actionable: preview.filter((item) => !item.skipped).length,
    skipped: preview.filter((item) => item.skipped).length,
    items: preview
  };
}

function migrateSessions(sessionsDir, selection, targetProvider, options = {}) {
  const { locale, t } = resolveTranslator(options);
  const nextProvider = validateProviderName(targetProvider, { t, locale });
  const dir = getSessionsDir(sessionsDir);
  const items = resolveSelectedSessions(dir, selection, { t, locale });
  const preview = buildPreview(items, nextProvider);
  const actionableItems = items.filter((item) => item.provider !== nextProvider);

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      sessionsDir: dir,
      targetProvider: nextProvider,
      selected: items.length,
      migrated: 0,
      skipped: preview.filter((item) => item.skipped).length,
      failed: 0,
      backupId: null,
      backupDir: null,
      results: preview.map((item) => ({
        relativePath: item.relativePath,
        filePath: item.filePath,
        from: item.from,
        to: item.to,
        ok: true,
        dryRun: true,
        skipped: item.skipped
      }))
    };
  }

  let backup = null;
  if (actionableItems.length) {
    const sourceProviders = new Set(actionableItems.map((item) => item.provider));
    backup = createBackupSnapshot(dir, actionableItems, {
      label: 'migration',
      reason: 'Pre-migration snapshot',
      sourceProvider: sourceProviders.size === 1 ? actionableItems[0].provider : 'mixed',
      targetProvider: nextProvider
    });
  }

  const results = [];

  for (const item of preview) {
    if (item.skipped) {
      results.push({
        relativePath: item.relativePath,
        filePath: item.filePath,
        from: item.from,
        to: item.to,
        ok: true,
        skipped: true
      });
      continue;
    }

    try {
      const previousProvider = rewriteProviderInFile(item.filePath, nextProvider, { t, locale });
      try {
        repairSessionIndexes(dir, {
          filePaths: [item.filePath]
        });
      } catch (error) {
        rewriteProviderInFile(item.filePath, previousProvider, { t, locale });
        try {
          repairSessionIndexes(dir, {
            filePaths: [item.filePath]
          });
        } catch {
        }
        throw error;
      }

      results.push({
        relativePath: item.relativePath,
        filePath: item.filePath,
        from: previousProvider,
        to: nextProvider,
        ok: true,
        skipped: false
      });
    } catch (error) {
      results.push({
        relativePath: item.relativePath,
        filePath: item.filePath,
        from: item.from,
        to: item.to,
        ok: false,
        skipped: false,
        error: error.message
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    dryRun: false,
    sessionsDir: dir,
    targetProvider: nextProvider,
    selected: items.length,
    migrated: results.filter((item) => item.ok && !item.skipped).length,
    skipped: results.filter((item) => item.skipped).length,
    failed: results.filter((item) => !item.ok).length,
    backupId: backup ? backup.backupId : null,
    backupDir: backup ? backup.backupDir : null,
    results
  };
}

function resolveBackupDir(backupDirOrId, sessionsDir, options = {}) {
  const { t } = resolveTranslator(options);
  const input = String(backupDirOrId || '').trim();
  if (!input) {
    throw new Error(t('errors.backupDirRequired'));
  }

  if (path.isAbsolute(input)) {
    return input;
  }

  return path.join(getBackupRoot(getSessionsDir(sessionsDir)), input);
}

function restoreFromBackup(backupDirOrId, sessionsDir, options = {}) {
  const { locale, t } = resolveTranslator(options);
  const dir = getSessionsDir(sessionsDir);
  const backupDir = resolveBackupDir(backupDirOrId, dir, { t, locale });
  const manifest = loadBackupManifest(backupDir, { locale, t });

  const liveEntries = manifest.entries.map((entry) => ({
    id: entry.id,
    relativePath: entry.relativePath,
    provider: entry.provider,
    timestamp: entry.timestamp,
    cwd: entry.cwd,
    filePath: path.join(dir, entry.relativePath)
  })).filter((entry) => fs.existsSync(entry.filePath));

  const preRestoreBackup = liveEntries.length
    ? createBackupSnapshot(dir, liveEntries, {
        label: 'pre-restore',
        reason: `Snapshot before restoring ${manifest.backupId || path.basename(backupDir)}`
      })
    : null;

  const results = [];

  for (const entry of manifest.entries) {
    const sourcePath = path.join(backupDir, 'files', entry.backupRelativePath || entry.relativePath);
    const destinationPath = path.join(dir, entry.relativePath);

    try {
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Backup file is missing: ${sourcePath}`);
      }

      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);
      const restoredMeta = parseFirstLine(destinationPath);
      if (restoredMeta && restoredMeta.model_provider) {
        repairSessionIndexes(dir, {
          filePaths: [destinationPath]
        });
      }

      results.push({
        relativePath: entry.relativePath,
        ok: true
      });
    } catch (error) {
      results.push({
        relativePath: entry.relativePath,
        ok: false,
        error: error.message
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    sessionsDir: dir,
    restoredFrom: backupDir,
    restoredBackupId: manifest.backupId || path.basename(backupDir),
    preRestoreBackupId: preRestoreBackup ? preRestoreBackup.backupId : null,
    preRestoreBackupDir: preRestoreBackup ? preRestoreBackup.backupDir : null,
    restored: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results
  };
}

module.exports = {
  migrateSessions,
  previewMigration,
  resolveSelectedSessions,
  restoreFromBackup,
  syncThreadProviderIndexes
};

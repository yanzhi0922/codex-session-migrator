'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  filterSessions,
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
const { syncDefaultModelProvider } = require('./config-utils');
const {
  repairSessionIndexes,
  syncThreadProviderIndexes
} = require('./session-indexes');

const DEFAULT_VISIBILITY_SOURCE = 'vscode';

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
    includePreview: Boolean(options.includePreview),
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

    selected = filterSessions(selected, {
      provider: normalizedSelection.provider,
      search: normalizedSelection.search
    });
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

function normalizeSourceValue(value) {
  if (value === undefined || value === null) {
    return 'unknown';
  }

  return typeof value === 'string' ? value.trim() || 'unknown' : JSON.stringify(value);
}

function normalizeTargetSource(value) {
  const normalized = String(value || '').trim();
  return normalized || DEFAULT_VISIBILITY_SOURCE;
}

function resolveNextSource(currentSource, targetSource, options = {}) {
  const previousSource = normalizeSourceValue(currentSource);
  const shouldRewrite = options.forceSource
    ? Boolean(targetSource) && previousSource !== targetSource
    : shouldNormalizeSource(currentSource, targetSource);

  return shouldRewrite ? targetSource : currentSource;
}

function isSubagentSource(value) {
  return value.startsWith('{') && value.includes('"subagent"');
}

function shouldNormalizeSource(currentSource, targetSource) {
  const normalizedSource = normalizeSourceValue(currentSource);
  if (!targetSource || normalizedSource === targetSource) {
    return false;
  }

  if (isSubagentSource(normalizedSource)) {
    return true;
  }

  return normalizedSource === 'unknown' || normalizedSource === 'exec' || normalizedSource === 'cli';
}

function needsVisibilityRewrite(item, targetProvider, targetSource) {
  return item.provider !== targetProvider || shouldNormalizeSource(item.source, targetSource);
}

function rewriteSessionMetaInFile(filePath, targetProvider, targetSource, options = {}) {
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
  const previousSource = normalizeSourceValue(record.payload.source);
  record.payload.model_provider = targetProvider;
  record.payload.source = resolveNextSource(record.payload.source, targetSource, {
    forceSource: options.forceSource
  });
  const nextContent = `${JSON.stringify(record)}${newline}${remainder}`;
  const tempPath = `${filePath}.tmp-${crypto.randomBytes(4).toString('hex')}`;

  fs.writeFileSync(tempPath, nextContent, 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    const isLockedReplaceError = error && (
      error.code === 'EPERM' ||
      error.code === 'EBUSY'
    );

    if (!isLockedReplaceError) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
      }
      throw error;
    }

    try {
      fs.writeFileSync(filePath, nextContent, 'utf8');
      fs.unlinkSync(tempPath);
    } catch (fallbackError) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
      }
      throw fallbackError;
    }
  }

  return {
    previousProvider,
    previousSource
  };
}

function buildPreview(items, targetProvider, targetSource) {
  return items.map((item) => ({
    id: item.id,
    filePath: item.filePath,
    relativePath: item.relativePath,
    timestamp: item.timestamp,
    timestampDisplay: item.timestampDisplay,
    cwd: item.cwd || '',
    preview: item.preview || null,
    from: item.provider,
    fromSource: normalizeSourceValue(item.source),
    to: targetProvider,
    toSource: normalizeSourceValue(resolveNextSource(item.source, targetSource)),
    skipped: !needsVisibilityRewrite(item, targetProvider, targetSource)
  }));
}

function previewMigration(sessionsDir, selection, targetProvider, options = {}) {
  const { locale, t } = resolveTranslator(options);
  const nextProvider = validateProviderName(targetProvider, { t, locale });
  const nextSource = normalizeTargetSource(options.targetSource);
  const items = resolveSelectedSessions(sessionsDir, selection, {
    includePreview: true,
    t,
    locale
  });
  const preview = buildPreview(items, nextProvider, nextSource);

  return {
    sessionsDir: getSessionsDir(sessionsDir),
    targetProvider: nextProvider,
    targetSource: nextSource,
    totalSelected: items.length,
    actionable: preview.filter((item) => !item.skipped).length,
    skipped: preview.filter((item) => item.skipped).length,
    items: preview
  };
}

function migrateSessions(sessionsDir, selection, targetProvider, options = {}) {
  const { locale, t } = resolveTranslator(options);
  const nextProvider = validateProviderName(targetProvider, { t, locale });
  const nextSource = normalizeTargetSource(options.targetSource);
  const dir = getSessionsDir(sessionsDir);
  const items = resolveSelectedSessions(dir, selection, { t, locale });
  const preview = buildPreview(items, nextProvider, nextSource);
  const actionableItems = items.filter((item) => needsVisibilityRewrite(item, nextProvider, nextSource));

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      sessionsDir: dir,
      targetProvider: nextProvider,
      targetSource: nextSource,
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
        fromSource: item.fromSource,
        to: item.to,
        toSource: item.toSource,
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

  const rewrittenItems = [];
  const resultsByPath = new Map();

  function setResult(item, overrides) {
    resultsByPath.set(path.resolve(item.filePath), {
      id: item.id,
      relativePath: item.relativePath,
      filePath: item.filePath,
      from: item.from,
      fromSource: item.fromSource,
      to: item.to,
      toSource: item.toSource,
      ...overrides
    });
  }

  for (const item of preview) {
    if (item.skipped) {
      setResult(item, {
        ok: true,
        skipped: true
      });
      continue;
    }

    try {
      const { previousProvider, previousSource } = rewriteSessionMetaInFile(
        item.filePath,
        nextProvider,
        nextSource,
        { t, locale }
      );
      rewrittenItems.push({
        item,
        previousProvider,
        previousSource
      });
    } catch (error) {
      setResult(item, {
        ok: false,
        skipped: false,
        error: error.message
      });
    }
  }

  if (rewrittenItems.length) {
    const rewrittenPaths = rewrittenItems.map(({ item }) => item.filePath);

    try {
      const repair = repairSessionIndexes(dir, {
        filePaths: rewrittenPaths,
        repairSessionIndex: true
      });
      const repairFailures = new Map(
        repair.results
          .filter((entry) => !entry.ok)
          .map((entry) => [path.resolve(entry.filePath), entry.error || 'Index repair failed.'])
      );

      if (repairFailures.size) {
        for (const { item, previousProvider, previousSource } of rewrittenItems) {
          if (!repairFailures.has(path.resolve(item.filePath))) {
            continue;
          }
          rewriteSessionMetaInFile(item.filePath, previousProvider, previousSource, {
            t,
            locale,
            forceSource: true
          });
        }

        try {
          repairSessionIndexes(dir, {
            filePaths: rewrittenPaths,
            repairSessionIndex: true
          });
        } catch {
        }
      }

      for (const { item, previousProvider, previousSource } of rewrittenItems) {
        const repairError = repairFailures.get(path.resolve(item.filePath));
        setResult(item, {
          from: previousProvider,
          fromSource: previousSource,
          ok: !repairError,
          skipped: false,
          ...(repairError ? { error: repairError } : {})
        });
      }
    } catch (error) {
      for (const { item, previousProvider, previousSource } of rewrittenItems) {
        try {
          rewriteSessionMetaInFile(item.filePath, previousProvider, previousSource, {
            t,
            locale,
            forceSource: true
          });
        } catch {
        }

        setResult(item, {
          from: previousProvider,
          fromSource: previousSource,
          ok: false,
          skipped: false,
          error: error.message
        });
      }

      try {
        repairSessionIndexes(dir, {
          filePaths: rewrittenPaths,
          repairSessionIndex: true
        });
      } catch {
      }
    }
  }

  const results = preview.map((item) => {
    return resultsByPath.get(path.resolve(item.filePath)) || {
      id: item.id,
      relativePath: item.relativePath,
      filePath: item.filePath,
      from: item.from,
      to: item.to,
      ok: false,
      skipped: false,
      error: 'Migration result could not be resolved.'
    };
  });

  let configSync = null;
  if (
    results.some((item) => item.ok && !item.skipped) &&
    nextSource === DEFAULT_VISIBILITY_SOURCE &&
    options.syncDefaultProvider !== false
  ) {
    try {
      configSync = syncDefaultModelProvider(dir, nextProvider);
    } catch (error) {
      configSync = {
        ok: false,
        changed: false,
        skipped: false,
        error: error.message
      };
    }
  }

  return {
    ok: results.every((item) => item.ok),
    dryRun: false,
    sessionsDir: dir,
    targetProvider: nextProvider,
    targetSource: nextSource,
    selected: items.length,
    migrated: results.filter((item) => item.ok && !item.skipped).length,
    skipped: results.filter((item) => item.skipped).length,
    failed: results.filter((item) => !item.ok).length,
    backupId: backup ? backup.backupId : null,
    backupDir: backup ? backup.backupDir : null,
    configSync,
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
  const restoredPaths = [];

  for (const entry of manifest.entries) {
    const sourcePath = path.join(backupDir, 'files', entry.backupRelativePath || entry.relativePath);
    const destinationPath = path.join(dir, entry.relativePath);

    try {
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Backup file is missing: ${sourcePath}`);
      }

      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);
      restoredPaths.push(destinationPath);

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

  if (restoredPaths.length) {
    try {
      const repair = repairSessionIndexes(dir, {
        filePaths: restoredPaths,
        repairSessionIndex: true
      });
      const repairFailures = new Map(
        repair.results
          .filter((entry) => !entry.ok)
          .map((entry) => [path.resolve(entry.filePath), entry.error || 'Index repair failed.'])
      );

      if (repairFailures.size) {
        for (const item of results) {
          const destinationPath = path.join(dir, item.relativePath);
          const repairError = repairFailures.get(path.resolve(destinationPath));
          if (!repairError) {
            continue;
          }

          item.ok = false;
          item.error = repairError;
        }
      }
    } catch (error) {
      for (const item of results) {
        if (!item.ok) {
          continue;
        }
        item.ok = false;
        item.error = error.message;
      }
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

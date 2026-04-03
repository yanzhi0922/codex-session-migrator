'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { formatBytesDisplay, formatDisplayTimestamp } = require('./format');
const { createTranslator } = require('./i18n');
const { listBackupSnapshots, BACKUP_ROOT_NAME } = require('./backup-store');
const { getDefaultProviderAlignment } = require('./config-utils');
const { getIndexHealth } = require('./session-indexes');
const {
  extractUserInputText,
  sanitizeUserPrompt,
  summarizePrompt
} = require('./prompt-utils');

const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const MAX_FIRST_LINE_BYTES = 256 * 1024;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_RECENT_PROMPTS = 3;
const MAX_DETAIL_PROMPTS = 5;
const MAX_RECENT_PROMPT_BYTES = 2 * 1024 * 1024;
const MAX_TAIL_INSIGHT_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_CACHE_ENTRIES = 5000;
const PROVIDER_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const SESSION_META_CACHE = new Map();
const SESSION_TAIL_CACHE = new Map();
function resolveTranslator(options = {}) {
  if (typeof options.t === 'function') {
    return {
      locale: options.locale || 'en',
      t: options.t
    };
  }

  return createTranslator(options.locale);
}

function getSessionsDir(cliDir) {
  return path.resolve(cliDir || process.env.CODEX_SESSIONS_DIR || DEFAULT_SESSIONS_DIR);
}

function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function getFileSignature(filePath, stat = null) {
  const fileStat = stat || statSafe(filePath);
  if (!fileStat) {
    return null;
  }

  return `${path.resolve(filePath)}::${fileStat.size}:${fileStat.mtimeMs}`;
}

function readCacheValue(cache, filePath, stat = null) {
  const signature = getFileSignature(filePath, stat);
  if (!signature) {
    return undefined;
  }

  const entry = cache.get(path.resolve(filePath));
  if (!entry || entry.signature !== signature) {
    return undefined;
  }

  return entry.value;
}

function writeCacheValue(cache, filePath, value, stat = null) {
  const signature = getFileSignature(filePath, stat);
  if (!signature) {
    return value;
  }

  if (cache.size >= MAX_SESSION_CACHE_ENTRIES) {
    cache.clear();
  }

  cache.set(path.resolve(filePath), {
    signature,
    value
  });

  return value;
}

function readChunk(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(size);
    const bytesRead = fs.readSync(fd, buffer, 0, size, 0);
    return buffer.slice(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readTailChunk(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - size);
    const buffer = Buffer.alloc(size);
    const bytesRead = fs.readSync(fd, buffer, 0, size, start);

    return {
      chunk: buffer.slice(0, bytesRead).toString('utf8'),
      truncatedStart: start > 0
    };
  } finally {
    fs.closeSync(fd);
  }
}

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseFirstLine(filePath) {
  const stat = statSafe(filePath);
  const cached = readCacheValue(SESSION_META_CACHE, filePath, stat);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const chunk = readChunk(filePath, MAX_FIRST_LINE_BYTES);
    const [firstLine] = chunk.split(/\r?\n/, 1);
    if (!firstLine || !firstLine.trim()) {
      return writeCacheValue(SESSION_META_CACHE, filePath, null, stat);
    }

    const record = JSON.parse(firstLine);
    if (record.type !== 'session_meta' || !record.payload || typeof record.payload !== 'object') {
      return writeCacheValue(SESSION_META_CACHE, filePath, null, stat);
    }

    return writeCacheValue(SESSION_META_CACHE, filePath, record.payload, stat);
  } catch {
    return writeCacheValue(SESSION_META_CACHE, filePath, null, stat);
  }
}

function extractTailInsights(filePath, options = {}) {
  const stat = statSafe(filePath);
  const cached = readCacheValue(SESSION_TAIL_CACHE, filePath, stat);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const { chunk, truncatedStart } = readTailChunk(
      filePath,
      options.maxBytes || MAX_TAIL_INSIGHT_BYTES
    );
    const lines = chunk.split(/\r?\n/);
    const prompts = [];
    const seenPrompts = new Set();
    let latestCwd = '';
    let latestModel = '';
    let latestTimestamp = '';

    if (truncatedStart && lines.length) {
      lines.shift();
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line) {
        continue;
      }

      const record = tryParseJsonLine(line);
      if (!record) {
        continue;
      }

      if (
        !latestCwd &&
        record.type === 'turn_context' &&
        record.payload &&
        typeof record.payload === 'object' &&
        typeof record.payload.cwd === 'string' &&
        record.payload.cwd.trim()
      ) {
        latestCwd = record.payload.cwd;
      }

      if (
        !latestModel &&
        record.type === 'turn_context' &&
        record.payload &&
        typeof record.payload === 'object' &&
        typeof record.payload.model === 'string' &&
        record.payload.model.trim()
      ) {
        latestModel = record.payload.model;
      }

      if (!latestTimestamp && typeof record.timestamp === 'string' && record.timestamp.trim()) {
        latestTimestamp = record.timestamp;
      }

      const rawPrompt = extractUserInputText(record);
      const cleanedPrompt = sanitizeUserPrompt(rawPrompt);

      if (cleanedPrompt && !seenPrompts.has(cleanedPrompt)) {
        seenPrompts.add(cleanedPrompt);
        prompts.push(cleanedPrompt);
      }

      if (
        prompts.length >= MAX_DETAIL_PROMPTS &&
        latestCwd &&
        latestModel &&
        latestTimestamp
      ) {
        break;
      }
    }

    return writeCacheValue(SESSION_TAIL_CACHE, filePath, {
      recentPrompts: prompts,
      latestCwd,
      latestModel,
      latestTimestamp
    }, stat);
  } catch {
    return {
      recentPrompts: [],
      latestCwd: '',
      latestModel: '',
      latestTimestamp: ''
    };
  }
}

function extractRecentUserPrompts(filePath, options = {}) {
  const limit = Math.max(1, Number(options.limit) || MAX_RECENT_PROMPTS);
  return extractTailInsights(filePath, options).recentPrompts.slice(0, limit);
}

function normalizeSessionRecord(filePath, sessionsDir, meta, options = {}) {
  const stat = statSafe(filePath);
  const relativePath = path.relative(sessionsDir, filePath);
  const includePreview = Boolean(options.includePreview);
  const includeContext = Boolean(options.includeContext);
  const tailInsights = (includePreview || includeContext || !meta.cwd)
    ? extractTailInsights(filePath, {
        maxBytes: options.maxBytes || MAX_TAIL_INSIGHT_BYTES
      })
    : null;
  const provider = meta.model_provider || 'unknown';
  const source = meta.source === undefined || meta.source === null
    ? 'unknown'
    : (typeof meta.source === 'string' ? meta.source : JSON.stringify(meta.source));
  const timestamp = tailInsights?.latestTimestamp || meta.timestamp || '';
  const recentPrompts = includePreview
    ? (tailInsights?.recentPrompts || []).slice(0, options.previewPromptLimit || MAX_RECENT_PROMPTS)
    : [];
  const preview = recentPrompts.length ? summarizePrompt(recentPrompts[0]) : null;
  const locale = options.locale || 'en';
  const cwd = tailInsights?.latestCwd || meta.cwd || '';

  return {
    id: meta.id || relativePath,
    filePath,
    relativePath,
    provider,
    source,
    timestamp,
    timestampDisplay: formatDisplayTimestamp(timestamp, locale),
    cwd,
    originator: meta.originator || '',
    cliVersion: meta.cli_version || '',
    preview,
    recentPrompts,
    size: stat ? stat.size : 0,
    sizeDisplay: formatBytesDisplay(stat ? stat.size : 0, locale)
  };
}

function enrichSessionRecordWithPreview(item, options = {}) {
  if (!item || !item.filePath) {
    return item;
  }

  const previewPromptLimit = Math.max(1, Number(options.previewPromptLimit) || MAX_RECENT_PROMPTS);
  const locale = options.locale || 'en';
  const tailInsights = extractTailInsights(item.filePath, {
    maxBytes: options.maxBytes || MAX_TAIL_INSIGHT_BYTES
  });
  const recentPrompts = (tailInsights.recentPrompts || []).slice(0, previewPromptLimit);

  item.timestamp = tailInsights.latestTimestamp || item.timestamp || '';
  item.timestampDisplay = formatDisplayTimestamp(item.timestamp, locale);
  item.cwd = tailInsights.latestCwd || item.cwd || '';
  item.preview = recentPrompts.length ? summarizePrompt(recentPrompts[0]) : null;
  item.recentPrompts = recentPrompts;

  return item;
}

function walkSessionFiles(sessionsDir, onFile) {
  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) {
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === BACKUP_ROOT_NAME || entry.name.startsWith('__backup_')) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        onFile(fullPath);
      }
    }
  }

  walk(sessionsDir);
}

function getAllSessions(sessionsDir, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const items = [];

  walkSessionFiles(dir, (filePath) => {
    const meta = parseFirstLine(filePath);
    if (!meta) {
      return;
    }

    items.push(normalizeSessionRecord(filePath, dir, meta, options));
  });

  items.sort((left, right) => {
    const byTimestamp = String(right.timestamp).localeCompare(String(left.timestamp));
    return byTimestamp || left.relativePath.localeCompare(right.relativePath);
  });

  return items;
}

function filterSessions(items, { provider, search } = {}) {
  const normalizedProvider = provider && provider !== 'all' ? String(provider).trim() : '';
  const query = String(search || '').trim().toLowerCase();

  return items.filter((item) => {
    if (normalizedProvider && item.provider !== normalizedProvider) {
      return false;
    }

    if (!query) {
      return true;
    }

    const baseHaystacks = [
      item.id,
      item.provider,
      item.relativePath,
      item.cwd
    ];

    if (baseHaystacks.some((value) => String(value || '').toLowerCase().includes(query))) {
      return true;
    }

    const tailInsights = extractTailInsights(item.filePath, {
      maxBytes: MAX_TAIL_INSIGHT_BYTES
    });
    const promptHaystacks = (tailInsights.recentPrompts || []).slice(0, MAX_DETAIL_PROMPTS);

    return promptHaystacks.some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function summarizeProviders(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item.provider, (counts.get(item.provider) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, count }));
}

function paginate(items, { page = 1, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const safePage = Math.max(1, Number(page) || 1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const start = (safePage - 1) * safeLimit;

  return {
    items: items.slice(start, start + safeLimit),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages
  };
}

function buildSessionsPayloadFromAllItems(sessionsDir, allItems, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const { locale } = resolveTranslator(options);
  const includePreview = Boolean(options.search || options.includePreview);
  const filtered = filterSessions(allItems, options);
  const paginated = paginate(filtered, options);
  const items = includePreview
    ? paginated.items.map((item) => enrichSessionRecordWithPreview(item, {
        previewPromptLimit: options.previewPromptLimit || MAX_RECENT_PROMPTS,
        locale
      }))
    : paginated.items;

  return {
    sessionsDir: dir,
    providers: summarizeProviders(allItems),
    totals: {
      all: allItems.length,
      filtered: filtered.length
    },
    ...paginated,
    items
  };
}

function buildOverviewFromItems(sessionsDir, items, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const { locale } = resolveTranslator(options);
  const providers = summarizeProviders(items);
  const backups = listBackupSnapshots(dir);
  const bytes = items.reduce((sum, item) => sum + item.size, 0);

  return {
    sessionsDir: dir,
    totals: {
      sessions: items.length,
      providers: providers.length,
      backups: backups.length,
      bytes,
      bytesDisplay: formatBytesDisplay(bytes, locale)
    },
    providers,
    latestSessionAt: items.length ? items[0].timestamp : null,
    latestSessionAtDisplay: items.length ? items[0].timestampDisplay : '',
    backups: backups.slice(0, 5)
  };
}

function scanSessions(sessionsDir, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const { locale } = resolveTranslator(options);
  const allItems = getAllSessions(dir, { locale });
  return buildSessionsPayloadFromAllItems(dir, allItems, options);
}

function getProviders(sessionsDir) {
  return summarizeProviders(getAllSessions(sessionsDir));
}

function getOverview(sessionsDir, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const { locale } = resolveTranslator(options);
  const items = getAllSessions(dir, { locale });
  return buildOverviewFromItems(dir, items, { locale });
}

function getDashboardData(sessionsDir, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const { locale, t } = resolveTranslator(options);
  const allItems = getAllSessions(dir, { locale });

  return {
    overview: buildOverviewFromItems(dir, allItems, { locale }),
    sessions: buildSessionsPayloadFromAllItems(dir, allItems, options),
    backups: options.includeBackups === false ? [] : listBackups(dir, { locale }),
    doctor: options.includeDoctor === false ? null : runDoctor(dir, { locale, t })
  };
}

function getSessionDetail(filePath, sessionsDir, options = {}) {
  const validatedPath = validateSessionPath(filePath, sessionsDir, options);
  const meta = parseFirstLine(validatedPath);
  if (!meta) {
    return null;
  }

  const locale = resolveTranslator(options).locale;

  return enrichSessionRecordWithPreview(
    normalizeSessionRecord(validatedPath, getSessionsDir(sessionsDir), meta, {
      locale
    }),
    {
      previewPromptLimit: options.previewPromptLimit || MAX_DETAIL_PROMPTS,
      locale
    }
  );
}

function listBackups(sessionsDir, options = {}) {
  const { locale } = resolveTranslator(options);

  return listBackupSnapshots(getSessionsDir(sessionsDir)).map((backup) => ({
    ...backup,
    createdAtDisplay: formatDisplayTimestamp(backup.createdAt, locale)
  }));
}

function validateSessionPath(filePath, sessionsDir, options = {}) {
  const { t } = resolveTranslator(options);

  if (!filePath) {
    throw new Error(t('errors.sessionFilePathRequired'));
  }

  const root = getSessionsDir(sessionsDir);
  const resolved = path.resolve(filePath);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, resolved);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(t('errors.pathOutsideSessionsDir', { path: filePath }));
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(t('errors.sessionFileNotFound', { path: filePath }));
  }

  return resolved;
}

function validateProviderName(value, options = {}) {
  const { t } = resolveTranslator(options);
  const provider = String(value || '').trim();
  if (!provider) {
    throw new Error(t('errors.providerNameRequired'));
  }
  if (!PROVIDER_PATTERN.test(provider)) {
    throw new Error(t('errors.providerNameInvalid'));
  }
  return provider;
}

function runDoctor(sessionsDir, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const { locale, t } = resolveTranslator(options);
  const issues = [];
  const ids = new Map();
  const vscodeProviderCounts = new Map();
  let totalFiles = 0;
  let invalidMetaCount = 0;
  let missingProviderCount = 0;
  let missingWorkspaceCount = 0;
  let oldestTimestamp = null;
  let latestTimestamp = null;

  walkSessionFiles(dir, (filePath) => {
    totalFiles += 1;
    const meta = parseFirstLine(filePath);
    const relativePath = path.relative(dir, filePath);

    if (!meta) {
      invalidMetaCount += 1;
      issues.push({
        severity: 'error',
        type: 'invalid_meta',
        relativePath,
        message: t('doctor.invalidMeta')
      });
      return;
    }

    if (!meta.model_provider) {
      missingProviderCount += 1;
      issues.push({
        severity: 'warning',
        type: 'missing_provider',
        relativePath,
        message: t('doctor.missingProvider')
      });
    }

    const source = meta.source === undefined || meta.source === null
      ? 'unknown'
      : (typeof meta.source === 'string' ? meta.source : JSON.stringify(meta.source));
    if (source === 'vscode' && meta.model_provider) {
      vscodeProviderCounts.set(
        meta.model_provider,
        (vscodeProviderCounts.get(meta.model_provider) || 0) + 1
      );
    }

    const workspace = String(meta.cwd || '').trim() || extractTailInsights(filePath).latestCwd || '';
    if (!String(workspace).trim()) {
      missingWorkspaceCount += 1;
      issues.push({
        severity: 'warning',
        type: 'missing_workspace',
        relativePath,
        message: t('doctor.missingWorkspace')
      });
    }

    if (meta.id) {
      const existing = ids.get(meta.id);
      if (existing) {
        issues.push({
          severity: 'warning',
          type: 'duplicate_id',
          relativePath,
          message: t('doctor.duplicateId', { path: existing })
        });
      } else {
        ids.set(meta.id, relativePath);
      }
    }

    if (meta.timestamp) {
      if (!oldestTimestamp || String(meta.timestamp) < String(oldestTimestamp)) {
        oldestTimestamp = meta.timestamp;
      }
      if (!latestTimestamp || String(meta.timestamp) > String(latestTimestamp)) {
        latestTimestamp = meta.timestamp;
      }
    }
  });

  const indexHealth = getIndexHealth(dir, {
    includeSessionIndex: true,
    t
  });
  issues.push(...indexHealth.issues);
  const providerCounts = Array.from(vscodeProviderCounts.entries()).map(([name, count]) => ({ name, count }));
  const providerAlignment = getDefaultProviderAlignment(dir, providerCounts);
  let defaultProviderMismatchCount = 0;
  let missingDefaultProviderConfigCount = 0;

  if (providerAlignment.mismatch) {
    defaultProviderMismatchCount += 1;
    issues.push({
      severity: 'warning',
      type: 'default_provider_mismatch',
      relativePath: path.relative(path.dirname(dir), providerAlignment.configPath),
      message: t('doctor.defaultProviderMismatch', {
        configProvider: providerAlignment.defaultProvider,
        activeProvider: providerAlignment.dominantProvider,
        activeCount: providerAlignment.dominantProviderCount
      })
    });
  }

  if (providerAlignment.exists && providerAlignment.missingProviderSection) {
    missingDefaultProviderConfigCount += 1;
    issues.push({
      severity: 'warning',
      type: 'missing_default_provider_config',
      relativePath: path.relative(path.dirname(dir), providerAlignment.configPath),
      message: t('doctor.missingDefaultProviderConfig', {
        configProvider: providerAlignment.defaultProvider
      })
    });
  }

  return {
    ok: (
      !issues.some((issue) => issue.severity === 'error') &&
      indexHealth.missingThreadCount === 0 &&
      indexHealth.providerMismatchCount === 0 &&
      indexHealth.missingSessionIndexCount === 0
    ),
    sessionsDir: dir,
    summary: {
      totalFiles,
      invalidMetaCount,
      missingProviderCount,
      missingWorkspaceCount,
      workspaceReadyCount: Math.max(0, totalFiles - invalidMetaCount - missingWorkspaceCount),
      duplicateIdCount: issues.filter((issue) => issue.type === 'duplicate_id').length,
      missingThreadCount: indexHealth.missingThreadCount,
      providerMismatchCount: indexHealth.providerMismatchCount,
      missingSessionIndexCount: indexHealth.missingSessionIndexCount,
      defaultProviderMismatchCount,
      missingDefaultProviderConfigCount,
      stateDatabaseCount: indexHealth.stateDatabaseCount,
      backupCount: listBackupSnapshots(dir).length,
      oldestTimestamp,
      oldestTimestampDisplay: formatDisplayTimestamp(oldestTimestamp, locale),
      latestTimestamp,
      latestTimestampDisplay: formatDisplayTimestamp(latestTimestamp, locale)
    },
    issues
  };
}

module.exports = {
  DEFAULT_SESSIONS_DIR,
  extractTailInsights,
  extractRecentUserPrompts,
  extractUserInputText,
  filterSessions,
  getAllSessions,
  getDashboardData,
  getOverview,
  getProviders,
  getSessionDetail,
  getSessionsDir,
  listBackups,
  parseFirstLine,
  runDoctor,
  sanitizeUserPrompt,
  scanSessions,
  summarizePrompt,
  validateProviderName,
  validateSessionPath,
  walkSessionFiles
};

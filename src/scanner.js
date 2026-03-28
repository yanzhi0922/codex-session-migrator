'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { formatBytes, formatTimestamp } = require('./format');
const { listBackupSnapshots, BACKUP_ROOT_NAME } = require('./backup-store');

const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const MAX_FIRST_LINE_BYTES = 256 * 1024;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const PROVIDER_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

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

function parseFirstLine(filePath) {
  try {
    const chunk = readChunk(filePath, MAX_FIRST_LINE_BYTES);
    const [firstLine] = chunk.split(/\r?\n/, 1);
    if (!firstLine || !firstLine.trim()) {
      return null;
    }

    const record = JSON.parse(firstLine);
    if (record.type !== 'session_meta' || !record.payload || typeof record.payload !== 'object') {
      return null;
    }

    return record.payload;
  } catch {
    return null;
  }
}

function extractFirstUserMessage(filePath) {
  try {
    const chunk = readChunk(filePath, MAX_PREVIEW_BYTES);
    const lines = chunk.split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      const payload = record && record.payload;
      if (record.type !== 'response_item' || !payload || payload.role !== 'user' || !Array.isArray(payload.content)) {
        continue;
      }

      const parts = payload.content
        .filter((item) => item && item.type === 'input_text' && typeof item.text === 'string')
        .map((item) => item.text.trim())
        .filter(Boolean);

      if (parts.length) {
        const preview = parts.join(' ').replace(/\s+/g, ' ').trim();
        return preview.length > 220 ? `${preview.slice(0, 217)}...` : preview;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeSessionRecord(filePath, sessionsDir, meta, options = {}) {
  const stat = statSafe(filePath);
  const relativePath = path.relative(sessionsDir, filePath);
  const provider = meta.model_provider || 'unknown';
  const timestamp = meta.timestamp || '';
  const preview = options.includePreview ? extractFirstUserMessage(filePath) : null;

  return {
    id: meta.id || relativePath,
    filePath,
    relativePath,
    provider,
    timestamp,
    timestampDisplay: formatTimestamp(timestamp),
    cwd: meta.cwd || '',
    originator: meta.originator || '',
    cliVersion: meta.cli_version || '',
    preview,
    size: stat ? stat.size : 0,
    sizeDisplay: formatBytes(stat ? stat.size : 0)
  };
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

    const haystacks = [
      item.id,
      item.provider,
      item.relativePath,
      item.cwd,
      item.preview || ''
    ];

    return haystacks.some((value) => String(value || '').toLowerCase().includes(query));
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

function scanSessions(sessionsDir, options = {}) {
  const dir = getSessionsDir(sessionsDir);
  const includePreview = Boolean(options.search || options.includePreview);
  const allItems = getAllSessions(dir, { includePreview });
  const filtered = filterSessions(allItems, options);
  const paginated = paginate(filtered, options);

  return {
    sessionsDir: dir,
    providers: summarizeProviders(allItems),
    totals: {
      all: allItems.length,
      filtered: filtered.length
    },
    ...paginated
  };
}

function getProviders(sessionsDir) {
  return summarizeProviders(getAllSessions(sessionsDir));
}

function getOverview(sessionsDir) {
  const dir = getSessionsDir(sessionsDir);
  const items = getAllSessions(dir);
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
      bytesDisplay: formatBytes(bytes)
    },
    providers,
    latestSessionAt: items.length ? items[0].timestamp : null,
    latestSessionAtDisplay: items.length ? items[0].timestampDisplay : '',
    backups: backups.slice(0, 5)
  };
}

function getSessionDetail(filePath, sessionsDir) {
  const validatedPath = validateSessionPath(filePath, sessionsDir);
  const meta = parseFirstLine(validatedPath);
  if (!meta) {
    return null;
  }

  return normalizeSessionRecord(validatedPath, getSessionsDir(sessionsDir), meta, { includePreview: true });
}

function listBackups(sessionsDir) {
  return listBackupSnapshots(getSessionsDir(sessionsDir));
}

function validateSessionPath(filePath, sessionsDir) {
  if (!filePath) {
    throw new Error('Session file path is required.');
  }

  const root = getSessionsDir(sessionsDir);
  const resolved = path.resolve(filePath);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, resolved);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the sessions directory: ${filePath}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Session file not found: ${filePath}`);
  }

  return resolved;
}

function validateProviderName(value) {
  const provider = String(value || '').trim();
  if (!provider) {
    throw new Error('Provider name is required.');
  }
  if (!PROVIDER_PATTERN.test(provider)) {
    throw new Error('Provider name may only contain letters, numbers, dot, underscore, or dash.');
  }
  return provider;
}

function runDoctor(sessionsDir) {
  const dir = getSessionsDir(sessionsDir);
  const issues = [];
  const ids = new Map();
  let totalFiles = 0;
  let invalidMetaCount = 0;
  let missingProviderCount = 0;
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
        message: 'The first JSONL line is missing or cannot be parsed as session_meta.'
      });
      return;
    }

    if (!meta.model_provider) {
      missingProviderCount += 1;
      issues.push({
        severity: 'warning',
        type: 'missing_provider',
        relativePath,
        message: 'The session_meta payload does not contain model_provider.'
      });
    }

    if (meta.id) {
      const existing = ids.get(meta.id);
      if (existing) {
        issues.push({
          severity: 'warning',
          type: 'duplicate_id',
          relativePath,
          message: `Duplicate session id detected. First seen at ${existing}.`
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

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    sessionsDir: dir,
    summary: {
      totalFiles,
      invalidMetaCount,
      missingProviderCount,
      duplicateIdCount: issues.filter((issue) => issue.type === 'duplicate_id').length,
      backupCount: listBackupSnapshots(dir).length,
      oldestTimestamp,
      oldestTimestampDisplay: formatTimestamp(oldestTimestamp),
      latestTimestamp,
      latestTimestampDisplay: formatTimestamp(latestTimestamp)
    },
    issues
  };
}

module.exports = {
  DEFAULT_SESSIONS_DIR,
  extractFirstUserMessage,
  getAllSessions,
  getOverview,
  getProviders,
  getSessionDetail,
  getSessionsDir,
  listBackups,
  parseFirstLine,
  runDoctor,
  scanSessions,
  validateProviderName,
  validateSessionPath,
  walkSessionFiles
};

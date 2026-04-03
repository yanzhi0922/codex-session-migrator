'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildFallbackThreadTitle,
  extractUserInputText,
  isThreadTitlePlaceholder,
  sanitizeUserPrompt,
  summarizeThreadTitle
} = require('./prompt-utils');

const STATE_DB_PATTERN = /^state_.*\.sqlite$/i;
const SESSION_INDEX_FILENAME = 'session_index.jsonl';
const ARCHIVED_SESSIONS_DIRNAME = 'archived_sessions';
const THREAD_FIELD_MAP = {
  id: 'id',
  rolloutPath: 'rollout_path',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  source: 'source',
  modelProvider: 'model_provider',
  cwd: 'cwd',
  title: 'title',
  sandboxPolicy: 'sandbox_policy',
  approvalMode: 'approval_mode',
  tokensUsed: 'tokens_used',
  hasUserEvent: 'has_user_event',
  archived: 'archived',
  archivedAt: 'archived_at',
  gitSha: 'git_sha',
  gitBranch: 'git_branch',
  gitOriginUrl: 'git_origin_url',
  cliVersion: 'cli_version',
  firstUserMessage: 'first_user_message',
  agentNickname: 'agent_nickname',
  agentRole: 'agent_role',
  memoryMode: 'memory_mode',
  model: 'model',
  reasoningEffort: 'reasoning_effort',
  agentPath: 'agent_path'
};

let nodeSqliteModule = null;
let didAttemptNodeSqliteLoad = false;

function loadNodeSqliteModule() {
  if (!didAttemptNodeSqliteLoad) {
    didAttemptNodeSqliteLoad = true;
    try {
      nodeSqliteModule = require('node:sqlite');
    } catch {
      nodeSqliteModule = null;
    }
  }

  return nodeSqliteModule;
}

function escapeSqliteLiteral(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function getCodexRoot(sessionsDir) {
  return path.dirname(path.resolve(sessionsDir));
}

function listStateDatabasePaths(sessionsDir) {
  const codexRoot = getCodexRoot(sessionsDir);
  if (!fs.existsSync(codexRoot)) {
    return [];
  }

  return fs.readdirSync(codexRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && STATE_DB_PATTERN.test(entry.name))
    .map((entry) => path.join(codexRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function getSessionIndexPath(sessionsDir) {
  return path.join(getCodexRoot(sessionsDir), SESSION_INDEX_FILENAME);
}

function isPathInside(parentDir, candidatePath) {
  const relativePath = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getDisplayRelativePath(filePath, sessionsDir) {
  const resolvedPath = path.resolve(filePath);
  const codexRoot = getCodexRoot(sessionsDir);
  const sessionsRoot = path.join(codexRoot, 'sessions');
  const archivedRoot = path.join(codexRoot, ARCHIVED_SESSIONS_DIRNAME);

  if (isPathInside(sessionsRoot, resolvedPath)) {
    return path.relative(sessionsRoot, resolvedPath);
  }

  if (isPathInside(archivedRoot, resolvedPath)) {
    return path.join(ARCHIVED_SESSIONS_DIRNAME, path.relative(archivedRoot, resolvedPath));
  }

  return path.relative(path.resolve(sessionsDir), resolvedPath);
}

function isArchivedSessionPath(filePath, codexRoot) {
  return isPathInside(path.join(codexRoot, ARCHIVED_SESSIONS_DIRNAME), filePath);
}

function findCodexRootFromSessionPath(filePath) {
  let currentDir = path.dirname(path.resolve(filePath));

  while (currentDir && currentDir !== path.dirname(currentDir)) {
    const baseName = path.basename(currentDir);
    if (baseName === 'sessions' || baseName === ARCHIVED_SESSIONS_DIRNAME) {
      return path.dirname(currentDir);
    }
    currentDir = path.dirname(currentDir);
  }

  return getCodexRoot(path.dirname(filePath));
}

function resolveScanRoots(sessionsDir, options = {}) {
  const roots = [];
  const resolvedSessionsDir = path.resolve(sessionsDir);
  roots.push(resolvedSessionsDir);

  if (options.includeArchivedSessions === false) {
    return roots;
  }

  const archivedRoot = path.join(getCodexRoot(resolvedSessionsDir), ARCHIVED_SESSIONS_DIRNAME);
  if (archivedRoot !== resolvedSessionsDir && fs.existsSync(archivedRoot)) {
    roots.push(archivedRoot);
  }

  return roots;
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
        if (entry.name === '__backups__' || entry.name.startsWith('__backup_')) {
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

  walk(path.resolve(sessionsDir));
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

function parseSessionMeta(filePath) {
  try {
    const chunk = readChunk(filePath, 256 * 1024);
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

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeThreadSource(source) {
  if (source === undefined || source === null) {
    return 'unknown';
  }

  if (typeof source === 'string') {
    const normalized = source.trim();
    if (!normalized) {
      return 'unknown';
    }

    if (normalized === 'vscode') {
      return normalized;
    }

    if (normalized.startsWith('{') && normalized.includes('"subagent"')) {
      return 'vscode';
    }

    return normalized;
  }

  const serialized = JSON.stringify(source);
  if (serialized && serialized.includes('"subagent"')) {
    return 'vscode';
  }

  return serialized || 'unknown';
}

function normalizeWindowsThreadPath(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  if (process.platform !== 'win32') {
    return normalized;
  }

  let canonical = normalized;
  if (canonical.startsWith('\\\\?\\')) {
    canonical = canonical.slice(4);
  }

  if (/^[a-z]:\\/.test(canonical)) {
    canonical = `${canonical.slice(0, 1).toUpperCase()}${canonical.slice(1)}`;
  }

  return canonical;
}

function normalizeNumericTimestamp(value) {
  let normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }

  // Accept epoch values in seconds, milliseconds, microseconds, or nanoseconds.
  while (normalized > 1e11) {
    normalized /= 1000;
  }

  return Math.floor(normalized);
}

function toUnixSeconds(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  if (typeof value === 'number') {
    return normalizeNumericTimestamp(value);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return 0;
  }

  const numericValue = Number(normalized);
  if (Number.isFinite(numericValue)) {
    return normalizeNumericTimestamp(numericValue);
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function toIsoTimestamp(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return new Date().toISOString();
  }

  return new Date(numeric * 1000).toISOString();
}

function readSessionLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(tryParseJsonLine)
    .filter(Boolean);
}

function recordHasUserEvent(record) {
  if (!record || typeof record !== 'object') {
    return false;
  }

  if (
    record.type === 'response_item' &&
    record.payload &&
    typeof record.payload === 'object' &&
    record.payload.role === 'user'
  ) {
    return true;
  }

  if (
    record.type === 'event_msg' &&
    record.payload &&
    typeof record.payload === 'object' &&
    record.payload.role === 'user'
  ) {
    return true;
  }

  if (record.type === 'message' && record.role === 'user') {
    return true;
  }

  if (
    record.type === 'compacted' &&
    record.payload &&
    Array.isArray(record.payload.replacement_history)
  ) {
    return record.payload.replacement_history.some((item) => (
      item &&
      item.type === 'message' &&
      item.role === 'user'
    ));
  }

  return false;
}

function deriveAgentMetadata(meta, lastTurnContext) {
  const sourceSpawn = meta?.source?.subagent?.thread_spawn || {};

  return {
    nickname: meta?.agent_nickname || lastTurnContext?.agent_nickname || sourceSpawn.agent_nickname || null,
    role: meta?.agent_role || lastTurnContext?.agent_role || sourceSpawn.agent_role || null,
    path: meta?.agent_path || lastTurnContext?.agent_path || null
  };
}

function deriveThreadRecord(filePath, existingSessionIndexEntry = null) {
  const resolvedPath = path.resolve(filePath);
  const codexRoot = findCodexRootFromSessionPath(resolvedPath);
  const meta = parseSessionMeta(resolvedPath);
  if (!meta || !meta.id) {
    throw new Error(`Session metadata could not be parsed: ${resolvedPath}`);
  }

  const records = readSessionLines(resolvedPath);
  const stat = fs.statSync(resolvedPath);
  let firstUsefulUserMessage = null;
  let latestTimestamp = meta.timestamp || null;
  let lastTurnContext = null;
  let latestModel = null;
  let latestReasoningEffort = null;
  let latestApprovalMode = null;
  let latestSandboxPolicy = null;
  let latestCwd = meta.cwd || '';
  let latestMemoryMode = null;
  let gitSha = null;
  let gitBranch = null;
  let gitOriginUrl = null;
  let hasUserEvent = false;

  for (const record of records) {
    if (!hasUserEvent && recordHasUserEvent(record)) {
      hasUserEvent = true;
    }

    if (record.timestamp && (!latestTimestamp || record.timestamp > latestTimestamp)) {
      latestTimestamp = record.timestamp;
    }

    if (record.type === 'turn_context' && record.payload && typeof record.payload === 'object') {
      lastTurnContext = record.payload;
      latestModel = record.payload.model || latestModel;
      latestReasoningEffort = (
        record.payload.reasoning_effort ||
        record.payload.effort ||
        record.payload.collaboration_mode?.settings?.reasoning_effort ||
        latestReasoningEffort
      );
      latestApprovalMode = record.payload.approval_policy || latestApprovalMode;
      latestSandboxPolicy = record.payload.sandbox_policy || latestSandboxPolicy;
      latestCwd = record.payload.cwd || latestCwd;
      latestMemoryMode = record.payload.memory_mode || latestMemoryMode;
      gitSha = record.payload.git_sha || gitSha;
      gitBranch = record.payload.git_branch || gitBranch;
      gitOriginUrl = record.payload.git_origin_url || gitOriginUrl;
    }

    if (!firstUsefulUserMessage) {
      const rawPrompt = extractUserInputText(record);
      const cleanedPrompt = sanitizeUserPrompt(rawPrompt);
      if (cleanedPrompt) {
        firstUsefulUserMessage = cleanedPrompt;
      }
    }
  }

  const agent = deriveAgentMetadata(meta, lastTurnContext);
  const createdAt = toUnixSeconds(meta.timestamp) || Math.floor(stat.ctimeMs / 1000);
  const parsedLatestTimestamp = toUnixSeconds(latestTimestamp);
  const parsedMetaTimestamp = toUnixSeconds(meta.timestamp);
  const fileModifiedAt = Math.floor(stat.mtimeMs / 1000);
  const updatedAt = Math.max(
    parsedLatestTimestamp || parsedMetaTimestamp || fileModifiedAt || createdAt,
    createdAt
  );
  const archived = isArchivedSessionPath(resolvedPath, codexRoot) ? 1 : 0;
  const fallbackTitle = buildFallbackThreadTitle({
    existingTitle: existingSessionIndexEntry?.thread_name || null,
    cwd: latestCwd || meta.cwd || '',
    timestamp: latestTimestamp || meta.timestamp || null,
    sessionId: meta.id,
    filePath: resolvedPath
  });
  const normalizedTitle = summarizeThreadTitle(firstUsefulUserMessage) || fallbackTitle;
  const normalizedFirstUserMessage = (
    firstUsefulUserMessage ||
    sanitizeUserPrompt(existingSessionIndexEntry?.thread_name) ||
    fallbackTitle
  );

  return {
    id: meta.id,
    rolloutPath: resolvedPath,
    createdAt,
    updatedAt,
    source: normalizeThreadSource(meta.source),
    modelProvider: meta.model_provider || 'unknown',
    cwd: normalizeWindowsThreadPath(latestCwd || meta.cwd || ''),
    title: normalizedTitle,
    sandboxPolicy: JSON.stringify(latestSandboxPolicy || { type: 'unknown' }),
    approvalMode: latestApprovalMode || 'unknown',
    tokensUsed: 0,
    hasUserEvent: hasUserEvent ? 1 : 0,
    archived,
    archivedAt: archived ? updatedAt : null,
    gitSha,
    gitBranch,
    gitOriginUrl,
    cliVersion: meta.cli_version || '',
    firstUserMessage: normalizedFirstUserMessage,
    agentNickname: agent.nickname,
    agentRole: agent.role,
    memoryMode: latestMemoryMode || 'enabled',
    model: latestModel || null,
    reasoningEffort: latestReasoningEffort || null,
    agentPath: agent.path
  };
}

function buildSessionTargets(sessionsDir, options = {}) {
  const explicitPaths = Array.isArray(options.filePaths)
    ? options.filePaths.map((filePath) => path.resolve(filePath))
    : null;
  const targets = [];
  const targetSet = explicitPaths ? new Set(explicitPaths) : null;
  const seen = new Set();

  for (const scanRoot of resolveScanRoots(sessionsDir, options)) {
    walkSessionFiles(scanRoot, (filePath) => {
      const resolved = path.resolve(filePath);
      if (seen.has(resolved)) {
        return;
      }

      seen.add(resolved);
      if (targetSet && !targetSet.has(resolved)) {
        return;
      }

      targets.push(resolved);
    });
  }

  if (targetSet) {
    return explicitPaths.filter((filePath) => targets.includes(filePath));
  }

  return targets;
}

function loadSessionIndexState(sessionsDir) {
  const sessionIndexPath = getSessionIndexPath(sessionsDir);
  const latestById = new Map();

  if (!fs.existsSync(sessionIndexPath)) {
    return {
      sessionIndexPath,
      latestById,
      rawContent: ''
    };
  }

  const rawContent = fs.readFileSync(sessionIndexPath, 'utf8');
  for (const line of rawContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const entry = tryParseJsonLine(trimmed);
    if (!entry || !entry.id) {
      continue;
    }

    const existing = latestById.get(entry.id);
    if (!existing || String(entry.updated_at || '') >= String(existing.updated_at || '')) {
      latestById.set(entry.id, entry);
    }
  }

  return {
    sessionIndexPath,
    latestById,
    rawContent
  };
}

function createSessionIndexEntry(threadRecord) {
  return {
    id: threadRecord.id,
    thread_name: threadRecord.title,
    updated_at: toIsoTimestamp(threadRecord.updatedAt)
  };
}

function sortSessionIndexEntries(entries) {
  return [...entries].sort((left, right) => {
    const byUpdatedAt = String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
    return byUpdatedAt || String(left.id || '').localeCompare(String(right.id || ''));
  });
}

function appendSessionIndexEntries(sessionIndexPath, entries) {
  if (!entries.length) {
    return 0;
  }

  fs.mkdirSync(path.dirname(sessionIndexPath), { recursive: true });
  const prefix = fs.existsSync(sessionIndexPath) && fs.readFileSync(sessionIndexPath, 'utf8').length > 0
    ? '\n'
    : '';
  const payload = entries.map((entry) => JSON.stringify(entry)).join('\n');
  fs.appendFileSync(sessionIndexPath, `${prefix}${payload}\n`, 'utf8');
  return entries.length;
}

function writeSessionIndexEntries(sessionIndexPath, entries, options = {}) {
  const sortedEntries = sortSessionIndexEntries(entries);
  const nextContent = sortedEntries.length
    ? `${sortedEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    : '';
  const currentContent = fs.existsSync(sessionIndexPath)
    ? fs.readFileSync(sessionIndexPath, 'utf8')
    : '';

  if (currentContent === nextContent) {
    return {
      writtenEntries: sortedEntries.length,
      changed: false,
      backupPath: null
    };
  }

  fs.mkdirSync(path.dirname(sessionIndexPath), { recursive: true });

  let backupPath = null;
  if (currentContent) {
    const suffix = new Date().toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-');
    const label = String(options.backupLabel || 'repair').replace(/[^a-z0-9_-]+/gi, '-');
    backupPath = `${sessionIndexPath}.pre-${label}-${suffix}.bak`;
    fs.writeFileSync(backupPath, currentContent, 'utf8');
  }

  fs.writeFileSync(sessionIndexPath, nextContent, 'utf8');

  return {
    writtenEntries: sortedEntries.length,
    changed: true,
    backupPath
  };
}

function getThreadTableColumnsFromNodeSqlite(db) {
  return new Set(
    db.prepare('PRAGMA table_info(threads)')
      .all()
      .map((row) => row.name)
      .filter(Boolean)
  );
}

function getThreadTableColumnsFromCli(dbPath) {
  const output = execFileSync('sqlite3', [dbPath, 'PRAGMA table_info(threads);'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split('|')[1])
      .filter(Boolean)
  );
}

function buildThreadColumnValues(threadRecord, columns) {
  const values = {};

  for (const [fieldName, columnName] of Object.entries(THREAD_FIELD_MAP)) {
    if (!columns.has(columnName)) {
      continue;
    }

    if (threadRecord[fieldName] !== undefined) {
      values[columnName] = threadRecord[fieldName];
    }
  }

  return values;
}

function coerceUpdateCandidate(columnName, value) {
  if (columnName === 'archived_at') {
    return value ?? null;
  }

  return value;
}

function shouldRefreshThreadText(existingRow, columnName, currentValue, nextValue) {
  if (!nextValue || currentValue === nextValue) {
    return false;
  }

  if (columnName === 'title') {
    if (isThreadTitlePlaceholder(currentValue) && !isThreadTitlePlaceholder(nextValue)) {
      return true;
    }

    if (/[\r\n]/.test(String(currentValue || ''))) {
      return true;
    }

    const normalizedCurrentTitle = summarizeThreadTitle(currentValue);
    const normalizedExistingPromptTitle = summarizeThreadTitle(existingRow?.first_user_message);
    return Boolean(
      (normalizedCurrentTitle && normalizedCurrentTitle === nextValue && currentValue !== nextValue) ||
      (normalizedExistingPromptTitle && normalizedExistingPromptTitle === nextValue && currentValue !== nextValue)
    );
  }

  if (columnName === 'first_user_message') {
    if (isThreadTitlePlaceholder(currentValue) && !isThreadTitlePlaceholder(nextValue)) {
      return true;
    }

    return sanitizeUserPrompt(currentValue) === nextValue;
  }

  return false;
}

function buildSafeUpdates(existingRow, nextValues) {
  const updates = {};

  for (const [columnName, nextValue] of Object.entries(nextValues)) {
    const currentValue = existingRow?.[columnName];

    if (shouldRefreshThreadText(existingRow, columnName, currentValue, nextValue)) {
      updates[columnName] = nextValue;
      continue;
    }

    if (columnName === 'model_provider') {
      if (nextValue && currentValue !== nextValue) {
        updates[columnName] = nextValue;
      }
      continue;
    }

    if (columnName === 'source') {
      if (nextValue && currentValue !== nextValue) {
        updates[columnName] = nextValue;
      }
      continue;
    }

    if (columnName === 'cwd') {
      if (nextValue && currentValue !== nextValue) {
        updates[columnName] = nextValue;
      }
      continue;
    }

    if (columnName === 'rollout_path') {
      if (nextValue && currentValue !== nextValue) {
        updates[columnName] = nextValue;
      }
      continue;
    }

    if (columnName === 'archived') {
      if (Number(currentValue || 0) !== Number(nextValue || 0)) {
        updates[columnName] = nextValue;
      }
      continue;
    }

    if (columnName === 'archived_at') {
      if ((currentValue ?? null) !== (nextValue ?? null)) {
        updates[columnName] = nextValue ?? null;
      }
      continue;
    }

    if (columnName === 'updated_at') {
      if (Number(nextValue || 0) > 0 && Number(nextValue || 0) !== Number(currentValue || 0)) {
        updates[columnName] = nextValue;
      }
      continue;
    }

    if (
      currentValue === undefined ||
      currentValue === null ||
      currentValue === '' ||
      (typeof currentValue === 'number' && currentValue === 0)
    ) {
      if (
        nextValue !== undefined &&
        nextValue !== null &&
        nextValue !== '' &&
        !(typeof nextValue === 'number' && nextValue === 0)
      ) {
        updates[columnName] = nextValue;
      }
    }
  }

  return updates;
}

function hasThreadsTableNode(db) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'threads'
    LIMIT 1
  `).get());
}

function hasThreadsTableCli(dbPath) {
  const output = execFileSync('sqlite3', [dbPath, `
    SELECT COUNT(*)
    FROM sqlite_master
    WHERE type = 'table' AND name = 'threads';
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  return output === '1';
}

function fetchExistingThreadNode(db, sessionId, rolloutPath) {
  return db.prepare(`
    SELECT *
    FROM threads
    WHERE id = ? OR rollout_path = ?
    LIMIT 1
  `).get(sessionId, rolloutPath) || null;
}

function fetchExistingThreadCli(dbPath, sessionId, rolloutPath) {
  const sql = `
    SELECT *
    FROM threads
    WHERE id = '${escapeSqliteLiteral(sessionId)}'
      OR rollout_path = '${escapeSqliteLiteral(rolloutPath)}'
    LIMIT 1;
  `;
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  if (!output) {
    return null;
  }

  try {
    const rows = JSON.parse(output);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

function updateThreadRowNode(db, updates, sessionId, rolloutPath) {
  const entries = Object.entries(updates);
  if (!entries.length) {
    return 0;
  }

  const assignments = entries.map(([columnName]) => `${columnName} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  const result = db.prepare(`
    UPDATE threads
    SET ${assignments}
    WHERE id = ? OR rollout_path = ?
  `).run(...values, sessionId, rolloutPath);

  return Number(result.changes || 0);
}

function updateThreadRowCli(dbPath, updates, sessionId, rolloutPath) {
  const entries = Object.entries(updates);
  if (!entries.length) {
    return 0;
  }

  const assignments = entries.map(([columnName, value]) => {
    if (value === null || value === undefined) {
      return `${columnName} = NULL`;
    }
    return `${columnName} = '${escapeSqliteLiteral(value)}'`;
  }).join(', ');
  const sql = `
    UPDATE threads
    SET ${assignments}
    WHERE id = '${escapeSqliteLiteral(sessionId)}'
       OR rollout_path = '${escapeSqliteLiteral(rolloutPath)}';
    SELECT changes();
  `;
  const output = execFileSync('sqlite3', [dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim().split(/\r?\n/).filter(Boolean);

  return Number(output.at(-1)) || 0;
}

function insertThreadRowNode(db, values) {
  const entries = Object.entries(values);
  const columns = entries.map(([columnName]) => columnName).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const parameters = entries.map(([, value]) => value);
  const result = db.prepare(`
    INSERT INTO threads (${columns})
    VALUES (${placeholders})
  `).run(...parameters);

  return Number(result.changes || 0);
}

function insertThreadRowCli(dbPath, values) {
  const entries = Object.entries(values);
  const columns = entries.map(([columnName]) => columnName).join(', ');
  const valueLiterals = entries.map(([, value]) => {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    return `'${escapeSqliteLiteral(value)}'`;
  }).join(', ');
  const sql = `
    INSERT INTO threads (${columns})
    VALUES (${valueLiterals});
    SELECT changes();
  `;
  const output = execFileSync('sqlite3', [dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim().split(/\r?\n/).filter(Boolean);

  return Number(output.at(-1)) || 0;
}

function reconcileThreadRecordInStateDb(dbPath, threadRecord) {
  const nodeSqlite = loadNodeSqliteModule();

  if (nodeSqlite && typeof nodeSqlite.DatabaseSync === 'function') {
    const db = new nodeSqlite.DatabaseSync(dbPath);
    try {
      if (!hasThreadsTableNode(db)) {
        return { inserted: 0, updated: 0 };
      }

      const columns = getThreadTableColumnsFromNodeSqlite(db);
      const existingRow = fetchExistingThreadNode(db, threadRecord.id, threadRecord.rolloutPath);
      const nextValues = buildThreadColumnValues(threadRecord, columns);

      if (existingRow) {
        const updates = buildSafeUpdates(existingRow, nextValues);
        return {
          inserted: 0,
          updated: updateThreadRowNode(db, updates, threadRecord.id, threadRecord.rolloutPath)
        };
      }

      return {
        inserted: insertThreadRowNode(db, nextValues),
        updated: 0
      };
    } finally {
      db.close();
    }
  }

  if (!hasThreadsTableCli(dbPath)) {
    return { inserted: 0, updated: 0 };
  }

  const columns = getThreadTableColumnsFromCli(dbPath);
  const existingRow = fetchExistingThreadCli(dbPath, threadRecord.id, threadRecord.rolloutPath);
  const nextValues = buildThreadColumnValues(threadRecord, columns);

  if (existingRow) {
    const updates = buildSafeUpdates(existingRow, nextValues);
    return {
      inserted: 0,
      updated: updateThreadRowCli(dbPath, updates, threadRecord.id, threadRecord.rolloutPath)
    };
  }

  return {
    inserted: insertThreadRowCli(dbPath, nextValues),
    updated: 0
  };
}

function syncThreadProviderIndexes(sessionsDir, sessionId, rolloutPath, targetProvider) {
  const dbPaths = listStateDatabasePaths(sessionsDir);
  let updatedRows = 0;

  for (const dbPath of dbPaths) {
    const nodeSqlite = loadNodeSqliteModule();

    if (nodeSqlite && typeof nodeSqlite.DatabaseSync === 'function') {
      const db = new nodeSqlite.DatabaseSync(dbPath);
      try {
        if (!hasThreadsTableNode(db)) {
          continue;
        }

        const result = db.prepare(`
          UPDATE threads
          SET model_provider = ?
          WHERE id = ? OR rollout_path = ?
        `).run(targetProvider, sessionId, rolloutPath);

        updatedRows += Number(result.changes || 0);
      } finally {
        db.close();
      }
      continue;
    }

    if (!hasThreadsTableCli(dbPath)) {
      continue;
    }

    updatedRows += updateThreadRowCli(dbPath, {
      model_provider: targetProvider
    }, sessionId, rolloutPath);
  }

  return {
    dbPaths,
    updatedRows
  };
}

function loadAllThreadRowsFromStateDb(dbPath) {
  const nodeSqlite = loadNodeSqliteModule();

  if (nodeSqlite && typeof nodeSqlite.DatabaseSync === 'function') {
    const db = new nodeSqlite.DatabaseSync(dbPath);
    try {
      if (!hasThreadsTableNode(db)) {
        return [];
      }

      return db.prepare(`
        SELECT id, rollout_path, model_provider
        FROM threads
      `).all();
    } finally {
      db.close();
    }
  }

  if (!hasThreadsTableCli(dbPath)) {
    return [];
  }

  const output = execFileSync('sqlite3', ['-json', dbPath, `
    SELECT id, rollout_path, model_provider
    FROM threads;
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  if (!output) {
    return [];
  }

  try {
    const rows = JSON.parse(output);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function getIndexHealth(sessionsDir, options = {}) {
  const sessionsRoot = path.resolve(sessionsDir);
  const dbPaths = listStateDatabasePaths(sessionsRoot);
  const includeSessionIndex = options.includeSessionIndex !== false;
  const sessionIndexState = includeSessionIndex ? loadSessionIndexState(sessionsRoot) : null;
  const threadRowsBySessionId = new Map();
  const threadRowsByRolloutPath = new Map();
  const issues = [];
  const t = typeof options.t === 'function' ? options.t : ((key) => key);

  for (const dbPath of dbPaths) {
    const rows = loadAllThreadRowsFromStateDb(dbPath);
    for (const row of rows) {
      if (row.id) {
        const existing = threadRowsBySessionId.get(row.id) || [];
        existing.push({ ...row, dbPath });
        threadRowsBySessionId.set(row.id, existing);
      }

      if (row.rollout_path) {
        const existing = threadRowsByRolloutPath.get(row.rollout_path) || [];
        existing.push({ ...row, dbPath });
        threadRowsByRolloutPath.set(row.rollout_path, existing);
      }
    }
  }

  let missingThreadCount = 0;
  let providerMismatchCount = 0;
  let missingSessionIndexCount = 0;

  for (const scanRoot of resolveScanRoots(sessionsRoot, options)) {
    walkSessionFiles(scanRoot, (filePath) => {
      const meta = parseSessionMeta(filePath);
      if (!meta || !meta.id) {
        return;
      }

      const relativePath = getDisplayRelativePath(filePath, sessionsRoot);
      const matchedRows = [
        ...(threadRowsBySessionId.get(meta.id) || []),
        ...(threadRowsByRolloutPath.get(path.resolve(filePath)) || [])
      ];
      const uniqueRows = matchedRows.filter((row, index) => (
        matchedRows.findIndex((item) => item.dbPath === row.dbPath && item.id === row.id) === index
      ));

      if (!uniqueRows.length) {
        missingThreadCount += 1;
        issues.push({
          severity: 'warning',
          type: 'missing_thread',
          relativePath,
          message: t('doctor.missingThread')
        });
      } else if (uniqueRows.some((row) => row.model_provider !== meta.model_provider)) {
        providerMismatchCount += 1;
        issues.push({
          severity: 'warning',
          type: 'provider_mismatch',
          relativePath,
          message: t('doctor.providerMismatch')
        });
      }

      if (includeSessionIndex && !sessionIndexState.latestById.has(meta.id)) {
        missingSessionIndexCount += 1;
        issues.push({
          severity: 'warning',
          type: 'missing_session_index',
          relativePath,
          message: t('doctor.missingSessionIndex')
        });
      }
    });
  }

  return {
    stateDatabaseCount: dbPaths.length,
    missingThreadCount,
    providerMismatchCount,
    missingSessionIndexCount,
    issues
  };
}

function repairSessionIndexes(sessionsDir, options = {}) {
  const sessionsRoot = path.resolve(sessionsDir);
  const repairSessionIndex = options.repairSessionIndex !== false;
  const rewriteSessionIndex = repairSessionIndex && Boolean(options.rewriteSessionIndex);
  const targetFiles = buildSessionTargets(sessionsRoot, options);
  const dbPaths = listStateDatabasePaths(sessionsRoot);
  const sessionIndexState = repairSessionIndex ? loadSessionIndexState(sessionsRoot) : null;
  const existingSessionIndexById = sessionIndexState ? new Map(sessionIndexState.latestById) : null;
  const pendingSessionIndexEntries = [];
  const results = [];
  const allTargetsSelected = !Array.isArray(options.filePaths);

  let insertedThreads = 0;
  let updatedThreads = 0;
  let addedSessionIndexEntries = 0;

  for (const filePath of targetFiles) {
    const relativePath = getDisplayRelativePath(filePath, sessionsRoot);

    try {
      const meta = parseSessionMeta(filePath);
      if (!meta || !meta.id) {
        throw new Error(`Session metadata could not be parsed: ${relativePath}`);
      }

      const existingSessionIndexEntry = repairSessionIndex
        ? (existingSessionIndexById.get(meta.id) || null)
        : null;
      const threadRecord = deriveThreadRecord(filePath, existingSessionIndexEntry);
      let fileInserted = 0;
      let fileUpdated = 0;

      for (const dbPath of dbPaths) {
        const result = reconcileThreadRecordInStateDb(dbPath, threadRecord);
        fileInserted += result.inserted;
        fileUpdated += result.updated;
      }

      if (repairSessionIndex) {
        const sessionIndexEntry = createSessionIndexEntry(threadRecord);

        if (!existingSessionIndexEntry) {
          addedSessionIndexEntries += 1;
        }

        if (rewriteSessionIndex) {
          sessionIndexState.latestById.set(threadRecord.id, sessionIndexEntry);
        } else if (!existingSessionIndexEntry) {
          pendingSessionIndexEntries.push(sessionIndexEntry);
          sessionIndexState.latestById.set(threadRecord.id, sessionIndexEntry);
        }
      }

      insertedThreads += fileInserted;
      updatedThreads += fileUpdated;
      results.push({
        id: threadRecord.id,
        filePath,
        relativePath,
        ok: true,
        insertedThreads: fileInserted,
        updatedThreads: fileUpdated,
        addedSessionIndex: repairSessionIndex && !existingSessionIndexEntry
      });
    } catch (error) {
      results.push({
        filePath,
        relativePath,
        ok: false,
        error: error.message
      });
    }
  }

  let sessionIndexWriteResult = {
    writtenEntries: repairSessionIndex && sessionIndexState ? sessionIndexState.latestById.size : 0,
    changed: false,
    backupPath: null
  };
  let appendedCount = 0;

  if (repairSessionIndex && sessionIndexState) {
    if (rewriteSessionIndex) {
      sessionIndexWriteResult = writeSessionIndexEntries(
        sessionIndexState.sessionIndexPath,
        Array.from(sessionIndexState.latestById.values()),
        {
          backupLabel: allTargetsSelected ? 'full-repair' : 'repair'
        }
      );
    } else {
      appendedCount = appendSessionIndexEntries(
        sessionIndexState.sessionIndexPath,
        pendingSessionIndexEntries
      );
    }
  }

  return {
    ok: results.every((item) => item.ok),
    sessionsDir: sessionsRoot,
    scanned: targetFiles.length,
    dbPaths,
    sessionIndexPath: repairSessionIndex ? sessionIndexState.sessionIndexPath : getSessionIndexPath(sessionsRoot),
    insertedThreads,
    updatedThreads,
    addedSessionIndexEntries: rewriteSessionIndex ? addedSessionIndexEntries : appendedCount,
    rewroteSessionIndex: rewriteSessionIndex,
    sessionIndexEntriesWritten: rewriteSessionIndex
      ? sessionIndexWriteResult.writtenEntries
      : (sessionIndexState ? sessionIndexState.latestById.size : 0) + appendedCount,
    sessionIndexBackupPath: sessionIndexWriteResult.backupPath,
    failed: results.filter((item) => !item.ok).length,
    results
  };
}

module.exports = {
  buildSafeUpdates,
  deriveThreadRecord,
  getIndexHealth,
  getSessionIndexPath,
  listStateDatabasePaths,
  repairSessionIndexes,
  syncThreadProviderIndexes
};

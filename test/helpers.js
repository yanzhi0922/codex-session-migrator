'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

function execSqlScript(dbPath, script) {
  const nodeSqlite = loadNodeSqliteModule();
  if (nodeSqlite && typeof nodeSqlite.DatabaseSync === 'function') {
    const db = new nodeSqlite.DatabaseSync(dbPath);
    try {
      db.exec(script);
      return;
    } finally {
      db.close();
    }
  }

  execFileSync('sqlite3', [dbPath, script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function createTempSessionsDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-migrator-'));
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return { root, sessionsDir };
}

function createUserMessageRecord(text, options = {}) {
  const messageType = options.messageType || 'response_item';

  if (messageType === 'message') {
    return {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text
        }
      ]
    };
  }

  return {
    type: 'response_item',
    payload: {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text
        }
      ]
    }
  };
}

function writeSessionFile(sessionsDir, relativePath, options = {}) {
  const filePath = path.join(sessionsDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const sessionMetaPayload = {
    id: options.id || relativePath.replace(/[\\/]/g, '-'),
    model_provider: options.provider || 'openai',
    timestamp: options.timestamp || '2026-03-28T00:00:00.000Z',
    cwd: options.cwd || 'C:\\Users\\Test\\Workspace',
    cli_version: '0.115.0-alpha.27',
    originator: 'Codex Desktop',
    ...(options.sessionMetaOverrides || {})
  };
  const sessionMeta = {
    type: 'session_meta',
    payload: sessionMetaPayload
  };

  const userMessages = Array.isArray(options.userMessages) && options.userMessages.length
    ? options.userMessages.map((entry) => {
        if (typeof entry === 'string') {
          return createUserMessageRecord(entry, { messageType: 'response_item' });
        }

        if (entry && typeof entry === 'object' && entry.type) {
          return entry;
        }

        return createUserMessageRecord(entry?.text || 'Hello from test', {
          messageType: entry?.messageType || 'response_item'
        });
      })
    : [createUserMessageRecord(options.prompt || 'Hello from test', {
        messageType: options.userMessageType || 'response_item'
      })];

  const extraRecords = Array.isArray(options.extraRecords) ? options.extraRecords : [];
  fs.writeFileSync(
    filePath,
    [sessionMeta, ...userMessages, ...extraRecords].map((entry) => JSON.stringify(entry)).join('\n').concat('\n'),
    'utf8'
  );

  return filePath;
}

function createTempStateDb(root, rows = [], options = {}) {
  const dbPath = path.join(root, 'state_5.sqlite');
  const schema = options.fullSchema
    ? `
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        git_sha TEXT,
        git_branch TEXT,
        git_origin_url TEXT,
        cli_version TEXT NOT NULL DEFAULT '',
        first_user_message TEXT NOT NULL DEFAULT '',
        agent_nickname TEXT,
        agent_role TEXT,
        memory_mode TEXT NOT NULL DEFAULT 'enabled',
        model TEXT,
        reasoning_effort TEXT,
        agent_path TEXT
      );
    `
    : `
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT,
        model_provider TEXT
      );
    `;

  execSqlScript(dbPath, schema);

  for (const row of rows) {
    const id = escapeSqliteLiteral(row.id);
    const rolloutPath = escapeSqliteLiteral(row.rolloutPath);
    const modelProvider = escapeSqliteLiteral(row.modelProvider);
    execSqlScript(dbPath, `
      INSERT OR REPLACE INTO threads (id, rollout_path, model_provider)
      VALUES ('${id}', '${rolloutPath}', '${modelProvider}');
    `);
  }

  return dbPath;
}

function readThreadProvider(dbPath, threadId) {
  const nodeSqlite = loadNodeSqliteModule();
  if (nodeSqlite && typeof nodeSqlite.DatabaseSync === 'function') {
    const db = new nodeSqlite.DatabaseSync(dbPath);
    try {
      const row = db.prepare('SELECT model_provider FROM threads WHERE id = ?').get(threadId);
      return row ? row.model_provider : null;
    } finally {
      db.close();
    }
  }

  const output = execFileSync('sqlite3', [dbPath, `
    SELECT model_provider
    FROM threads
    WHERE id = '${escapeSqliteLiteral(threadId)}'
    LIMIT 1;
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  return output || null;
}

function readThreadRow(dbPath, threadId) {
  const nodeSqlite = loadNodeSqliteModule();
  if (nodeSqlite && typeof nodeSqlite.DatabaseSync === 'function') {
    const db = new nodeSqlite.DatabaseSync(dbPath);
    try {
      return db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) || null;
    } finally {
      db.close();
    }
  }

  const output = execFileSync('sqlite3', ['-json', dbPath, `
    SELECT *
    FROM threads
    WHERE id = '${escapeSqliteLiteral(threadId)}'
    LIMIT 1;
  `], {
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

module.exports = {
  createTempStateDb,
  createUserMessageRecord,
  createTempSessionsDir,
  readThreadRow,
  readThreadProvider,
  writeSessionFile
};

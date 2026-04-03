'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { migrateSessions } = require('../src/migrator');

function escapeSqliteLiteral(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function createTempCodexRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-migrator-migrate-'));
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function readMeta(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0]).payload;
}

function readThreadRow(dbPath, sessionId) {
  const output = execFileSync('sqlite3', ['-json', dbPath, `
    SELECT id, model_provider, source
    FROM threads
    WHERE id = '${escapeSqliteLiteral(sessionId)}';
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  return JSON.parse(output)[0];
}

test('migrateSessions rewrites provider and visibility source for importable sessions', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const sessionId = '019e0000-1111-7222-8333-migrate00001';
  const rolloutPath = path.join(sessionsDir, '2026', '03', '31', `rollout-2026-03-31T10-00-00-${sessionId}.jsonl`);

  execFileSync('sqlite3', [dbPath, `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      updated_at INTEGER,
      title TEXT,
      first_user_message TEXT,
      model_provider TEXT,
      source TEXT
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  writeJsonl(rolloutPath, [
    {
      timestamp: '2026-03-31T10:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-03-31T10:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\legacy-project',
        source: 'unknown',
        model_provider: 'openai'
      }
    },
    {
      timestamp: '2026-03-31T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '请把旧会话迁移到 codexmanager。' }]
      }
    }
  ]);

  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider, source)
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      0,
      '旧标题',
      '旧标题',
      'openai',
      'unknown'
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = migrateSessions(
    sessionsDir,
    { provider: 'openai' },
    'codexmanager',
    {
      locale: 'en',
      t: (key) => key,
      targetSource: 'vscode'
    }
  );

  const meta = readMeta(rolloutPath);
  const row = readThreadRow(dbPath, sessionId);

  assert.equal(result.failed, 0);
  assert.equal(result.migrated, 1);
  assert.equal(meta.model_provider, 'codexmanager');
  assert.equal(meta.source, 'vscode');
  assert.equal(row.model_provider, 'codexmanager');
  assert.equal(row.source, 'vscode');
});

test('migrateSessions falls back to in-place overwrite when file replace is locked', (t) => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const sessionId = '019e0000-1111-7222-8333-migrate00002';
  const rolloutPath = path.join(sessionsDir, '2026', '03', '31', `rollout-2026-03-31T10-00-00-${sessionId}.jsonl`);

  execFileSync('sqlite3', [dbPath, `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      updated_at INTEGER,
      title TEXT,
      first_user_message TEXT,
      model_provider TEXT,
      source TEXT
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  writeJsonl(rolloutPath, [
    {
      timestamp: '2026-03-31T10:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-03-31T10:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\locked-project',
        source: 'unknown',
        model_provider: 'openai'
      }
    }
  ]);

  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider, source)
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      0,
      '旧标题',
      '旧标题',
      'openai',
      'unknown'
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const originalRenameSync = fs.renameSync;
  t.after(() => {
    fs.renameSync = originalRenameSync;
  });

  fs.renameSync = (fromPath, toPath) => {
    if (path.resolve(toPath) === path.resolve(rolloutPath)) {
      const error = new Error('locked');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync(fromPath, toPath);
  };

  const result = migrateSessions(
    sessionsDir,
    { provider: 'openai' },
    'codexmanager',
    {
      locale: 'en',
      t: (key) => key,
      targetSource: 'vscode'
    }
  );

  const meta = readMeta(rolloutPath);
  const row = readThreadRow(dbPath, sessionId);

  assert.equal(result.failed, 0);
  assert.equal(result.migrated, 1);
  assert.equal(meta.model_provider, 'codexmanager');
  assert.equal(meta.source, 'vscode');
  assert.equal(row.model_provider, 'codexmanager');
  assert.equal(row.source, 'vscode');
});

test('migrateSessions normalizes subagent source to vscode while updating provider', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const sessionId = '019e0000-1111-7222-8333-migrate00003';
  const subagentSource = '{"subagent":{"thread_spawn":{"parent_thread_id":"019e-parent","depth":1,"agent_nickname":"Euler","agent_role":"explorer"}}}';
  const rolloutPath = path.join(sessionsDir, '2026', '03', '31', `rollout-2026-03-31T10-00-00-${sessionId}.jsonl`);

  execFileSync('sqlite3', [dbPath, `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      updated_at INTEGER,
      title TEXT,
      first_user_message TEXT,
      model_provider TEXT,
      source TEXT
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  writeJsonl(rolloutPath, [
    {
      timestamp: '2026-03-31T10:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-03-31T10:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\subagent-project',
        source: JSON.parse(subagentSource),
        model_provider: 'openai'
      }
    }
  ]);

  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider, source)
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      0,
      '子线程标题',
      '子线程标题',
      'openai',
      '${escapeSqliteLiteral(subagentSource)}'
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = migrateSessions(
    sessionsDir,
    { provider: 'openai' },
    'codexmanager',
    {
      locale: 'en',
      t: (key) => key,
      targetSource: 'vscode'
    }
  );

  const meta = readMeta(rolloutPath);
  const row = readThreadRow(dbPath, sessionId);

  assert.equal(result.failed, 0);
  assert.equal(result.migrated, 1);
  assert.equal(meta.model_provider, 'codexmanager');
  assert.equal(meta.source, 'vscode');
  assert.equal(row.model_provider, 'codexmanager');
  assert.equal(row.source, 'vscode');
});

test('migrateSessions syncs config default provider for vscode visibility', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const configPath = path.join(codexRoot, 'config.toml');
  const sessionId = '019e0000-1111-7222-8333-migrate00004';
  const rolloutPath = path.join(sessionsDir, '2026', '03', '31', `rollout-2026-03-31T10-00-00-${sessionId}.jsonl`);

  fs.writeFileSync(configPath, [
    'model_provider = "codexmanager"',
    '',
    '[model_providers.codexmanager]',
    'name = "CodexManager"',
    'base_url = "http://127.0.0.1:48760/v1"',
    'wire_api = "responses"',
    ''
  ].join('\n'), 'utf8');

  execFileSync('sqlite3', [dbPath, `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      updated_at INTEGER,
      title TEXT,
      first_user_message TEXT,
      model_provider TEXT,
      source TEXT
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  writeJsonl(rolloutPath, [
    {
      timestamp: '2026-03-31T10:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-03-31T10:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\config-project',
        source: 'unknown',
        model_provider: 'openai'
      }
    }
  ]);

  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider, source)
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      0,
      '配置测试',
      '配置测试',
      'openai',
      'unknown'
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = migrateSessions(
    sessionsDir,
    { provider: 'openai' },
    'codexmanager',
    {
      locale: 'en',
      t: (key) => key,
      targetSource: 'vscode'
    }
  );

  const configContent = fs.readFileSync(configPath, 'utf8');

  assert.equal(result.failed, 0);
  assert.equal(result.migrated, 1);
  assert.equal(result.configSync?.ok, true);
  assert.equal(result.configSync?.changed, true);
  assert.match(configContent, /^model_provider = "codexmanager"$/m);
  assert.match(configContent, /^\[model_providers\.codexmanager\]$/m);
  assert.match(configContent, /^name = "CodexManager"$/m);
});

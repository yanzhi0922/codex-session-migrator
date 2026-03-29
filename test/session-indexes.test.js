'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  createTempSessionsDir,
  createTempStateDb,
  readThreadRow,
  writeSessionFile
} = require('./helpers');
const {
  getSessionIndexPath,
  repairSessionIndexes
} = require('../src/session-indexes');

test('repairSessionIndexes inserts missing SQLite rows and session_index entries', () => {
  const { root, sessionsDir } = createTempSessionsDir();
  const filePath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'repair-one.jsonl'), {
    id: 'repair-one',
    provider: 'fizzlycode',
    prompt: '请修复这个索引问题'
  });
  const dbPath = createTempStateDb(root, []);

  const result = repairSessionIndexes(sessionsDir);

  assert.equal(result.ok, true);
  assert.equal(result.scanned, 1);
  assert.equal(result.insertedThreads, 1);
  assert.equal(result.updatedThreads, 0);
  assert.equal(result.addedSessionIndexEntries, 1);

  const row = readThreadRow(dbPath, 'repair-one');
  assert.equal(row.id, 'repair-one');
  assert.equal(row.rollout_path, filePath);
  assert.equal(row.model_provider, 'fizzlycode');

  const entries = fs.readFileSync(getSessionIndexPath(sessionsDir), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(entries, [{
    id: 'repair-one',
    thread_name: '请修复这个索引问题',
    updated_at: entries[0].updated_at
  }]);
});

test('repairSessionIndexes derives rich thread metadata from complex session files', () => {
  const { root, sessionsDir } = createTempSessionsDir();
  createTempStateDb(root, [], { fullSchema: true });
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'subagent.jsonl'), {
    id: 'subagent-session',
    provider: 'openai',
    sessionMetaOverrides: {
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: 'parent-thread',
            depth: 1,
            agent_nickname: 'Aristotle',
            agent_role: 'explorer'
          }
        }
      },
      agent_nickname: 'Aristotle',
      agent_role: 'explorer'
    },
    userMessages: [{
      text: '# Context from my IDE setup:\n\n## Open tabs:\n- foo.ts: foo.ts\n\n## My request for Codex:\nSpawn a subagent to explore this repo.',
      messageType: 'message'
    }],
    extraRecords: [{
      timestamp: '2026-03-28T00:00:04.000Z',
      type: 'turn_context',
      payload: {
        cwd: 'C:\\Users\\Test\\Workspace',
        approval_policy: 'never',
        sandbox_policy: { type: 'danger-full-access' },
        model: 'gpt-5.4',
        effort: 'xhigh'
      }
    }]
  });

  const result = repairSessionIndexes(sessionsDir);

  assert.equal(result.insertedThreads, 1);
  const row = readThreadRow(path.join(root, 'state_5.sqlite'), 'subagent-session');
  assert.equal(row.title, 'Spawn a subagent to explore this repo.');
  assert.equal(row.first_user_message, 'Spawn a subagent to explore this repo.');
  assert.equal(row.source, JSON.stringify({
    subagent: {
      thread_spawn: {
        parent_thread_id: 'parent-thread',
        depth: 1,
        agent_nickname: 'Aristotle',
        agent_role: 'explorer'
      }
    }
  }));
  assert.equal(row.agent_nickname, 'Aristotle');
  assert.equal(row.agent_role, 'explorer');
  assert.equal(row.approval_mode, 'never');
  assert.equal(row.sandbox_policy, JSON.stringify({ type: 'danger-full-access' }));
  assert.equal(row.model, 'gpt-5.4');
  assert.equal(row.reasoning_effort, 'xhigh');
  assert.equal(row.memory_mode, 'enabled');
  assert.match(row.cwd, /Workspace$/);

  if (process.platform === 'win32') {
    assert.match(row.cwd, /^\\\\\?\\/);
  }
});

test('repairSessionIndexes can rewrite a canonical session_index file', () => {
  const { root, sessionsDir } = createTempSessionsDir();
  const firstPath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'first.jsonl'), {
    id: 'repair-first',
    provider: 'openai',
    prompt: 'First canonical title'
  });
  const secondPath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'second.jsonl'), {
    id: 'repair-second',
    provider: 'codexmanager',
    prompt: 'Second canonical title'
  });
  createTempStateDb(root, [{
    id: 'repair-first',
    rolloutPath: firstPath,
    modelProvider: 'openai'
  }, {
    id: 'repair-second',
    rolloutPath: secondPath,
    modelProvider: 'codexmanager'
  }]);

  const sessionIndexPath = getSessionIndexPath(sessionsDir);
  fs.writeFileSync(sessionIndexPath, [
    JSON.stringify({ id: 'repair-first', thread_name: 'Outdated title', updated_at: '2025-01-01T00:00:00.000Z' }),
    JSON.stringify({ id: 'repair-first', thread_name: 'Duplicate stale title', updated_at: '2025-01-02T00:00:00.000Z' })
  ].join('\n').concat('\n'), 'utf8');

  const result = repairSessionIndexes(sessionsDir, {
    repairSessionIndex: true,
    rewriteSessionIndex: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.rewroteSessionIndex, true);
  assert.equal(result.addedSessionIndexEntries, 1);
  assert.equal(result.sessionIndexEntriesWritten, 2);
  assert.ok(result.sessionIndexBackupPath);

  const entries = fs.readFileSync(sessionIndexPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.deepEqual(entries.map((entry) => entry.id).sort(), ['repair-first', 'repair-second']);
  assert.equal(entries.find((entry) => entry.id === 'repair-first').thread_name, 'First canonical title');
  assert.equal(entries.find((entry) => entry.id === 'repair-second').thread_name, 'Second canonical title');
});

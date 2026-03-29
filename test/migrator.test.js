'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  createTempSessionsDir,
  createTempStateDb,
  readThreadProvider,
  writeSessionFile
} = require('./helpers');
const { parseFirstLine } = require('../src/scanner');
const { migrateSessions, previewMigration, restoreFromBackup } = require('../src/migrator');
const { getSessionIndexPath } = require('../src/session-indexes');

test('previewMigration refuses to target every session without an explicit scope', () => {
  const { sessionsDir } = createTempSessionsDir();
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'one.jsonl'));

  assert.throws(() => {
    previewMigration(sessionsDir, {}, 'crs');
  }, /Refusing to target every session/i);
});

test('previewMigration can return localized validation errors', () => {
  const { sessionsDir } = createTempSessionsDir();
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'one.jsonl'));

  assert.throws(() => {
    previewMigration(sessionsDir, {}, 'crs', { locale: 'zh-CN' });
  }, /拒绝|筛选条件|会话库/);
});

test('migrateSessions rewrites provider and creates a restorable backup manifest', () => {
  const { root, sessionsDir } = createTempSessionsDir();
  const filePath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'one.jsonl'), {
    provider: 'openai',
    id: 'session-one'
  });
  const stateDbPath = createTempStateDb(root, [{
    id: 'session-one',
    rolloutPath: filePath,
    modelProvider: 'openai'
  }]);

  const result = migrateSessions(sessionsDir, { filePaths: [filePath] }, 'crs');

  assert.equal(result.migrated, 1);
  assert.equal(result.failed, 0);
  assert.ok(result.backupId);
  assert.equal(parseFirstLine(filePath).model_provider, 'crs');
  assert.equal(readThreadProvider(stateDbPath, 'session-one'), 'crs');

  const restored = restoreFromBackup(result.backupId, sessionsDir);
  assert.equal(restored.restored, 1);
  assert.equal(parseFirstLine(filePath).model_provider, 'openai');
  assert.equal(readThreadProvider(stateDbPath, 'session-one'), 'openai');
});

test('migrateSessions repairs missing thread rows and session index entries', () => {
  const { root, sessionsDir } = createTempSessionsDir();
  const filePath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'missing-thread.jsonl'), {
    provider: 'openai',
    id: 'session-missing-thread'
  });
  const stateDbPath = createTempStateDb(root, []);

  const result = migrateSessions(sessionsDir, { filePaths: [filePath] }, 'crs');

  assert.equal(result.migrated, 1);
  assert.equal(result.failed, 0);
  assert.equal(parseFirstLine(filePath).model_provider, 'crs');
  assert.equal(readThreadProvider(stateDbPath, 'session-missing-thread'), 'crs');
  const sessionIndexEntries = fs.readFileSync(getSessionIndexPath(sessionsDir), 'utf8');
  assert.match(sessionIndexEntries, /session-missing-thread/);

  const restored = restoreFromBackup(result.backupId, sessionsDir);
  assert.equal(restored.restored, 1);
  assert.equal(parseFirstLine(filePath).model_provider, 'openai');
  assert.equal(readThreadProvider(stateDbPath, 'session-missing-thread'), 'openai');
  const restoredSessionIndexEntries = fs.readFileSync(getSessionIndexPath(sessionsDir), 'utf8');
  assert.match(restoredSessionIndexEntries, /session-missing-thread/);
});

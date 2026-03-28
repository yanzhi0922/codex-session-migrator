'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempSessionsDir, writeSessionFile } = require('./helpers');
const { parseFirstLine } = require('../src/scanner');
const { migrateSessions, previewMigration, restoreFromBackup } = require('../src/migrator');

test('previewMigration refuses to target every session without an explicit scope', () => {
  const { sessionsDir } = createTempSessionsDir();
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'one.jsonl'));

  assert.throws(() => {
    previewMigration(sessionsDir, {}, 'crs');
  }, /Refusing to target every session/i);
});

test('migrateSessions rewrites provider and creates a restorable backup manifest', () => {
  const { sessionsDir } = createTempSessionsDir();
  const filePath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'one.jsonl'), {
    provider: 'openai',
    id: 'session-one'
  });

  const result = migrateSessions(sessionsDir, { filePaths: [filePath] }, 'crs');

  assert.equal(result.migrated, 1);
  assert.equal(result.failed, 0);
  assert.ok(result.backupId);
  assert.equal(parseFirstLine(filePath).model_provider, 'crs');

  const restored = restoreFromBackup(result.backupId, sessionsDir);
  assert.equal(restored.restored, 1);
  assert.equal(parseFirstLine(filePath).model_provider, 'openai');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempSessionsDir, createTempStateDb, writeSessionFile } = require('./helpers');
const {
  extractRecentUserPrompts,
  getOverview,
  listBackups,
  runDoctor,
  sanitizeUserPrompt,
  scanSessions
} = require('../src/scanner');
const { createBackupSnapshot, getBackupRoot } = require('../src/backup-store');

test('scanSessions returns provider stats and prompt previews', () => {
  const { sessionsDir } = createTempSessionsDir();

  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'one.jsonl'), {
    id: 'session-one',
    provider: 'openai',
    prompt: 'Migrate my Codex conversations safely'
  });
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'two.jsonl'), {
    id: 'session-two',
    provider: 'crs',
    prompt: 'Use CRS for this run'
  });

  const result = scanSessions(sessionsDir, {
    provider: 'openai',
    search: 'migrate',
    includePreview: true
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].provider, 'openai');
  assert.match(result.items[0].preview, /Migrate my Codex conversations safely/);
  assert.deepEqual(result.providers, [
    { name: 'crs', count: 1 },
    { name: 'openai', count: 1 }
  ]);
});

test('extractRecentUserPrompts strips harness noise and keeps newest useful prompts first', () => {
  const { sessionsDir } = createTempSessionsDir();
  const filePath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'noisy.jsonl'), {
    id: 'session-noisy',
    provider: 'openai',
    userMessages: [
      {
        text: '<environment_context>\n<cwd>C:\\Users\\Noise\\Workspace</cwd>\n</environment_context>',
        messageType: 'message'
      },
      {
        text: '最早的有效提示',
        messageType: 'response_item'
      },
      {
        text: '# AGENTS.md instructions\n<INSTRUCTIONS>\nDo not show this\n</INSTRUCTIONS>',
        messageType: 'message'
      },
      {
        text: '第二条有效提示\n- 保留列表\n- 保留结构',
        messageType: 'message'
      },
      {
        text: '<turn_aborted>\ninterrupted\n</turn_aborted>\n最后一条有效提示\n\n```js\nconsole.log(1)\n```',
        messageType: 'response_item'
      },
      {
        text: '<subagent_notification>{"agent_path":"worker-1","status":{"errored":"stream disconnected"}}</subagent_notification>',
        messageType: 'message'
      }
    ]
  });

  assert.deepEqual(extractRecentUserPrompts(filePath, { limit: 5 }), [
    '最后一条有效提示\n\n```js\nconsole.log(1)\n```',
    '第二条有效提示\n- 保留列表\n- 保留结构',
    '最早的有效提示'
  ]);
});

test('sanitizeUserPrompt removes injected context but keeps useful user text', () => {
  assert.equal(
    sanitizeUserPrompt(
      '<environment_context>\n<cwd>C:\\Users\\Noise\\Workspace</cwd>\n</environment_context>\n请优化 Prompt Preview'
    ),
    '请优化 Prompt Preview'
  );

  assert.equal(
    sanitizeUserPrompt('# AGENTS.md instructions\n<INSTRUCTIONS>\nIgnore this payload\n</INSTRUCTIONS>'),
    null
  );

  assert.equal(
    sanitizeUserPrompt(
      '# Context from my IDE setup:\n\n## Open tabs:\n- foo.ts: foo.ts\n- bar.ts: bar.ts\n\n## My request for Codex:\n请继续优化前端预览'
    ),
    '请继续优化前端预览'
  );

  assert.equal(
    sanitizeUserPrompt(
      '请继续修复这个问题\n\n2 files changed\n+62\n-33\nUndo\n\nReview\nsrc/foo.rs\nsrc/bar.rs'
    ),
    '请继续修复这个问题'
  );

  assert.equal(
    sanitizeUserPrompt('请帮我检查 sk-cp-lzn833KXk_k6Oc1YjCaU3XTnfv0tvxoWyT0PgN6EUIQxfmeVuLci9w1VKOcyAwjd0kmkIZfGH'),
    '请帮我检查 [redacted-key]'
  );
});

test('scanSessions search includes sanitized recent prompts and preview prefers latest useful prompt', () => {
  const { sessionsDir } = createTempSessionsDir();

  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'searchable.jsonl'), {
    id: 'session-searchable',
    provider: 'openai',
    userMessages: [
      {
        text: '最开始的提示',
        messageType: 'response_item'
      },
      {
        text: '中间提示\n- 包含结构化列表',
        messageType: 'message'
      },
      {
        text: '<environment_context>\n<cwd>C:\\Users\\Noise\\Workspace</cwd>\n</environment_context>\n最新提示：请把预览改成倒序',
        messageType: 'response_item'
      }
    ]
  });

  const result = scanSessions(sessionsDir, {
    provider: 'openai',
    search: '结构化列表',
    includePreview: true
  });

  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].recentPrompts, [
    '最新提示：请把预览改成倒序',
    '中间提示\n- 包含结构化列表',
    '最开始的提示'
  ]);
  assert.match(result.items[0].preview, /最新提示：请把预览改成倒序/);
});

test('listBackups ignores non-manifest directories by default', () => {
  const { sessionsDir } = createTempSessionsDir();
  const filePath = writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'backup-source.jsonl'), {
    id: 'backup-source',
    provider: 'openai',
    prompt: 'Create a backup snapshot'
  });

  const invalidBackupDir = path.join(getBackupRoot(sessionsDir), 'invalid-empty-files-20260328');
  fs.mkdirSync(invalidBackupDir, { recursive: true });

  createBackupSnapshot(sessionsDir, [{
    id: 'backup-source',
    filePath,
    relativePath: path.join('2026', '03', '28', 'backup-source.jsonl'),
    provider: 'openai',
    timestamp: '2026-03-28T00:00:00.000Z',
    cwd: 'C:\\Users\\Test\\Workspace'
  }], {
    label: 'migration',
    reason: 'Pre-migration snapshot',
    sourceProvider: 'openai',
    targetProvider: 'codexmanager'
  });

  const backups = listBackups(sessionsDir);
  const overview = getOverview(sessionsDir);

  assert.equal(backups.length, 1);
  assert.equal(backups[0].label, 'migration');
  assert.equal(overview.totals.backups, 1);
});

test('runDoctor reports invalid first lines', () => {
  const { sessionsDir } = createTempSessionsDir();

  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'good.jsonl'));
  const brokenFile = path.join(sessionsDir, '2026', '03', '28', 'broken.jsonl');
  fs.mkdirSync(path.dirname(brokenFile), { recursive: true });
  fs.writeFileSync(brokenFile, 'not-json\n', 'utf8');

  const doctor = runDoctor(sessionsDir);

  assert.equal(doctor.ok, false);
  assert.equal(doctor.summary.invalidMetaCount, 1);
  assert.match(doctor.issues[0].message, /cannot be parsed/i);
});

test('runDoctor localizes issue messages for zh-CN', () => {
  const { sessionsDir } = createTempSessionsDir();
  const brokenFile = path.join(sessionsDir, '2026', '03', '28', 'broken.jsonl');
  fs.mkdirSync(path.dirname(brokenFile), { recursive: true });
  fs.writeFileSync(brokenFile, 'not-json\n', 'utf8');

  const doctor = runDoctor(sessionsDir, { locale: 'zh-CN' });

  assert.match(doctor.issues[0].message, /第一条|JSONL|session_meta/);
});

test('runDoctor reports missing SQLite thread rows', () => {
  const { root, sessionsDir } = createTempSessionsDir();
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'repair-needed.jsonl'), {
    id: 'repair-needed',
    provider: 'codexmanager',
    prompt: '请修复显示问题'
  });
  createTempStateDb(root, []);

  const doctor = runDoctor(sessionsDir);

  assert.equal(doctor.ok, false);
  assert.equal(doctor.summary.missingThreadCount, 1);
  assert.equal(doctor.summary.providerMismatchCount, 0);
  assert.equal(doctor.summary.missingSessionIndexCount, 0);
  assert.ok(doctor.issues.some((issue) => issue.type === 'missing_thread'));
});

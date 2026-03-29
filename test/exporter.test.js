'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempSessionsDir, writeSessionFile } = require('./helpers');
const { buildSessionExport, writeSessionExport } = require('../src/exporter');

test('buildSessionExport extracts a structured transcript and localized metadata', () => {
  const { sessionsDir } = createTempSessionsDir();

  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'export-source.jsonl'), {
    id: 'export-source',
    provider: 'codexmanager',
    userMessages: [
      {
        text: '<environment_context>\n  <cwd>C:\\Users\\Noise\\Workspace</cwd>\n</environment_context>\n请导出这一段会话',
        messageType: 'response_item'
      }
    ],
    extraRecords: [
      {
        timestamp: '2026-03-28T00:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '这是导出的回答。'
            }
          ]
        }
      }
    ]
  });

  const artifact = buildSessionExport(sessionsDir, { allowAll: true }, 'json', {
    locale: 'zh-CN'
  });

  assert.equal(artifact.format, 'json');
  assert.equal(artifact.contentType, 'application/json; charset=utf-8');
  assert.equal(artifact.sessionCount, 1);
  assert.equal(artifact.sessions[0].id, 'export-source');
  assert.equal(artifact.sessions[0].transcript.length, 2);
  assert.deepEqual(artifact.sessions[0].transcript.map((entry) => entry.role), ['user', 'assistant']);
  assert.equal(artifact.sessions[0].transcript[0].text, '请导出这一段会话');
  assert.equal(artifact.sessions[0].transcript[1].text, '这是导出的回答。');
  assert.match(artifact.fileName, /^codex-session-export-codexmanager-1x-.*\.json$/);

  const payload = JSON.parse(artifact.content);
  assert.equal(payload.locale, 'zh-CN');
  assert.equal(payload.sessions[0].stats.userTurns, 1);
  assert.equal(payload.sessions[0].stats.assistantTurns, 1);
});

test('writeSessionExport writes into an existing output directory', () => {
  const { sessionsDir, root } = createTempSessionsDir();
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'export-dir.jsonl'), {
    id: 'export-dir',
    provider: 'openai',
    prompt: 'Write this export to a directory'
  });

  const artifact = buildSessionExport(sessionsDir, { allowAll: true }, 'txt');
  const outputDir = path.join(root, 'downloads');
  fs.mkdirSync(outputDir, { recursive: true });

  const saved = writeSessionExport(sessionsDir, artifact, {
    outputPath: outputDir
  });

  assert.equal(path.dirname(saved.outputPath), outputDir);
  assert.equal(fs.existsSync(saved.outputPath), true);
  assert.match(fs.readFileSync(saved.outputPath, 'utf8'), /CODEX SESSION EXPORT/);
});

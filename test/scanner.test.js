'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempSessionsDir, writeSessionFile } = require('./helpers');
const { runDoctor, scanSessions } = require('../src/scanner');

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

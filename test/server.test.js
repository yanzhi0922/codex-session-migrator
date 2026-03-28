'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempSessionsDir, writeSessionFile } = require('./helpers');
const { startServer } = require('../src/server');

test('HTTP API serves overview and sessions', async () => {
  const { sessionsDir } = createTempSessionsDir();
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'one.jsonl'), {
    provider: 'openai'
  });

  const app = await startServer({
    host: '127.0.0.1',
    port: 0,
    sessionsDir
  });

  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const overviewResponse = await fetch(`${baseUrl}/api/overview`);
    const overviewPayload = await overviewResponse.json();
    assert.equal(overviewPayload.ok, true);
    assert.equal(overviewPayload.overview.totals.sessions, 1);

    const htmlResponse = await fetch(`${baseUrl}/`);
    const html = await htmlResponse.text();
    assert.match(html, /Codex Session Migrator/);
  } finally {
    await new Promise((resolve, reject) => {
      app.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

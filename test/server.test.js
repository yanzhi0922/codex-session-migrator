'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempSessionsDir, createTempStateDb, writeSessionFile } = require('./helpers');
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
    const configResponse = await fetch(`${baseUrl}/api/app-config?lang=zh-CN`);
    const configPayload = await configResponse.json();
    assert.equal(configPayload.ok, true);
    assert.equal(configPayload.locale, 'zh-CN');
    assert.equal(configPayload.messages.hero.language, '语言');

    const overviewResponse = await fetch(`${baseUrl}/api/overview`);
    const overviewPayload = await overviewResponse.json();
    assert.equal(overviewPayload.ok, true);
    assert.equal(overviewPayload.overview.totals.sessions, 1);

    const dashboardResponse = await fetch(`${baseUrl}/api/dashboard?includePreview=1`);
    const dashboardPayload = await dashboardResponse.json();
    assert.equal(dashboardPayload.ok, true);
    assert.equal(dashboardPayload.overview.totals.sessions, 1);
    assert.equal(dashboardPayload.sessions.total, 1);
    assert.equal(Array.isArray(dashboardPayload.backups), true);
    assert.equal(dashboardPayload.doctor.summary.totalFiles, 1);

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

test('HTTP API can repair missing indexes', async () => {
  const { root, sessionsDir } = createTempSessionsDir();
  writeSessionFile(sessionsDir, path.join('2026', '03', '28', 'repair-api.jsonl'), {
    id: 'repair-api',
    provider: 'openai',
    prompt: 'Repair missing indexes'
  });
  createTempStateDb(root, []);

  const app = await startServer({
    host: '127.0.0.1',
    port: 0,
    sessionsDir
  });

  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/indexes/repair`, {
      method: 'POST'
    });
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.repair.insertedThreads, 1);
    assert.equal(payload.repair.rewroteSessionIndex, true);
    assert.equal(payload.repair.sessionIndexEntriesWritten, 1);
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

test('startServer falls back to the next port when the default is busy', async () => {
  const firstApp = await startServer({
    host: '127.0.0.1',
    port: 5730
  });

  try {
    const secondApp = await startServer({
      host: '127.0.0.1',
      port: 5730,
      maxPortAttempts: 3
    });

    try {
      assert.notEqual(secondApp.port, firstApp.port);
      assert.equal(secondApp.port, firstApp.port + 1);
    } finally {
      await new Promise((resolve, reject) => {
        secondApp.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  } finally {
    await new Promise((resolve, reject) => {
      firstApp.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createTempSessionsDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-migrator-'));
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return { root, sessionsDir };
}

function writeSessionFile(sessionsDir, relativePath, options = {}) {
  const filePath = path.join(sessionsDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const sessionMeta = {
    type: 'session_meta',
    payload: {
      id: options.id || relativePath.replace(/[\\/]/g, '-'),
      model_provider: options.provider || 'openai',
      timestamp: options.timestamp || '2026-03-28T00:00:00.000Z',
      cwd: options.cwd || 'C:\\Users\\Test\\Workspace',
      cli_version: '0.115.0-alpha.27',
      originator: 'Codex Desktop'
    }
  };

  const userMessage = {
    type: 'response_item',
    payload: {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: options.prompt || 'Hello from test'
        }
      ]
    }
  };

  fs.writeFileSync(
    filePath,
    `${JSON.stringify(sessionMeta)}\n${JSON.stringify(userMessage)}\n`,
    'utf8'
  );

  return filePath;
}

module.exports = {
  createTempSessionsDir,
  writeSessionFile
};

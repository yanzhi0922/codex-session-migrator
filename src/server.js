'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createRouter } = require('./routes');
const { getSessionsDir } = require('./scanner');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function serveStaticAsset(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const relativePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const absolutePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendNotFound(res);
    return;
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    sendNotFound(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': getMimeType(absolutePath),
    'Cache-Control': absolutePath.endsWith('.html') ? 'no-store' : 'public, max-age=600'
  });
  res.end(fs.readFileSync(absolutePath));
}

function createAppServer(options = {}) {
  const sessionsDir = getSessionsDir(options.sessionsDir);
  const router = createRouter(sessionsDir);

  const server = http.createServer(async (req, res) => {
    const handled = await router(req, res);
    if (handled) {
      return;
    }
    serveStaticAsset(req, res);
  });

  return {
    server,
    sessionsDir
  };
}

function startServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const rawPort = options.port !== undefined ? options.port : (process.env.PORT || 5730);
  const basePort = Number(rawPort);
  const maxAttempts = Math.max(1, Number(options.maxPortAttempts) || 10);
  const app = createAppServer(options);

  function tryListen(offset = 0) {
    const port = basePort + offset;

    return new Promise((resolve, reject) => {
      const handleError = (error) => {
        app.server.off('error', handleError);

        if (error && error.code === 'EADDRINUSE' && offset + 1 < maxAttempts) {
          resolve(tryListen(offset + 1));
          return;
        }

        reject(error);
      };

      app.server.once('error', handleError);
      app.server.listen(port, host, () => {
        app.server.off('error', handleError);
        resolve({
          host,
          port,
          sessionsDir: app.sessionsDir,
          server: app.server,
          url: `http://${host}:${port}`
        });
      });
    });
  }

  return tryListen(0);
}

module.exports = {
  PUBLIC_DIR,
  createAppServer,
  startServer
};

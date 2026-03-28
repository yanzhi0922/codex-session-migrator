'use strict';

const {
  getOverview,
  getProviders,
  getSessionDetail,
  getSessionsDir,
  listBackups,
  runDoctor,
  scanSessions
} = require('./scanner');
const {
  migrateSessions,
  previewMigration,
  restoreFromBackup
} = require('./migrator');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, {
    ok: false,
    error: message,
    details: details || null
  });
}

function handleOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function parseListQuery(url) {
  return {
    includePreview: url.searchParams.get('includePreview') === '1',
    provider: url.searchParams.get('provider') || '',
    search: url.searchParams.get('search') || '',
    page: Math.max(1, Number(url.searchParams.get('page')) || 1),
    limit: Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 50))
  };
}

function createRouter(sessionsDir) {
  const resolvedSessionsDir = getSessionsDir(sessionsDir);

  return async function routeRequest(req, res) {
    if (req.method === 'OPTIONS') {
      handleOptions(res);
      return true;
    }

    const url = new URL(req.url, 'http://127.0.0.1');

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          sessionsDir: resolvedSessionsDir,
          uptimeSeconds: process.uptime()
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/overview') {
        sendJson(res, 200, {
          ok: true,
          overview: getOverview(resolvedSessionsDir)
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/providers') {
        sendJson(res, 200, {
          ok: true,
          providers: getProviders(resolvedSessionsDir)
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/sessions') {
        sendJson(res, 200, {
          ok: true,
          ...scanSessions(resolvedSessionsDir, parseListQuery(url))
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/session') {
        const filePath = url.searchParams.get('path');
        if (!filePath) {
          sendError(res, 400, 'Missing required query parameter: path');
          return true;
        }

        const detail = getSessionDetail(filePath, resolvedSessionsDir);
        if (!detail) {
          sendError(res, 404, 'Session not found or session_meta could not be parsed.');
          return true;
        }

        sendJson(res, 200, {
          ok: true,
          session: detail
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/backups') {
        sendJson(res, 200, {
          ok: true,
          backups: listBackups(resolvedSessionsDir)
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/doctor') {
        sendJson(res, 200, {
          ok: true,
          doctor: runDoctor(resolvedSessionsDir)
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/migrations/preview') {
        const body = await readBody(req);
        if (!body.targetProvider) {
          sendError(res, 400, 'targetProvider is required.');
          return true;
        }

        sendJson(res, 200, {
          ok: true,
          preview: previewMigration(resolvedSessionsDir, body.selection || body, body.targetProvider)
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/migrations/run') {
        const body = await readBody(req);
        if (!body.targetProvider) {
          sendError(res, 400, 'targetProvider is required.');
          return true;
        }

        sendJson(res, 200, migrateSessions(
          resolvedSessionsDir,
          body.selection || body,
          body.targetProvider,
          { dryRun: Boolean(body.dryRun) }
        ));
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/backups/restore') {
        const body = await readBody(req);
        const backupDir = body.backupDir || body.backupId;
        if (!backupDir) {
          sendError(res, 400, 'backupDir or backupId is required.');
          return true;
        }

        sendJson(res, 200, restoreFromBackup(backupDir, resolvedSessionsDir));
        return true;
      }
    } catch (error) {
      sendError(res, 500, error.message);
      return true;
    }

    return false;
  };
}

module.exports = {
  createRouter
};

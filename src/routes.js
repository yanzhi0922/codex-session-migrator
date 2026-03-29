'use strict';

const {
  getDashboardData,
  getOverview,
  getProviders,
  getSessionDetail,
  getSessionsDir,
  listBackups,
  runDoctor,
  scanSessions
} = require('./scanner');
const { buildSessionExport } = require('./exporter');
const {
  migrateSessions,
  previewMigration,
  restoreFromBackup
} = require('./migrator');
const { repairSessionIndexes } = require('./session-indexes');
const {
  createTranslator,
  getClientMessages,
  getLocaleOptions,
  normalizeLocale,
  parseAcceptLanguage
} = require('./i18n');

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

function sendDownload(res, statusCode, fileName, contentType, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');

  res.writeHead(statusCode, {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Disposition': `attachment; filename="${String(fileName || 'download').replace(/"/g, '')}"`
  });
  res.end(buffer);
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
        const invalidJsonError = new Error('Request body must be valid JSON.');
        invalidJsonError.code = 'invalid_json';
        reject(invalidJsonError);
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

function parseDashboardQuery(url) {
  return {
    ...parseListQuery(url),
    includeDoctor: url.searchParams.get('includeDoctor') !== '0',
    includeBackups: url.searchParams.get('includeBackups') !== '0'
  };
}

function resolveRequestLocale(req, url, body = null) {
  return normalizeLocale(
    (body && body.lang) ||
    url.searchParams.get('lang') ||
    parseAcceptLanguage(req.headers['accept-language'])
  );
}

function createRouter(sessionsDir) {
  const resolvedSessionsDir = getSessionsDir(sessionsDir);

  return async function routeRequest(req, res) {
    if (req.method === 'OPTIONS') {
      handleOptions(res);
      return true;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const locale = resolveRequestLocale(req, url);
    const { t } = createTranslator(locale);

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          sessionsDir: resolvedSessionsDir,
          uptimeSeconds: process.uptime()
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/app-config') {
        sendJson(res, 200, {
          ok: true,
          locale,
          locales: getLocaleOptions(locale),
          messages: getClientMessages(locale)
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const query = parseDashboardQuery(url);
        sendJson(res, 200, {
          ok: true,
          ...getDashboardData(resolvedSessionsDir, {
            ...query,
            locale,
            t
          })
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/overview') {
        sendJson(res, 200, {
          ok: true,
          overview: getOverview(resolvedSessionsDir, { locale })
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
          ...scanSessions(resolvedSessionsDir, {
            ...parseListQuery(url),
            locale
          })
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/session') {
        const filePath = url.searchParams.get('path');
        if (!filePath) {
          sendError(res, 400, t('errors.missingQueryPath'));
          return true;
        }

        const detail = getSessionDetail(filePath, resolvedSessionsDir, { locale, t });
        if (!detail) {
          sendError(res, 404, t('errors.sessionNotFound'));
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
          backups: listBackups(resolvedSessionsDir, { locale })
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/doctor') {
        sendJson(res, 200, {
          ok: true,
          doctor: runDoctor(resolvedSessionsDir, { locale, t })
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/migrations/preview') {
        const body = await readBody(req);
        const requestLocale = resolveRequestLocale(req, url, body);
        const translator = createTranslator(requestLocale);
        if (!body.targetProvider) {
          sendError(res, 400, translator.t('errors.targetProviderRequired'));
          return true;
        }

        sendJson(res, 200, {
          ok: true,
          preview: previewMigration(
            resolvedSessionsDir,
            body.selection || body,
            body.targetProvider,
            translator
          )
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/exports/download') {
        const body = await readBody(req);
        const requestLocale = resolveRequestLocale(req, url, body);
        const translator = createTranslator(requestLocale);
        const artifact = buildSessionExport(
          resolvedSessionsDir,
          body.selection || body,
          body.format || 'markdown',
          translator
        );

        sendDownload(
          res,
          200,
          artifact.fileName,
          artifact.contentType,
          artifact.content
        );
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/migrations/run') {
        const body = await readBody(req);
        const requestLocale = resolveRequestLocale(req, url, body);
        const translator = createTranslator(requestLocale);
        if (!body.targetProvider) {
          sendError(res, 400, translator.t('errors.targetProviderRequired'));
          return true;
        }

        sendJson(res, 200, migrateSessions(
          resolvedSessionsDir,
          body.selection || body,
          body.targetProvider,
          {
            dryRun: Boolean(body.dryRun),
            locale: translator.locale,
            t: translator.t
          }
        ));
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/backups/restore') {
        const body = await readBody(req);
        const requestLocale = resolveRequestLocale(req, url, body);
        const translator = createTranslator(requestLocale);
        const backupDir = body.backupDir || body.backupId;
        if (!backupDir) {
          sendError(res, 400, translator.t('errors.backupIdentifierRequired'));
          return true;
        }

        sendJson(res, 200, restoreFromBackup(backupDir, resolvedSessionsDir, translator));
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/indexes/repair') {
        sendJson(res, 200, {
          ok: true,
          repair: repairSessionIndexes(resolvedSessionsDir, {
            repairSessionIndex: true,
            rewriteSessionIndex: true
          })
        });
        return true;
      }
    } catch (error) {
      if (error && error.code === 'invalid_json') {
        sendError(res, 400, t('errors.requestBodyJson'));
        return true;
      }

      sendError(res, 500, error.message);
      return true;
    }

    return false;
  };
}

module.exports = {
  createRouter
};

'use strict';

const fs = require('fs');
const path = require('path');
const {
  formatBytesDisplay,
  formatDisplayTimestamp,
  formatTimestamp,
  slugify
} = require('./format');
const { createTranslator } = require('./i18n');
const { resolveSelectedSessions } = require('./migrator');
const {
  extractTailInsights,
  extractUserInputText,
  getSessionsDir,
  parseFirstLine,
  sanitizeUserPrompt
} = require('./scanner');

const SUPPORTED_EXPORT_FORMATS = new Set(['markdown', 'html', 'json', 'jsonl', 'csv', 'txt']);

function resolveTranslator(options = {}) {
  if (typeof options.t === 'function') {
    return {
      locale: options.locale || 'en',
      t: options.t
    };
  }

  return createTranslator(options.locale);
}

function getExportRoot(sessionsDir) {
  return path.join(path.dirname(getSessionsDir(sessionsDir)), 'exports');
}

function validateExportFormat(value, options = {}) {
  const { t } = resolveTranslator(options);
  const format = String(value || '').trim().toLowerCase();

  if (!format) {
    throw new Error(t('errors.exportFormatRequired'));
  }

  if (!SUPPORTED_EXPORT_FORMATS.has(format)) {
    throw new Error(t('errors.exportFormatInvalid', { format }));
  }

  return format;
}

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeTranscriptText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-key]')
    .replace(/\b(?:ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{16,}\b/g, '[redacted-key]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractAssistantText(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  let content = null;
  if (
    record.type === 'response_item' &&
    record.payload &&
    record.payload.role === 'assistant' &&
    Array.isArray(record.payload.content)
  ) {
    content = record.payload.content;
  } else if (
    record.type === 'message' &&
    record.role === 'assistant' &&
    Array.isArray(record.content)
  ) {
    content = record.content;
  }

  if (!content) {
    return null;
  }

  const parts = [];

  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    if (
      (item.type === 'output_text' || item.type === 'text' || item.type === 'markdown') &&
      typeof item.text === 'string' &&
      item.text.trim()
    ) {
      parts.push(item.text);
      continue;
    }

    if (item.type === 'output_text' && item.text && typeof item.text.value === 'string') {
      parts.push(item.text.value);
    }
  }

  return parts.length ? parts.join('\n\n') : null;
}

function dedupeTranscript(messages) {
  const items = [];

  for (const message of messages) {
    const previous = items.at(-1);
    if (
      previous &&
      previous.role === message.role &&
      previous.text === message.text
    ) {
      continue;
    }

    items.push(message);
  }

  return items;
}

function extractTranscript(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const messages = [];

  for (const line of lines) {
    const record = tryParseJsonLine(line);
    if (!record) {
      continue;
    }

    const userText = sanitizeUserPrompt(extractUserInputText(record));
    if (userText) {
      messages.push({
        role: 'user',
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
        text: userText
      });
      continue;
    }

    const assistantText = normalizeTranscriptText(extractAssistantText(record));
    if (assistantText) {
      messages.push({
        role: 'assistant',
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
        text: assistantText
      });
    }
  }

  return dedupeTranscript(messages);
}

function buildExportSessionRecord(item, sessionsDir, options = {}) {
  const { locale } = resolveTranslator(options);
  const meta = parseFirstLine(item.filePath) || {};
  const tailInsights = extractTailInsights(item.filePath);
  const transcript = extractTranscript(item.filePath);

  return {
    id: item.id,
    provider: item.provider,
    relativePath: item.relativePath,
    absolutePath: path.resolve(item.filePath),
    timestamp: item.timestamp || meta.timestamp || tailInsights.latestTimestamp || '',
    timestampDisplay: item.timestampDisplay || formatDisplayTimestamp(
      item.timestamp || meta.timestamp || tailInsights.latestTimestamp || '',
      locale
    ),
    cwd: item.cwd || tailInsights.latestCwd || meta.cwd || '',
    cliVersion: item.cliVersion || meta.cli_version || '',
    originator: item.originator || meta.originator || '',
    size: item.size || 0,
    sizeDisplay: item.sizeDisplay || formatBytesDisplay(item.size || 0, locale),
    preview: item.preview || null,
    recentPrompts: Array.isArray(item.recentPrompts) ? item.recentPrompts : [],
    transcript,
    stats: {
      messageCount: transcript.length,
      userTurns: transcript.filter((entry) => entry.role === 'user').length,
      assistantTurns: transcript.filter((entry) => entry.role === 'assistant').length
    }
  };
}

function toSafeTimestamp(date = new Date()) {
  return formatTimestamp(date)
    .replace(/[-:]/g, '')
    .replace(/\s+/g, '-');
}

function getFileExtension(format) {
  switch (format) {
    case 'markdown':
      return 'md';
    case 'html':
      return 'html';
    case 'json':
      return 'json';
    case 'jsonl':
      return 'jsonl';
    case 'csv':
      return 'csv';
    case 'txt':
      return 'txt';
    default:
      return 'txt';
  }
}

function buildExportFileName(format, sessions, options = {}) {
  const prefix = String(options.filePrefix || 'codex-session-export');
  const providerSet = [...new Set(sessions.map((item) => item.provider).filter(Boolean))];
  const providerSuffix = providerSet.length === 1 ? `-${slugify(providerSet[0])}` : '';
  const countSuffix = `-${sessions.length}x`;
  const timeSuffix = `-${toSafeTimestamp(options.exportedAt)}`;

  return `${prefix}${providerSuffix}${countSuffix}${timeSuffix}.${getFileExtension(format)}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMarkdownDocument(payload) {
  const lines = [
    '# Codex Session Export',
    '',
    `- Generated at: ${payload.exportedAtDisplay}`,
    `- Format: ${payload.format}`,
    `- Sessions: ${payload.sessionCount}`,
    ''
  ];

  for (const [index, session] of payload.sessions.entries()) {
    lines.push(`## ${index + 1}. ${session.id}`);
    lines.push('');
    lines.push(`- Provider: ${session.provider}`);
    lines.push(`- Time: ${session.timestampDisplay || session.timestamp || 'Unknown'}`);
    lines.push(`- Workspace: ${session.cwd || 'Unknown'}`);
    lines.push(`- Relative path: ${session.relativePath}`);
    lines.push(`- File size: ${session.sizeDisplay}`);
    lines.push('');

    if (session.preview) {
      lines.push(`> Preview: ${session.preview}`);
      lines.push('');
    }

    if (!session.transcript.length) {
      lines.push('_No transcript content could be extracted._');
      lines.push('');
      continue;
    }

    lines.push('### Transcript');
    lines.push('');

    for (const message of session.transcript) {
      const heading = message.role === 'assistant' ? 'Assistant' : 'User';
      lines.push(`#### ${heading}`);
      lines.push('');
      lines.push(message.text);
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

function renderTextDocument(payload) {
  const lines = [
    'CODEX SESSION EXPORT',
    `Generated at: ${payload.exportedAtDisplay}`,
    `Format: ${payload.format}`,
    `Sessions: ${payload.sessionCount}`,
    ''
  ];

  for (const session of payload.sessions) {
    lines.push('='.repeat(80));
    lines.push(`Session: ${session.id}`);
    lines.push(`Provider: ${session.provider}`);
    lines.push(`Time: ${session.timestampDisplay || session.timestamp || 'Unknown'}`);
    lines.push(`Workspace: ${session.cwd || 'Unknown'}`);
    lines.push(`Relative path: ${session.relativePath}`);
    lines.push(`File size: ${session.sizeDisplay}`);
    if (session.preview) {
      lines.push(`Preview: ${session.preview}`);
    }
    lines.push('');

    if (!session.transcript.length) {
      lines.push('[No transcript content could be extracted]');
      lines.push('');
      continue;
    }

    for (const message of session.transcript) {
      lines.push(`[${message.role.toUpperCase()}]`);
      lines.push(message.text);
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

function renderHtmlDocument(payload) {
  return `<!doctype html>
<html lang="${escapeHtml(payload.locale || 'en')}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Codex Session Export</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --surface: #ffffff;
        --surface-alt: #f8f5ee;
        --text: #191714;
        --muted: #6d6459;
        --accent: #c4632d;
        --border: #ddd3c5;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
        background: radial-gradient(circle at top, #fffaf1, var(--bg));
        color: var(--text);
      }
      .page {
        width: min(1100px, calc(100vw - 32px));
        margin: 32px auto 64px;
      }
      .hero, .session {
        background: rgba(255, 255, 255, 0.86);
        backdrop-filter: blur(10px);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: 0 18px 48px rgba(32, 22, 9, 0.08);
      }
      .hero {
        padding: 28px;
        margin-bottom: 20px;
      }
      h1, h2, h3 { margin: 0; }
      .hero h1 {
        font-size: clamp(2rem, 3vw, 3rem);
        letter-spacing: -0.04em;
      }
      .hero-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .hero-meta div, .meta-grid div {
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 14px 16px;
      }
      .eyebrow {
        color: var(--muted);
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .session {
        padding: 24px;
        margin-top: 20px;
      }
      .session-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        margin-bottom: 18px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(196, 99, 45, 0.25);
        color: var(--accent);
        background: rgba(196, 99, 45, 0.08);
        font-weight: 600;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }
      .preview {
        padding: 16px 18px;
        border-radius: 18px;
        background: linear-gradient(135deg, rgba(196, 99, 45, 0.08), rgba(217, 152, 84, 0.04));
        border: 1px solid rgba(196, 99, 45, 0.18);
        margin-bottom: 16px;
      }
      .turn {
        border-top: 1px solid var(--border);
        padding: 16px 0;
      }
      .turn:first-of-type {
        border-top: none;
      }
      .turn-label {
        color: var(--muted);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 8px;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font: inherit;
        line-height: 1.65;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="eyebrow">Codex Session Migrator</div>
        <h1>Codex Session Export</h1>
        <div class="hero-meta">
          <div><div class="eyebrow">Generated</div><strong>${escapeHtml(payload.exportedAtDisplay)}</strong></div>
          <div><div class="eyebrow">Format</div><strong>${escapeHtml(payload.format)}</strong></div>
          <div><div class="eyebrow">Sessions</div><strong>${escapeHtml(payload.sessionCount)}</strong></div>
        </div>
      </section>
      ${payload.sessions.map((session) => `
        <section class="session">
          <div class="session-header">
            <div>
              <div class="pill">${escapeHtml(session.provider)}</div>
              <h2>${escapeHtml(session.id)}</h2>
            </div>
            <div class="eyebrow">${escapeHtml(session.timestampDisplay || session.timestamp || 'Unknown')}</div>
          </div>
          <div class="meta-grid">
            <div><div class="eyebrow">Relative path</div><strong>${escapeHtml(session.relativePath)}</strong></div>
            <div><div class="eyebrow">Workspace</div><strong>${escapeHtml(session.cwd || 'Unknown')}</strong></div>
            <div><div class="eyebrow">File size</div><strong>${escapeHtml(session.sizeDisplay)}</strong></div>
            <div><div class="eyebrow">Turns</div><strong>${escapeHtml(session.stats.messageCount)}</strong></div>
          </div>
          ${session.preview ? `
            <div class="preview">
              <div class="eyebrow">Preview</div>
              <div>${escapeHtml(session.preview)}</div>
            </div>
          ` : ''}
          ${session.transcript.length ? session.transcript.map((message) => `
            <article class="turn">
              <div class="turn-label">${escapeHtml(message.role)}</div>
              <pre>${escapeHtml(message.text)}</pre>
            </article>
          `).join('') : `
            <article class="turn">
              <div class="turn-label">Transcript</div>
              <pre>No transcript content could be extracted.</pre>
            </article>
          `}
        </section>
      `).join('')}
    </main>
  </body>
</html>
`;
}

function renderCsvDocument(payload) {
  const rows = [
    [
      'id',
      'provider',
      'timestamp',
      'workspace',
      'relative_path',
      'message_count',
      'user_turns',
      'assistant_turns',
      'preview'
    ]
  ];

  for (const session of payload.sessions) {
    rows.push([
      session.id,
      session.provider,
      session.timestamp,
      session.cwd,
      session.relativePath,
      session.stats.messageCount,
      session.stats.userTurns,
      session.stats.assistantTurns,
      session.preview || ''
    ]);
  }

  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function renderJsonDocument(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderJsonlDocument(payload) {
  return `${payload.sessions.map((session) => JSON.stringify(session)).join('\n')}\n`;
}

function renderExportContent(payload) {
  switch (payload.format) {
    case 'markdown':
      return renderMarkdownDocument(payload);
    case 'html':
      return renderHtmlDocument(payload);
    case 'json':
      return renderJsonDocument(payload);
    case 'jsonl':
      return renderJsonlDocument(payload);
    case 'csv':
      return renderCsvDocument(payload);
    case 'txt':
    default:
      return renderTextDocument(payload);
  }
}

function getContentType(format) {
  switch (format) {
    case 'markdown':
      return 'text/markdown; charset=utf-8';
    case 'html':
      return 'text/html; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'jsonl':
      return 'application/x-ndjson; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'txt':
    default:
      return 'text/plain; charset=utf-8';
  }
}

function buildSessionExport(sessionsDir, selection, format, options = {}) {
  const { locale, t } = resolveTranslator(options);
  const safeFormat = validateExportFormat(format, { locale, t });
  const selectedSessions = resolveSelectedSessions(sessionsDir, selection, {
    includePreview: true,
    locale,
    t
  });
  if (!selectedSessions.length) {
    throw new Error(t('errors.exportSelectionEmpty'));
  }
  const exportedAt = options.exportedAt instanceof Date ? options.exportedAt : new Date();
  const sessions = selectedSessions.map((item) => buildExportSessionRecord(item, sessionsDir, {
    locale,
    t
  }));
  const fileName = buildExportFileName(safeFormat, sessions, {
    filePrefix: options.filePrefix,
    exportedAt
  });
  const payload = {
    app: 'Codex Session Migrator',
    exportedAt: exportedAt.toISOString(),
    exportedAtDisplay: formatDisplayTimestamp(exportedAt, locale),
    locale,
    format: safeFormat,
    sessionCount: sessions.length,
    sessions
  };

  return {
    ...payload,
    fileName,
    contentType: getContentType(safeFormat),
    content: renderExportContent(payload)
  };
}

function writeSessionExport(sessionsDir, exportArtifact, options = {}) {
  let outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(getExportRoot(sessionsDir), exportArtifact.fileName);

  if (options.outputPath) {
    const looksLikeDirectory = /[\\/]$/.test(String(options.outputPath));
    const existingStat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;

    if (looksLikeDirectory || (existingStat && existingStat.isDirectory())) {
      outputPath = path.join(outputPath, exportArtifact.fileName);
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, exportArtifact.content, 'utf8');

  return {
    ...exportArtifact,
    outputPath
  };
}

module.exports = {
  SUPPORTED_EXPORT_FORMATS,
  buildSessionExport,
  getExportRoot,
  validateExportFormat,
  writeSessionExport
};

const STORAGE_KEYS = {
  language: 'codex-session-migrator:language',
  preferences: 'codex-session-migrator:preferences'
};

const EXPORT_FORMATS = ['markdown', 'html', 'json', 'jsonl', 'csv', 'txt'];

const state = {
  locale: resolveInitialLocale(),
  localeOptions: [],
  messages: {},
  provider: 'all',
  search: '',
  limit: 50,
  exportFormat: 'markdown',
  page: 1,
  totalPages: 1,
  totalMatching: 0,
  sessions: [],
  providers: [],
  selected: new Set(),
  overview: null,
  backups: null,
  doctor: null,
  activeSessionPath: '',
  activeSession: null,
  detailRequestId: 0,
  isDetailOpen: false,
  loadingSession: false,
  busyAction: '',
  lastPreview: null,
  expandedPrompts: new Set(),
  deferredPanelsHandle: null,
  deferredPanelsRequestId: 0
};

const elements = {
  backupsList: document.getElementById('backupsList'),
  busyNotice: document.getElementById('busyNotice'),
  clearSelectionButton: document.getElementById('clearSelectionButton'),
  doctorIssues: document.getElementById('doctorIssues'),
  doctorSummary: document.getElementById('doctorSummary'),
  exportButton: document.getElementById('exportButton'),
  exportFormatSelect: document.getElementById('exportFormatSelect'),
  exportScopeLabel: document.getElementById('exportScopeLabel'),
  filterForm: document.getElementById('filterForm'),
  languageSelect: document.getElementById('languageSelect'),
  latestSessionAt: document.getElementById('latestSessionAt'),
  limitFilter: document.getElementById('limitFilter'),
  matchingCount: document.getElementById('matchingCount'),
  messagePanel: document.getElementById('messagePanel'),
  nextPageButton: document.getElementById('nextPageButton'),
  pageStatus: document.getElementById('pageStatus'),
  previewButton: document.getElementById('previewButton'),
  previewPanel: document.getElementById('previewPanel'),
  prevPageButton: document.getElementById('prevPageButton'),
  providerChips: document.getElementById('providerChips'),
  providerFilter: document.getElementById('providerFilter'),
  providerSuggestions: document.getElementById('providerSuggestions'),
  repairIndexesButton: document.getElementById('repairIndexesButton'),
  refreshButton: document.getElementById('refreshButton'),
  resetFiltersButton: document.getElementById('resetFiltersButton'),
  runButton: document.getElementById('runButton'),
  searchInput: document.getElementById('searchInput'),
  selectedCount: document.getElementById('selectedCount'),
  sessionDetailClose: document.getElementById('sessionDetailClose'),
  sessionDetailNext: document.getElementById('sessionDetailNext'),
  selectionMode: document.getElementById('selectionMode'),
  sessionDetailPosition: document.getElementById('sessionDetailPosition'),
  sessionDetailPrev: document.getElementById('sessionDetailPrev'),
  selectPageButton: document.getElementById('selectPageButton'),
  sessionDetailBody: document.getElementById('sessionDetailBody'),
  sessionDetailModal: document.getElementById('sessionDetailModal'),
  sessionsDir: document.getElementById('sessionsDir'),
  sessionsTableBody: document.getElementById('sessionsTableBody'),
  statCardTemplate: document.getElementById('statCardTemplate'),
  statsGrid: document.getElementById('statsGrid'),
  targetProviderInput: document.getElementById('targetProviderInput'),
  togglePageSelection: document.getElementById('togglePageSelection')
};

function normalizeLocale(locale) {
  const value = String(locale || '').trim().toLowerCase();
  if (!value) {
    return 'en';
  }
  if (value.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en';
}

function resolveInitialLocale() {
  const queryLocale = new URLSearchParams(window.location.search).get('lang');
  const storedLocale = localStorage.getItem(STORAGE_KEYS.language);
  const browserLocale = navigator.language || navigator.languages?.[0];
  return normalizeLocale(queryLocale || storedLocale || browserLocale);
}

function loadPreferences() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.preferences) || '{}');
  } catch {
    return {};
  }
}

function savePreferences() {
  localStorage.setItem(STORAGE_KEYS.language, state.locale);
  localStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify({
    provider: state.provider,
    search: state.search,
    limit: state.limit,
    exportFormat: state.exportFormat,
    targetProvider: elements.targetProviderInput.value.trim()
  }));
}

function syncUrlLocale() {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', state.locale);
  window.history.replaceState({}, '', url);
}

function syncControlsFromState() {
  elements.providerFilter.value = state.provider;
  elements.searchInput.value = state.search;
  elements.limitFilter.value = String(state.limit);
  elements.exportFormatSelect.value = state.exportFormat;
}

function getValue(object, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), object);
}

function interpolate(template, values = {}) {
  return String(template).replace(/\{([^}]+)\}/g, (match, key) => {
    return values[key] === undefined || values[key] === null ? match : String(values[key]);
  });
}

function t(key, values = {}) {
  const template = getValue(state.messages, key);
  return typeof template === 'string' ? interpolate(template, values) : key;
}

function tf(key, fallbackEn, fallbackZh, values = {}) {
  const translated = t(key, values);
  if (translated !== key) {
    return translated;
  }

  return interpolate(state.locale === 'zh-CN' ? fallbackZh : fallbackEn, values);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSearchTokens(query) {
  return [...new Set(
    String(query || '')
      .trim()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  )].sort((left, right) => right.length - left.length);
}

function applyInlinePromptFormatting(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

function renderInlinePromptMarkup(value) {
  return String(value || '')
    .split(/(`[^`\n]+`)/g)
    .map((segment) => {
      if (/^`[^`\n]+`$/.test(segment)) {
        return `<code>${escapeHtml(segment.slice(1, -1))}</code>`;
      }
      return applyInlinePromptFormatting(escapeHtml(segment));
    })
    .join('');
}

function renderInlinePromptLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => renderInlinePromptMarkup(line))
    .join('<br>');
}

function isPromptFence(line) {
  return /^\s*```/.test(line);
}

function isPromptHeading(line) {
  return /^\s*#{1,6}\s+/.test(line);
}

function isPromptQuote(line) {
  return /^\s*>\s?/.test(line);
}

function isPromptList(line) {
  return /^\s*[-*+]\s+/.test(line);
}

function isPromptOrderedList(line) {
  return /^\s*\d+[.)]\s+/.test(line);
}

function isPromptSpecialLine(line) {
  return isPromptFence(line) ||
    isPromptHeading(line) ||
    isPromptQuote(line) ||
    isPromptList(line) ||
    isPromptOrderedList(line);
}

function highlightPromptMarkup(html, query) {
  const tokens = getSearchTokens(query);
  if (!html || !tokens.length || typeof document === 'undefined') {
    return html;
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  const skipTags = new Set(['CODE', 'PRE', 'MARK', 'BUTTON']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parentTag = node.parentElement?.tagName;
      if (parentTag && skipTags.has(parentTag)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'ig');

  for (const textNode of textNodes) {
    const source = textNode.nodeValue;
    pattern.lastIndex = 0;
    if (!pattern.test(source)) {
      continue;
    }

    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match = pattern.exec(source);

    while (match) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
      }

      const mark = document.createElement('mark');
      mark.className = 'prompt-match';
      mark.textContent = match[0];
      fragment.appendChild(mark);
      lastIndex = match.index + match[0].length;
      match = pattern.exec(source);
    }

    if (lastIndex < source.length) {
      fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  return template.innerHTML;
}

function getPromptExpansionKey(contextKey, index) {
  return `${contextKey || 'prompt'}:${index}`;
}

function isLongPrompt(text) {
  const normalized = String(text || '');
  const lineCount = normalized.split('\n').length;
  return normalized.length > 420 || lineCount > 9;
}

function renderPromptMarkup(text, options = {}) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  const compact = Boolean(options.compact);
  const collapsed = Boolean(options.collapsed);

  if (!normalized) {
    return '';
  }

  const lines = normalized.split('\n');
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isPromptFence(line)) {
      const buffer = [];
      index += 1;

      while (index < lines.length && !isPromptFence(lines[index])) {
        buffer.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && isPromptFence(lines[index])) {
        index += 1;
      }

      blocks.push({
        type: 'code',
        text: buffer.join('\n').replace(/\n+$/g, '')
      });
      continue;
    }

    if (isPromptHeading(line)) {
      const match = line.match(/^\s*(#{1,6})\s+(.*)$/);
      blocks.push({
        type: 'heading',
        level: match ? match[1].length : 2,
        text: match ? match[2] : line.trim()
      });
      index += 1;
      continue;
    }

    if (isPromptQuote(line)) {
      const buffer = [];
      while (index < lines.length && isPromptQuote(lines[index])) {
        buffer.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }

      blocks.push({
        type: 'quote',
        text: buffer.join('\n')
      });
      continue;
    }

    if (isPromptList(line)) {
      const items = [];
      while (index < lines.length && isPromptList(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index += 1;
      }

      blocks.push({
        type: 'ul',
        items
      });
      continue;
    }

    if (isPromptOrderedList(line)) {
      const items = [];
      while (index < lines.length && isPromptOrderedList(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''));
        index += 1;
      }

      blocks.push({
        type: 'ol',
        items
      });
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isPromptSpecialLine(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }

    blocks.push({
      type: 'paragraph',
      text: paragraph.join('\n')
    });
  }

  const html = blocks.map((block) => {
    if (block.type === 'code') {
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    }

    if (block.type === 'quote') {
      return `<blockquote>${renderInlinePromptLines(block.text)}</blockquote>`;
    }

    if (block.type === 'ul') {
      return `<ul>${block.items.map((item) => `<li>${renderInlinePromptMarkup(item)}</li>`).join('')}</ul>`;
    }

    if (block.type === 'ol') {
      return `<ol>${block.items.map((item) => `<li>${renderInlinePromptMarkup(item)}</li>`).join('')}</ol>`;
    }

    if (block.type === 'heading') {
      const level = Math.min(4, Math.max(1, Number(block.level) || 2));
      return `<h${level}>${renderInlinePromptMarkup(block.text)}</h${level}>`;
    }

    return `<p>${renderInlinePromptLines(block.text)}</p>`;
  }).join('');

  const withHighlight = highlightPromptMarkup(html, options.highlightQuery);

  return `<div class="prompt-markup${compact ? ' is-compact' : ''}${collapsed ? ' is-collapsed' : ''}">${withHighlight}</div>`;
}

function getSessionPrompts(item) {
  const prompts = Array.isArray(item?.recentPrompts)
    ? item.recentPrompts.filter((prompt) => Boolean(String(prompt || '').trim()))
    : [];

  if (prompts.length) {
    return prompts;
  }

  return item?.preview ? [String(item.preview)] : [];
}

function renderPromptStack(prompts, options = {}) {
  const compact = Boolean(options.compact);
  const timeline = Boolean(options.timeline);
  const highlightQuery = options.highlightQuery ?? state.search;
  const sourceItems = Array.isArray(prompts)
    ? prompts.filter((prompt) => Boolean(String(prompt || '').trim()))
    : [];
  const items = compact
    ? sourceItems
      .map((prompt) => reducePromptForCompactCard(prompt))
      .filter((prompt) => Boolean(String(prompt || '').trim()))
    : sourceItems;
  const displayItems = items.length ? items : sourceItems;

  if (!displayItems.length) {
    return `<div class="prompt-stack-empty">${escapeHtml(t('common.noPreview'))}</div>`;
  }

  const maxPrompts = Math.max(1, Number(options.maxPrompts) || displayItems.length);
  const visiblePrompts = displayItems.slice(0, maxPrompts);
  const hiddenCount = Math.max(0, displayItems.length - visiblePrompts.length);

  return `
    <div class="prompt-stack${compact ? ' is-compact' : ''}${timeline ? ' is-timeline' : ''}">
      ${visiblePrompts.map((prompt, index) => {
        const tone = index === 0 ? 'latest' : 'earlier';
        const label = index === 0 ? t('common.latest') : t('common.earlier');
        const expansionKey = getPromptExpansionKey(options.contextKey, index);
        const expandable = Boolean(options.expandable) && isLongPrompt(prompt);
        const expanded = expandable && state.expandedPrompts.has(expansionKey);

        return `
          <article class="prompt-card${compact ? ' is-compact' : ''}${timeline ? ' is-timeline' : ''}">
            <div class="prompt-card-header">
              <div class="prompt-card-heading">
                ${timeline ? `<span class="prompt-index">${index + 1}</span>` : ''}
                <span class="prompt-badge ${tone}">${escapeHtml(label)}</span>
              </div>
              ${expandable ? `
                <button
                  class="button button-ghost prompt-toggle"
                  type="button"
                  data-prompt-toggle="${escapeHtml(expansionKey)}"
                >${escapeHtml(expanded ? t('common.collapse') : t('common.expand'))}</button>
              ` : ''}
            </div>
            ${renderPromptMarkup(prompt, {
              compact,
              collapsed: expandable && !expanded && !compact,
              highlightQuery
            })}
          </article>
        `;
      }).join('')}
      ${hiddenCount ? `
        <div class="prompt-stack-more">${escapeHtml(t('common.morePrompts', { count: hiddenCount }))}</div>
      ` : ''}
    </div>
  `;
}

function compactWorkspacePath(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '—';
  }

  const normalized = raw.replace(/\//g, '\\');
  const segments = normalized.split(/\\+/).filter(Boolean);

  if (segments.length <= 2) {
    return raw;
  }

  const tail = segments.slice(-2).join('\\');

  if (/^[A-Za-z]:$/.test(segments[0])) {
    return `${segments[0]}\\…\\${tail}`;
  }

  if (raw.startsWith('\\\\')) {
    return `\\\\…\\${tail}`;
  }

  return `…\\${tail}`;
}

function isTerminalNoiseLine(line) {
  const value = String(line || '').trim();
  if (!value) {
    return false;
  }

  return (
    /^(?:PS\s+[A-Za-z]:\\|[A-Za-z]:\\.*>|mysql\s*:|java\s+version\s+"|Windows PowerShell\b)/i.test(value) ||
    /^(?:CategoryInfo|FullyQualifiedErrorId|ComputerName|RemoteAddress|RemotePort|InterfaceAlias|SourceAddress|TcpTestSucceeded|PingSucceeded|PingReplyDetails)\s*:/i.test(value) ||
    /^(?:版权所有|尝试新的跨平台 PowerShell|\[IntelliJ IDEA\]|警告:)/.test(value)
  );
}

function reducePromptForCompactCard(prompt) {
  const lines = String(prompt || '').replace(/\r\n?/g, '\n').split('\n');
  const reducedLines = [];
  let noiseMatches = 0;

  for (const line of lines) {
    if (isTerminalNoiseLine(line)) {
      noiseMatches += 1;
      continue;
    }

    reducedLines.push(line);
  }

  const compact = reducedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!compact && noiseMatches) {
    return null;
  }

  return compact || String(prompt || '').trim() || null;
}

function summarizePreviewText(text, maxLength = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function stripPromptLineForSummary(line) {
  const normalized = String(line || '').trim();
  if (!normalized || isPromptFence(normalized)) {
    return '';
  }

  return normalized
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPromptSummaryText(prompt, options = {}) {
  const maxLines = Math.max(2, Number(options.maxLines) || 4);
  const maxLength = Math.max(120, Number(options.maxLength) || 280);
  const reduced = reducePromptForCompactCard(prompt) || String(prompt || '').trim();
  if (!reduced) {
    return '';
  }

  const lines = reduced
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => stripPromptLineForSummary(line))
    .filter(Boolean);

  let summary = lines.slice(0, maxLines).join('\n');
  if (!summary) {
    summary = reduced.replace(/\s+/g, ' ').trim();
  }

  if (summary.length > maxLength) {
    return `${summary.slice(0, maxLength - 1).trimEnd()}…`;
  }

  if (lines.length > maxLines) {
    return `${summary}…`;
  }

  return summary;
}

function renderPromptSummaryMarkup(text, highlightQuery) {
  const html = escapeHtml(String(text || '')).replace(/\n/g, '<br>');
  return highlightPromptMarkup(html, highlightQuery);
}

function getLatestUsefulPromptPreview(prompts) {
  const items = Array.isArray(prompts)
    ? prompts.filter((prompt) => Boolean(String(prompt || '').trim()))
    : [];

  for (const prompt of items) {
    const summary = buildPromptSummaryText(prompt);
    if (summary) {
      return summary;
    }
  }

  return buildPromptSummaryText(items[0] || '');
}

function renderSessionPromptPreview(item) {
  const prompts = getSessionPrompts(item);
  const summary = getLatestUsefulPromptPreview(prompts);

  if (!summary) {
    return `<div class="prompt-preview-card is-empty">${escapeHtml(t('common.noPreview'))}</div>`;
  }

  const extraCount = Math.max(0, prompts.length - 1);
  const moreLabel = state.locale === 'zh-CN' ? `+${extraCount} 条` : `+${extraCount}`;
  const moreTitle = state.locale === 'zh-CN'
    ? `详情时间线中还有 ${extraCount} 条更早 prompt`
    : `${extraCount} earlier prompts in the detail timeline`;

  return `
    <div class="prompt-preview-card">
      <div class="prompt-preview-meta">
        <span class="prompt-preview-badge">${escapeHtml(tf('sessions.preview.latest', 'Latest', '最近一条'))}</span>
        ${extraCount ? `<span class="prompt-preview-more-badge" title="${escapeHtml(moreTitle)}">${escapeHtml(moreLabel)}</span>` : ''}
      </div>
      <div class="prompt-preview-summary">${renderPromptSummaryMarkup(summary, state.search)}</div>
    </div>
  `;
}

function buildApiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('lang', state.locale);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url;
}

async function fetchJson(path, options = {}) {
  const requestOptions = {
    method: options.method || 'GET',
    headers: {
      ...(options.headers || {})
    }
  };

  if (options.body !== undefined) {
    requestOptions.headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify({
      ...options.body,
      lang: state.locale
    });
  }

  const response = await fetch(buildApiUrl(path, options.params), requestOptions);
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Request failed: ${response.status}`);
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

function parseDownloadFileName(response, fallback = 'codex-session-export.txt') {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match && match[1] ? match[1] : fallback;
}

async function fetchDownload(path, options = {}) {
  const requestOptions = {
    method: options.method || 'POST',
    headers: {
      ...(options.headers || {})
    }
  };

  if (options.body !== undefined) {
    requestOptions.headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify({
      ...options.body,
      lang: state.locale
    });
  }

  const response = await fetch(buildApiUrl(path, options.params), requestOptions);
  if (!response.ok) {
    const text = await response.text();
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
    }

    throw new Error(payload?.error || text || `Request failed: ${response.status}`);
  }

  return {
    blob: await response.blob(),
    fileName: parseDownloadFileName(response)
  };
}

function triggerBrowserDownload(blob, fileName) {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = downloadUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);
}

function setMessage(type, message) {
  elements.messagePanel.className = `message-panel ${type}`;
  elements.messagePanel.textContent = message;
  elements.messagePanel.classList.remove('hidden');
}

function clearMessage() {
  elements.messagePanel.className = 'message-panel hidden';
  elements.messagePanel.textContent = '';
}

function setBusy(action = '') {
  state.busyAction = action;
  const busy = Boolean(action);

  elements.busyNotice.className = busy ? 'busy-notice' : 'busy-notice hidden';
  elements.busyNotice.textContent = busy ? t(`busy.${action}`) : '';

  const disabledElements = [
    elements.clearSelectionButton,
    elements.exportButton,
    elements.exportFormatSelect,
    elements.languageSelect,
    elements.limitFilter,
    elements.nextPageButton,
    elements.previewButton,
    elements.prevPageButton,
    elements.providerFilter,
    elements.repairIndexesButton,
    elements.refreshButton,
    elements.resetFiltersButton,
    elements.runButton,
    elements.searchInput,
    elements.selectPageButton,
    elements.sessionDetailNext,
    elements.sessionDetailPrev,
    elements.targetProviderInput,
    elements.togglePageSelection
  ];

  for (const element of disabledElements) {
    element.disabled = busy;
  }

  updateDetailNavigation();
}

function renderLanguageOptions() {
  elements.languageSelect.innerHTML = state.localeOptions
    .map((item) => {
      const selected = item.code === state.locale ? ' selected' : '';
      return `<option value="${escapeHtml(item.code)}"${selected}>${escapeHtml(item.label)}</option>`;
    })
    .join('');
}

function getExportFormatLabel(format) {
  if (format === 'markdown') {
    return 'Markdown (.md)';
  }

  if (format === 'jsonl') {
    return 'JSONL (.jsonl)';
  }

  if (format === 'txt') {
    return state.locale === 'zh-CN' ? '纯文本 (.txt)' : 'Plain text (.txt)';
  }

  return `${format.toUpperCase()} (.${format})`;
}

function renderExportControls() {
  elements.exportScopeLabel.textContent = t('export.scopeLabel');
  elements.exportFormatSelect.innerHTML = EXPORT_FORMATS.map((format) => {
    const selected = format === state.exportFormat ? ' selected' : '';
    return `<option value="${escapeHtml(format)}"${selected}>${escapeHtml(getExportFormatLabel(format))}</option>`;
  }).join('');

  const exportLabel = t('export.button');
  const buttonTitle = t('export.buttonTitle');

  elements.exportButton.textContent = exportLabel;
  elements.exportButton.title = buttonTitle;
  elements.exportButton.setAttribute('aria-label', buttonTitle);
  elements.exportFormatSelect.setAttribute('aria-label', t('export.formatLabel'));
}

function applyStaticText() {
  document.documentElement.lang = state.locale;
  document.title = t('pageTitle');

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute('content', t('pageDescription'));
  }

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  });

  renderExportControls();
}

function renderProviderFilter() {
  const allCount = state.overview ? state.overview.totals.sessions : 0;
  const providers = [{ name: 'all', count: allCount }, ...state.providers];

  elements.providerFilter.innerHTML = providers.map((provider) => {
    const selected = provider.name === state.provider ? ' selected' : '';
    const label = provider.name === 'all'
      ? t('common.allProviders', { count: provider.count })
      : t('common.providerCount', { name: provider.name, count: provider.count });

    return `<option value="${escapeHtml(provider.name)}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderProviderSuggestions() {
  const names = [...new Set((state.overview?.providers || []).map((item) => item.name))];
  elements.providerSuggestions.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');
}

function renderStats() {
  const overview = state.overview;
  if (!overview) {
    return;
  }

  elements.sessionsDir.textContent = overview.sessionsDir;
  elements.latestSessionAt.textContent = overview.latestSessionAtDisplay || t('common.loading');
  elements.statsGrid.innerHTML = '';

  const stats = [
    ['overview.sessions', overview.totals.sessions],
    ['overview.providers', overview.totals.providers],
    ['overview.backups', overview.totals.backups],
    ['overview.diskUsage', overview.totals.bytesDisplay]
  ];

  for (const [labelKey, value] of stats) {
    const fragment = elements.statCardTemplate.content.cloneNode(true);
    fragment.querySelector('.stat-label').textContent = t(labelKey);
    fragment.querySelector('.stat-value').textContent = String(value);
    elements.statsGrid.appendChild(fragment);
  }

  const chips = [{ name: 'all', count: overview.totals.sessions }, ...overview.providers];
  elements.providerChips.innerHTML = chips.map((provider) => {
    const active = provider.name === state.provider ? ' is-active' : '';
    const label = provider.name === 'all'
      ? t('common.allProviders', { count: provider.count })
      : t('common.providerCount', { name: provider.name, count: provider.count });

    return `
      <button
        class="provider-chip-button${active}"
        type="button"
        data-provider="${escapeHtml(provider.name)}"
        ${state.busyAction ? 'disabled' : ''}
      >
        ${escapeHtml(label)}
      </button>
    `;
  }).join('');
}

function renderSelectionSummary() {
  elements.selectedCount.textContent = String(state.selected.size);
  elements.matchingCount.textContent = String(state.totalMatching);
  elements.selectionMode.textContent = state.selected.size
    ? t('common.explicitSelection')
    : t('common.currentFilters');
}

function getDisplayValue(value, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function formatPromptCount(count) {
  const total = Math.max(0, Number(count) || 0);

  if (state.locale === 'en') {
    return total === 1 ? '1 prompt' : `${total} prompts`;
  }

  return t('detail.promptCount', { count: total });
}

function getDetailSummaryChips(item, prompts) {
  return [
    {
      label: t('detail.fields.when'),
      value: getDisplayValue(item.timestampDisplay || item.timestamp || t('common.unknown'))
    },
    {
      label: t('detail.fields.size'),
      value: getDisplayValue(item.sizeDisplay)
    },
    {
      label: t('detail.fields.cliVersion'),
      value: getDisplayValue(item.cliVersion)
    },
    {
      label: t('detail.fields.originator'),
      value: getDisplayValue(item.originator)
    },
    {
      label: t('detail.fields.recentPrompts'),
      value: formatPromptCount(prompts.length)
    }
  ];
}

function renderDetailMetaCards(entries) {
  return `
    <div class="detail-meta-grid">
      ${entries.map((entry) => {
        const value = getDisplayValue(entry.value);
        const canCopy = Boolean(String(entry.copyValue || '').trim());

        return `
          <article class="detail-meta-card${entry.wide ? ' is-wide' : ''}">
            <div class="detail-meta-head">
              <span>${escapeHtml(entry.label)}</span>
              ${canCopy ? `
                <button
                  class="button button-ghost detail-copy-button"
                  type="button"
                  data-copy-value="${escapeHtml(entry.copyValue)}"
                  data-copy-label="${escapeHtml(entry.label)}"
                >${escapeHtml(t('common.copy'))}</button>
              ` : ''}
            </div>
            <div class="detail-meta-value${entry.mono ? ' detail-mono' : ''}">${escapeHtml(value)}</div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function syncDetailModalVisibility() {
  elements.sessionDetailModal.hidden = !state.isDetailOpen;
  elements.sessionDetailModal.classList.toggle('is-open', state.isDetailOpen);
  elements.sessionDetailModal.setAttribute('aria-hidden', String(!state.isDetailOpen));
  document.body.classList.toggle('detail-modal-open', state.isDetailOpen);
  updateDetailNavigation();
}

function focusSessionRow(filePath) {
  if (!filePath) {
    return;
  }

  const row = [...elements.sessionsTableBody.querySelectorAll('tr[data-file-path]')]
    .find((item) => item.dataset.filePath === filePath);

  row?.focus();
}

function closeSessionDetail(options = {}) {
  const restoreFocus = options.restoreFocus !== false;
  const closingPath = state.activeSessionPath;

  state.detailRequestId += 1;
  state.isDetailOpen = false;
  state.activeSessionPath = '';
  state.activeSession = null;
  state.loadingSession = false;

  syncDetailModalVisibility();
  renderSessions();
  renderSessionDetail();

  if (restoreFocus && closingPath) {
    requestAnimationFrame(() => {
      focusSessionRow(closingPath);
    });
  }
}

function getActiveSessionIndex() {
  if (!state.activeSessionPath) {
    return -1;
  }

  return state.sessions.findIndex((item) => item.filePath === state.activeSessionPath);
}

function updateDetailNavigation() {
  const activeIndex = getActiveSessionIndex();
  const total = state.sessions.length;
  const hasSessions = total > 0;

  elements.sessionDetailPosition.textContent = hasSessions && activeIndex >= 0
    ? `${activeIndex + 1} / ${total}`
    : `0 / ${total}`;

  const previousLabel = t('common.previous');
  const nextLabel = t('common.next');

  elements.sessionDetailPrev.disabled = !hasSessions || activeIndex <= 0 || Boolean(state.busyAction);
  elements.sessionDetailNext.disabled = !hasSessions || activeIndex < 0 || activeIndex >= total - 1 || Boolean(state.busyAction);
  elements.sessionDetailPrev.setAttribute('aria-label', previousLabel);
  elements.sessionDetailNext.setAttribute('aria-label', nextLabel);
  elements.sessionDetailPrev.title = previousLabel;
  elements.sessionDetailNext.title = nextLabel;
}

async function navigateSessionDetail(offset) {
  const activeIndex = getActiveSessionIndex();
  const nextIndex = activeIndex + Number(offset || 0);

  if (activeIndex < 0 || nextIndex < 0 || nextIndex >= state.sessions.length) {
    return;
  }

  await loadSessionDetail(state.sessions[nextIndex].filePath);
}

function renderSessions() {
  elements.pageStatus.textContent = t('sessions.pageStatus', {
    page: state.page,
    totalPages: state.totalPages
  });

  if (!state.sessions.length) {
    elements.sessionsTableBody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="empty-state">${escapeHtml(t('sessions.empty'))}</div>
        </td>
      </tr>
    `;
    elements.togglePageSelection.checked = false;
    renderSelectionSummary();
    return;
  }

  elements.sessionsTableBody.innerHTML = state.sessions.map((item) => {
    const checked = state.selected.has(item.filePath) ? ' checked' : '';
    const active = state.isDetailOpen && state.activeSessionPath === item.filePath ? ' class="is-active"' : '';
    const disabled = state.busyAction ? ' disabled' : '';
    const promptPreview = renderSessionPromptPreview(item);
    const cwd = item.cwd || '—';
    const workspaceLabel = compactWorkspacePath(cwd);
    const timestamp = item.timestampDisplay || item.timestamp || t('common.unknown');

    return `
      <tr
        data-file-path="${escapeHtml(item.filePath)}"
        tabindex="0"
        aria-label="${escapeHtml(t('sessions.openDetailsAria', { id: item.id }))}"
        ${active}
      >
        <td class="cell-checkbox">
          <input class="row-selector" type="checkbox" value="${escapeHtml(item.filePath)}"${checked}${disabled}>
        </td>
        <td><span class="provider-pill">${escapeHtml(item.provider)}</span></td>
        <td>
          <div class="time-stack">
            <strong>${escapeHtml(timestamp)}</strong>
            <span class="muted">${escapeHtml(item.id)}</span>
          </div>
        </td>
        <td class="muted session-workspace-cell" title="${escapeHtml(cwd)}">
          <span class="clamp-text">${escapeHtml(workspaceLabel)}</span>
        </td>
        <td class="prompt-preview-cell">${promptPreview}</td>
      </tr>
    `;
  }).join('');

  elements.togglePageSelection.checked = state.sessions.every((item) => state.selected.has(item.filePath));
  renderSelectionSummary();
}

function renderBackups() {
  if (state.backups === null) {
    elements.backupsList.innerHTML = `<div class="empty-state">${escapeHtml(t('common.loading'))}</div>`;
    return;
  }

  if (!state.backups.length) {
    elements.backupsList.innerHTML = `<div class="empty-state">${escapeHtml(t('backups.empty'))}</div>`;
    return;
  }

  elements.backupsList.innerHTML = state.backups.map((backup) => {
    const sourceProvider = backup.sourceProvider || t('common.none');
    const targetProvider = backup.targetProvider || t('common.none');
    const reason = backup.reason || backup.label || t('common.none');

    return `
      <article class="stack-card">
        <div class="stack-card-header">
          <div>
            <h3>${escapeHtml(backup.backupId)}</h3>
            <p>${escapeHtml(backup.label)} • ${escapeHtml(t('common.filesCount', { count: backup.entryCount }))}</p>
          </div>
          <button
            class="button button-ghost restore-button"
            type="button"
            data-backup-id="${escapeHtml(backup.backupId)}"
            ${state.busyAction ? 'disabled' : ''}
          >${escapeHtml(t('backups.restore'))}</button>
        </div>
        <div class="meta-list">
          <div class="meta-row"><span>${escapeHtml(t('backups.createdAt'))}</span><strong>${escapeHtml(backup.createdAtDisplay || backup.createdAt)}</strong></div>
          <div class="meta-row"><span>${escapeHtml(t('backups.sourceProvider'))}</span><strong>${escapeHtml(sourceProvider)}</strong></div>
          <div class="meta-row"><span>${escapeHtml(t('backups.targetProvider'))}</span><strong>${escapeHtml(targetProvider)}</strong></div>
          <div class="meta-row"><span>${escapeHtml(t('backups.reason'))}</span><strong>${escapeHtml(reason)}</strong></div>
          <div class="meta-row"><span>${escapeHtml(t('backups.path'))}</span><strong class="meta-path">${escapeHtml(backup.backupDir)}</strong></div>
        </div>
      </article>
    `;
  }).join('');
}

function renderDoctorCallout(summary) {
  const notices = [];

  if (summary.missingSessionIndexCount) {
    notices.push(t('doctor.calloutMissingSessionIndex', {
      count: summary.missingSessionIndexCount
    }));
  }

  if (summary.missingThreadCount) {
    notices.push(t('doctor.calloutMissingThreads', {
      count: summary.missingThreadCount
    }));
  }

  if (summary.providerMismatchCount) {
    notices.push(t('doctor.calloutProviderMismatch', {
      count: summary.providerMismatchCount
    }));
  }

  if (!notices.length) {
    return `
      <article class="doctor-callout is-healthy">
        <strong>${escapeHtml(t('doctor.calloutTitleHealthy'))}</strong>
        <p>${escapeHtml(t('doctor.calloutHealthy'))}</p>
      </article>
    `;
  }

  return `
    <article class="doctor-callout">
      <strong>${escapeHtml(t('doctor.calloutTitle'))}</strong>
      ${notices.map((message) => `<p>${escapeHtml(message)}</p>`).join('')}
    </article>
  `;
}

function renderDoctor() {
  if (state.doctor === null) {
    elements.doctorSummary.innerHTML = `<div class="empty-state">${escapeHtml(t('common.loading'))}</div>`;
    elements.doctorIssues.innerHTML = '';
    return;
  }

  if (!state.doctor) {
    return;
  }

  const summary = state.doctor.summary;
  const metrics = [
    [t('doctor.health'), state.doctor.ok ? t('doctor.healthy') : t('doctor.needsAttention')],
    [t('doctor.invalidMeta'), summary.invalidMetaCount],
    [t('doctor.missingProvider'), summary.missingProviderCount],
    [t('doctor.workspaceReady'), summary.workspaceReadyCount],
    [t('doctor.missingWorkspace'), summary.missingWorkspaceCount],
    [t('doctor.duplicateIds'), summary.duplicateIdCount],
    [t('doctor.missingThreads'), summary.missingThreadCount],
    [t('doctor.providerMismatches'), summary.providerMismatchCount],
    [t('doctor.missingSessionIndex'), summary.missingSessionIndexCount],
    [t('doctor.scannedFiles'), summary.totalFiles]
  ];

  elements.doctorSummary.innerHTML = metrics.map(([label, value]) => `
    <div class="summary-card">
      <span class="summary-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('') + `
    ${renderDoctorCallout(summary)}
    <div class="summary-card summary-card-wide">
      <span class="summary-label">${escapeHtml(t('doctor.range'))}</span>
      <strong>${escapeHtml(t('common.scannedRange', {
        start: summary.oldestTimestampDisplay || t('common.unknown'),
        end: summary.latestTimestampDisplay || t('common.unknown')
      }))}</strong>
    </div>
  `;

  if (!state.doctor.issues.length) {
    elements.doctorIssues.innerHTML = `<div class="empty-state">${escapeHtml(t('doctor.empty'))}</div>`;
    return;
  }

  elements.doctorIssues.innerHTML = state.doctor.issues.slice(0, 10).map((issue) => `
    <article class="stack-card">
      <div class="stack-card-header">
        <div>
          <h3>${escapeHtml(issue.relativePath)}</h3>
          <p>${escapeHtml(issue.type)}</p>
        </div>
        <span class="issue-badge ${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</span>
      </div>
      <p>${escapeHtml(issue.message)}</p>
    </article>
  `).join('');
}

function renderPreview(preview) {
  if (!preview) {
    elements.previewPanel.className = 'preview-panel hidden';
    elements.previewPanel.innerHTML = '';
    return;
  }

  const lines = preview.items.slice(0, 12).map((item) => `
    <li>
      <div class="preview-item-header">
        <strong>${escapeHtml(item.id || t('common.unknown'))}</strong>
        <span class="muted">${escapeHtml(item.from)} → ${escapeHtml(item.to)}${item.skipped ? ` ${escapeHtml(t('preview.skippedSuffix'))}` : ''}</span>
      </div>
      <div class="preview-item-meta muted">
        <span>${escapeHtml(item.timestampDisplay || item.timestamp || t('common.unknown'))}</span>
        ${item.cwd ? `<span>${escapeHtml(compactWorkspacePath(item.cwd))}</span>` : ''}
      </div>
      ${item.preview ? `<p class="preview-item-body">${escapeHtml(summarizePreviewText(item.preview))}</p>` : ''}
    </li>
  `).join('');

  elements.previewPanel.innerHTML = `
    <div class="preview-header">
      <strong>${escapeHtml(t('preview.title'))}</strong>
      <p class="muted">${escapeHtml(t('preview.backupNote'))}</p>
    </div>
    <div class="preview-metrics">
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(t('preview.selected'))}</span>
        <strong>${escapeHtml(preview.totalSelected)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(t('preview.actionable'))}</span>
        <strong>${escapeHtml(preview.actionable)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(t('preview.skipped'))}</span>
        <strong>${escapeHtml(preview.skipped)}</strong>
      </div>
    </div>
    <ul class="preview-list">${lines}</ul>
  `;
  elements.previewPanel.className = 'preview-panel';
}

function renderSessionDetail() {
  updateDetailNavigation();

  if (state.loadingSession) {
    elements.sessionDetailBody.innerHTML = `<div class="empty-state">${escapeHtml(t('detail.loading'))}</div>`;
    return;
  }

  if (!state.activeSession) {
    elements.sessionDetailBody.innerHTML = `
      <div class="empty-state">
        <strong>${escapeHtml(t('detail.emptyTitle'))}</strong>
        <p>${escapeHtml(t('detail.emptyText'))}</p>
      </div>
    `;
    return;
  }

  const item = state.activeSession;
  const prompts = getSessionPrompts(item);
  const summaryChips = getDetailSummaryChips(item, prompts);
  const metadataEntries = [
    {
      label: t('detail.fields.id'),
      value: item.id,
      mono: true,
      copyValue: item.id
    },
    {
      label: t('detail.fields.path'),
      value: item.relativePath,
      mono: true,
      wide: true,
      copyValue: item.relativePath
    },
    {
      label: t('detail.fields.workspace'),
      value: item.cwd || '—',
      mono: true,
      wide: true,
      copyValue: item.cwd || ''
    }
  ];
  const workspace = getDisplayValue(item.cwd);
  const timestamp = getDisplayValue(item.timestampDisplay || item.timestamp || t('common.unknown'));

  elements.sessionDetailBody.innerHTML = `
    <div class="detail-layout">
      <section class="detail-summary-card">
        <div class="detail-summary-top">
          <span class="provider-pill">${escapeHtml(item.provider)}</span>
          <span class="detail-summary-badge">${escapeHtml(timestamp)}</span>
        </div>
        <h4 class="detail-session-title detail-mono">${escapeHtml(item.id)}</h4>
        <p class="detail-summary-subtitle">${escapeHtml(workspace)}</p>
        <div class="detail-summary-chips">
          ${summaryChips.map((entry) => `
            <div class="detail-summary-chip">
              <span>${escapeHtml(entry.label)}</span>
              <strong>${escapeHtml(entry.value)}</strong>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="detail-meta-section">
        <div class="detail-section-header">
          <div>
            <h4>${escapeHtml(t('detail.sections.metadata'))}</h4>
            <p class="muted">${escapeHtml(t('detail.metadataHint'))}</p>
          </div>
        </div>
        ${renderDetailMetaCards(metadataEntries)}
      </section>

      <section class="detail-prompts-section">
        <div class="detail-section-header">
          <div>
            <h4>${escapeHtml(t('detail.fields.recentPrompts'))}</h4>
            <p class="muted">${escapeHtml(t('detail.recentPromptsHint'))}</p>
          </div>
          <span class="detail-count-badge">${escapeHtml(formatPromptCount(prompts.length))}</span>
        </div>
        ${renderPromptStack(prompts, {
          maxPrompts: prompts.length || 1,
          contextKey: item.filePath,
          expandable: true,
          highlightQuery: state.search,
          timeline: true
        })}
      </section>
    </div>
  `;
}

async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (!value.trim()) {
    throw new Error('empty-copy-value');
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('copy-command-failed');
  }
}

async function handleCopyValue(value, label) {
  try {
    await copyTextToClipboard(value);
    setMessage('success', t('messages.copiedValue', {
      field: label || t('common.copy')
    }));
  } catch {
    setMessage('error', t('messages.copyFailed'));
  }
}

async function loadConfig() {
  const payload = await fetchJson('/api/app-config');
  state.locale = payload.locale;
  state.localeOptions = payload.locales || [];
  state.messages = payload.messages || {};

  renderLanguageOptions();
  applyStaticText();
  syncUrlLocale();
  savePreferences();
}

async function runBusyAction(action, callback) {
  setBusy(action);
  try {
    return await callback();
  } finally {
    setBusy('');
    renderStats();
    renderSessions();
    renderBackups();
    renderDoctor();
  }
}

function cancelDeferredPanels() {
  if (state.deferredPanelsHandle) {
    window.clearTimeout(state.deferredPanelsHandle);
    state.deferredPanelsHandle = null;
  }
}

function createEmptyDoctorState() {
  return {
    ok: false,
    summary: {
      invalidMetaCount: 0,
      missingProviderCount: 0,
      workspaceReadyCount: 0,
      missingWorkspaceCount: 0,
      duplicateIdCount: 0,
      missingThreadCount: 0,
      providerMismatchCount: 0,
      missingSessionIndexCount: 0,
      totalFiles: 0,
      oldestTimestampDisplay: '',
      latestTimestampDisplay: ''
    },
    issues: []
  };
}

function scheduleDeferredPanels() {
  cancelDeferredPanels();
  const requestId = state.deferredPanelsRequestId + 1;
  state.deferredPanelsRequestId = requestId;

  state.deferredPanelsHandle = window.setTimeout(async () => {
    state.deferredPanelsHandle = null;

    const [backupsResult, doctorResult] = await Promise.allSettled([
      fetchJson('/api/backups'),
      fetchJson('/api/doctor')
    ]);

    if (requestId !== state.deferredPanelsRequestId) {
      return;
    }

    state.backups = backupsResult.status === 'fulfilled'
      ? (backupsResult.value.backups || [])
      : [];
    state.doctor = doctorResult.status === 'fulfilled'
      ? (doctorResult.value.doctor || createEmptyDoctorState())
      : createEmptyDoctorState();

    renderBackups();
    renderDoctor();
  }, 32);
}

async function loadSessionDetail(filePath) {
  const requestId = state.detailRequestId + 1;
  const focusClose = !state.isDetailOpen;
  const sameSession = state.activeSessionPath === filePath;

  state.detailRequestId = requestId;
  state.isDetailOpen = true;
  state.activeSessionPath = filePath;
  state.activeSession = sameSession ? state.activeSession : null;
  state.loadingSession = true;

  syncDetailModalVisibility();
  renderSessions();
  renderSessionDetail();

  if (focusClose) {
    requestAnimationFrame(() => {
      elements.sessionDetailClose?.focus();
    });
  }

  try {
    const payload = await fetchJson('/api/session', {
      params: { path: filePath }
    });

    if (requestId !== state.detailRequestId || state.activeSessionPath !== filePath) {
      return;
    }

    state.activeSession = payload.session;
  } catch (error) {
    if (requestId !== state.detailRequestId || state.activeSessionPath !== filePath) {
      return;
    }

    state.activeSession = null;
    setMessage('error', `${t('messages.sessionLoadFailed')} ${error.message}`);
  } finally {
    if (requestId !== state.detailRequestId || state.activeSessionPath !== filePath) {
      return;
    }

    state.loadingSession = false;
    renderSessions();
    renderSessionDetail();
  }
}

async function loadData() {
  clearMessage();

  const query = {
    includePreview: 1,
    includeBackups: 0,
    includeDoctor: 0,
    provider: state.provider === 'all' ? '' : state.provider,
    search: state.search,
    page: state.page,
    limit: state.limit
  };

  cancelDeferredPanels();
  state.deferredPanelsRequestId += 1;
  state.backups = null;
  state.doctor = null;
  renderBackups();
  renderDoctor();

  await runBusyAction('loadingData', async () => {
    const dashboard = await fetchJson('/api/dashboard', { params: query });
    const sessionsPayload = dashboard.sessions || {};

    state.overview = dashboard.overview;
    state.providers = sessionsPayload.providers || [];
    state.sessions = sessionsPayload.items || [];
    state.totalMatching = sessionsPayload.total || 0;
    state.page = sessionsPayload.page || 1;
    state.totalPages = sessionsPayload.totalPages || 1;

    renderProviderFilter();
    renderProviderSuggestions();
    renderStats();
    renderSessions();
    renderPreview(state.lastPreview);
  });

  scheduleDeferredPanels();

  if (state.isDetailOpen && state.activeSessionPath) {
    await loadSessionDetail(state.activeSessionPath);
  } else {
    renderSessionDetail();
  }
}

function getSelectionPayload() {
  if (state.selected.size > 0) {
    return {
      filePaths: Array.from(state.selected)
    };
  }

  return {
    provider: state.provider === 'all' ? '' : state.provider,
    search: state.search
  };
}

function hasScopedSelection() {
  return state.selected.size > 0 || state.provider !== 'all' || Boolean(state.search);
}

function clearPreview() {
  state.lastPreview = null;
  renderPreview(null);
}

async function handleExport() {
  const format = elements.exportFormatSelect.value || state.exportFormat || 'markdown';
  let selection = getSelectionPayload();

  state.exportFormat = format;
  savePreferences();

  if (!hasScopedSelection()) {
    const confirmed = window.confirm(t('messages.exportConfirm', {
      count: state.overview?.totals.sessions || 0
    }));

    if (!confirmed) {
      return;
    }

    selection = { allowAll: true };
  }

  const download = await runBusyAction('exporting', () => fetchDownload('/api/exports/download', {
    body: {
      selection,
      format
    }
  }));

  triggerBrowserDownload(download.blob, download.fileName);
  setMessage('success', t('export.success', { fileName: download.fileName }));
}

async function handlePreview() {
  const targetProvider = elements.targetProviderInput.value.trim();
  if (!targetProvider) {
    setMessage('error', t('messages.targetRequired'));
    return;
  }

  if (!hasScopedSelection()) {
    setMessage('error', t('messages.scopeRequiredPreview'));
    return;
  }

  const payload = await runBusyAction('previewing', () => fetchJson('/api/migrations/preview', {
    method: 'POST',
    body: {
      selection: getSelectionPayload(),
      targetProvider
    }
  }));

  state.lastPreview = payload.preview;
  renderPreview(state.lastPreview);
  setMessage('success', t('messages.previewReady', { count: payload.preview.totalSelected }));
}

function getBackupSuffix(label, value) {
  if (!value) {
    return '';
  }
  return ` ${label}: ${value}`;
}

async function handleRun() {
  const targetProvider = elements.targetProviderInput.value.trim();
  if (!targetProvider) {
    setMessage('error', t('messages.targetRequired'));
    return;
  }

  if (!hasScopedSelection()) {
    setMessage('error', t('messages.scopeRequiredRun'));
    return;
  }

  const scope = state.selected.size
    ? t('common.filesCount', { count: state.selected.size })
    : t('common.filesCount', { count: state.totalMatching });

  const confirmed = window.confirm(t('messages.migrationConfirm', {
    scope,
    target: targetProvider
  }));

  if (!confirmed) {
    return;
  }

  const result = await runBusyAction('migrating', () => fetchJson('/api/migrations/run', {
    method: 'POST',
    body: {
      selection: getSelectionPayload(),
      targetProvider
    }
  }));

  state.selected.clear();
  clearPreview();
  setMessage('success', t('messages.migrationFinished', {
    migrated: result.migrated,
    skipped: result.skipped,
    failed: result.failed,
    backupSuffix: getBackupSuffix(t('common.backup'), result.backupId)
  }));
  await loadData();
}

async function handleRestore(backupId) {
  const confirmed = window.confirm(t('messages.restoreConfirm', {
    backup: backupId
  }));

  if (!confirmed) {
    return;
  }

  const result = await runBusyAction('restoring', () => fetchJson('/api/backups/restore', {
    method: 'POST',
    body: { backupId }
  }));

  state.selected.clear();
  clearPreview();
  setMessage('success', t('messages.restoreFinished', {
    restored: result.restored,
    failed: result.failed,
    backupSuffix: getBackupSuffix(t('common.preRestoreBackup'), result.preRestoreBackupId)
  }));
  await loadData();
}

async function handleRepairIndexes() {
  const confirmed = window.confirm(t('messages.repairConfirm'));
  if (!confirmed) {
    return;
  }

  const payload = await runBusyAction('repairing', () => fetchJson('/api/indexes/repair', {
    method: 'POST',
    body: {
      includeArchivedSessions: true
    }
  }));

  clearPreview();
  setMessage('success', t('messages.repairFinished', {
    insertedThreads: payload.repair.insertedThreads,
    updatedThreads: payload.repair.updatedThreads,
    addedSessionIndexEntries: payload.repair.addedSessionIndexEntries,
    failed: payload.repair.failed
  }));
  await loadData();
}

async function execute(task) {
  try {
    await task();
  } catch (error) {
    setMessage('error', error.message || t('messages.genericFailed'));
  }
}

function bindEvents() {
  elements.filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    execute(async () => {
      state.provider = elements.providerFilter.value || 'all';
      state.search = elements.searchInput.value.trim();
      state.limit = Number(elements.limitFilter.value) || 50;
      state.page = 1;
      savePreferences();
      clearPreview();
      await loadData();
    });
  });

  elements.resetFiltersButton.addEventListener('click', () => {
    execute(async () => {
      state.provider = 'all';
      state.search = '';
      state.limit = 50;
      state.page = 1;
      state.selected.clear();
      syncControlsFromState();
      savePreferences();
      clearPreview();
      await loadData();
    });
  });

  elements.languageSelect.addEventListener('change', () => {
    execute(async () => {
      state.locale = normalizeLocale(elements.languageSelect.value);
      savePreferences();
      await loadConfig();
      renderSelectionSummary();
      renderPreview(state.lastPreview);
      renderSessionDetail();
      syncDetailModalVisibility();
      await loadData();
    });
  });

  elements.refreshButton.addEventListener('click', () => execute(loadData));
  elements.exportButton.addEventListener('click', () => execute(handleExport));
  elements.repairIndexesButton.addEventListener('click', () => execute(handleRepairIndexes));
  elements.previewButton.addEventListener('click', () => execute(handlePreview));
  elements.runButton.addEventListener('click', () => execute(handleRun));
  elements.exportFormatSelect.addEventListener('change', () => {
    state.exportFormat = elements.exportFormatSelect.value || 'markdown';
    savePreferences();
  });

  elements.prevPageButton.addEventListener('click', () => {
    if (state.page <= 1) {
      return;
    }
    execute(async () => {
      state.page -= 1;
      await loadData();
    });
  });

  elements.nextPageButton.addEventListener('click', () => {
    if (state.page >= state.totalPages) {
      return;
    }
    execute(async () => {
      state.page += 1;
      await loadData();
    });
  });

  elements.selectPageButton.addEventListener('click', () => {
    for (const item of state.sessions) {
      state.selected.add(item.filePath);
    }
    renderSessions();
  });

  elements.clearSelectionButton.addEventListener('click', () => {
    state.selected.clear();
    renderSessions();
  });

  elements.togglePageSelection.addEventListener('change', () => {
    const checked = elements.togglePageSelection.checked;
    for (const item of state.sessions) {
      if (checked) {
        state.selected.add(item.filePath);
      } else {
        state.selected.delete(item.filePath);
      }
    }
    renderSessions();
  });

  elements.targetProviderInput.addEventListener('input', () => {
    savePreferences();
  });

  elements.sessionsTableBody.addEventListener('change', (event) => {
    const target = event.target;
    if (!target.classList.contains('row-selector')) {
      return;
    }

    if (target.checked) {
      state.selected.add(target.value);
    } else {
      state.selected.delete(target.value);
    }

    renderSelectionSummary();
    elements.togglePageSelection.checked = state.sessions.every((item) => state.selected.has(item.filePath));
  });

  elements.sessionsTableBody.addEventListener('click', (event) => {
    const target = event.target;
    if (target.classList.contains('row-selector')) {
      return;
    }

    const row = target.closest('tr[data-file-path]');
    if (!row) {
      return;
    }

    execute(() => loadSessionDetail(row.dataset.filePath));
  });

  elements.sessionsTableBody.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const target = event.target;
    if (target.classList.contains('row-selector')) {
      return;
    }

    const row = target.closest('tr[data-file-path]');
    if (!row) {
      return;
    }

    event.preventDefault();
    execute(() => loadSessionDetail(row.dataset.filePath));
  });

  elements.sessionDetailBody.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy-value]');
    if (copyButton) {
      execute(() => handleCopyValue(copyButton.dataset.copyValue, copyButton.dataset.copyLabel));
      return;
    }

    const button = event.target.closest('[data-prompt-toggle]');
    if (!button) {
      return;
    }

    const key = button.dataset.promptToggle;
    if (!key) {
      return;
    }

    if (state.expandedPrompts.has(key)) {
      state.expandedPrompts.delete(key);
    } else {
      state.expandedPrompts.add(key);
    }

    renderSessionDetail();
  });

  elements.sessionDetailClose.addEventListener('click', () => {
    closeSessionDetail();
  });

  elements.sessionDetailPrev.addEventListener('click', () => {
    execute(() => navigateSessionDetail(-1));
  });

  elements.sessionDetailNext.addEventListener('click', () => {
    execute(() => navigateSessionDetail(1));
  });

  elements.sessionDetailModal.addEventListener('click', (event) => {
    if (event.target.classList.contains('detail-modal-backdrop')) {
      closeSessionDetail();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.isDetailOpen) {
      event.preventDefault();
      closeSessionDetail();
      return;
    }

    if (!state.isDetailOpen) {
      return;
    }

    const targetTag = event.target?.tagName;
    const isTypingContext = event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag);
    if (isTypingContext) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      execute(() => navigateSessionDetail(-1));
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      execute(() => navigateSessionDetail(1));
    }
  });

  elements.backupsList.addEventListener('click', (event) => {
    const button = event.target.closest('.restore-button');
    if (!button) {
      return;
    }

    execute(() => handleRestore(button.dataset.backupId));
  });

  elements.providerChips.addEventListener('click', (event) => {
    const button = event.target.closest('.provider-chip-button');
    if (!button) {
      return;
    }

    execute(async () => {
      state.provider = button.dataset.provider || 'all';
      state.page = 1;
      syncControlsFromState();
      savePreferences();
      clearPreview();
      await loadData();
    });
  });
}

async function init() {
  const preferences = loadPreferences();
  state.provider = preferences.provider || 'all';
  state.search = preferences.search || '';
  state.limit = Number(preferences.limit) || 50;
  state.exportFormat = EXPORT_FORMATS.includes(preferences.exportFormat) ? preferences.exportFormat : 'markdown';

  elements.targetProviderInput.value = preferences.targetProvider || '';

  await loadConfig();
  syncControlsFromState();
  renderSelectionSummary();
  renderSessionDetail();
  syncDetailModalVisibility();
  bindEvents();
  await loadData();
}

init().catch((error) => {
  elements.messagePanel.className = 'message-panel error';
  elements.messagePanel.textContent = error.message || 'Failed to initialize the app.';
  elements.messagePanel.classList.remove('hidden');
});

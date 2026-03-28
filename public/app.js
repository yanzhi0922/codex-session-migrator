const state = {
  provider: 'all',
  search: '',
  limit: 50,
  page: 1,
  totalPages: 1,
  totalMatching: 0,
  sessions: [],
  providers: [],
  selected: new Set(),
  overview: null,
  backups: [],
  doctor: null
};

const elements = {
  backupsList: document.getElementById('backupsList'),
  clearSelectionButton: document.getElementById('clearSelectionButton'),
  doctorIssues: document.getElementById('doctorIssues'),
  doctorSummary: document.getElementById('doctorSummary'),
  filterForm: document.getElementById('filterForm'),
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
  refreshButton: document.getElementById('refreshButton'),
  runButton: document.getElementById('runButton'),
  searchInput: document.getElementById('searchInput'),
  selectedCount: document.getElementById('selectedCount'),
  selectionMode: document.getElementById('selectionMode'),
  selectPageButton: document.getElementById('selectPageButton'),
  sessionsDir: document.getElementById('sessionsDir'),
  sessionsTableBody: document.getElementById('sessionsTableBody'),
  statsGrid: document.getElementById('statsGrid'),
  statCardTemplate: document.getElementById('statCardTemplate'),
  targetProviderInput: document.getElementById('targetProviderInput'),
  togglePageSelection: document.getElementById('togglePageSelection')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
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

function setMessage(type, message) {
  elements.messagePanel.className = `message-panel ${type}`;
  elements.messagePanel.textContent = message;
  elements.messagePanel.classList.remove('hidden');
}

function clearMessage() {
  elements.messagePanel.className = 'message-panel hidden';
  elements.messagePanel.textContent = '';
}

function renderStats() {
  const overview = state.overview;
  if (!overview) {
    return;
  }

  elements.sessionsDir.textContent = overview.sessionsDir;
  elements.latestSessionAt.textContent = overview.latestSessionAtDisplay || 'No sessions found';
  elements.statsGrid.innerHTML = '';

  const stats = [
    ['Sessions', overview.totals.sessions],
    ['Providers', overview.totals.providers],
    ['Backups', overview.totals.backups],
    ['Disk Usage', overview.totals.bytesDisplay]
  ];

  for (const [label, value] of stats) {
    const fragment = elements.statCardTemplate.content.cloneNode(true);
    fragment.querySelector('.stat-label').textContent = label;
    fragment.querySelector('.stat-value').textContent = value;
    elements.statsGrid.appendChild(fragment);
  }

  elements.providerChips.innerHTML = overview.providers
    .map((provider) => `<span class="provider-chip">${escapeHtml(provider.name)} <strong>${provider.count}</strong></span>`)
    .join('');
}

function renderProviderFilter() {
  const providers = [{ name: 'all', count: state.overview ? state.overview.totals.sessions : 0 }, ...state.providers];
  elements.providerFilter.innerHTML = providers
    .map((provider) => {
      const selected = provider.name === state.provider ? ' selected' : '';
      const label = provider.name === 'all' ? `All providers (${provider.count})` : `${provider.name} (${provider.count})`;
      return `<option value="${escapeHtml(provider.name)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function renderSelectionSummary() {
  elements.selectedCount.textContent = String(state.selected.size);
  elements.matchingCount.textContent = String(state.totalMatching);
  elements.selectionMode.textContent = state.selected.size ? 'Explicit file selection' : 'Current filters';
}

function renderSessions() {
  if (!state.sessions.length) {
    elements.sessionsTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">No sessions matched the current filters.</div>
        </td>
      </tr>
    `;
    elements.togglePageSelection.checked = false;
    renderSelectionSummary();
    return;
  }

  elements.sessionsTableBody.innerHTML = state.sessions.map((item) => {
    const checked = state.selected.has(item.filePath) ? ' checked' : '';
    return `
      <tr data-file-path="${escapeHtml(item.filePath)}">
        <td class="cell-checkbox">
          <input class="row-selector" type="checkbox" value="${escapeHtml(item.filePath)}"${checked}>
        </td>
        <td><span class="provider-pill">${escapeHtml(item.provider)}</span></td>
        <td>${escapeHtml(item.timestampDisplay || item.timestamp || 'unknown')}</td>
        <td>
          <div class="path-stack">
            <strong>${escapeHtml(item.relativePath)}</strong>
            <span class="muted">${escapeHtml(item.id)}</span>
          </div>
        </td>
        <td class="muted">${escapeHtml(item.cwd || '-')}</td>
        <td class="muted">${escapeHtml(item.preview || 'No preview available')}</td>
      </tr>
    `;
  }).join('');

  const allSelected = state.sessions.every((item) => state.selected.has(item.filePath));
  elements.togglePageSelection.checked = allSelected;
  elements.pageStatus.textContent = `Page ${state.page} / ${state.totalPages}`;
  renderSelectionSummary();
}

function renderBackups() {
  if (!state.backups.length) {
    elements.backupsList.innerHTML = '<div class="empty-state">No backup snapshots yet. The first migration will create one automatically.</div>';
    return;
  }

  elements.backupsList.innerHTML = state.backups.map((backup) => `
    <article class="stack-card">
      <div class="stack-card-header">
        <div>
          <h3>${escapeHtml(backup.backupId)}</h3>
          <p>${escapeHtml(backup.label)} • ${escapeHtml(backup.entryCount)} files</p>
        </div>
        <button class="button button-ghost restore-button" data-backup-id="${escapeHtml(backup.backupId)}">Restore</button>
      </div>
      <p>${escapeHtml(backup.createdAt)}</p>
      <p>${escapeHtml(backup.backupDir)}</p>
    </article>
  `).join('');
}

function renderDoctor() {
  if (!state.doctor) {
    return;
  }

  const summary = state.doctor.summary;
  elements.doctorSummary.innerHTML = `
    <div>
      <span class="summary-label">Health</span>
      <strong>${state.doctor.ok ? 'Healthy' : 'Needs attention'}</strong>
    </div>
    <div>
      <span class="summary-label">Invalid meta</span>
      <strong>${summary.invalidMetaCount}</strong>
    </div>
    <div>
      <span class="summary-label">Missing provider</span>
      <strong>${summary.missingProviderCount}</strong>
    </div>
  `;

  if (!state.doctor.issues.length) {
    elements.doctorIssues.innerHTML = '<div class="empty-state">No structural issues detected in the scanned session set.</div>';
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
    elements.previewPanel.classList.add('hidden');
    elements.previewPanel.innerHTML = '';
    return;
  }

  const lines = preview.items.slice(0, 12).map((item) => {
    return `<li>${escapeHtml(item.relativePath)} — ${escapeHtml(item.from)} → ${escapeHtml(item.to)}${item.skipped ? ' (skip)' : ''}</li>`;
  }).join('');

  elements.previewPanel.innerHTML = `
    <strong>Migration preview</strong>
    <p>${preview.totalSelected} sessions selected, ${preview.actionable} actionable, ${preview.skipped} already on the target provider.</p>
    <ul>${lines}</ul>
  `;
  elements.previewPanel.classList.remove('hidden');
}

async function loadData() {
  clearMessage();

  const query = new URLSearchParams({
    includePreview: '1',
    provider: state.provider === 'all' ? '' : state.provider,
    search: state.search,
    page: String(state.page),
    limit: String(state.limit)
  });

  const [overviewPayload, sessionsPayload, backupsPayload, doctorPayload] = await Promise.all([
    fetchJson('/api/overview'),
    fetchJson(`/api/sessions?${query.toString()}`),
    fetchJson('/api/backups'),
    fetchJson('/api/doctor')
  ]);

  state.overview = overviewPayload.overview;
  state.providers = sessionsPayload.providers || [];
  state.sessions = sessionsPayload.items || [];
  state.totalMatching = sessionsPayload.total || 0;
  state.page = sessionsPayload.page || 1;
  state.totalPages = sessionsPayload.totalPages || 1;
  state.backups = backupsPayload.backups || [];
  state.doctor = doctorPayload.doctor;

  renderStats();
  renderProviderFilter();
  renderSessions();
  renderBackups();
  renderDoctor();
}

async function handlePreview() {
  const targetProvider = elements.targetProviderInput.value.trim();
  if (!targetProvider) {
    setMessage('error', 'Target provider is required.');
    return;
  }

  if (!hasScopedSelection()) {
    setMessage('error', 'Select files or add a provider/search filter before previewing a migration.');
    return;
  }

  const payload = await fetchJson('/api/migrations/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selection: getSelectionPayload(),
      targetProvider
    })
  });

  renderPreview(payload.preview);
  setMessage('success', `Preview ready for ${payload.preview.totalSelected} sessions.`);
}

async function handleRun() {
  const targetProvider = elements.targetProviderInput.value.trim();
  if (!targetProvider) {
    setMessage('error', 'Target provider is required.');
    return;
  }

  if (!hasScopedSelection()) {
    setMessage('error', 'Select files or add a provider/search filter before running a migration.');
    return;
  }

  const scope = state.selected.size ? `${state.selected.size} selected sessions` : `${state.totalMatching} filtered sessions`;
  const confirmed = window.confirm(`Run migration for ${scope} to "${targetProvider}"?`);
  if (!confirmed) {
    return;
  }

  const result = await fetchJson('/api/migrations/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selection: getSelectionPayload(),
      targetProvider
    })
  });

  state.selected.clear();
  renderPreview(null);
  setMessage('success', `Migration finished. ${result.migrated} migrated, ${result.skipped} skipped, ${result.failed} failed.${result.backupId ? ` Backup: ${result.backupId}` : ''}`);
  await loadData();
}

async function handleRestore(backupId) {
  const confirmed = window.confirm(`Restore sessions from backup "${backupId}"?`);
  if (!confirmed) {
    return;
  }

  const result = await fetchJson('/api/backups/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupId })
  });

  state.selected.clear();
  renderPreview(null);
  setMessage('success', `Restore finished. ${result.restored} restored, ${result.failed} failed.`);
  await loadData();
}

function bindEvents() {
  elements.filterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.provider = elements.providerFilter.value || 'all';
    state.search = elements.searchInput.value.trim();
    state.limit = Number(elements.limitFilter.value) || 50;
    state.page = 1;
    await loadData();
  });

  elements.refreshButton.addEventListener('click', loadData);
  elements.previewButton.addEventListener('click', handlePreview);
  elements.runButton.addEventListener('click', handleRun);

  elements.prevPageButton.addEventListener('click', async () => {
    if (state.page <= 1) {
      return;
    }
    state.page -= 1;
    await loadData();
  });

  elements.nextPageButton.addEventListener('click', async () => {
    if (state.page >= state.totalPages) {
      return;
    }
    state.page += 1;
    await loadData();
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
  });

  elements.backupsList.addEventListener('click', async (event) => {
    const button = event.target.closest('.restore-button');
    if (!button) {
      return;
    }
    await handleRestore(button.dataset.backupId);
  });
}

async function init() {
  elements.targetProviderInput.value = localStorage.getItem('codex-session-migrator:target-provider') || '';
  elements.targetProviderInput.addEventListener('input', () => {
    localStorage.setItem('codex-session-migrator:target-provider', elements.targetProviderInput.value.trim());
  });

  bindEvents();
  await loadData();
}

init().catch((error) => {
  setMessage('error', error.message);
});

'use strict';

const fs = require('fs');
const path = require('path');

function getCodexRootFromSessionsDir(sessionsDir) {
  return path.dirname(path.resolve(sessionsDir));
}

function getConfigPath(sessionsDir) {
  return path.join(getCodexRootFromSessionsDir(sessionsDir), 'config.toml');
}

function parseDefaultModelProvider(content) {
  const match = String(content || '').match(/^\s*model_provider\s*=\s*"([^"]+)"\s*$/m);
  return match ? String(match[1] || '').trim() : '';
}

function listConfiguredProviders(content) {
  const providers = new Set();
  const pattern = /^\s*\[model_providers\.([^\]]+)\]\s*$/gm;
  let match = pattern.exec(String(content || ''));

  while (match) {
    const providerName = String(match[1] || '').trim();
    if (providerName) {
      providers.add(providerName);
    }
    match = pattern.exec(String(content || ''));
  }

  return Array.from(providers);
}

function escapeTomlString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function toProviderDisplayName(provider) {
  const value = String(provider || '').trim();
  if (!value) {
    return 'Codex Provider';
  }

  if (value === 'codexmanager') {
    return 'CodexManager';
  }

  return value
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ensureProviderSection(content, providerName) {
  const existingProviders = new Set(listConfiguredProviders(content));
  if (existingProviders.has(providerName)) {
    return content;
  }

  const nextContent = String(content || '').trimEnd();
  const sectionLines = [
    `[model_providers.${providerName}]`,
    `name = "${escapeTomlString(toProviderDisplayName(providerName))}"`
  ].join('\n');

  return nextContent
    ? `${nextContent}\n\n${sectionLines}\n`
    : `${sectionLines}\n`;
}

function buildBackupPath(configPath, label = 'provider-sync') {
  const suffix = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');

  return `${configPath}.pre-${label}-${suffix}.bak`;
}

function syncDefaultModelProvider(sessionsDir, targetProvider, options = {}) {
  const configPath = getConfigPath(sessionsDir);
  if (!fs.existsSync(configPath)) {
    return {
      ok: false,
      changed: false,
      skipped: true,
      reason: 'missing_config',
      configPath
    };
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const previousProvider = parseDefaultModelProvider(content) || null;
  let nextContent = content;
  const escapedProvider = escapeTomlString(targetProvider);

  if (previousProvider) {
    nextContent = nextContent.replace(
      /^\s*model_provider\s*=\s*"([^"]+)"\s*$/m,
      `model_provider = "${escapedProvider}"`
    );
  } else {
    nextContent = `model_provider = "${escapedProvider}"\n${nextContent}`;
  }

  nextContent = ensureProviderSection(nextContent, targetProvider);

  if (nextContent === content) {
    return {
      ok: true,
      changed: false,
      skipped: false,
      configPath,
      backupPath: null,
      previousProvider,
      nextProvider: targetProvider
    };
  }

  const backupPath = buildBackupPath(configPath, options.backupLabel || 'provider-sync');
  fs.writeFileSync(backupPath, content, 'utf8');
  fs.writeFileSync(configPath, nextContent, 'utf8');

  return {
    ok: true,
    changed: true,
    skipped: false,
    configPath,
    backupPath,
    previousProvider,
    nextProvider: targetProvider
  };
}

function getDefaultProviderAlignment(sessionsDir, providerCounts = []) {
  const configPath = getConfigPath(sessionsDir);
  if (!fs.existsSync(configPath)) {
    return {
      exists: false,
      configPath,
      defaultProvider: '',
      configuredProviders: [],
      dominantProvider: '',
      dominantProviderCount: 0,
      defaultProviderActiveCount: 0,
      mismatch: false,
      missingProviderSection: false
    };
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const configuredProviders = listConfiguredProviders(content);
  const defaultProvider = parseDefaultModelProvider(content);
  const sortedCounts = [...providerCounts].sort((left, right) => (
    right.count - left.count || String(left.name || '').localeCompare(String(right.name || ''))
  ));
  const dominantProvider = sortedCounts[0] || null;
  const defaultProviderActiveCount = sortedCounts.find((item) => item.name === defaultProvider)?.count || 0;
  const mismatch = Boolean(
    defaultProvider &&
    dominantProvider &&
    dominantProvider.name &&
    dominantProvider.name !== defaultProvider &&
    defaultProviderActiveCount === 0
  );

  return {
    exists: true,
    configPath,
    defaultProvider,
    configuredProviders,
    dominantProvider: dominantProvider ? dominantProvider.name : '',
    dominantProviderCount: dominantProvider ? dominantProvider.count : 0,
    defaultProviderActiveCount,
    mismatch,
    missingProviderSection: Boolean(defaultProvider) && !configuredProviders.includes(defaultProvider)
  };
}

module.exports = {
  getConfigPath,
  getDefaultProviderAlignment,
  listConfiguredProviders,
  parseDefaultModelProvider,
  syncDefaultModelProvider,
  toProviderDisplayName
};

#!/usr/bin/env node
'use strict';

const { exec, spawn } = require('child_process');
const readline = require('readline');
const { startServer } = require('./server');
const { buildSessionExport, writeSessionExport } = require('./exporter');
const { createTranslator, resolveLocale } = require('./i18n');
const { getOverview, getSessionsDir, listBackups, runDoctor, scanSessions } = require('./scanner');
const { migrateSessions, previewMigration, restoreFromBackup } = require('./migrator');
const { repairSessionIndexes } = require('./session-indexes');

function parseArgs(argv) {
  const result = { command: '', flags: {}, positional: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.flags[key] = next;
        index += 1;
      } else {
        result.flags[key] = true;
      }
      continue;
    }

    if (!result.command) {
      result.command = token;
      continue;
    }

    result.positional.push(token);
  }

  return result;
}

function parseCsvFlag(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toSelection(flags) {
  const filePaths = parseCsvFlag(flags.file);
  const ids = parseCsvFlag(flags.id);

  return {
    allowAll: Boolean(flags.all),
    filePaths: filePaths.length ? filePaths : undefined,
    ids: ids.length ? ids : undefined,
    provider: flags.provider || undefined,
    search: flags.search || undefined,
    limit: flags.limit ? Number(flags.limit) : undefined
  };
}

function resolveCliLocale(flags = {}) {
  return resolveLocale(
    flags.lang,
    process.env.CODEX_SESSION_MIGRATOR_LANG,
    process.env.LC_ALL,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale
  );
}

function getCliI18n(flags = {}) {
  return createTranslator(resolveCliLocale(flags));
}

function printHelp(flags = {}) {
  const { t } = getCliI18n(flags);
  console.log([
    '',
    t('cli.help.title'),
    '',
    t('cli.help.usage'),
    t('cli.help.usageValue'),
    '',
    t('cli.help.commands'),
    t('cli.help.commandServe'),
    t('cli.help.commandList'),
    t('cli.help.commandStats'),
    t('cli.help.commandDoctor'),
    t('cli.help.commandBackups'),
    t('cli.help.commandMigrate'),
    t('cli.help.commandExport'),
    t('cli.help.commandRepair'),
    t('cli.help.commandRestore'),
    '',
    t('cli.help.commonFlags'),
    t('cli.help.flagSessionsDir'),
    t('cli.help.flagJson'),
    t('cli.help.flagAll'),
    t('cli.help.flagLang'),
    t('cli.help.flagSource'),
    '',
    t('cli.help.examples'),
    t('cli.help.exampleServe'),
    t('cli.help.exampleList'),
    t('cli.help.exampleMigrate'),
    t('cli.help.exampleExport'),
    t('cli.help.exampleRepair'),
    t('cli.help.exampleRestore'),
    ''
  ].join('\n'));
}

function openInBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    return;
  }

  exec(`xdg-open "${url}"`);
}

function confirmPrompt(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

function printSessions(result, flags = {}) {
  const { t } = getCliI18n(flags);
  console.log(`${t('cli.labels.sessionsDirectory')}: ${result.sessionsDir}`);
  console.log(`${t('cli.labels.totalMatching')}: ${result.total} / ${result.totals.all}`);
  console.log('');
  for (const provider of result.providers) {
    console.log(`  ${provider.name.padEnd(18)} ${provider.count}`);
  }
  console.log('');

  for (const item of result.items) {
    const preview = item.preview ? ` | ${item.preview}` : '';
    console.log(`[${item.provider}] ${item.timestampDisplay || item.timestamp || t('cli.table.unknown')} | ${item.relativePath}${preview}`);
  }
}

async function handleServe(flags) {
  const { locale, t } = getCliI18n(flags);
  const server = await startServer({
    host: flags.host || '127.0.0.1',
    port: flags.port || process.env.PORT || 5730,
    sessionsDir: flags['sessions-dir'],
    maxPortAttempts: flags['port-attempts'] ? Number(flags['port-attempts']) : 10
  });

  console.log(t('cli.status.listening', { url: server.url }));
  console.log(`${t('cli.labels.sessionsDirectory')}: ${server.sessionsDir}`);
  console.log(`${t('cli.labels.language')}: ${locale}`);

  if (flags.open) {
    openInBrowser(server.url);
  }
}

function handleList(flags) {
  const { locale } = getCliI18n(flags);
  const result = scanSessions(flags['sessions-dir'], {
    provider: flags.provider || '',
    search: flags.search || '',
    page: flags.page ? Number(flags.page) : 1,
    limit: flags.limit ? Number(flags.limit) : 50,
    includePreview: true,
    locale
  });

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSessions(result, flags);
}

function handleStats(flags) {
  const { locale, t } = getCliI18n(flags);
  const overview = getOverview(flags['sessions-dir'], { locale });
  if (flags.json) {
    console.log(JSON.stringify(overview, null, 2));
    return;
  }

  console.log(`${t('cli.labels.sessionsDirectory')}: ${overview.sessionsDir}`);
  console.log(`${t('cli.labels.sessions')}: ${overview.totals.sessions}`);
  console.log(`${t('cli.labels.providers')}: ${overview.totals.providers}`);
  console.log(`${t('cli.labels.backups')}: ${overview.totals.backups}`);
  console.log(`${t('cli.labels.diskUsage')}: ${overview.totals.bytesDisplay}`);
  console.log(`${t('cli.labels.latestSession')}: ${overview.latestSessionAtDisplay || t('cli.table.unknown')}`);
  console.log('');
  for (const provider of overview.providers) {
    console.log(`  ${provider.name.padEnd(18)} ${provider.count}`);
  }
}

function handleDoctor(flags) {
  const { locale, t } = getCliI18n(flags);
  const doctor = runDoctor(flags['sessions-dir'], { locale, t });
  if (flags.json) {
    console.log(JSON.stringify(doctor, null, 2));
    return;
  }

  console.log(`${t('cli.labels.sessionsDirectory')}: ${doctor.sessionsDir}`);
  console.log(`${t('cli.labels.healthy')}: ${doctor.ok ? t('web.doctor.healthy') : t('web.doctor.needsAttention')}`);
  console.log(`${t('cli.labels.invalidMetaFiles')}: ${doctor.summary.invalidMetaCount}`);
  console.log(`${t('cli.labels.missingProvider')}: ${doctor.summary.missingProviderCount}`);
  console.log(`${t('cli.labels.missingWorkspace')}: ${doctor.summary.missingWorkspaceCount}`);
  console.log(`${t('cli.labels.duplicateIds')}: ${doctor.summary.duplicateIdCount}`);
  console.log(`${t('cli.labels.missingThreads')}: ${doctor.summary.missingThreadCount}`);
  console.log(`${t('cli.labels.providerMismatches')}: ${doctor.summary.providerMismatchCount}`);
  console.log(`${t('cli.labels.missingSessionIndex')}: ${doctor.summary.missingSessionIndexCount}`);
  console.log(`${t('cli.labels.backups')}: ${doctor.summary.backupCount}`);
  console.log(`${t('cli.labels.range')}: ${doctor.summary.oldestTimestampDisplay || t('cli.table.unknown')} -> ${doctor.summary.latestTimestampDisplay || t('cli.table.unknown')}`);

  if (doctor.issues.length) {
    console.log('');
    for (const issue of doctor.issues.slice(0, 25)) {
      console.log(`[${issue.severity}] ${issue.relativePath} | ${issue.message}`);
    }
  }
}

function handleBackups(flags) {
  const { locale, t } = getCliI18n(flags);
  const backups = listBackups(flags['sessions-dir'], { locale });
  if (flags.json) {
    console.log(JSON.stringify(backups, null, 2));
    return;
  }

  if (!backups.length) {
    console.log(t('cli.labels.noBackups'));
    return;
  }

  for (const backup of backups) {
    console.log(t('cli.backupsLine', {
      backupId: backup.backupId,
      createdAt: backup.createdAtDisplay || backup.createdAt,
      entryCount: backup.entryCount,
      label: backup.label
    }));
  }
}

async function handleMigrate(flags) {
  const { locale, t } = getCliI18n(flags);
  if (!flags.target) {
    throw new Error(t('cli.errors.targetRequired'));
  }

  const selection = toSelection(flags);
  const preview = previewMigration(flags['sessions-dir'], selection, flags.target, {
    locale,
    t,
    targetSource: flags.source
  });

  if (flags.json && flags['dry-run']) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  console.log(`${t('cli.labels.selectedSessions')}: ${preview.totalSelected}`);
  console.log(`${t('cli.labels.actionable')}: ${preview.actionable}`);
  console.log(`${t('cli.labels.skipped')}: ${preview.skipped}`);
  console.log(`${t('cli.labels.targetProvider')}: ${preview.targetProvider}`);

  if (!preview.totalSelected) {
    return;
  }

  if (flags['dry-run']) {
    console.log('');
    for (const item of preview.items.slice(0, 50)) {
      console.log(`${item.skipped ? t('cli.table.skip') : t('cli.table.plan')} ${item.relativePath} | ${item.from} -> ${item.to}`);
    }
    return;
  }

  if (!flags.yes) {
    const confirmed = await confirmPrompt(t('cli.confirm.migrate', {
      count: preview.actionable,
      provider: preview.targetProvider
    }));
    if (!confirmed) {
      console.log(t('cli.status.cancelled'));
      return;
    }
  }

  const result = migrateSessions(flags['sessions-dir'], selection, flags.target, {
    dryRun: false,
    locale,
    t,
    targetSource: flags.source
  });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  for (const item of result.results.slice(0, 100)) {
    const status = item.ok ? (item.skipped ? t('cli.table.skip') : t('cli.table.done')) : t('cli.table.fail');
    console.log(`${status} ${item.relativePath} | ${item.from} -> ${item.to}${item.error ? ` | ${item.error}` : ''}`);
  }
  console.log('');
  console.log(`${t('cli.labels.migrated')}: ${result.migrated}`);
  console.log(`${t('cli.labels.skipped')}: ${result.skipped}`);
  console.log(`${t('cli.labels.failed')}: ${result.failed}`);
  if (result.backupId) {
    console.log(`${t('cli.labels.backup')}: ${result.backupId}`);
  }
}

async function handleRestore(flags) {
  const { locale, t } = getCliI18n(flags);
  if (!flags.backup) {
    throw new Error(t('cli.errors.backupRequired'));
  }

  if (!flags.yes) {
    const confirmed = await confirmPrompt(t('cli.confirm.restore', {
      backup: flags.backup
    }));
    if (!confirmed) {
      console.log(t('cli.status.cancelled'));
      return;
    }
  }

  const result = restoreFromBackup(flags.backup, flags['sessions-dir'], { locale, t });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const item of result.results.slice(0, 100)) {
    console.log(`${item.ok ? t('cli.table.done') : t('cli.table.fail')} ${item.relativePath}${item.error ? ` | ${item.error}` : ''}`);
  }
  console.log('');
  console.log(`${t('cli.labels.restored')}: ${result.restored}`);
  console.log(`${t('cli.labels.failed')}: ${result.failed}`);
  if (result.preRestoreBackupId) {
    console.log(`${t('cli.labels.preRestoreBackup')}: ${result.preRestoreBackupId}`);
  }
}

function handleExport(flags) {
  const { locale, t } = getCliI18n(flags);
  const selection = toSelection(flags);
  const artifact = buildSessionExport(
    flags['sessions-dir'],
    selection,
    flags.format || 'markdown',
    {
      locale,
      t
    }
  );
  const saved = writeSessionExport(flags['sessions-dir'], artifact, {
    outputPath: flags.output
  });

  if (flags.json) {
    console.log(JSON.stringify({
      ok: true,
      format: saved.format,
      fileName: saved.fileName,
      outputPath: saved.outputPath,
      sessionCount: saved.sessionCount,
      exportedAt: saved.exportedAt
    }, null, 2));
    return;
  }

  console.log(`${t('cli.labels.exportFormat')}: ${saved.format}`);
  console.log(`${t('cli.labels.selectedSessions')}: ${saved.sessionCount}`);
  console.log(`${t('cli.labels.exportedFile')}: ${saved.outputPath}`);
}

function handleRepair(flags) {
  const { t } = getCliI18n(flags);
  const result = repairSessionIndexes(getSessionsDir(flags['sessions-dir']), {
    repairSessionIndex: true,
    rewriteSessionIndex: true,
    includeArchivedSessions: true
  });

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`${t('cli.labels.sessionsDirectory')}: ${result.sessionsDir}`);
  console.log(`${t('cli.labels.scanned')}: ${result.scanned}`);
  console.log(`${t('cli.labels.insertedThreads')}: ${result.insertedThreads}`);
  console.log(`${t('cli.labels.updatedIndexes')}: ${result.updatedThreads}`);
  console.log(`${t('cli.labels.addedSessionIndex')}: ${result.addedSessionIndexEntries}`);
  console.log(`${t('cli.labels.sessionIndexEntriesWritten')}: ${result.sessionIndexEntriesWritten}`);
  console.log(`${t('cli.labels.failed')}: ${result.failed}`);
  if (result.sessionIndexBackupPath) {
    console.log(`${t('cli.labels.sessionIndexBackup')}: ${result.sessionIndexBackupPath}`);
  }
  console.log('');

  for (const item of result.results.slice(0, 100)) {
    console.log(`${item.ok ? t('cli.table.done') : t('cli.table.fail')} ${item.relativePath}${item.error ? ` | ${item.error}` : ''}`);
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const action = command || (process.pkg ? 'serve' : 'help');

  if (process.pkg && !command && flags.open === undefined) {
    flags.open = true;
  }

  switch (action) {
    case 'serve':
      await handleServe(flags);
      break;
    case 'list':
      handleList(flags);
      break;
    case 'stats':
      handleStats(flags);
      break;
    case 'doctor':
      handleDoctor(flags);
      break;
    case 'backups':
      handleBackups(flags);
      break;
    case 'migrate':
      await handleMigrate(flags);
      break;
    case 'export':
      handleExport(flags);
      break;
    case 'repair':
      handleRepair(flags);
      break;
    case 'restore':
      await handleRestore(flags);
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp(flags);
      break;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

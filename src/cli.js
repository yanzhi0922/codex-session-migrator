#!/usr/bin/env node
'use strict';

const { exec } = require('child_process');
const readline = require('readline');
const { startServer } = require('./server');
const { formatTimestamp } = require('./format');
const { getOverview, listBackups, runDoctor, scanSessions } = require('./scanner');
const { migrateSessions, previewMigration, restoreFromBackup } = require('./migrator');

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

function printHelp() {
  console.log(`
Codex Session Migrator

Usage:
  codex-migrate <command> [options]

Commands:
  serve      Start the local web app
  list       List sessions
  stats      Show provider and storage overview
  doctor     Check for invalid or suspicious session files
  backups    List backup snapshots
  migrate    Re-tag sessions to a new provider
  restore    Restore sessions from a backup snapshot

Common flags:
  --sessions-dir <path>   Override the Codex sessions directory
  --json                  Print JSON output when supported
  --all                   Allow full-library migration when no filters are set

Examples:
  codex-migrate serve --open
  codex-migrate list --provider openai --limit 20
  codex-migrate migrate --provider openai --target crs --dry-run
  codex-migrate restore --backup 20260328180102-migration-ab12cd --yes
`);
}

function openInBrowser(url) {
  const command =
    process.platform === 'win32' ? `start ${url}` :
    process.platform === 'darwin' ? `open ${url}` :
    `xdg-open ${url}`;

  exec(command);
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

function printSessions(result) {
  console.log(`Sessions directory: ${result.sessionsDir}`);
  console.log(`Total matching: ${result.total} / ${result.totals.all}`);
  console.log('');
  for (const provider of result.providers) {
    console.log(`  ${provider.name.padEnd(18)} ${provider.count}`);
  }
  console.log('');

  for (const item of result.items) {
    const preview = item.preview ? ` | ${item.preview}` : '';
    console.log(`[${item.provider}] ${item.timestampDisplay || item.timestamp || 'unknown'} | ${item.relativePath}${preview}`);
  }
}

async function handleServe(flags) {
  const server = await startServer({
    host: flags.host || '127.0.0.1',
    port: flags.port || process.env.PORT || 5730,
    sessionsDir: flags['sessions-dir']
  });

  console.log(`Codex Session Migrator listening on ${server.url}`);
  console.log(`Sessions directory: ${server.sessionsDir}`);

  if (flags.open) {
    openInBrowser(server.url);
  }
}

function handleList(flags) {
  const result = scanSessions(flags['sessions-dir'], {
    provider: flags.provider || '',
    search: flags.search || '',
    page: flags.page ? Number(flags.page) : 1,
    limit: flags.limit ? Number(flags.limit) : 50,
    includePreview: true
  });

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSessions(result);
}

function handleStats(flags) {
  const overview = getOverview(flags['sessions-dir']);
  if (flags.json) {
    console.log(JSON.stringify(overview, null, 2));
    return;
  }

  console.log(`Sessions directory: ${overview.sessionsDir}`);
  console.log(`Sessions: ${overview.totals.sessions}`);
  console.log(`Providers: ${overview.totals.providers}`);
  console.log(`Backups: ${overview.totals.backups}`);
  console.log(`Disk usage: ${overview.totals.bytesDisplay}`);
  console.log(`Latest session: ${overview.latestSessionAtDisplay || 'unknown'}`);
  console.log('');
  for (const provider of overview.providers) {
    console.log(`  ${provider.name.padEnd(18)} ${provider.count}`);
  }
}

function handleDoctor(flags) {
  const doctor = runDoctor(flags['sessions-dir']);
  if (flags.json) {
    console.log(JSON.stringify(doctor, null, 2));
    return;
  }

  console.log(`Sessions directory: ${doctor.sessionsDir}`);
  console.log(`Healthy: ${doctor.ok ? 'yes' : 'no'}`);
  console.log(`Invalid meta files: ${doctor.summary.invalidMetaCount}`);
  console.log(`Missing provider: ${doctor.summary.missingProviderCount}`);
  console.log(`Duplicate ids: ${doctor.summary.duplicateIdCount}`);
  console.log(`Backups: ${doctor.summary.backupCount}`);
  console.log(`Range: ${doctor.summary.oldestTimestampDisplay || 'unknown'} -> ${doctor.summary.latestTimestampDisplay || 'unknown'}`);

  if (doctor.issues.length) {
    console.log('');
    for (const issue of doctor.issues.slice(0, 25)) {
      console.log(`[${issue.severity}] ${issue.relativePath} | ${issue.message}`);
    }
  }
}

function handleBackups(flags) {
  const backups = listBackups(flags['sessions-dir']);
  if (flags.json) {
    console.log(JSON.stringify(backups, null, 2));
    return;
  }

  if (!backups.length) {
    console.log('No backups found.');
    return;
  }

  for (const backup of backups) {
    console.log(`${backup.backupId} | ${formatTimestamp(backup.createdAt) || backup.createdAt} | ${backup.entryCount} files | ${backup.label}`);
  }
}

async function handleMigrate(flags) {
  if (!flags.target) {
    throw new Error('--target is required for migrate.');
  }

  const selection = toSelection(flags);
  const preview = previewMigration(flags['sessions-dir'], selection, flags.target);

  if (flags.json && flags['dry-run']) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  console.log(`Selected sessions: ${preview.totalSelected}`);
  console.log(`Actionable: ${preview.actionable}`);
  console.log(`Skipped: ${preview.skipped}`);
  console.log(`Target provider: ${preview.targetProvider}`);

  if (!preview.totalSelected) {
    return;
  }

  if (flags['dry-run']) {
    console.log('');
    for (const item of preview.items.slice(0, 50)) {
      console.log(`${item.skipped ? '[skip]' : '[plan]'} ${item.relativePath} | ${item.from} -> ${item.to}`);
    }
    return;
  }

  if (!flags.yes) {
    const confirmed = await confirmPrompt(`Migrate ${preview.actionable} sessions to "${preview.targetProvider}"?`);
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  }

  const result = migrateSessions(flags['sessions-dir'], selection, flags.target, { dryRun: false });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  for (const item of result.results.slice(0, 100)) {
    const status = item.ok ? (item.skipped ? '[skip]' : '[done]') : '[fail]';
    console.log(`${status} ${item.relativePath} | ${item.from} -> ${item.to}${item.error ? ` | ${item.error}` : ''}`);
  }
  console.log('');
  console.log(`Migrated: ${result.migrated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Failed: ${result.failed}`);
  if (result.backupId) {
    console.log(`Backup: ${result.backupId}`);
  }
}

async function handleRestore(flags) {
  if (!flags.backup) {
    throw new Error('--backup is required for restore.');
  }

  if (!flags.yes) {
    const confirmed = await confirmPrompt(`Restore sessions from "${flags.backup}"?`);
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  }

  const result = restoreFromBackup(flags.backup, flags['sessions-dir']);
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const item of result.results.slice(0, 100)) {
    console.log(`${item.ok ? '[done]' : '[fail]'} ${item.relativePath}${item.error ? ` | ${item.error}` : ''}`);
  }
  console.log('');
  console.log(`Restored: ${result.restored}`);
  console.log(`Failed: ${result.failed}`);
  if (result.preRestoreBackupId) {
    console.log(`Pre-restore backup: ${result.preRestoreBackupId}`);
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const action = command || 'help';

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
    case 'restore':
      await handleRestore(flags);
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
      break;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

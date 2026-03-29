# Codex Session Migrator

[![CI](https://github.com/yanzhi0922/codex-session-migrator/actions/workflows/test.yml/badge.svg)](https://github.com/yanzhi0922/codex-session-migrator/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/yanzhi0922/codex-session-migrator)](https://github.com/yanzhi0922/codex-session-migrator/releases)
[![License](https://img.shields.io/github/license/yanzhi0922/codex-session-migrator)](https://github.com/yanzhi0922/codex-session-migrator/blob/main/LICENSE)

Move Codex Desktop session history across model providers without losing your archive.

中文说明：这是一个用于管理 `~/.codex/sessions` 的本地工具，支持在不同 provider 之间迁移会话、自动备份、恢复快照，并且现在同时支持英文与简体中文界面。

`Codex Session Migrator` is a zero-dependency local toolkit for inspecting, migrating, repairing, exporting, backing up, and restoring Codex session files stored under `~/.codex/sessions`. It ships as both a browser UI and a CLI, and it is designed to be safe enough for real personal archives rather than one-off JSONL hacks.

## Why this exists

Codex Desktop stores each conversation with a `model_provider` tag inside the first JSONL line (`session_meta`). If you switch providers, old sessions can disappear from the UI because they still point at the previous provider. Editing those files by hand is error-prone, especially at scale.

This tool solves that with:

- A local web app for browsing sessions by provider, search term, and path.
- Built-in English / Simplified Chinese language switching for both the web UI and CLI.
- Session export in `markdown`, `html`, `json`, `jsonl`, `csv`, and `txt`.
- Manifest-backed backups before every real migration.
- Restore support that can roll back from any saved snapshot.
- A `doctor` command that flags malformed session files, missing workspace paths, missing SQLite thread indexes, and missing `session_index` entries.
- A `repair` command and web action that rebuild missing SQLite `threads` rows and rewrites `session_index` from live JSONL sessions.
- A CLI for automation and scripting.
- No runtime dependencies beyond Node.js.

## Features

- Safe provider migration that rewrites `session_meta` and keeps SQLite thread indexes in sync.
- Structured session export that extracts transcript turns and useful metadata instead of dumping raw JSONL.
- Compatibility diagnostics that explain why sessions may still stay hidden in CodexManager.
- Repair flows that refresh both SQLite `threads` and `session_index.jsonl`, not just one side of the index state.
- Explicit backup snapshots stored under `__backups__/.../manifest.json`.
- Restore flow with pre-restore safety snapshots.
- Browser UI with provider overview, searchable session table, concise migration preview, backup list, and health report.
- Better UX with remembered filters, provider suggestion hints, clickable provider chips, export controls, and a modal session detail inspector.
- Prompt Preview that shows the latest useful prompt first and keeps the full reversed prompt timeline in the detail modal.
- Deferred backup / Doctor loading so the main session table appears faster on larger libraries.
- CLI commands for `serve`, `list`, `stats`, `doctor`, `repair`, `migrate`, `export`, `restore`, and `backups`.
- Protective guardrail against accidental full-library migration unless `--all` is explicitly used.
- Works on Windows, macOS, and Linux.

## Quick start

### Desktop users

Download the latest Windows portable package from [GitHub Releases](https://github.com/yanzhi0922/codex-session-migrator/releases), unzip it, and double-click `Codex Session Migrator.cmd`.

The packaged desktop build:

- bundles its own Node.js runtime, so no separate install is required
- opens the local app automatically in your browser
- targets `~/.codex/sessions` by default
- includes repair, migration, backup, restore, and health-check tools
- includes dedicated one-click launchers for the browser UI, CLI, and index repair
- lets you double-click `codex-migrate.cmd` safely without the window flashing closed

### Developers

```bash
git clone https://github.com/yanzhi0922/codex-session-migrator.git
cd codex-session-migrator
npm install
npm start
```

Then open:

```text
http://127.0.0.1:5730
```

The web UI now remembers your language, filters, and preferred target provider across refreshes.

The default sessions directory is:

```text
~/.codex/sessions
```

To override it:

```bash
npm start -- --sessions-dir /path/to/sessions
```

To start the CLI in Chinese:

```bash
codex-migrate stats --lang zh-CN
```

You can also switch the web UI language from the top-right language selector.

## CLI

### Start the local app

```bash
codex-migrate serve --open
codex-migrate serve --open --lang zh-CN
```

### List sessions

```bash
codex-migrate list --provider openai --limit 20
codex-migrate list --search traffic --json
```

### Show overview

```bash
codex-migrate stats
codex-migrate doctor
codex-migrate backups
codex-migrate repair
```

### Repair missing indexes

If migrated sessions do not show up in CodexManager, rebuild the SQLite thread index:

```bash
codex-migrate repair
```

`repair` now also refreshes `session_index.jsonl` and reports sessions that are still missing a usable workspace path.

### Preview a migration

```bash
codex-migrate migrate --provider openai --target crs --dry-run
```

### Run a migration

```bash
codex-migrate migrate --provider openai --target crs --yes
```

### Restore from backup

```bash
codex-migrate restore --backup 20260328180102-migration-ab12cd --yes
```

### Export sessions

```bash
codex-migrate export --provider codexmanager --format markdown
codex-migrate export --all --format jsonl --output ./exports/
```

## Safety model

This project is intentionally conservative:

- It rewrites only the first JSONL record, not the entire file with a regex.
- Every real migration creates a backup snapshot before any session file is modified.
- Every restore creates a pre-restore snapshot first.
- It refuses to target the entire library unless you explicitly opt in with `--all`.
- It keeps backup metadata in a manifest so restore is deterministic.

## Backup layout

Backup snapshots live here:

```text
~/.codex/sessions/__backups__/<backup-id>/
```

Each snapshot contains:

- `manifest.json`
- `files/...` with the original session files preserved by relative path

That means restore is based on a recorded manifest, not on guessing the right file by filename pattern.

## Web API

The local app exposes JSON endpoints:

- `GET /api/overview`
- `GET /api/app-config`
- `GET /api/dashboard`
- `GET /api/providers`
- `GET /api/sessions`
- `GET /api/session?path=...`
- `GET /api/backups`
- `GET /api/doctor`
- `POST /api/exports/download`
- `POST /api/migrations/preview`
- `POST /api/migrations/run`
- `POST /api/indexes/repair`
- `POST /api/backups/restore`

## Development

Requirements:

- Node.js `>= 24`

Run tests:

```bash
npm test
```

Build a portable Windows release:

```bash
npm ci
npm run build:release:win
```

Current test coverage includes:

- Session scanning and provider stats
- Prompt preview extraction
- Session export generation and download coverage
- English / Chinese localization paths
- Malformed file detection
- Migration preview safety guard
- Backup-backed migration and restore
- SQLite thread repair and metadata reconstruction
- HTTP API smoke coverage

## Project structure

```text
public/
  app.js
  favicon.svg
  index.html
  styles.css
src/
  backup-store.js
  cli.js
  format.js
  migrator.js
  routes.js
  scanner.js
  server.js
test/
  helpers.js
  migrator.test.js
  scanner.test.js
  server.test.js
```

## License

MIT

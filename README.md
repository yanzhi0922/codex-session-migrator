# Codex Session Migrator

Move Codex Desktop session history across model providers without losing your archive.

`Codex Session Migrator` is a zero-dependency local toolkit for inspecting, migrating, backing up, and restoring Codex session files stored under `~/.codex/sessions`. It ships as both a browser UI and a CLI, and it is designed to be safe enough for real personal archives rather than one-off JSONL hacks.

## Why this exists

Codex Desktop stores each conversation with a `model_provider` tag inside the first JSONL line (`session_meta`). If you switch providers, old sessions can disappear from the UI because they still point at the previous provider. Editing those files by hand is error-prone, especially at scale.

This tool solves that with:

- A local web app for browsing sessions by provider, search term, and path.
- Manifest-backed backups before every real migration.
- Restore support that can roll back from any saved snapshot.
- A `doctor` command that flags malformed session files.
- A CLI for automation and scripting.
- No runtime dependencies beyond Node.js.

## Features

- Safe provider migration that rewrites only the `session_meta` line.
- Explicit backup snapshots stored under `__backups__/.../manifest.json`.
- Restore flow with pre-restore safety snapshots.
- Browser UI with provider overview, searchable session table, migration preview, backup list, and health report.
- CLI commands for `serve`, `list`, `stats`, `doctor`, `migrate`, `restore`, and `backups`.
- Protective guardrail against accidental full-library migration unless `--all` is explicitly used.
- Works on Windows, macOS, and Linux.

## Quick start

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

The default sessions directory is:

```text
~/.codex/sessions
```

To override it:

```bash
npm start -- --sessions-dir /path/to/sessions
```

## CLI

### Start the local app

```bash
codex-migrate serve --open
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
```

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
- `GET /api/providers`
- `GET /api/sessions`
- `GET /api/session?path=...`
- `GET /api/backups`
- `GET /api/doctor`
- `POST /api/migrations/preview`
- `POST /api/migrations/run`
- `POST /api/backups/restore`

## Development

Requirements:

- Node.js `>= 18.17`

Run tests:

```bash
npm test
```

Current test coverage includes:

- Session scanning and provider stats
- Prompt preview extraction
- Malformed file detection
- Migration preview safety guard
- Backup-backed migration and restore
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

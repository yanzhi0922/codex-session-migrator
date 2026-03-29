# Changelog

## 3.2.0

- Added first-class session export across CLI and web UI, with downloads in `markdown`, `html`, `json`, `jsonl`, `csv`, and `txt`.
- Added structured export rendering that keeps session metadata, useful prompt previews, and extracted user / assistant transcript turns instead of raw JSONL dumps.
- Upgraded the session table Prompt Preview to prioritize the newest useful user prompt, suppress terminal noise, and keep full prompt timelines in the detail modal.
- Switched the session inspector to a closable modal with previous / next navigation and keyboard support, so the main table stays readable.
- Deferred heavy backup and Doctor panel loading until after the main session table renders, reducing initial dashboard latency on larger archives.
- Expanded automated coverage for exports and lightweight dashboard API behavior.

## 3.1.0

- Fixed the real visibility bug where migrated sessions could remain hidden in CodexManager because `session_index.jsonl` was still incomplete.
- Added SQLite thread index repair and full `session_index` reconciliation for migrated, restored, and manually repaired sessions.
- Made `doctor` validate `session_index` coverage by default instead of only checking SQLite thread rows.
- Made `repair` rebuild a canonical `session_index.jsonl`, create a safety backup when rewriting it, and report how many entries were written.
- Made migration and restore flows automatically patch `session_index` entries for touched sessions so new results show up immediately.
- Added richer prompt preview sanitization, reversed prompt timeline rendering, and modal session inspector UX.
- Added full Simplified Chinese support across CLI and web UI.
- Reduced dashboard refresh cost by combining the single-request dashboard API with page-level prompt enrichment instead of scanning prompt previews for the whole library on every refresh.
- Added clearer Doctor guidance in the web UI so users can see when hidden sessions are caused by missing `session_index` coverage or missing workspace metadata.
- Added a portable Windows zip release with a bundled official Node.js runtime and one-click launchers.
- Added GitHub Actions workflows for CI and tagged GitHub Releases.
- Hardened startup UX with browser auto-open for packaged builds, port fallback when the default port is busy, and a no-flash double-click `codex-migrate.cmd` menu.

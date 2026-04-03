# Project Handoff (2026-04-03)

## Snapshot Scope
- Repository snapshot prepared from local workspace state on 2026-04-03.
- Current app version (from `app/package.json`): `3.2.0`.
- This handoff keeps unresolved items for later iteration instead of forcing risky fixes.

## What Was Organized
- Added/updated Windows desktop recovery launcher:
  - `Codex Desktop One-Click Self Heal.cmd`
- Updated launcher menu wiring:
  - `codex-migrate.cmd`
- Updated quick-start notes:
  - `START HERE.txt`
- Updated project README to match current `app/` layout and desktop self-heal behavior.

## Current Health Check
- Test run command:
  - `app/runtime/node.exe --disable-warning=ExperimentalWarning --test app/test/*.test.js`
- Result:
  - `29 passed, 0 failed`

## Known Unresolved Issues (Intentional Carry-Over)
1. Codex Desktop process can still get stuck in long-lived stale states on some machines/workloads.
2. Large Git/background command bursts can correlate with desktop-side hangs/timeouts.
3. Desktop self-heal is currently Windows-focused; cross-platform parity is not implemented yet.
4. Some cache-state diagnostics are operational rather than productized in app UI/API.

## Recommended Next Iteration
1. Add an in-app "desktop health" endpoint and button to trigger safe heal flow.
2. Add lightweight lock detection before cache cleanup to avoid repeated retries.
3. Add optional dry-run mode for self-heal script (report-only).
4. Add integration tests around repeated desktop recovery scenarios.

## Notes
- Desktop self-heal launcher intentionally targets only Codex Desktop processes (`Codex.exe` / `codex.exe`).
- It does not intentionally stop `CodexManager.exe`.

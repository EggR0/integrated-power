# Follow-up Hardening Summary - 2026-07-03

## Purpose

Continued from the initial issue audit to close remaining gaps around:

- inconsistent path detection across scripts,
- stale debate/discussion path documentation,
- Open Runs target existence,
- packaged Antigravity extension artifact consistency.

## Additional Fixes

- Normalized most script storage resolution paths so scripts resolve `$repoRoot` first and then call `Get-GlobalStorage`.
- Removed direct `.agents/dashboard_global_storage.txt` parsing from operational scripts where it duplicated `Get-GlobalStorage`.
- Fixed bundled `Invoke-AiWorkWindow.ps1` so it no longer computes storage before resolving repo root.
- Updated `references/debate.md` to document globalStorage `discussions/` and `sessions/<run-id>/` instead of repo-local `discussions/` and `.system_generated/`.
- Ensured Open Runs has a concrete globalStorage target:
  `c:/Users/jsp0/AppData/Roaming/Antigravity IDE/User/globalStorage/integratedpower.antigravity-ide-dashboard/workspaces/b0fd0a361a22dddbbffb0df2bdd4900a/.agent-runs/runs.jsonl`
- Repackaged `vscode-extension/antigravity-ide-dashboard-0.1.0.vsix` after bundled asset changes.
- Installed the rebuilt VSIX into Antigravity IDE with `antigravity-ide.cmd --install-extension ... --force`.
- Confirmed Antigravity IDE lists `integratedpower.antigravity-ide-dashboard@0.1.0`.
- Added extension tests that lock the Antigravity globalStorage workspace hash behavior and missing-runs-file behavior.
- Added a regression test that checks package commands, webview token-status behavior, and debate output documentation for removed workflow/path regressions.
- Added a controller test that proves refresh requests made during an active refresh are queued and executed afterward instead of being dropped.
- Kept the webview Refresh button enabled while loading so repeated clicks can reach the queued refresh logic.
- Added integration coverage proving the registered `Open Runs` command opens the globalStorage `.agent-runs/runs.jsonl` file.
- Verified `AgentRegistry` appends running/completed events to the globalStorage `.agent-runs/runs.jsonl`; the temporary verification record was restored afterward.
- Added `docs/operations/agent-execution-modes.md` to clarify Debate, Job, Work Window, Discussion, and Open Runs terminology.
- Changed the default `npm test` path to a headless Node-based verification script, so routine tests no longer launch the VS Code/Electron extension host.
- Moved the old Electron extension-host test runner behind the explicit `npm run test:extension` command.

## Current Resolution Status

1. Wrong project/path recognition: resolved at extension/runtime/package level; script path handling is substantially hardened.
2. Refresh button/loading instability: resolved at code level; still best verified with a live Antigravity IDE click test.
3. Workspace duplicate generated folders: resolved for runtime outputs; generated debate/session/run files now target globalStorage.
4. Athena Loop coupling: resolved; no Athena/OrchestratorService references remain in searched source/package areas.
5. Open Runs ambiguity: resolved structurally; `Open Runs` opens globalStorage `.agent-runs/runs.jsonl`, and that file now exists.
6. Debate/discussion/job ambiguity: improved; mode contracts now describe distinct use cases and globalStorage output paths. Further UX naming simplification could still help, but the stale path contradiction is fixed.

## Verification

- Search for stale path/function patterns:
  - `dashboardStorageFile`
  - `operational-data`
  - `.system_generated`
  - `<repo-root>/discussions`
  - `launchAthenaLoop`
  - `OrchestratorService`
  - `Athena`
  Result: no matches in operational source/package areas searched.
- PowerShell parser check over `scripts/` and bundled orchestrator scripts: passed.
- `npx tsc -p ./ --noEmit`: passed.
- `npm test`: passed using the headless Node test runner.
- `npm run test:extension`: reserved for explicit extension-host checks because it launches the VS Code/Electron test window.
- `npx --yes @vscode/vsce package --allow-missing-repository`: passed.
- `antigravity-ide.cmd --install-extension vscode-extension/antigravity-ide-dashboard-0.1.0.vsix --force`: printed success, then the CLI emitted an internal fatal error; follow-up extension listing confirmed the install was present.
- `antigravity-ide.cmd --list-extensions --show-versions`: confirmed `integratedpower.antigravity-ide-dashboard@0.1.0`.
- `AgentRegistry` append verification: passed, 2 event records observed for a temporary run before restoring the file.
- VSIX spot checks confirmed:
  - `extension/out/extension.js` uses `globalStorageUri`.
  - `extension/out/WorkspacePaths.js` uses `context.globalStorageUri.fsPath`.
  - `extension/webview/main.js` preserves cached token status, sets `isTokenLoading = true`, and keeps the Refresh button enabled.
  - bundled `references/debate.md` documents globalStorage `discussions/` and `sessions/`.

## Remaining Manual Check

Optional live UI smoke check:

- a real delegated job appends a run record to that file.

The rebuilt extension is installed in Antigravity IDE. Command-level Open Runs behavior and refresh queue behavior are now covered by automated tests; only visual feel and a real external delegated job append remain outside automated coverage.

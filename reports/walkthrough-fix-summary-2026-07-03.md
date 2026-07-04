# Walkthrough Fix Summary - 2026-07-03

## Fixed

- Preserved cached `tokenStatus` in `vscode-extension/webview/main.js` instead of resetting it to zero on `DOMContentLoaded`.
- Reworked `scripts/util/GlobalStorage.psm1` so missing `.agents/dashboard_global_storage.txt` no longer falls back to workspace-local `operational-data`; it now derives the Antigravity dashboard globalStorage workspace path from the repository path hash.
- Updated `scripts/registry/AgentRegistry.psm1` to use `Get-GlobalStorage`.
- Fixed bundled Codex orchestrator scripts so repo root is resolved before globalStorage lookup.
- Updated bundled Codex debate defaults so discussions and sessions are written under dashboard globalStorage.
- Removed stale `vscode-extension/out` and rebuilt it from current TypeScript sources.
- Removed stale `vscode-extension/antigravity-ide-dashboard-0.1.0.vsix` and recreated it.
- Removed the leftover workspace-local `operational-data` directory.
- Updated bundled/user-facing docs that still referenced `operational-data`.

## Verification

- `Import-Module .\scripts\util\GlobalStorage.psm1 -Force; Get-GlobalStorage -RepoRoot (Get-Location).Path`
  - Matched `.agents/dashboard_global_storage.txt`.
- `npx tsc -p ./ --noEmit`
  - Passed before rebuild.
- `npm run compile`
  - Passed.
- `npx --yes @vscode/vsce package --allow-missing-repository`
  - Created `vscode-extension/antigravity-ide-dashboard-0.1.0.vsix`.
- `npm test`
  - Passed: 2 tests.
- VSIX spot checks confirmed:
  - `extension/out/extension.js` uses `globalStorageUri` and does not include `launchAthenaLoop`/`OrchestratorService`.
  - `extension/out/WorkspacePaths.js` uses `context.globalStorageUri.fsPath`.
  - `extension/webview/main.js` keeps cached `tokenStatus` and sets `isTokenLoading = true`.
  - `extension/package.json` contains only refresh and open-runs commands.

## Notes

- `vsce` emitted a warning that no LICENSE file exists. Packaging still succeeded.
- The workspace already had many unrelated untracked/deleted files; those were left untouched.

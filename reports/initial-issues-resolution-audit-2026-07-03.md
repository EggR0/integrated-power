# Initial Issues Resolution Audit - 2026-07-03

## Verdict

The original critical path problems are mostly addressed at the source/package level, but not all user-facing ambiguity is gone.

- Issues 1-4: mostly resolved by code/package changes.
- Issue 5: implementation target is now clear, but runtime data production is not fully proven.
- Issue 6: partially unresolved; mode naming is better in the skill docs, but stale reference text and overlapping script concepts remain.

## 1. Wrong path recognized in other projects

Status: mostly resolved.

Evidence:

- `vscode-extension/src/WorkspacePaths.ts` derives workspace data from `context.globalStorageUri.fsPath/workspaces/<md5>`.
- `vscode-extension/src/extension.ts` writes the resolved path to `.agents/dashboard_global_storage.txt`.
- `vscode-extension/out/WorkspacePaths.js` and the packaged VSIX now use `globalStorageUri`.
- `scripts/util/GlobalStorage.psm1` no longer falls back to workspace-local `operational-data`; it derives the same Antigravity globalStorage path when the marker file is absent.

Remaining risk:

- Some scripts still read `.agents/dashboard_global_storage.txt` directly before falling back to `Get-GlobalStorage`. In a normal git workspace this is acceptable, but non-git or unusual launch contexts should still be tested.

Confidence: high for extension runtime path; medium for every standalone script path.

## 2. Refresh button and loading UI instability

Status: mostly resolved.

Evidence:

- `DashboardController.refresh()` now queues refresh requests with `isRefreshing` and `pendingRefreshForce`.
- Existing dashboard state is preserved while `isLoading` is set.
- `readDashboardState()` preserves the previous valid `tokenStatus` when a new read returns all-zero quota values.
- `webview/main.js` no longer resets cached `tokenStatus` to `emptyTokenStatus()` on load; it only sets `isTokenLoading = true`.
- `renderLoadingStrip()` is rendered as a fixed overlay, reducing layout shift.

Remaining risk:

- This was verified statically and through tests, but not by repeated manual clicking inside a live Antigravity IDE webview.

Confidence: medium-high.

## 3. Duplicate/meaningless data folders in the user work path

Status: mostly resolved for generated runtime data.

Evidence:

- Root `operational-data` was removed.
- No root `.system_generated`, `discussions`, or `debates` directory is present.
- Generated dashboard data now exists under:
  `C:/Users/jsp0/AppData/Roaming/Antigravity IDE/User/globalStorage/integratedpower.antigravity-ide-dashboard/workspaces/b0fd0a361a22dddbbffb0df2bdd4900a`
- Debate/session script defaults now write to globalStorage in the active scripts.

Remaining risk:

- `prompts/` still exists in the repository. It appears to be project source/configuration, not generated runtime data, so it was not removed.
- The bundled debate reference doc still says output goes under `<repo-root>/discussions/` and `<repo-root>/.system_generated/...`; that text is stale even though the script default has moved.

Confidence: high for current folder cleanup; medium for all future script paths.

## 4. Unnecessary Athena Loop coupling

Status: resolved.

Evidence:

- `vscode-extension/package.json` now only contributes refresh and open-runs commands.
- `vscode-extension/src/extension.ts` no longer registers `launchAthenaLoop`.
- `vscode-extension/src/OrchestratorService.ts` is absent.
- `vscode-extension/out/OrchestratorService.js` is absent.
- `rg` finds no `launchAthenaLoop`, `OrchestratorService`, or `Athena` references in `vscode-extension` or `scripts` excluding dependencies/test caches.
- Packaged VSIX no longer includes `OrchestratorService`.

Confidence: high.

## 5. Open Runs unclear

Status: partially resolved.

Evidence:

- `openRunsFile()` opens `this.paths.runsFileUri()`.
- `runsFileUri()` points to `.agent-runs/runs.jsonl` under the workspace-specific Antigravity globalStorage path.

Remaining risk:

- The current globalStorage directory contains `reports/dashboard-state.json`, but no `.agent-runs/runs.jsonl` was present during this audit.
- This means the command target is now clear, but whether all agent interactions are actually being recorded there still needs an end-to-end agent run verification.

Confidence: medium.

## 6. Duplicate/unclear workflow modes

Status: partially resolved, still needs cleanup.

Evidence:

- `codex-orchestrator/SKILL.md` defines three modes:
  - Debate Mode: architecture/tradeoff/second-opinion transcript.
  - Job Mode: bounded implementation/refactoring/test generation.
  - WorkWindow Mode: longer supervised queue/context aggregation.
- `job.md` and `workwindow.md` now reference dashboard globalStorage outputs.

Remaining risk:

- `references/debate.md` still documents old repo-local `discussions` and `.system_generated` output paths.
- The project still has both direct dispatch scripts and bundled plugin scripts, which can remain conceptually confusing unless documented as source vs installed/bundled entrypoints.
- Naming between debate/discussion/job is improved but not yet user-obvious.

Confidence: medium.

## Verification Commands

- `rg -n -e 'launchAthenaLoop' -e 'OrchestratorService' -e 'Athena' vscode-extension scripts -g '!**/node_modules/**' -g '!**/.vscode-test/**'`
- `rg -n -e 'globalStorageUri' -e 'dashboard_global_storage' -e 'operational-data' -e 'discussions' -e 'sessions' -e '.system_generated' vscode-extension scripts .agents -g '!**/node_modules/**' -g '!**/.vscode-test/**'`
- `rg -n -e 'isRefreshing' -e 'pendingRefreshForce' -e 'renderLoadingStrip' -e 'isTokenLoading = true' -e 'tokenStatus = emptyTokenStatus' vscode-extension/src vscode-extension/webview vscode-extension/out`
- `npm test` from `vscode-extension`

## Test Result

`npm test` passed: 2 tests passing.

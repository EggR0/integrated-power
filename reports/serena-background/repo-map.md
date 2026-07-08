# Serena Background Repo Map

- Run: `20260705-141624`
- Generated: 2026-07-05 14:18:23 +09:00
- Source: Serena health/index/cache + repository inventory
- Local LLM summary: C:\Users\jsp0\Documents\Intergrated POWER\reports\serena-background\runs\20260705-141624\local-llm-summary.md

## Coverage

- Files seen by inventory: 331
- Files included by policy: 48 / 48
- Files omitted by limit: 0
- Serena symbol files: 16
- Serena symbols exported: 1567
- PowerShell AST files: 31
- PowerShell AST functions: 95
- PowerShell parse-error files: 0
- Static fallback symbol files: 33

## Serena Status

- CLI found: True
- Health success: True
- Health log: C:\Users\jsp0\Documents\Intergrated POWER\.serena\logs\health-checks\health_check_20260705-141625.log
- Active tools: 25
- Analyzable file sampled by Serena: scripts\metrics\Get-QuotaSnapshot.mjs
- Sample symbols returned by get_symbols_overview: 7

## Routing Areas

### dispatch

- Files: 15
- Known symbols: 79
- Candidate files:
  - `scripts/dispatch/Export-PowerShellSymbols.ps1`
  - `scripts/dispatch/Invoke-AgenticLoop.ps1`
  - `scripts/dispatch/Invoke-AiderWorker.ps1`
  - `scripts/dispatch/Invoke-AiWorkWindow.ps1`
  - `scripts/dispatch/Invoke-CodexDebate.ps1`
  - `scripts/dispatch/Invoke-CodexJob.ps1`
  - `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
  - `scripts/dispatch/Invoke-LocalLLM.ps1`
  - `scripts/dispatch/Invoke-SerenaBackgroundJob.ps1`
  - `scripts/dispatch/Invoke-vLLMJob.ps1`
  - `scripts/dispatch/New-ContextManifest.ps1`
  - `scripts/dispatch/Select-AgenticDelegationMode.ps1`

### metrics

- Files: 8
- Known symbols: 12
- Candidate files:
  - `scripts/metrics/Count-GeminiInputTokens.ps1`
  - `scripts/metrics/Count-OpenAIInputTokens.ps1`
  - `scripts/metrics/Invoke-AntigravityUsageTool.ps1`
  - `scripts/metrics/Measure-AntigravityTranscript.ps1`
  - `scripts/metrics/Parse-CodexUsage.ps1`
  - `scripts/metrics/Parse-GeminiUsage.ps1`
  - `scripts/metrics/Track-Tokens.ps1`
  - `scripts/metrics/Update-LocalLLMMetric.ps1`

### root

- Files: 2
- Known symbols: 0
- Candidate files:
  - `AGENTS.md`
  - `README.md`

### scan

- Files: 3
- Known symbols: 4
- Candidate files:
  - `scripts/scan/Compare-ScanState.ps1`
  - `scripts/scan/Detect-ActiveWork.ps1`
  - `scripts/scan/Extract-Todos.ps1`

### schedule

- Files: 3
- Known symbols: 0
- Candidate files:
  - `scripts/schedule/Create-TimeBlocks.ps1`
  - `scripts/schedule/Register-CodexScheduledJob.ps1`
  - `scripts/schedule/Sync-Calendar.ps1`

### util

- Files: 2
- Known symbols: 0
- Candidate files:
  - `scripts/util/Extract-CodeBlock.ps1`
  - `scripts/util/read-agy-credential.ps1`

### vscode-extension

- Files: 2
- Known symbols: 0
- Candidate files:
  - `vscode-extension/assets/codex-orchestrator-plugin/plugin.json`
  - `vscode-extension/assets/codex-orchestrator-plugin/skills/codex-orchestrator/references/ai_routing_policy.json`

### vscode-extension-src

- Files: 13
- Known symbols: 1202
- Candidate files:
  - `vscode-extension/src/AgyQuotaClient.ts`
  - `vscode-extension/src/DashboardController.ts`
  - `vscode-extension/src/DashboardProvider.ts`
  - `vscode-extension/src/extension.ts`
  - `vscode-extension/src/installAntigravityPlugin.ts`
  - `vscode-extension/src/RunStore.ts`
  - `vscode-extension/src/storagePath.ts`
  - `vscode-extension/src/test/runTest.ts`
  - `vscode-extension/src/test/suite/index.ts`
  - `vscode-extension/src/test/suite/parser.test.ts`
  - `vscode-extension/src/TokenManager.ts`
  - `vscode-extension/src/types.ts`

## Serena Symbol Files

- `scripts/metrics/Get-QuotaSnapshot.mjs` - 67 symbols; top-level: catch() callback, CODEX_SESSIONS_DIR, getAntigravityQuota, getCodexQuota, main, PROBE_PATH, STATUS_PATH
- `vscode-extension/scripts/run-headless-tests.js` - 25 symbols; top-level: assert, extensionRoot, fs, normalizeWorkspacePathForStorage, path, readText, test, test("compiled runtime excludes stale path and workflow patterns") callback
- `vscode-extension/src/AgyQuotaClient.ts` - 98 symbols; top-level: AgyQuotaClient, API_BASE, CLIENT_ID, OAUTH_URL, QuotaResult, QuotaToken
- `vscode-extension/src/DashboardController.ts` - 218 symbols; top-level: DashboardController, PostMessage
- `vscode-extension/src/DashboardProvider.ts` - 22 symbols; top-level: DashboardProvider
- `vscode-extension/src/extension.ts` - 23 symbols; top-level: activate, deactivate, exportGlobalStoragePath, initializeGlobalProtocol
- `vscode-extension/src/installAntigravityPlugin.ts` - 18 symbols; top-level: installAntigravityPlugin, syncDir
- `vscode-extension/src/RunStore.ts` - 153 symbols; top-level: RunStore, RunStoreData, RunStoreReadOptions, StoredRun
- `vscode-extension/src/storagePath.ts` - 4 symbols; top-level: normalizeWorkspacePathForStorage, workspaceStoragePathForFolder
- `vscode-extension/src/test/runTest.ts` - 7 symbols; top-level: main
- `vscode-extension/src/test/suite/index.ts` - 12 symbols; top-level: run
- `vscode-extension/src/test/suite/parser.test.ts` - 72 symbols; top-level: suite('Parser and Store Test Suite') callback, waitFor
- `vscode-extension/src/TokenManager.ts` - 390 symbols; top-level: AGY_CREDITS_TIMEOUT_MS, ExecTextOptions, JsonlFileStat, MAX_SESSION_FILE_BYTES, MAX_SESSION_FILES, MAX_SESSION_LINES_PER_FILE, MAX_SESSION_SCAN_DEPTH, NodePtyModule
- `vscode-extension/src/types.ts` - 141 symbols; top-level: ArtifactRef, DashboardInboundMessage, DashboardOutboundMessage, DashboardState, ExtensionToWebviewMessage, GpuStatus, JsonObject, LocalComputeStatus
- `vscode-extension/src/WorkspacePaths.ts` - 44 symbols; top-level: DASHBOARD_STATE_RELATIVE_PATH, RUNS_RELATIVE_PATH, TOKEN_REPORT_RELATIVE_PATH, WorkspacePaths
- `vscode-extension/webview/main.js` - 273 symbols; top-level: buildTokenMetric, clamp, dashboardState, document.addEventListener("DOMContentLoaded") callback, emptyState, emptyTokenStatus, escapeAttr, escapeHtml

## PowerShell AST Files

- `scripts/dispatch/Export-PowerShellSymbols.ps1` - 8 functions; Resolve-RepoRoot:11, Write-Utf8Json:29, ConvertTo-RelativePath:44, Get-ParameterNames:60, Get-CommandFacts:71, Get-TopCommandNames:99, Get-Imports:116, Get-PSScriptAnalyzerDiagnostics:138
- `scripts/dispatch/Invoke-AgenticLoop.ps1` - 7 functions; Select-AgenticLoopModelBudget:32, Test-SearchReplacePatch:115, Test-SearchReplaceSyntax:162, Apply-SearchReplacePatch:197, Resolve-AgenticPatchFile:235, Restore-AgenticTransaction:262, Invoke-AgenticValidationCommand:270
- `scripts/dispatch/Invoke-AiderWorker.ps1` - 5 functions; Get-RepoRoot:38, Resolve-WorkspacePath:51, Quote-ProcessArgument:74, Invoke-ValidationCommand:84, Restore-Files:130
- `scripts/dispatch/Invoke-AiWorkWindow.ps1` - 0 functions; (no functions)
- `scripts/dispatch/Invoke-CodexDebate.ps1` - 2 functions; Write-Utf8:26, New-Slug:38
- `scripts/dispatch/Invoke-CodexJob.ps1` - 1 functions; Resolve-CodexExe:31
- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1` - 6 functions; Get-RepoRoot:68, Write-DecisionLog:81, Test-AiderWorkerAvailable:103, Split-FileListValue:121, Resolve-DelegatedFileInputs:149, Test-DestructiveIntent:174
- `scripts/dispatch/Invoke-LocalLLM.ps1` - 4 functions; Write-CsvRowWithRetry:50, ConvertTo-LocalMetricRow:81, Ensure-LocalMetricsSchema:109, Write-LocalLlmMetric:128
- `scripts/dispatch/Invoke-SerenaBackgroundJob.ps1` - 12 functions; Resolve-RepoRoot:15, Write-Utf8Text:26, Write-Utf8Json:40, Get-RelativePathCompat:50, Read-JsonFile:68, Test-PathGlob:77, Get-RepositoryFiles:93, Get-AreaName:139, Get-StaticSymbols:157, New-RoutingHints:200
- `scripts/dispatch/Invoke-vLLMJob.ps1` - 8 functions; Write-Utf8NoBom:39, Invoke-CurlJson:58, Write-CsvRowWithRetry:77, ConvertTo-LocalMetricRow:108, Ensure-LocalMetricsSchema:136, Write-LocalLlmMetric:155, Get-FirstModelId:204, Resolve-OpenAIBaseUrl:230
- `scripts/dispatch/New-ContextManifest.ps1` - 0 functions; (no functions)
- `scripts/dispatch/Select-AgenticDelegationMode.ps1` - 4 functions; Get-RepoRoot:32, Resolve-WorkspacePath:45, Get-ContextEstimateFromFiles:61, Get-Level:82
- `scripts/dispatch/Select-AgenticValidator.ps1` - 9 functions; Get-RepoRoot:20, Resolve-WorkspacePath:33, ConvertTo-SingleQuotedPowerShellLiteral:49, ConvertTo-RepoRelativePath:54, Test-PathPattern:73, Expand-ValidatorCommandTemplate:94, Select-RegistryValidator:105, Find-NearestPackageJson:145, Get-PackageScripts:181
- `scripts/dispatch/Select-LocalLLMModel.ps1` - 9 functions; Get-RepoRoot:26, Get-InstalledOllamaModels:40, Get-TaskScore:54, Normalize-Score:82, Get-GpuSnapshot:89, Get-DesiredContextTokens:113, Get-HardwareContextLimit:138, Get-RecommendedNumCtx:150, Get-RecommendedMaxTokens:171
- `scripts/dispatch/Test-SerenaCapability.ps1` - 4 functions; Resolve-RepoRoot:11, Write-Utf8Json:29, Get-LatestHealthLog:44, Parse-HealthLog:56
- `scripts/metrics/Count-GeminiInputTokens.ps1` - 4 functions; Get-RepoRoot:15, Resolve-InputText:28, Get-RestFailureMessage:63, Export-TokenRow:79
- `scripts/metrics/Count-OpenAIInputTokens.ps1` - 4 functions; Get-RepoRoot:20, Resolve-InputText:33, Get-RestFailureMessage:68, Export-TokenRow:84
- `scripts/metrics/Invoke-AntigravityUsageTool.ps1` - 0 functions; (no functions)
- `scripts/metrics/Measure-AntigravityTranscript.ps1` - 1 functions; Get-TextEstimate:30
- `scripts/metrics/Parse-CodexUsage.ps1` - 2 functions; Get-JsonNumber:33, Get-CreditEstimate:53
- `scripts/metrics/Parse-GeminiUsage.ps1` - 1 functions; Get-OptionalNumber:27
- `scripts/metrics/Track-Tokens.ps1` - 0 functions; (no functions)
- `scripts/metrics/Update-LocalLLMMetric.ps1` - 0 functions; (no functions)
- `scripts/scan/Compare-ScanState.ps1` - 3 functions; Get-StringHash:21, Get-CurrentSnapshot:29, Compare-Snapshots:66
- `scripts/scan/Detect-ActiveWork.ps1` - 0 functions; (no functions)
- `scripts/scan/Extract-Todos.ps1` - 1 functions; Get-FilesFast:111
- `scripts/schedule/Create-TimeBlocks.ps1` - 0 functions; (no functions)
- `scripts/schedule/Register-CodexScheduledJob.ps1` - 0 functions; (no functions)
- `scripts/schedule/Sync-Calendar.ps1` - 0 functions; (no functions)
- `scripts/util/Extract-CodeBlock.ps1` - 0 functions; (no functions)
- `scripts/util/read-agy-credential.ps1` - 0 functions; (no functions)

## Static Fallback Symbol Files

- `scripts/dispatch/Export-PowerShellSymbols.ps1` - 8 symbols; Resolve-RepoRoot:11, Write-Utf8Json:29, ConvertTo-RelativePath:44, Get-ParameterNames:60, Get-CommandFacts:71, Get-TopCommandNames:99, Get-Imports:116, Get-PSScriptAnalyzerDiagnostics:138
- `scripts/dispatch/Invoke-AgenticLoop.ps1` - 7 symbols; Select-AgenticLoopModelBudget:32, Test-SearchReplacePatch:115, Test-SearchReplaceSyntax:162, Apply-SearchReplacePatch:197, Resolve-AgenticPatchFile:235, Restore-AgenticTransaction:262, Invoke-AgenticValidationCommand:270
- `scripts/dispatch/Invoke-AiderWorker.ps1` - 5 symbols; Get-RepoRoot:38, Resolve-WorkspacePath:51, Quote-ProcessArgument:74, Invoke-ValidationCommand:84, Restore-Files:130
- `scripts/dispatch/Invoke-CodexDebate.ps1` - 2 symbols; Write-Utf8:26, New-Slug:38
- `scripts/dispatch/Invoke-CodexJob.ps1` - 1 symbols; Resolve-CodexExe:31
- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1` - 6 symbols; Get-RepoRoot:68, Write-DecisionLog:81, Test-AiderWorkerAvailable:103, Split-FileListValue:121, Resolve-DelegatedFileInputs:149, Test-DestructiveIntent:174
- `scripts/dispatch/Invoke-LocalLLM.ps1` - 4 symbols; Write-CsvRowWithRetry:50, ConvertTo-LocalMetricRow:81, Ensure-LocalMetricsSchema:109, Write-LocalLlmMetric:128
- `scripts/dispatch/Invoke-SerenaBackgroundJob.ps1` - 12 symbols; Resolve-RepoRoot:15, Write-Utf8Text:26, Write-Utf8Json:40, Get-RelativePathCompat:50, Read-JsonFile:68, Test-PathGlob:77, Get-RepositoryFiles:93, Get-AreaName:139, Get-StaticSymbols:157, New-RoutingHints:200
- `scripts/dispatch/Invoke-vLLMJob.ps1` - 8 symbols; Write-Utf8NoBom:39, Invoke-CurlJson:58, Write-CsvRowWithRetry:77, ConvertTo-LocalMetricRow:108, Ensure-LocalMetricsSchema:136, Write-LocalLlmMetric:155, Get-FirstModelId:204, Resolve-OpenAIBaseUrl:230
- `scripts/dispatch/Select-AgenticDelegationMode.ps1` - 4 symbols; Get-RepoRoot:32, Resolve-WorkspacePath:45, Get-ContextEstimateFromFiles:61, Get-Level:82
- `scripts/dispatch/Select-AgenticValidator.ps1` - 9 symbols; Get-RepoRoot:20, Resolve-WorkspacePath:33, ConvertTo-SingleQuotedPowerShellLiteral:49, ConvertTo-RepoRelativePath:54, Test-PathPattern:73, Expand-ValidatorCommandTemplate:94, Select-RegistryValidator:105, Find-NearestPackageJson:145, Get-PackageScripts:181
- `scripts/dispatch/Select-LocalLLMModel.ps1` - 9 symbols; Get-RepoRoot:26, Get-InstalledOllamaModels:40, Get-TaskScore:54, Normalize-Score:82, Get-GpuSnapshot:89, Get-DesiredContextTokens:113, Get-HardwareContextLimit:138, Get-RecommendedNumCtx:150, Get-RecommendedMaxTokens:171
- `scripts/dispatch/Test-SerenaCapability.ps1` - 4 symbols; Resolve-RepoRoot:11, Write-Utf8Json:29, Get-LatestHealthLog:44, Parse-HealthLog:56
- `scripts/metrics/Count-GeminiInputTokens.ps1` - 4 symbols; Get-RepoRoot:15, Resolve-InputText:28, Get-RestFailureMessage:63, Export-TokenRow:79
- `scripts/metrics/Count-OpenAIInputTokens.ps1` - 4 symbols; Get-RepoRoot:20, Resolve-InputText:33, Get-RestFailureMessage:68, Export-TokenRow:84
- `scripts/metrics/Measure-AntigravityTranscript.ps1` - 1 symbols; Get-TextEstimate:30
- `scripts/metrics/Parse-CodexUsage.ps1` - 2 symbols; Get-JsonNumber:33, Get-CreditEstimate:53
- `scripts/metrics/Parse-GeminiUsage.ps1` - 1 symbols; Get-OptionalNumber:27
- `scripts/scan/Compare-ScanState.ps1` - 3 symbols; Get-StringHash:21, Get-CurrentSnapshot:29, Compare-Snapshots:66
- `scripts/scan/Extract-Todos.ps1` - 1 symbols; Get-FilesFast:111
- `vscode-extension/src/AgyQuotaClient.ts` - 3 symbols; QuotaToken:10, QuotaResult:15, AgyQuotaClient:22
- `vscode-extension/src/DashboardController.ts` - 1 symbols; DashboardController:10
- `vscode-extension/src/DashboardProvider.ts` - 1 symbols; DashboardProvider:6
- `vscode-extension/src/extension.ts` - 4 symbols; initializeGlobalProtocol:10, exportGlobalStoragePath:38, activate:58, deactivate:84
- `vscode-extension/src/installAntigravityPlugin.ts` - 2 symbols; installAntigravityPlugin:6, syncDir:37
- `vscode-extension/src/RunStore.ts` - 3 symbols; RunStoreReadOptions:5, RunStoreData:9, RunStore:20
- `vscode-extension/src/storagePath.ts` - 2 symbols; normalizeWorkspacePathForStorage:4, workspaceStoragePathForFolder:9
- `vscode-extension/src/test/runTest.ts` - 1 symbols; main:4
- `vscode-extension/src/test/suite/index.ts` - 1 symbols; run:5
- `vscode-extension/src/test/suite/parser.test.ts` - 1 symbols; waitFor:204
- `vscode-extension/src/TokenManager.ts` - 1 symbols; TokenManager:75
- `vscode-extension/src/types.ts` - 18 symbols; JsonObject:1, ArtifactRef:3, QuotaSource:13, UsageConfidence:14, QuotaPoolStatus:16, RunUsage:29, GpuStatus:41, LocalComputeStatus:51, LocalLlmMetric:58, RunSummary:75
- `vscode-extension/src/WorkspacePaths.ts` - 1 symbols; WorkspacePaths:15

## Included File Inventory

- `AGENTS.md`
- `README.md`
- `scripts/dispatch/Export-PowerShellSymbols.ps1`
- `scripts/dispatch/Invoke-AgenticLoop.ps1`
- `scripts/dispatch/Invoke-AiderWorker.ps1`
- `scripts/dispatch/Invoke-AiWorkWindow.ps1`
- `scripts/dispatch/Invoke-CodexDebate.ps1`
- `scripts/dispatch/Invoke-CodexJob.ps1`
- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
- `scripts/dispatch/Invoke-LocalLLM.ps1`
- `scripts/dispatch/Invoke-SerenaBackgroundJob.ps1`
- `scripts/dispatch/Invoke-vLLMJob.ps1`
- `scripts/dispatch/New-ContextManifest.ps1`
- `scripts/dispatch/Select-AgenticDelegationMode.ps1`
- `scripts/dispatch/Select-AgenticValidator.ps1`
- `scripts/dispatch/Select-LocalLLMModel.ps1`
- `scripts/dispatch/Test-SerenaCapability.ps1`
- `scripts/metrics/Count-GeminiInputTokens.ps1`
- `scripts/metrics/Count-OpenAIInputTokens.ps1`
- `scripts/metrics/Invoke-AntigravityUsageTool.ps1`
- `scripts/metrics/Measure-AntigravityTranscript.ps1`
- `scripts/metrics/Parse-CodexUsage.ps1`
- `scripts/metrics/Parse-GeminiUsage.ps1`
- `scripts/metrics/Track-Tokens.ps1`
- `scripts/metrics/Update-LocalLLMMetric.ps1`
- `scripts/scan/Compare-ScanState.ps1`
- `scripts/scan/Detect-ActiveWork.ps1`
- `scripts/scan/Extract-Todos.ps1`
- `scripts/schedule/Create-TimeBlocks.ps1`
- `scripts/schedule/Register-CodexScheduledJob.ps1`
- `scripts/schedule/Sync-Calendar.ps1`
- `scripts/util/Extract-CodeBlock.ps1`
- `scripts/util/read-agy-credential.ps1`
- `vscode-extension/assets/codex-orchestrator-plugin/plugin.json`
- `vscode-extension/assets/codex-orchestrator-plugin/skills/codex-orchestrator/references/ai_routing_policy.json`
- `vscode-extension/src/AgyQuotaClient.ts`
- `vscode-extension/src/DashboardController.ts`
- `vscode-extension/src/DashboardProvider.ts`
- `vscode-extension/src/extension.ts`
- `vscode-extension/src/installAntigravityPlugin.ts`
- `vscode-extension/src/RunStore.ts`
- `vscode-extension/src/storagePath.ts`
- `vscode-extension/src/test/runTest.ts`
- `vscode-extension/src/test/suite/index.ts`
- `vscode-extension/src/test/suite/parser.test.ts`
- `vscode-extension/src/TokenManager.ts`
- `vscode-extension/src/types.ts`
- `vscode-extension/src/WorkspacePaths.ts`

## Limitations

- Serena project language is configured as TypeScript, so Serena cache currently covers TS/JS/MJS files only.
- PowerShell symbols are extracted by the PowerShell AST parser, not by Serena LSP.
- Routing hints are candidates, not authority; run `rg` and tests before changing files.

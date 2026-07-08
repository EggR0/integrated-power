The provided symbols list contains detailed information about the static symbols in various script and TypeScript files. This is useful for understanding the structure, functions, interfaces, classes, and types defined within each file. Here's a summary of the key points:

### Key Structures by File

#### PowerShell Scripts (`scripts/dispatch/` and `scripts/metrics/`)
- **Invoke-AgenticLoop.ps1**: Contains 7 functions including `Select-AgenticLoopModelBudget`, `Test-SearchReplacePatch`, `Test-SearchReplaceSyntax`, `Apply-SearchReplacePatch`, `Resolve-AgenticPatchFile`, `Restore-AgenticTransaction`, and `Invoke-AgenticValidationCommand`.
- **Invoke-AiderWorker.ps1**: Contains 5 functions: `Get-RepoRoot`, `Resolve-WorkspacePath`, `Quote-ProcessArgument`, `Invoke-ValidationCommand`, and `Restore-Files`.
- **Invoke-CodexDebate.ps1**: Contains 2 functions: `Write-Utf8` and `New-Slug`.
- **Invoke-CodexJob.ps1**: Contains a single function `Resolve-CodexExe`.
- **Invoke-DelegatedAgentTask.ps1**: Contains 6 functions including `Get-RepoRoot`, `Write-DecisionLog`, `Test-AiderWorkerAvailable`, `Split-FileListValue`, `Resolve-DelegatedFileInputs`, and `Test-DestructiveIntent`.
- **Invoke-LocalLLM.ps1**: Contains 4 functions: `Write-CsvRowWithRetry`, `ConvertTo-LocalMetricRow`, `Ensure-LocalMetricsSchema`, and `Write-LocalLlmMetric`.
- **Invoke-SerenaBackgroundJob.ps1**: Contains 12 functions, such as `Resolve-RepoRoot`, `Write-Utf8Text`, `Read-JsonFile`, and more.
- **Invoke-vLLMJob.ps1**: Contains 8 functions including `Write-Utf8NoBom`, `Invoke-CurlJson`, and others for handling local LLM jobs.
- **Select-AgenticDelegationMode.ps1**: Contains 4 functions: `Get-RepoRoot`, `Resolve-WorkspacePath`, `Get-ContextEstimateFromFiles`, and `Get-Level`.
- **Select-AgenticValidator.ps1**: Contains 9 functions, including path resolution, command template expansion, and more.
- **Select-LocalLLMModel.ps1**: Contains 9 functions related to model selection and GPU management.
- **Test-SerenaCapability.ps1**: Contains 4 functions for testing Serena capabilities.
- **Count-GeminiInputTokens.ps1** and **Count-OpenAIInputTokens.ps1**: Both contain 4 functions, primarily dealing with input token counting and exporting metrics.
- **Measure-AntigravityTranscript.ps1**: Contains a single function `Get-TextEstimate`.
- **Parse-CodexUsage.ps1**: Contains 2 functions: `Get-JsonNumber` and `Get-CreditEstimate`.
- **Parse-GeminiUsage.ps1**: Contains a single function `Get-OptionalNumber`.
- **Compare-ScanState.ps1**: Contains 3 functions for snapshot comparison.
- **Extract-Todos.ps1**: Contains a single function `Get-FilesFast`.

#### TypeScript Files (`vscode-extension/src/`)
- **AgyQuotaClient.ts**: Defines an interface and class: `QuotaToken`, `QuotaResult`, and `AgyQuotaClient`.
- **DashboardController.ts** and **DashboardProvider.ts**: Define classes `DashboardController` and `DashboardProvider`.
- **extension.ts**: Contains 4 functions related to extension lifecycle management.
- **installAntigravityPlugin.ts**: Defines two functions: `installAntigravityPlugin` and `syncDir`.
- **RunStore.ts**: Defines interfaces and a class: `RunStoreReadOptions`, `RunStoreData`, and `RunStore`.
- **storagePath.ts**: Contains two functions for path normalization.
- **test/runTest.ts** and **test/suite/index.ts**: Define test-related functions `main` and `run`.
- **TokenManager.ts**: Defines a class `TokenManager`.
- **types.ts**: Defines various interfaces, types, and enums including `JsonObject`, `ArtifactRef`, `QuotaSource`, `UsageConfidence`, and many more.
- **WorkspacePaths.ts**: Defines a class `WorkspacePaths`.

### Summary
This structured list helps in navigating through the codebase by showing which functions and classes are defined where. It is particularly useful for developers who need to understand or modify specific functionalities within these scripts and TypeScript files.

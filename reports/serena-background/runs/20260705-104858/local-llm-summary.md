The provided document contains detailed information about static symbols in various scripts and TypeScript files. Here is a structured overview of the symbols categorized by their respective file paths:

### PowerShell Scripts

**scripts/dispatch/Invoke-AgenticLoop.ps1**
- **Functions:**
  - `Select-AgenticLoopModelBudget` (Line 32)
  - `Test-SearchReplacePatch` (Line 115)
  - `Test-SearchReplaceSyntax` (Line 162)
  - `Apply-SearchReplacePatch` (Line 197)
  - `Resolve-AgenticPatchFile` (Line 235)
  - `Restore-AgenticTransaction` (Line 262)
  - `Invoke-AgenticValidationCommand` (Line 270)

**scripts/dispatch/Invoke-AiderWorker.ps1**
- **Functions:**
  - `Get-RepoRoot` (Line 38)
  - `Resolve-WorkspacePath` (Line 51)
  - `Quote-ProcessArgument` (Line 74)
  - `Invoke-ValidationCommand` (Line 84)
  - `Restore-Files` (Line 130)

**scripts/dispatch/Invoke-CodexDebate.ps1**
- **Functions:**
  - `Write-Utf8` (Line 26)
  - `New-Slug` (Line 38)

**scripts/dispatch/Invoke-CodexJob.ps1**
- **Functions:**
  - `Resolve-CodexExe` (Line 31)

**scripts/dispatch/Invoke-DelegatedAgentTask.ps1**
- **Functions:**
  - `Get-RepoRoot` (Line 68)
  - `Write-DecisionLog` (Line 81)
  - `Test-AiderWorkerAvailable` (Line 103)
  - `Split-FileListValue` (Line 121)
  - `Resolve-DelegatedFileInputs` (Line 149)
  - `Test-DestructiveIntent` (Line 174)

**scripts/dispatch/Invoke-LocalLLM.ps1**
- **Functions:**
  - `Write-CsvRowWithRetry` (Line 50)
  - `ConvertTo-LocalMetricRow` (Line 81)
  - `Ensure-LocalMetricsSchema` (Line 109)
  - `Write-LocalLlmMetric` (Line 128)

**scripts/dispatch/Invoke-SerenaBackgroundJob.ps1**
- **Functions:**
  - `Resolve-RepoRoot` (Line 15)
  - `Write-Utf8Text` (Line 26)
  - `Write-Utf8Json` (Line 40)
  - `Get-RelativePathCompat` (Line 50)
  - `Read-JsonFile` (Line 68)
  - `Test-PathGlob` (Line 77)
  - `Get-RepositoryFiles` (Line 93)
  - `Get-AreaName` (Line 139)
  - `Get-StaticSymbols` (Line 157)
  - `New-RoutingHints` (Line 200)
  - `New-RepoMapMarkdown` (Line 244)
  - `Append-LedgerRow` (Line 337)

**scripts/dispatch/Invoke-vLLMJob.ps1**
- **Functions:**
  - `Write-Utf8NoBom` (Line 39)
  - `Invoke-CurlJson` (Line 58)
  - `Write-CsvRowWithRetry` (Line 77)
  - `ConvertTo-LocalMetricRow` (Line 108)
  - `Ensure-LocalMetricsSchema` (Line 136)
  - `Write-LocalLlmMetric` (Line 155)
  - `Get-FirstModelId` (Line 204)
  - `Resolve-OpenAIBaseUrl` (Line 230)

**scripts/dispatch/Select-AgenticDelegationMode.ps1**
- **Functions:**
  - `Get-RepoRoot` (Line 32)
  - `Resolve-WorkspacePath` (Line 45)
  - `Get-ContextEstimateFromFiles` (Line 61)
  - `Get-Level` (Line 82)

**scripts/dispatch/Select-AgenticValidator.ps1**
- **Functions:**
  - `Get-RepoRoot` (Line 20)
  - `Resolve-WorkspacePath` (Line 33)
  - `ConvertTo-SingleQuotedPowerShellLiteral` (Line 49)
  - `ConvertTo-RepoRelativePath` (Line 54)
  - `Test-PathPattern` (Line 73)
  - `Expand-ValidatorCommandTemplate` (Line 94)
  - `Select-RegistryValidator` (Line 105)
  - `Find-NearestPackageJson` (Line 145)
  - `Get-PackageScripts` (Line 181)

**scripts/dispatch/Select-LocalLLMModel.ps1**
- **Functions:**
  - `Get-RepoRoot` (Line 26)
  - `Get-InstalledOllamaModels` (Line 40)
  - `Get-TaskScore` (Line 54)
  - `Normalize-Score` (Line 82)
  - `Get-GpuSnapshot` (Line 89)
  - `Get-DesiredContextTokens` (Line 113)
  - `Get-HardwareContextLimit` (Line 138)
  - `Get-RecommendedNumCtx` (Line 150)
  - `Get-RecommendedMaxTokens` (Line 171)

**scripts/dispatch/Test-SerenaCapability.ps1**
- **Functions:**
  - `Resolve-RepoRoot` (Line 11)
  - `Write-Utf8Json` (Line 29)
  - `Get-LatestHealthLog` (Line 44)
  - `Parse-HealthLog` (Line 56)

**scripts/metrics/Count-GeminiInputTokens.ps1**
- **Functions:**
  - `Get-RepoRoot` (Line 15)
  - `Resolve-InputText` (Line 28)
  - `Get-RestFailureMessage` (Line 63)
  - `Export-TokenRow` (Line 79)

**scripts/metrics/Count-OpenAIInputTokens.ps1**
- **Functions:**
  - `Get-RepoRoot` (Line 20)
  - `Resolve-InputText` (Line 33)
  - `Get-RestFailureMessage` (Line 68)
  - `Export-TokenRow` (Line 84)

**scripts/metrics/Measure-AntigravityTranscript.ps1**
- **Functions:**
  - `Get-TextEstimate` (Line 30)

**scripts/metrics/Parse-CodexUsage.ps1**
- **Functions:**
  - `Get-JsonNumber` (Line 33)
  - `Get-CreditEstimate` (Line 53)

**scripts/metrics/Parse-GeminiUsage.ps1**
- **Functions:**
  - `Get-OptionalNumber` (Line 27)

**scripts/scan/Compare-ScanState.ps1**
- **Functions:**
  - `Get-StringHash` (Line 21)
  - `Get-CurrentSnapshot` (Line 29)
  - `Compare-Snapshots` (Line 66)

**scripts/scan/Extract-Todos.ps1**
- **Functions:**
  - `Get-FilesFast` (Line 111)

### TypeScript Files

**vscode-extension/src/AgyQuotaClient.ts**
- **Symbols:**
  - Interface `QuotaToken` (Line 10)
  - Interface `QuotaResult` (Line 15)
  - Class `AgyQuotaClient` (Line 22)

**vscode-extension/src/DashboardController.ts**
- **Symbols:**
  - Class `DashboardController` (Line 10)

**vscode-extension/src/DashboardProvider.ts**
- **Symbols:**
  - Class `DashboardProvider` (Line 6)

**vscode-extension/src/extension.ts**
- **Functions:**
  - `initializeGlobalProtocol` (Line 10)
  - `exportGlobalStoragePath` (Line 38)
  - `activate` (Line 58)
  - `deactivate` (Line 84)

**vscode-extension/src/installAntigravityPlugin.ts**
- **Functions:**
  - `installAntigravityPlugin` (Line 6)
  - `syncDir` (Line 37)

**vscode-extension/src/RunStore.ts**
- **Symbols:**
  - Interface `RunStoreReadOptions` (Line 5)
  - Interface `RunStoreData` (Line 9)
  - Class `RunStore` (Line 20)

**vscode-extension/src/storagePath.ts**
- **Functions:**
  - `normalizeWorkspacePathForStorage` (Line 4)
  - `workspaceStoragePathForFolder` (Line 9)

**vscode-extension/src/test/runTest.ts**
- **Functions:**
  - `main` (Line 4)

**vscode-extension/src/test/suite/index.ts**
- **Functions:**
  - `run` (Line 5)

**vscode-extension/src/test/suite/parser.test.ts**
- **Functions:**
  - `waitFor` (Line 204)

**vscode-extension/src/TokenManager.ts**
- **Symbols:**
  - Class `TokenManager` (Line 75)

**vscode-extension/src/types.ts**
- **Symbols:**
  - Type `JsonObject` (Line 1)
  - Interface `ArtifactRef` (Line 3)
  - Type `QuotaSource` (Line 13)
  - Type `UsageConfidence` (Line 14)
  - Interface `QuotaPoolStatus` (Line 16)
  - Interface `RunUsage` (Line 29)
  - Interface `GpuStatus` (Line 41)
  - Interface `LocalComputeStatus` (Line 51)
  - Interface `LocalLlmMetric` (Line 58)
  - Interface `RunSummary` (Line 75)
  - Type `ParsedRun` (Line 98)
  - Type `ParsedArtifact` (Line 99)
  - Interface `TokenStatus` (Line 101)
  - Interface `DashboardState` (Line 143)
  - Type `WebviewToExtensionMessage` (Line 161)
  - Type `ExtensionToWebviewMessage` (Line 167)
  - Type `DashboardInboundMessage` (Line 172)
  - Type `DashboardOutboundMessage` (Line 173)

**vscode-extension/src/WorkspacePaths.ts**
- **Symbols:**
  - Class `WorkspacePaths` (Line 15)

### Summary

The document lists static symbols from a variety of PowerShell scripts and TypeScript files within different directories. Each symbol is categorized by its kind (function, class, interface, type) and includes the line number where it is defined. This information can be useful for navigating codebases, understanding module dependencies, or generating documentation automatically.

If you need detailed analysis or specific insights about any of these symbols, feel free to ask!

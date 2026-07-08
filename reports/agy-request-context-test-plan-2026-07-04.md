# AGY Task: REQUEST_CONTEXT Test Plan

This document outlines the test plan for a minimal [REQUEST_CONTEXT](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/reports/agy-request-context-test-plan-2026-07-04.md) implementation within the local agentic loop scripts: [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1) and [New-ContextManifest.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/New-ContextManifest.ps1).

---

## 1. Objectives & Requirements

The goal is to test a minimal workflow where the local LLM asks for additional context files instead of immediately producing a `SEARCH/REPLACE` block. The test plan must verify:

1. **Dual Output Capabilities**: The agentic loop handles both standard `SEARCH/REPLACE` blocks and `REQUEST_CONTEXT` directives from the local LLM.
2. **Context Request Processing**: If the LLM returns `REQUEST_CONTEXT`, the loop extracts the requested file path (identifying it from the `file:` prefix).
3. **Loop Continuation**: The loop dynamically appends the requested file to the context files (`$Files` array), rebuilds the context manifest via [New-ContextManifest.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/New-ContextManifest.ps1), increments the attempt counter, and retries the prompt.
4. **No-Patch Safeguard**: No code patch is applied to any file on a turn where the LLM requests context.
5. **Artifact Preservation**: When `-KeepArtifacts` is enabled, the run artifact folder preserves prompt/output logs for both the context-request turn (e.g., `attempt-1`) and the later patch turn (e.g., `attempt-2`).

---

## 2. Test Scenario Setup

To verify this behavior deterministically without depending on a live, non-deterministic LLM response, the test will use a temporary mock LLM script.

### Mock Script Behavior:
* **Attempt 1**: The loop runs with only the target file in the manifest. The Mock LLM detects that `moduleA.ps1` is missing from the context and outputs:
  ```text
  REQUEST_CONTEXT
  file: C:\Users\jsp0\Documents\Intergrated POWER\tests\mock_project\moduleA.ps1
  ```
* **Attempt 2**: The loop adds `moduleA.ps1` to the context and regenerates the manifest. The Mock LLM detects `moduleA.ps1` in the prompt and outputs a valid `SEARCH/REPLACE` patch:
  ```text
  SEARCH:
  Write-Host "Hello Mock Project"
  REPLACE:
  Write-Host "Hello Mock Project with moduleA context!"
  ```

---

## 3. Automated Test Execution Harness

Run the following PowerShell script from the repository root to set up the mock project environment, execute the test run, and verify the assertions.

```powershell
# 1. Define paths and workspace configuration
$Workspace    = "C:\Users\jsp0\Documents\Intergrated POWER"
$LoopScript   = Join-Path $Workspace "scripts\dispatch\Invoke-AgenticLoop.ps1"
$LLMScript    = Join-Path $Workspace "scripts\dispatch\Invoke-LocalLLM.ps1"
$BackupLLM    = Join-Path $Workspace "scripts\dispatch\Invoke-LocalLLM.ps1.bak"
$TestDir      = Join-Path $Workspace "tests\mock_project"
$TargetFile   = Join-Path $TestDir "main.ps1"
$ContextFile  = Join-Path $TestDir "moduleA.ps1"
$ArtifactDir  = Join-Path $Workspace "reports\agentic-loop-runs\test-request-context"

# 2. Setup mock environment files
Write-Host "Setting up test directory and mock files..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $TestDir | Out-Null
Set-Content -LiteralPath $TargetFile -Value 'Write-Host "Hello Mock Project"' -Encoding UTF8
Set-Content -LiteralPath $ContextFile -Value 'function Get-ModuleA { return "Module A Context" }' -Encoding UTF8

# Remove previous artifacts to ensure clean run
if (Test-Path -LiteralPath $ArtifactDir) {
    Remove-Item -Recurse -Force -LiteralPath $ArtifactDir
}

# 3. Backup actual LLM invoker and install Mock LLM invoker
Write-Host "Mocking Invoke-LocalLLM.ps1..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $LLMScript) {
    Copy-Item -LiteralPath $LLMScript -Destination $BackupLLM -Force
}

$MockLLMContent = @'
param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,
    [string]$OutputFile = "",
    [string]$Model = "",
    [int]$NumCtx = 0,
    [string]$TaskTitle = "",
    [string]$TaskType = "",
    [string]$TaskScale = "",
    [string]$SelectedBy = "",
    [string]$SelectionReason = "",
    [string]$SuccessRegex = "",
    [int]$MinOutputChars = 1
)

$prompt = Get-Content -LiteralPath $PromptFile -Raw -Encoding UTF8
$outputPath = $OutputFile

# Check if the prompt manifest contains moduleA.ps1
if ($prompt -like "*moduleA.ps1*") {
    # Attempt 2: Target context is loaded. Deliver the final SEARCH/REPLACE patch.
    $mockOutput = @"
SEARCH:
Write-Host "Hello Mock Project"
REPLACE:
Write-Host "Hello Mock Project with moduleA context!"
"@
} else {
    # Attempt 1: Context is missing. Request moduleA.ps1.
    $mockOutput = @"
REQUEST_CONTEXT
file: C:\Users\jsp0\Documents\Intergrated POWER\tests\mock_project\moduleA.ps1
"@
}

$mockOutput | Out-File -FilePath $outputPath -Encoding UTF8
'@

Set-Content -LiteralPath $LLMScript -Value $MockLLMContent -Encoding UTF8

# 4. Execute the Agentic Loop with KeepArtifacts
Write-Host "Running Invoke-AgenticLoop.ps1..." -ForegroundColor Cyan
try {
    & $LoopScript `
        -Prompt "Inject moduleA greeting" `
        -TargetFile $TargetFile `
        -Files @($TargetFile) `
        -KeepArtifacts `
        -ArtifactDir $ArtifactDir `
        -MaxRetries 3 `
        -Model "mock-model"
} catch {
    Write-Warning "Agentic Loop threw an error: $_"
}

# 5. Restore original Invoke-LocalLLM.ps1
Write-Host "Restoring original Invoke-LocalLLM.ps1..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $BackupLLM) {
    Move-Item -LiteralPath $BackupLLM -Destination $LLMScript -Force
}

# 6. Verify Test Assertions
Write-Host "`n=== Asserting Test Verification ===" -ForegroundColor Green

$pass = $true

# Check if patch was applied successfully after Attempt 2
$patchedContent = Get-Content -LiteralPath $TargetFile -Raw -Encoding UTF8
if ($patchedContent -match "Hello Mock Project with moduleA context") {
    Write-Host "[PASS] Patch successfully applied after context acquisition." -ForegroundColor Green
} else {
    Write-Host "[FAIL] Target file was not updated correctly." -ForegroundColor Red
    $pass = $false
}

# Check existence of attempt 1 artifacts
$attempt1Prompt = Join-Path $ArtifactDir "attempt-1-prompt.md"
$attempt1Output = Join-Path $ArtifactDir "attempt-1-output.md"
if ((Test-Path -LiteralPath $attempt1Prompt) -and (Test-Path -LiteralPath $attempt1Output)) {
    $out1 = Get-Content -LiteralPath $attempt1Output -Raw -Encoding UTF8
    if ($out1 -match "REQUEST_CONTEXT") {
        Write-Host "[PASS] Turn 1 Artifacts preserved. Correctly logged context request." -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Turn 1 output did not match REQUEST_CONTEXT." -ForegroundColor Red
        $pass = $false
    }
} else {
    Write-Host "[FAIL] Turn 1 artifacts are missing." -ForegroundColor Red
    $pass = $false
}

# Check existence of attempt 2 artifacts
$attempt2Prompt = Join-Path $ArtifactDir "attempt-2-prompt.md"
$attempt2Output = Join-Path $ArtifactDir "attempt-2-output.md"
if ((Test-Path -LiteralPath $attempt2Prompt) -and (Test-Path -LiteralPath $attempt2Output)) {
    $prompt2 = Get-Content -LiteralPath $attempt2Prompt -Raw -Encoding UTF8
    $out2 = Get-Content -LiteralPath $attempt2Output -Raw -Encoding UTF8
    
    if (($prompt2 -match "moduleA.ps1") -and ($out2 -match "SEARCH:\s*Write-Host")) {
        Write-Host "[PASS] Turn 2 Artifacts preserved. Context was updated in the prompt, and output contained the patch." -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Turn 2 prompt did not accumulate context, or output did not contain the search/replace patch." -ForegroundColor Red
        $pass = $false
    }
} else {
    Write-Host "[FAIL] Turn 2 artifacts are missing." -ForegroundColor Red
    $pass = $false
}

if ($pass) {
    Write-Host "`nE2E REQUEST_CONTEXT Test: PASSED" -ForegroundColor Green
} else {
    Write-Host "`nE2E REQUEST_CONTEXT Test: FAILED" -ForegroundColor Red
}
```

---

## 4. Expected Evidence & Verification Criteria

Upon running the automated test script above, the following evidence must be present in the workspace:

### 1. Terminal Console Log Output
The console log must demonstrate:
* Initial invocation of `Invoke-LocalLLM.ps1` for Attempt 1.
* A message indicating that a context request was detected: `Detected REQUEST_CONTEXT for file: C:\Users\jsp0\Documents\Intergrated POWER\tests\mock_project\moduleA.ps1`.
* Regeneration of the manifest including `moduleA.ps1`.
* Subsequent invocation of `Invoke-LocalLLM.ps1` for Attempt 2.
* Dynamic schema validation passing, and successful application of the patch.

### 2. File Verification
* Target file `tests/mock_project/main.ps1` contains:
  ```powershell
  Write-Host "Hello Mock Project with moduleA context!"
  ```

### 3. Preserved Artifacts directory (`reports/agentic-loop-runs/test-request-context/`)
* **`attempt-1-prompt.md`**: Contains the initial manifest (only `main.ps1`).
* **`attempt-1-output.md`**: Contains:
  ```text
  REQUEST_CONTEXT
  file: C:\Users\jsp0\Documents\Intergrated POWER\tests\mock_project\moduleA.ps1
  ```
* **`attempt-2-prompt.md`**: Contains the updated manifest listing *both* `main.ps1` and `moduleA.ps1`, alongside their code contents.
* **`attempt-2-output.md`**: Contains:
  ```text
  SEARCH:
  Write-Host "Hello Mock Project"
  REPLACE:
  Write-Host "Hello Mock Project with moduleA context!"
  ```

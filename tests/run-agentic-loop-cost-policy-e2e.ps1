$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}

$dispatchDir = Join-Path $repoRoot "scripts\dispatch"
$agenticLoop = Join-Path $dispatchDir "Invoke-AgenticLoop.ps1"
$localLlm = Join-Path $dispatchDir "Invoke-LocalLLM.ps1"
$backup = "$localLlm.policy-e2e.bak"
$testRoot = Join-Path $repoRoot "tests\agentic_loop_cost_policy_e2e"
$artifactRoot = Join-Path $testRoot "artifacts"
$callLog = Join-Path $testRoot "mock-calls.log"
$targetFile = Join-Path $testRoot "target.ps1"
$lockFile = Join-Path $env:TEMP "agentic-loop-script-mock.lock"
$script:MockScriptLockStream = $null

function Acquire-MockScriptLock {
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        try {
            $script:MockScriptLockStream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            return
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Timed out waiting for mock script lock: $lockFile"
}

New-Item -ItemType Directory -Force -Path $testRoot, $artifactRoot | Out-Null
Acquire-MockScriptLock
Copy-Item -LiteralPath $localLlm -Destination $backup -Force

try {
    @'
param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,
    [string]$OutputFile = "",
    [string]$Model = "mock-model",
    [string]$SystemPrompt = "",
    [switch]$ForceRestart,
    [int]$NumCtx = 4096,
    [string]$TaskTitle = "Mock",
    [string]$TaskScale = "Medium",
    [string]$TaskType = "general",
    [string]$SuccessRegex = "",
    [int]$MinOutputChars = 1,
    [string]$SelectedBy = "manual",
    [string]$SelectionReason = ""
)

$logPath = $env:AGENTIC_LOOP_POLICY_E2E_CALL_LOG
if (![string]::IsNullOrWhiteSpace($logPath)) {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $TaskTitle
}

if ($TaskTitle -eq "Breaker") {
    Set-Content -LiteralPath $OutputFile -Encoding UTF8 -Value "[NO_SAFE]"
    exit 0
}

@"
SEARCH:
`$value = "old"
REPLACE:
`$value = "new"
"@ | Set-Content -LiteralPath $OutputFile -Encoding UTF8
'@ | Set-Content -LiteralPath $localLlm -Encoding UTF8

    $env:AGENTIC_LOOP_POLICY_E2E_CALL_LOG = $callLog

    Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'
    Remove-Item -LiteralPath $callLog -ErrorAction SilentlyContinue

    & $agenticLoop `
        -Prompt "Change old to new." `
        -TargetFile $targetFile `
        -Files @($targetFile) `
        -MaxRetries 1 `
        -Model "mock-model" `
        -NumCtx 4096 `
        -KeepArtifacts `
        -ArtifactDir (Join-Path $artifactRoot "default")

    $defaultCalls = @(Get-Content -LiteralPath $callLog -Encoding UTF8)
    $defaultContent = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
    if ($defaultCalls.Count -ne 1) {
        throw "Expected default run to call local worker once, got $($defaultCalls.Count)."
    }
    if ($defaultCalls -contains "Breaker" -or $defaultCalls -contains "Judge") {
        throw "Default run should not invoke Judge or Breaker."
    }
    if ($defaultContent -notmatch 'new') {
        throw "Default run did not apply the mock patch."
    }

    Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'
    Remove-Item -LiteralPath $callLog -ErrorAction SilentlyContinue

    & $agenticLoop `
        -Prompt "Change old to new." `
        -TargetFile $targetFile `
        -Files @($targetFile) `
        -MaxRetries 1 `
        -Model "mock-model" `
        -NumCtx 4096 `
        -CandidateCount 2 `
        -EnableBreaker `
        -KeepArtifacts `
        -ArtifactDir (Join-Path $artifactRoot "deep")

    $deepCalls = @(Get-Content -LiteralPath $callLog -Encoding UTF8)
    if ($deepCalls.Count -ne 4) {
        throw "Expected deep run to call 2 candidates + Judge + Breaker, got $($deepCalls.Count)."
    }
    if (!($deepCalls -contains "Judge") -or !($deepCalls -contains "Breaker")) {
        throw "Deep run did not invoke both Judge and Breaker."
    }

    "PASS: agentic loop cost policy E2E"
}
finally {
    Copy-Item -LiteralPath $backup -Destination $localLlm -Force
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\AGENTIC_LOOP_POLICY_E2E_CALL_LOG -ErrorAction SilentlyContinue
    if ($null -ne $script:MockScriptLockStream) { $script:MockScriptLockStream.Dispose() }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

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
$backup = "$localLlm.validation-command-e2e.bak"
$testRoot = Join-Path $repoRoot "tests\agentic_loop_validation_command_e2e"
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

$logPath = $env:AGENTIC_LOOP_VALIDATION_COMMAND_E2E_CALL_LOG
if (![string]::IsNullOrWhiteSpace($logPath)) {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $TaskTitle
    $callCount = @(Get-Content -LiteralPath $logPath -Encoding UTF8).Count
}
else {
    $callCount = 1
}

$replacement = if ($callCount -eq 1) { "bad" } else { "good" }
@"
SEARCH:
`$value = "old"
REPLACE:
`$value = "$replacement"
"@ | Set-Content -LiteralPath $OutputFile -Encoding UTF8
'@ | Set-Content -LiteralPath $localLlm -Encoding UTF8

    $env:AGENTIC_LOOP_VALIDATION_COMMAND_E2E_CALL_LOG = $callLog

    Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'
    Remove-Item -LiteralPath $callLog -ErrorAction SilentlyContinue

    $escapedTarget = $targetFile.Replace("'", "''")
    $validationCommand = "if ((Get-Content -LiteralPath '$escapedTarget' -Raw) -match 'good') { exit 0 } else { Write-Error 'validation saw non-good content'; exit 1 }"

    & $agenticLoop `
        -Prompt "Change old to good." `
        -TargetFile $targetFile `
        -Files @($targetFile) `
        -MaxRetries 2 `
        -Model "mock-model" `
        -NumCtx 4096 `
        -ValidatorProfile "syntax_and_command" `
        -ValidationCommand $validationCommand `
        -ValidationTimeoutSeconds 10 `
        -KeepArtifacts `
        -ArtifactDir (Join-Path $artifactRoot "retry")

    $calls = @(Get-Content -LiteralPath $callLog -Encoding UTF8)
    if ($calls.Count -ne 2) {
        throw "Expected validation failure to trigger exactly one retry, got $($calls.Count) worker calls."
    }

    $finalContent = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
    if ($finalContent -notmatch 'good') {
        throw "Expected final file to contain the validated replacement."
    }
    if ($finalContent -match 'bad') {
        throw "Failed validation attempt was not restored before retry."
    }

    $attempt2Prompt = Join-Path $artifactRoot "retry\attempt-2-prompt.md"
    $attempt2Text = Get-Content -LiteralPath $attempt2Prompt -Raw -Encoding UTF8
    if ($attempt2Text -notmatch 'failed validation command' -or $attempt2Text -notmatch 'restored before retry') {
        throw "Retry prompt did not include validation failure feedback."
    }

    "PASS: agentic loop validation command E2E"
}
finally {
    Copy-Item -LiteralPath $backup -Destination $localLlm -Force
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\AGENTIC_LOOP_VALIDATION_COMMAND_E2E_CALL_LOG -ErrorAction SilentlyContinue
    if ($null -ne $script:MockScriptLockStream) { $script:MockScriptLockStream.Dispose() }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

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
$backup = "$localLlm.multifile-transaction-e2e.bak"
$testRoot = Join-Path $repoRoot "tests\agentic_loop_multifile_transaction_e2e"
$artifactRoot = Join-Path $testRoot "artifacts"
$callLog = Join-Path $testRoot "mock-calls.log"
$fileA = Join-Path $testRoot "fileA.ps1"
$fileB = Join-Path $testRoot "fileB.ps1"
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

$logPath = $env:AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_CALL_LOG
if (![string]::IsNullOrWhiteSpace($logPath)) {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $TaskTitle
    $callCount = @(Get-Content -LiteralPath $logPath -Encoding UTF8).Count
}
else {
    $callCount = 1
}

$fileA = $env:AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_FILE_A
$fileB = $env:AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_FILE_B
$suffix = if ($callCount -eq 1) { "bad" } else { "good" }

@"
FILE: $fileA
SEARCH:
`$valueA = "old"
REPLACE:
`$valueA = "$suffix"

FILE: $fileB
SEARCH:
`$valueB = "old"
REPLACE:
`$valueB = "$suffix"
"@ | Set-Content -LiteralPath $OutputFile -Encoding UTF8
'@ | Set-Content -LiteralPath $localLlm -Encoding UTF8

    $env:AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_CALL_LOG = $callLog
    $env:AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_FILE_A = $fileA
    $env:AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_FILE_B = $fileB

    Set-Content -LiteralPath $fileA -Encoding UTF8 -Value '$valueA = "old"'
    Set-Content -LiteralPath $fileB -Encoding UTF8 -Value '$valueB = "old"'
    Remove-Item -LiteralPath $callLog -ErrorAction SilentlyContinue

    $escapedA = $fileA.Replace("'", "''")
    $escapedB = $fileB.Replace("'", "''")
    $validationCommand = @"
if ((Get-Content -LiteralPath '$escapedA' -Raw) -match 'good' -and (Get-Content -LiteralPath '$escapedB' -Raw) -match 'good') {
    exit 0
}
Write-Error 'validation saw incomplete transaction'
exit 1
"@

    & $agenticLoop `
        -Prompt "Change both files from old to good." `
        -TargetFile $fileA `
        -Files @($fileA, $fileB) `
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

    $finalA = Get-Content -LiteralPath $fileA -Raw -Encoding UTF8
    $finalB = Get-Content -LiteralPath $fileB -Raw -Encoding UTF8
    if ($finalA -notmatch 'good' -or $finalB -notmatch 'good') {
        throw "Expected both files to contain the validated replacement."
    }
    if ($finalA -match 'bad' -or $finalB -match 'bad') {
        throw "Failed transaction attempt leaked bad content into final files."
    }

    $attempt2Prompt = Join-Path $artifactRoot "retry\attempt-2-prompt.md"
    $attempt2Text = Get-Content -LiteralPath $attempt2Prompt -Raw -Encoding UTF8
    if ($attempt2Text -notmatch 'patch transaction' -or $attempt2Text -notmatch 'All changed files were restored') {
        throw "Retry prompt did not include transaction rollback feedback."
    }

    "PASS: agentic loop multi-file transaction E2E"
}
finally {
    Copy-Item -LiteralPath $backup -Destination $localLlm -Force
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_CALL_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:\AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_FILE_A -ErrorAction SilentlyContinue
    Remove-Item Env:\AGENTIC_LOOP_MULTIFILE_TRANSACTION_E2E_FILE_B -ErrorAction SilentlyContinue
    if ($null -ne $script:MockScriptLockStream) { $script:MockScriptLockStream.Dispose() }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

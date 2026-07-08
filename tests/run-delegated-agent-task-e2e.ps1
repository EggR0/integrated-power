$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}

$dispatchDir = Join-Path $repoRoot "scripts\dispatch"
$wrapper = Join-Path $dispatchDir "Invoke-DelegatedAgentTask.ps1"
$agenticLoop = Join-Path $dispatchDir "Invoke-AgenticLoop.ps1"
$backup = "$agenticLoop.delegated-e2e.bak"
$testRoot = Join-Path $repoRoot "tests\delegated_agent_task_e2e"
$targetFile = Join-Path $testRoot "target.ps1"
$callLog = Join-Path $testRoot "agentic-loop-calls.csv"
$decisionLog = Join-Path $testRoot "delegation-decisions.csv"
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

New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'
Acquire-MockScriptLock
Copy-Item -LiteralPath $agenticLoop -Destination $backup -Force

try {
    @'
param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,
    [Parameter(Mandatory = $true)]
    [string]$TargetFile,
    [string[]]$Files,
    [int]$MaxRetries = 3,
    [string]$Model = "",
    [switch]$SandboxMode,
    [hashtable]$LineRanges = @{},
    [string]$StateMachine,
    [int]$NumCtx = 0,
    [string]$TaskType = "coding",
    [string]$TaskScale = "Large",
    [string]$TaskTitle = "",
    [switch]$NoHardwareSnapshot,
    [switch]$KeepArtifacts,
    [string]$ArtifactDir = "",
    [int]$CandidateCount = 1,
    [switch]$EnableBreaker,
    [string]$ValidatorProfile = "syntax",
    [string]$ValidationCommand = "",
    [int]$ValidationTimeoutSeconds = 120
)

$row = [pscustomobject]@{
    Prompt = $Prompt
    TargetFile = $TargetFile
    TaskScale = $TaskScale
    CandidateCount = $CandidateCount
    EnableBreaker = $EnableBreaker.IsPresent
    KeepArtifacts = $KeepArtifacts.IsPresent
    ValidatorProfile = $ValidatorProfile
    ValidationCommand = $ValidationCommand
}
$logPath = $env:DELEGATED_AGENT_TASK_E2E_CALL_LOG
if ([string]::IsNullOrWhiteSpace($logPath)) {
    throw "DELEGATED_AGENT_TASK_E2E_CALL_LOG is not set."
}
if (Test-Path -LiteralPath $logPath) {
    $row | Export-Csv -NoTypeInformation -Encoding UTF8 -Append -LiteralPath $logPath
}
else {
    $row | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $logPath
}
'@ | Set-Content -LiteralPath $agenticLoop -Encoding UTF8

    Remove-Item -LiteralPath $callLog, $decisionLog -ErrorAction SilentlyContinue
    $env:DELEGATED_AGENT_TASK_E2E_CALL_LOG = $callLog

    & $wrapper `
        -Prompt "Small patch" `
        -TargetFile $targetFile `
        -Files @($targetFile) `
        -EstimatedChangedLines 20 `
        -PreferCloudTokenConservation `
        -Model "mock-model" `
        -NumCtx 4096 `
        -DecisionLogFile $decisionLog

    & $wrapper `
        -Prompt "High risk large patch" `
        -TargetFile $targetFile `
        -Files @($targetFile) `
        -EstimatedChangedLines 180 `
        -HighRisk `
        -PreferCloudTokenConservation `
        -Model "mock-model" `
        -NumCtx 4096 `
        -DecisionLogFile $decisionLog

    $calls = @(Import-Csv -LiteralPath $callLog)
    if ($calls.Count -ne 2) {
        throw "Expected 2 AgenticLoop calls, got $($calls.Count)."
    }
    if ([int]$calls[0].CandidateCount -ne 1 -or $calls[0].EnableBreaker -ne "False") {
        throw "Small delegated task should execute AgenticLoop with CandidateCount=1 and breaker disabled."
    }
    if ([int]$calls[1].CandidateCount -ne 2 -or $calls[1].EnableBreaker -ne "True") {
        throw "High-risk delegated task should execute AgenticLoop with CandidateCount=2 and breaker enabled."
    }

    $decisions = @(Import-Csv -LiteralPath $decisionLog)
    if ($decisions.Count -ne 2) {
        throw "Expected 2 delegation decision rows, got $($decisions.Count)."
    }
    if ($decisions[0].RequestedMode -ne "LocalDirect" -or $decisions[0].ExecutionMode -ne "AgenticLoop") {
        throw "Small file-write task should be recommended as LocalDirect but adapted to AgenticLoop."
    }
    if ($decisions[0].LocalTokenCost -ne "None") {
        throw "LocalTokenCost must be recorded as None."
    }
    if ($decisions[1].RequestedMode -ne "AgenticLoop" -or $decisions[1].EnableBreaker -ne "True") {
        throw "High-risk task should be requested as AgenticLoop with breaker enabled."
    }

    "PASS: delegated agent task E2E"
}
finally {
    Copy-Item -LiteralPath $backup -Destination $agenticLoop -Force
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\DELEGATED_AGENT_TASK_E2E_CALL_LOG -ErrorAction SilentlyContinue
    if ($null -ne $script:MockScriptLockStream) { $script:MockScriptLockStream.Dispose() }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

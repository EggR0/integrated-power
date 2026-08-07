param(
    [ValidateSet("coding", "review", "planning", "design", "test_generation", "docs", "debugging")]
    [string]$TaskKind = "coding",

    [string[]]$Files = @(),

    [int]$EstimatedChangedLines = 0,

    [int]$EstimatedContextTokens = 0,

    [int]$MaxLocalContextTokens = 32768,

    [int]$TimeBudgetMinutes = 30,

    [int]$CloudQuotaRemainingPercent = -1,

    [switch]$RequiresFileWrite,

    [switch]$RequiresIndependentAudit,

    [switch]$HighRisk,

    [switch]$PreferCloudTokenConservation,

    [switch]$AsJson
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Get-RepoRoot {
    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            return ($gitRoot | Select-Object -First 1).Trim()
        }
    }
    catch {
    }

    return (Get-Location).Path
}

function Resolve-WorkspacePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }

    return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RepoRoot, $Path))
}

function Get-ContextEstimateFromFiles {
    param(
        [string[]]$InputFiles,
        [string]$RepoRoot
    )

    $totalBytes = 0
    foreach ($file in $InputFiles) {
        if ([string]::IsNullOrWhiteSpace($file)) { continue }
        $resolved = Resolve-WorkspacePath -Path $file -RepoRoot $RepoRoot
        if (Test-Path -LiteralPath $resolved -PathType Leaf) {
            $totalBytes += (Get-Item -LiteralPath $resolved).Length
        }
    }

    if ($totalBytes -le 0) { return 0 }

    # Rough operational estimate: UTF-8 source text is usually 3-5 chars/token.
    return [int][math]::Ceiling($totalBytes / 4)
}

function Get-Level {
    param(
        [int]$LowThreshold,
        [int]$HighThreshold,
        [int]$Value
    )

    if ($Value -ge $HighThreshold) { return "High" }
    if ($Value -ge $LowThreshold) { return "Medium" }
    return "Low"
}

$repoRoot = Get-RepoRoot
$Files = @($Files | ForEach-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return }
    [string]$_ -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
})
$fileCount = @($Files | Where-Object { ![string]::IsNullOrWhiteSpace($_) }).Count
if ($EstimatedContextTokens -le 0 -and $fileCount -gt 0) {
    $EstimatedContextTokens = Get-ContextEstimateFromFiles -InputFiles $Files -RepoRoot $repoRoot
}

$localResourceRisk = "Low"
if ($EstimatedContextTokens -gt $MaxLocalContextTokens -or $fileCount -gt 8) {
    $localResourceRisk = "High"
}
elseif ($EstimatedContextTokens -gt [math]::Floor($MaxLocalContextTokens * 0.7) -or $EstimatedContextTokens -gt 16384 -or $fileCount -gt 3) {
    $localResourceRisk = "Medium"
}

$modelDownshiftRisk = "Low"
if ($EstimatedContextTokens -gt $MaxLocalContextTokens) {
    $modelDownshiftRisk = "High"
}
elseif ($EstimatedContextTokens -gt [math]::Floor($MaxLocalContextTokens * 0.8)) {
    $modelDownshiftRisk = "Medium"
}

$cloudTokenConservation = if ($PreferCloudTokenConservation) { "High" } elseif ($TaskKind -in @("coding", "test_generation", "docs")) { "Medium" } else { "Low" }
$changeSize = Get-Level -LowThreshold 40 -HighThreshold 140 -Value $EstimatedChangedLines

$mode = "CodexDirect"
$reason = "Small or precise task where orchestration overhead is likely higher than direct editing."
$agenticCandidateCount = 1
$enableBreaker = $false
$recommendedWorkerBackend = "AgenticLoop"
$workerBackendReason = "Default safe editor backend."
$taskScale = if ($EstimatedContextTokens -gt 16384 -or $EstimatedChangedLines -gt 140) { "Large" } elseif ($EstimatedChangedLines -gt 40) { "Medium" } else { "Small" }

if (!$RequiresFileWrite -and $TaskKind -in @("planning", "design", "docs", "test_generation")) {
    $mode = "LocalDirect"
    $reason = "Generate an artifact or candidate content locally; Codex/Gemini only reviews or applies the result."
}
elseif ($CloudQuotaRemainingPercent -ge 0 -and $CloudQuotaRemainingPercent -lt 20) {
    # Active Downshift logic based on Quota
    $mode = if ($RequiresFileWrite) { "AgenticLoop" } else { "LocalDirect" }
    $reason = "Cloud token quota is dangerously low ($CloudQuotaRemainingPercent%). Downshifting to local execution to conserve remaining quota."
    $recommendedWorkerBackend = "Aider"
}
elseif ($RequiresFileWrite -and ($HighRisk -or $changeSize -ne "Low" -or $fileCount -gt 1)) {
    $mode = "AgenticLoop"
    $reason = "File writes need mechanical schema/apply/syntax gates and retry artifacts."
    if ($HighRisk) {
        $enableBreaker = $true
    }
    if ($changeSize -eq "High" -and $localResourceRisk -ne "High") {
        $agenticCandidateCount = 2
    }
}
elseif ($PreferCloudTokenConservation -and $TaskKind -eq "coding" -and !$HighRisk) {
    $mode = "LocalDirect"
    $reason = "Conserve Codex/Gemini output by asking local LLM for a candidate patch, then let the harness or Codex verify."
}

if ($localResourceRisk -eq "High" -and $mode -eq "AgenticLoop") {
    $agenticCandidateCount = 1
    $reason = "$reason Local resource risk is high, so extra candidates are disabled."
}

if ($RequiresFileWrite -and $TaskKind -eq "coding") {
    if ($fileCount -gt 1 -or $changeSize -ne "Low" -or $HighRisk) {
        $recommendedWorkerBackend = "Aider"
        $workerBackendReason = "Use Aider for repo-aware coding edits, multi-file changes, or non-trivial implementation; wrapper validation and rollback remain active."
    }
    elseif ($PreferCloudTokenConservation) {
        $recommendedWorkerBackend = "Aider"
        $workerBackendReason = "Use Aider for low-risk coding edits when the goal is to conserve Codex/Gemini output while relying on a mature coding-agent backend."
    }
}

$invocationHint = switch ($mode) {
    "CodexDirect" { "Use Codex for the surgical edit; no worker delegation." }
    "LocalDirect" { "Use Invoke-LocalLLM.ps1 for candidate generation or report creation; do not grant file write authority." }
    "AgenticLoop" { "Use Invoke-AgenticLoop.ps1 with CandidateCount=$agenticCandidateCount and EnableBreaker=$enableBreaker." }
}

$result = [pscustomobject]@{
    Mode = $mode
    Reason = $reason
    InvocationHint = $invocationHint
    TaskKind = $TaskKind
    TaskScale = $taskScale
    FileCount = $fileCount
    EstimatedChangedLines = $EstimatedChangedLines
    EstimatedContextTokens = $EstimatedContextTokens
    CostModel = [pscustomobject]@{
        CloudTokenConservation = $cloudTokenConservation
        LocalTokenCost = "None"
        LocalCosts = @("elapsed_time", "electricity", "gpu_vram_occupancy", "context_overflow_model_downshift")
        LocalResourceRisk = $localResourceRisk
        ModelDownshiftRisk = $modelDownshiftRisk
        CloudQuotaRemainingPercent = $CloudQuotaRemainingPercent
    }
    AgenticLoopOptions = [pscustomobject]@{
        CandidateCount = $agenticCandidateCount
        EnableBreaker = $enableBreaker
        MaxLocalContextTokens = $MaxLocalContextTokens
    }
    WorkerBackend = [pscustomobject]@{
        Recommended = $recommendedWorkerBackend
        Reason = $workerBackendReason
    }
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 8
}
else {
    $result
}

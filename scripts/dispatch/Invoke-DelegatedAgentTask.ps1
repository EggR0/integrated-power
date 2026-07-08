param(
    [string]$Prompt = "",

    [string]$PromptFile = "",

    [string]$TargetFile = "",

    [string[]]$Files = @(),

    [string]$FilesListFile = "",

    [ValidateSet("coding", "review", "planning", "design", "test_generation", "docs", "debugging")]
    [string]$TaskKind = "coding",

    [int]$EstimatedChangedLines = 0,

    [switch]$RequiresFileWrite,

    [switch]$RequiresIndependentAudit,

    [switch]$HighRisk,

    [switch]$PreferCloudTokenConservation,

    [string]$Model = "",

    [int]$NumCtx = 0,

    [int]$MaxRetries = 3,

    [switch]$SandboxMode,

    [switch]$KeepArtifacts,

    [string]$ArtifactDir = "",

    [switch]$NoHardwareSnapshot,

    [ValidateSet("auto", "syntax", "syntax_and_command", "command_only", "none")]
    [string]$ValidatorProfile = "syntax",

    [string]$ValidationCommand = "",

    [int]$ValidationTimeoutSeconds = 120,

    [ValidateSet("Auto", "AgenticLoop", "Aider")]
    [string]$WorkerBackend = "AgenticLoop",

    [string]$AiderModel = "",

    [string]$AiderExecutable = "",

    [string]$AiderEditFormat = "",

    [switch]$AllowDestructive,

    [switch]$AllowAgenticLoopFallback,

    [switch]$DryRun,

    [string]$DecisionLogFile = ""
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

function Write-DecisionLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [pscustomobject]$Row
    )

    $dir = Split-Path -Parent $Path
    if (![string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    if (Test-Path -LiteralPath $Path) {
        $Row | Export-Csv -NoTypeInformation -Encoding UTF8 -Append -LiteralPath $Path
    }
    else {
        $Row | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $Path
    }
}

function Test-AiderWorkerAvailable {
    param([string]$AiderExecutable = "")

    if (![string]::IsNullOrWhiteSpace($AiderExecutable)) {
        return (Test-Path -LiteralPath $AiderExecutable -PathType Leaf)
    }

    if (Get-Command aider -ErrorAction SilentlyContinue) {
        return $true
    }

    if (Get-Command uvx -ErrorAction SilentlyContinue) {
        return $true
    }

    return $false
}

function Split-FileListValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @()
    }

    $normalized = $Value -replace "`r`n", "`n"
    $parts = @()
    foreach ($line in ($normalized -split "`n")) {
        foreach ($segment in ($line -split ';')) {
            $trimmed = $segment.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) {
                continue
            }

            if (!(Test-Path -LiteralPath $trimmed) -and $trimmed -match ',') {
                $parts += @($trimmed -split ',' | ForEach-Object { $_.Trim() } | Where-Object { ![string]::IsNullOrWhiteSpace($_) })
            }
            else {
                $parts += $trimmed
            }
        }
    }

    return @($parts)
}

function Resolve-DelegatedFileInputs {
    param(
        [string[]]$InlineFiles,
        [string]$ListFile
    )

    $resolved = @()
    foreach ($file in @($InlineFiles)) {
        $resolved += Split-FileListValue -Value ([string]$file)
    }

    if (![string]::IsNullOrWhiteSpace($ListFile)) {
        $listPath = $ListFile
        if (![System.IO.Path]::IsPathRooted($listPath)) {
            $listPath = Join-Path (Get-Location).Path $listPath
        }
        if (!(Test-Path -LiteralPath $listPath -PathType Leaf)) {
            throw "FilesListFile not found: $listPath"
        }
        $resolved += Split-FileListValue -Value ([System.IO.File]::ReadAllText($listPath, [System.Text.Encoding]::UTF8))
    }

    return @($resolved | Where-Object { ![string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function Test-DestructiveIntent {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    $lower = $Text.ToLowerInvariant()
    $markers = @(
        "delete ",
        "delete`r",
        "delete`n",
        "remove ",
        "remove`r",
        "remove`n",
        "erase ",
        "rename ",
        "move ",
        "rm ",
        "del ",
        "unlink "
    )

    foreach ($marker in $markers) {
        if ($lower.Contains($marker)) {
            return $true
        }
    }

    return $false
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Get-RepoRoot

if (![string]::IsNullOrWhiteSpace($PromptFile)) {
    $resolvedPromptFile = $PromptFile
    if (![System.IO.Path]::IsPathRooted($resolvedPromptFile)) {
        $resolvedPromptFile = Join-Path $repoRoot $resolvedPromptFile
    }
    if (!(Test-Path -LiteralPath $resolvedPromptFile -PathType Leaf)) {
        throw "PromptFile not found: $resolvedPromptFile"
    }
    $Prompt = [System.IO.File]::ReadAllText($resolvedPromptFile, [System.Text.Encoding]::UTF8)
}
if ([string]::IsNullOrWhiteSpace($Prompt)) {
    throw "Prompt or PromptFile is required."
}

$Files = Resolve-DelegatedFileInputs -InlineFiles $Files -ListFile $FilesListFile
if (![string]::IsNullOrWhiteSpace($TargetFile) -and @($Files).Count -eq 0) {
    $Files = @($TargetFile)
}

$requiresWrite = $RequiresFileWrite.IsPresent -or ![string]::IsNullOrWhiteSpace($TargetFile)
$destructiveIntent = $requiresWrite -and (Test-DestructiveIntent -Text $Prompt)

$selectorArgs = @{
    TaskKind                      = $TaskKind
    Files                         = $Files
    EstimatedChangedLines         = $EstimatedChangedLines
    RequiresFileWrite             = $requiresWrite
    RequiresIndependentAudit      = $RequiresIndependentAudit.IsPresent
    HighRisk                      = $HighRisk.IsPresent
    PreferCloudTokenConservation  = $PreferCloudTokenConservation.IsPresent
    AsJson                        = $true
}

$selector = Join-Path $scriptDir "Select-AgenticDelegationMode.ps1"
$decision = & $selector @selectorArgs | ConvertFrom-Json

$validatorSelection = $null
if ($ValidatorProfile -eq "auto") {
    $validatorSelector = Join-Path $scriptDir "Select-AgenticValidator.ps1"
    $validatorSelection = & $validatorSelector -TargetFile $TargetFile -Files $Files -TaskKind $TaskKind -Strict:($HighRisk.IsPresent) -AsJson | ConvertFrom-Json
    $ValidatorProfile = [string]$validatorSelection.ValidatorProfile
    if ([string]::IsNullOrWhiteSpace($ValidationCommand)) {
        $ValidationCommand = [string]$validatorSelection.ValidationCommand
    }
    if ($ValidationTimeoutSeconds -le 0 -or $ValidationTimeoutSeconds -eq 120) {
        $ValidationTimeoutSeconds = [int]$validatorSelection.ValidationTimeoutSeconds
    }
}

$executionMode = [string]$decision.Mode
$executionNote = ""
$requestedWorkerBackend = $WorkerBackend
$aiderAvailable = Test-AiderWorkerAvailable -AiderExecutable $AiderExecutable
$autoAiderFallbackBlocked = $false
if ($WorkerBackend -eq "Auto") {
    $WorkerBackend = if ($decision.WorkerBackend -and $decision.WorkerBackend.Recommended) {
        [string]$decision.WorkerBackend.Recommended
    }
    else {
        "AgenticLoop"
    }
    if ($WorkerBackend -eq "Aider" -and !$aiderAvailable) {
        $unsafeAgenticLoopFallback = (
            $requiresWrite -and (
                $HighRisk.IsPresent -or
                [int]$decision.FileCount -gt 1 -or
                [string]$decision.TaskScale -ne "Small" -or
                [string]$decision.CostModel.LocalResourceRisk -ne "Low"
            )
        )

        if ($unsafeAgenticLoopFallback -and !$AllowAgenticLoopFallback.IsPresent) {
            $WorkerBackend = "AgenticLoop"
            $executionMode = "ManualReviewRequired"
            $autoAiderFallbackBlocked = $true
            $executionNote = "Manual review required: Auto recommended Aider, but Aider/uvx was unavailable and AgenticLoop fallback is unsafe for this task. Install/enable Aider, narrow the task, or re-run with -AllowAgenticLoopFallback."
        }
        else {
            $WorkerBackend = "AgenticLoop"
            $executionNote = "Auto recommended Aider, but Aider/uvx was unavailable; falling back to AgenticLoop."
        }
    }
}

if (!$autoAiderFallbackBlocked -and $requiresWrite -and $WorkerBackend -eq "Aider") {
    $executionNote = "Using Aider worker backend for file-writing task; Aider edits are guarded by wrapper backup and validation."
    if ($requestedWorkerBackend -eq "Auto" -and $decision.WorkerBackend -and $decision.WorkerBackend.Reason) {
        $executionNote = "$executionNote Auto reason: $($decision.WorkerBackend.Reason)"
    }
    $executionMode = "AiderWorker"
}
elseif (!$autoAiderFallbackBlocked -and $requiresWrite -and $executionMode -ne "AgenticLoop") {
    $executionNote = "Adapted $executionMode to AgenticLoop because file writes must pass schema/apply/syntax gates."
    $executionMode = "AgenticLoop"
}

if ($destructiveIntent -and !$AllowDestructive.IsPresent) {
    $executionNote = "Manual review required: destructive file operation intent was detected. Re-run with -AllowDestructive after narrowing files and validation, or handle the deletion directly in the IDE."
    $executionMode = "ManualReviewRequired"
}

if ([string]::IsNullOrWhiteSpace($DecisionLogFile)) {
    $DecisionLogFile = Join-Path (Join-Path $repoRoot "reports") "delegation-decisions.csv"
}
elseif (![System.IO.Path]::IsPathRooted($DecisionLogFile)) {
    $DecisionLogFile = Join-Path $repoRoot $DecisionLogFile
}

$logRow = [pscustomobject]@{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    RequestedMode = [string]$decision.Mode
    ExecutionMode = $executionMode
    TaskKind = $TaskKind
    TaskScale = [string]$decision.TaskScale
    TargetFile = $TargetFile
    Files = (@($Files) -join ";")
    EstimatedChangedLines = $EstimatedChangedLines
    EstimatedContextTokens = [int]$decision.EstimatedContextTokens
    LocalTokenCost = [string]$decision.CostModel.LocalTokenCost
    LocalResourceRisk = [string]$decision.CostModel.LocalResourceRisk
    ModelDownshiftRisk = [string]$decision.CostModel.ModelDownshiftRisk
    CandidateCount = [int]$decision.AgenticLoopOptions.CandidateCount
    EnableBreaker = [bool]$decision.AgenticLoopOptions.EnableBreaker
    ValidatorProfile = $ValidatorProfile
    ValidationCommand = $ValidationCommand
    ValidationTimeoutSeconds = $ValidationTimeoutSeconds
    ValidatorSource = if ($null -ne $validatorSelection) { [string]$validatorSelection.Source } else { "manual" }
    ValidatorReason = if ($null -ne $validatorSelection) { [string]$validatorSelection.Reason } else { "" }
    RequestedWorkerBackend = $requestedWorkerBackend
    WorkerBackend = $WorkerBackend
    AiderAvailable = $aiderAvailable
    DestructiveIntent = $destructiveIntent
    AllowDestructive = $AllowDestructive.IsPresent
    AutoAiderFallbackBlocked = $autoAiderFallbackBlocked
    AllowAgenticLoopFallback = $AllowAgenticLoopFallback.IsPresent
    WorkerBackendReason = if ($decision.WorkerBackend -and $decision.WorkerBackend.Reason) { [string]$decision.WorkerBackend.Reason } else { "" }
    Reason = [string]$decision.Reason
    ExecutionNote = $executionNote
}
Write-DecisionLog -Path $DecisionLogFile -Row $logRow

Write-Host "Delegation decision: requested=$($decision.Mode) execution=$executionMode risk=$($decision.CostModel.LocalResourceRisk) downshift=$($decision.CostModel.ModelDownshiftRisk)"
if (![string]::IsNullOrWhiteSpace($executionNote)) {
    Write-Host $executionNote -ForegroundColor Yellow
}

if ($DryRun) {
    [pscustomobject]@{
        Decision = $decision
        ExecutionMode = $executionMode
        ExecutionNote = $executionNote
        ValidatorProfile = $ValidatorProfile
        ValidationCommand = $ValidationCommand
        ValidationTimeoutSeconds = $ValidationTimeoutSeconds
        ValidatorSelection = $validatorSelection
        RequestedWorkerBackend = $requestedWorkerBackend
        WorkerBackend = $WorkerBackend
        AiderAvailable = $aiderAvailable
        DestructiveIntent = $destructiveIntent
        AllowDestructive = $AllowDestructive.IsPresent
        AutoAiderFallbackBlocked = $autoAiderFallbackBlocked
        AllowAgenticLoopFallback = $AllowAgenticLoopFallback.IsPresent
        WorkerBackendRecommendation = $decision.WorkerBackend
        DecisionLogFile = $DecisionLogFile
    } | ConvertTo-Json -Depth 8
    exit 0
}

switch ($executionMode) {
    "AgenticLoop" {
        if ([string]::IsNullOrWhiteSpace($TargetFile)) {
            throw "TargetFile is required when executing file-writing work through AgenticLoop."
        }

        $loopArgs = @{
            Prompt             = $Prompt
            TargetFile         = $TargetFile
            Files              = $Files
            MaxRetries         = $MaxRetries
            TaskType           = "coding"
            TaskScale          = [string]$decision.TaskScale
            TaskTitle          = "Delegated Agent Task: $(Split-Path -Leaf $TargetFile)"
            CandidateCount     = [int]$decision.AgenticLoopOptions.CandidateCount
            EnableBreaker      = [bool]$decision.AgenticLoopOptions.EnableBreaker
            SandboxMode        = $SandboxMode.IsPresent
            KeepArtifacts      = $KeepArtifacts.IsPresent
            NoHardwareSnapshot = $NoHardwareSnapshot.IsPresent
            ValidatorProfile   = $ValidatorProfile
            ValidationCommand  = $ValidationCommand
            ValidationTimeoutSeconds = $ValidationTimeoutSeconds
        }
        if (![string]::IsNullOrWhiteSpace($Model)) { $loopArgs.Model = $Model }
        if ($NumCtx -gt 0) { $loopArgs.NumCtx = $NumCtx }
        if (![string]::IsNullOrWhiteSpace($ArtifactDir)) { $loopArgs.ArtifactDir = $ArtifactDir }

        & (Join-Path $scriptDir "Invoke-AgenticLoop.ps1") @loopArgs
    }
    "AiderWorker" {
        $aiderArgs = @{
            Prompt = $Prompt
            Files = $Files
            Model = if (![string]::IsNullOrWhiteSpace($Model)) { $Model } else { "qwen2.5-coder:32b" }
            ValidatorProfile = $ValidatorProfile
            ValidationCommand = $ValidationCommand
            ValidationTimeoutSeconds = $ValidationTimeoutSeconds
            DryRun = $SandboxMode.IsPresent
            KeepArtifacts = $KeepArtifacts.IsPresent
        }
        if (![string]::IsNullOrWhiteSpace($AiderModel)) { $aiderArgs.AiderModel = $AiderModel }
        if (![string]::IsNullOrWhiteSpace($AiderExecutable)) { $aiderArgs.AiderExecutable = $AiderExecutable }
        if (![string]::IsNullOrWhiteSpace($AiderEditFormat)) { $aiderArgs.EditFormat = $AiderEditFormat }
        if (![string]::IsNullOrWhiteSpace($ArtifactDir)) { $aiderArgs.ArtifactDir = $ArtifactDir }

        & (Join-Path $scriptDir "Invoke-AiderWorker.ps1") @aiderArgs
    }
    "LocalDirect" {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $promptFile = Join-Path $env:TEMP "delegated-local-$stamp-$([guid]::NewGuid().ToString('N')).md"
        $outputFile = Join-Path (Join-Path $repoRoot "reports") "delegated-local-$stamp.md"
        Set-Content -LiteralPath $promptFile -Encoding UTF8 -Value $Prompt
        try {
            $localArgs = @{
                PromptFile = $promptFile
                OutputFile = $outputFile
                TaskTitle = "Delegated LocalDirect: $TaskKind"
                TaskType = if ($TaskKind -eq "review") { "routing_review" } else { "general" }
            }
            if (![string]::IsNullOrWhiteSpace($Model)) { $localArgs.Model = $Model }
            if ($NumCtx -gt 0) { $localArgs.NumCtx = $NumCtx }
            & (Join-Path $scriptDir "Invoke-LocalLLM.ps1") @localArgs
        }
        finally {
            Remove-Item -LiteralPath $promptFile -Force -ErrorAction SilentlyContinue
        }
    }
    "ManualReviewRequired" {
        throw $executionNote
    }
    default {
        throw "Execution mode '$executionMode' cannot be executed by this wrapper. Use the decision log to route it manually."
    }
}

param(
    [ValidateSet("summarization", "extraction", "coding", "reasoning", "korean", "long_context", "routing_review", "general")]
    [string]$TaskType = "general",

    [string]$TaskScale = "Medium",

    [int]$MetricsWindowDays = 30,

    [int]$MaxExpectedSeconds = 0,

    [switch]$InstalledOnly,

    [string]$RegistryFile = "",

    [string]$MetricsFile = "",

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
        # Not a git repo.
    }

    return (Get-Location).Path
}

function Get-InstalledOllamaModels {
    try {
        $tags = curl.exe -sS --max-time 3 "http://localhost:11434/api/tags" | ConvertFrom-Json
        if ($tags.models) {
            return @($tags.models | ForEach-Object { [string]$_.name })
        }
    }
    catch {
        return @()
    }

    return @()
}

function Get-TaskScore {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Row,

        [Parameter(Mandatory = $true)]
        [string]$Type
    )

    $column = switch ($Type) {
        "summarization" { "SummarizationScore" }
        "extraction" { "ExtractionScore" }
        "coding" { "CodingScore" }
        "reasoning" { "ReasoningScore" }
        "korean" { "KoreanScore" }
        "long_context" { "LongContextScore" }
        "routing_review" { "ReasoningScore" }
        default { "SummarizationScore" }
    }

    $value = 0.0
    if ([double]::TryParse([string]$Row.$column, [ref]$value)) {
        return $value
    }

    return 5.0
}

function Normalize-Score {
    param([double]$Value)
    if ($Value -lt 0) { return 0.0 }
    if ($Value -gt 10) { return 1.0 }
    return $Value / 10.0
}

$repoRoot = Get-RepoRoot
Import-Module (Join-Path $PSScriptRoot "lib\EggR.Paths.psm1") -Force -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

if ([string]::IsNullOrWhiteSpace($RegistryFile)) {
    $RegistryFile = Join-Path $repoRoot "config\local_llm_model_registry.csv"
}
if ([string]::IsNullOrWhiteSpace($MetricsFile)) {
    $MetricsFile = Join-Path $storagePath "reports\local_llm_metrics.csv"
}

if (!(Test-Path -LiteralPath $RegistryFile)) {
    throw "Local LLM model registry not found: $RegistryFile"
}

$registry = @(Import-Csv -LiteralPath $RegistryFile)
if ($registry.Count -eq 0) {
    throw "Local LLM model registry is empty: $RegistryFile"
}

$installedModels = @(Get-InstalledOllamaModels)
$installedSet = @{}
foreach ($model in $installedModels) {
    $installedSet[$model] = $true
}

$cutoff = (Get-Date).AddDays(-1 * [math]::Max($MetricsWindowDays, 1))
$historyByModel = @{}
if (Test-Path -LiteralPath $MetricsFile) {
    foreach ($metric in @(Import-Csv -LiteralPath $MetricsFile)) {
        if ([string]::IsNullOrWhiteSpace($metric.Model)) { continue }
        if (![string]::IsNullOrWhiteSpace($metric.TaskType) -and $metric.TaskType -ne $TaskType) { continue }

        $timestamp = [datetime]::MinValue
        if (![datetime]::TryParse([string]$metric.Timestamp, [ref]$timestamp)) { continue }
        if ($timestamp -lt $cutoff) { continue }

        if (!$historyByModel.ContainsKey($metric.Model)) {
            $historyByModel[$metric.Model] = New-Object System.Collections.Generic.List[object]
        }
        $historyByModel[$metric.Model].Add($metric)
    }
}

$candidates = foreach ($row in $registry) {
    $model = [string]$row.Model
    $installed = $installedSet.ContainsKey($model)
    if ($InstalledOnly -and !$installed) { continue }

    $taskScore = Normalize-Score (Get-TaskScore -Row $row -Type $TaskType)
    $speedScore = Normalize-Score ([double]([string]$row.SpeedScore))
    $reliabilityPrior = 0.6
    $parsedReliability = 0.0
    if ([double]::TryParse([string]$row.ReliabilityPrior, [ref]$parsedReliability)) {
        $reliabilityPrior = $parsedReliability
    }

    $history = if ($historyByModel.ContainsKey($model)) { $historyByModel[$model] } else { $null }
    $historyCount = if ($null -ne $history) { [int]$history.Count } else { 0 }
    $successRate = $reliabilityPrior
    $avgElapsed = $null
    $tokensPerSecond = 0.0
    if ($historyCount -gt 0) {
        $successRows = @($history | Where-Object { ($_.PSObject.Properties.Name -contains "Success") -and ![string]::IsNullOrWhiteSpace([string]$_.Success) })
        if ($successRows.Count -gt 0) {
            $successCount = @($successRows | Where-Object { [string]$_.Success -match "^(true|1|yes)$" }).Count
            $successRate = $successCount / [double]$successRows.Count
        }

        $elapsedValues = @($history | ForEach-Object {
            $v = 0.0
            if ([double]::TryParse([string]$_.ActualElapsedSeconds, [ref]$v) -and $v -gt 0) { $v }
        })
        if ($elapsedValues.Count -gt 0) {
            $avgElapsed = ($elapsedValues | Measure-Object -Average).Average
        }

        $tpsValues = @($history | ForEach-Object {
            $v = 0.0
            if ([double]::TryParse([string]$_.TokensPerSecond, [ref]$v) -and $v -gt 0) { $v }
        })
        if ($tpsValues.Count -gt 0) {
            $tokensPerSecond = ($tpsValues | Measure-Object -Average).Average
            $speedScore = [math]::Min(1.0, [math]::Max(0.1, $tokensPerSecond / 40.0))
        }
    }

    $timePenalty = 0.0
    if ($MaxExpectedSeconds -gt 0 -and $null -ne $avgElapsed -and $avgElapsed -gt $MaxExpectedSeconds) {
        $timePenalty = [math]::Min(0.25, (($avgElapsed - $MaxExpectedSeconds) / [double]$MaxExpectedSeconds) * 0.25)
    }

    $installBonus = if ($installed) { 0.08 } else { -0.20 }
    $score = (0.48 * $taskScore) + (0.27 * $successRate) + (0.17 * $speedScore) + (0.08 * $reliabilityPrior) + $installBonus - $timePenalty

    [pscustomobject]@{
        Model                  = $model
        Provider               = [string]$row.Provider
        TaskType               = $TaskType
        TaskScale              = $TaskScale
        Score                  = [math]::Round($score, 4)
        Installed              = $installed
        TaskScore              = [math]::Round($taskScore, 3)
        HistoricalSuccessRate  = [math]::Round($successRate, 3)
        HistoricalSamples      = $historyCount
        SpeedScore             = [math]::Round($speedScore, 3)
        AverageElapsedSeconds  = if ($null -ne $avgElapsed) { [math]::Round($avgElapsed, 2) } else { $null }
        AverageTokensPerSecond = if ($tokensPerSecond -gt 0) { [math]::Round($tokensPerSecond, 2) } else { $null }
        ReliabilityPrior       = [math]::Round($reliabilityPrior, 3)
        PrimaryUse             = [string]$row.PrimaryUse
        SourceUrl              = [string]$row.SourceUrl
    }
}

$ranked = @($candidates | Sort-Object -Property Score -Descending)
if ($ranked.Count -eq 0) {
    throw "No local LLM candidate matched the requested filters. TaskType=$TaskType InstalledOnly=$InstalledOnly"
}

$selected = $ranked[0]
$reason = "Selected $($selected.Model) for $($TaskType): score=$($selected.Score), task=$($selected.TaskScore), historicalSuccess=$($selected.HistoricalSuccessRate) from $($selected.HistoricalSamples) sample(s), speed=$($selected.SpeedScore), installed=$($selected.Installed)."
$result = [pscustomobject]@{
    SelectedModel = $selected.Model
    Provider      = $selected.Provider
    TaskType      = $TaskType
    TaskScale     = $TaskScale
    Reason        = $reason
    Candidates    = $ranked
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 8
}
else {
    Write-Host $reason
    $ranked | Select-Object Model, Score, Installed, TaskScore, HistoricalSuccessRate, HistoricalSamples, SpeedScore, AverageElapsedSeconds, AverageTokensPerSecond, PrimaryUse | Format-Table -AutoSize
}

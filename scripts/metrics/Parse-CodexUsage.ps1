param(
    [Parameter(Mandatory = $true)]
    [string]$JsonlPath,

    [Parameter(Mandatory = $false)]
    [string]$OperationName = "",

    [Parameter(Mandatory = $false)]
    [string]$Model = "unknown",

    [Parameter(Mandatory = $false)]
    [string]$OutputCsv = "",

    [switch]$PrintSummary
)

$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($repoRoot) { $repoRoot = ($repoRoot | Select-Object -First 1).Trim() }
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

if ([string]::IsNullOrWhiteSpace($OutputCsv)) {
    $OutputCsv = Join-Path $storagePath "reports\codex_usage.csv"
}

$resolvedJsonl = Resolve-Path -LiteralPath $JsonlPath

function Get-JsonNumber {
    param(
        [Parameter(Mandatory = $false)]
        $Object,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Object) {
        return 0
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return 0
    }

    return [int64]$property.Value
}

function Get-CreditEstimate {
    param(
        [string]$ModelName,
        [int64]$InputTokens,
        [int64]$CachedInputTokens,
        [int64]$OutputTokens
    )

    $rates = @{
        "gpt-5.5" = @{ input = 125.0; cached = 12.5; output = 750.0 }
        "gpt-5.4" = @{ input = 62.5; cached = 6.25; output = 375.0 }
        "gpt-5.4-mini" = @{ input = 18.75; cached = 1.875; output = 113.0 }
    }

    if (!$rates.ContainsKey($ModelName)) {
        return ""
    }

    $r = $rates[$ModelName]
    $nonCachedInput = [math]::Max(0, $InputTokens - $CachedInputTokens)
    $credits = (($nonCachedInput * $r.input) + ($CachedInputTokens * $r.cached) + ($OutputTokens * $r.output)) / 1000000.0
    return [math]::Round($credits, 6)
}

$rows = New-Object System.Collections.Generic.List[object]
$threadId = ""
$turnIndex = 0
$lineNumber = 0

foreach ($line in [System.IO.File]::ReadLines($resolvedJsonl)) {
    $lineNumber++
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    try {
        $event = $line | ConvertFrom-Json
    } catch {
        Write-Warning "Skipping non-JSON line $lineNumber in $JsonlPath"
        continue
    }

    if ($event.type -eq "thread.started" -and $event.thread_id) {
        $threadId = [string]$event.thread_id
        continue
    }

    if ($event.type -ne "turn.completed" -or $null -eq $event.usage) {
        continue
    }

    $turnIndex++
    $usage = $event.usage
    $inputTokens = Get-JsonNumber -Object $usage -Name "input_tokens"
    $cachedInputTokens = Get-JsonNumber -Object $usage -Name "cached_input_tokens"
    $outputTokens = Get-JsonNumber -Object $usage -Name "output_tokens"
    $reasoningOutputTokens = Get-JsonNumber -Object $usage -Name "reasoning_output_tokens"
    $totalTokens = $inputTokens + $outputTokens
    $creditEstimate = Get-CreditEstimate -ModelName $Model -InputTokens $inputTokens -CachedInputTokens $cachedInputTokens -OutputTokens $outputTokens

    $rows.Add([pscustomobject]@{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Workspace = if ($repoRoot) { Split-Path -Leaf $repoRoot } else { "Unknown" }
        WorkspacePath = $repoRoot
        Operation = $OperationName
        Method = "codex-jsonl-usage"
        Model = $Model
        ThreadId = $threadId
        TurnIndex = $turnIndex
        InputTokens = $inputTokens
        CachedInputTokens = $cachedInputTokens
        OutputTokens = $outputTokens
        ReasoningOutputTokens = $reasoningOutputTokens
        TotalTokens = $totalTokens
        EstimatedCredits = $creditEstimate
        Source = $resolvedJsonl.Path
    })
}

$outputDir = Split-Path -Parent $OutputCsv
if (![string]::IsNullOrWhiteSpace($outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

if ($rows.Count -gt 0) {
    if (Test-Path -LiteralPath $OutputCsv) {
        $rows | Export-CsvUtf8NoBom -Append -LiteralPath $OutputCsv
    } else {
        $rows | Export-CsvUtf8NoBom -LiteralPath $OutputCsv
    }
}

$summary = [pscustomobject]@{
    Source = $resolvedJsonl.Path
    Turns = $rows.Count
    InputTokens = ($rows | Measure-Object -Property InputTokens -Sum).Sum
    CachedInputTokens = ($rows | Measure-Object -Property CachedInputTokens -Sum).Sum
    OutputTokens = ($rows | Measure-Object -Property OutputTokens -Sum).Sum
    ReasoningOutputTokens = ($rows | Measure-Object -Property ReasoningOutputTokens -Sum).Sum
    TotalTokens = ($rows | Measure-Object -Property TotalTokens -Sum).Sum
}

if ($PrintSummary) {
    $summary | Format-List
} else {
    Write-Host "Parsed $($rows.Count) Codex usage turn(s) from $JsonlPath."
}



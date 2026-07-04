param(
    [Parameter(Mandatory = $true)]
    [string]$JsonPath,

    [string]$OperationName = "",
    [string]$Model = "unknown",
    [string]$OutputCsv = ""
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
    $OutputCsv = Join-Path $storagePath "reports\gemini_token_usage.csv"
}

$resolved = Resolve-Path -LiteralPath $JsonPath
$json = Get-Content -Raw -LiteralPath $resolved | ConvertFrom-Json

function Get-OptionalNumber {
    param($Object, [string[]]$Names)

    foreach ($name in $Names) {
        if ($null -ne $Object -and $Object.PSObject.Properties[$name] -and $null -ne $Object.$name) {
            return [int64]$Object.$name
        }
    }
    return 0
}

$usage = $null
if ($json.PSObject.Properties["usageMetadata"]) {
    $usage = $json.usageMetadata
    $inputTokens = Get-OptionalNumber $usage @("promptTokenCount")
    $outputTokens = Get-OptionalNumber $usage @("candidatesTokenCount")
    $thinkingTokens = Get-OptionalNumber $usage @("thoughtsTokenCount", "thinkingTokenCount")
    $cachedTokens = Get-OptionalNumber $usage @("cachedContentTokenCount")
    $toolUseTokens = Get-OptionalNumber $usage @("toolUsePromptTokenCount")
    $totalTokens = Get-OptionalNumber $usage @("totalTokenCount")
} elseif ($json.PSObject.Properties["usage"]) {
    $usage = $json.usage
    $inputTokens = Get-OptionalNumber $usage @("total_input_tokens", "input_tokens")
    $outputTokens = Get-OptionalNumber $usage @("total_output_tokens", "output_tokens")
    $thinkingTokens = Get-OptionalNumber $usage @("total_thought_tokens", "thought_tokens")
    $cachedTokens = Get-OptionalNumber $usage @("total_cached_tokens", "cached_tokens")
    $toolUseTokens = Get-OptionalNumber $usage @("total_tool_use_tokens", "tool_use_tokens")
    $totalTokens = Get-OptionalNumber $usage @("total_tokens")
} elseif ($json.PSObject.Properties["stats"]) {
    $usage = $json.stats
    $inputTokens = Get-OptionalNumber $usage @("input_tokens", "input")
    $outputTokens = Get-OptionalNumber $usage @("output_tokens", "output")
    $thinkingTokens = Get-OptionalNumber $usage @("thought_tokens", "thinking_tokens")
    $cachedTokens = Get-OptionalNumber $usage @("cached", "cached_tokens")
    $toolUseTokens = Get-OptionalNumber $usage @("tool_use_tokens")
    $totalTokens = Get-OptionalNumber $usage @("total_tokens")
} else {
    throw "No supported Gemini usage object found in $JsonPath."
}

if ($totalTokens -eq 0) {
    $totalTokens = $inputTokens + $outputTokens + $thinkingTokens
}

$row = [pscustomobject]@{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Workspace = if ($repoRoot) { Split-Path -Leaf $repoRoot } else { "Unknown" }
    WorkspacePath = $repoRoot
    Operation = $OperationName
    Method = "gemini-usage-json"
    Model = $Model
    InputTokens = $inputTokens
    OutputTokens = $outputTokens
    ThinkingTokens = $thinkingTokens
    CachedTokens = $cachedTokens
    ToolUseTokens = $toolUseTokens
    TotalTokens = $totalTokens
    Confidence = "exact-if-source-response"
    Source = $resolved.Path
}

$outputDir = Split-Path -Parent $OutputCsv
if (![string]::IsNullOrWhiteSpace($outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

if (Test-Path -LiteralPath $OutputCsv) {
    $row | Export-Csv -NoTypeInformation -Encoding UTF8 -Append -LiteralPath $OutputCsv
} else {
    $row | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $OutputCsv
}

$row | Format-List



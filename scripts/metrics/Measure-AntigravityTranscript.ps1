param(
    [string]$AntigravityRoot = "",
    [string]$OutputCsv = "",
    [switch]$IncludeAntigravityDesktop
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
    $OutputCsv = Join-Path $storagePath "reports\antigravity_transcript_estimates.csv"
}

if ([string]::IsNullOrWhiteSpace($AntigravityRoot)) {
    $roots = @((Join-Path $HOME ".gemini\antigravity-ide"))
    if ($IncludeAntigravityDesktop) {
        $roots += (Join-Path $HOME ".gemini\antigravity")
    }
} else {
    $roots = @($AntigravityRoot)
}

function Get-TextEstimate {
    param([string]$Text)

    if ([string]::IsNullOrEmpty($Text)) {
        return 0
    }

    $charCount = $Text.Length
    $byteCount = [System.Text.Encoding]::UTF8.GetByteCount($Text)
    $wordCount = (($Text -split '\s+') | Where-Object { $_ -ne "" }).Count
    return [math]::Max([math]::Ceiling($charCount / 4), [math]::Max([math]::Ceiling($byteCount / 4), [math]::Ceiling($wordCount * 1.35)))
}

$rows = New-Object System.Collections.Generic.List[object]

foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root)) {
        continue
    }

    $files = Get-ChildItem -LiteralPath $root -Recurse -Filter transcript.jsonl -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $conversationId = Split-Path (Split-Path (Split-Path $file.DirectoryName -Parent) -Parent) -Leaf
        $stepCount = 0
        $modelSteps = 0
        $userSteps = 0
        $toolSteps = 0
        $contentChars = 0
        $toolCallChars = 0
        $estimatedTokens = 0
        $firstCreatedAt = ""
        $lastCreatedAt = ""

        foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }

            try {
                $event = $line | ConvertFrom-Json
            } catch {
                continue
            }

            $stepCount++
            if ($event.created_at) {
                if ([string]::IsNullOrWhiteSpace($firstCreatedAt)) {
                    $firstCreatedAt = [string]$event.created_at
                }
                $lastCreatedAt = [string]$event.created_at
            }

            switch ([string]$event.source) {
                "MODEL" { $modelSteps++ }
                "USER" { $userSteps++ }
                default { }
            }

            if ($event.type -match "TOOL|VIEW|TERMINAL|FILE|MCP|COMMAND") {
                $toolSteps++
            }

            if ($event.PSObject.Properties["content"] -and $null -ne $event.content) {
                $contentText = [string]$event.content
                $contentChars += $contentText.Length
                $estimatedTokens += Get-TextEstimate -Text $contentText
            }

            if ($event.PSObject.Properties["tool_calls"] -and $null -ne $event.tool_calls) {
                $toolText = ($event.tool_calls | ConvertTo-Json -Depth 20 -Compress)
                $toolCallChars += $toolText.Length
                $estimatedTokens += Get-TextEstimate -Text $toolText
            }
        }

        $rows.Add([pscustomobject]@{
            Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            Surface = if ($root -match "antigravity-ide") { "antigravity-ide" } else { "antigravity" }
            ConversationId = $conversationId
            FirstCreatedAt = $firstCreatedAt
            LastCreatedAt = $lastCreatedAt
            StepCount = $stepCount
            UserSteps = $userSteps
            ModelSteps = $modelSteps
            ToolLikeSteps = $toolSteps
            ContentChars = $contentChars
            ToolCallChars = $toolCallChars
            EstimatedTokens = $estimatedTokens
            Confidence = "low-transcript-only"
            Source = $file.FullName
        })
    }
}

$outputDir = Split-Path -Parent $OutputCsv
if (![string]::IsNullOrWhiteSpace($outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

if ($rows.Count -gt 0) {
    $rows | Sort-Object LastCreatedAt -Descending | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $OutputCsv
}

Write-Host "Wrote $($rows.Count) Antigravity transcript estimate row(s) to $OutputCsv"



param(
    [Parameter(Mandatory = $false)]
    [string]$FilePath,

    [Parameter(Mandatory = $false)]
    [string]$Text,

    [string]$Model = "gemini-3.5-flash",
    [string]$OperationName = "Gemini input token count",
    [string]$OutputCsv = ""
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    try {
        $root = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($root)) {
            return ([string]$root).Trim()
        }
    } catch {
        # Fall back below when git is unavailable or this is not a repository.
    }

    return $PWD.Path
}

function Resolve-InputText {
    param(
        [string]$FilePath,
        [string]$Text
    )

    $hasFilePath = ![string]::IsNullOrWhiteSpace($FilePath)
    $hasText = ![string]::IsNullOrEmpty($Text)

    if ($hasFilePath -and $hasText) {
        throw "Provide either -Text or -FilePath, not both."
    }

    if (!$hasFilePath -and !$hasText) {
        throw "Provide -Text or -FilePath."
    }

    if ($hasFilePath) {
        if (!(Test-Path -LiteralPath $FilePath -PathType Leaf)) {
            throw "File not found or not a regular file: $FilePath"
        }

        $resolved = Resolve-Path -LiteralPath $FilePath -ErrorAction Stop
        return [pscustomobject]@{
            Text = [System.IO.File]::ReadAllText($resolved.ProviderPath, [System.Text.Encoding]::UTF8)
            Source = $resolved.ProviderPath
        }
    }

    return [pscustomobject]@{
        Text = $Text
        Source = "inline-text"
    }
}

function Get-RestFailureMessage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Provider,
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord
    )

    $parts = @("$Provider token count request failed: $($ErrorRecord.Exception.Message)")
    if ($ErrorRecord.ErrorDetails -and ![string]::IsNullOrWhiteSpace($ErrorRecord.ErrorDetails.Message)) {
        $parts += "Response body: $($ErrorRecord.ErrorDetails.Message)"
    }

    return ($parts -join " ")
}

function Export-TokenRow {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Row,
        [Parameter(Mandatory = $true)]
        [string]$OutputCsv
    )

    $outputDir = Split-Path -Parent $OutputCsv
    if (![string]::IsNullOrWhiteSpace($outputDir)) {
        New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    }

    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            if (Test-Path -LiteralPath $OutputCsv) {
                $Row | Export-CsvUtf8NoBom -Append -LiteralPath $OutputCsv
            } else {
                $Row | Export-CsvUtf8NoBom -LiteralPath $OutputCsv
            }
            return
        } catch {
            $lastError = $_
            if ($attempt -lt 3) {
                Start-Sleep -Milliseconds (250 * $attempt)
            }
        }
    }

    throw "Failed to write token usage CSV '$OutputCsv': $($lastError.Exception.Message)"
}

$repoRoot = Get-RepoRoot

Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot


if ([string]::IsNullOrWhiteSpace($OutputCsv)) {
    $OutputCsv = Join-Path $storagePath "reports\gemini_token_usage.csv"
}

$resolvedInput = Resolve-InputText -FilePath $FilePath -Text $Text
$Text = $resolvedInput.Text

$apiKey = $env:GEMINI_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "GEMINI_API_KEY is not set. This script uses Gemini's official countTokens API."
}

$body = @{
    contents = @(
        @{
            parts = @(
                @{
                    text = $Text
                }
            )
        }
    )
} | ConvertTo-Json -Depth 20

$uri = "https://generativelanguage.googleapis.com/v1beta/models/$($Model):countTokens"
try {
    $response = Invoke-RestMethod `
        -Method Post `
        -Uri $uri `
        -Headers @{ "x-goog-api-key" = $apiKey } `
        -ContentType "application/json" `
        -Body $body `
        -ErrorAction Stop
} catch {
    throw (Get-RestFailureMessage -Provider "Gemini" -ErrorRecord $_)
}

$totalTokens = [int64]$response.totalTokens

$row = [pscustomobject]@{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Operation = $OperationName
    Method = "gemini-countTokens-api"
    Model = $Model
    InputTokens = $totalTokens
    OutputTokens = ""
    ThinkingTokens = ""
    CachedTokens = ""
    ToolUseTokens = ""
    TotalTokens = $totalTokens
    Confidence = "exact-input"
    Source = $resolvedInput.Source
}

Export-TokenRow -Row $row -OutputCsv $OutputCsv

Write-Host "Gemini exact input tokens: $totalTokens"


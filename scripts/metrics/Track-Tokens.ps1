param(
    [Parameter(Mandatory = $false)]
    [string]$FilePath,

    [Parameter(Mandatory = $false)]
    [string]$Text,

    [Parameter(Mandatory = $false)]
    [string]$OperationName = "Unknown Operation",

    [Parameter(Mandatory = $false)]
    [string]$Model = "unknown",

    [Parameter(Mandatory = $false)]
    [string]$LogFile = "",

    [Parameter(Mandatory = $false)]
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($repoRoot) { $repoRoot = ($repoRoot | Select-Object -First 1).Trim() }
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

# [SelfTest Mode]
if ($SelfTest) {
    Write-Host "[Self-Test] Starting Track-Tokens.ps1 self-test..."
    $tempTextFile = Join-Path $repoRoot "scripts\__temp_test_track_tokens.txt"
    $tempCsvFile = Join-Path $repoRoot "scripts\__temp_test_track_tokens.csv"
    
    try {
        # 1. Clean up stale test files if any
        if (Test-Path $tempTextFile) { Remove-Item $tempTextFile -Force }
        if (Test-Path $tempCsvFile) { Remove-Item $tempCsvFile -Force }

        # 2. Write test file with UTF-8 & Emoji
        [System.IO.File]::WriteAllText($tempTextFile, "?덈뀞?섏꽭?? ?대え吏 ?뱚 ?슚 ?뚯뒪??Text.", [System.Text.Encoding]::UTF8)

        # 3. Execute self call
        & $MyInvocation.MyCommand.Path -FilePath $tempTextFile -LogFile $tempCsvFile -OperationName "Test-Operation" -Model "test-model"

        # 4. Asserts
        if (!(Test-Path $tempCsvFile)) {
            throw "Self-Test Failed: CSV file was not created."
        }
        $csvData = @(Import-Csv -Path $tempCsvFile -Encoding UTF8)
        if ($csvData.Count -ne 1) {
            throw "Self-Test Failed: CSV row count is not 1."
        }
        if ($csvData[0].Operation -ne "Test-Operation" -or $csvData[0].Model -ne "test-model") {
            throw "Self-Test Failed: CSV data mismatch."
        }
        if ([int]$csvData[0].EstimatedTokens -le 0) {
            throw "Self-Test Failed: Estimated tokens should be > 0."
        }

        Write-Host "[Self-Test] Track-Tokens.ps1 passed successfully!"
        exit 0
    }
    catch {
        Write-Warning "[Self-Test] Track-Tokens.ps1 failed: $_"
        exit 1
    }
    finally {
        if (Test-Path $tempTextFile) { Remove-Item $tempTextFile -Force -ErrorAction SilentlyContinue }
        if (Test-Path $tempCsvFile) { Remove-Item $tempCsvFile -Force -ErrorAction SilentlyContinue }
    }
}

if ([string]::IsNullOrWhiteSpace($LogFile)) {
    $LogFile = Join-Path $storagePath "reports\token_usage.csv"
}

if (![string]::IsNullOrWhiteSpace($FilePath)) {
    if (!(Test-Path -LiteralPath $FilePath)) {
        Write-Warning "File not found: $FilePath"
        exit 1
    }
    try {
        $Text = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $FilePath), [System.Text.Encoding]::UTF8)
    }
    catch {
        Write-Warning "Failed to read file ${FilePath}: $_"
        exit 1
    }
}

if ([string]::IsNullOrEmpty($Text)) {
    Write-Host "No text provided to token tracker."
    exit 0
}

$wordCount = (($Text -split '\s+') | Where-Object { $_ -ne "" }).Count
$charCount = $Text.Length
$utf8Bytes = [System.Text.Encoding]::UTF8.GetByteCount($Text)

# Conservative local estimate. This is not exact model tokenization.
$tokenFromWords = [math]::Ceiling($wordCount * 1.35)
$tokenFromChars = [math]::Ceiling($charCount / 4)
$tokenFromBytes = [math]::Ceiling($utf8Bytes / 4)
$estimatedTokens = [math]::Max($tokenFromWords, [math]::Max($tokenFromChars, $tokenFromBytes))

$row = [pscustomobject]@{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Workspace = if ($repoRoot) { Split-Path -Leaf $repoRoot } else { "Unknown" }
    WorkspacePath = $repoRoot
    Operation = $OperationName
    Method = "heuristic-local"
    Model = $Model
    WordCount = $wordCount
    CharCount = $charCount
    Utf8Bytes = $utf8Bytes
    InputTokens = ""
    CachedInputTokens = ""
    OutputTokens = ""
    ReasoningOutputTokens = ""
    TotalTokens = $estimatedTokens
    EstimatedTokens = $estimatedTokens
    Confidence = "low"
    Source = if ($FilePath) { $FilePath } else { "inline-text" }
}

$logDir = Split-Path -Parent $LogFile
if (![string]::IsNullOrWhiteSpace($logDir)) {
    try {
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }
    catch {
        Write-Warning "Failed to create directory ${logDir}: $_"
        exit 1
    }
}

# Safe write to CSV with retry (in case file is locked)
$success = $false
$retries = 3
$delay = 1000 # ms
for ($i = 0; $i -lt $retries; $i++) {
    try {
        if (Test-Path -LiteralPath $LogFile) {
            $row | Export-Csv -NoTypeInformation -Encoding UTF8 -Append -LiteralPath $LogFile
        } else {
            $row | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $LogFile
        }
        $success = $true
        break
    }
    catch {
        Write-Warning "Failed to write to $LogFile (attempt $($i+1)/$retries): $_"
        Start-Sleep -Milliseconds $delay
    }
}

if (!$success) {
    # Fallback to secondary file if target remains locked
    $fallbackLog = $LogFile.Replace(".csv", "_fallback.csv")
    try {
        if (Test-Path -LiteralPath $fallbackLog) {
            $row | Export-Csv -NoTypeInformation -Encoding UTF8 -Append -LiteralPath $fallbackLog
        } else {
            $row | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $fallbackLog
        }
        Write-Warning "Saved output to fallback log file: $fallbackLog"
    }
    catch {
        Write-Warning "All log write attempts failed, including fallback."
    }
}

Write-Host "Token estimate logged: $estimatedTokens tokens for '$OperationName' (low confidence)."




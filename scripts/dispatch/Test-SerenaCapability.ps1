param(
    [string]$RepoRoot,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"

function Resolve-RepoRoot {
    param([string]$Path)

    if (![string]::IsNullOrWhiteSpace($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            return [System.IO.Path]::GetFullPath($gitRoot.Trim())
        }
    } catch {
    }

    return (Get-Location).Path
}

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $parent = Split-Path -Parent $Path
    if (![string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $json = $Value | ConvertTo-Json -Depth 12
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8NoBom)
}

function Get-LatestHealthLog {
    param([string]$Root)

    $logDir = Join-Path $Root ".serena\logs\health-checks"
    if (!(Test-Path -LiteralPath $logDir)) {
        return $null
    }
    return Get-ChildItem -LiteralPath $logDir -File -Filter "*.log" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Parse-HealthLog {
    param([string]$Path)

    $summary = [ordered]@{
        logPath = $Path
        serenaVersion = $null
        loadedToolsCount = $null
        exposedToolsCount = $null
        activeToolsCount = $null
        activeTools = @()
        language = $null
        languageServer = $null
        analyzableFile = $null
        symbolsOverviewCount = $null
        findSymbolMatches = $null
        referencingSymbolMatches = $null
        patternMatches = $null
        completedSuccessfully = $false
    }

    if ([string]::IsNullOrWhiteSpace($Path) -or !(Test-Path -LiteralPath $Path)) {
        return $summary
    }

    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
    if ($text -match "version=([^,\s]+)") {
        $summary.serenaVersion = $Matches[1]
    }
    if ($text -match "Loaded tools \((\d+)\):") {
        $summary.loadedToolsCount = [int]$Matches[1]
    }
    if ($text -match "Number of exposed tools: (\d+)") {
        $summary.exposedToolsCount = [int]$Matches[1]
    }
    $activeMatches = [regex]::Matches($text, "Active tools \((\d+)\): ([^\r\n]+)")
    if ($activeMatches.Count -gt 0) {
        $last = $activeMatches[$activeMatches.Count - 1]
        $summary.activeToolsCount = [int]$last.Groups[1].Value
        $summary.activeTools = $last.Groups[2].Value.Split(",").Trim() | Where-Object { $_ }
    }
    if ($text -match "Starting language server with language ([^\s]+)") {
        $summary.language = $Matches[1]
    }
    if ($text -match "Starting language server process via command: \[([^\r\n]+)\]") {
        $summary.languageServer = $Matches[1]
    }
    if ($text -match "Found analyzable file: ([^\r\n]+)") {
        $summary.analyzableFile = $Matches[1].Trim()
    }
    if ($text -match "GetSymbolsOverviewTool returned (\d+) symbols") {
        $summary.symbolsOverviewCount = [int]$Matches[1]
    }
    if ($text -match "FindSymbolTool found (\d+) matches") {
        $summary.findSymbolMatches = [int]$Matches[1]
    }
    if ($text -match "FindReferencingSymbolsTool found (\d+) references") {
        $summary.referencingSymbolMatches = [int]$Matches[1]
    }
    if ($text -match "SearchForPatternTool found (\d+) pattern matches") {
        $summary.patternMatches = [int]$Matches[1]
    }
    $summary.completedSuccessfully = ($text -match "Health check completed successfully")

    return $summary
}

$repoRootFull = Resolve-RepoRoot -Path $RepoRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRootFull "reports\serena-background\capability.json"
} elseif (![System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $repoRootFull $OutputPath
}

$cliPath = $null
$cliFound = $false
$healthExitCode = $null
$healthOutput = @()
$healthError = $null

try {
    $command = Get-Command serena -ErrorAction Stop
    $cliPath = $command.Source
    $cliFound = $true
} catch {
    $healthError = $_.Exception.Message
}

if ($cliFound) {
    Push-Location $repoRootFull
    try {
        $healthOutput = @(& serena project health-check 2>&1)
        $healthExitCode = $LASTEXITCODE
    } catch {
        $healthExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 1 }
        $healthOutput = @($_.Exception.Message)
        $healthError = $_.Exception.Message
    } finally {
        Pop-Location
    }
}

$latestLog = Get-LatestHealthLog -Root $repoRootFull
$healthSummary = if ($latestLog) { Parse-HealthLog -Path $latestLog.FullName } else { Parse-HealthLog -Path $null }
$success = $cliFound -and ($healthExitCode -eq 0) -and [bool]$healthSummary.completedSuccessfully

$report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    repoRoot = $repoRootFull
    success = $success
    serenaCliFound = $cliFound
    serenaCliPath = $cliPath
    healthCheckExitCode = $healthExitCode
    healthCheckOutputTail = @($healthOutput | Select-Object -Last 20)
    error = $healthError
    health = $healthSummary
}

Write-Utf8Json -Path $OutputPath -Value $report
$report | ConvertTo-Json -Depth 12

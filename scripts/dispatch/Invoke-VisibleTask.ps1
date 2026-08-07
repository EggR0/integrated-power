[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CommandLine,
    
    [string]$Name = "AI Worker"
)

$ErrorActionPreference = "Stop"

try {
    $repoRoot = (& git rev-parse --show-toplevel 2>$null)
    if ($repoRoot) {
        $repoRoot = $repoRoot.Trim()
    } else {
        $repoRoot = (Get-Location).Path
    }
} catch {
    $repoRoot = (Get-Location).Path
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $scriptDir "..\util\GlobalStorage.psm1") -DisableNameChecking
$globalStorage = Get-GlobalStorage -RepoRoot $repoRoot

$reportsDir = Join-Path $globalStorage "reports"
if (-not (Test-Path $reportsDir)) {
    New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
}

$queueFile = Join-Path $reportsDir "terminal-queue.json"

# Read existing commands or start new array
$commands = @()
if (Test-Path $queueFile) {
    try {
        $content = Get-Content $queueFile -Raw -ErrorAction SilentlyContinue
        if (![string]::IsNullOrWhiteSpace($content)) {
            $parsed = $content | ConvertFrom-Json
            if ($parsed -is [array]) {
                $commands = $parsed
            } else {
                $commands = @($parsed)
            }
        }
    } catch {
        throw "Failed to parse existing queue file ($queueFile). The file may be corrupted. Error: $($_.Exception.Message)"
    }
}

# Append new command
$newCmd = @{
    name = $Name
    command = $CommandLine
}
$commands += $newCmd

# Write back
$json = $commands | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($queueFile, $json, $utf8NoBom)

Write-Host "Queued visible task for IDE terminal: $Name"

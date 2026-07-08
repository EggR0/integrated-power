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

$agentsDir = Join-Path $repoRoot ".agents"
if (-not (Test-Path $agentsDir)) {
    New-Item -ItemType Directory -Force -Path $agentsDir | Out-Null
}

$queueFile = Join-Path $agentsDir "terminal-queue.json"

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
        # ignore parse errors, start fresh
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
[IO.File]::WriteAllText($queueFile, $json)

Write-Host "Queued visible task for IDE terminal: $Name"

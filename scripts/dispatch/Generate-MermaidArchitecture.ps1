[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            $RepoRoot = ($gitRoot | Select-Object -First 1).Trim()
        }
    } catch {}
    if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
        $RepoRoot = (Get-Location).Path
    }
}

$repoRootFull = [System.IO.Path]::GetFullPath($RepoRoot)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $scriptDir "..\util\GlobalStorage.psm1") -DisableNameChecking
$globalStorage = Get-GlobalStorage -RepoRoot $repoRootFull

$contextManifestPath = Join-Path $globalStorage 'reports\serena-background\context_manifest.json'

if (!(Test-Path -LiteralPath $contextManifestPath)) {
    Write-Warning 'context_manifest.json not found. Cannot generate architecture map.'
    return
}

$context = Get-Content -Raw -Encoding UTF8 -LiteralPath $contextManifestPath | ConvertFrom-Json

$diagram = @()
$diagram += '```mermaid'
$diagram += 'graph TD'
$diagram += '    %% Core Agentic Topology'
$diagram += '    subgraph Core [Agentic Core]'
$diagram += '        A1[Main Agent Orchestrator] --> A2{Dispatcher}'
$diagram += '    end'

# We will build dynamic nodes based on changed files
$diagram += '    subgraph Activity [Current Active Context]'
if ($context.diffManifest -and $context.diffManifest.changedFilesCount -gt 0) {
    $i = 0
    foreach ($file in $context.diffManifest.files) {
        if ($i -ge 10) { 
            $diagram += "        D_$i[... and $($context.diffManifest.changedFilesCount - 10) more]"
            break 
        }
        $safeName = $file -replace '[^a-zA-Z0-9]', '_'
        $diagram += "        D_$i[""$file""]"
        $diagram += "        A2 --> D_$i"
        $i++
    }
} else {
    $diagram += '        D_0[No active file changes]'
    $diagram += '        A2 --> D_0'
}
$diagram += '    end'

# Add some module connections if symbols are present
if ($context.powerShellSymbols -and $context.powerShellSymbols.fileCount -gt 0) {
    $diagram += '    subgraph PS [PowerShell Backend]'
    $diagram += "        PS_Total[Total PS Scripts: $($context.powerShellSymbols.fileCount)]"
    $diagram += '    end'
    $diagram += '    A2 -.-> PS_Total'
}

$diagram += '```'

$diagramText = $diagram -join [Environment]::NewLine
$outPath = Join-Path $globalStorage 'reports\serena-background\dashboard_architecture.md'

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($outPath, $diagramText, $utf8NoBom)

Write-Host "Generated $outPath"

[CmdletBinding()]
param(
    [string]$RequestedCodexExe = "",
    [switch]$PassThru,
    [switch]$SkipGlobalRules
)

$ErrorActionPreference = "Stop"

function Test-CodexCandidate {
    param([string]$Candidate)

    if ([string]::IsNullOrWhiteSpace($Candidate)) { return $null }

    $expanded = [Environment]::ExpandEnvironmentVariables($Candidate.Trim('"'))

    if ([IO.Path]::IsPathRooted($expanded)) {
        if (Test-Path -LiteralPath $expanded -PathType Leaf) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
        return $null
    }

    $command = Get-Command -Name $expanded -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($command) { return $command.Source }

    return $null
}

function Get-InteractiveInstallerPath {
    try {
        if ($PSScriptRoot) {
            $pluginRoot = [IO.Directory]::GetParent($PSScriptRoot).Parent.Parent.FullName
            $candidate = Join-Path $pluginRoot "install\Install-Plugin.ps1"
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
    } catch { }

    return Join-Path $env:USERPROFILE ".gemini\config\plugins\ai-delegation-plugin\install\Install-Plugin.ps1"
}

function Resolve-CodexExeAutomatically {
    param([string]$RequestedCodexExe)

    $requested = Test-CodexCandidate -Candidate $RequestedCodexExe
    if ($requested) { return $requested }

    foreach ($name in @("codex.exe", "codex")) {
        $fromPath = Test-CodexCandidate -Candidate $name
        if ($fromPath) { return $fromPath }
    }

    $fromEnv = Test-CodexCandidate -Candidate $env:CODEX_EXE
    if ($fromEnv) { return $fromEnv }

    if ($env:LOCALAPPDATA) {
        $roots = @(
            (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"),
            (Join-Path $env:LOCALAPPDATA "Programs\OpenAI Codex"),
            (Join-Path $env:LOCALAPPDATA "Programs\Codex")
        )

        foreach ($root in $roots) {
            if (!(Test-Path -LiteralPath $root -PathType Container)) { continue }

            $direct = Join-Path $root "codex.exe"
            $directResolved = Test-CodexCandidate -Candidate $direct
            if ($directResolved) { return $directResolved }

            $newest = Get-ChildItem -LiteralPath $root -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
                Sort-Object -Property LastWriteTime -Descending |
                Select-Object -First 1

            if ($newest) { return $newest.FullName }
        }
    }

    return $null
}

function Write-CodexSettings {
    param([Parameter(Mandatory = $true)][string]$CodexExe)

    $configDir = Join-Path $env:USERPROFILE ".gemini\config"
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    $configPath = Join-Path $configDir "codex_plugin_settings.json"
    $json = [ordered]@{ CodexExe = $CodexExe } | ConvertTo-Json -Depth 5
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    [IO.File]::WriteAllText($configPath, "$json`n", $utf8NoBom)
}

function Invoke-WithFileLock {
    param(
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock
    )

    $targetDir = Split-Path -Parent ([IO.Path]::GetFullPath($TargetPath))
    if ($targetDir) { New-Item -ItemType Directory -Force -Path $targetDir | Out-Null }

    $lockPath = "$TargetPath.lock"
    $deadline = (Get-Date).AddSeconds(20)
    $stream = $null

    while ($null -eq $stream) {
        try {
            $stream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        } catch [IO.IOException] {
            if ((Get-Date) -ge $deadline) { throw "Timed out waiting for setup lock: $lockPath" }
            Start-Sleep -Milliseconds 100
        }
    }

    try {
        & $ScriptBlock
    } finally {
        $stream.Dispose()
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-GlobalRoutingRules {
    $geminiDir = Join-Path $env:USERPROFILE ".gemini"
    New-Item -ItemType Directory -Force -Path $geminiDir | Out-Null

    $geminiMdPath = Join-Path $geminiDir "GEMINI.md"
    $marker = "AI Delegation Routing (Added by ai-delegation-plugin)"
    $oldMarker = "Codex Orchestrator Routing (Added by codex-orchestrator-plugin)"
    $ruleContent = @"

## AI Delegation Routing (Added by ai-delegation-plugin)
When a task involves architecture decisions, code review, complex implementation, large refactors, cross-model critique, or long-running work delegation, prefer the ``ai-delegation`` skill.

Use:
- Codex CLI Mode for architecture, ADRs, tradeoff analysis, and second opinions, or bounded implementation.
- Aider Mode for local Ollama-based direct file edits.
- Serena Mode for codebase indexing and read-only analysis.
- WorkWindow Mode for queue-driven or supervised long-running work.

"@

    Invoke-WithFileLock -TargetPath $geminiMdPath -ScriptBlock {
        $existing = if (Test-Path -LiteralPath $geminiMdPath -PathType Leaf) {
            Get-Content -Raw -Encoding UTF8 -LiteralPath $geminiMdPath
        } else {
            ""
        }

        $needsUpdate = $false

        # Remove old rule block if it exists
        if ($existing.Contains($oldMarker)) {
            $pattern = "(?s)## Codex Orchestrator Routing.*?(?=\n## |\Z)"
            $existing = $existing -replace $pattern, ""
            $needsUpdate = $true
        }

        # Check if new rule is already present
        if (!$existing.Contains($marker)) {
            $prefix = if ($existing.Length -gt 0 -and !$existing.EndsWith("`n")) { "`r`n" } else { "" }
            $existing = $existing + $prefix + $ruleContent
            $needsUpdate = $true
        }

        if ($needsUpdate) {
            if (Test-Path -LiteralPath $geminiMdPath -PathType Leaf) {
                $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
                Copy-Item -LiteralPath $geminiMdPath -Destination "$geminiMdPath.backup-$stamp" -Force
            }

            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [IO.File]::WriteAllText($geminiMdPath, $existing, $utf8NoBom)
        }
    }
}

$codexExe = Resolve-CodexExeAutomatically -RequestedCodexExe $RequestedCodexExe

if (!$codexExe) {
    $installerPath = Get-InteractiveInstallerPath
    throw "Unable to resolve codex.exe automatically. Run the interactive installer: powershell -NoProfile -ExecutionPolicy Bypass -File `"$installerPath`""
}

Write-CodexSettings -CodexExe $codexExe

if (!$SkipGlobalRules) {
    Ensure-GlobalRoutingRules
}

if ($PassThru) {
    $codexExe
}

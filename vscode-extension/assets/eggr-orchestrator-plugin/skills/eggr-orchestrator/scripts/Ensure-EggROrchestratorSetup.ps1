[CmdletBinding()]
param(
    [string]$RequestedCodexExe = "",
    [switch]$PassThru
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

    return Join-Path $env:USERPROFILE ".gemini\config\plugins\eggr-orchestrator-plugin\install\Install-Plugin.ps1"
}

function Resolve-CodexExeAutomatically {
    param([string]$RequestedCodexExe)

    $requested = Test-CodexCandidate -Candidate $RequestedCodexExe
    if ($requested) { return $requested }

    $settingsPath = if (-not [string]::IsNullOrWhiteSpace($env:EGGR_ORCHESTRATOR_SETTINGS)) {
        [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($env:EGGR_ORCHESTRATOR_SETTINGS))
    } else {
        Join-Path $env:USERPROFILE ".config\eggr\orchestrator.json"
    }
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
        $legacySettingsPath = Join-Path $env:USERPROFILE ".gemini\config\codex_plugin_settings.json"
        if (Test-Path -LiteralPath $legacySettingsPath -PathType Leaf) {
            $settingsPath = $legacySettingsPath
        }
    }
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        try {
            $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $fromSettings = Test-CodexCandidate -Candidate ([string]$settings.CodexExe)
            if ($fromSettings) { return $fromSettings }
        } catch {
            # A malformed optional settings file must not block other resolution routes.
        }
    }

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

$codexExe = Resolve-CodexExeAutomatically -RequestedCodexExe $RequestedCodexExe

if (!$codexExe) {
    $installerPath = Get-InteractiveInstallerPath
    throw "Unable to resolve codex.exe automatically. Run the interactive installer: powershell -NoProfile -ExecutionPolicy Bypass -File `"$installerPath`""
}

if ($PassThru) {
    $codexExe
}

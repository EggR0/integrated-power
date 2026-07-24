param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [string]$OutputFile = "",

    [ValidateSet("read-only", "workspace-write", "danger-full-access")]
    [string]$Sandbox = "read-only",

    [string]$Model = "gpt-5.5",

    [ValidateSet("minimal", "low", "medium", "high", "xhigh")]
    [string]$ReasoningEffort = "high",

    [string]$CodexExe = "",

    [switch]$JsonLog
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($repoRoot) { $repoRoot = ($repoRoot | Select-Object -First 1).Trim() }
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking

function Resolve-CodexExe {
    param([string]$RequestedCodexExe)

    $candidates = @()
    if (![string]::IsNullOrWhiteSpace($RequestedCodexExe)) {
        $candidates += $RequestedCodexExe
    }
    if (![string]::IsNullOrWhiteSpace($env:CODEX_EXE)) {
        $candidates += $env:CODEX_EXE
    }

    foreach ($name in @("codex.exe", "codex")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command -and $command.Source) {
            $candidates += $command.Source
        }
    }

    if (![string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $codexBinRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
        if (Test-Path -LiteralPath $codexBinRoot) {
            $newest = Get-ChildItem -LiteralPath $codexBinRoot -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
            if ($newest) {
                $candidates += $newest.FullName
            }
        }
    }

    foreach ($candidate in $candidates) {
        if (![string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "Codex executable not found. Set -CodexExe or CODEX_EXE, or install codex.exe on PATH."
}

$codexExePath = Resolve-CodexExe -RequestedCodexExe $CodexExe

$promptPath = Resolve-Path -LiteralPath $PromptFile
$prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputFile = Join-Path (Get-GlobalStorage -RepoRoot $repoRoot) "reports/codex-$stamp.md"
}

$outputPath = if ([System.IO.Path]::IsPathRooted($OutputFile)) {
    $OutputFile
} else {
    Join-Path $repoRoot $OutputFile
}

$outputDir = Split-Path -Parent $outputPath
if (![string]::IsNullOrWhiteSpace($outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$arguments = @(
    "exec",
    "--cd", $repoRoot,
    "--sandbox", $Sandbox,
    "--model", $Model,
    "-c", "model_reasoning_effort=`"$ReasoningEffort`"",
    "--output-last-message", $outputPath
)

if ($JsonLog) {
    $logPath = [System.IO.Path]::ChangeExtension($outputPath, ".jsonl")
    $arguments += "--json"
    $arguments += "-"
    $prompt | & $codexExePath @arguments | Tee-Object -FilePath $logPath
    $codexExitCode = $LASTEXITCODE
    if ($codexExitCode -ne 0) {
        throw "Codex failed with exit code $codexExitCode. Log: $logPath"
    }

    $usageParser = Join-Path $repoRoot "scripts\metrics\Parse-CodexUsage.ps1"
    if (Test-Path -LiteralPath $usageParser) {
        & $usageParser -JsonlPath $logPath -OperationName (Split-Path -Leaf $PromptFile) -Model $Model | Out-Null
    }
} else {
    $arguments += "-"
    $prompt | & $codexExePath @arguments
    $codexExitCode = $LASTEXITCODE
    if ($codexExitCode -ne 0) {
        throw "Codex failed with exit code $codexExitCode."
    }
}

Write-Host "Codex final message: $outputPath"


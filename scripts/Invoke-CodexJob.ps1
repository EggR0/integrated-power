param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [string]$OutputFile = "",

    [ValidateSet("read-only", "workspace-write", "danger-full-access")]
    [string]$Sandbox = "read-only",

    [string]$Model = "gpt-5.5",

    [ValidateSet("minimal", "low", "medium", "high", "xhigh")]
    [string]$ReasoningEffort = "high",

    [switch]$JsonLog
)

$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel).Trim()
$codexExe = "C:\Users\jsp0\AppData\Local\OpenAI\Codex\bin\38dff8711e296435\codex.exe"

if (!(Test-Path -LiteralPath $codexExe)) {
    throw "Codex executable not found: $codexExe"
}

$promptPath = Resolve-Path -LiteralPath $PromptFile
$prompt = Get-Content -Raw -LiteralPath $promptPath

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputFile = Join-Path $repoRoot "reports/codex-$stamp.md"
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
    $prompt | & $codexExe @arguments | Tee-Object -FilePath $logPath
} else {
    $arguments += "-"
    $prompt | & $codexExe @arguments
}

Write-Host "Codex final message: $outputPath"


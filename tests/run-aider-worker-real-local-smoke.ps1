param(
    [string]$Model = "qwen2.5-coder:32b",
    [int]$TimeoutSeconds = 600,
    [switch]$SkipIfUnavailable
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}

function Test-OllamaModelAvailable {
    param([string]$ModelName)
    try {
        $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
        return @($tags.models | ForEach-Object { $_.name }) -contains $ModelName
    }
    catch {
        return $false
    }
}

$hasAider = $false
try {
    if (Get-Command aider -ErrorAction SilentlyContinue) {
        $hasAider = $true
    }
    elseif (Get-Command uvx -ErrorAction SilentlyContinue) {
        $hasAider = $true
    }
}
catch {
    $hasAider = $false
}

$hasModel = Test-OllamaModelAvailable -ModelName $Model
if (!$hasAider -or !$hasModel) {
    $message = "Aider local smoke prerequisites missing. hasAider=$hasAider hasModel=$hasModel model=$Model"
    if ($SkipIfUnavailable) {
        "SKIP: $message"
        exit 0
    }
    throw $message
}

$testRoot = Join-Path $repoRoot "tests\aider_worker_real_local_smoke"
$targetFile = Join-Path $testRoot "target.ps1"
$artifactDir = Join-Path $repoRoot "reports\aider-worker-runs\real-local-smoke"
New-Item -ItemType Directory -Force -Path $testRoot, $artifactDir | Out-Null

Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$status = "old"'

$escapedTarget = $targetFile.Replace("'", "''")
$validationCommand = "if ((Get-Content -LiteralPath '$escapedTarget' -Raw) -match 'ready') { exit 0 } else { Write-Error 'expected ready'; exit 1 }"

$prompt = @"
Edit the provided PowerShell file only.
Change the exact line:
`$status = "old"
to:
`$status = "ready"
Do not change anything else.
"@

$result = & (Join-Path $repoRoot "scripts\dispatch\Invoke-AiderWorker.ps1") `
    -Prompt $prompt `
    -Files @($targetFile) `
    -Model $Model `
    -EditFormat "whole" `
    -TimeoutSeconds $TimeoutSeconds `
    -ValidatorProfile "syntax_and_command" `
    -ValidationCommand $validationCommand `
    -ValidationTimeoutSeconds 30 `
    -KeepArtifacts `
    -ArtifactDir $artifactDir | ConvertFrom-Json

$content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
if ($content -notmatch 'ready') {
    throw "Aider real local smoke did not update the target file. Output log: $($result.OutputLog)"
}

"PASS: aider worker real local smoke"

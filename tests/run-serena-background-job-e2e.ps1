param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$scriptPath = Join-Path $repoRoot "scripts\dispatch\Invoke-SerenaBackgroundJob.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Once -SkipLocalLlm -MaxFiles 120 | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "Invoke-SerenaBackgroundJob.ps1 exited with code $LASTEXITCODE"
}

$manifestPath = Join-Path $repoRoot "reports\serena-background\latest-manifest.json"
$repoMapPath = Join-Path $repoRoot "reports\serena-background\repo-map.md"
$routingHintsPath = Join-Path $repoRoot "reports\serena-background\routing-hints.json"

foreach ($path in @($manifestPath, $repoMapPath, $routingHintsPath)) {
    if (!(Test-Path -LiteralPath $path)) {
        throw "Expected artifact missing: $path"
    }
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.status -ne "success") {
    throw "Manifest status was not success: $($manifest.status)"
}
if ([int]$manifest.coverage.serenaSymbolFiles -le 0) {
    throw "Expected Serena symbol files to be exported."
}
if ([int]$manifest.coverage.serenaSymbolCount -le 0) {
    throw "Expected Serena symbols to be exported."
}
if ([int]$manifest.coverage.powerShellAstFiles -le 0) {
    throw "Expected PowerShell AST files to be exported."
}
if ([int]$manifest.coverage.powerShellAstFunctions -le 0) {
    throw "Expected PowerShell AST functions to be exported."
}
if ([int]$manifest.coverage.filesIncluded -le 0) {
    throw "Expected policy files to be included."
}
if (![string]::IsNullOrWhiteSpace($manifest.artifacts.localLlmSummary)) {
    throw "Local LLM summary should be empty when -SkipLocalLlm is used."
}

$repoMap = Get-Content -Raw -Encoding UTF8 -LiteralPath $repoMapPath
foreach ($required in @("## Coverage", "## Serena Status", "## Routing Areas", "## Serena Symbol Files", "## PowerShell AST Files", "## Included File Inventory")) {
    if ($repoMap -notmatch [regex]::Escape($required)) {
        throw "Repo map missing section: $required"
    }
}
if ($repoMap -match "simulated for one-shot") {
    throw "Repo map still contains simulated-output language."
}

[pscustomobject]@{
    status = "passed"
    manifest = $manifestPath
    repoMap = $repoMapPath
    routingHints = $routingHintsPath
    serenaSymbolFiles = $manifest.coverage.serenaSymbolFiles
    serenaSymbolCount = $manifest.coverage.serenaSymbolCount
    powerShellAstFiles = $manifest.coverage.powerShellAstFiles
    powerShellAstFunctions = $manifest.coverage.powerShellAstFunctions
} | ConvertTo-Json -Depth 4

param(
    [ValidateSet("auto", "local", "google")]
    [string]$Method = "local",

    [switch]$AllAccounts,
    [switch]$AllModels,
    [switch]$Refresh,
    [string]$OutputJson = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($repoRoot) { $repoRoot = ($repoRoot | Select-Object -First 1).Trim() }
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

if ([string]::IsNullOrWhiteSpace($OutputJson)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputJson = Join-Path $storagePath "reports\antigravity-quota-$stamp.json"
}

$args = @("-y", "antigravity-usage", "quota", "--method", $Method, "--json")
if ($AllAccounts) { $args += "--all" }
if ($AllModels) { $args += "--all-models" }
if ($Refresh) { $args += "--refresh" }

$outputDir = Split-Path -Parent $OutputJson
if (![string]::IsNullOrWhiteSpace($outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

# This uses a third-party CLI. Review docs/reference/token-measurement.md before running.
$json = & npx @args 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "antigravity-usage failed: $json"
}

$json | Out-File -LiteralPath $OutputJson -Encoding UTF8
Write-Host "Antigravity quota JSON written to $OutputJson"


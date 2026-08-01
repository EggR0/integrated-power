[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Assertion failed: $Message" }
}

$skillRoot = Split-Path -Parent $PSScriptRoot
$ensureScript = Join-Path $skillRoot "scripts\Ensure-IpOrchestratorSetup.ps1"
$pluginRoot = [IO.Directory]::GetParent($skillRoot).Parent.FullName
$installerScript = Join-Path $pluginRoot "install\Install-Plugin.ps1"
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("ip-onboarding-test-{0}" -f [Guid]::NewGuid().ToString("N"))
$legacyPath = Join-Path $scratch "legacy\orchestrator.json"
$canonicalPath = Join-Path $scratch "canonical\orchestrator.json"
$savedCanonicalEnvironment = $env:INTEGRATED_POWER_ORCHESTRATOR_SETTINGS
$savedLegacyEnvironment = $env:EGGR_ORCHESTRATOR_SETTINGS

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $legacyPath) -Force | Out-Null
    $legacyDocument = [ordered]@{
        SchemaVersion = 1
        EnabledRoutes = @("main_agent", "local_llm")
        DefaultRoute = "local_llm"
        LocalLlm = [ordered]@{
            Endpoint = "http://127.0.0.1:11434"
            Model = "gemma4:26b"
            CustomLocalValue = "preserve-local"
        }
        CustomUserValue = "preserve-root"
    }
    $legacyJson = $legacyDocument | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($legacyPath, "$legacyJson`n", (New-Object Text.UTF8Encoding($false)))
    $legacyBefore = Get-Content -LiteralPath $legacyPath -Raw -Encoding UTF8
    $env:INTEGRATED_POWER_ORCHESTRATOR_SETTINGS = $canonicalPath
    $env:EGGR_ORCHESTRATOR_SETTINGS = $legacyPath

    & $ensureScript
    Assert-True (Test-Path -LiteralPath $canonicalPath -PathType Leaf) "Ensure must create the canonical settings file."
    $ensured = Get-Content -LiteralPath $canonicalPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($ensured.SchemaVersion -eq 2) "Ensure must upgrade SchemaVersion."
    Assert-True ($ensured.LocalLlm.Provider -eq "ollama") "Ensure must infer the Ollama provider."
    Assert-True ($ensured.LocalLlm.HardwarePolicy.Mode -eq "user_default") "A named legacy model must become user_default."
    Assert-True ($ensured.LocalLlm.HardwarePolicy.ReserveVramGB -eq 2) "Ensure must add the default VRAM reserve."
    Assert-True ($ensured.LocalLlm.CustomLocalValue -eq "preserve-local") "Ensure must preserve unknown LocalLlm values."
    Assert-True ($ensured.CustomUserValue -eq "preserve-root") "Ensure must preserve unknown root values."
    Assert-True (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $canonicalPath) "local_llm_model_registry.csv") -PathType Leaf) "Ensure must synchronize the user registry for Ollama."
    Assert-True ((Get-Content -LiteralPath $legacyPath -Raw -Encoding UTF8) -eq $legacyBefore) "Ensure must not alter the legacy source."

    $firstCanonical = Get-Content -LiteralPath $canonicalPath -Raw -Encoding UTF8
    & $ensureScript
    Assert-True ((Get-Content -LiteralPath $canonicalPath -Raw -Encoding UTF8) -eq $firstCanonical) "Ensure must be idempotent after migration."

    Remove-Item -LiteralPath $canonicalPath -Force
    & $installerScript -NonInteractive -SettingsPath $canonicalPath
    $installed = Get-Content -LiteralPath $canonicalPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($installed.SchemaVersion -eq 2) "Installer must write SchemaVersion 2."
    Assert-True ($installed.LocalLlm.Provider -eq "ollama") "Installer must preserve/infer the legacy provider."
    Assert-True ($installed.LocalLlm.HardwarePolicy.Mode -eq "user_default") "Installer must supplement HardwarePolicy."
    Assert-True ($installed.LocalLlm.CustomLocalValue -eq "preserve-local") "Installer must preserve LocalLlm user data."
    Assert-True ($installed.CustomUserValue -eq "preserve-root") "Installer must preserve root user data."
    Assert-True ((Get-Content -LiteralPath $legacyPath -Raw -Encoding UTF8) -eq $legacyBefore) "Installer must not alter the legacy source."

    Write-Host "PASS: canonical onboarding migration and normalization" -ForegroundColor Green
} finally {
    if ($null -eq $savedCanonicalEnvironment) { Remove-Item Env:INTEGRATED_POWER_ORCHESTRATOR_SETTINGS -ErrorAction SilentlyContinue }
    else { $env:INTEGRATED_POWER_ORCHESTRATOR_SETTINGS = $savedCanonicalEnvironment }
    if ($null -eq $savedLegacyEnvironment) { Remove-Item Env:EGGR_ORCHESTRATOR_SETTINGS -ErrorAction SilentlyContinue }
    else { $env:EGGR_ORCHESTRATOR_SETTINGS = $savedLegacyEnvironment }
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}

$selector = Join-Path $repoRoot "scripts\dispatch\Select-AgenticValidator.ps1"
$bridge = Join-Path $repoRoot "scripts\dispatch\Invoke-DelegatedAgentTask.ps1"
$decisionLog = Join-Path $repoRoot "tests\agentic_validator_selector_e2e\delegation-decisions.csv"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $decisionLog) | Out-Null
Remove-Item -LiteralPath $decisionLog -ErrorAction SilentlyContinue

$psResult = & $selector `
    -TargetFile ".\scripts\dispatch\Invoke-AgenticLoop.ps1" `
    -AsJson | ConvertFrom-Json

if ($psResult.ValidatorProfile -ne "syntax") {
    throw "Expected PowerShell file to use syntax profile, got $($psResult.ValidatorProfile)."
}
if (![string]::IsNullOrWhiteSpace($psResult.ValidationCommand)) {
    throw "PowerShell syntax-only selector should not emit a validation command."
}
if ($psResult.Source -ne "registry:scripts/**/*.ps1") {
    throw "Expected registry:scripts/**/*.ps1 source, got $($psResult.Source)."
}

$compileResult = & $selector `
    -TargetFile ".\vscode-extension\package.json" `
    -AsJson | ConvertFrom-Json

if ($compileResult.ValidatorProfile -ne "syntax_and_command") {
    throw "Expected VS Code extension file to use syntax_and_command profile, got $($compileResult.ValidatorProfile)."
}
if ($compileResult.ValidationCommand -notmatch "npm run compile") {
    throw "Expected compile validation command, got: $($compileResult.ValidationCommand)"
}
if ($compileResult.Source -ne "registry:vscode-extension/*") {
    throw "Expected registry:vscode-extension/* source, got $($compileResult.Source)."
}

$strictResult = & $selector `
    -TargetFile ".\vscode-extension\package.json" `
    -Strict `
    -AsJson | ConvertFrom-Json

if ($strictResult.ValidationCommand -notmatch "npm run test") {
    throw "Strict validator should prefer npm run test when available, got: $($strictResult.ValidationCommand)"
}

$dryRun = & $bridge `
    -Prompt "Dry run auto validator selection" `
    -TargetFile ".\vscode-extension\package.json" `
    -Files ".\vscode-extension\package.json" `
    -EstimatedChangedLines 20 `
    -PreferCloudTokenConservation `
    -ValidatorProfile auto `
    -DryRun `
    -DecisionLogFile $decisionLog | ConvertFrom-Json

if ($dryRun.ValidatorProfile -ne "syntax_and_command") {
    throw "Bridge auto validator should resolve to syntax_and_command, got $($dryRun.ValidatorProfile)."
}
if ($dryRun.ValidationCommand -notmatch "npm run compile") {
    throw "Bridge auto validator did not pass compile command."
}

$rows = @(Import-Csv -LiteralPath $decisionLog)
if ($rows.Count -ne 1) {
    throw "Expected one decision log row, got $($rows.Count)."
}
if ($rows[0].ValidatorSource -ne "registry:vscode-extension/*") {
    throw "Decision log did not record validator source."
}

"PASS: agentic validator selector E2E"

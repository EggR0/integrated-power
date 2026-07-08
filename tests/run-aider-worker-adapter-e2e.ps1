$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}

$testRoot = Join-Path $repoRoot "tests\aider_worker_adapter_e2e"
$targetFile = Join-Path $testRoot "target.ps1"
$fakePs1 = Join-Path $testRoot "fake-aider.ps1"
$fakeCmd = Join-Path $testRoot "fake-aider.cmd"
$artifactDir = Join-Path $testRoot "artifacts"
$decisionLog = Join-Path $testRoot "delegation-decisions.csv"

New-Item -ItemType Directory -Force -Path $testRoot, $artifactDir | Out-Null
Remove-Item -LiteralPath $decisionLog -ErrorAction SilentlyContinue

Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'

@'
param([string[]]$AiderArgs)

$files = @($AiderArgs | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
foreach ($file in $files) {
    $content = Get-Content -LiteralPath $file -Raw -Encoding UTF8
    $content = $content.Replace('$value = "old"', '$value = "new"')
    Set-Content -LiteralPath $file -Encoding UTF8 -NoNewline -Value $content
}

"fake aider edited $($files.Count) file(s)"
'@ | Set-Content -LiteralPath $fakePs1 -Encoding UTF8

$escapedFakePs1 = $fakePs1.Replace("%", "%%")
Set-Content -LiteralPath $fakeCmd -Encoding ASCII -Value "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$escapedFakePs1`" %*`r`n"

$escapedTarget = $targetFile.Replace("'", "''")
$validationCommand = "if ((Get-Content -LiteralPath '$escapedTarget' -Raw) -match 'new') { exit 0 } else { exit 1 }"

$wrapperOutput = & (Join-Path $repoRoot "scripts\dispatch\Invoke-AiderWorker.ps1") `
    -Prompt "Change old to new." `
    -Files @($targetFile) `
    -Model "qwen2.5-coder:32b" `
    -AiderExecutable $fakeCmd `
    -ValidatorProfile "syntax_and_command" `
    -ValidationCommand $validationCommand `
    -ValidationTimeoutSeconds 10 `
    -KeepArtifacts `
    -ArtifactDir (Join-Path $artifactDir "wrapper") | ConvertFrom-Json

if (!$wrapperOutput.Success) {
    throw "Expected wrapper success."
}
$content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
if ($content -notmatch 'new') {
    throw "Aider wrapper did not apply fake aider edit."
}
if (!(Test-Path -LiteralPath $wrapperOutput.OutputLog)) {
    throw "Aider wrapper did not produce output log."
}

Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'

$bridgeOutput = & (Join-Path $repoRoot "scripts\dispatch\Invoke-DelegatedAgentTask.ps1") `
    -Prompt "Change old to new through bridge." `
    -TargetFile $targetFile `
    -Files @($targetFile) `
    -EstimatedChangedLines 20 `
    -PreferCloudTokenConservation `
    -WorkerBackend Aider `
    -AiderExecutable $fakeCmd `
    -ValidatorProfile "syntax_and_command" `
    -ValidationCommand $validationCommand `
    -ValidationTimeoutSeconds 10 `
    -KeepArtifacts `
    -ArtifactDir (Join-Path $artifactDir "bridge") `
    -DecisionLogFile $decisionLog | ConvertFrom-Json

if ($bridgeOutput.Backend -ne "aider") {
    throw "Expected bridge to execute Aider backend."
}
$content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
if ($content -notmatch 'new') {
    throw "Aider bridge did not apply fake aider edit."
}

$rows = @(Import-Csv -LiteralPath $decisionLog)
if ($rows.Count -ne 1) {
    throw "Expected one delegation decision row, got $($rows.Count)."
}
if ($rows[0].ExecutionMode -ne "AiderWorker" -or $rows[0].WorkerBackend -ne "Aider") {
    throw "Decision log did not record AiderWorker execution."
}

Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'
Remove-Item -LiteralPath $decisionLog -ErrorAction SilentlyContinue

$autoOutput = & (Join-Path $repoRoot "scripts\dispatch\Invoke-DelegatedAgentTask.ps1") `
    -Prompt "Change old to new through auto backend." `
    -TargetFile $targetFile `
    -Files @($targetFile) `
    -EstimatedChangedLines 80 `
    -PreferCloudTokenConservation `
    -WorkerBackend Auto `
    -AiderExecutable $fakeCmd `
    -ValidatorProfile "syntax_and_command" `
    -ValidationCommand $validationCommand `
    -ValidationTimeoutSeconds 10 `
    -KeepArtifacts `
    -ArtifactDir (Join-Path $artifactDir "auto") `
    -DecisionLogFile $decisionLog | ConvertFrom-Json

if ($autoOutput.Backend -ne "aider") {
    throw "Expected auto backend to execute Aider."
}
$content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
if ($content -notmatch 'new') {
    throw "Aider auto backend did not apply fake aider edit."
}

$rows = @(Import-Csv -LiteralPath $decisionLog)
if ($rows.Count -ne 1) {
    throw "Expected one auto delegation decision row, got $($rows.Count)."
}
if ($rows[0].RequestedWorkerBackend -ne "Auto" -or $rows[0].WorkerBackend -ne "Aider" -or $rows[0].ExecutionMode -ne "AiderWorker") {
    throw "Decision log did not record Auto -> AiderWorker routing."
}

Set-Content -LiteralPath $targetFile -Encoding UTF8 -Value '$value = "old"'
Remove-Item -LiteralPath $decisionLog -ErrorAction SilentlyContinue

$promptFile = Join-Path $testRoot "prompt-file.md"
$filesListFile = Join-Path $testRoot "files-list.txt"
Set-Content -LiteralPath $promptFile -Encoding UTF8 -Value "Change old to new through prompt/list files."
Set-Content -LiteralPath $filesListFile -Encoding UTF8 -Value $targetFile

$fileListOutput = & (Join-Path $repoRoot "scripts\dispatch\Invoke-DelegatedAgentTask.ps1") `
    -PromptFile $promptFile `
    -FilesListFile $filesListFile `
    -TargetFile $targetFile `
    -EstimatedChangedLines 80 `
    -PreferCloudTokenConservation `
    -RequiresFileWrite `
    -WorkerBackend Auto `
    -AiderExecutable $fakeCmd `
    -ValidatorProfile "syntax_and_command" `
    -ValidationCommand $validationCommand `
    -ValidationTimeoutSeconds 10 `
    -KeepArtifacts `
    -ArtifactDir (Join-Path $artifactDir "file-list") `
    -DecisionLogFile $decisionLog | ConvertFrom-Json

if ($fileListOutput.Backend -ne "aider") {
    throw "Expected PromptFile/FilesListFile invocation to execute Aider."
}
$content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
if ($content -notmatch 'new') {
    throw "PromptFile/FilesListFile invocation did not apply fake aider edit."
}

$rows = @(Import-Csv -LiteralPath $decisionLog)
if ($rows.Count -ne 1 -or $rows[0].ExecutionMode -ne "AiderWorker") {
    throw "Decision log did not record PromptFile/FilesListFile Aider execution."
}

Remove-Item -LiteralPath $decisionLog -ErrorAction SilentlyContinue
$destructiveDryRun = & (Join-Path $repoRoot "scripts\dispatch\Invoke-DelegatedAgentTask.ps1") `
    -Prompt "Delete this file after editing." `
    -TargetFile $targetFile `
    -Files $targetFile `
    -EstimatedChangedLines 80 `
    -PreferCloudTokenConservation `
    -RequiresFileWrite `
    -WorkerBackend Auto `
    -AiderExecutable $fakeCmd `
    -DryRun `
    -DecisionLogFile $decisionLog | ConvertFrom-Json

if ($destructiveDryRun.ExecutionMode -ne "ManualReviewRequired" -or $destructiveDryRun.DestructiveIntent -ne $true) {
    throw "Expected destructive local worker task to require manual review."
}

$rows = @(Import-Csv -LiteralPath $decisionLog)
if ($rows.Count -ne 1 -or $rows[0].ExecutionMode -ne "ManualReviewRequired" -or $rows[0].DestructiveIntent -ne "True") {
    throw "Decision log did not record destructive ManualReviewRequired gate."
}

$missingAider = Join-Path $testRoot "missing-aider.cmd"
Remove-Item -LiteralPath $decisionLog -ErrorAction SilentlyContinue

$fallbackDryRun = & (Join-Path $repoRoot "scripts\dispatch\Invoke-DelegatedAgentTask.ps1") `
    -Prompt "Dry run auto backend fallback." `
    -TargetFile $targetFile `
    -Files @($targetFile) `
    -EstimatedChangedLines 80 `
    -PreferCloudTokenConservation `
    -WorkerBackend Auto `
    -AiderExecutable $missingAider `
    -DryRun `
    -DecisionLogFile $decisionLog | ConvertFrom-Json

if ($fallbackDryRun.WorkerBackend -ne "AgenticLoop" -or $fallbackDryRun.ExecutionMode -ne "ManualReviewRequired") {
    throw "Expected unsafe Auto -> Aider unavailable case to require manual review instead of AgenticLoop fallback."
}
if ($fallbackDryRun.AiderAvailable -ne $false) {
    throw "Expected fallback dry-run to report AiderAvailable=false."
}
if ($fallbackDryRun.AutoAiderFallbackBlocked -ne $true) {
    throw "Expected fallback dry-run to report AutoAiderFallbackBlocked=true."
}

$rows = @(Import-Csv -LiteralPath $decisionLog)
if ($rows.Count -ne 1) {
    throw "Expected one blocked fallback decision row, got $($rows.Count)."
}
if ($rows[0].RequestedWorkerBackend -ne "Auto" -or $rows[0].WorkerBackend -ne "AgenticLoop" -or $rows[0].ExecutionMode -ne "ManualReviewRequired" -or $rows[0].AutoAiderFallbackBlocked -ne "True") {
    throw "Decision log did not record blocked unsafe Auto fallback."
}

Remove-Item -LiteralPath $decisionLog -ErrorAction SilentlyContinue

$allowedFallbackDryRun = & (Join-Path $repoRoot "scripts\dispatch\Invoke-DelegatedAgentTask.ps1") `
    -Prompt "Dry run explicitly allowed auto backend fallback." `
    -TargetFile $targetFile `
    -Files @($targetFile) `
    -EstimatedChangedLines 80 `
    -PreferCloudTokenConservation `
    -WorkerBackend Auto `
    -AiderExecutable $missingAider `
    -AllowAgenticLoopFallback `
    -DryRun `
    -DecisionLogFile $decisionLog | ConvertFrom-Json

if ($allowedFallbackDryRun.WorkerBackend -ne "AgenticLoop" -or $allowedFallbackDryRun.ExecutionMode -ne "AgenticLoop") {
    throw "Expected -AllowAgenticLoopFallback to permit Auto fallback to AgenticLoop."
}
if ($allowedFallbackDryRun.AutoAiderFallbackBlocked -ne $false) {
    throw "Allowed fallback should not report AutoAiderFallbackBlocked=true."
}

$rows = @(Import-Csv -LiteralPath $decisionLog)
if ($rows.Count -ne 1 -or $rows[0].ExecutionMode -ne "AgenticLoop" -or $rows[0].AllowAgenticLoopFallback -ne "True") {
    throw "Decision log did not record explicitly allowed AgenticLoop fallback."
}

"PASS: aider worker adapter E2E"

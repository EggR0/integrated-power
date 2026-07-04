param(
    [switch]$UseCalendar,
    [switch]$RunCodex,
    [string]$JobId = "",
    [string]$PromptFile = "prompts\dispatch\integrated-window-dispatch.md",
    [ValidateSet("read-only", "workspace-write", "danger-full-access")]
    [string]$Sandbox = "read-only",
    [string]$Model = "gpt-5.5",
    [ValidateSet("minimal", "low", "medium", "high", "xhigh")]
    [string]$ReasoningEffort = "high"
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
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

$reportsDir = Join-Path $storagePath "reports"
New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$calendarOutput = ""

if ($UseCalendar) {
    $calendarScript = Join-Path $repoRoot "scripts\schedule\Sync-Calendar.ps1"
    if (Test-Path -LiteralPath $calendarScript) {
        $calendarOutput = & $calendarScript | Out-String
        if ($calendarOutput -match "(JOB-\d+)") {
            $JobId = $matches[1]
        }
    }
}

$detectScript = Join-Path $repoRoot "scripts\scan\Detect-ActiveWork.ps1"
if (Test-Path -LiteralPath $detectScript) {
    & $detectScript | Out-Null
}

$todoScript = Join-Path $repoRoot "scripts\scan\Extract-Todos.ps1"
if (Test-Path -LiteralPath $todoScript) {
    & $todoScript | Out-Null
}

$basePromptCandidate = if ([IO.Path]::IsPathRooted($PromptFile)) { $PromptFile } else { Join-Path $repoRoot $PromptFile }
$basePromptPath = Resolve-Path -LiteralPath $basePromptCandidate
$basePrompt = Get-Content -Raw -Encoding UTF8 -LiteralPath $basePromptPath

$queuePath = Join-Path $storagePath "ai-work-queue.md"
$contextPath = Join-Path $storagePath "reports\current_context.md"
$todosPath = Join-Path $storagePath "reports\current_todos.md"

$queueText = if (Test-Path -LiteralPath $queuePath) { Get-Content -Raw -Encoding UTF8 -LiteralPath $queuePath } else { "" }
$contextText = if (Test-Path -LiteralPath $contextPath) { Get-Content -Raw -Encoding UTF8 -LiteralPath $contextPath } else { "" }
$todosText = if (Test-Path -LiteralPath $todosPath) { Get-Content -Raw -Encoding UTF8 -LiteralPath $todosPath } else { "" }

$generatedPrompt = @"
$basePrompt

## Runtime Window

- generated_at: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
- job_id_hint: $JobId
- sandbox: $Sandbox
- model: $Model
- reasoning_effort: $ReasoningEffort

## Calendar Output

```text
$calendarOutput
```

## Queue

$queueText

## Current Context

$contextText

## Current TODOs

$todosText
"@

$generatedPromptPath = Join-Path $reportsDir "window-dispatch-prompt-$stamp.md"
[System.IO.File]::WriteAllText($generatedPromptPath, $generatedPrompt, [System.Text.Encoding]::UTF8)

if (!$RunCodex) {
    Write-Host "Prepared dispatch prompt:"
    Write-Host $generatedPromptPath
    Write-Host "Run again with -RunCodex to send it to Codex CLI."
    exit 0
}

$runner = Join-Path $repoRoot "scripts\dispatch\Invoke-CodexJob.ps1"
if (!(Test-Path -LiteralPath $runner)) {
    throw "Codex runner not found: $runner"
}

$outputFile = Join-Path $reportsDir "window-dispatch-result-$stamp.md"
& $runner -PromptFile $generatedPromptPath -OutputFile $outputFile -Sandbox $Sandbox -Model $Model -ReasoningEffort $ReasoningEffort



[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Topic = "",
    [Alias("InputFile")]
    [string]$PromptFile = "",
    [Alias("AppendPrompt", "Prompt")]
    [string]$ExtraPrompt = "",
    [string]$DiscussionFile = "",
    [ValidateSet("NativeCli", "McpInstructions", "AppendMcpOutput")]
    [string]$Mode = "NativeCli",
    [string]$McpOutputFile = "",
    [ValidateSet("read-only", "workspace-write", "danger-full-access")]
    [string]$Sandbox = "read-only",
    [string]$Model = "gpt-5.5",
    [ValidateSet("minimal", "low", "medium", "high", "xhigh")]
    [string]$ReasoningEffort = "high",
    [string]$CodexExe = "",
    [int]$TimeoutSeconds = 1800,
    [switch]$NoHistory
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($CodexExe)) {
    $cmd = Get-Command "codex.exe", "codex" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) {
        $CodexExe = $cmd.Source
    } elseif (![string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $newest = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin") -Filter "codex.exe" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($newest) { $CodexExe = $newest.FullName }
    }
    if ([string]::IsNullOrWhiteSpace($CodexExe)) { $CodexExe = "codex" }
}
function Write-Utf8 {
    param([string]$Path, [string]$Text, [switch]$Append)
    $dir = Split-Path -Parent $Path
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $enc = New-Object System.Text.UTF8Encoding($false)
    if ($Append) {
        [IO.File]::AppendAllText($Path, $Text, $enc)
    } else {
        [IO.File]::WriteAllText($Path, $Text, $enc)
    }
}

function New-Slug([string]$Text) {
    $slug = ($Text.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
    if (!$slug) { $slug = "codex-debate" }
    if ($slug.Length -gt 72) { $slug = $slug.Substring(0, 72).Trim("-") }
    return $slug
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($repoRoot) { $repoRoot = ($repoRoot | Select-Object -First 1).Trim() }
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$globalStorage = Get-GlobalStorage -RepoRoot $repoRoot
$discussionRoot = Join-Path $globalStorage "discussions"
$generatedRoot = Join-Path $globalStorage "sessions"
New-Item -ItemType Directory -Force -Path $discussionRoot, $generatedRoot | Out-Null

if ($Mode -eq "AppendMcpOutput") {
    if (!$DiscussionFile -or !$McpOutputFile) {
        throw "-DiscussionFile and -McpOutputFile are required for AppendMcpOutput."
    }
    $discussionPath = Join-Path $discussionRoot $DiscussionFile
    if ([IO.Path]::IsPathRooted($DiscussionFile)) { $discussionPath = $DiscussionFile }
    $mcpPath = if ([IO.Path]::IsPathRooted($McpOutputFile)) { $McpOutputFile } else { Join-Path $repoRoot $McpOutputFile }
    
    $mcpText = Get-Content -Raw -Encoding UTF8 -LiteralPath $mcpPath
    Write-Utf8 -Path $discussionPath -Append -Text "`r`n### Codex Response (MCP)`r`n`r`n$mcpText`r`n"
    Write-Output "Discussion updated: $discussionPath"
    return
}

if (!$Topic -and !$PromptFile -and !$ExtraPrompt) { throw "Provide -Topic, -PromptFile, or -ExtraPrompt." }

$promptFileText = ""
if ($PromptFile) {
    $promptPath = if ([IO.Path]::IsPathRooted($PromptFile)) { $PromptFile } else { Join-Path $repoRoot $PromptFile }
    $promptFileText = Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath
}

$slug = if ($Topic) { New-Slug $Topic } elseif ($PromptFile) { New-Slug ([IO.Path]::GetFileNameWithoutExtension($PromptFile)) } else { "codex-debate" }
if (!$DiscussionFile) { $DiscussionFile = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$slug.md" }
$discussionPath = if ([IO.Path]::IsPathRooted($DiscussionFile)) { $DiscussionFile } else { Join-Path $discussionRoot $DiscussionFile }

if (!(Test-Path -LiteralPath $discussionPath)) {
    Write-Utf8 -Path $discussionPath -Text "# Codex Debate: $slug`r`n`r`n"
}

$history = ""
if (!$NoHistory -and (Test-Path -LiteralPath $discussionPath)) {
    $history = Get-Content -Raw -Encoding UTF8 -LiteralPath $discussionPath
    if ($history.Length -gt 60000) { $history = $history.Substring($history.Length - 60000) }
}

$mainPrompt = @()
if ($Topic) { $mainPrompt += "Topic:`r`n$Topic" }
if ($PromptFile) { $mainPrompt += "Prompt file:`r`n$promptFileText" }
if ($ExtraPrompt) { $mainPrompt += "Additional prompt:`r`n$ExtraPrompt" }
$mainPromptText = $mainPrompt -join "`r`n`r`n"

$runDir = Join-Path $generatedRoot (Get-Date -Format "yyyyMMdd-HHmmss-fff")
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$preparedPrompt = Join-Path $runDir "prompt.md"
$responseFile = Join-Path $runDir "codex-response.md"
$stdoutLog = Join-Path $runDir "stdout.log"
$stderrLog = Join-Path $runDir "stderr.log"

$codexPrompt = @"
You are Codex participating in a transparent technical debate with the Main Agent.
Visibility contract:
- Your final answer will be appended verbatim to: $discussionPath
- Do not ask the Main Agent to retype or summarize your answer.
- Write Markdown suitable for direct user review in the IDE.
Prior discussion:
$history
Main Agent prompt:
$mainPromptText
"@

Write-Utf8 -Path $preparedPrompt -Text $codexPrompt

Write-Utf8 -Path $discussionPath -Append -Text @"
---
## Turn $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
### Main Agent Prompt
````md
$mainPromptText
````
### Codex Response
"@

if ($Mode -eq "McpInstructions") {
    Write-Utf8 -Path $discussionPath -Append -Text @"
Pending MCP handoff...
"@
    Write-Output "Prepared MCP handoff: $preparedPrompt"
    Write-Output "Discussion updated: $discussionPath"
    return
}

if (!(Test-Path -LiteralPath $CodexExe)) { throw "Codex executable not found: $CodexExe" }

$procArgs = @("exec", "--cd", "`"$repoRoot`"", "--sandbox", $Sandbox, "--model", $Model, "-c", "model_reasoning_effort=`"$ReasoningEffort`"", "--output-last-message", "`"$responseFile`"", "-")

$proc = Start-Process -FilePath $CodexExe -ArgumentList $procArgs -RedirectStandardInput $preparedPrompt -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru -NoNewWindow
$proc.WaitForExit($TimeoutSeconds * 1000) | Out-Null
if (!$proc.HasExited) {
    $proc.Kill()
    throw "Codex timed out."
}
$exitCode = if ($null -ne $proc.ExitCode) { $proc.ExitCode } else { 0 }

if ($exitCode -ne 0) {
    Write-Utf8 -Path $discussionPath -Append -Text "`r`nCodex failed with exit code $exitCode. See $stderrLog`r`n"
    throw "Codex failed with exit code $exitCode."
}

if (!(Test-Path -LiteralPath $responseFile)) {
    throw "Codex did not create the response file."
}

$response = Get-Content -Raw -Encoding UTF8 -LiteralPath $responseFile
Write-Utf8 -Path $discussionPath -Append -Text @"
$response
### Turn Metadata
- Mode: NativeCli
- Model: $Model
- Reasoning effort: $ReasoningEffort
- Sandbox: $Sandbox
- Prepared prompt: $preparedPrompt
- Captured response: $responseFile
"@

Write-Output "Discussion updated: $discussionPath"


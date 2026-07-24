param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [string]$OutputFile = "",

    [string]$Model = "gemini-3.1-pro",

    [int]$TimeoutSeconds = 1800,
    [int]$PollSeconds = 15,
    [int]$IdleTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$gitRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
    $repoRoot = ($gitRoot | Select-Object -First 1).Trim()
} else {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

$promptPath = Resolve-Path -LiteralPath $PromptFile
$prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputFile = Join-Path $storagePath "reports\antigravity-$stamp.md"
}

$outputPath = if ([System.IO.Path]::IsPathRooted($OutputFile)) { $OutputFile } else { Join-Path $repoRoot $OutputFile }
$outputDir = Split-Path -Parent $outputPath
if (![string]::IsNullOrWhiteSpace($outputDir)) { New-Item -ItemType Directory -Force -Path $outputDir | Out-Null }

$runId = [guid]::NewGuid().ToString()
$runsJsonlPath = Join-Path $storagePath ".agent-runs\runs.jsonl"
$runsJsonlDir = Split-Path -Parent $runsJsonlPath
if (![string]::IsNullOrWhiteSpace($runsJsonlDir)) { New-Item -ItemType Directory -Force -Path $runsJsonlDir | Out-Null }

# Capture quota snapshot BEFORE
$quotaBefore = 0
try {
    $npxExe = if ($IsWindows) { "npx.cmd" } else { "npx" }
    $quotaJson = & $npxExe -y antigravity-usage quota --method local --json
    $parsed = $quotaJson | ConvertFrom-Json
    $quotaBefore = $parsed.models[0].remainingPercentage
} catch { }

function Write-RunEvent {
    param([string]$Status, [int]$ExitCode = -1, [int]$ProcessId = -1, [int]$Delta = 0)
    $evt = @{
        run_id = $runId
        surface = "cli"
        provider = "antigravity"
        status = $Status
        pid = $ProcessId
        cwd = $repoRoot
        prompt_file = $PromptFile
        output_file = $OutputFile
        model = $Model
        timestamp = (Get-Date).ToString("o")
        exit_code = $ExitCode
        quota_delta_percentage = $Delta
    }
    ($evt | ConvertTo-Json -Compress) | Out-File -FilePath $runsJsonlPath -Append -Encoding UTF8
}

$logPath = [System.IO.Path]::ChangeExtension($outputPath, ".log")

$arguments = @(
    "antigravity-cli",
    "exec",
    "--model", $Model,
    "--output", "`"$outputPath`""
)

$npxPath = (Get-Command npx -ErrorAction Ignore).Source
if ([string]::IsNullOrWhiteSpace($npxPath)) {
    $npxPath = if ($IsWindows) { "npx.cmd" } else { "npx" }
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "$env:LOCALAPPDATA\agy\bin\agy.exe"
$psi.Arguments = ($arguments -join ' ')
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = $repoRoot

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi

$global:LastActivityTime = Get-Date

$action = {
    $e = $Event.SourceEventArgs
    if (![string]::IsNullOrEmpty($e.Data)) {
        [Console]::Out.WriteLine($e.Data)
        $e.Data | Out-File -FilePath $logPath -Append -Encoding UTF8
        $global:LastActivityTime = Get-Date
    }
}

$outEvent = Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -Action $action
$errEvent = Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -Action $action

$process.Start() | Out-Null
$process.BeginOutputReadLine()
$process.BeginErrorReadLine()

Write-RunEvent -Status "started" -ProcessId $process.Id

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$promptBytes = $Utf8NoBom.GetBytes($prompt)
$process.StandardInput.BaseStream.Write($promptBytes, 0, $promptBytes.Length)
$process.StandardInput.Close()

$startTime = Get-Date
$status = "running"

while (!$process.HasExited) {
    Start-Sleep -Seconds $PollSeconds
    Write-RunEvent -Status "heartbeat" -ProcessId $process.Id
    
    $now = Get-Date
    if (($now - $startTime).TotalSeconds -ge $TimeoutSeconds) {
        $status = "timeout"
        break
    }
    
    if (($now - $global:LastActivityTime).TotalSeconds -ge $IdleTimeoutSeconds) {
        $status = "aborted"
        break
    }
}

if (!$process.HasExited) {
    try { $process.Kill() } catch { }
} else {
    $status = if ($process.ExitCode -eq 0) { "completed" } else { "failed" }
}

$quotaAfter = 0
try {
    $npxExe = if ($IsWindows) { "npx.cmd" } else { "npx" }
    $quotaJson = & $npxExe -y antigravity-usage quota --method local --json
    $parsed = $quotaJson | ConvertFrom-Json
    $quotaAfter = $parsed.models[0].remainingPercentage
} catch { }

$delta = 0
if ($quotaBefore -gt 0 -and $quotaAfter -gt 0) {
    $delta = $quotaBefore - $quotaAfter
}

Write-RunEvent -Status $status -ProcessId $process.Id -ExitCode $process.ExitCode -Delta $delta

if ($status -ne "completed") {
    exit 1
}


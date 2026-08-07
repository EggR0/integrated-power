param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,

    [Parameter(Mandatory = $true)]
    [string[]]$Files,

    [string]$Model = "qwen3.6:latest",

    [string]$AiderModel = "",

    [string]$AiderExecutable = "",

    [string]$EditFormat = "",

    [int]$TimeoutSeconds = 1800,

    [int]$MaxRetries = 3,

    [ValidateSet("syntax", "syntax_and_command", "command_only", "none")]
    [string]$ValidatorProfile = "syntax",

    [string]$ValidationCommand = "",

    [int]$ValidationTimeoutSeconds = 120,

    [switch]$DryRun,

    [switch]$KeepArtifacts,

    [string]$ArtifactDir = "",

    [string]$OutputLog = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Get-RepoRoot {
    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            return ($gitRoot | Select-Object -First 1).Trim()
        }
    }
    catch {
    }

    return (Get-Location).Path
}

function Resolve-WorkspacePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    $resolved = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    }
    else {
        [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RepoRoot, $Path))
    }

    $root = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if (!$resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Aider worker file '$resolved' is outside workspace root '$root'."
    }

    return $resolved
}

function Quote-ProcessArgument {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-ValidationCommand {
    param(
        [string]$Command,
        [int]$TimeoutSeconds,
        [string]$WorkingDirectory
    )

    if ([string]::IsNullOrWhiteSpace($Command)) {
        return [pscustomobject]@{ Success = $true; ExitCode = 0; Output = ""; TimedOut = $false }
    }

    $powershellExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
    if ([string]::IsNullOrWhiteSpace($powershellExe)) {
        $powershellExe = (Get-Command powershell -ErrorAction Stop).Source
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $powershellExe
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command " + (Quote-ProcessArgument $Command)
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $process.Start() | Out-Null
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = !$process.WaitForExit([math]::Max(1, $TimeoutSeconds) * 1000)
    if ($timedOut) {
        try { $process.Kill() } catch { }
        try { $process.WaitForExit() } catch { }
    }

    $output = (($stdoutTask.Result, $stderrTask.Result) | Where-Object { ![string]::IsNullOrWhiteSpace($_) }) -join "`n"
    $exitCode = if ($timedOut) { -1 } else { $process.ExitCode }
    [pscustomobject]@{
        Success = (!$timedOut -and $exitCode -eq 0)
        ExitCode = $exitCode
        Output = $output
        TimedOut = $timedOut
    }
}

function Restore-Files {
    param([hashtable]$OriginalContents)

    foreach ($path in $OriginalContents.Keys) {
        [System.IO.File]::WriteAllText($path, $OriginalContents[$path], $utf8NoBom)
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$repoRoot = Get-RepoRoot
Import-Module (Join-Path $scriptDir "..\util\GlobalStorage.psm1") -DisableNameChecking
$globalStorage = Get-GlobalStorage -RepoRoot $repoRoot
$resolvedFiles = @($Files | ForEach-Object { Resolve-WorkspacePath -Path $_ -RepoRoot $repoRoot } | Select-Object -Unique)
if ($resolvedFiles.Count -eq 0) {
    throw "Aider worker requires at least one file."
}

foreach ($file in $resolvedFiles) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Aider worker target file does not exist: $file"
    }
}

if ([string]::IsNullOrWhiteSpace($AiderModel)) {
    $AiderModel = if ($Model -match '^(ollama|ollama_chat)/') { $Model } else { "ollama_chat/$Model" }
}

if ([string]::IsNullOrWhiteSpace($ArtifactDir)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $ArtifactDir = Join-Path (Join-Path $globalStorage "reports\aider-worker-runs") $stamp
}
elseif (![System.IO.Path]::IsPathRooted($ArtifactDir)) {
    $ArtifactDir = Join-Path $globalStorage $ArtifactDir
}

if ($KeepArtifacts -or [string]::IsNullOrWhiteSpace($OutputLog)) {
    New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
}

$promptFile = Join-Path $ArtifactDir "aider-prompt.md"
if ([string]::IsNullOrWhiteSpace($OutputLog)) {
    $OutputLog = Join-Path $ArtifactDir "aider-output.log"
}
elseif (![System.IO.Path]::IsPathRooted($OutputLog)) {
    $OutputLog = Join-Path $globalStorage $OutputLog
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputLog) | Out-Null

$exe = $AiderExecutable
if ([string]::IsNullOrWhiteSpace($exe)) {
    $cmd = Get-Command aider -ErrorAction SilentlyContinue
    if ($cmd) {
        $exe = $cmd.Source
    }
    else {
        $uvx = (Get-Command uvx -ErrorAction Stop).Source
        $exe = $uvx
    }
}

$attempt = 1
$feedback = ""
$finalOutputLog = $OutputLog

while ($attempt -le $MaxRetries) {
    $currentPromptFile = Join-Path $ArtifactDir "aider-prompt-attempt-$attempt.md"
    $currentOutputLog = Join-Path $ArtifactDir "aider-output-attempt-$attempt.log"
    
    $guardedPrompt = @"
$Prompt

Operational constraints:
- Edit only the files explicitly provided to aider for this run.
- Do not commit changes.
- Keep the patch minimal and directly related to the request.
"@
    if (![string]::IsNullOrWhiteSpace($feedback)) {
        $guardedPrompt += "`n`n=== PREVIOUS ATTEMPT FEEDBACK ===`n$feedback`nDO NOT REPEAT THE SAME MISTAKE."
    }
    [System.IO.File]::WriteAllText($currentPromptFile, $guardedPrompt, $utf8NoBom)

    $args = @()
    if ($exe -match "uvx") {
        $args += @("--from", "aider-chat", "aider")
    }

    $args += @(
        "--model", $AiderModel,
        "--message-file", $currentPromptFile,
        "--yes-always",
        "--no-auto-commits",
        "--no-dirty-commits",
        "--no-restore-chat-history",
        "--no-stream",
        "--no-pretty",
        "--no-check-update",
        "--map-tokens", "8192"
    )
    if (![string]::IsNullOrWhiteSpace($EditFormat)) {
        $args += @("--edit-format", $EditFormat)
    }
    if ($DryRun) {
        $args += "--dry-run"
    }
    $args += $resolvedFiles

    if ([string]::IsNullOrWhiteSpace($env:OLLAMA_API_BASE)) {
        $env:OLLAMA_API_BASE = "http://127.0.0.1:11434"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = (($args | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join " ")
    $psi.WorkingDirectory = $repoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.Environment["PYTHONIOENCODING"] = "utf-8"
    $psi.Environment["PYTHONUTF8"] = "1"
    $psi.Environment["NO_COLOR"] = "1"
    $psi.Environment["TERM"] = "dumb"

    Write-Host "Aider Attempt $attempt starting..." -ForegroundColor Cyan
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $process.Start() | Out-Null
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = !$process.WaitForExit([math]::Max(1, $TimeoutSeconds) * 1000)
    if ($timedOut) {
        try { $process.Kill() } catch { }
        try { $process.WaitForExit() } catch { }
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $combinedOutput = (($stdout, $stderr) | Where-Object { ![string]::IsNullOrWhiteSpace($_) }) -join "`n"
    [System.IO.File]::WriteAllText($currentOutputLog, $combinedOutput, $utf8NoBom)
    $finalOutputLog = $currentOutputLog

    $exitCode = if ($timedOut) { -1 } else { $process.ExitCode }
    if ($timedOut -or $exitCode -ne 0) {
        if (!$DryRun) { Restore-Files -OriginalContents $originalContents }
        $feedback += "`nAider worker failed with exit code $exitCode. Output log: $currentOutputLog"
        $attempt++
        continue
    }

    $aiderEditFailurePattern = '(?i)(The LLM did not conform to the edit format|SEARCH/REPLACE block failed to match|Only \d+ reflections allowed, stopping)'
    if ($combinedOutput -match $aiderEditFailurePattern) {
        if (!$DryRun) { Restore-Files -OriginalContents $originalContents }
        $feedback += "`nAider worker reported an edit-format failure. Files restored. Output log: $currentOutputLog"
        $attempt++
        continue
    }

    if (!$DryRun -and ![string]::IsNullOrWhiteSpace($ValidationCommand) -and $ValidatorProfile -ne "none") {
        Write-Host "Running validation command: $ValidationCommand" -ForegroundColor Cyan
        $validation = Invoke-ValidationCommand -Command $ValidationCommand -TimeoutSeconds $ValidationTimeoutSeconds -WorkingDirectory $repoRoot
        if (!$validation.Success) {
            Restore-Files -OriginalContents $originalContents
            $validationLog = Join-Path $ArtifactDir "validation-output-attempt-$attempt.log"
            [System.IO.File]::WriteAllText($validationLog, $validation.Output, $utf8NoBom)
            $feedback += "`nValidation failed with exit code $($validation.ExitCode). Files restored. Validation log: $validationLog`nValidation Output:`n$($validation.Output)"
            Write-Warning "Attempt $attempt validation failed."
            $attempt++
            continue
        }
        Write-Host "Validation passed!" -ForegroundColor Green
    }
    
    # Success
    break
}

if ($attempt -gt $MaxRetries) {
    throw "Aider worker failed after $MaxRetries attempts. Last log: $finalOutputLog"
}

# Copy the successful log to the expected OutputLog location
if (Test-Path -LiteralPath $finalOutputLog) {
    Copy-Item -LiteralPath $finalOutputLog -Destination $OutputLog -Force
}

[pscustomobject]@{
    Success = $true
    Backend = "aider"
    Model = $AiderModel
    Files = $resolvedFiles
    DryRun = $DryRun.IsPresent
    OutputLog = $OutputLog
    ArtifactDir = $ArtifactDir
} | ConvertTo-Json -Depth 6

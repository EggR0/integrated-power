param(
    [Parameter(Mandatory = $false)]
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($repoRoot) { $repoRoot = ($repoRoot | Select-Object -First 1).Trim() }
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)


$projectsFile = Join-Path $repoRoot "config\projects.txt"
$reportFile = Join-Path $storagePath "reports\current_context.md"

if (!(Test-Path $projectsFile)) {
    Write-Host "No config/projects.txt found."
    exit 0
}

try {
    $projects = [System.IO.File]::ReadAllLines($projectsFile, [System.Text.Encoding]::UTF8) | Where-Object { $_ -match "\S" -and $_ -notmatch "^#" }
}
catch {
    Write-Warning "Failed to read projects.txt: $_"
    exit 1
}

$reportContent = "# Current Active Work Context`n`nGenerated at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n`n"

foreach ($proj in $projects) {
    if (!(Test-Path $proj)) {
        $reportContent += "## ?醫묓닔 Project: $proj (Path Not Found)`n`n"
        continue
    }

    try {
        Push-Location $proj
    }
    catch {
        $reportContent += "## ?醫묓닔 Project: $proj (Failed to enter directory)`n`n"
        continue
    }

    $gitExists = Get-Command git -ErrorAction SilentlyContinue
    if (!$gitExists) {
        $reportContent += "## ?諭?Project: $proj`n*Git environment not found in path.*`n`n"
        Pop-Location
        continue
    }

    $isGit = (Test-Path ".git") -or (git rev-parse --is-inside-work-tree 2>$null)
    
    $reportContent += "## ?諭?Project: $proj`n"

    if (!$isGit) {
        $reportContent += "*Not a Git repository.*`n`n"
        Pop-Location
        continue
    }

    # 1. Get recent commit info
    $lastCommit = git log -1 --oneline 2>$null
    if ($lastCommit) {
        $reportContent += "**Last Commit:** `$ $lastCommit`n`n"
    } else {
        $reportContent += "**Last Commit:** *(No commits found)*`n`n"
    }

    # 2. Get status (changed files count)
    $statusLines = git status --short 2>$null
    if ([string]::IsNullOrWhiteSpace($statusLines)) {
        $reportContent += "*No uncommitted changes.*`n`n"
        Pop-Location
        continue
    }

    $changedFilesCount = ($statusLines -split "`n").Count
    $reportContent += "**Uncommitted Changes ($changedFilesCount files):**`n"
    $reportContent += "```text`n$statusLines`n````n`n"

    # 3. Token-safe Diff Logic
    # Always use --stat instead of full diff to preserve context length. Subagents can run `git diff` if needed.
    $diffStat = git diff --stat 2>$null
    if ($diffStat) {
        $reportContent += "**Git Diff Stat:**`n```text`n$diffStat`n````n`n"
    }
    Pop-Location
}

if (!(Test-Path (Split-Path $reportFile))) {
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $reportFile) | Out-Null
    }
    catch {
        throw "Failed to create directory for report file: $_"
    }
}

try {
    [System.IO.File]::WriteAllText($reportFile, $reportContent, $utf8NoBom)
}
catch {
    throw "Failed to write report file to ${reportFile}: $_"
}

# [?醫뤾쿃 ???걟??筌β돦??
$trackScript = Join-Path $repoRoot "scripts\metrics\Track-Tokens.ps1"
if (Test-Path $trackScript) {
    try {
        & $trackScript -Text $reportContent -OperationName "Detect-ActiveWork"
    }
    catch {
        Write-Warning "Failed to run token tracking script: $_"
    }
}

# [??쇳떔 ?怨밴묶 ????獄?癰궰野?揶쏅Ŋ?]
$compareScript = Join-Path $repoRoot "scripts\scan\Compare-ScanState.ps1"
if (Test-Path $compareScript) {
    try {
        $ErrorActionPreference = "Continue"
        & $compareScript 2>$null | Out-Null
        $ErrorActionPreference = "Stop"
    }
    catch {
        Write-Warning "Failed to run scan state comparison: $_"
        $ErrorActionPreference = "Stop"
    }
}

Write-Host "Context generated at $reportFile"



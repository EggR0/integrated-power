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

# [SelfTest Mode]
if ($SelfTest) {
    Write-Host "[Self-Test] Starting Detect-ActiveWork.ps1 self-test..."
    $tempProjDir = Join-Path $repoRoot "scripts\__temp_test_git_proj"
    $tempProjTxt = Join-Path $repoRoot "scripts\__temp_test_projects.txt"
    $tempReport = Join-Path $storagePath "reports\__temp_test_context.md"

    try {
        # 1. Clean up stale test files if any
        if (Test-Path $tempProjDir) { Remove-Item $tempProjDir -Recurse -Force }
        if (Test-Path $tempProjTxt) { Remove-Item $tempProjTxt -Force }
        if (Test-Path $tempReport) { Remove-Item $tempReport -Force }

        # 2. Setup mock git project
        New-Item -ItemType Directory -Path $tempProjDir | Out-Null
        Push-Location $tempProjDir
        
        $gitExists = Get-Command git -ErrorAction SilentlyContinue
        if ($gitExists) {
            & git init | Out-Null
            & git config user.name "Tester"
            & git config user.email "tester@example.com"
            [System.IO.File]::WriteAllText((Join-Path $tempProjDir "test.txt"), "initial content", [System.Text.Encoding]::UTF8)
            & git add test.txt
            & git commit -m "initial commit" | Out-Null
            # modify file to create diff
            [System.IO.File]::WriteAllText((Join-Path $tempProjDir "test.txt"), "modified content", [System.Text.Encoding]::UTF8)
        } else {
            # Non-git mock
            [System.IO.File]::WriteAllText((Join-Path $tempProjDir "test.txt"), "mock content", [System.Text.Encoding]::UTF8)
        }
        Pop-Location

        # 3. Create mock projects.txt referencing mock project
        [System.IO.File]::WriteAllText($tempProjTxt, $tempProjDir, [System.Text.Encoding]::UTF8)

        # 4. Save original projects.txt and reports path pointers for testing execution context
        $realProjectsFile = Join-Path $repoRoot "config\projects.txt"
        $realReportFile = Join-Path $storagePath "reports\current_context.md"
        $projectsBackup = $null
        
        if (Test-Path $realProjectsFile) {
            $projectsBackup = [System.IO.File]::ReadAllText($realProjectsFile, [System.Text.Encoding]::UTF8)
        }
        [System.IO.File]::WriteAllText($realProjectsFile, $tempProjDir, [System.Text.Encoding]::UTF8)

        # Execute
        & $MyInvocation.MyCommand.Path
        
        # Asserts on current_context.md
        if (!(Test-Path $realReportFile)) {
            throw "Self-Test Failed: Output report file not created."
        }
        
        $outputReport = [System.IO.File]::ReadAllText($realReportFile, [System.Text.Encoding]::UTF8)
        if ($outputReport -notmatch "Project: .*__temp_test_git_proj") {
            throw "Self-Test Failed: Output report does not contain temp project path."
        }
        
        # Restore projects.txt
        if ($projectsBackup -ne $null) {
            [System.IO.File]::WriteAllText($realProjectsFile, $projectsBackup, [System.Text.Encoding]::UTF8)
        } else {
            if (Test-Path $realProjectsFile) { Remove-Item $realProjectsFile -Force }
        }

        Write-Host "[Self-Test] Detect-ActiveWork.ps1 passed successfully!"
        exit 0
    }
    catch {
        Write-Warning "[Self-Test] Detect-ActiveWork.ps1 failed: $_"
        exit 1
    }
    finally {
        # Restore location if we got stuck
        if ($PWD.Path -eq $tempProjDir) { Pop-Location }
        if (Test-Path $tempProjDir) { Remove-Item $tempProjDir -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path $tempProjTxt) { Remove-Item $tempProjTxt -Force -ErrorAction SilentlyContinue }
        if (Test-Path $tempReport) { Remove-Item $tempReport -Force -ErrorAction SilentlyContinue }
    }
}

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
        $reportContent += "## ?좑툘 Project: $proj (Path Not Found)`n`n"
        continue
    }

    try {
        Push-Location $proj
    }
    catch {
        $reportContent += "## ?좑툘 Project: $proj (Failed to enter directory)`n`n"
        continue
    }

    $gitExists = Get-Command git -ErrorAction SilentlyContinue
    if (!$gitExists) {
        $reportContent += "## ?뱚 Project: $proj`n*Git environment not found in path.*`n`n"
        Pop-Location
        continue
    }

    $isGit = (Test-Path ".git") -or (git rev-parse --is-inside-work-tree 2>$null)
    
    $reportContent += "## ?뱚 Project: $proj`n"

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
        Write-Warning "Failed to create directory for report file: $_"
    }
}

try {
    [System.IO.File]::WriteAllText($reportFile, $reportContent, [System.Text.Encoding]::UTF8)
}
catch {
    Write-Warning "Failed to write report file to ${reportFile}: $_"
}

# [?좏겙 ?뚮え??痢≪젙]
$trackScript = Join-Path $repoRoot "scripts\metrics\Track-Tokens.ps1"
if (Test-Path $trackScript) {
    try {
        & $trackScript -Text $reportContent -OperationName "Detect-ActiveWork"
    }
    catch {
        Write-Warning "Failed to run token tracking script: $_"
    }
}

# [?ㅼ틪 ?곹깭 ???諛?蹂寃?媛먯?]
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



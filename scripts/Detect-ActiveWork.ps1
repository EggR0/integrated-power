$ErrorActionPreference = "Continue"

$repoRoot = (git rev-parse --show-toplevel 2>$null).Trim()
if (!$repoRoot) {
    $repoRoot = $PWD.Path
}

$projectsFile = Join-Path $repoRoot "config\projects.txt"
$reportFile = Join-Path $repoRoot "reports\current_context.md"

if (!(Test-Path $projectsFile)) {
    Write-Host "No config/projects.txt found."
    exit 0
}

$projects = Get-Content $projectsFile | Where-Object { $_ -match "\S" -and $_ -notmatch "^#" }
$reportContent = "# Current Active Work Context`n`nGenerated at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n`n"

foreach ($proj in $projects) {
    if (!(Test-Path $proj)) {
        $reportContent += "## ⚠️ Project: $proj (Path Not Found)`n`n"
        continue
    }

    Push-Location $proj
    $isGit = (Test-Path ".git") -or (git rev-parse --is-inside-work-tree 2>$null)
    
    $reportContent += "## 📁 Project: $proj`n"

    if (!$isGit) {
        $reportContent += "*Not a Git repository.*`n`n"
        Pop-Location
        continue
    }

    # 1. Get recent commit info
    $lastCommit = git log -1 --oneline 2>$null
    $reportContent += "**Last Commit:** `$ $lastCommit`n`n"

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
    if ($changedFilesCount -gt 5) {
        $reportContent += "> [!WARNING]`n> 🚨 **Massive Change Detected (>5 files).**`n> Token safety activated. Full ``git diff`` is omitted. Showing ``git diff --stat`` only.`n`n"
        $diffStat = git diff --stat 2>$null
        $reportContent += "```text`n$diffStat`n````n`n"
    } else {
        # Check diff line count
        $diffLines = (git diff 2>$null) -split "`n"
        if ($diffLines.Count -gt 500) {
            $reportContent += "> [!WARNING]`n> 🚨 **Large Diff Detected (>$($diffLines.Count) lines).**`n> Token safety activated. Full ``git diff`` is omitted. Showing ``git diff --stat`` only.`n`n"
            $diffStat = git diff --stat 2>$null
            $reportContent += "```text`n$diffStat`n````n`n"
        } else {
            $reportContent += "**Git Diff:**`n```diff`n" + ($diffLines -join "`n") + "`n````n`n"
        }
    }
    Pop-Location
}

if (!(Test-Path (Split-Path $reportFile))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $reportFile) | Out-Null
}

[System.IO.File]::WriteAllText($reportFile, $reportContent, [System.Text.Encoding]::UTF8)
Write-Host "Context generated at $reportFile"

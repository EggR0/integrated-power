$ErrorActionPreference = "Continue"

$repoRoot = (git rev-parse --show-toplevel 2>$null).Trim()
if (!$repoRoot) {
    $repoRoot = $PWD.Path
}

$projectsFile = Join-Path $repoRoot "config\projects.txt"
$reportFile = Join-Path $repoRoot "reports\current_todos.md"

if (!(Test-Path $projectsFile)) {
    Write-Host "No config/projects.txt found."
    exit 0
}

# Avoid PowerShell pipeline encoding issues when reading
$projects = [System.IO.File]::ReadAllLines($projectsFile, [System.Text.Encoding]::UTF8) | Where-Object { $_ -match "\S" -and $_ -notmatch "^#" }

$reportContent = "# Active TODOs and FIXMEs`n`nGenerated at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n`n"

foreach ($proj in $projects) {
    if (!(Test-Path $proj)) {
        continue
    }

    $reportContent += "## 📁 Project: $proj`n`n"
    $excludeDirs = @('.git', 'node_modules', 'vendor', 'dist', 'build', '.vs', 'out', 'bin', 'obj', 'reports')
    
    # We will use Select-String, but only on files with certain extensions to speed things up
    # and avoid scanning binaries.
    $includeExts = @('.ps1', '.py', '.js', '.ts', '.html', '.css', '.md', '.java', '.cs', '.go', '.rs', '.c', '.cpp', '.h')

    # To avoid catastrophic performance issues when traversing massive folders like 'node_modules',
    # we use a custom recursive function that completely skips excluded directories.
    function Get-FilesFast($Path) {
        $dirs = Get-ChildItem -Path $Path -Directory -ErrorAction SilentlyContinue | Where-Object { $excludeDirs -notcontains $_.Name }
        foreach ($d in $dirs) {
            Get-FilesFast -Path $d.FullName
        }
        Get-ChildItem -Path $Path -File -ErrorAction SilentlyContinue | Where-Object { $includeExts -contains $_.Extension }
    }

    $filesToScan = Get-FilesFast -Path $proj

    $todos = $filesToScan | Select-String -Pattern "(TODO|FIXME):?\s*(.*)" -CaseSensitive:$false 2>$null

    if ($todos) {
        $reportContent += "```text`n"
        # Only take first 50 to prevent massive lists blowing up token counts
        $count = 0
        foreach ($match in $todos) {
            if ($count -ge 50) {
                break
            }
            $relPath = $match.Path.Replace($proj, "").TrimStart('\')
            $line = $match.Line.Trim()
            # truncate very long lines
            if ($line.Length -gt 150) {
                $line = $line.Substring(0, 150) + "..."
            }
            $reportContent += "$relPath`:$($match.LineNumber) - $line`n"
            $count++
        }
        if ($todos.Count -gt 50) {
            $reportContent += "...and $($todos.Count - 50) more.`n"
        }
        $reportContent += "````n`n"
    } else {
        $reportContent += "*No TODOs found.*`n`n"
    }
}

if (!(Test-Path (Split-Path $reportFile))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $reportFile) | Out-Null
}

[System.IO.File]::WriteAllText($reportFile, $reportContent, [System.Text.Encoding]::UTF8)
Write-Host "TODOs extracted to $reportFile"

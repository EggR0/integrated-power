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
    Write-Host "[Self-Test] Starting Extract-Todos.ps1 self-test..."
    $tempProjDir = Join-Path $repoRoot "scripts\__temp_test_todo_proj"
    $tempProjTxt = Join-Path $repoRoot "scripts\__temp_test_projects.txt"
    $tempReport = Join-Path $storagePath "reports\__temp_test_todos.md"

    try {
        # 1. Clean up stale test files if any
        if (Test-Path $tempProjDir) { Remove-Item $tempProjDir -Recurse -Force }
        if (Test-Path $tempProjTxt) { Remove-Item $tempProjTxt -Force }
        if (Test-Path $tempReport) { Remove-Item $tempReport -Force }

        # 2. Setup mock project with dummy TODO file
        New-Item -ItemType Directory -Path $tempProjDir | Out-Null
        $mockCodeContent = @"
// TODO: Fix this function later
// FIXME: Critical bug here
"@
        [System.IO.File]::WriteAllText((Join-Path $tempProjDir "app.js"), $mockCodeContent, [System.Text.Encoding]::UTF8)

        # 3. Create mock projects.txt referencing mock project
        [System.IO.File]::WriteAllText($tempProjTxt, $tempProjDir, [System.Text.Encoding]::UTF8)

        # 4. Swap config for executing
        $realProjectsFile = Join-Path $repoRoot "config\projects.txt"
        $realReportFile = Join-Path $storagePath "reports\current_todos.md"
        $projectsBackup = $null
        
        if (Test-Path $realProjectsFile) {
            $projectsBackup = [System.IO.File]::ReadAllText($realProjectsFile, [System.Text.Encoding]::UTF8)
        }
        [System.IO.File]::WriteAllText($realProjectsFile, $tempProjDir, [System.Text.Encoding]::UTF8)

        # Execute
        & $MyInvocation.MyCommand.Path
        
        # Asserts on current_todos.md
        if (!(Test-Path $realReportFile)) {
            throw "Self-Test Failed: Output report file not created."
        }
        
        $outputReport = [System.IO.File]::ReadAllText($realReportFile, [System.Text.Encoding]::UTF8)
        if ($outputReport -notmatch "TODO: Fix this function later" -or $outputReport -notmatch "FIXME: Critical bug here") {
            throw "Self-Test Failed: Output report does not contain expected TODO/FIXME items."
        }
        
        # Restore projects.txt
        if ($projectsBackup -ne $null) {
            [System.IO.File]::WriteAllText($realProjectsFile, $projectsBackup, [System.Text.Encoding]::UTF8)
        } else {
            if (Test-Path $realProjectsFile) { Remove-Item $realProjectsFile -Force }
        }

        Write-Host "[Self-Test] Extract-Todos.ps1 passed successfully!"
        exit 0
    }
    catch {
        Write-Warning "[Self-Test] Extract-Todos.ps1 failed: $_"
        exit 1
    }
    finally {
        if (Test-Path $tempProjDir) { Remove-Item $tempProjDir -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path $tempProjTxt) { Remove-Item $tempProjTxt -Force -ErrorAction SilentlyContinue }
        if (Test-Path $tempReport) { Remove-Item $tempReport -Force -ErrorAction SilentlyContinue }
    }
}

$projectsFile = Join-Path $repoRoot "config\projects.txt"
$reportFile = Join-Path $storagePath "reports\current_todos.md"

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

$reportContent = "# Active TODOs and FIXMEs`n`nGenerated at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n`n"

foreach ($proj in $projects) {
    if (!(Test-Path $proj)) {
        continue
    }

    $reportContent += "## ?諭?Project: $proj`n`n"
    $excludeDirs = @('.git', 'node_modules', 'vendor', 'dist', 'build', '.vs', 'out', 'bin', 'obj', 'reports')
    $includeExts = @('.ps1', '.py', '.js', '.ts', '.html', '.css', '.md', '.java', '.cs', '.go', '.rs', '.c', '.cpp', '.h')

    function Get-FilesFast($Path) {
        $dirs = Get-ChildItem -Path $Path -Directory -ErrorAction SilentlyContinue | Where-Object { $excludeDirs -notcontains $_.Name }
        foreach ($d in $dirs) {
            Get-FilesFast -Path $d.FullName
        }
        Get-ChildItem -Path $Path -File -ErrorAction SilentlyContinue | Where-Object { $includeExts -contains $_.Extension }
    }

    try {
        $filesToScan = Get-FilesFast -Path $proj
    }
    catch {
        Write-Warning "Failed to scan folder ${proj}: $_"
        $filesToScan = @()
    }

    $todos = $filesToScan | Select-String -Pattern "(TODO|FIXME):?\s*(.*)" -CaseSensitive:$false 2>$null

    if ($todos) {
        $reportContent += "```text`n"
        $count = 0
        foreach ($match in $todos) {
            if ($count -ge 50) {
                break
            }
            $relPath = $match.Path.Replace($proj, "").TrimStart('\')
            $line = $match.Line.Trim()
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

# [?醫뤾쿃 ???걟??筌β돦??
$trackScript = Join-Path $repoRoot "scripts\metrics\Track-Tokens.ps1"
if (Test-Path $trackScript) {
    try {
        & $trackScript -Text $reportContent -OperationName "Extract-Todos"
    }
    catch {
        Write-Warning "Failed to run token tracking script: $_"
    }
}

Write-Host "TODOs extracted to $reportFile"



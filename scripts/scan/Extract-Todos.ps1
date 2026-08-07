param(
    [Parameter(Mandatory = $false)]
    [switch]$SelfTest,

    [Parameter(Mandatory = $false)]
    [string]$ProjectsFile = ""
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

if ($SelfTest) {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("extract-todos-selftest-" + [Guid]::NewGuid().ToString("N"))
    $tempProjDir = Join-Path $tempRoot "project"
    $tempProjTxt = Join-Path $tempRoot "projects.txt"

    try {
        New-Item -ItemType Directory -Force -Path $tempProjDir | Out-Null
        $mockCodeContent = @"
// TODO: Fix this function later
// FIXME: Critical bug here
"@
        [System.IO.File]::WriteAllText((Join-Path $tempProjDir "app.js"), $mockCodeContent, $utf8NoBom)
        [System.IO.File]::WriteAllText($tempProjTxt, $tempProjDir, $utf8NoBom)

        $realReportFile = Join-Path $storagePath "reports\current_todos.md"
        if (Test-Path -LiteralPath $realReportFile) {
            Remove-Item -LiteralPath $realReportFile -Force
        }

        & $MyInvocation.MyCommand.Path -ProjectsFile $tempProjTxt

        if (!(Test-Path $realReportFile)) {
            throw "Self-Test Failed: Output report file not created."
        }

        $outputReport = [System.IO.File]::ReadAllText($realReportFile, [System.Text.Encoding]::UTF8)
        if ($outputReport -notmatch "TODO: Fix this function later" -or $outputReport -notmatch "FIXME: Critical bug here") {
            throw "Self-Test Failed: Output report does not contain expected TODO/FIXME items."
        }

        Write-Host "[Self-Test] Extract-Todos.ps1 passed successfully!"
        exit 0
    }
    catch {
        Write-Warning "[Self-Test] Extract-Todos.ps1 failed: $_"
        exit 1
    }
    finally {
        if (Test-Path $tempRoot) { Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

if ([string]::IsNullOrWhiteSpace($ProjectsFile)) {
    $ProjectsFile = Join-Path $repoRoot "config\projects.txt"
}
$projectsFile = $ProjectsFile
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

    $reportContent += "## ?獄?Project: $proj`n`n"
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
        throw "Failed to create directory for report file: $_"
    }
}

try {
    [System.IO.File]::WriteAllText($reportFile, $reportContent, $utf8NoBom)
}
catch {
    throw "Failed to write report file to ${reportFile}: $_"
}

# Token tracking trigger
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

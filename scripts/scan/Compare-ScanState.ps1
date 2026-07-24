param(
    [Parameter(Mandatory = $false)]
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel 2>$null)
if ($repoRoot) { $repoRoot = $repoRoot.Trim() }
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}
Import-Module (Join-Path $repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

$stateFile = Join-Path $repoRoot "config\last_scan_state.json"
$todosFile = Join-Path $storagePath "reports\current_todos.md"
$contextFile = Join-Path $storagePath "reports\current_context.md"

# ?? Helper: Compute a simple hash of a string ??
function Get-StringHash($inputString) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputString)
    $hash = $sha.ComputeHash($bytes)
    return [BitConverter]::ToString($hash).Replace("-", "").Substring(0, 16).ToLower()
}

# ?? Helper: Read current scan snapshot ??
function Get-CurrentSnapshot {
    $snapshot = @{
        timestamp        = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
        todo_hashes      = @()
        todo_count       = 0
        git_diff_stat    = ""
        uncommitted_count = 0
    }

    # Parse todos
    if (Test-Path -LiteralPath $todosFile) {
        $todoContent = [System.IO.File]::ReadAllText($todosFile, [System.Text.Encoding]::UTF8)
        $todoLines = ($todoContent -split "`n") | Where-Object { $_ -match "^\S.*:\d+\s*-\s*" }
        $snapshot.todo_count = $todoLines.Count
        $snapshot.todo_hashes = @($todoLines | ForEach-Object { Get-StringHash $_ })
    }

    # Parse git state
    $gitExists = Get-Command git -ErrorAction SilentlyContinue
    if ($gitExists) {
        $savedEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $diffStat = git diff --stat 2>$null
        if ($diffStat) {
            $snapshot.git_diff_stat = ($diffStat | Select-Object -Last 1).Trim()
        }
        $statusLines = git status --short 2>$null
        if ($statusLines) {
            $snapshot.uncommitted_count = (($statusLines -split "`n") | Where-Object { $_ -match "\S" }).Count
        }
        $ErrorActionPreference = $savedEAP
    }

    return $snapshot
}

# ?? Helper: Compare two snapshots, return delta object ??
function Compare-Snapshots($previous, $current) {
    $delta = @{
        has_changes       = $false
        new_todos         = @()
        removed_todos     = 0
        todo_count_change = $current.todo_count - $previous.todo_count
        diff_stat_changed = ($current.git_diff_stat -ne $previous.git_diff_stat)
        file_count_change = $current.uncommitted_count - $previous.uncommitted_count
    }

    # Compare todo hashes
    $prevSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$previous.todo_hashes)
    $currSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$current.todo_hashes)

    $newHashes = @($current.todo_hashes | Where-Object { !$prevSet.Contains($_) })
    $removedCount = @($previous.todo_hashes | Where-Object { !$currSet.Contains($_) }).Count

    $delta.new_todos = $newHashes
    $delta.removed_todos = $removedCount

    if ($newHashes.Count -gt 0 -or $removedCount -gt 0 -or $delta.diff_stat_changed -or $delta.file_count_change -ne 0) {
        $delta.has_changes = $true
    }

    return $delta
}

# ?? SelfTest Mode ??
if ($SelfTest) {
    Write-Host "[Self-Test] Starting Compare-ScanState.ps1 self-test..."
    $tempStateFile = Join-Path $repoRoot "config\__temp_test_scan_state.json"

    try {
        # 1. Create a fake previous state
        $fakeOld = @{
            timestamp         = "2026-01-01T00:00:00+09:00"
            todo_hashes       = @("aaaa1111bbbb2222", "cccc3333dddd4444")
            todo_count        = 2
            git_diff_stat     = "3 files changed"
            uncommitted_count = 5
        }
        $fakeOldJson = $fakeOld | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText($tempStateFile, $fakeOldJson, [System.Text.Encoding]::UTF8)

        # 2. Read it back
        $loaded = [System.IO.File]::ReadAllText($tempStateFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

        # 3. Create a fake current state with changes
        $fakeCurrent = @{
            timestamp         = "2026-01-01T00:05:00+09:00"
            todo_hashes       = @("aaaa1111bbbb2222", "eeee5555ffff6666")
            todo_count        = 2
            git_diff_stat     = "5 files changed"
            uncommitted_count = 7
        }

        # 4. Compare
        $delta = Compare-Snapshots $loaded $fakeCurrent
        if (!$delta.has_changes) {
            throw "Self-Test Failed: Expected has_changes to be true."
        }
        if ($delta.new_todos.Count -ne 1) {
            throw "Self-Test Failed: Expected 1 new todo hash, got $($delta.new_todos.Count)."
        }
        if ($delta.removed_todos -ne 1) {
            throw "Self-Test Failed: Expected 1 removed todo, got $($delta.removed_todos)."
        }
        if (!$delta.diff_stat_changed) {
            throw "Self-Test Failed: Expected diff_stat_changed to be true."
        }

        # 5. Test no-change scenario
        $deltaNoChange = Compare-Snapshots $loaded $loaded
        if ($deltaNoChange.has_changes) {
            throw "Self-Test Failed: Expected no changes when comparing identical states."
        }

        Write-Host "[Self-Test] Compare-ScanState.ps1 passed successfully!"
        exit 0
    }
    catch {
        Write-Warning "[Self-Test] Compare-ScanState.ps1 failed: $_"
        exit 1
    }
    finally {
        if (Test-Path $tempStateFile) { Remove-Item $tempStateFile -Force -ErrorAction SilentlyContinue }
    }
}

# ?? Main execution ??

# 1. Load previous state
$previousState = @{
    timestamp         = $null
    todo_hashes       = @()
    todo_count        = 0
    git_diff_stat     = ""
    uncommitted_count = 0
}
if (Test-Path -LiteralPath $stateFile) {
    try {
        $loadedJson = [System.IO.File]::ReadAllText($stateFile, [System.Text.Encoding]::UTF8)
        $loaded = $loadedJson | ConvertFrom-Json
        $previousState.timestamp = $loaded.timestamp
        $previousState.todo_hashes = @($loaded.todo_hashes)
        $previousState.todo_count = [int]$loaded.todo_count
        $previousState.git_diff_stat = [string]$loaded.git_diff_stat
        $previousState.uncommitted_count = [int]$loaded.uncommitted_count
    }
    catch {
        Write-Warning "Could not parse previous state, treating as first run: $_"
    }
}

# 2. Get current snapshot
$currentState = Get-CurrentSnapshot

# 3. Compare
$delta = Compare-Snapshots $previousState $currentState

# 4. Save current state for next comparison
try {
    $stateJson = $currentState | ConvertTo-Json -Depth 5
    $stateDir = Split-Path -Parent $stateFile
    if (!(Test-Path $stateDir)) {
        New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    }
    [System.IO.File]::WriteAllText($stateFile, $stateJson, [System.Text.Encoding]::UTF8)
}
catch {
    Write-Warning "Failed to save scan state: $_"
}

# 5. Output result
$deltaJson = $delta | ConvertTo-Json -Depth 5
Write-Output $deltaJson

if ($delta.has_changes) {
    Write-Host "CHANGES DETECTED since last scan."
    exit 1
} else {
    Write-Host "No changes detected since last scan."
    exit 0
}



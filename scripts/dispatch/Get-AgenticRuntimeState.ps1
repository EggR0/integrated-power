[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            $RepoRoot = ($gitRoot | Select-Object -First 1).Trim()
        }
    }
    catch { }
    
    if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
        $RepoRoot = (Get-Location).Path
    }
}

$repoRootFull = [System.IO.Path]::GetFullPath($RepoRoot)
$globalStorageModule = Join-Path $repoRootFull "scripts\util\GlobalStorage.psm1"

if (!(Test-Path -LiteralPath $globalStorageModule)) {
    throw "Cannot find GlobalStorage.psm1 at $globalStorageModule"
}

Import-Module $globalStorageModule -DisableNameChecking

$globalStorage = Get-GlobalStorage -RepoRoot $repoRootFull
$dashboardStatePath = Join-Path $globalStorage "reports\dashboard-state.json"

$defaultState = [pscustomobject]@{
    CloudQuotaRemainingPercent = -1
    RecommendedTaskWeight = "unrestricted"
    TimeBudgetMinutes = -1
    StaleState = $true
}

if (!(Test-Path -LiteralPath $dashboardStatePath)) {
    return $defaultState
}

try {
    $rawJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $dashboardStatePath
    $stateObj = $rawJson | ConvertFrom-Json

    $stale = $true
    if ($stateObj.updatedAt) {
        $lastUpdated = [datetime]$stateObj.updatedAt
        if ((Get-Date) - $lastUpdated -lt [timespan]::FromMinutes(60)) {
            $stale = $false
        }
    }

    $quotaPercent = -1
    if ($stateObj.tokenStatus -and $stateObj.tokenStatus.quotaPools) {
        # Find the primary pool or just average them. Let's find 'primary' or the lowest remaining
        $lowest = 100
        $found = $false
        foreach ($pool in $stateObj.tokenStatus.quotaPools) {
            if ($null -ne $pool.remainingPercentage) {
                if ($pool.remainingPercentage -lt $lowest) {
                    $lowest = [int]$pool.remainingPercentage
                    $found = $true
                }
            }
        }
        if ($found) {
            $quotaPercent = $lowest
        }
    }

    $weight = "unrestricted"
    if ($stateObj.tokenStatus -and $stateObj.tokenStatus.recommendedTaskWeight) {
        $weight = [string]$stateObj.tokenStatus.recommendedTaskWeight
    }

    $timeBudget = -1
    if ($stateObj.timeBudgetMinutes) {
        $timeBudget = [int]$stateObj.timeBudgetMinutes
    }

    return [pscustomobject]@{
        CloudQuotaRemainingPercent = $quotaPercent
        RecommendedTaskWeight = $weight
        TimeBudgetMinutes = $timeBudget
        StaleState = $stale
    }
}
catch {
    Write-Warning "Failed to parse dashboard-state.json: $_"
    return $defaultState
}

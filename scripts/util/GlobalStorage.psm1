function Get-WorkspaceStorageHash {
    param([string]$RepoRoot)

    $fullPath = [System.IO.Path]::GetFullPath($RepoRoot)
    if ($fullPath -match '^[A-Z]:') {
        $fullPath = $fullPath.Substring(0, 1).ToLowerInvariant() + $fullPath.Substring(1)
    }

    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($fullPath)
        $hashBytes = $md5.ComputeHash($bytes)
        return -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
    } finally {
        $md5.Dispose()
    }
}

function Get-DashboardGlobalStorageRoot {
    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        throw "APPDATA is not set; cannot resolve Antigravity dashboard globalStorage."
    }

    return Join-Path $env:APPDATA "Antigravity IDE\User\globalStorage\integratedpower.antigravity-ide-dashboard"
}

function Get-GlobalStorage {
    param([string]$RepoRoot)

    if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
        $RepoRoot = (Get-Location).Path
    }

    $repoRootFull = [System.IO.Path]::GetFullPath($RepoRoot)
    $storageFile = Join-Path $repoRootFull ".agents\dashboard_global_storage.txt"
    if (Test-Path -LiteralPath $storageFile) {
        $storagePath = (Get-Content -LiteralPath $storageFile -TotalCount 1).Trim()
        if (![string]::IsNullOrWhiteSpace($storagePath)) {
            return $storagePath
        }
    }

    $hash = Get-WorkspaceStorageHash -RepoRoot $repoRootFull
    return Join-Path (Get-DashboardGlobalStorageRoot) "workspaces\$hash"
}
Export-ModuleMember -Function Get-GlobalStorage

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
    $repoName = Split-Path $repoRootFull -Leaf
    
    return Join-Path $env:USERPROFILE ".gemini\antigravity-ide\persistent_workspaces\$repoName"
}
function Export-CsvUtf8NoBom {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true)]
        $InputObject,

        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [switch]$Append
    )

    begin {
        $rows = New-Object System.Collections.Generic.List[object]
    }

    process {
        if ($null -ne $InputObject) {
            [void]$rows.Add($InputObject)
        }
    }

    end {
        if ($rows.Count -eq 0) {
            return
        }

        $dir = Split-Path -Parent $LiteralPath
        if (![string]::IsNullOrWhiteSpace($dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }

        $csvLines = @($rows | ConvertTo-Csv -NoTypeInformation)
        if ($Append -and (Test-Path -LiteralPath $LiteralPath)) {
            $csvLines = @($csvLines | Select-Object -Skip 1)
        }
        if ($csvLines.Count -eq 0) {
            return
        }

        $text = ($csvLines -join [Environment]::NewLine) + [Environment]::NewLine
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        if ($Append -and (Test-Path -LiteralPath $LiteralPath)) {
            [System.IO.File]::AppendAllText($LiteralPath, $text, $utf8NoBom)
        } else {
            [System.IO.File]::WriteAllText($LiteralPath, $text, $utf8NoBom)
        }
    }
}

Export-ModuleMember -Function Get-GlobalStorage, Export-CsvUtf8NoBom

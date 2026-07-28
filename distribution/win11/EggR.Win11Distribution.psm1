Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ExpectedExtensionId = 'integratedpower.antigravity-ide-dashboard'
$script:AllowedKnowledgeTargets = @(
    'eggr-roots.ps1',
    'set-eggr-roots.ps1',
    'initialize-eggr-knowledge.ps1',
    'save-agent-worklog.ps1',
    'eggr-roots.cmd',
    'set-eggr-roots.cmd',
    'initialize-eggr-knowledge.cmd',
    'save-agent-worklog.cmd'
)

function Get-EggRSafePackagePath {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
        throw "Package path must be relative: $RelativePath"
    }

    $root = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $candidate = [IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Package path escapes the extracted release directory: $RelativePath"
    }
    return $candidate
}

function Read-EggRRelease {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$PackageDirectory)

    $packageRoot = [IO.Path]::GetFullPath($PackageDirectory)
    $manifestPath = Join-Path $packageRoot 'release-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "release-manifest.json was not found. Extract the complete ZIP first: $packageRoot"
    }

    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "release-manifest.json is invalid: $($_.Exception.Message)"
    }

    if ([int]$manifest.schemaVersion -ne 1) {
        throw "Unsupported release manifest schema: $($manifest.schemaVersion)"
    }
    if ([string]$manifest.productId -ne 'eggr-antigravity-ide-dashboard') {
        throw "Unexpected product identity: $($manifest.productId)"
    }
    if ([string]$manifest.platform -ne 'windows-11') {
        throw "This package is not a Windows 11 release: $($manifest.platform)"
    }
    if ([string]$manifest.extension.id -ne $script:ExpectedExtensionId) {
        throw "Unexpected extension identity: $($manifest.extension.id)"
    }
    if ([string]::IsNullOrWhiteSpace([string]$manifest.extension.version)) {
        throw 'The extension version is missing from release-manifest.json.'
    }
    if (@($manifest.files).Count -eq 0) {
        throw 'The release file inventory is empty.'
    }

    $verifiedFiles = @()
    $seenPaths = @{}
    foreach ($file in @($manifest.files)) {
        $relativePath = [string]$file.path
        $pathKey = $relativePath.Replace('\', '/').ToLowerInvariant()
        if ($seenPaths.ContainsKey($pathKey)) {
            throw "Duplicate package file inventory entry: $relativePath"
        }
        $seenPaths[$pathKey] = $true
        $expectedHash = ([string]$file.sha256).ToUpperInvariant()
        if ($expectedHash -notmatch '^[0-9A-F]{64}$') {
            throw "Invalid SHA-256 for package file: $relativePath"
        }
        $absolutePath = Get-EggRSafePackagePath -PackageRoot $packageRoot -RelativePath $relativePath
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
            throw "Package file is missing: $relativePath"
        }
        $fileItem = Get-Item -LiteralPath $absolutePath -Force
        if (($fileItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Package payload cannot be a reparse point: $relativePath"
        }
        $actualHash = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "Package integrity check failed: $relativePath"
        }
        $verifiedFiles += [PSCustomObject]@{
            Path         = $relativePath
            AbsolutePath = $absolutePath
            Sha256       = $actualHash
            Role         = [string]$file.role
        }
    }

    $vsixRelativePath = [string]$manifest.extension.vsixFile
    $vsix = @($verifiedFiles | Where-Object { $_.Path -eq $vsixRelativePath })
    if ($vsix.Count -ne 1 -or $vsix[0].Role -ne 'dashboard-vsix') {
        throw 'The pinned Dashboard VSIX is not represented exactly once in the file inventory.'
    }
    if ($vsix[0].Sha256 -ne ([string]$manifest.extension.sha256).ToUpperInvariant()) {
        throw 'The Dashboard VSIX hash does not match the release manifest extension record.'
    }

    $requiredPackageFiles = @(
        'EggR.Win11Distribution.psm1',
        'Install-EggRWin11.ps1',
        'Uninstall-EggRWin11.ps1',
        '01-INSTALL.cmd',
        '02-VERIFY-ONLY.cmd',
        '99-UNINSTALL-EXTENSION-ONLY.cmd',
        'README-FIRST.ko.md',
        $vsixRelativePath
    )
    foreach ($requiredFile in $requiredPackageFiles) {
        if (-not $seenPaths.ContainsKey($requiredFile.ToLowerInvariant())) {
            throw "Required package file is not protected by the manifest: $requiredFile"
        }
    }

    $allowedTargets = @{}
    foreach ($name in $script:AllowedKnowledgeTargets) {
        $allowedTargets[$name.ToLowerInvariant()] = $true
    }
    $seenTargets = @{}
    foreach ($tool in @($manifest.knowledgeTools.files)) {
        $targetName = [string]$tool.target
        if (
            [string]::IsNullOrWhiteSpace($targetName) -or
            [IO.Path]::GetFileName($targetName) -ne $targetName -or
            -not $allowedTargets.ContainsKey($targetName.ToLowerInvariant())
        ) {
            throw "Unsafe or unknown Knowledge tool target: $targetName"
        }
        $targetKey = $targetName.ToLowerInvariant()
        if ($seenTargets.ContainsKey($targetKey)) {
            throw "Duplicate Knowledge tool target: $targetName"
        }
        $seenTargets[$targetKey] = $true
        $expectedSource = "payload/knowledge-tools/$targetName"
        if ([string]$tool.source -ne $expectedSource) {
            throw "Unexpected Knowledge tool source mapping for $targetName."
        }
        $source = @($verifiedFiles | Where-Object { $_.Path -eq $expectedSource })
        if ($source.Count -ne 1 -or $source[0].Role -ne 'knowledge-tool') {
            throw "Knowledge tool source is missing from the verified inventory: $($tool.source)"
        }
    }
    foreach ($requiredTarget in $script:AllowedKnowledgeTargets) {
        if (-not $seenTargets.ContainsKey($requiredTarget.ToLowerInvariant())) {
            throw "Required Knowledge tool mapping is missing: $requiredTarget"
        }
    }

    return [PSCustomObject]@{
        PackageRoot  = $packageRoot
        ManifestPath = $manifestPath
        Manifest     = $manifest
        Files        = $verifiedFiles
        VsixPath     = $vsix[0].AbsolutePath
    }
}

function Resolve-EggRAntigravityIdeCli {
    [CmdletBinding()]
    param([string]$ExplicitPath = '')

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $candidates += $ExplicitPath
    } else {
        $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
        if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
            $candidates += (Join-Path $localAppData 'Programs\Antigravity IDE\bin\antigravity-ide.cmd')
        }
        foreach ($name in @('antigravity-ide.cmd', 'antigravity-ide.exe', 'antigravity-ide')) {
            $command = Get-Command $name -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandType -in @('Application', 'ExternalScript') } |
                Select-Object -First 1
            if ($command) {
                $candidates += $command.Source
            }
        }
    }

    foreach ($candidate in @($candidates | Select-Object -Unique)) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $resolved = (Resolve-Path -LiteralPath $candidate).Path
            if ($resolved -match '(?i)[\\/]Programs[\\/]Antigravity[\\/]Antigravity\.exe$') {
                throw "The separate Antigravity application cannot manage Antigravity IDE extensions: $resolved"
            }
            if ([IO.Path]::GetFileName($resolved) -notmatch '^(?i)antigravity-ide(?:\.cmd|\.exe)?$') {
                if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
                    throw "The requested file is not named as an Antigravity IDE CLI: $resolved"
                }
                continue
            }
            $previousPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $helpOutput = @(& $resolved --help 2>&1)
                $helpExitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $previousPreference
            }
            $helpText = @($helpOutput | ForEach-Object { [string]$_ }) -join "`n"
            if ($helpExitCode -eq 0 -and $helpText -match '(?m)^Antigravity IDE(?:\s|$)') {
                return $resolved
            }
            if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
                throw "The requested CLI did not identify itself as Antigravity IDE: $resolved"
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        throw "The requested Antigravity IDE CLI does not exist: $ExplicitPath"
    }
    throw 'Antigravity IDE CLI was not found. Install Antigravity IDE first; this package never starts the separate Antigravity application.'
}

function Invoke-EggRAntigravityIdeCli {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$CliPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $CliPath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) {
        $safeOutput = @($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        throw "Antigravity IDE CLI failed (exit $exitCode).`n$safeOutput"
    }
    return @($output | ForEach-Object { [string]$_ })
}

function Get-EggRExtensionCatalog {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$CliPath)

    $entries = Invoke-EggRAntigravityIdeCli -CliPath $CliPath -Arguments @(
        '--list-extensions',
        '--show-versions'
    )
    $versions = @{}
    foreach ($entry in $entries) {
        $line = $entry.Trim()
        if ($line -match '^([^@\s]+)@([^\s]+)$') {
            $versions[$Matches[1].ToLowerInvariant()] = $Matches[2]
        }
    }
    return $versions
}

function Get-EggRDependencyStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$AntigravityCli)

    $items = @(
        @{ Name = 'Antigravity IDE'; Required = $true; Path = $AntigravityCli },
        @{ Name = 'Git for Windows'; Required = $false; Commands = @('git.exe', 'git.cmd', 'git') },
        @{ Name = 'GitHub CLI'; Required = $false; Commands = @('gh.exe', 'gh.cmd', 'gh') },
        @{ Name = 'Codex CLI'; Required = $false; Commands = @('codex.exe', 'codex.cmd', 'codex') },
        @{ Name = 'Agy'; Required = $false; Commands = @('agy.exe', 'agy.cmd', 'agy') },
        @{ Name = 'Ollama'; Required = $false; Commands = @('ollama.exe', 'ollama.cmd', 'ollama') },
        @{ Name = 'NVIDIA SMI'; Required = $false; Commands = @('nvidia-smi.exe', 'nvidia-smi') }
    )

    return @($items | ForEach-Object {
        $path = if ($_.ContainsKey('Path') -and $_['Path']) {
            [string]$_['Path']
        } else {
            $command = $null
            foreach ($commandName in @($_['Commands'])) {
                $command = Get-Command $commandName -ErrorAction SilentlyContinue |
                    Where-Object { $_.CommandType -in @('Application', 'ExternalScript') } |
                    Select-Object -First 1
                if ($command) { break }
            }
            if ($command) { [string]$command.Source } else { '' }
        }
        [PSCustomObject]@{
            name      = $_.Name
            required  = [bool]$_.Required
            available = -not [string]::IsNullOrWhiteSpace($path)
            path      = $path
        }
    })
}

function Get-EggRKnowledgeToolStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Release)

    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'LOCALAPPDATA could not be resolved.'
    }
    $targetRoot = Join-Path $localAppData 'EggR\bin'
    $statePath = Join-Path $localAppData 'EggR\installations\win11-distribution.json'
    $fileStatus = @()
    foreach ($tool in @($Release.Manifest.knowledgeTools.files)) {
        $source = Get-EggRSafePackagePath -PackageRoot $Release.PackageRoot -RelativePath ([string]$tool.source)
        $target = Join-Path $targetRoot ([string]$tool.target)
        $expectedHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        $actualHash = if (Test-Path -LiteralPath $target -PathType Leaf) {
            (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        } else {
            ''
        }
        $fileStatus += [PSCustomObject]@{
            name         = [string]$tool.target
            present      = -not [string]::IsNullOrWhiteSpace($actualHash)
            hashMatches  = $actualHash -eq $expectedHash
            expectedHash = $expectedHash
            actualHash   = $actualHash
        }
    }

    $stateCurrent = $false
    $stateSchema = 0
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $stateSchema = [int]$state.schemaVersion
            $stateCurrent =
                $stateSchema -eq 2 -and
                [string]$state.distributionVersion -eq [string]$Release.Manifest.releaseVersion -and
                [string]$state.dashboardVersion -eq [string]$Release.Manifest.extension.version -and
                [string]$state.knowledgeSource -eq [string]$Release.Manifest.knowledgeTools.sourceCommit -and
                [string]$state.targetRoot -eq $targetRoot
        } catch {
            $stateCurrent = $false
        }
    }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathPresent = @($userPath -split ';' | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and
        $_.TrimEnd('\') -eq $targetRoot.TrimEnd('\')
    }).Count -gt 0
    $allFilesCurrent = @($fileStatus | Where-Object { -not $_.hashMatches }).Count -eq 0

    return [PSCustomObject]@{
        targetRoot      = $targetRoot
        statePath       = $statePath
        stateSchema     = $stateSchema
        stateCurrent    = $stateCurrent
        userPathPresent = $pathPresent
        filesCurrent    = $allFilesCurrent
        current         = $allFilesCurrent -and $stateCurrent
        files           = @($fileStatus)
    }
}

function Test-EggRLegacyKnowledgeFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$TargetName
    )

    try {
        $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    } catch {
        return $false
    }
    if ($TargetName.EndsWith('.cmd', [StringComparison]::OrdinalIgnoreCase)) {
        $scriptName = [IO.Path]::GetFileNameWithoutExtension($TargetName) + '.ps1'
        return $content -match '(?i)powershell(?:\.exe)?' -and
            $content -match [regex]::Escape($scriptName)
    }

    $requiredMarkers = @{
        'eggr-roots.ps1'                = @('EggR', 'roots.json')
        'set-eggr-roots.ps1'            = @('EggR', 'roots.json', 'WorkRoot')
        'initialize-eggr-knowledge.ps1' = @('EggR', 'KnowledgePath', 'Git')
        'save-agent-worklog.ps1'        = @('EggR', 'Agent Worklog', 'git')
    }
    if (-not $requiredMarkers.ContainsKey($TargetName.ToLowerInvariant())) {
        return $false
    }
    foreach ($marker in @($requiredMarkers[$TargetName.ToLowerInvariant()])) {
        if ($content -notmatch [regex]::Escape($marker)) {
            return $false
        }
    }
    return $true
}

function Install-EggRKnowledgeTools {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Release,
        [switch]$SkipUserPath
    )

    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'LOCALAPPDATA could not be resolved.'
    }
    $eggrRoot = Join-Path $localAppData 'EggR'
    $targetRoot = Join-Path $eggrRoot 'bin'
    $stateDirectory = Join-Path $eggrRoot 'installations'
    $statePath = Join-Path $stateDirectory 'win11-distribution.json'
    $backupRoot = Join-Path $eggrRoot (
        'backups\win11-distribution\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')
    )
    $changed = @()
    $created = @()
    $backedUp = @()
    $plans = @()
    $userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
    $userPathChanged = $false
    $managedHashes = @{}
    $previousCreatedFiles = @()
    $previousUserPathAdded = $false
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $previousState = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if (
                [int]$previousState.schemaVersion -eq 2 -and
                $previousState.PSObject.Properties['installedFiles']
            ) {
                foreach ($installedFile in @($previousState.installedFiles)) {
                    $managedHashes[[string]$installedFile.name] = [string]$installedFile.sha256
                }
                if ($previousState.PSObject.Properties['createdFiles']) {
                    $previousCreatedFiles = @($previousState.createdFiles | ForEach-Object { [string]$_ })
                }
                if ($previousState.PSObject.Properties['userPathAdded']) {
                    $previousUserPathAdded = [bool]$previousState.userPathAdded
                }
            }
        } catch {
            $managedHashes = @{}
        }
    }

    New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
    foreach ($tool in @($Release.Manifest.knowledgeTools.files)) {
        $source = Get-EggRSafePackagePath -PackageRoot $Release.PackageRoot -RelativePath ([string]$tool.source)
        $targetName = [string]$tool.target
        $target = Join-Path $targetRoot $targetName
        $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        $targetHash = if (Test-Path -LiteralPath $target -PathType Leaf) {
            (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        } else {
            ''
        }
        if ($sourceHash -eq $targetHash) {
            continue
        }
        if (-not [string]::IsNullOrWhiteSpace($targetHash)) {
            if ($managedHashes.Count -gt 0) {
                if (
                    -not $managedHashes.ContainsKey($targetName) -or
                    [string]$managedHashes[$targetName] -ne $targetHash
                ) {
                    throw "Managed Knowledge tool was modified outside this installer; no file was replaced: $target"
                }
            } elseif (-not (Test-EggRLegacyKnowledgeFile -Path $target -TargetName $targetName)) {
                throw "Unrecognized same-name file blocks Knowledge tool installation; no file was replaced: $target"
            }
        }
        $plans += [PSCustomObject]@{
            Source     = $source
            TargetName = $targetName
            Target     = $target
            Existed    = Test-Path -LiteralPath $target -PathType Leaf
        }
    }

    if ($plans.Count -gt 0) {
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    }
    foreach ($plan in $plans) {
        if ($plan.Existed) {
            Copy-Item -LiteralPath $plan.Target -Destination (Join-Path $backupRoot $plan.TargetName)
            $backedUp += $plan.TargetName
        } else {
            $created += $plan.TargetName
        }
    }

    try {
        foreach ($plan in $plans) {
            $temporary = Join-Path $targetRoot (
                $plan.TargetName + '.eggr-new-' + [Guid]::NewGuid().ToString('N')
            )
            Copy-Item -LiteralPath $plan.Source -Destination $temporary
            try {
                $changed += $plan.TargetName
                if ($plan.Existed) {
                    $replaceScratch = $plan.Target + '.eggr-replaced-' + [Guid]::NewGuid().ToString('N')
                    [IO.File]::Replace($temporary, $plan.Target, $replaceScratch, $true)
                    Remove-Item -LiteralPath $replaceScratch -Force -ErrorAction SilentlyContinue
                } else {
                    [IO.File]::Move($temporary, $plan.Target)
                }
            } finally {
                if (Test-Path -LiteralPath $temporary -PathType Leaf) {
                    Remove-Item -LiteralPath $temporary -Force
                }
            }
        }

        if (-not $SkipUserPath) {
            $parts = @($userPathBefore -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            $present = @($parts | Where-Object {
                $_.TrimEnd('\') -eq $targetRoot.TrimEnd('\')
            }).Count -gt 0
            if (-not $present) {
                [Environment]::SetEnvironmentVariable(
                    'Path',
                    (($parts + $targetRoot) -join ';'),
                    'User'
                )
                $userPathChanged = $true
            }
        }

        New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
        $statusBeforeStateWrite = Get-EggRKnowledgeToolStatus -Release $Release
        $stateCurrent = $changed.Count -eq 0 -and $statusBeforeStateWrite.current

        if (-not $stateCurrent) {
            $installedFiles = @()
            foreach ($tool in @($Release.Manifest.knowledgeTools.files)) {
                $targetName = [string]$tool.target
                $installedFiles += [ordered]@{
                    name   = $targetName
                    sha256 = (Get-FileHash -LiteralPath (Join-Path $targetRoot $targetName) -Algorithm SHA256).Hash
                }
            }
            $state = [ordered]@{
                schemaVersion        = 2
                distributionVersion = [string]$Release.Manifest.releaseVersion
                dashboardVersion    = [string]$Release.Manifest.extension.version
                knowledgeSource     = [string]$Release.Manifest.knowledgeTools.sourceCommit
                installedAt         = [DateTime]::UtcNow.ToString('o')
                targetRoot          = $targetRoot
                changedFiles        = @($changed)
                backupRoot          = if ($backedUp.Count -gt 0) { $backupRoot } else { '' }
                installedFiles      = @($installedFiles)
                createdFiles        = @($previousCreatedFiles + $created | Select-Object -Unique)
                userPathAdded       = $previousUserPathAdded -or $userPathChanged
            }
            $stateTemporary = $statePath + '.eggr-new-' + [Guid]::NewGuid().ToString('N')
            [IO.File]::WriteAllText(
                $stateTemporary,
                ($state | ConvertTo-Json -Depth 5),
                (New-Object Text.UTF8Encoding($false))
            )
            try {
                if (Test-Path -LiteralPath $statePath -PathType Leaf) {
                    $stateScratch = $statePath + '.eggr-replaced-' + [Guid]::NewGuid().ToString('N')
                    [IO.File]::Replace($stateTemporary, $statePath, $stateScratch, $true)
                    Remove-Item -LiteralPath $stateScratch -Force -ErrorAction SilentlyContinue
                } else {
                    [IO.File]::Move($stateTemporary, $statePath)
                }
            } finally {
                if (Test-Path -LiteralPath $stateTemporary -PathType Leaf) {
                    Remove-Item -LiteralPath $stateTemporary -Force
                }
            }
        }
    } catch {
        for ($index = $changed.Count - 1; $index -ge 0; $index--) {
            $targetName = [string]$changed[$index]
            $target = Join-Path $targetRoot $targetName
            $backup = Join-Path $backupRoot $targetName
            if (Test-Path -LiteralPath $backup -PathType Leaf) {
                $restoreTemporary = Join-Path $targetRoot (
                    $targetName + '.eggr-restore-' + [Guid]::NewGuid().ToString('N')
                )
                Copy-Item -LiteralPath $backup -Destination $restoreTemporary
                if (Test-Path -LiteralPath $target -PathType Leaf) {
                    $rollbackScratch = $target + '.eggr-rollback-' + [Guid]::NewGuid().ToString('N')
                    [IO.File]::Replace($restoreTemporary, $target, $rollbackScratch, $true)
                    Remove-Item -LiteralPath $rollbackScratch -Force -ErrorAction SilentlyContinue
                } else {
                    [IO.File]::Move($restoreTemporary, $target)
                }
            } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
                Remove-Item -LiteralPath $target -Force
            }
        }
        if ($userPathChanged) {
            [Environment]::SetEnvironmentVariable('Path', $userPathBefore, 'User')
        }
        throw
    }

    return [PSCustomObject]@{
        targetRoot  = $targetRoot
        changed     = @($changed)
        created     = @($created)
        backedUp    = @($backedUp)
        backupRoot  = if ($backedUp.Count -gt 0) { $backupRoot } else { '' }
        statePath   = $statePath
        stateAction = if ($stateCurrent) { 'unchanged' } else { 'written' }
    }
}

Export-ModuleMember -Function @(
    'Read-EggRRelease',
    'Resolve-EggRAntigravityIdeCli',
    'Invoke-EggRAntigravityIdeCli',
    'Get-EggRExtensionCatalog',
    'Get-EggRDependencyStatus',
    'Get-EggRKnowledgeToolStatus',
    'Install-EggRKnowledgeTools'
)

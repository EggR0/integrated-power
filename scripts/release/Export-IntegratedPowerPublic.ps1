<#
.SYNOPSIS
    Exports a strict, sanitized public Integrated Power source snapshot.
.DESCRIPTION
    Copies only the explicit public allowlist into a sibling staging directory,
    scans the selected content for private identifiers and actual secret values,
    and atomically activates a new public directory.

    This command never initializes Git, configures a remote, commits, or pushes.
    It refuses to overwrite an existing public directory.
.PARAMETER TargetRoot
    Must resolve exactly to the expected sibling directory
    integrated-power-antigravity-public.
.PARAMETER DryRun
    Validates the complete allowlist and content without creating staging or
    target directories.
.PARAMETER Json
    Emits a machine-readable result.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$TargetRoot = '',
    [switch]$DryRun,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepositoryRoot = [IO.Path]::GetFullPath(
    (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
).TrimEnd('\', '/')
$script:WorkspaceRoot = Split-Path -Parent $script:RepositoryRoot
$script:ExpectedTargetRoot = [IO.Path]::GetFullPath(
    (Join-Path $script:WorkspaceRoot 'integrated-power-antigravity-public')
).TrimEnd('\', '/')
$script:Mappings = @()
$script:TargetNames = @{}
$script:Violations = @()

function Write-ExportMessage {
    param([string]$State, [string]$Message)
    if (-not $Json) {
        Write-Host "[$State] $Message"
    }
}

function ConvertTo-NormalizedRelativePath {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue) -or [IO.Path]::IsPathRooted($PathValue)) {
        throw "Public export path must be relative: $PathValue"
    }
    $normalized = $PathValue.Replace('\', '/').TrimStart('/')
    $segments = @($normalized -split '/')
    if ($segments.Count -eq 0 -or $segments -contains '' -or $segments -contains '.' -or $segments -contains '..') {
        throw "Public export path contains an unsafe segment: $PathValue"
    }
    return $normalized
}

function Get-SafeChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    $normalized = ConvertTo-NormalizedRelativePath -PathValue $RelativePath
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $normalized.Replace('/', '\')))
    if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Public export path escapes its root: $RelativePath"
    }
    return $candidate
}

function Assert-PublicRelativePath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $normalized = ConvertTo-NormalizedRelativePath -PathValue $RelativePath
    $segments = @($normalized.ToLowerInvariant() -split '/')
    $forbiddenSegments = @(
        '.ai',
        '.agents',
        '.vscode',
        '.vscode-test',
        'reports',
        'discussions',
        'operational-data',
        'node_modules',
        'out',
        'dist'
    )
    foreach ($segment in $segments) {
        if ($forbiddenSegments -contains $segment) {
            throw "Forbidden public export path segment '$segment': $RelativePath"
        }
    }

    $leaf = $segments[$segments.Count - 1]
    if (
        $leaf -eq 'agents.md' -or
        $leaf -eq '.npmrc' -or
        $leaf -eq 'gemini.md' -or
        $leaf -like '*.vsix' -or
        $leaf -like '*.zip' -or
        $leaf -like '*.log'
    ) {
        throw "Forbidden public export file: $RelativePath"
    }
}

function Assert-NoReparsePoint {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)][string]$StopRoot
    )

    $current = Get-Item -LiteralPath $PathValue -Force
    $stop = [IO.Path]::GetFullPath($StopRoot).TrimEnd('\', '/')
    while ($null -ne $current) {
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse points are not allowed in the public export source: $($current.FullName)"
        }
        $currentFull = [IO.Path]::GetFullPath($current.FullName).TrimEnd('\', '/')
        if ($currentFull.Equals($stop, [StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $parent = Split-Path -Parent $currentFull
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $currentFull) {
            throw "Source path escaped the canonical repository: $PathValue"
        }
        $current = Get-Item -LiteralPath $parent -Force
    }
}

function Add-PublicFile {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRelativePath,
        [Parameter(Mandatory = $true)][string]$TargetRelativePath
    )

    $sourceRelative = ConvertTo-NormalizedRelativePath -PathValue $SourceRelativePath
    $targetRelative = ConvertTo-NormalizedRelativePath -PathValue $TargetRelativePath
    Assert-PublicRelativePath -RelativePath $sourceRelative
    Assert-PublicRelativePath -RelativePath $targetRelative

    $source = Get-SafeChildPath -Root $script:RepositoryRoot -RelativePath $sourceRelative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required public source file is missing: $sourceRelative"
    }
    Assert-NoReparsePoint -PathValue $source -StopRoot $script:RepositoryRoot

    $targetKey = $targetRelative.ToLowerInvariant()
    if ($script:TargetNames.ContainsKey($targetKey)) {
        throw "Duplicate public export target: $targetRelative"
    }
    $script:TargetNames[$targetKey] = $true
    $script:Mappings += [PSCustomObject]@{
        SourceRelative = $sourceRelative
        Source         = $source
        TargetRelative = $targetRelative
        Sha256         = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToUpperInvariant()
    }
}

function Add-PublicTree {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRelativeRoot,
        [Parameter(Mandatory = $true)][string]$TargetRelativeRoot
    )

    $sourceRelative = ConvertTo-NormalizedRelativePath -PathValue $SourceRelativeRoot
    $targetRelative = ConvertTo-NormalizedRelativePath -PathValue $TargetRelativeRoot
    Assert-PublicRelativePath -RelativePath $sourceRelative
    Assert-PublicRelativePath -RelativePath $targetRelative

    $sourceRoot = Get-SafeChildPath -Root $script:RepositoryRoot -RelativePath $sourceRelative
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
        throw "Required public source directory is missing: $sourceRelative"
    }
    Assert-NoReparsePoint -PathValue $sourceRoot -StopRoot $script:RepositoryRoot

    $items = @(Get-ChildItem -LiteralPath $sourceRoot -Force -Recurse)
    foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse points are not allowed in public source trees: $($item.FullName)"
        }
    }
    foreach ($file in @($items | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName)) {
        $child = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        Add-PublicFile `
            -SourceRelativePath ($sourceRelative + '/' + $child) `
            -TargetRelativePath ($targetRelative + '/' + $child)
    }
}

function Add-PublicTemplateTree {
    $sourceRelative = 'scripts/release/public-template'
    $sourceRoot = Get-SafeChildPath -Root $script:RepositoryRoot -RelativePath $sourceRelative
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
        throw "Required public template directory is missing: $sourceRelative"
    }
    Assert-NoReparsePoint -PathValue $sourceRoot -StopRoot $script:RepositoryRoot

    $items = @(Get-ChildItem -LiteralPath $sourceRoot -Force -Recurse)
    foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse points are not allowed in public template trees: $($item.FullName)"
        }
    }
    foreach ($file in @($items | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName)) {
        $child = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        Add-PublicFile `
            -SourceRelativePath ($sourceRelative + '/' + $child) `
            -TargetRelativePath $child
    }
}

function Add-ContentViolation {
    param([string]$RelativePath, [string]$Reason)
    $script:Violations += "$RelativePath :: $Reason"
}

function Get-ScanText {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    $bytes = [IO.File]::ReadAllBytes($PathValue)
    $extension = [IO.Path]::GetExtension($PathValue).ToLowerInvariant()
    $textExtensions = @(
        '',
        '.cmd',
        '.csv',
        '.css',
        '.html',
        '.js',
        '.json',
        '.lock',
        '.md',
        '.mjs',
        '.ps1',
        '.psm1',
        '.ts',
        '.txt',
        '.yaml',
        '.yml'
    )
    if ($textExtensions -contains $extension) {
        return [IO.File]::ReadAllText($PathValue)
    }
    return [Text.Encoding]::ASCII.GetString($bytes)
}

function Test-PackageRepositoryMetadata {
    $packageMapping = @(
        $script:Mappings |
            Where-Object { $_.SourceRelative -eq 'vscode-extension/package.json' }
    )
    if ($packageMapping.Count -ne 1) {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason 'package metadata mapping is missing or duplicated'
        return
    }

    try {
        $package = Get-Content -LiteralPath $packageMapping[0].Source -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason "invalid JSON: $($_.Exception.Message)"
        return
    }

    $expectedRepository = 'https://github.com/R-Github04/integrated-power-antigravity.git'
    $expectedHomepage = 'https://github.com/R-Github04/integrated-power-antigravity#readme'
    $expectedBugs = 'https://github.com/R-Github04/integrated-power-antigravity/issues'
    if ([string]$package.name -ne 'integrated-power') {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason 'extension name is not the canonical integrated-power identity'
    }
    if ([string]$package.publisher -ne 'integratedpower') {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason 'publisher is not the canonical integratedpower namespace'
    }
    if ([string]$package.displayName -ne 'Integrated Power') {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason 'displayName is not the canonical Integrated Power brand'
    }
    $keywords = @($package.keywords | ForEach-Object { [string]$_ })
    foreach ($requiredKeyword in @('integrated power', 'integratedpower')) {
        if ($keywords -notcontains $requiredKeyword) {
            Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason "required discovery keyword is missing: $requiredKeyword"
        }
    }
    if ([string]$package.repository.url -ne $expectedRepository) {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason 'repository.url is not the approved public repository URL'
    }
    if ([string]$package.homepage -ne $expectedHomepage) {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason 'homepage is not the approved public repository URL'
    }
    if ([string]$package.bugs.url -ne $expectedBugs) {
        Add-ContentViolation -RelativePath 'vscode-extension/package.json' -Reason 'bugs.url is not the approved public repository URL'
    }
}

function Test-PublicContent {
    $script:Violations = @()
    Test-PackageRepositoryMetadata

    $approvedOwnerUrlPattern = (
        'https://github\.com/R-Github04/integrated-power-antigravity' +
        '(?:\.git|#readme|/issues(?:/new\?template=commercial-license\.yml)?)?'
    )
    $scannedSources = @{}
    foreach ($mapping in $script:Mappings) {
        $sourceKey = $mapping.Source.ToLowerInvariant()
        if ($scannedSources.ContainsKey($sourceKey)) {
            continue
        }
        $scannedSources[$sourceKey] = $true
        $relative = [string]$mapping.SourceRelative
        $text = Get-ScanText -PathValue $mapping.Source
        $scanText = $text
        $scanText = [regex]::Replace(
            $scanText,
            $approvedOwnerUrlPattern,
            '',
            [Text.RegularExpressions.RegexOptions]::IgnoreCase
        )
        if (
            $relative -eq 'vscode-extension/scripts/run-headless-tests.js' -or
            $relative -eq 'vscode-extension/src/test/suite/parser.test.ts'
        ) {
            $scanText = $scanText.Replace('C:\\Users\\tester', '')
            $scanText = $scanText.Replace('C:\Users\tester', '')
            $scanText = $scanText.Replace('C:/Users/tester', '')
        }

        if ($scanText -match '(?i)\b(?:jsp0|yip1004)\b') {
            Add-ContentViolation -RelativePath $relative -Reason 'personal identifier'
        }
        if ($scanText -match '(?i)\bR-Github04\b') {
            Add-ContentViolation -RelativePath $relative -Reason 'GitHub owner appears outside approved package metadata URLs'
        }
        if ($scanText -match '(?i)[A-Z]:[\\/]+Users[\\/]+[^\\/\s"''<>]+') {
            Add-ContentViolation -RelativePath $relative -Reason 'absolute Windows user path'
        }
        if ($scanText -match '(?i)(?:^|[\s"''])(?:/home/[^/\s"''<>]+|/Users/[^/\s"''<>]+)') {
            Add-ContentViolation -RelativePath $relative -Reason 'absolute Unix/macOS user path'
        }
        $isDependencyLock = $relative -eq 'vscode-extension/pnpm-lock.yaml'
        if (
            -not $isDependencyLock -and
            $scanText -match '(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b(?!:)'
        ) {
            Add-ContentViolation -RelativePath $relative -Reason 'email address'
        }

        $strongSecretPatterns = @(
            '(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----',
            '\bAKIA[0-9A-Z]{16}\b',
            '\bAIza[0-9A-Za-z_-]{35}\b',
            '\bgh[pousr]_[A-Za-z0-9]{20,}\b',
            '\bsk-[A-Za-z0-9_-]{20,}\b',
            '\bxox[baprs]-[A-Za-z0-9-]{20,}\b',
            '\bGOCSPX-[A-Za-z0-9_-]{20,}\b'
        )
        foreach ($pattern in $strongSecretPatterns) {
            if ($scanText -match $pattern) {
                Add-ContentViolation -RelativePath $relative -Reason 'secret-like literal'
                break
            }
        }

        $assignmentPattern = '(?i)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key)\s*[:=]\s*["'']([^"'']{8,})["'']'
        foreach ($match in [regex]::Matches($scanText, $assignmentPattern)) {
            $value = [string]$match.Groups[1].Value
            $placeholder = (
                $value -match '(?i)(?:placeholder|example|your[_-]|<[^>]+>|\$\{|process\.env|env:|%[A-Z_]+%)'
            )
            if (-not $placeholder) {
                Add-ContentViolation -RelativePath $relative -Reason 'assigned secret-like literal'
                break
            }
        }
    }

    if ($script:Violations.Count -gt 0) {
        $details = $script:Violations -join [Environment]::NewLine
        throw "Public export privacy scan failed:`n$details"
    }
}

function Initialize-PublicAllowlist {
    $metadataNames = @(
        'README.md',
        'LICENSE',
        'NOTICE.md',
        'SECURITY.md',
        'SUPPORT.md',
        'CHANGELOG.md',
        'COMMERCIAL-LICENSING.md'
    )
    foreach ($name in $metadataNames) {
        Add-PublicFile -SourceRelativePath "vscode-extension/$name" -TargetRelativePath $name
        Add-PublicFile -SourceRelativePath "vscode-extension/$name" -TargetRelativePath "vscode-extension/$name"
    }

    foreach ($name in @(
        '.vscodeignore',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'tsconfig.json'
    )) {
        Add-PublicFile -SourceRelativePath "vscode-extension/$name" -TargetRelativePath "vscode-extension/$name"
    }

    foreach ($name in @(
        'build-extension.js',
        'run-headless-tests.js',
        'read-agy-credential.ps1'
    )) {
        Add-PublicFile `
            -SourceRelativePath "vscode-extension/scripts/$name" `
            -TargetRelativePath "vscode-extension/scripts/$name"
    }

    Add-PublicTree -SourceRelativeRoot 'vscode-extension/src' -TargetRelativeRoot 'vscode-extension/src'
    Add-PublicTree -SourceRelativeRoot 'vscode-extension/assets' -TargetRelativeRoot 'vscode-extension/assets'
    Add-PublicTree -SourceRelativeRoot 'vscode-extension/webview' -TargetRelativeRoot 'vscode-extension/webview'
    Add-PublicTree -SourceRelativeRoot 'vscode-extension/images' -TargetRelativeRoot 'vscode-extension/images'

    foreach ($name in @(
        '01-INSTALL.cmd',
        '02-VERIFY-ONLY.cmd',
        '99-UNINSTALL-EXTENSION-ONLY.cmd',
        'EggR.Win11Distribution.psm1',
        'Install-EggRWin11.ps1',
        'New-EggRWin11Release.ps1',
        'README-FIRST.ko.md',
        'Uninstall-EggRWin11.ps1'
    )) {
        Add-PublicFile `
            -SourceRelativePath "distribution/win11/$name" `
            -TargetRelativePath "distribution/win11/$name"
    }

    foreach ($name in @(
        'docs/reference/eggr-plugin-distribution.ko.md',
        'docs/reference/eggr-telemetry.ko.md',
        'docs/reference/token-measurement.md'
    )) {
        Add-PublicFile -SourceRelativePath $name -TargetRelativePath $name
    }

    Add-PublicTemplateTree
}

function Assert-StagingPath {
    param([Parameter(Mandatory = $true)][string]$StagingPath)

    $workspace = [IO.Path]::GetFullPath($script:WorkspaceRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $candidate = [IO.Path]::GetFullPath($StagingPath)
    $expectedPrefix = '.integrated-power-antigravity-public.eggr-stage-'
    if (
        -not $candidate.StartsWith($workspace, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($candidate)).StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)
    ) {
        throw "Unsafe staging path: $StagingPath"
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
        $TargetRoot = $script:ExpectedTargetRoot
    }
    $resolvedTarget = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\', '/')
    if (-not $resolvedTarget.Equals($script:ExpectedTargetRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "TargetRoot must be exactly: $($script:ExpectedTargetRoot)"
    }
    if (
        (Test-Path -LiteralPath $resolvedTarget) -and
        -not $DryRun -and
        -not [bool]$WhatIfPreference
    ) {
        throw "The public target already exists and will not be overwritten: $resolvedTarget"
    }

    Initialize-PublicAllowlist
    Test-PublicContent

    $preview = $DryRun -or [bool]$WhatIfPreference
    $result = [ordered]@{
        schemaVersion = 1
        sourceRoot    = $script:RepositoryRoot
        targetRoot    = $resolvedTarget
        fileCount     = $script:Mappings.Count
        privacyScan   = 'passed'
        mode          = if ($preview) { 'dry-run' } else { 'export' }
        activated     = $false
        gitInitialized = $false
        remoteConfigured = $false
        pushed        = $false
    }

    if ($preview) {
        Write-ExportMessage 'OK' "Dry-run passed for $($script:Mappings.Count) allowlisted files."
    } else {
        $stagingRoot = Join-Path $script:WorkspaceRoot (
            '.integrated-power-antigravity-public.eggr-stage-' + [Guid]::NewGuid().ToString('N')
        )
        Assert-StagingPath -StagingPath $stagingRoot
        try {
            New-Item -ItemType Directory -Path $stagingRoot | Out-Null
            foreach ($mapping in $script:Mappings) {
                $destination = Get-SafeChildPath -Root $stagingRoot -RelativePath $mapping.TargetRelative
                $destinationParent = Split-Path -Parent $destination
                if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
                    New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
                }
                Copy-Item -LiteralPath $mapping.Source -Destination $destination
                $copiedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToUpperInvariant()
                if ($copiedHash -ne $mapping.Sha256) {
                    throw "Staging copy hash mismatch: $($mapping.TargetRelative)"
                }
            }

            if ($PSCmdlet.ShouldProcess($resolvedTarget, 'Activate sanitized public source export')) {
                [IO.Directory]::Move($stagingRoot, $resolvedTarget)
                $result.activated = $true
                Write-ExportMessage 'OK' "Public source export activated: $resolvedTarget"
            }
        } finally {
            if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
                Assert-StagingPath -StagingPath $stagingRoot
                Remove-Item -LiteralPath $stagingRoot -Recurse -Force
            }
        }
    }

    if ($Json) {
        [PSCustomObject]$result | ConvertTo-Json -Depth 5
    } else {
        [PSCustomObject]$result
    }
} catch {
    if ($Json) {
        [PSCustomObject]@{
            schemaVersion = 1
            ok            = $false
            error         = $_.Exception.Message
        } | ConvertTo-Json -Depth 4
    } else {
        Write-Error $_.Exception.Message
    }
    exit 1
}

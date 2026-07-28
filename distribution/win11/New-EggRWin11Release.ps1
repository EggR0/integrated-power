<#
.SYNOPSIS
    Builds a self-contained Windows 11 direct-distribution ZIP.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$VsixPath,
    [Parameter(Mandatory = $true)][string]$KnowledgeBootstrapRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$ReleaseVersion = '',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SafeChildPath {
    param([string]$Parent, [string]$Child)
    $root = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $candidate = [IO.Path]::GetFullPath((Join-Path $root $Child))
    if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Output path escaped the requested directory: $candidate"
    }
    return $candidate
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Copy-PowerShell5CompatibleFile {
    param([string]$Source, [string]$Destination)
    $text = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
    [IO.File]::WriteAllText($Destination, $text, (New-Object Text.UTF8Encoding($true)))
}

$sourceRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $sourceRoot
$packageJsonPath = Join-Path $repositoryRoot 'vscode-extension\package.json'
if (-not (Test-Path -LiteralPath $VsixPath -PathType Leaf)) {
    throw "VSIX does not exist: $VsixPath"
}
if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    throw "Extension package.json does not exist: $packageJsonPath"
}
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($ReleaseVersion)) {
    $ReleaseVersion = [string]$packageJson.version
}
if ([string]$packageJson.publisher + '.' + [string]$packageJson.name -ne 'EggR.integrated-power') {
    throw 'Unexpected extension identity in package.json.'
}
if ([string]$packageJson.version -ne $ReleaseVersion) {
    throw "package.json version $($packageJson.version) does not match requested release $ReleaseVersion."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$vsixArchive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($VsixPath))
try {
    $vsixPackageEntry = @($vsixArchive.Entries | Where-Object {
        $_.FullName -eq 'extension/package.json'
    })
    if ($vsixPackageEntry.Count -ne 1) {
        throw 'The VSIX does not contain exactly one extension/package.json.'
    }
    $reader = New-Object IO.StreamReader($vsixPackageEntry[0].Open(), [Text.Encoding]::UTF8)
    try {
        $vsixPackageJson = $reader.ReadToEnd() | ConvertFrom-Json
    } finally {
        $reader.Dispose()
    }
} finally {
    $vsixArchive.Dispose()
}
$vsixExtensionId = [string]$vsixPackageJson.publisher + '.' + [string]$vsixPackageJson.name
if ($vsixExtensionId -ne 'EggR.integrated-power') {
    throw "Unexpected extension identity inside VSIX: $vsixExtensionId"
}
if ([string]$vsixPackageJson.version -ne $ReleaseVersion) {
    throw "VSIX version $($vsixPackageJson.version) does not match requested release $ReleaseVersion."
}

$knowledgeScripts = @(
    'eggr-roots.ps1',
    'set-eggr-roots.ps1',
    'initialize-eggr-knowledge.ps1',
    'route-knowledge.ps1',
    'save-knowledge.ps1',
    'save-agent-worklog.ps1'
)
foreach ($scriptName in $knowledgeScripts) {
    $source = Join-Path $KnowledgeBootstrapRoot "scripts\$scriptName"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Knowledge bootstrap payload is missing: $source"
    }
    & git -C $KnowledgeBootstrapRoot ls-files --error-unmatch -- "scripts/$scriptName" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Knowledge bootstrap payload is not tracked by Git: scripts/$scriptName"
    }
}
$knowledgeCommit = (& git -C $KnowledgeBootstrapRoot rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $knowledgeCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Knowledge bootstrap source must be a Git working tree with a resolvable commit.'
}
$knowledgeRelativePaths = @($knowledgeScripts | ForEach-Object { "scripts/$_" })
& git -C $KnowledgeBootstrapRoot diff --quiet -- @knowledgeRelativePaths
if ($LASTEXITCODE -ne 0) {
    throw 'Knowledge bootstrap payload has uncommitted working-tree changes; commit or revert only those source files before packaging.'
}
& git -C $KnowledgeBootstrapRoot diff --cached --quiet -- @knowledgeRelativePaths
if ($LASTEXITCODE -ne 0) {
    throw 'Knowledge bootstrap payload has staged changes not represented by sourceCommit.'
}

$releaseName = "Integrated-Power-$ReleaseVersion-win11"
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$stageRoot = Get-SafeChildPath -Parent $outputRoot -Child $releaseName
$zipPath = Get-SafeChildPath -Parent $outputRoot -Child ($releaseName + '.zip')
$zipHashPath = $zipPath + '.sha256.txt'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

foreach ($existing in @($stageRoot, $zipPath, $zipHashPath)) {
    if (Test-Path -LiteralPath $existing) {
        if (-not $Force) {
            throw "Release output already exists. Use -Force after reviewing it: $existing"
        }
        if ((Get-Item -LiteralPath $existing).PSIsContainer) {
            Remove-Item -LiteralPath $existing -Recurse -Force
        } else {
            Remove-Item -LiteralPath $existing -Force
        }
    }
}

New-Item -ItemType Directory -Path $stageRoot | Out-Null
$payloadRoot = Join-Path $stageRoot 'payload\knowledge-tools'
New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null

$distributionFiles = @(
    'EggR.Win11Distribution.psm1',
    'Install-EggRWin11.ps1',
    'Uninstall-EggRWin11.ps1',
    '01-INSTALL.cmd',
    '02-VERIFY-ONLY.cmd',
    '99-UNINSTALL-EXTENSION-ONLY.cmd',
    'README-FIRST.ko.md'
)
foreach ($fileName in $distributionFiles) {
    $source = Join-Path $PSScriptRoot $fileName
    $destination = Join-Path $stageRoot $fileName
    if ([IO.Path]::GetExtension($fileName) -in @('.ps1', '.psm1')) {
        Copy-PowerShell5CompatibleFile -Source $source -Destination $destination
    } else {
        Copy-Item -LiteralPath $source -Destination $destination
    }
}

$vsixName = [IO.Path]::GetFileName($VsixPath)
Copy-Item -LiteralPath $VsixPath -Destination (Join-Path $stageRoot $vsixName)
foreach ($scriptName in $knowledgeScripts) {
    Copy-PowerShell5CompatibleFile `
        -Source (Join-Path $KnowledgeBootstrapRoot "scripts\$scriptName") `
        -Destination (Join-Path $payloadRoot $scriptName)
    $commandName = [IO.Path]::GetFileNameWithoutExtension($scriptName)
    $launcher = "@echo off`r`npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"%~dp0$scriptName`" %*`r`n"
    Write-Utf8NoBom -Path (Join-Path $payloadRoot "$commandName.cmd") -Text $launcher
}

$inventory = @()
foreach ($file in @(Get-ChildItem -LiteralPath $stageRoot -File -Recurse | Sort-Object FullName)) {
    $relative = $file.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
    $role = if ($relative -eq $vsixName) {
        'dashboard-vsix'
    } elseif ($relative.StartsWith('payload/knowledge-tools/')) {
        'knowledge-tool'
    } elseif ($relative -eq 'README-FIRST.ko.md') {
        'documentation'
    } else {
        'installer'
    }
    $inventory += [ordered]@{
        path   = $relative
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        role   = $role
    }
}

$knowledgeMappings = @()
foreach ($scriptName in $knowledgeScripts) {
    $commandName = [IO.Path]::GetFileNameWithoutExtension($scriptName)
    foreach ($target in @($scriptName, "$commandName.cmd")) {
        $knowledgeMappings += [ordered]@{
            source = "payload/knowledge-tools/$target"
            target = $target
        }
    }
}

$manifest = [ordered]@{
    schemaVersion  = 1
    productId      = 'integrated-power'
    releaseVersion = $ReleaseVersion
    platform       = 'windows-11'
    architecture   = 'any'
    generatedAt    = [DateTime]::UtcNow.ToString('o')
    extension      = [ordered]@{
        id       = 'EggR.integrated-power'
        version  = $ReleaseVersion
        vsixFile = $vsixName
        sha256   = (Get-FileHash -LiteralPath (Join-Path $stageRoot $vsixName) -Algorithm SHA256).Hash
    }
    knowledgeTools = [ordered]@{
        sourceRepository = 'environment-bootstrap'
        sourceCommit     = $knowledgeCommit
        files            = @($knowledgeMappings)
    }
    files           = @($inventory)
}
$manifestPath = Join-Path $stageRoot 'release-manifest.json'
Write-Utf8NoBom -Path $manifestPath -Text ($manifest | ConvertTo-Json -Depth 8)

$checksumLines = @()
foreach ($file in @(Get-ChildItem -LiteralPath $stageRoot -File -Recurse | Sort-Object FullName)) {
    $relative = $file.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
    $checksumLines += "$(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256 | Select-Object -ExpandProperty Hash)  $relative"
}
Write-Utf8NoBom -Path (Join-Path $stageRoot 'SHA256SUMS.txt') -Text (($checksumLines -join "`r`n") + "`r`n")

Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Write-Utf8NoBom -Path $zipHashPath -Text "$zipHash  $([IO.Path]::GetFileName($zipPath))`r`n"

[PSCustomObject]@{
    releaseDirectory = $stageRoot
    zipPath          = $zipPath
    zipSha256        = $zipHash
    zipHashFile      = $zipHashPath
    extensionVersion = $ReleaseVersion
    knowledgeCommit  = $knowledgeCommit
}

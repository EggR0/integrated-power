param(
    [string]$TargetFile = "",

    [string[]]$Files = @(),

    [ValidateSet("coding", "review", "planning", "design", "test_generation", "docs", "debugging")]
    [string]$TaskKind = "coding",

    [string]$RegistryFile = "",

    [switch]$Strict,

    [switch]$AsJson
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Get-RepoRoot {
    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            return ($gitRoot | Select-Object -First 1).Trim()
        }
    }
    catch {
    }

    return (Get-Location).Path
}

function Resolve-WorkspacePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RepoRoot, $Path))
}

function ConvertTo-SingleQuotedPowerShellLiteral {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function ConvertTo-RepoRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ($fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $fullPath.Substring($root.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
        return ($relative -replace "\\", "/")
    }

    return ($fullPath -replace "\\", "/")
}

function Test-PathPattern {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,

        [Parameter(Mandatory = $true)]
        [string]$Pattern
    )

    $normalizedPattern = ($Pattern -replace "\\", "/").Trim()
    if ([string]::IsNullOrWhiteSpace($normalizedPattern)) { return $false }

    if ($RelativePath -like $normalizedPattern) { return $true }
    if ($normalizedPattern.EndsWith("/*")) {
        $prefix = $normalizedPattern.Substring(0, $normalizedPattern.Length - 1)
        return $RelativePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    }

    return $false
}

function Expand-ValidatorCommandTemplate {
    param(
        [string]$Command,
        [string]$RepoRoot
    )

    if ([string]::IsNullOrWhiteSpace($Command)) { return "" }

    return $Command.Replace("{{RepoRoot}}", $RepoRoot)
}

function Select-RegistryValidator {
    param(
        [string]$Path,
        [string]$RepoRoot,
        [string]$RegistryFile,
        [switch]$Strict
    )

    if ([string]::IsNullOrWhiteSpace($RegistryFile) -or !(Test-Path -LiteralPath $RegistryFile)) {
        return $null
    }

    $relativePath = ConvertTo-RepoRelativePath -Path $Path -RepoRoot $RepoRoot
    $rows = @(Import-Csv -LiteralPath $RegistryFile)
    foreach ($row in $rows) {
        if (!(Test-PathPattern -RelativePath $relativePath -Pattern ([string]$row.PathPattern))) {
            continue
        }

        $command = [string]$row.ValidationCommand
        $timeout = 120
        [int]::TryParse([string]$row.ValidationTimeoutSeconds, [ref]$timeout) | Out-Null

        if ($Strict -and ![string]::IsNullOrWhiteSpace([string]$row.StrictValidationCommand)) {
            $command = [string]$row.StrictValidationCommand
            [int]::TryParse([string]$row.StrictValidationTimeoutSeconds, [ref]$timeout) | Out-Null
        }

        return [PSCustomObject]@{
            ValidatorProfile = [string]$row.ValidatorProfile
            ValidationCommand = Expand-ValidatorCommandTemplate -Command $command -RepoRoot $RepoRoot
            ValidationTimeoutSeconds = $timeout
            Source = "registry:$($row.PathPattern)"
            Reason = "Matched validator registry pattern '$($row.PathPattern)'. $($row.Description)"
        }
    }

    return $null
}

function Find-NearestPackageJson {
    param(
        [string]$StartPath,
        [string]$StopAt
    )

    $path = $StartPath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $path = Split-Path -Parent $path
    }

    $stopPath = if (![string]::IsNullOrWhiteSpace($StopAt)) {
        [System.IO.Path]::GetFullPath($StopAt).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    } else {
        ""
    }

    while (![string]::IsNullOrWhiteSpace($path)) {
        $candidate = Join-Path $path "package.json"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }

        $current = [System.IO.Path]::GetFullPath($path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
        if (![string]::IsNullOrWhiteSpace($stopPath) -and $current -ieq $stopPath) {
            break
        }

        $parent = Split-Path -Parent $path
        if ($parent -eq $path) { break }
        $path = $parent
    }

    return ""
}

function Get-PackageScripts {
    param([string]$PackageJson)

    try {
        $pkg = Get-Content -LiteralPath $PackageJson -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($pkg.scripts) {
            return @($pkg.scripts.PSObject.Properties.Name)
        }
    }
    catch {
    }

    return @()
}

$repoRoot = Get-RepoRoot
if ([string]::IsNullOrWhiteSpace($RegistryFile)) {
    $RegistryFile = Join-Path $repoRoot "config\agentic_validator_registry.csv"
}
$normalizedFiles = @()
if (![string]::IsNullOrWhiteSpace($TargetFile)) {
    $normalizedFiles += $TargetFile
}
$normalizedFiles += @($Files)
$normalizedFiles = @($normalizedFiles | ForEach-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return }
    [string]$_ -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
} | Select-Object -Unique)

$resolvedFiles = @($normalizedFiles | ForEach-Object { Resolve-WorkspacePath -Path $_ -RepoRoot $repoRoot })
$extensions = @($resolvedFiles | ForEach-Object { [System.IO.Path]::GetExtension($_).ToLowerInvariant() } | Where-Object { $_ } | Select-Object -Unique)
$unsupportedExtensions = @($extensions | Where-Object { $_ -notin @(".ps1", ".psm1", ".psd1", ".json", ".md", ".txt") })
$powershellExtensions = @($extensions | Where-Object { $_ -in @(".ps1", ".psm1", ".psd1") })

$profile = "syntax"
$command = ""
$timeout = 120
$reason = "Defaulted to syntax validation because no stronger project validator was detected."
$validatorSource = "default"

$registryMatch = $null
foreach ($file in $resolvedFiles) {
    $registryMatch = Select-RegistryValidator -Path $file -RepoRoot $repoRoot -RegistryFile $RegistryFile -Strict:$Strict
    if ($null -ne $registryMatch) { break }
}

if ($null -ne $registryMatch) {
    $profile = [string]$registryMatch.ValidatorProfile
    $command = [string]$registryMatch.ValidationCommand
    $timeout = [int]$registryMatch.ValidationTimeoutSeconds
    $reason = [string]$registryMatch.Reason
    $validatorSource = [string]$registryMatch.Source
}
else {
    $packageCandidates = @($resolvedFiles | ForEach-Object { Find-NearestPackageJson -StartPath $_ -StopAt $repoRoot } | Where-Object { $_ } | Select-Object -Unique)
    if ($packageCandidates.Count -gt 0) {
    $packageJson = $packageCandidates | Sort-Object { $_.Length } -Descending | Select-Object -First 1
    $packageDir = Split-Path -Parent $packageJson
    $scripts = @(Get-PackageScripts -PackageJson $packageJson)
    $scriptName = ""

    if ($Strict -and ($scripts -contains "test")) {
        $scriptName = "test"
    }
    elseif ($scripts -contains "compile") {
        $scriptName = "compile"
    }
    elseif ($scripts -contains "test") {
        $scriptName = "test"
    }

    if (![string]::IsNullOrWhiteSpace($scriptName)) {
        $quotedDir = ConvertTo-SingleQuotedPowerShellLiteral -Value $packageDir
        $command = "try { Push-Location $quotedDir; npm run $scriptName } finally { Pop-Location }"
        $profile = "syntax_and_command"
        $timeout = if ($scriptName -eq "test") { 300 } else { 180 }
        $reason = "Detected package.json at $packageJson with '$scriptName' script."
        $validatorSource = "package.json:$scriptName"
    }
    }
    elseif ($extensions.Count -gt 0 -and $unsupportedExtensions.Count -eq 0) {
        if ($extensions -contains ".json") {
            $profile = "syntax"
            $reason = "Only PowerShell/JSON/text-like files detected; built-in syntax validators are sufficient."
            $validatorSource = "builtin-syntax"
        }
        elseif ($powershellExtensions.Count -gt 0) {
            $profile = "syntax"
            $reason = "PowerShell file detected; using built-in scriptblock syntax validation."
            $validatorSource = "builtin-powershell"
        }
    }
}

$result = [pscustomobject]@{
    ValidatorProfile = $profile
    ValidationCommand = $command
    ValidationTimeoutSeconds = $timeout
    Reason = $reason
    Source = $validatorSource
    RegistryFile = $RegistryFile
    Files = $resolvedFiles
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 6
}
else {
    $result
}

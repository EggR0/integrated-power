<#
.SYNOPSIS
    Removes only the EggR Dashboard extension from Antigravity IDE.
.DESCRIPTION
    The EggR Orchestrator plugin, Private Knowledge repository, roots.json,
    runtime state, installation backups, and GEMINI.md are deliberately kept.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$PackageDirectory = '',
    [string]$AntigravityCli = '',
    [switch]$VerifyOnly,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-EggRMessage {
    param([string]$State, [string]$Message)
    if (-not $Json) {
        Write-Host "[$State] $Message"
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($PackageDirectory)) {
        $PackageDirectory = $PSScriptRoot
    }
    Import-Module (Join-Path $PSScriptRoot 'EggR.Win11Distribution.psm1') -Force
    $release = Read-EggRRelease -PackageDirectory $PackageDirectory
    $cli = Resolve-EggRAntigravityIdeCli -ExplicitPath $AntigravityCli
    $extensionId = [string]$release.Manifest.extension.id
    $catalog = Get-EggRExtensionCatalog -CliPath $cli
    $installedBefore = if ($catalog.ContainsKey($extensionId)) { [string]$catalog[$extensionId] } else { '' }

    $result = [ordered]@{
        schemaVersion     = 1
        mode              = if ($VerifyOnly) { 'verify-only' } else { 'uninstall-extension-only' }
        packageVerified   = $true
        extensionId       = $extensionId
        installedBefore   = $installedBefore
        installedAfter    = $installedBefore
        extensionAction   = 'none'
        preserved         = @(
            '%USERPROFILE%\.gemini\GEMINI.md',
            '%USERPROFILE%\.gemini\config\plugins\ip-orchestrator-plugin',
            '%USERPROFILE%\.gemini\config\plugins\eggr-orchestrator-plugin',
            '%USERPROFILE%\.config\integrated-power',
            '%USERPROFILE%\.config\eggr',
            '%LOCALAPPDATA%\IntegratedPower',
            '%LOCALAPPDATA%\EggR',
            '사용자가 선택한 Private Knowledge 저장소'
        )
    }

    if ($VerifyOnly) {
        $result.extensionAction = if ([string]::IsNullOrWhiteSpace($installedBefore)) { 'already-absent' } else { 'would-uninstall' }
    } elseif ([string]::IsNullOrWhiteSpace($installedBefore)) {
        $result.extensionAction = 'already-absent'
    } elseif ($PSCmdlet.ShouldProcess(
        "$extensionId@$installedBefore",
        'Uninstall only the Dashboard extension from Antigravity IDE'
    )) {
        Invoke-EggRAntigravityIdeCli -CliPath $cli -Arguments @(
            '--uninstall-extension',
            $extensionId
        ) | ForEach-Object { Write-EggRMessage 'IDE' $_ }
        $catalogAfter = Get-EggRExtensionCatalog -CliPath $cli
        if ($catalogAfter.ContainsKey($extensionId)) {
            throw "The Dashboard extension is still installed: $($catalogAfter[$extensionId])"
        }
        $result.installedAfter = ''
        $result.extensionAction = 'uninstalled'
    } else {
        $result.extensionAction = 'what-if'
    }

    if ($Json) {
        [PSCustomObject]$result | ConvertTo-Json -Depth 6
    } else {
        Write-EggRMessage 'OK' "확장 동작: $($result.extensionAction)"
        Write-EggRMessage 'PRESERVE' 'Orchestrator, Knowledge, EggR 설정·상태·백업, GEMINI.md는 제거하지 않았습니다.'
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

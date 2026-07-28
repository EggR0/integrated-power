<#
.SYNOPSIS
    Installs or verifies the pinned EggR Antigravity IDE Dashboard release.
.DESCRIPTION
    Verifies every payload SHA-256 before installing the Dashboard VSIX and the
    first-party Windows Private Knowledge commands. It does not start the
    separate Antigravity application, write GEMINI.md, configure credentials,
    install GPU drivers, or install optional third-party tools.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$PackageDirectory = '',
    [string]$AntigravityCli = '',
    [switch]$VerifyOnly,
    [switch]$SkipKnowledgeTools,
    [switch]$SkipUserPath,
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
    $modulePath = Join-Path $PSScriptRoot 'EggR.Win11Distribution.psm1'
    Import-Module $modulePath -Force

    Write-EggRMessage 'VERIFY' '배포 파일 SHA-256을 확인합니다.'
    $release = Read-EggRRelease -PackageDirectory $PackageDirectory
    $cli = Resolve-EggRAntigravityIdeCli -ExplicitPath $AntigravityCli
    $catalog = Get-EggRExtensionCatalog -CliPath $cli
    $extensionId = [string]$release.Manifest.extension.id
    $targetVersion = [string]$release.Manifest.extension.version
    $installedVersion = if ($catalog.ContainsKey($extensionId)) {
        [string]$catalog[$extensionId]
    } else {
        ''
    }
    $dependencies = Get-EggRDependencyStatus -AntigravityCli $cli
    $knowledgeStatus = if ($SkipKnowledgeTools) {
        $null
    } else {
        Get-EggRKnowledgeToolStatus -Release $release
    }

    $result = [ordered]@{
        schemaVersion      = 1
        mode               = if ($VerifyOnly) { 'verify-only' } else { 'install' }
        packageVerified    = $true
        releaseVersion     = [string]$release.Manifest.releaseVersion
        extensionId        = $extensionId
        targetVersion      = $targetVersion
        installedBefore    = $installedVersion
        installedAfter     = $installedVersion
        extensionAction    = 'none'
        knowledgeAction    = if ($SkipKnowledgeTools) { 'skipped' } else { 'pending' }
        knowledgeTarget    = if ($knowledgeStatus) { $knowledgeStatus.targetRoot } else { '' }
        knowledgeBackup    = ''
        knowledgeStatus    = $knowledgeStatus
        antigravityIdeCli  = $cli
        dependencies       = @($dependencies)
        geminiMdModified   = $false
        nextAction         = ''
    }

    if ($VerifyOnly) {
        $result.knowledgeAction = if ($SkipKnowledgeTools) {
            'skipped'
        } elseif ($knowledgeStatus.current -and ($SkipUserPath -or $knowledgeStatus.userPathPresent)) {
            'already-current'
        } else {
            'needs-install-or-repair'
        }
        $result.extensionAction = if ($installedVersion -eq $targetVersion) {
            'already-current'
        } elseif ([string]::IsNullOrWhiteSpace($installedVersion)) {
            'would-install'
        } else {
            'would-update'
        }
        $result.nextAction = '검증만 수행했으며 시스템을 변경하지 않았습니다.'
    } else {
        if ($installedVersion -eq $targetVersion) {
            $result.extensionAction = 'already-current'
            Write-EggRMessage 'OK' "Dashboard $targetVersion 이(가) 이미 설치되어 있습니다."
        } elseif ($PSCmdlet.ShouldProcess(
            "$extensionId@$targetVersion",
            'Install the pinned VSIX into Antigravity IDE'
        )) {
            Write-EggRMessage 'INSTALL' "Dashboard $targetVersion 을(를) Antigravity IDE에 설치합니다."
            Invoke-EggRAntigravityIdeCli -CliPath $cli -Arguments @(
                '--install-extension',
                $release.VsixPath,
                '--force'
            ) | ForEach-Object { Write-EggRMessage 'IDE' $_ }
            $result.extensionAction = if ([string]::IsNullOrWhiteSpace($installedVersion)) { 'installed' } else { 'updated' }
        } else {
            $result.extensionAction = 'what-if'
        }

        if ($result.extensionAction -ne 'what-if') {
            $catalogAfter = Get-EggRExtensionCatalog -CliPath $cli
            $installedAfter = if ($catalogAfter.ContainsKey($extensionId)) {
                [string]$catalogAfter[$extensionId]
            } else {
                ''
            }
            $result.installedAfter = $installedAfter
            if ($installedAfter -ne $targetVersion) {
                throw "Dashboard verification failed. Expected $targetVersion, found '$installedAfter'."
            }
        }

        if (-not $SkipKnowledgeTools) {
            if ($PSCmdlet.ShouldProcess(
                '%LOCALAPPDATA%\IntegratedPower\bin',
                'Install or update the pinned EggR Private Knowledge commands'
            )) {
                $knowledge = Install-EggRKnowledgeTools -Release $release -SkipUserPath:$SkipUserPath
                $result.knowledgeAction = if ($knowledge.changed.Count -gt 0) { 'installed-or-updated' } else { 'already-current' }
                $result.knowledgeTarget = $knowledge.targetRoot
                $result.knowledgeBackup = $knowledge.backupRoot
                $result.knowledgeStatus = Get-EggRKnowledgeToolStatus -Release $release
            } else {
                $result.knowledgeAction = 'what-if'
            }
        }
        $result.nextAction = 'Antigravity IDE에서 Developer: Reload Window를 실행한 뒤 EggR: Open Configuration Center를 여세요.'
    }

    if ($Json) {
        [PSCustomObject]$result | ConvertTo-Json -Depth 7
    } else {
        Write-EggRMessage 'OK' "패키지 무결성: 정상"
        Write-EggRMessage 'OK' "확장: $extensionId@$($result.installedAfter)"
        Write-EggRMessage 'INFO' "Knowledge 도구: $($result.knowledgeAction)"
        Write-EggRMessage 'BOUNDARY' 'GEMINI.md, roots.json, Knowledge 내용은 수정하지 않았습니다.'
        Write-EggRMessage 'NEXT' $result.nextAction
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

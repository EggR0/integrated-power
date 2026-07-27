Import-Module (Join-Path $PSScriptRoot "EggR.Paths.psm1") -Force -DisableNameChecking

function Get-GlobalStorage {
    param([string]$RepoRoot = (Get-Location).Path)

    return Get-EggRWorkspaceStatePath -RepoRoot $RepoRoot
}
Export-ModuleMember -Function Get-GlobalStorage

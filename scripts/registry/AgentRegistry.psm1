$script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Import-Module (Join-Path $script:repoRoot "scripts\util\GlobalStorage.psm1") -DisableNameChecking
$script:globalStorageDir = Get-GlobalStorage -RepoRoot $script:repoRoot
$script:registryDir = Join-Path $script:globalStorageDir ".agent-runs"
$script:registryFile = Join-Path $script:registryDir "runs.jsonl"
$script:lockFile = "$script:registryFile.lock"
function Initialize-Registry {
    if (-not (Test-Path -LiteralPath $script:registryDir)) {
        New-Item -ItemType Directory -Force -Path $script:registryDir | Out-Null
    }
}

function Invoke-WithRegistryLock {
    param([scriptblock]$ScriptBlock, [int]$TimeoutSeconds = 30)
    
    Initialize-Registry
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $stream = $null

    while ($null -eq $stream) {
        try {
            $stream = [IO.File]::Open($script:lockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        } catch [IO.IOException] {
            if ((Get-Date) -ge $deadline) { throw "Timed out waiting for registry lock." }
            Start-Sleep -Milliseconds 100
        }
    }

    try {
        & $ScriptBlock
    } finally {
        if ($stream) { $stream.Dispose() }
        if (Test-Path -LiteralPath $script:lockFile) {
            Remove-Item -LiteralPath $script:lockFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function New-AgentRun {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$RunId,
        [Parameter(Mandatory=$true)][string]$AgentSurface,
        [Parameter(Mandatory=$true)][string]$Kind,
        [string]$CommandInvoked = "",
        [string[]]$ContextFiles = @(),
        [string]$Status = "running"
    )

    $record = [ordered]@{
        run_id = $RunId
        created_at = (Get-Date).ToString("o")
        updated_at = (Get-Date).ToString("o")
        agent_surface = $AgentSurface
        kind = $Kind
        status = $Status
        command_invoked = $CommandInvoked
        context_files = $ContextFiles
    }

    $json = $record | ConvertTo-Json -Compress -Depth 5
    Invoke-WithRegistryLock {
        $enc = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::AppendAllText($script:registryFile, "$json`n", $enc)
    }
}

function Update-AgentRun {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$RunId,
        [string]$Status,
        [string]$ArtifactPath,
        [string]$ErrorMsg
    )

    # Note: To avoid parsing and rewriting the entire JSONL file in PowerShell, 
    # we use an event-sourcing pattern. We append a new state for the same run_id.
    # The reader (VS Code extension) will group by run_id and use the latest updated_at.
    
    $record = [ordered]@{
        run_id = $RunId
        updated_at = (Get-Date).ToString("o")
    }
    
    if ($PSBoundParameters.ContainsKey('Status')) { $record.status = $Status }
    if ($PSBoundParameters.ContainsKey('ArtifactPath')) { $record.artifact_path = $ArtifactPath }
    if ($PSBoundParameters.ContainsKey('ErrorMsg')) { $record.error = $ErrorMsg }

    $json = $record | ConvertTo-Json -Compress -Depth 5
    Invoke-WithRegistryLock {
        $enc = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::AppendAllText($script:registryFile, "$json`n", $enc)
    }
}

Export-ModuleMember -Function New-AgentRun, Update-AgentRun

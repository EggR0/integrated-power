param(
    [string]$PromptFile = "",
    [string]$PromptText = "",
    [string]$OutputFile = "",
    [string]$Model = "",
    [string]$SystemPrompt = "You are a helpful AI coding assistant.",
    [switch]$ForceRestart,
    [int]$NumCtx = 4096,
    [int]$MaxTokens = 0,
    [string]$TaskTitle = "Local LLM Inference",
    [string]$TaskScale = "Medium",
    [ValidateSet("summarization", "extraction", "coding", "reasoning", "korean", "long_context", "routing_review", "general")]
    [string]$TaskType = "general",
    [string]$SuccessRegex = "",
    [int]$MinOutputChars = 1,
    [string]$SelectedBy = "manual",
    [string]$SelectionReason = "",
    [string]$TaskKey = "",
    [ValidateSet("Coalesce", "Separate")]
    [string]$ArtifactPolicy = "Coalesce",
    [string]$ArtifactMode = "Replace",
    [string]$KeepAlive = "30m",
    [int]$ColdLoadTimeoutSeconds = 1800,
    [int]$TimeoutSeconds = 900,
    [int]$ConnectTimeoutSeconds = 2,
    [string[]]$ContextFile = @()
)

if ([string]::IsNullOrWhiteSpace($PromptFile) -and -not [string]::IsNullOrWhiteSpace($PromptText)) {
    $tempPrompt = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tempPrompt, $PromptText, [System.Text.Encoding]::UTF8)
    $PromptFile = $tempPrompt
}

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = ""
try {
    $repoRoot = (git rev-parse --show-toplevel 2>$null).Trim()
}
catch {
    # Not a git repo
}
if (!$repoRoot) {
    $repoRoot = $PWD.Path
}

Import-Module (Join-Path $PSScriptRoot "lib\EggR.Paths.psm1") -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot "lib\EggR.Settings.psm1") -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot "lib\IntegratedPower.Artifacts.psm1") -Force -DisableNameChecking
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot
$orchestratorSettings = Get-EggROrchestratorSettings
if (-not (Test-EggRRouteEnabled -Route "local_llm" -Settings $orchestratorSettings)) {
    throw "The local_llm route is disabled in $($orchestratorSettings.Path)."
}
if ([string]::IsNullOrWhiteSpace($Model)) {
    $configuredModel = if ($orchestratorSettings.LocalLlm -and $orchestratorSettings.LocalLlm.PSObject.Properties.Name -contains "Model") {
        [string]$orchestratorSettings.LocalLlm.Model
    } else { "" }
    if (-not [string]::IsNullOrWhiteSpace($configuredModel)) {
        $Model = $configuredModel
        if ($SelectedBy -eq "manual") { $SelectedBy = "user_default" }
    } else {
        $selector = Join-Path $PSScriptRoot "Select-LocalLLMModel.ps1"
        if (-not (Test-Path -LiteralPath $selector -PathType Leaf)) {
            throw "Automatic model selection was requested but the selector is missing: $selector"
        }
        $selection = (& $selector -TaskType $TaskType -TaskScale $TaskScale -InstalledOnly -AsJson) | ConvertFrom-Json
        $Model = [string]$selection.SelectedModel
        $SelectedBy = [string]$selection.SelectionBasis
        $SelectionReason = [string]$selection.Reason
    }
}

function Write-CsvRowWithRetry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [pscustomobject]$Row
    )

    $parentDir = Split-Path -Parent $Path
    if (![string]::IsNullOrWhiteSpace($parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }

    $retries = 5
    $written = $false
    while (-not $written -and $retries -gt 0) {
        try {
            if (-not (Test-Path -LiteralPath $Path)) {
                @($Row) | Export-Csv -LiteralPath $Path -NoTypeInformation -Encoding UTF8
            }
            else {
                @($Row) | Export-Csv -LiteralPath $Path -NoTypeInformation -Encoding UTF8 -Append
            }
            $written = $true
        }
        catch {
            $retries--
            if ($retries -eq 0) {
                Write-Warning "Could not write to CSV $Path`: $_"
            }
            else {
                Start-Sleep -Milliseconds 100
            }
        }
    }
}

function Initialize-LocalMetricsSchema {
    param(
        [Parameter(Mandatory = $true)]
        [string]$MetricsPath
    )

    $schemaHeader = "Timestamp,Model,ActualElapsedSeconds,TotalTokens,TaskType,Provider,Success,SuccessRegex,MinOutputChars,OutputChars,TokensPerSecond,SelectedBy,SelectionReason,PromptFile,OutputFile,ErrorMessage"
    if (-not (Test-Path -LiteralPath $MetricsPath)) {
        $parent = Split-Path -Parent $MetricsPath
        if (-not [string]::IsNullOrWhiteSpace($parent)) {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
        }
        [System.IO.File]::WriteAllText($MetricsPath, "$schemaHeader`r`n", [System.Text.Encoding]::UTF8)
        return
    }

    try {
        $existingHeader = (Get-Content -LiteralPath $MetricsPath -TotalCount 1).Trim()
        if ($existingHeader -ne $schemaHeader) {
            $backupPath = "$MetricsPath.bak"
            Copy-Item -LiteralPath $MetricsPath -Destination $backupPath -Force
            [System.IO.File]::WriteAllText($MetricsPath, "$schemaHeader`r`n", [System.Text.Encoding]::UTF8)
        }
    }
    catch {
        # best effort
    }
}

function Write-LocalLlmMetric {
    param(
        [Parameter(Mandatory = $true)]
        [string]$MetricsPath,
        [Parameter(Mandatory = $true)]
        [double]$ElapsedSeconds,
        [Parameter(Mandatory = $true)]
        [int]$TotalTokens,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [AllowNull()]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [bool]$Success,
        [string]$ErrorMessage = ""
    )

    Initialize-LocalMetricsSchema -MetricsPath $MetricsPath

    $outputChars = if ($null -ne $Content) { $Content.Length } else { 0 }
    $tokensPerSecond = if ($ElapsedSeconds -gt 0 -and $TotalTokens -gt 0) { [math]::Round($TotalTokens / $ElapsedSeconds, 2) } else { 0.0 }
    $row = [pscustomobject]@{
        Timestamp            = (Get-Date).ToString("o")
        Model                = $Model
        ActualElapsedSeconds = [math]::Round($ElapsedSeconds, 2)
        TotalTokens          = $TotalTokens
        TaskType             = $TaskType
        Provider             = "ollama"
        Success              = $Success
        SuccessRegex         = $SuccessRegex
        MinOutputChars       = $MinOutputChars
        OutputChars          = $outputChars
        TokensPerSecond      = $tokensPerSecond
        SelectedBy           = $SelectedBy
        SelectionReason      = $SelectionReason
        PromptFile           = [string]$promptPath
        OutputFile           = $outputPath
        ErrorMessage         = $ErrorMessage
    }

    Write-CsvRowWithRetry -Path $MetricsPath -Row $row
}

$artifactTarget = Resolve-IntegratedPowerArtifactTarget `
    -OutputFile $OutputFile `
    -RepoRoot $repoRoot `
    -StateRoot $storagePath `
    -TaskKey $TaskKey `
    -TaskTitle $TaskTitle `
    -ArtifactPolicy $ArtifactPolicy
$outputPath = [string]$artifactTarget.Path
if ([bool]$artifactTarget.Coalesced) {
    Write-Warning "Antigravity IDE indexes every brain file as an artifact. Coalescing '$($artifactTarget.RequestedPath)' into '$outputPath'. Use -ArtifactPolicy Separate only when the user explicitly requests another visible artifact."
}

$promptPath = Resolve-Path -LiteralPath $PromptFile
$prompt = [string](Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath)

# Ensure Ollama is running
$ollamaUrl = ""
if (-not [string]::IsNullOrWhiteSpace($env:OLLAMA_HOST)) {
    $ollamaUrl = [string]$env:OLLAMA_HOST
} elseif (
    $null -ne $orchestratorSettings -and
    $orchestratorSettings.PSObject.Properties.Name -contains "LocalLlm" -and
    $null -ne $orchestratorSettings.LocalLlm -and
    $orchestratorSettings.LocalLlm.PSObject.Properties.Name -contains "Endpoint" -and
    -not [string]::IsNullOrWhiteSpace([string]$orchestratorSettings.LocalLlm.Endpoint)
) {
    $ollamaUrl = [string]$orchestratorSettings.LocalLlm.Endpoint
}
if ([string]::IsNullOrWhiteSpace($ollamaUrl)) {
    $ollamaUrl = "http://127.0.0.1:11434"
}
if (-not ($ollamaUrl -match '^https?://')) {
    $ollamaUrl = "http://$ollamaUrl"
}
if ($ollamaUrl -match '^https?://([^:/]+)$') {
    $ollamaUrl = "$ollamaUrl:11434"
}
if ($ollamaUrl -match '0\.0\.0\.0') {
    $ollamaUrl = $ollamaUrl -replace '0\.0\.0\.0', '127.0.0.1'
}
$ollamaUrl = $ollamaUrl.TrimEnd("/")
$serverRunning = $false

try {
    $restArgs = @{
        Uri = "$ollamaUrl/api/version"
        Method = "Get"
        ErrorAction = "Stop"
    }
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $restArgs["TimeoutSec"] = [math]::Max(2, $ConnectTimeoutSeconds)
    }
    $response = Invoke-RestMethod @restArgs
    if ($response.version) {
        $serverRunning = $true
    }
}
catch {
    # Server is down
}

$isLoaded = $false
try {
    $psArgs = @{
        Uri = "$ollamaUrl/api/ps"
        Method = "Get"
        ErrorAction = "Stop"
    }
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $psArgs["TimeoutSec"] = [math]::Max(2, $ConnectTimeoutSeconds)
    }
    $psResponse = Invoke-RestMethod @psArgs
    if ($null -ne $psResponse.models) {
        foreach ($m in @($psResponse.models)) {
            if ($m.name -eq $Model -or $m.model -eq $Model) {
                $isLoaded = $true
                break
            }
        }
    }
}
catch {
    # Non-fatal
}

$actualTimeout = if ($isLoaded) { $TimeoutSeconds } else { [math]::Max($TimeoutSeconds, $ColdLoadTimeoutSeconds) }

if (-not $serverRunning -or $ForceRestart) {
    Write-Host "Starting Ollama server..."
    if ($ForceRestart) {
        Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    $ollamaCmd = Get-Command "ollama.exe", "ollama" -ErrorAction SilentlyContinue | Select-Object -First 1
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe" }

    if (Test-Path -LiteralPath $ollamaExe) {
        $originalCuda = $env:CUDA_VISIBLE_DEVICES
        if ([string]::IsNullOrWhiteSpace($env:CUDA_VISIBLE_DEVICES)) {
            try {
                $bestGpu = nvidia-smi --query-gpu=index,memory.free --format=csv,noheader,nounits 2>$null | 
                    ConvertFrom-Csv -Header "index","free" | 
                    Sort-Object { [int]$_.free } -Descending | 
                    Select-Object -First 1
                if ($bestGpu) {
                    $env:CUDA_VISIBLE_DEVICES = $bestGpu.index.ToString().Trim()
                }
            } catch {
                # Rely on default system GPU routing if nvidia-smi is unavailable
            }
        }
        
        Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 5
        
        if ($null -ne $originalCuda) {
            $env:CUDA_VISIBLE_DEVICES = $originalCuda
        }
        else {
            Remove-Item Env:\CUDA_VISIBLE_DEVICES -ErrorAction SilentlyContinue
        }
    }
    else {
        throw "Ollama executable not found at $ollamaExe or in system PATH."
    }
}

$startedAt = Get-Date
$localMetricsFile = Join-Path $storagePath "reports\local_llm_metrics.csv"

Write-Host "Sending prompt to Local LLM ($Model)..."
$bodyObject = [pscustomobject]@{
    model       = [string]$Model
    prompt      = [string]$prompt
    system      = [string]$SystemPrompt
    stream      = $false
    keep_alive  = [string]$KeepAlive
    options     = [pscustomobject]@{
        num_ctx = [int]$NumCtx
    }
}
if ($MaxTokens -gt 0) {
    $bodyObject.options | Add-Member -NotePropertyName "num_predict" -NotePropertyValue [int]$MaxTokens -Force
}
$body = $bodyObject | ConvertTo-Json -Depth 10

if ([string]::IsNullOrWhiteSpace($ollamaUrl)) {
    $ollamaUrl = "http://127.0.0.1:11434"
}
try {
    $restArgs = @{
        Uri = "$ollamaUrl/api/generate"
        Method = "Post"
        Body = $body
        ContentType = "application/json; charset=utf-8"
        ErrorAction = "Stop"
    }
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $restArgs["TimeoutSec"] = $actualTimeout
    }
    $response = Invoke-RestMethod @restArgs

    $endedAt = Get-Date
    $elapsed = ($endedAt - $startedAt).TotalSeconds

    $content = ""
    if ($null -ne $response.response -and -not [string]::IsNullOrWhiteSpace([string]$response.response)) {
        $content = [string]$response.response
    } elseif ($null -ne $response.message -and -not [string]::IsNullOrWhiteSpace([string]$response.message.content)) {
        $content = [string]$response.message.content
    } elseif ($null -ne $response.thinking -and -not [string]::IsNullOrWhiteSpace([string]$response.thinking)) {
        $content = [string]$response.thinking
    } elseif ($null -ne $response.message -and -not [string]::IsNullOrWhiteSpace([string]$response.message.thinking)) {
        $content = [string]$response.message.thinking
    }

    if ([string]::IsNullOrWhiteSpace($content)) {
        throw "Ollama returned empty content for model $Model. Response: $($response | ConvertTo-Json -Depth 2 -Compress)"
    }

    Write-IntegratedPowerArtifact -Path $outputPath -Content $content -Mode $ArtifactMode -TaskTitle $TaskTitle -Route "local_llm"
    Write-Host "Output saved to $outputPath"

    # Record Metrics
    $evalCount = if ($response.eval_count) { $response.eval_count } else { 0 }
    $promptEvalCount = if ($response.prompt_eval_count) { $response.prompt_eval_count } else { 0 }
    $totalTokens = $evalCount + $promptEvalCount

    $metricsFile = Join-Path $storagePath "reports\token_usage.csv"
    $metricsDir = Split-Path -Parent $metricsFile
    if (![string]::IsNullOrWhiteSpace($metricsDir)) {
        New-Item -ItemType Directory -Force -Path $metricsDir | Out-Null
    }

    $row = [pscustomobject]@{
        Timestamp             = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Workspace             = if ($repoRoot) { Split-Path -Leaf $repoRoot } else { "Unknown" }
        WorkspacePath         = $repoRoot
        Operation             = "Local-LLM-Inference"
        Method                = "ollama-api"
        Model                 = $Model
        WordCount             = 0
        CharCount             = 0
        Utf8Bytes             = 0
        InputTokens           = $promptEvalCount
        CachedInputTokens     = 0
        OutputTokens          = $evalCount
        ReasoningOutputTokens = 0
        TotalTokens           = $totalTokens
        EstimatedTokens       = $totalTokens
        Confidence            = "exact"
        Source                = $outputPath
    }

    Write-CsvRowWithRetry -Path $metricsFile -Row $row

    $success = ($content.Length -ge $MinOutputChars)
    if ($success -and ![string]::IsNullOrWhiteSpace($SuccessRegex)) {
        $success = $content -match $SuccessRegex
    }
    Write-LocalLlmMetric -MetricsPath $localMetricsFile -ElapsedSeconds $elapsed -TotalTokens $totalTokens -Content $content -Success $success

    Write-Host "Local LLM ($Model) completed in $([math]::Round($elapsed, 2))s. Total Tokens: $totalTokens"

}
catch {
    $endedAt = Get-Date
    $elapsed = ($endedAt - $startedAt).TotalSeconds
    try {
        Write-LocalLlmMetric -MetricsPath $localMetricsFile -ElapsedSeconds $elapsed -TotalTokens 0 -Content "" -Success $false -ErrorMessage ($_.Exception.Message)
    }
    catch {
        Write-Warning "Failed to record local LLM failure metric: $($_.Exception.Message)"
    }
    Write-Error "Local LLM inference failed: $_"
    exit 1
}

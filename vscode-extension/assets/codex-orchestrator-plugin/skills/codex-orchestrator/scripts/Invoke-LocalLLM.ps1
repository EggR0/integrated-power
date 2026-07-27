param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [string]$OutputFile = "",

    [string]$Model = "qwen2.5:latest",

    [string]$SystemPrompt = "You are a helpful AI coding assistant.",

    [switch]$ForceRestart,

    [int]$NumCtx = 4096,

    [string]$TaskTitle = "Local LLM Inference",

    [string]$TaskScale = "Medium",

    [ValidateSet("summarization", "extraction", "coding", "reasoning", "korean", "long_context", "routing_review", "general")]
    [string]$TaskType = "general",

    [string]$SuccessRegex = "",

    [int]$MinOutputChars = 1,

    [string]$SelectedBy = "manual",

    [string]$SelectionReason = ""
)

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
$storagePath = Get-GlobalStorage -RepoRoot $repoRoot

function Write-CsvRowWithRetry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [pscustomobject]$Row
    )

    $dir = Split-Path -Parent $Path
    if (![string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    for ($i = 0; $i -lt 3; $i++) {
        try {
            if (Test-Path -LiteralPath $Path) {
                $Row | Export-Csv -NoTypeInformation -Encoding UTF8 -Append -LiteralPath $Path
            }
            else {
                $Row | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $Path
            }
            return
        }
        catch {
            if ($i -eq 2) { throw }
            Start-Sleep -Milliseconds 1000
        }
    }
}

function ConvertTo-LocalMetricRow {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Source
    )

    [pscustomobject]@{
        Timestamp            = if ($Source.Timestamp) { $Source.Timestamp } else { Get-Date -Format "yyyy-MM-dd HH:mm:ss" }
        TaskTitle            = if ($Source.TaskTitle) { $Source.TaskTitle } else { "" }
        Model                = if ($Source.Model) { $Source.Model } else { "" }
        TaskScale            = if ($Source.TaskScale) { $Source.TaskScale } else { "" }
        ActualElapsedSeconds = if ($Source.ActualElapsedSeconds) { $Source.ActualElapsedSeconds } else { 0 }
        TotalTokens          = if ($Source.TotalTokens) { $Source.TotalTokens } else { 0 }
        TaskType             = if ($Source.TaskType) { $Source.TaskType } else { "general" }
        Provider             = if ($Source.Provider) { $Source.Provider } else { "ollama" }
        Success              = if (($Source.PSObject.Properties.Name -contains "Success") -and $null -ne $Source.Success -and [string]$Source.Success -ne "") { $Source.Success } else { "" }
        SuccessRegex         = if ($Source.SuccessRegex) { $Source.SuccessRegex } else { "" }
        MinOutputChars       = if ($Source.MinOutputChars) { $Source.MinOutputChars } else { 1 }
        OutputChars          = if ($Source.OutputChars) { $Source.OutputChars } else { 0 }
        TokensPerSecond      = if ($Source.TokensPerSecond) { $Source.TokensPerSecond } else { 0 }
        SelectedBy           = if ($Source.SelectedBy) { $Source.SelectedBy } else { "unknown" }
        SelectionReason      = if ($Source.SelectionReason) { $Source.SelectionReason } else { "" }
        PromptFile           = if ($Source.PromptFile) { $Source.PromptFile } else { "" }
        OutputFile           = if ($Source.OutputFile) { $Source.OutputFile } else { "" }
        ErrorMessage         = if ($Source.ErrorMessage) { $Source.ErrorMessage } else { "" }
    }
}

function Ensure-LocalMetricsSchema {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (!(Test-Path -LiteralPath $Path)) { return }

    $header = Get-Content -LiteralPath $Path -TotalCount 1
    if ($header -match "TaskType" -and $header -match "Success") { return }

    $backup = "$Path.legacy-$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    $rows = @(Import-Csv -LiteralPath $Path | ForEach-Object { ConvertTo-LocalMetricRow -Source $_ })
    if ($rows.Count -gt 0) {
        $rows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $Path
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
        [string]$Content,

        [Parameter(Mandatory = $true)]
        [bool]$Success,

        [AllowEmptyString()]
        [string]$ErrorMessage = ""
    )

    Ensure-LocalMetricsSchema -Path $MetricsPath
    $outputChars = if ($null -ne $Content) { $Content.Length } else { 0 }
    $tokensPerSecond = if ($ElapsedSeconds -gt 0) { [math]::Round($TotalTokens / $ElapsedSeconds, 2) } else { 0 }
    $row = ConvertTo-LocalMetricRow -Source ([pscustomobject]@{
        Timestamp            = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        TaskTitle            = $TaskTitle
        Model                = $Model
        TaskScale            = $TaskScale
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
    })

    Write-CsvRowWithRetry -Path $MetricsPath -Row $row
}

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputFile = Join-Path $storagePath "reports/local-llm-$stamp.md"
}

$outputPath = if ([System.IO.Path]::IsPathRooted($OutputFile)) {
    $OutputFile
}
else {
    Join-Path $repoRoot $OutputFile
}

$outputDir = Split-Path -Parent $outputPath
if (![string]::IsNullOrWhiteSpace($outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$promptPath = Resolve-Path -LiteralPath $PromptFile
$prompt = [string](Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath)

# Ensure Ollama is running
$ollamaUrl = "http://localhost:11434"
$serverRunning = $false

try {
    $response = Invoke-RestMethod -Uri "$ollamaUrl/api/version" -Method Get -TimeoutSec 2 -ErrorAction Stop
    if ($response.version) {
        $serverRunning = $true
    }
}
catch {
    # Server is down
}

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
    model   = [string]$Model
    prompt  = [string]$prompt
    system  = [string]$SystemPrompt
    stream  = $false
    options = [pscustomobject]@{
        num_ctx = [int]$NumCtx
    }
}
$body = $bodyObject | ConvertTo-Json -Depth 10

try {
    $tempJsonFile = [System.IO.Path]::GetTempFileName()
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempJsonFile, $body, $utf8NoBom)
    
    try {
        $curlOutput = curl.exe -sS -X POST "$ollamaUrl/api/generate" -d "@$tempJsonFile" -H "Content-Type: application/json"
        $response = $curlOutput | ConvertFrom-Json
    }
    finally {
        Remove-Item $tempJsonFile -ErrorAction SilentlyContinue
    }

    $endedAt = Get-Date
    $elapsed = ($endedAt - $startedAt).TotalSeconds

    $content = if ($response.response) { [string]$response.response } else { "" }
    if ($content) {
        $content | Out-File -FilePath $outputPath -Encoding UTF8
        Write-Host "Output saved to $outputPath"
    }

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




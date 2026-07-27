[CmdletBinding()]
param(
    [string]$RequestedCodexExe = "",
    [string[]]$EnabledRoutes = @("main_agent", "codex"),
    [ValidateSet("main_agent", "codex", "local_llm")]
    [string]$DefaultRoute = "main_agent",
    [ValidateSet("", "ollama", "vllm")]
    [string]$LocalLlmProvider = "",
    [string]$LocalLlmEndpoint = "",
    [string]$LocalLlmModel = "",
    [ValidateSet("auto", "user_default")]
    [string]$LocalLlmSelectionMode = "auto",
    [ValidateRange(0, 256)]
    [double]$ReserveVramGB = 2,
    [switch]$AllowCpuOffload,
    [string]$SettingsPath = "",
    [switch]$NonInteractive,
    [switch]$PassThru
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " EggR Orchestrator First-Run Setup" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$userProfile = [Environment]::GetFolderPath("UserProfile")
$configPath = if (-not [string]::IsNullOrWhiteSpace($SettingsPath)) {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($SettingsPath))
} elseif (-not [string]::IsNullOrWhiteSpace($env:EGGR_ORCHESTRATOR_SETTINGS)) {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($env:EGGR_ORCHESTRATOR_SETTINGS))
} else {
    Join-Path $userProfile ".gemini\config\codex_plugin_settings.json"
}
$configDirectory = Split-Path -Parent $configPath

function Test-CodexCandidate {
    param([string]$Candidate)
    if ([string]::IsNullOrWhiteSpace($Candidate)) { return $null }

    $expanded = [Environment]::ExpandEnvironmentVariables($Candidate.Trim('"'))
    if ([IO.Path]::IsPathRooted($expanded)) {
        if (Test-Path -LiteralPath $expanded -PathType Leaf) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
        return $null
    }
    $command = Get-Command -Name $expanded -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function Resolve-CodexExe {
    param([string]$Requested)

    foreach ($candidate in @($Requested, $env:CODEX_EXE, "codex.exe", "codex")) {
        $resolved = Test-CodexCandidate -Candidate $candidate
        if ($resolved) { return $resolved }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $codexBin = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
        if (Test-Path -LiteralPath $codexBin -PathType Container) {
            $newest = Get-ChildItem -LiteralPath $codexBin -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
            if ($newest) { return $newest.FullName }
        }
    }
    return $null
}

function Test-HttpEndpoint {
    param([string]$Endpoint)
    try {
        $uri = [Uri]$Endpoint
        return $uri.IsAbsoluteUri -and $uri.Scheme -in @("http", "https") -and [string]::IsNullOrWhiteSpace($uri.UserInfo)
    } catch {
        return $false
    }
}

function Get-NvidiaSummary {
    $nvidia = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
    if (-not $nvidia) { return "NVIDIA GPU not detected; the backend will check again at execution time." }
    try {
        $rows = @(& $nvidia.Source "--query-gpu=name,memory.total,memory.free,compute_cap" "--format=csv,noheader,nounits" 2>$null)
        if ($LASTEXITCODE -eq 0 -and $rows.Count -gt 0) {
            return ($rows -join " | ")
        }
        $rows = @(& $nvidia.Source "--query-gpu=name,memory.total,memory.free" "--format=csv,noheader,nounits" 2>$null)
        if ($LASTEXITCODE -eq 0 -and $rows.Count -gt 0) {
            return ($rows -join " | ")
        }
    } catch {
        # Hardware discovery is advisory; the runtime selector retries it.
    }
    return "NVIDIA GPU query unavailable; the backend will check again at execution time."
}

$existing = [ordered]@{}
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    try {
        $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($property in $raw.PSObject.Properties) {
            $existing[$property.Name] = $property.Value
        }
    } catch {
        throw "Existing orchestrator settings are invalid: $configPath"
    }
}

if (-not $NonInteractive) {
    $useCodex = Read-Host "Enable Codex delegation? [Y/n]"
    $EnabledRoutes = @("main_agent")
    if ($useCodex -notmatch "^(n|no)$") {
        $EnabledRoutes += "codex"
    }
    $providerInput = (Read-Host "Local LLM provider [none/ollama/vllm]").Trim().ToLowerInvariant()
    if ($providerInput -in @("ollama", "vllm")) {
        $LocalLlmProvider = $providerInput
        $EnabledRoutes += "local_llm"
        $defaultEndpoint = if ($providerInput -eq "ollama") { "http://127.0.0.1:11434" } else { "http://127.0.0.1:8000/v1" }
        $endpointInput = Read-Host "Local LLM endpoint [$defaultEndpoint]"
        $LocalLlmEndpoint = if ([string]::IsNullOrWhiteSpace($endpointInput)) { $defaultEndpoint } else { $endpointInput.Trim() }
        $selectionInput = (Read-Host "Model selection [auto/user_default] (default: auto)").Trim().ToLowerInvariant()
        if ($selectionInput -in @("auto", "user_default")) {
            $LocalLlmSelectionMode = $selectionInput
        }
        if ($LocalLlmSelectionMode -eq "user_default") {
            $LocalLlmModel = (Read-Host "Required local model ID").Trim()
        }
        $reserveInput = (Read-Host "Reserve GPU memory in GB [2]").Trim()
        if (-not [string]::IsNullOrWhiteSpace($reserveInput)) {
            $parsedReserve = 0.0
            if (-not [double]::TryParse($reserveInput, [ref]$parsedReserve) -or $parsedReserve -lt 0 -or $parsedReserve -gt 256) {
                throw "ReserveVramGB must be between 0 and 256."
            }
            $ReserveVramGB = $parsedReserve
        }
        $offloadInput = (Read-Host "Allow CPU offload fallback? [y/N]").Trim()
        $AllowCpuOffload = $offloadInput -match "^(y|yes)$"
        Write-Host ("Detected hardware: " + (Get-NvidiaSummary)) -ForegroundColor DarkCyan
    }
    $routeInput = (Read-Host "Default route [main_agent/codex/local_llm] (default: main_agent)").Trim()
    if (-not [string]::IsNullOrWhiteSpace($routeInput)) {
        $DefaultRoute = $routeInput
    }
}

$EnabledRoutes = @($EnabledRoutes | Where-Object { $_ -in @("main_agent", "codex", "local_llm") } | Select-Object -Unique)
if ($EnabledRoutes -notcontains "main_agent") { $EnabledRoutes = @("main_agent") + $EnabledRoutes }
if ($DefaultRoute -notin $EnabledRoutes) {
    throw "DefaultRoute '$DefaultRoute' is not enabled."
}

$codexExe = $null
if ($EnabledRoutes -contains "codex") {
    $existingCodex = if ($existing.Contains("CodexExe")) { [string]$existing["CodexExe"] } else { "" }
    $requestedCodexCandidate = if ($RequestedCodexExe) { $RequestedCodexExe } else { $existingCodex }
    $codexExe = Resolve-CodexExe -Requested $requestedCodexCandidate
    while (-not $codexExe -and -not $NonInteractive) {
        $candidate = Read-Host "Codex was not found. Enter the full path to codex.exe"
        $codexExe = Test-CodexCandidate -Candidate $candidate
    }
    if (-not $codexExe) {
        throw "Codex delegation is enabled but codex.exe could not be resolved."
    }
}

$localLlm = if ($existing.Contains("LocalLlm")) { $existing["LocalLlm"] } else { $null }
if ($EnabledRoutes -contains "local_llm") {
    if ([string]::IsNullOrWhiteSpace($LocalLlmProvider)) {
        throw "local_llm is enabled but LocalLlmProvider is missing."
    }
    if ([string]::IsNullOrWhiteSpace($LocalLlmEndpoint)) {
        $LocalLlmEndpoint = if ($LocalLlmProvider -eq "ollama") { "http://127.0.0.1:11434" } else { "http://127.0.0.1:8000/v1" }
    }
    if (-not (Test-HttpEndpoint -Endpoint $LocalLlmEndpoint)) {
        throw "LocalLlmEndpoint must be an HTTP(S) URL without embedded credentials."
    }
    if ($LocalLlmSelectionMode -eq "user_default" -and [string]::IsNullOrWhiteSpace($LocalLlmModel)) {
        throw "LocalLlmModel is required when LocalLlmSelectionMode is user_default."
    }
    $localLlm = [ordered]@{
        Provider = $LocalLlmProvider
        Endpoint = $LocalLlmEndpoint.TrimEnd("/")
        Model = if ($LocalLlmSelectionMode -eq "user_default") { $LocalLlmModel } else { $null }
        HardwarePolicy = [ordered]@{
            Mode = $LocalLlmSelectionMode
            ReserveVramGB = $ReserveVramGB
            AllowCpuOffload = [bool]$AllowCpuOffload
        }
    }
    if ($LocalLlmProvider -eq "vllm") {
        $localLlm["ApiKeyEnvironmentVariable"] = "VLLM_API_KEY"
    }
}

$existing["SchemaVersion"] = 1
$existing["CodexExe"] = $codexExe
$existing["EnabledRoutes"] = $EnabledRoutes
$existing["DefaultRoute"] = $DefaultRoute
$existing["LocalLlm"] = $localLlm
$existing["FirstRunCompletedAt"] = [DateTimeOffset]::UtcNow.ToString("o")
$existing["ConfiguredBy"] = "orchestrator-standalone/1.2.0"

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
$temporary = Join-Path $configDirectory ("codex_plugin_settings.{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
try {
    $json = $existing | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($temporary, "$json`n", (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $configPath -Force
} finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Force
    }
}

Write-Host ""
Write-Host "EggR Orchestrator settings saved: $configPath" -ForegroundColor Cyan
Write-Host "Enabled routes: $($EnabledRoutes -join ', ')" -ForegroundColor Green
Write-Host "Default route: $DefaultRoute" -ForegroundColor Green

if ($PassThru) {
    Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

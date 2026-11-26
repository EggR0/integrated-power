param(
  [int]$Port = 11435,
  [string]$ModelsRoot = ''
)

$ErrorActionPreference = 'Stop'
$ollama = (Get-Command ollama.exe -ErrorAction Stop).Source
if ([string]::IsNullOrWhiteSpace($ModelsRoot)) {
  if (-not [string]::IsNullOrWhiteSpace($env:OLLAMA_MODELS) -and (Test-Path -LiteralPath $env:OLLAMA_MODELS -PathType Container)) {
    $ModelsRoot = $env:OLLAMA_MODELS
  } elseif (Test-Path -LiteralPath 'D:\AI_Models' -PathType Container) {
    $ModelsRoot = 'D:\AI_Models'
  } elseif (Test-Path -LiteralPath "$env:USERPROFILE\.ollama\models" -PathType Container) {
    $ModelsRoot = "$env:USERPROFILE\.ollama\models"
  }
}
if (-not [string]::IsNullOrWhiteSpace($ModelsRoot) -and (Test-Path -LiteralPath $ModelsRoot -PathType Container)) {
  $env:OLLAMA_MODELS = $ModelsRoot
}
$uri = "http://127.0.0.1:$Port/api/tags"
try {
  $health = Invoke-RestMethod -Uri $uri -TimeoutSec 2
  Write-Output "Integrated Power local model server is already running on $uri"
  $health.models | Select-Object name, size
  exit 0
} catch {
  # Start a separate server only when the requested port is not healthy.
}

$env:OLLAMA_MODELS = $ModelsRoot
$env:OLLAMA_HOST = "127.0.0.1:$Port"
$selectedGpu = $null
try {
  $selectedGpu = @(& nvidia-smi --query-gpu=index,memory.free,utilization.gpu,uuid --format=csv,noheader,nounits 2>$null |
    ConvertFrom-Csv -Header "index","free","utilization","uuid" |
    Sort-Object @{ Expression = { [int]$_.free }; Descending = $true }, @{ Expression = { [int]$_.utilization }; Descending = $false } |
    Select-Object -First 1)
  if ($selectedGpu) {
    $env:CUDA_VISIBLE_DEVICES = ([string]$selectedGpu.uuid).Trim()
    $env:OLLAMA_CUDA_VISIBLE_DEVICES = ([string]$selectedGpu.uuid).Trim()
    Write-Output "Selected GPU index $($selectedGpu.index.Trim()) UUID $($selectedGpu.uuid.Trim()) free $($selectedGpu.free.Trim()) MiB utilization $($selectedGpu.utilization.Trim())%"
  }
} catch {
  Write-Output "GPU inventory unavailable; leaving Ollama default device selection unchanged."
}
Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri $uri -TimeoutSec 2
    Write-Output "Integrated Power local model server ready on $uri"
    $health.models | Select-Object name, size
    exit 0
  } catch {
    # Keep polling until the bounded startup window expires.
  }
}
throw "Timed out waiting for Ollama at $uri"

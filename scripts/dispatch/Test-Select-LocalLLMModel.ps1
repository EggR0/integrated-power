[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$selector = Join-Path $PSScriptRoot "Select-LocalLLMModel.ps1"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("eggr-selector-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message Expected='$Expected' Actual='$Actual'"
    }
}

try {
    $auto = & $selector `
        -TaskType reasoning `
        -Provider ollama `
        -AvailableVramGB 21 `
        -ComputeCapability 8.6 `
        -ReserveVramGB 2 `
        -DisableHardwareDetection `
        -AsJson | ConvertFrom-Json

    Assert-Equal $auto.SelectedModel "gpt-oss:20b" "RTX 3090-sized automatic selection changed."
    Assert-Equal $auto.SelectionBasis "automatic_score" "Automatic selection basis is wrong."
    $q4ComputeRejections = @(
        $auto.RejectedCandidates |
            Where-Object { $_.Reason -eq "compute_capability" -and $_.Model -match "(Q4|gpt-oss)" }
    )
    Assert-Equal $q4ComputeRejections.Count 0 "GGUF/MXFP4 weight formats must not imply native FP4 execution."

    $settingsPath = Join-Path $temporaryRoot "settings.json"
    $settings = [ordered]@{
        LocalLlm = [ordered]@{
            Provider = "vllm"
            Endpoint = "http://127.0.0.1:8000/v1"
            Model = "org/custom-model"
            HardwarePolicy = [ordered]@{
                Mode = "user_default"
                PreferredModel = "org/custom-model"
                ReserveVramGB = 3
                AllowCpuOffload = $true
            }
        }
    }
    [IO.File]::WriteAllText(
        $settingsPath,
        ($settings | ConvertTo-Json -Depth 8),
        (New-Object Text.UTF8Encoding($false))
    )
    $custom = & $selector `
        -SettingsPath $settingsPath `
        -AvailableVramGB 21 `
        -ComputeCapability 8.6 `
        -DisableHardwareDetection `
        -AsJson | ConvertFrom-Json

    Assert-Equal $custom.SelectedModel "org/custom-model" "Nested user default was not honored."
    Assert-Equal $custom.Provider "vllm" "Nested provider was not honored."
    Assert-Equal $custom.SelectionBasis "user_default" "User-default selection basis is wrong."
    Assert-Equal $custom.Hardware.ReserveVramGB 3 "Nested VRAM reserve was not honored."
    $customCandidate = @($custom.Candidates | Where-Object { $_.Model -eq "org/custom-model" })[0]
    Assert-Equal $customCandidate.Compatibility "unknown_user_default" "Unregistered model must retain unknown compatibility."

    $providerAlias = & $selector `
        -HardwareMode user_default `
        -PreferredModel "gpt-oss:20b" `
        -Provider vllm `
        -AvailableVramGB 21 `
        -ComputeCapability 8.6 `
        -DisableHardwareDetection `
        -AsJson | ConvertFrom-Json
    Assert-Equal $providerAlias.SelectedModel "gpt-oss:20b" "Provider-local alias was not honored."
    Assert-Equal $providerAlias.Provider "vllm" "Registry model name incorrectly overrode the configured provider."
    $providerAliasCandidate = @($providerAlias.Candidates | Where-Object Model -eq "gpt-oss:20b")[0]
    Assert-Equal $providerAliasCandidate.Compatibility "unknown_user_default" "Provider-mismatched alias must be compatibility-unknown."

    $precisionRegistry = Join-Path $temporaryRoot "precision-registry.csv"
    $csv = @'
"Model","Provider","Family","ParametersB","Quantization","EstimatedWeightsGB","RequiredRuntimePrecision","PrecisionBackend","MinimumComputeCapability","ContextHintTokens","SummarizationScore","ExtractionScore","CodingScore","ReasoningScore","KoreanScore","LongContextScore","SpeedScore","ReliabilityPrior","PrimaryUse","SourceUrl","SourceNote"
"gguf-q4","ollama","Test",4,"Q4_K_M",2,"","","",4096,5,5,5,5,5,5,5,0.5,"test","","weight format only"
"native-fp4","ollama","Test",4,"FP4",2,"FP4","tensorrt-rtx","",4096,10,10,10,10,10,10,10,0.9,"test","","runtime precision"
'@
    [IO.File]::WriteAllText($precisionRegistry, $csv, (New-Object Text.UTF8Encoding($false)))
    $precision = & $selector `
        -RegistryFile $precisionRegistry `
        -Provider ollama `
        -AvailableVramGB 21 `
        -ComputeCapability 8.6 `
        -DisableHardwareDetection `
        -AsJson | ConvertFrom-Json

    Assert-Equal $precision.SelectedModel "gguf-q4" "Native FP4 hard constraint or GGUF Q4 distinction is broken."
    Assert-Equal @($precision.RejectedCandidates | Where-Object Model -eq "native-fp4").Count 1 "TensorRT-RTX FP4 row must be rejected on CC 8.6."

    Write-Host "PASS Select-LocalLLMModel offline smoke tests"
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

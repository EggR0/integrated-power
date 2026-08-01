Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

$scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\Invoke-LocalLLM.ps1"))
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "integrated-power-invoke-test-$([guid]::NewGuid().ToString('N'))"
$capturePath = Join-Path $testRoot "generate-request.json"
$requestLogPath = Join-Path $testRoot "requests.txt"
$settingsPath = Join-Path $testRoot "orchestrator.json"
$promptPath = Join-Path $testRoot "prompt.md"
$outputPath = Join-Path $testRoot "output.md"
$stateRoot = Join-Path $testRoot "state"
$serverJob = $null
$previousSettingsPath = $env:INTEGRATED_POWER_ORCHESTRATOR_SETTINGS
$previousStateRoot = $env:INTEGRATED_POWER_STATE_ROOT

New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$port = ([Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$endpoint = "http://127.0.0.1:$port"

$settings = [ordered]@{
    SchemaVersion = 3
    EnabledRoutes = @("local_llm")
    DefaultRoute = "local_llm"
    LocalLlm = [ordered]@{
        Provider = "ollama"
        Endpoint = $endpoint
        Model = "test:model"
        HardwarePolicy = [ordered]@{
            Mode = "user_default"
            ReserveVramGB = 0
            AllowCpuOffload = $true
        }
    }
}
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($promptPath, "Return the mocked response.", (New-Object Text.UTF8Encoding($false)))

try {
    $serverJob = Start-Job -ScriptBlock {
        param($Prefix, $CapturePath, $RequestLogPath)

        $listener = [Net.HttpListener]::new()
        $listener.Prefixes.Add("$($Prefix.TrimEnd('/'))/")
        $listener.Start()
        try {
            for ($requestIndex = 0; $requestIndex -lt 3; $requestIndex++) {
                $context = $listener.GetContext()
                $requestPath = $context.Request.Url.AbsolutePath
                [IO.File]::AppendAllText($RequestLogPath, "$requestPath`r`n")

                switch ($requestPath) {
                    "/api/version" {
                        $responseJson = '{"version":"test"}'
                    }
                    "/api/ps" {
                        $responseJson = '{"models":[]}'
                    }
                    "/api/generate" {
                        $reader = New-Object IO.StreamReader($context.Request.InputStream, $context.Request.ContentEncoding)
                        try {
                            $requestBody = $reader.ReadToEnd()
                        }
                        finally {
                            $reader.Dispose()
                        }
                        [IO.File]::WriteAllText($CapturePath, $requestBody, (New-Object Text.UTF8Encoding($false)))

                        # The normal timeout in the test is one second. This
                        # deliberate delay proves the cold-load timeout is used.
                        Start-Sleep -Seconds 2
                        $responseJson = '{"response":"mock result","eval_count":7,"prompt_eval_count":5}'
                    }
                    default {
                        $context.Response.StatusCode = 404
                        $responseJson = '{"error":"unexpected path"}'
                    }
                }

                $bytes = [Text.Encoding]::UTF8.GetBytes($responseJson)
                $context.Response.ContentType = "application/json"
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
            }
        }
        finally {
            $listener.Stop()
            $listener.Close()
        }
    } -ArgumentList $endpoint, $capturePath, $requestLogPath

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $client = New-Object Net.Sockets.TcpClient
            $client.Connect("127.0.0.1", $port)
            $client.Close()
            $ready = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 100
        }
    }
    Assert-True $ready "The fake Ollama server did not start."

    $env:INTEGRATED_POWER_ORCHESTRATOR_SETTINGS = $settingsPath
    $env:INTEGRATED_POWER_STATE_ROOT = $stateRoot

    & $scriptPath `
        -PromptFile $promptPath `
        -OutputFile $outputPath `
        -Model "test:model" `
        -KeepAlive "45m" `
        -TimeoutSeconds 1 `
        -ColdLoadTimeoutSeconds 5 `
        -ConnectTimeoutSeconds 2

    Assert-True (Test-Path -LiteralPath $outputPath -PathType Leaf) "The inference output file was not created."
    Assert-True ((Get-Content -LiteralPath $outputPath -Raw).Trim() -eq "mock result") "The mocked inference response was not written."

    $capturedRequest = Get-Content -LiteralPath $capturePath -Raw | ConvertFrom-Json
    Assert-True ([string]$capturedRequest.model -eq "test:model") "The requested model was not preserved."
    Assert-True ([string]$capturedRequest.keep_alive -eq "45m") "keep_alive was not sent in the generate request."
    Assert-True ([int]$capturedRequest.options.num_ctx -eq 4096) "num_ctx was not sent in the generate request."

    $requestPaths = @(Get-Content -LiteralPath $requestLogPath)
    Assert-True ($requestPaths.Count -eq 3) "The invoke script made an unexpected extra request."
    Assert-True (($requestPaths -join ",") -eq "/api/version,/api/ps,/api/generate") "The invoke sequence should check state and then send one real generation request without a warm-up."

    Write-Host "Invoke-LocalLLM.Tests.ps1 passed."
}
finally {
    $env:INTEGRATED_POWER_ORCHESTRATOR_SETTINGS = $previousSettingsPath
    $env:INTEGRATED_POWER_STATE_ROOT = $previousStateRoot

    if ($null -ne $serverJob) {
        if ($serverJob.State -eq "Running") {
            Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
        }
        Remove-Job -Job $serverJob -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

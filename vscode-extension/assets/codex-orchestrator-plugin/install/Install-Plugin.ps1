$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " EggR Codex Orchestrator Setup" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$configDirectory = Join-Path $env:USERPROFILE ".gemini\config"
$configPath = Join-Path $configDirectory "codex_plugin_settings.json"

function Test-CodexCandidate {
    param([string]$Candidate)

    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        return $null
    }

    $expanded = [Environment]::ExpandEnvironmentVariables($Candidate.Trim('"'))
    if ([IO.Path]::IsPathRooted($expanded)) {
        if (Test-Path -LiteralPath $expanded -PathType Leaf) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
        return $null
    }

    $command = Get-Command -Name $expanded -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) {
        return $command.Source
    }
    return $null
}

$foundPath = $null
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $foundPath = Test-CodexCandidate -Candidate ([string]$config.CodexExe)
        if ($foundPath) {
            Write-Host "Found Codex from existing EggR settings: $foundPath" -ForegroundColor Green
        }
    } catch {
        Write-Warning "Existing Codex settings could not be read. Auto-detection will continue."
    }
}

if (!$foundPath -and $env:CODEX_EXE) {
    $foundPath = Test-CodexCandidate -Candidate $env:CODEX_EXE
    if ($foundPath) {
        Write-Host "Found Codex from CODEX_EXE: $foundPath" -ForegroundColor Green
    }
}

if (!$foundPath) {
    foreach ($name in @("codex.exe", "codex")) {
        $foundPath = Test-CodexCandidate -Candidate $name
        if ($foundPath) {
            Write-Host "Found Codex on PATH: $foundPath" -ForegroundColor Green
            break
        }
    }
}

if (!$foundPath -and -not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $codexBin = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
    if (Test-Path -LiteralPath $codexBin -PathType Container) {
        $newestCodex = Get-ChildItem -LiteralPath $codexBin -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object -Property LastWriteTime -Descending |
            Select-Object -First 1
        if ($newestCodex) {
            $foundPath = $newestCodex.FullName
            Write-Host "Found Codex in LocalAppData: $foundPath" -ForegroundColor Green
        }
    }
}

while (!$foundPath) {
    Write-Host ""
    Write-Host "Codex could not be found automatically." -ForegroundColor Yellow
    $userInput = Read-Host "Enter the full path to codex.exe"
    $foundPath = Test-CodexCandidate -Candidate $userInput
    if (!$foundPath) {
        Write-Host "The executable was not found at that path." -ForegroundColor Red
    }
}

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
$configObject = @{ CodexExe = $foundPath }
$json = $configObject | ConvertTo-Json
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, $json, $utf8NoBom)

Write-Host ""
Write-Host "EggR Codex settings saved to $configPath" -ForegroundColor Cyan

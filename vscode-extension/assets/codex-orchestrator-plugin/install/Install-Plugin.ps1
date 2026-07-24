$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Codex Orchestrator Plugin Installer" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$configPath = Join-Path $env:USERPROFILE ".gemini\config\codex_plugin_settings.json"

function Test-CodexCandidate {
    param([string]$Candidate)
    if ([string]::IsNullOrWhiteSpace($Candidate)) { return $null }
    $expanded = [Environment]::ExpandEnvironmentVariables($Candidate.Trim('"'))
    if ([System.IO.Path]::IsPathRooted($expanded)) {
        if (Test-Path -LiteralPath $expanded -PathType Leaf) { return (Resolve-Path -LiteralPath $expanded).Path }
        return $null
    }
    $cmd = Get-Command -Name $expanded -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}

$foundPath = $null

# 1. Check existing config
if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
        if ($config.CodexExe) {
            $foundPath = Test-CodexCandidate -Candidate $config.CodexExe
            if ($foundPath) {
                Write-Host "??Found valid Codex path in existing config: $foundPath" -ForegroundColor Green
            }
        }
    } catch { }
}

# 2. Check ENV
if (!$foundPath -and $env:CODEX_EXE) {
    $foundPath = Test-CodexCandidate -Candidate $env:CODEX_EXE
    if ($foundPath) { Write-Host "??Found Codex via `$env:CODEX_EXE: $foundPath" -ForegroundColor Green }
}

# 3. Check PATH
if (!$foundPath) {
    foreach ($name in @('codex.exe', 'codex')) {
        $foundPath = Test-CodexCandidate -Candidate $name
        if ($foundPath) { 
            Write-Host "??Found Codex in system PATH: $foundPath" -ForegroundColor Green
            break 
        }
    }
}

# 4. Check LOCALAPPDATA
if (!$foundPath) {
    $codexBin = Join-Path -Path $env:LOCALAPPDATA -ChildPath 'OpenAI\Codex\bin'
    if (Test-Path -LiteralPath $codexBin -PathType Container) {
        $newestCodex = Get-ChildItem -LiteralPath $codexBin -Filter 'codex.exe' -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object -Property LastWriteTime -Descending | Select-Object -First 1
        if ($newestCodex) { 
            $foundPath = $newestCodex.FullName 
            Write-Host "??Auto-detected Codex in LOCALAPPDATA: $foundPath" -ForegroundColor Green
        }
    }
}

# 5. Interactive Prompt
while (!$foundPath) {
    Write-Host ""
    Write-Host "?醫묓닔 Codex executable could not be found automatically." -ForegroundColor Yellow
    Write-Host "Please enter the full absolute path to codex.exe (e.g. C:\path\to\codex.exe)." -ForegroundColor Yellow
    $userInput = Read-Host "> "
    
    $foundPath = Test-CodexCandidate -Candidate $userInput
    if (!$foundPath) {
        Write-Host "??Invalid path. Could not find an executable there." -ForegroundColor Red
    }
}

# Save Config
$configObj = @{
    CodexExe = $foundPath
}
$json = $configObj | ConvertTo-Json
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, $json, $Utf8NoBom)

Write-Host ""
Write-Host "??Installation Complete! Settings saved to $configPath" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

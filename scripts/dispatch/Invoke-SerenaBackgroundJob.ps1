param(
    [switch]$Once,
    [int]$MaxFiles = 250,
    [switch]$SkipLocalLlm,
    [switch]$SkipSerenaIndex,
    [string]$Model = "qwen2.5-coder:32b",
    [int]$NumCtx = 32768
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"

function Resolve-RepoRoot {
    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            return [System.IO.Path]::GetFullPath($gitRoot.Trim())
        }
    } catch {
    }
    return (Get-Location).Path
}

function Write-Utf8Text {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $parent = Split-Path -Parent $Path
    if (![string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 24
    Write-Utf8Text -Path $Path -Text ($json + [Environment]::NewLine)
}

function Get-RelativePathCompat {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $baseFull = [System.IO.Path]::GetFullPath($BasePath)
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    if (!$baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFull += [System.IO.Path]::DirectorySeparatorChar
    }

    $baseUri = [Uri]::new($baseFull)
    $pathUri = [Uri]::new($pathFull)
    $relative = [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString())
    return $relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
}

function Read-JsonFile {
    param([string]$Path)

    if (!(Test-Path -LiteralPath $Path)) {
        return $null
    }
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
}

function Test-PathGlob {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string[]]$Globs
    )

    $normalized = $RelativePath.Replace("\", "/")
    foreach ($glob in $Globs) {
        $pattern = $glob.Replace("\", "/")
        if ($normalized -like $pattern) {
            return $true
        }
    }
    return $false
}

function Get-RepositoryFiles {
    param(
        [string]$RepoRoot,
        [object]$Policy,
        [int]$Limit
    )

    $rawFiles = @()
    try {
        $rawFiles = @(& rg --files 2>$null)
    } catch {
        $rawFiles = @(
            Get-ChildItem -LiteralPath $RepoRoot -Recurse -File -Force |
                ForEach-Object { [System.IO.Path]::GetRelativePath($RepoRoot, $_.FullName) }
        )
    }

    $includeGlobs = @($Policy.scope.includeGlobs)
    $excludeGlobs = @($Policy.scope.excludeGlobs)
    $all = foreach ($file in $rawFiles) {
        $relative = $file.Replace("\", "/")
        if ($relative -match "^\.git/") { continue }
        [pscustomobject]@{
            path = $relative
            includedByPolicy = (Test-PathGlob -RelativePath $relative -Globs $includeGlobs)
            excludedByPolicy = (Test-PathGlob -RelativePath $relative -Globs $excludeGlobs)
            extension = [System.IO.Path]::GetExtension($relative).ToLowerInvariant()
        }
    }

    $candidates = @($all | Where-Object { $_.includedByPolicy -and !$_.excludedByPolicy } | Sort-Object path)
    $included = @($candidates | Select-Object -First $Limit)
    $omitted = @($candidates | Select-Object -Skip $Limit)

    return [pscustomobject]@{
        totalFilesSeen = @($all).Count
        policyCandidateCount = $candidates.Count
        includedCount = $included.Count
        omittedCount = $omitted.Count
        maxFiles = $Limit
        omissionReason = if ($omitted.Count -gt 0) { "MaxFiles limit" } else { "" }
        files = $included
        omittedFiles = @($omitted | Select-Object -ExpandProperty path)
    }
}

function Get-AreaName {
    param([string]$RelativePath)

    $path = $RelativePath.Replace("\", "/")
    if ($path -like "scripts/dispatch/*") { return "dispatch" }
    if ($path -like "scripts/metrics/*") { return "metrics" }
    if ($path -like "scripts/scan/*") { return "scan" }
    if ($path -like "scripts/schedule/*") { return "schedule" }
    if ($path -like "scripts/util/*") { return "util" }
    if ($path -like "vscode-extension/src/*") { return "vscode-extension-src" }
    if ($path -like "vscode-extension/webview/*") { return "vscode-webview" }
    if ($path -like "vscode-extension/*") { return "vscode-extension" }
    if ($path -like "config/*") { return "config" }
    if ($path -like ".agents/*") { return "agent-config" }
    if ($path -like "docs/*") { return "docs" }
    return "root"
}

function Get-StaticSymbols {
    param(
        [string]$RepoRoot,
        [string[]]$RelativePaths
    )

    $items = @()
    foreach ($relative in $RelativePaths) {
        $full = Join-Path $RepoRoot $relative
        if (!(Test-Path -LiteralPath $full)) { continue }
        $extension = [System.IO.Path]::GetExtension($relative).ToLowerInvariant()
        if ($extension -notin @(".ps1", ".psm1", ".ts", ".tsx", ".js", ".mjs")) { continue }

        $lines = Get-Content -Encoding UTF8 -LiteralPath $full -ErrorAction SilentlyContinue
        $symbols = @()
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($extension -in @(".ps1", ".psm1")) {
                if ($line -match "^\s*function\s+([A-Za-z0-9_\-:]+)") {
                    $symbols += [pscustomobject]@{ name = $Matches[1]; kind = "function"; line = $i + 1 }
                }
            } else {
                if ($line -match "^\s*(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)") {
                    $symbols += [pscustomobject]@{ name = $Matches[3]; kind = "function"; line = $i + 1 }
                } elseif ($line -match "^\s*export\s+(class|interface|type|const|let|var)\s+([A-Za-z0-9_$]+)") {
                    $symbols += [pscustomobject]@{ name = $Matches[2]; kind = $Matches[1]; line = $i + 1 }
                } elseif ($line -match "^\s*(class)\s+([A-Za-z0-9_$]+)") {
                    $symbols += [pscustomobject]@{ name = $Matches[2]; kind = $Matches[1]; line = $i + 1 }
                }
            }
        }

        if ($symbols.Count -gt 0) {
            $items += [pscustomobject]@{
                path = $relative.Replace("\", "/")
                symbolCount = $symbols.Count
                symbols = $symbols
            }
        }
    }
    return $items
}

function New-RoutingHints {
    param(
        [object]$Inventory,
        [object]$SerenaSymbols,
        [object]$PowerShellSymbols,
        [object[]]$StaticSymbols
    )

    $serenaByPath = @{}
    foreach ($file in @($SerenaSymbols.files)) {
        $serenaByPath[$file.path] = $file
    }
    $staticByPath = @{}
    foreach ($file in @($StaticSymbols)) {
        $staticByPath[$file.path] = $file
    }
    $powerShellByPath = @{}
    foreach ($file in @($PowerShellSymbols.files)) {
        $powerShellByPath[$file.path] = $file
    }

    $areas = @()
    foreach ($group in @($Inventory.files | Group-Object { Get-AreaName -RelativePath $_.path })) {
        $paths = @($group.Group | Select-Object -ExpandProperty path)
        $symbolCount = 0
        foreach ($path in $paths) {
            if ($serenaByPath.ContainsKey($path)) {
                $symbolCount += [int]$serenaByPath[$path].symbolCount
            } elseif ($powerShellByPath.ContainsKey($path)) {
                $symbolCount += [int]$powerShellByPath[$path].functionCount
            } elseif ($staticByPath.ContainsKey($path)) {
                $symbolCount += [int]$staticByPath[$path].symbolCount
            }
        }
        $areas += [pscustomobject]@{
            area = $group.Name
            fileCount = $paths.Count
            symbolCount = $symbolCount
            candidateFiles = @($paths | Select-Object -First 20)
            routingNote = "Use these files as candidates only; validate with rg/tests before editing."
        }
    }

    return [pscustomobject]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        source = "serena-cache-powershell-ast-plus-repo-inventory"
        neverTreatAsAuthority = $true
        areas = @($areas | Sort-Object area)
    }
}

function New-RepoMapMarkdown {
    param(
        [string]$RunId,
        [object]$Capability,
        [object]$Inventory,
        [object]$SerenaSymbols,
        [object]$PowerShellSymbols,
        [object[]]$StaticSymbols,
        [object]$RoutingHints,
        [string]$LocalSummaryPath
    )

    $lines = [System.Collections.Generic.List[string]]::new()
    $generated = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    $localSummaryLabel = if ($LocalSummaryPath) { $LocalSummaryPath } else { "not used" }
    $lines.Add("# Serena Background Repo Map")
    $lines.Add("")
    $lines.Add("- Run: ``$RunId``")
    $lines.Add("- Generated: $generated")
    $lines.Add("- Source: Serena health/index/cache + repository inventory")
    $lines.Add("- Local LLM summary: $localSummaryLabel")
    $lines.Add("")
    $lines.Add("## Coverage")
    $lines.Add("")
    $lines.Add("- Files seen by inventory: $($Inventory.totalFilesSeen)")
    $lines.Add("- Files included by policy: $($Inventory.includedCount) / $($Inventory.policyCandidateCount)")
    $lines.Add("- Files omitted by limit: $($Inventory.omittedCount)")
    $lines.Add("- Serena symbol files: $($SerenaSymbols.fileCount)")
    $lines.Add("- Serena symbols exported: $($SerenaSymbols.symbolCount)")
    $lines.Add("- PowerShell AST files: $($PowerShellSymbols.fileCount)")
    $lines.Add("- PowerShell AST functions: $($PowerShellSymbols.functionCount)")
    $lines.Add("- PowerShell parse-error files: $($PowerShellSymbols.parseErrorFileCount)")
    $lines.Add("- Static fallback symbol files: $(@($StaticSymbols).Count)")
    if ($Inventory.omittedCount -gt 0) {
        $lines.Add("- Omission reason: $($Inventory.omissionReason)")
    }
    $lines.Add("")
    $lines.Add("## Serena Status")
    $lines.Add("")
    $lines.Add("- CLI found: $($Capability.serenaCliFound)")
    $lines.Add("- Health success: $($Capability.success)")
    $lines.Add("- Health log: $($Capability.health.logPath)")
    $lines.Add("- Active tools: $($Capability.health.activeToolsCount)")
    $lines.Add("- Analyzable file sampled by Serena: $($Capability.health.analyzableFile)")
    $lines.Add("- Sample symbols returned by get_symbols_overview: $($Capability.health.symbolsOverviewCount)")
    $lines.Add("")
    $lines.Add("## Routing Areas")
    $lines.Add("")
    foreach ($area in @($RoutingHints.areas | Sort-Object area)) {
        $lines.Add("### $($area.area)")
        $lines.Add("")
        $lines.Add("- Files: $($area.fileCount)")
        $lines.Add("- Known symbols: $($area.symbolCount)")
        $lines.Add("- Candidate files:")
        foreach ($path in @($area.candidateFiles | Select-Object -First 12)) {
            $lines.Add("  - ``$path``")
        }
        $lines.Add("")
    }
    $lines.Add("## Serena Symbol Files")
    $lines.Add("")
    foreach ($file in @($SerenaSymbols.files | Sort-Object path)) {
        $names = @($file.topLevelSymbols | Select-Object -First 8 | ForEach-Object { $_.name }) -join ", "
        if ([string]::IsNullOrWhiteSpace($names)) { $names = "(no top-level names exported)" }
        $lines.Add("- ``$($file.path)`` - $($file.symbolCount) symbols; top-level: $names")
    }
    $lines.Add("")
    $lines.Add("## PowerShell AST Files")
    $lines.Add("")
    foreach ($file in @($PowerShellSymbols.files | Sort-Object path)) {
        $names = @($file.functions | Select-Object -First 10 | ForEach-Object { "$($_.name):$($_.line)" }) -join ", "
        if ([string]::IsNullOrWhiteSpace($names)) { $names = "(no functions)" }
        $parseLabel = if ($file.parseErrorCount -gt 0) { "; parseErrors=$($file.parseErrorCount)" } else { "" }
        $lines.Add("- ``$($file.path)`` - $($file.functionCount) functions$parseLabel; $names")
    }
    $lines.Add("")
    $lines.Add("## Static Fallback Symbol Files")
    $lines.Add("")
    foreach ($file in @($StaticSymbols | Sort-Object path)) {
        $names = @($file.symbols | Select-Object -First 10 | ForEach-Object { "$($_.name):$($_.line)" }) -join ", "
        $lines.Add("- ``$($file.path)`` - $($file.symbolCount) symbols; $names")
    }
    $lines.Add("")
    $lines.Add("## Included File Inventory")
    $lines.Add("")
    foreach ($file in @($Inventory.files | Sort-Object path)) {
        $lines.Add("- ``$($file.path)``")
    }
    if ($Inventory.omittedCount -gt 0) {
        $lines.Add("")
        $lines.Add("## Omitted Files")
        $lines.Add("")
        foreach ($path in @($Inventory.omittedFiles | Select-Object -First 100)) {
            $lines.Add("- ``$path``")
        }
    }
    $lines.Add("")
    $lines.Add("## Limitations")
    $lines.Add("")
    $lines.Add("- Serena project language is configured as TypeScript, so Serena cache currently covers TS/JS/MJS files only.")
    $lines.Add("- PowerShell symbols are extracted by the PowerShell AST parser, not by Serena LSP.")
    $lines.Add("- Routing hints are candidates, not authority; run ``rg`` and tests before changing files.")

    return ($lines -join [Environment]::NewLine) + [Environment]::NewLine
}

function Append-LedgerRow {
    param(
        [string]$Path,
        [pscustomobject]$Row
    )

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if (Test-Path -LiteralPath $Path) {
        $Row | Export-Csv -NoTypeInformation -Encoding UTF8 -Append -LiteralPath $Path
    } else {
        $Row | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $Path
    }
}

$repoRoot = Resolve-RepoRoot
$scriptDir = Split-Path $MyInvocation.MyCommand.Path
$policyPath = Join-Path $repoRoot "config\serena_background_policy.json"
$policy = Read-JsonFile -Path $policyPath
if ($null -eq $policy) {
    throw "Missing policy file: $policyPath"
}

$artifactRoot = Join-Path $repoRoot $policy.artifacts.root
$runsRoot = Join-Path $repoRoot $policy.artifacts.runsDir
$symbolCardsRoot = Join-Path $repoRoot $policy.artifacts.symbolCardsDir
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $runsRoot $runId
New-Item -ItemType Directory -Force -Path $runDir, $artifactRoot, $symbolCardsRoot | Out-Null

$lockPath = Join-Path $repoRoot $policy.safety.lockFile
if (Test-Path -LiteralPath $lockPath) {
    throw "Serena background job lock exists: $lockPath"
}
Write-Utf8Text -Path $lockPath -Text "$PID $runId"

$status = "failed"
$errorMessage = ""
$localSummaryPath = ""
try {
    $capabilityPath = Join-Path $artifactRoot "capability.json"
    $capabilityJson = & (Join-Path $scriptDir "Test-SerenaCapability.ps1") -RepoRoot $repoRoot -OutputPath $capabilityPath
    $capability = $capabilityJson | ConvertFrom-Json

    if (!$SkipSerenaIndex) {
        Push-Location $repoRoot
        try {
            & serena project index --timeout 20 | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "serena project index exited with code $LASTEXITCODE"
            }
        } finally {
            Pop-Location
        }
    }

    $serenaSymbolsPath = Join-Path $runDir "serena-symbols.json"
    & python (Join-Path $scriptDir "Export-SerenaSymbols.py") $repoRoot --output $serenaSymbolsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Export-SerenaSymbols.py exited with code $LASTEXITCODE"
    }
    $serenaSymbols = Read-JsonFile -Path $serenaSymbolsPath

    $inventory = Get-RepositoryFiles -RepoRoot $repoRoot -Policy $policy -Limit $MaxFiles
    $inventoryPath = Join-Path $runDir "file-inventory.json"
    Write-Utf8Json -Path $inventoryPath -Value $inventory

    $powerShellFiles = @(
        $inventory.files |
            Where-Object { $_.extension -in @(".ps1", ".psm1", ".psd1") } |
            Select-Object -ExpandProperty path
    )
    $powerShellSymbolsPath = Join-Path $runDir "powershell-symbols.json"
    if ($powerShellFiles.Count -gt 0) {
        & (Join-Path $scriptDir "Export-PowerShellSymbols.ps1") `
            -RepoRoot $repoRoot `
            -Files $powerShellFiles `
            -OutputPath $powerShellSymbolsPath | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Export-PowerShellSymbols.ps1 exited with code $LASTEXITCODE"
        }
    } else {
        Write-Utf8Json -Path $powerShellSymbolsPath -Value ([ordered]@{
            generatedAt = (Get-Date).ToUniversalTime().ToString("o")
            repoRoot = $repoRoot
            fileCount = 0
            functionCount = 0
            parseErrorFileCount = 0
            psscriptAnalyzerAvailable = $false
            files = @()
        })
    }
    $powerShellSymbols = Read-JsonFile -Path $powerShellSymbolsPath

    $staticSymbols = @(Get-StaticSymbols -RepoRoot $repoRoot -RelativePaths @($inventory.files | Select-Object -ExpandProperty path))
    $staticSymbolsPath = Join-Path $runDir "static-symbols.json"
    Write-Utf8Json -Path $staticSymbolsPath -Value $staticSymbols

    $healthSummaryPath = Join-Path $runDir "serena-health-summary.json"
    Write-Utf8Json -Path $healthSummaryPath -Value $capability

    $routingHints = New-RoutingHints -Inventory $inventory -SerenaSymbols $serenaSymbols -PowerShellSymbols $powerShellSymbols -StaticSymbols $staticSymbols
    $routingHintsPath = Join-Path $repoRoot $policy.artifacts.routingHints
    Write-Utf8Json -Path $routingHintsPath -Value $routingHints

    foreach ($file in @($serenaSymbols.files | Sort-Object path)) {
        $safeName = ($file.path -replace '[\\/:\*\?"<>\|]', "__") + ".md"
        $cardPath = Join-Path $symbolCardsRoot $safeName
        $card = "# $($file.path)`n`n"
        $card += "- Serena symbols: $($file.symbolCount)`n"
        $card += "- Top-level symbols: $($file.topLevelSymbolCount)`n`n"
        foreach ($symbol in @($file.topLevelSymbols | Select-Object -First 80)) {
            $card += "- ``$($symbol.name)`` kind=$($symbol.kind) line=$($symbol.range.startLine)`n"
        }
        Write-Utf8Text -Path $cardPath -Text $card
    }

    $promptPath = Join-Path $runDir "local-llm-prompt.md"
    $prompt = @"
You are summarizing repository observations for an AI routing system.

Use only the JSON facts below. Do not invent files. If coverage is limited, say so.

Return concise Markdown with these headings:
- Coverage
- High-value files
- Routing risks
- Suggested next inspections

Inventory:
$(($inventory | ConvertTo-Json -Depth 16))

Serena symbols:
$(($serenaSymbols | ConvertTo-Json -Depth 16))

Static symbols:
$(($staticSymbols | ConvertTo-Json -Depth 16))

PowerShell AST symbols:
$(($powerShellSymbols | ConvertTo-Json -Depth 16))
"@
    Write-Utf8Text -Path $promptPath -Text $prompt

    if (!$SkipLocalLlm) {
        $localSummaryPath = Join-Path $runDir "local-llm-summary.md"
        try {
            & (Join-Path $scriptDir "Invoke-LocalLLM.ps1") `
                -PromptFile $promptPath `
                -OutputFile $localSummaryPath `
                -Model $Model `
                -TaskType "long_context" `
                -TaskTitle "Serena Background Repo Summary" `
                -TaskScale "Medium" `
                -NumCtx $NumCtx `
                -MinOutputChars 200 | Out-Host
        } catch {
            $localSummaryPath = ""
            Write-Warning "Local LLM summary failed: $($_.Exception.Message)"
        }
    }

    $repoMapPath = Join-Path $repoRoot $policy.artifacts.repoMap
    $repoMap = New-RepoMapMarkdown `
        -RunId $runId `
        -Capability $capability `
        -Inventory $inventory `
        -SerenaSymbols $serenaSymbols `
        -PowerShellSymbols $powerShellSymbols `
        -StaticSymbols $staticSymbols `
        -RoutingHints $routingHints `
        -LocalSummaryPath $localSummaryPath
    Write-Utf8Text -Path $repoMapPath -Text $repoMap

    $manifest = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        runId = $runId
        repoRoot = $repoRoot
        status = "success"
        artifacts = [ordered]@{
            capability = Get-RelativePathCompat -BasePath $repoRoot -Path $capabilityPath
            runDir = Get-RelativePathCompat -BasePath $repoRoot -Path $runDir
            inventory = Get-RelativePathCompat -BasePath $repoRoot -Path $inventoryPath
            serenaSymbols = Get-RelativePathCompat -BasePath $repoRoot -Path $serenaSymbolsPath
            powerShellSymbols = Get-RelativePathCompat -BasePath $repoRoot -Path $powerShellSymbolsPath
            staticSymbols = Get-RelativePathCompat -BasePath $repoRoot -Path $staticSymbolsPath
            healthSummary = Get-RelativePathCompat -BasePath $repoRoot -Path $healthSummaryPath
            repoMap = Get-RelativePathCompat -BasePath $repoRoot -Path $repoMapPath
            routingHints = Get-RelativePathCompat -BasePath $repoRoot -Path $routingHintsPath
            localLlmPrompt = Get-RelativePathCompat -BasePath $repoRoot -Path $promptPath
            localLlmSummary = if ($localSummaryPath) { Get-RelativePathCompat -BasePath $repoRoot -Path $localSummaryPath } else { "" }
        }
        coverage = [ordered]@{
            filesSeen = $inventory.totalFilesSeen
            policyCandidates = $inventory.policyCandidateCount
            filesIncluded = $inventory.includedCount
            filesOmitted = $inventory.omittedCount
            serenaSymbolFiles = $serenaSymbols.fileCount
            serenaSymbolCount = $serenaSymbols.symbolCount
            powerShellAstFiles = $powerShellSymbols.fileCount
            powerShellAstFunctions = $powerShellSymbols.functionCount
            powerShellParseErrorFiles = $powerShellSymbols.parseErrorFileCount
            staticSymbolFiles = @($staticSymbols).Count
        }
    }
    $manifestPath = Join-Path $repoRoot $policy.artifacts.latestManifest
    Write-Utf8Json -Path $manifestPath -Value $manifest

    $status = "success"
    [pscustomobject]$manifest | ConvertTo-Json -Depth 12
} catch {
    $errorMessage = $_.Exception.Message
    throw
} finally {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    $ledgerPath = Join-Path $repoRoot $policy.artifacts.ledger
    Append-LedgerRow -Path $ledgerPath -Row ([pscustomobject]@{
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        runId = $runId
        status = $status
        maxFiles = $MaxFiles
        skipLocalLlm = [bool]$SkipLocalLlm
        skipSerenaIndex = [bool]$SkipSerenaIndex
        error = $errorMessage
    })
}

if (!$Once) {
    Write-Host "One-shot run completed. Scheduling loop is not implemented in this script yet."
}

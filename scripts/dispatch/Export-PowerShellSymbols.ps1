param(
    [string]$RepoRoot,
    [string[]]$Files = @(),
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-RepoRoot {
    param([string]$Path)

    if (![string]::IsNullOrWhiteSpace($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    try {
        $gitRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($gitRoot)) {
            return [System.IO.Path]::GetFullPath($gitRoot.Trim())
        }
    } catch {
    }

    return (Get-Location).Path
}

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $parent = Split-Path -Parent $Path
    if (![string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $json = $Value | ConvertTo-Json -Depth 24
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8NoBom)
}

function ConvertTo-RelativePath {
    param(
        [string]$BasePath,
        [string]$Path
    )

    $baseFull = [System.IO.Path]::GetFullPath($BasePath)
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    if (!$baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFull += [System.IO.Path]::DirectorySeparatorChar
    }
    $baseUri = [Uri]::new($baseFull)
    $pathUri = [Uri]::new($pathFull)
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace("/", "\")
}

function Get-ParameterNames {
    param($ParamBlock)

    if ($null -eq $ParamBlock) {
        return @()
    }
    return @($ParamBlock.Parameters | ForEach-Object {
        $_.Name.VariablePath.UserPath
    })
}

function Get-CommandFacts {
    param($Ast)

    $commands = @(
        $Ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.CommandAst]
        }, $true)
    )

    $facts = foreach ($command in $commands) {
        $name = $command.GetCommandName()
        if ([string]::IsNullOrWhiteSpace($name)) {
            continue
        }

        $args = @($command.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text })
        [pscustomobject]@{
            name = $name
            line = $command.Extent.StartLineNumber
            invocationOperator = [string]$command.InvocationOperator
            arguments = @($args | Select-Object -First 8)
        }
    }

    return @($facts)
}

function Get-TopCommandNames {
    param([object[]]$Commands)

    return @(
        $Commands |
            Group-Object name |
            Sort-Object @{ Expression = "Count"; Descending = $true }, @{ Expression = "Name"; Descending = $false } |
            Select-Object -First 20 |
            ForEach-Object {
                [pscustomobject]@{
                    name = $_.Name
                    count = $_.Count
                }
            }
    )
}

function Get-Imports {
    param([object[]]$Commands)

    $imports = @()
    foreach ($command in $Commands) {
        if ($command.name -eq "Import-Module" -and $command.arguments.Count -gt 0) {
            $imports += [pscustomobject]@{
                module = ($command.arguments[0] -replace "^['""]|['""]$", "")
                line = $command.line
            }
        }
        if ($command.invocationOperator -eq "Dot" -and $command.arguments.Count -gt 0) {
            $imports += [pscustomobject]@{
                module = ($command.arguments[0] -replace "^['""]|['""]$", "")
                line = $command.line
                type = "dot-source"
            }
        }
    }
    return @($imports)
}

function Get-PSScriptAnalyzerDiagnostics {
    param([string]$Path)

    $module = Get-Module -ListAvailable PSScriptAnalyzer | Select-Object -First 1
    if ($null -eq $module) {
        return [pscustomobject]@{
            available = $false
            diagnostics = @()
        }
    }

    $diagnostics = @(Invoke-ScriptAnalyzer -Path $Path -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{
            ruleName = $_.RuleName
            severity = [string]$_.Severity
            line = $_.Line
            column = $_.Column
            message = $_.Message
        }
    })

    return [pscustomobject]@{
        available = $true
        diagnostics = $diagnostics
    }
}

$repoRootFull = Resolve-RepoRoot -Path $RepoRoot
if ($Files.Count -eq 0) {
    $Files = @(
        Get-ChildItem -LiteralPath $repoRootFull -Recurse -File -Include "*.ps1", "*.psm1", "*.psd1" |
            Where-Object { $_.FullName -notmatch "\\(reports|\.git|node_modules)\\" } |
            ForEach-Object { ConvertTo-RelativePath -BasePath $repoRootFull -Path $_.FullName }
    )
}

$results = @()
foreach ($relativePath in @($Files | Sort-Object -Unique)) {
    if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }
    $fullPath = if ([System.IO.Path]::IsPathRooted($relativePath)) {
        $relativePath
    } else {
        Join-Path $repoRootFull $relativePath
    }
    if (!(Test-Path -LiteralPath $fullPath)) { continue }

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($fullPath, [ref]$tokens, [ref]$parseErrors)
    $commands = Get-CommandFacts -Ast $ast
    $functionAsts = @(
        $ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        }, $true)
    )
    $localFunctionNames = @($functionAsts | ForEach-Object { $_.Name })

    $functions = foreach ($function in $functionAsts) {
        $functionCommands = Get-CommandFacts -Ast $function.Body
        $calledLocal = @(
            $functionCommands |
                Where-Object { $localFunctionNames -contains $_.name } |
                Select-Object -ExpandProperty name -Unique
        )

        [pscustomobject]@{
            name = $function.Name
            line = $function.Extent.StartLineNumber
            endLine = $function.Extent.EndLineNumber
            parameters = Get-ParameterNames -ParamBlock $function.Body.ParamBlock
            calledCommands = @(Get-TopCommandNames -Commands $functionCommands)
            calledLocalFunctions = $calledLocal
            hasShouldProcess = ($function.Extent.Text -match 'SupportsShouldProcess\s*=\s*\$true')
        }
    }

    $scriptAnalyzer = Get-PSScriptAnalyzerDiagnostics -Path $fullPath
    $results += [pscustomobject]@{
        path = (ConvertTo-RelativePath -BasePath $repoRootFull -Path $fullPath).Replace("\", "/")
        parseErrorCount = @($parseErrors).Count
        parseErrors = @($parseErrors | ForEach-Object {
            [pscustomobject]@{
                message = $_.Message
                errorId = $_.ErrorId
                line = $_.Extent.StartLineNumber
                column = $_.Extent.StartColumnNumber
            }
        })
        scriptParameters = Get-ParameterNames -ParamBlock $ast.ParamBlock
        functionCount = @($functions).Count
        functions = @($functions)
        imports = @(Get-Imports -Commands $commands)
        topCommands = @(Get-TopCommandNames -Commands $commands)
        scriptAnalyzer = $scriptAnalyzer
    }
}

$payload = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    repoRoot = $repoRootFull
    fileCount = @($results).Count
    functionCount = (@($results | ForEach-Object { $_.functionCount }) | Measure-Object -Sum).Sum
    parseErrorFileCount = @($results | Where-Object { $_.parseErrorCount -gt 0 }).Count
    psscriptAnalyzerAvailable = [bool](Get-Module -ListAvailable PSScriptAnalyzer | Select-Object -First 1)
    files = @($results)
}

if (![string]::IsNullOrWhiteSpace($OutputPath)) {
    Write-Utf8Json -Path $OutputPath -Value $payload
}

$payload | ConvertTo-Json -Depth 24

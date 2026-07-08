SEARCH:
function Test-SearchReplacePatch {
    param ([string]$rawOutput)
    $blocks = @()
    $pattern = '(?s)SEARCH:\s*(.*?)\s*REPLACE:\s*(.*?)(?=SEARCH:|$)'
    while ($rawOutput -match $pattern) {
        $search = $matches[1].Trim()
        $replace = $matches[2].Trim()
        $blocks += [PSCustomObject]@{ Success = $true; Search = $search; Replace = $replace }
        $rawOutput = $rawOutput.Substring($matches[0].Length).TrimStart()
    }
    if ($blocks.Count -eq 0) {
        return @([PSCustomObject]@{ Success = $false; Reason = "Invalid format." })
    } else {
        return $blocks
    }
}
REPLACE:
function Test-SearchReplacePatch {
    param ([string]$rawOutput)
    $blocks = @()
    # Pattern matches either SEARCH/REPLACE or REQUEST_CONTEXT blocks
    $pattern = '(?s)(?:SEARCH:\s*(.*?)\s*REPLACE:\s*(.*?)(?=^SEARCH:|^REQUEST_CONTEXT|\Z)|REQUEST_CONTEXT\s*(.*?)(?=^SEARCH:|^REQUEST_CONTEXT|\Z))'
    $offset = 0
    while ($offset -lt $rawOutput.Length) {
        if ($rawOutput.Substring($offset) -match $pattern) {
            $match = $Matches[0]
            if ($Matches[1] -ne $null) {
                # SEARCH/REPLACE block
                $search = $Matches[1].Trim()
                $replace = $Matches[2].Trim()
                $blocks += [PSCustomObject]@{ Success = $true; Search = $search; Replace = $replace; Type = 'Patch' }
            } elseif ($Matches[3] -ne $null) {
                # REQUEST_CONTEXT block
                $content = $Matches[3].Trim()
                $file = ""
                $reason = ""
                $lines = $content -split "`n"
                foreach ($line in $lines) {
                    if ($line -match '^\s*file:\s*(.+)$') { $file = $Matches[1].Trim() }
                    elseif ($line -match '^\s*reason:\s*(.+)$') { $reason = $Matches[1].Trim() }
                }
                $blocks += [PSCustomObject]@{ Success = $true; File = $file; Reason = $reason; Type = 'ContextRequest' }
            }
            $offset += $match.Length
        } else {
            break
        }
    }
    if ($blocks.Count -eq 0) {
        return @([PSCustomObject]@{ Success = $false; Reason = "Invalid format." })
    } else {
        return $blocks
    }
}
SEARCH:
$systemPrompt = @"
You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

CRITICAL FORMATTING RULES:
1. Provide ONLY the SEARCH and REPLACE blocks.
2. DO NOT use markdown code blocks (e.g. ```powershell).
3. The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
4. Your output MUST start exactly with SEARCH: and end with the replacement code.
5. DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.
단, 패치할 수 있으면 SEARCH/REPLACE를 우선하라고 지시한다.

EXAMPLE (HOW YOU MUST RESPOND):
[User Request]
Change the variable 'timeout' to 60.

[Original File]
`$timeout = 30
Write-Host `$timeout

[Your Output]
SEARCH:
`$timeout = 30
REPLACE:
`$timeout = 60

Context Manifest:
$manifest

User Prompt:
"@
REPLACE:
$systemPrompt = @"
You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

CRITICAL FORMATTING RULES:
1. Provide ONLY the SEARCH and REPLACE blocks.
2. DO NOT use markdown code blocks (e.g. ```powershell).
3. The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
4. Your output MUST start exactly with SEARCH: and end with the replacement code.
5. DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.
단, 패치할 수 있으면 SEARCH/REPLACE를 우선하라고 지시한다.

EXAMPLE (HOW YOU MUST RESPOND):
[User Request]
Change the variable 'timeout' to 60.

[Original File]
`$timeout = 30
Write-Host `$timeout

[Your Output]
SEARCH:
`$timeout = 30
REPLACE:
`$timeout = 60

Context Manifest:
$manifest

User Prompt:
"@
SEARCH:
-SuccessRegex "SEARCH:\s*[\s\S]+?REPLACE:"
REPLACE:
-SuccessRegex "(?:SEARCH:\s*[\s\S]+?REPLACE:|REQUEST_CONTEXT)"
SEARCH:
foreach ($res in $schemaResults) {
    # Attempt to apply patch to temp file to verify syntax
    try {
        Apply-SearchReplacePatch -targetFile $tempTestFile -search $res.Search -replace $res.Replace
    } catch {
        $validatorResult = [PSCustomObject]@{ Success = $false; Errors = "Apply failed during dry-run: $($_.Exception.Message)" }
        break
    }
}
REPLACE:
$contextHandled = $false
foreach ($res in $schemaResults) {
    if ($res.Type -eq 'Patch') {
        # Attempt to apply patch to temp file to verify syntax
        try {
            Apply-SearchReplacePatch -targetFile $tempTestFile -search $res.Search -replace $res.Replace
        } catch {
            $validatorResult = [PSCustomObject]@{ Success = $false; Errors = "Apply failed during dry-run: $($_.Exception.Message)" }
            break
        }
    } elseif ($res.Type -eq 'ContextRequest') {
        $requestFile = $res.File
        if ([string]::IsNullOrWhiteSpace($requestFile)) {
            $requestFile = $TargetFile
        } else {
            if (-not [System.IO.Path]::IsPathRooted($requestFile)) {
                $requestFile = [System.IO.Path]@{GetFullPath($requestFile)}
            }
        }
        if (Test-Path -LiteralPath $requestFile) {
            if ($Files -eq $null) { $Files = @() }
            if (-not $Files.Contains($requestFile)) {
                $Files += $requestFile
            }
            $Files = $Files | Select-Object -Unique
            $manifest = & (Join-Path $scriptDir "New-ContextManifest.ps1") -Files $Files -LineRanges $LineRanges
            $feedback += "`nContext request granted: $requestFile ($($res.Reason))"
            $contextHandled = $true
            break
        } else {
            $feedback += "`nContext request denied: File not found '$requestFile'"
            $contextHandled = $true
            break
        }
    }
}
if ($contextHandled) {
    continue
}


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
    $combinedPattern = "(?s)(REQUEST_CONTEXT(?:(?:\s*file:\s*(?<file>.*?))?\s*reason:\s*(?<reason>.*?))(?=REQUEST_CONTEXT|\s*$)|SEARCH:\s*(?<search>.*?)\s*REPLACE:\s*(?<replace>.*?)(?=SEARCH:|$))"
    while ($rawOutput -match $combinedPattern) {
        if ($matches['file']) {
            $file = $matches['file'].Trim()
            $reason = $matches['reason'].Trim()
            $blocks += [PSCustomObject]@{ Success = $true; Type = 'ContextRequest'; File = $file; Reason = $reason }
        } else {
            $search = $matches['search'].Trim()
            $replace = $matches['replace'].Trim()
            $blocks += [PSCustomObject]@{ Success = $true; Type = 'Patch'; Search = $search; Replace = $replace }
        }
        $rawOutput = $rawOutput.Substring($matches[0].Length).TrimStart()
    }
    if ($blocks.Count -eq 0) {
        return @([PSCustomObject]@{ Success = $false; Reason = "Invalid format." })
    } else {
        return $blocks
    }
}
SEARCH:
$schemaResults = Test-SearchReplacePatch -rawOutput $llmOutput

$allValid = $true
foreach ($res in $schemaResults) {
    if (-not $res.Success) {
        Write-Warning "Schema Gate failed on attempt $($attempt): $($res.Reason)"
        $feedback += "`nAttempt $($attempt) failed schema validation: $($res.Reason)."
        $allValid = $false
        break
    }
}
if (-not $allValid) {
    $attempt++
    continue
}
REPLACE:
$schemaResults = Test-SearchReplacePatch -rawOutput $llmOutput

# Handle context requests if any
$contextRequests = $schemaResults | Where-Object { $_.Type -eq 'ContextRequest' }
if ($contextRequests.Count -gt 0) {
    foreach ($ctx in $contextRequests) {
        $requestedFile = $ctx.File
        if ([string]::IsNullOrWhiteSpace($requestedFile)) {
            $requestedFile = $TargetFile
        }
        # Resolve to absolute path if relative
        if (-not [System.IO.Path]::IsPathRooted($requestedFile)) {
            $requestedFile = Join-Path -Path $PWD.ProviderPath -ChildPath $requestedFile
        }
        if (Test-Path -LiteralPath $requestedFile) {
            if ($Files -notcontains $requestedFile) {
                $Files += $requestedFile
            }
            # Rebuild manifest
            $manifest = & (Join-Path $scriptDir "New-ContextManifest.ps1") -Files $Files -LineRanges $LineRanges
            Write-Host "Context request granted for file: $requestedFile"
            $feedback += "`nAttempt $attempt: Context request granted for file: $requestedFile. Reason: $($ctx.Reason)."
        } else {
            Write-Warning "Context request denied: file $requestedFile not found."
            $feedback += "`nAttempt $attempt: Context request denied. File not found: $requestedFile. Reason: $($ctx.Reason)."
        }
    }
    $attempt++
    continue
}

$allValid = $true
foreach ($res in $schemaResults) {
    if (-not $res.Success) {
        Write-Warning "Schema Gate failed on attempt $($attempt): $($res.Reason)"
        $feedback += "`nAttempt $($attempt) failed schema validation: $($res.Reason)."
        $allValid = $false
        break
    }
}
if (-not $allValid) {
    $attempt++
    continue
}

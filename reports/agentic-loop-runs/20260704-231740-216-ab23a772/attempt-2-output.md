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
    # Parse REQUEST_CONTEXT blocks
    $requestPattern = '(?s)REQUEST_CONTEXT\s*file:\s*(.*?)\s*reason:\s*(.*?)(?=REQUEST_CONTEXT|$)'
    while ($rawOutput -match $requestPattern) {
        $file = $matches[1].Trim()
        $reason = $matches[2].Trim()
        $blocks += [PSCustomObject]@{ Success = $true; Type = 'ContextRequest'; File = $file; Reason = $reason }
        $rawOutput = $rawOutput.Substring($matches[0].Length).TrimStart()
    }
    # Parse SEARCH/REPLACE patches
    $patchPattern = '(?s)SEARCH:\s*(.*?)\s*REPLACE:\s*(.*?)(?=SEARCH:|$)'
    while ($rawOutput -match $patchPattern) {
        $search = $matches[1].Trim()
        $replace = $matches[2].Trim()
        $blocks += [PSCustomObject]@{ Success = $true; Type = 'Patch'; Search = $search; Replace = $replace }
        $rawOutput = $rawOutput.Substring($matches[0].Length).TrimStart()
    }
    if ($blocks.Count -eq 0) {
        return @([PSCustomObject]@{ Success = $false; Reason = "Invalid format." })
    } else {
        return $blocks
    }
}
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
foreach ($res in $schemaResults) {
    if ($res.Type -eq 'Patch') {
        # Attempt to apply patch to temp file to verify syntax
        try {
            Apply-SearchReplacePatch -targetFile $tempTestFile -search $res.Search -replace $res.Replace
        } catch {
            $validatorResult = [PSCustomObject]@{ Success = $false; Errors = "Apply failed during dry-run: $($_.Exception.Message)" }
            break
        }
    }
}
SEARCH:
if ($validatorResult.Success) {
    # Check final syntax
    $validatorResult = Test-SearchReplaceSyntax -targetFile $tempTestFile -search "" -replace ""
}
Remove-Item -LiteralPath $tempTestFile -ErrorAction SilentlyContinue

if (-not $validatorResult.Success) {
    Write-Warning "Validator Gate failed on attempt $($attempt): $($validatorResult.Errors)"
    $feedback += "`nAttempt $($attempt) failed syntax validation: $($validatorResult.Errors). Your REPLACE code must be valid PowerShell."
    $attempt++
    continue
}

# Actually apply the patches
$isReadOnly = $SandboxMode.IsPresent -or ($StateMachine -eq 'ArchitectureReview')
try {
    foreach ($res in $schemaResults) {
        Apply-SearchReplacePatch -targetFile $TargetFile -search $res.Search -replace $res.Replace -ReadOnly:$isReadOnly
    }
    Write-Host "Successfully applied patch on attempt $attempt."
    break
} catch {
    Write-Warning "Apply Gate failed on attempt $($attempt): $($_.Exception.Message)"
    $feedback += "`nAttempt $($attempt) failed to apply: $($_.Exception.Message). Ensure your SEARCH string exactly matches the original file."
    $attempt++
    continue
}
REPLACE:
if ($validatorResult.Success) {
    # Check final syntax
    $validatorResult = Test-SearchReplaceSyntax -targetFile $tempTestFile -search "" -replace ""
}
Remove-Item -LiteralPath $tempTestFile -ErrorAction SilentlyContinue

if (-not $validatorResult.Success) {
    Write-Warning "Validator Gate failed on attempt $($attempt): $($validatorResult.Errors)"
    $feedback += "`nAttempt $($attempt) failed syntax validation: $($validatorResult.Errors). Your REPLACE code must be valid PowerShell."
    $attempt++
    continue
}

# Handle any context requests before applying patches
$contextRequested = $false
foreach ($res in $schemaResults) {
    if ($res.Type -eq 'ContextRequest') {
        $contextRequested = $true
        # Resolve file path
        $requestedFile = $res.File
        if ([string]::IsNullOrWhiteSpace($requestedFile)) {
            $requestedFile = $TargetFile
        } elseif (-not [System.IO.Path]::IsPathRooted($requestedFile)) {
            $requestedFile = Join-Path -Path (Get-Location) -ChildPath $requestedFile
        }
        if (Test-Path -LiteralPath $requestedFile) {
            if (-not $Files.Contains($requestedFile)) {
                $Files += $requestedFile
                # Remove duplicates
                $Files = $Files | Sort-Object -Unique
                # Rebuild manifest
                $manifest = & (Join-Path $scriptDir "New-ContextManifest.ps1") -Files $Files -LineRanges $LineRanges
                $feedback += "`nContext request granted for file '$requestedFile': $($res.Reason)"
            }
        } else {
            $feedback += "`nContext request denied: file '$requestedFile' does not exist. Reason: $($res.Reason)"
        }
        $attempt++
        break
    }
}

if ($contextRequested) {
    continue
}

# Actually apply the patches
$isReadOnly = $SandboxMode.IsPresent -or ($StateMachine -eq 'ArchitectureReview')
try {
    foreach ($res in $schemaResults) {
        if ($res.Type -eq 'Patch') {
            Apply-SearchReplacePatch -targetFile $TargetFile -search $res.Search -replace $res.Replace -ReadOnly:$isReadOnly
        }
    }
    Write-Host "Successfully applied patch on attempt $attempt."
    break
} catch {
    Write-Warning "Apply Gate failed on attempt $($attempt): $($_.Exception.Message)"
    $feedback += "`nAttempt $($attempt) failed to apply: $($_.Exception.Message). Ensure your SEARCH string exactly matches the original file."
    $attempt++
    continue
}

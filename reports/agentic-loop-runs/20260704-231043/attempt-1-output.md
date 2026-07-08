SEARCH:
function Test-SearchReplaceSyntax {
    param (
        [string]$targetFile,
        [string]$search,
        [string]$replace
    )
    
    try {
        $content = Get-Content -Path $targetFile -Raw
        if ([string]::IsNullOrEmpty($search)) {
            $updatedContent = $content
        } else {
            $updatedContent = $content.Replace($search, $replace)
        }
        [scriptblock]::Create($updatedContent) | Out-Null
        return [PSCustomObject]@{
            Success = $true
        }
    } catch {
        return [PSCustomObject]@{
            Success = $false
            Errors  = "Patched file would have invalid syntax: $($_.Exception.Message)"
        }
    }
}
REPLACE:
function Test-SearchReplaceSyntax {
    param (
        [string]$targetFile,
        [string]$search,
        [string]$replace
    )
    
    try {
        $content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
        if ([string]::IsNullOrEmpty($search)) {
            $updatedContent = $content
        } else {
            $updatedContent = $content.Replace($search, $replace)
        }
        $ext = [System.IO.Path]::GetExtension($targetFile).ToLowerInvariant()
        if ($ext -in @(".ps1", ".psm1", ".psd1")) {
            [scriptblock]::Create($updatedContent) | Out-Null
        } elseif ($ext -eq ".json") {
            ConvertFrom-Json $updatedContent | Out-Null
        } else {
            return [PSCustomObject]@{
                Success = $true
            }
        }
        return [PSCustomObject]@{
            Success = $true
        }
    } catch {
        return [PSCustomObject]@{
            Success = $false
            Errors  = "Patched file would have invalid syntax: $($_.Exception.Message)"
        }
    }
}
SEARCH:
function Apply-SearchReplacePatch {
    param (
        [string]$targetFile,
        [string]$search,
        [string]$replace,
        [switch]$ReadOnly
    )
    
    if (-not (Test-Path -LiteralPath $targetFile)) {
        throw "Apply Gate failed: Target file '$targetFile' does not exist."
    }
    if ([string]::IsNullOrWhiteSpace($search)) {
        throw "Apply Gate failed: SEARCH block cannot be empty. You must provide the exact lines to replace."
    }
    
    $content = Get-Content -Path $targetFile -Raw
    
    $escapedSearch = [regex]::Escape($search)
    $matches = [regex]::Matches($content, $escapedSearch)
    
    if ($matches.Count -eq 0) {
        throw "Apply Gate failed: The SEARCH string was not found in the target file. (Search string: '$search')"
    } elseif ($matches.Count -gt 1) {
        throw "Apply Gate failed: The SEARCH string matches $($matches.Count) times. Please provide a larger SEARCH block to uniquely identify the location."
    }
    
    # Use literal replace to avoid regex injection (e.g., $&, $1)
    $updatedContent = $content.Replace($search, $replace)
    
    if ($ReadOnly) {
        Write-Host "Dry-run validation successful. Skipping write to $targetFile (read-only mode)."
        return
    }
    
    Set-Content -Path $targetFile -Value $updatedContent -Encoding UTF8 -NoNewline
    Write-Host "Successfully applied patch."
}
REPLACE:
function Apply-SearchReplacePatch {
    param (
        [string]$targetFile,
        [string]$search,
        [string]$replace,
        [switch]$ReadOnly
    )
    
    if (-not (Test-Path -LiteralPath $targetFile)) {
        throw "Apply Gate failed: Target file '$targetFile' does not exist."
    }
    if ([string]::IsNullOrWhiteSpace($search)) {
        throw "Apply Gate failed: SEARCH block cannot be empty. You must provide the exact lines to replace."
    }
    
    $content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
    
    $escapedSearch = [regex]::Escape($search)
    $matches = [regex]::Matches($content, $escapedSearch)
    
    if ($matches.Count -eq 0) {
        throw "Apply Gate failed: The SEARCH string was not found in the target file. (Search string: '$search')"
    } elseif ($matches.Count -gt 1) {
        throw "Apply Gate failed: The SEARCH string matches $($matches.Count) times. Please provide a larger SEARCH block to uniquely identify the location."
    }
    
    # Use literal replace to avoid regex injection (e.g., $&, $1)
    $updatedContent = $content.Replace($search, $replace)
    
    if ($ReadOnly) {
        Write-Host "Dry-run validation successful. Skipping write to $targetFile (read-only mode)."
        return
    }
    
    Set-Content -LiteralPath $targetFile -Value $updatedContent -Encoding UTF8 -NoNewline
    Write-Host "Successfully applied patch."
}

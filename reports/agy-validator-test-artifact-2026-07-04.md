# AGY Validator Test Checklist

This artifact outlines the manual verification steps for the language-aware validation behavior implemented in [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1).

> [!WARNING]
> **Identified Extension Hardcoding Bug in Script**
> In the current implementation of `Invoke-AgenticLoop.ps1` (lines 363–364):
> ```powershell
> $tempTestFile = Join-Path $env:TEMP "ast_test_$([guid]::NewGuid()).ps1"
> Copy-Item -Path $TargetFile -Destination $tempTestFile
> ```
> The temporary validation file `$tempTestFile` is hardcoded with a `.ps1` extension. As a result, [Test-SearchReplaceSyntax](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1#L126-L159) treats **all** files (including `.json`, `.txt`, and `.md`) as PowerShell scripts and attempts script block compilation, causing syntax failures for non-PowerShell files.
>
> **Recommended Fix**:
> ```powershell
> $ext = [System.IO.Path]::GetExtension($TargetFile)
> $tempTestFile = Join-Path $env:TEMP "ast_test_$([guid]::NewGuid())$ext"
> ```
> 
> The checklist below contains direct function validation commands (which bypass this bug by testing the functions with correct extensions) as well as whole-loop test commands.

---

## 1. Setup Test Functions
To test the syntax validation and patch application functions, run the following block in your PowerShell terminal to define the functions locally:

```powershell
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
            return [PSCustomObject]@{ Success = $true }
        }
        return [PSCustomObject]@{ Success = $true }
    } catch {
        return [PSCustomObject]@{
            Success = $false
            Errors  = "Patched file would have invalid syntax: $($_.Exception.Message)"
        }
    }
}

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
        throw "Apply Gate failed: SEARCH block cannot be empty."
    }
    
    $content = Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8
    $escapedSearch = [regex]::Escape($search)
    $matches = [regex]::Matches($content, $escapedSearch)
    
    if ($matches.Count -eq 0) {
        throw "Apply Gate failed: The SEARCH string was not found."
    } elseif ($matches.Count -gt 1) {
        throw "Apply Gate failed: The SEARCH string matches $($matches.Count) times."
    }
    
    $updatedContent = $content.Replace($search, $replace)
    if ($ReadOnly) {
        Write-Host "Dry-run validation successful (read-only mode)."
        return
    }
    Set-Content -LiteralPath $targetFile -Value $updatedContent -Encoding UTF8 -NoNewline
}
```

---

## 2. Validation Scenarios & Verification Commands

### Case 1: `.ps1` Syntax Validation
Verify that valid PowerShell syntax passes while invalid syntax is correctly rejected.

```powershell
# Create temp files
$validPs1 = Join-Path $env:TEMP "test_valid.ps1"
$invalidPs1 = Join-Path $env:TEMP "test_invalid.ps1"

Set-Content -LiteralPath $validPs1 -Value "Write-Host 'Hello World'" -Encoding UTF8
Set-Content -LiteralPath $invalidPs1 -Value "Write-Host { 'Hello World'" -Encoding UTF8 # Missing closing brace

# Test
$resValid = Test-SearchReplaceSyntax -targetFile $validPs1
$resInvalid = Test-SearchReplaceSyntax -targetFile $invalidPs1

Write-Host "Valid PS1 Result (Expected: True): $($resValid.Success)"
Write-Host "Invalid PS1 Result (Expected: False): $($resInvalid.Success)"
Write-Host "Invalid PS1 Error Message: $($resInvalid.Errors)"

# Clean up
Remove-Item $validPs1, $invalidPs1 -ErrorAction SilentlyContinue
```

### Case 2: `.json` Syntax Validation
Verify that valid JSON syntax passes while invalid JSON syntax is correctly rejected.

```powershell
# Create temp files
$validJson = Join-Path $env:TEMP "test_valid.json"
$invalidJson = Join-Path $env:TEMP "test_invalid.json"

Set-Content -LiteralPath $validJson -Value '{"name": "AGY", "active": true}' -Encoding UTF8
Set-Content -LiteralPath $invalidJson -Value '{"name": "AGY", "active":' -Encoding UTF8 # Malformed JSON

# Test
$resValid = Test-SearchReplaceSyntax -targetFile $validJson
$resInvalid = Test-SearchReplaceSyntax -targetFile $invalidJson

Write-Host "Valid JSON Result (Expected: True): $($resValid.Success)"
Write-Host "Invalid JSON Result (Expected: False): $($resInvalid.Success)"
Write-Host "Invalid JSON Error Message: $($resInvalid.Errors)"

# Clean up
Remove-Item $validJson, $invalidJson -ErrorAction SilentlyContinue
```

### Case 3: Non-PowerShell/Non-JSON Files Bypass
Verify that files with other extensions (e.g., `.txt`, `.md`) bypass syntax validation (always return `Success = $true` regardless of contents) but are still subject to SEARCH matching constraints.

```powershell
# Create temp text file with invalid syntax markup
$txtFile = Join-Path $env:TEMP "test_bypass.txt"
Set-Content -LiteralPath $txtFile -Value "This is raw text { that would fail PowerShell compile" -Encoding UTF8

# Test Bypass (Expected: True)
$resTxt = Test-SearchReplaceSyntax -targetFile $txtFile
Write-Host "Text File Syntax Bypass Result: $($resTxt.Success)"

# Test SEARCH matching constraints
# 1. Matching SEARCH should succeed
Apply-SearchReplacePatch -targetFile $txtFile -search "This is raw text" -replace "This is patched text" -ReadOnly

# 2. Non-matching SEARCH should throw an error
try {
    Apply-SearchReplacePatch -targetFile $txtFile -search "Non-existent text" -replace "Nothing"
} catch {
    Write-Host "Successfully caught SEARCH mismatch: $($_.Exception.Message)"
}

# Clean up
Remove-Item $txtFile -ErrorAction SilentlyContinue
```

### Case 4: UTF-8 Korean Text Preservation
Verify that Korean characters are read, matched, and written correctly without encoding corruption (Mojibake).

```powershell
# Create temp file with Korean characters
$koreanFile = Join-Path $env:TEMP "test_korean.txt"
$initialText = "안녕하세요, 안티그래비티 한국어 테스트 파일입니다.`n기존 라인."
Set-Content -LiteralPath $koreanFile -Value $initialText -Encoding UTF8 -NoNewline

# Verify read
$readInitial = Get-Content -LiteralPath $koreanFile -Raw -Encoding UTF8
Write-Host "Read check (Expected: True): $($readInitial -eq $initialText)"

# Apply patch containing Korean characters
Apply-SearchReplacePatch -targetFile $koreanFile -search "안녕하세요, 안티그래비티 한국어 테스트 파일입니다." -replace "반갑습니다, 수정 완료된 한국어 텍스트입니다."

# Verify output is successfully written in UTF-8
$updatedText = Get-Content -LiteralPath $koreanFile -Raw -Encoding UTF8
Write-Host "Updated file content:"
Write-Host $updatedText
Write-Host "Preserved UTF-8 correctly: $($updatedText -match '반갑습니다')"

# Clean up
Remove-Item $koreanFile -ErrorAction SilentlyContinue
```

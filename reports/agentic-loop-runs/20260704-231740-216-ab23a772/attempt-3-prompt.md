You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

CRITICAL FORMATTING RULES:
1. Provide ONLY the SEARCH and REPLACE blocks.
2. DO NOT use markdown code blocks (e.g. `powershell).
3. The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
4. Your output MUST start exactly with SEARCH: and end with the replacement code.
5. DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.

EXAMPLE (HOW YOU MUST RESPOND):
[User Request]
Change the variable 'timeout' to 60.

[Original File]
$timeout = 30
Write-Host $timeout

[Your Output]
SEARCH:
$timeout = 30
REPLACE:
$timeout = 60

Context Manifest:
| File | Start | End | Length |
|------|-------|-----|--------|
| C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-AgenticLoop.ps1 | 1 | ALL | 16225 | 

### File: C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-AgenticLoop.ps1
```powershell
param (
    [Parameter(Mandatory=$true)]
    [string]$Prompt,

    [Parameter(Mandatory=$true)]
    [string]$TargetFile,

    [int]$MaxRetries = 3,
    [string]$Model = "",
    [switch]$SandboxMode,
    [string[]]$Files,
    [hashtable]$LineRanges = @{},
    [string]$StateMachine,
    [int]$NumCtx = 0,
    [ValidateSet("summarization", "extraction", "coding", "reasoning", "korean", "long_context", "routing_review", "general")]
    [string]$TaskType = "coding",
    [string]$TaskScale = "Large",
    [string]$TaskTitle = "",
    [switch]$NoHardwareSnapshot,
    [switch]$KeepArtifacts,
    [string]$ArtifactDir = ""
)

$scriptDir = Split-Path $MyInvocation.MyCommand.Path

function Select-AgenticLoopModelBudget {
    param(
        [string]$RequestedModel,
        [int]$RequestedNumCtx,
        [string]$TaskType,
        [string]$TaskScale,
        [switch]$NoHardwareSnapshot
    )

    $selector = Join-Path $scriptDir "Select-LocalLLMModel.ps1"
    $selectedBy = "manual"
    $selectionReason = ""
    $recommendedMaxTokens = 0

    $modelWasRequested = ![string]::IsNullOrWhiteSpace($RequestedModel)

    if (!$modelWasRequested -or $RequestedNumCtx -le 0) {
        if (!(Test-Path -LiteralPath $selector)) {
            throw "Model selector not found: $selector"
        }

        $selectorArgs = @{
            TaskType      = $TaskType
            TaskScale     = $TaskScale
            InstalledOnly = $true
            AsJson        = $true
        }
        if ($NoHardwareSnapshot) {
            $selectorArgs.NoHardwareSnapshot = $true
        }

        $selection = & $selector @selectorArgs | ConvertFrom-Json
        $requestedCandidate = $null
        if ($modelWasRequested -and $selection.Candidates) {
            $requestedCandidate = $selection.Candidates | Where-Object { $_.Model -eq $RequestedModel } | Select-Object -First 1
        }

        if (!$modelWasRequested) {
            $RequestedModel = [string]$selection.SelectedModel
            $selectedBy = "Select-LocalLLMModel"
        }
        if ($RequestedNumCtx -le 0) {
            if ($null -ne $requestedCandidate -and $requestedCandidate.RecommendedNumCtx) {
                $RequestedNumCtx = [int]$requestedCandidate.RecommendedNumCtx
            }
            else {
                $RequestedNumCtx = [int]$selection.RecommendedNumCtx
            }
            if ($modelWasRequested) {
                $selectedBy = "Select-LocalLLMModelBudget"
            }
        }
        if ($null -ne $requestedCandidate -and $requestedCandidate.RecommendedMaxTokens) {
            $recommendedMaxTokens = [int]$requestedCandidate.RecommendedMaxTokens
        }
        elseif ($selection.RecommendedMaxTokens) {
            $recommendedMaxTokens = [int]$selection.RecommendedMaxTokens
        }
        $selectionReason = [string]$selection.Reason
        if ($modelWasRequested -and $null -ne $requestedCandidate) {
            $selectionReason = "$selectionReason Explicit model '$RequestedModel' kept; using that candidate's recommended budget."
        }
    }

    if ([string]::IsNullOrWhiteSpace($RequestedModel)) {
        throw "Unable to resolve a local LLM model."
    }
    if ($RequestedNumCtx -le 0) {
        $RequestedNumCtx = 8192
        if ([string]::IsNullOrWhiteSpace($selectionReason)) {
            $selectionReason = "Fell back to NumCtx=8192 because no selector budget was available."
        }
    }

    [pscustomobject]@{
        Model                = $RequestedModel
        NumCtx               = $RequestedNumCtx
        RecommendedMaxTokens = $recommendedMaxTokens
        SelectedBy           = $selectedBy
        SelectionReason      = $selectionReason
    }
}

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

# Call New-ContextManifest.ps1 to generate manifest
$manifest = ""
if ($Files) {
    $manifest = & (Join-Path $scriptDir "New-ContextManifest.ps1") -Files $Files -LineRanges $LineRanges
}

$modelBudget = Select-AgenticLoopModelBudget -RequestedModel $Model -RequestedNumCtx $NumCtx -TaskType $TaskType -TaskScale $TaskScale -NoHardwareSnapshot:$NoHardwareSnapshot
$Model = $modelBudget.Model
$NumCtx = $modelBudget.NumCtx
if ([string]::IsNullOrWhiteSpace($TaskTitle)) {
    $TaskTitle = "Agentic Loop: $(Split-Path -Leaf $TargetFile)"
}

Write-Host "Agentic Loop model budget: model=$Model numCtx=$NumCtx selectedBy=$($modelBudget.SelectedBy)"
if (![string]::IsNullOrWhiteSpace($modelBudget.SelectionReason)) {
    Write-Host "Selection reason: $($modelBudget.SelectionReason)"
}
if ($modelBudget.RecommendedMaxTokens -gt 0) {
    Write-Host "Recommended max tokens for providers that support it: $($modelBudget.RecommendedMaxTokens)"
}

# Handle Artifact Preservation Mode
if ($KeepArtifacts) {
    if ([string]::IsNullOrWhiteSpace($ArtifactDir)) {
        $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss-fff") + "-" + [guid]::NewGuid().ToString("N").Substring(0,8)
        $ArtifactDir = Join-Path (Join-Path "reports" "agentic-loop-runs") $timestamp
    }
    # Resolve relative path under current working directory (repo root)
    if (-not [System.IO.Path]::IsPathRooted($ArtifactDir)) {
        $ArtifactDir = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PWD.ProviderPath, $ArtifactDir))
    }
    # Create the directory if it doesn't exist
    if (-not (Test-Path -LiteralPath $ArtifactDir)) {
        [System.IO.Directory]::CreateDirectory($ArtifactDir) | Out-Null
    }
    Write-Host "Artifact directory: $ArtifactDir"
}

$attempt = 1
$feedback = ""

while ($attempt -le $MaxRetries) {
    if ($KeepArtifacts) {
        $promptPath = Join-Path $ArtifactDir "attempt-$attempt-prompt.md"
        $outputPath = Join-Path $ArtifactDir "attempt-$attempt-output.md"
        # Create empty files to mimic New-TemporaryFile
        [System.IO.File]::WriteAllText($promptPath, "", [System.Text.Encoding]::UTF8)
        [System.IO.File]::WriteAllText($outputPath, "", [System.Text.Encoding]::UTF8)
        $tempPromptFile = Get-Item -LiteralPath $promptPath
        $tempOutputFile = Get-Item -LiteralPath $outputPath
    } else {
        $tempPromptFile = New-TemporaryFile
        $tempOutputFile = New-TemporaryFile
    }
    try {
        # Prepare the prompt with the new system prompt and manifest
        $systemPrompt = ""
        if ($Files) {
            $systemPrompt = @"
You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

CRITICAL FORMATTING RULES:
1. Provide ONLY the SEARCH and REPLACE blocks.
2. DO NOT use markdown code blocks (e.g. ```powershell).
3. The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
4. Your output MUST start exactly with SEARCH: and end with the replacement code.
5. DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.

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
        } else {
            $systemPrompt = @"
You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

CRITICAL FORMATTING RULES:
1. Provide ONLY the SEARCH and REPLACE blocks.
2. DO NOT use markdown code blocks (e.g. ```powershell).
3. The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
4. Your output MUST start exactly with SEARCH: and end with the replacement code.
5. DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.

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

User Prompt:
"@
        }

        $combinedPrompt = "$systemPrompt`n$Prompt"
        if (![string]::IsNullOrWhiteSpace($feedback)) {
            $combinedPrompt += "`n`n=== PREVIOUS ATTEMPT FEEDBACK ===`n$feedback`nDO NOT REPEAT THE SAME MISTAKE."
        }

        Set-Content -Path $tempPromptFile -Value $combinedPrompt -Encoding UTF8
        
        $invokeScript = Join-Path $scriptDir "Invoke-LocalLLM.ps1"
        Write-Host "Attempt $($attempt): Invoking Local LLM ($Model)..."
        & $invokeScript `
            -PromptFile $tempPromptFile.FullName `
            -OutputFile $tempOutputFile.FullName `
            -Model $Model `
            -NumCtx $NumCtx `
            -TaskTitle $TaskTitle `
            -TaskType $TaskType `
            -TaskScale $TaskScale `
            -SelectedBy $modelBudget.SelectedBy `
            -SelectionReason $modelBudget.SelectionReason `
            -SuccessRegex "SEARCH:\s*[\s\S]+?REPLACE:" `
            -MinOutputChars 20 | Out-Null
        
        if (Test-Path -LiteralPath $tempOutputFile.FullName) {
            $llmOutput = Get-Content -Path $tempOutputFile.FullName -Raw -Encoding UTF8
            
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
            
            # For AST validation and Application, we apply them sequentially.
            # We must validate the AST of the final patched file.
            $validatorResult = [PSCustomObject]@{ Success = $true }
            
            # Create a temporary file to test the patch
            $ext = [System.IO.Path]::GetExtension($TargetFile)
            if ([string]::IsNullOrEmpty($ext)) { $ext = ".tmp" }
            $tempTestFile = Join-Path $env:TEMP "ast_test_$([guid]::NewGuid())$ext"
            Copy-Item -LiteralPath $TargetFile -Destination $tempTestFile
            
            foreach ($res in $schemaResults) {
                # Attempt to apply patch to temp file to verify syntax
                try {
                    Apply-SearchReplacePatch -targetFile $tempTestFile -search $res.Search -replace $res.Replace
                } catch {
                    $validatorResult = [PSCustomObject]@{ Success = $false; Errors = "Apply failed during dry-run: $($_.Exception.Message)" }
                    break
                }
            }
            
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
        } else {
            Write-Warning "Output file not generated."
            $feedback += "`nAttempt $($attempt) failed: No output generated."
            $attempt++
            continue
        }
    } catch {
        Write-Error $_.Exception.Message
        $feedback += "`nAttempt $($attempt) encountered a script error: $($_.Exception.Message)"
        $attempt++
    } finally {
        if (-not $KeepArtifacts) {
            if ($null -ne $tempPromptFile -and (Test-Path -LiteralPath $tempPromptFile.FullName)) { Remove-Item -LiteralPath $tempPromptFile.FullName -Force }
            if ($null -ne $tempOutputFile -and (Test-Path -LiteralPath $tempOutputFile.FullName)) { Remove-Item -LiteralPath $tempOutputFile.FullName -Force }
        }
    }
}

if ($attempt -gt $MaxRetries) {
    throw "Agentic Loop failed after $MaxRetries attempts."
}

```


User Prompt:
Invoke-AgenticLoop.ps1에 최소 REQUEST_CONTEXT 지원을 구현하라.

목표:
로컬 LLM 출력이 SEARCH/REPLACE가 아니라 REQUEST_CONTEXT일 때 schema 실패로 처리하지 말고, 요청한 파일을 context manifest에 추가한 뒤 다음 attempt로 재시도하게 한다.

정확한 요구사항:
1. Test-SearchReplacePatch 함수가 다음 두 종류를 구분해 반환하게 하라.
   - SEARCH/REPLACE patch: 기존처럼 Search/Replace 포함, Type="Patch"
   - REQUEST_CONTEXT: Type="ContextRequest", File=<요청 파일 또는 빈 문자열>, Reason=<짧은 원문/사유>
2. REQUEST_CONTEXT 형식은 최소한 다음을 인식한다.
   REQUEST_CONTEXT
   file: <path>
   reason: <text>
   file 줄이 없으면 TargetFile을 기본값으로 쓰게 loop 쪽에서 처리한다.
3. system prompt의 formatting rules에 허용 출력으로 REQUEST_CONTEXT를 추가한다. 단, 패치할 수 있으면 SEARCH/REPLACE를 우선하라고 지시한다.
4. schemaResults 처리 후 ContextRequest가 있으면:
   - 요청 파일이 상대경로면 현재 작업 디렉터리 기준으로 절대경로화한다.
   - 파일이 존재하면 Files 배열에 추가하고 중복 제거한다.
   - New-ContextManifest.ps1로 manifest를 다시 만든다.
   - feedback에 context request가 grant되었다고 기록한다.
   - attempt++ 후 continue 한다.
   - 이 turn에서는 patch apply를 하지 않는다.
5. 요청 파일이 존재하지 않으면 feedback에 거절 사유를 기록하고 attempt++ 후 continue 한다.
6. 기존 SEARCH/REPLACE, validation, KeepArtifacts, metrics 동작은 유지한다.
7. 필요한 SEARCH/REPLACE 블록만 출력하라.

=== PREVIOUS ATTEMPT FEEDBACK ===

Attempt 1 failed syntax validation: Apply failed during dry-run: Apply Gate failed: The SEARCH string was not found in the target file. (Search string: '\s*(.*?)\s*'). Your REPLACE code must be valid PowerShell.
Attempt 2 failed syntax validation: Apply failed during dry-run: Apply Gate failed: The SEARCH string was not found in the target file. (Search string: '|$)'
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
}'). Your REPLACE code must be valid PowerShell.
DO NOT REPEAT THE SAME MISTAKE.

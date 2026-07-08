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
| C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-AgenticLoop.ps1 | 1 | ALL | 15641 | 

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
        $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
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
            $tempTestFile = Join-Path $env:TEMP "ast_test_$([guid]::NewGuid()).ps1"
            Copy-Item -Path $TargetFile -Destination $tempTestFile
            
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
Invoke-AgenticLoop.ps1의 validation과 file read encoding을 개선하라.

정확한 요구사항:
1. Test-SearchReplaceSyntax는 대상 파일 확장자를 보고 검증한다.
   - .ps1, .psm1, .psd1 은 기존처럼 [scriptblock]::Create 로 PowerShell syntax check를 한다.
   - .json 은 ConvertFrom-Json 으로 JSON syntax check를 한다.
   - 그 외 확장자는 syntax check를 건너뛰고 Success=$true 를 반환한다.
2. Test-SearchReplaceSyntax 내부 Get-Content는 반드시 -LiteralPath 와 -Encoding UTF8 을 사용한다.
3. Apply-SearchReplacePatch 내부 Get-Content도 반드시 -LiteralPath 와 -Encoding UTF8 을 사용한다.
4. Apply-SearchReplacePatch의 Set-Content도 -LiteralPath를 사용한다.
5. 기존 SEARCH/REPLACE parsing, model selection, artifact mode, metrics 동작은 바꾸지 마라.
6. 필요한 SEARCH/REPLACE 블록만 출력하라.

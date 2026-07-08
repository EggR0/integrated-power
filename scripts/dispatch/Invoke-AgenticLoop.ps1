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
    [string]$ArtifactDir = "",
    [int]$CandidateCount = 1,
    [switch]$EnableBreaker,
    [ValidateSet("syntax", "syntax_and_command", "command_only", "none")]
    [string]$ValidatorProfile = "syntax",
    [string]$ValidationCommand = "",
    [int]$ValidationTimeoutSeconds = 120
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
    
    if ($rawOutput -match '(?i)REQUEST_CONTEXT') {
        $matches = [regex]::Matches($rawOutput, '(?mi)^REQUEST_CONTEXT[ \t]*(?:\r?\n(?!\s*(?:REQUEST_CONTEXT|SEARCH:))[^\r\n]*)*')
        foreach ($m in $matches) {
            $blockText = $m.Value
            $fileMatch = [regex]::Match($blockText, '(?mi)^file:\s*([^\r\n]+)')
            $reasonMatch = [regex]::Match($blockText, '(?mi)^reason:\s*([^\r\n]+)')
            
            $file = if ($fileMatch.Success) { $fileMatch.Groups[1].Value.Trim() } else { "" }
            $reason = if ($reasonMatch.Success) { $reasonMatch.Groups[1].Value.Trim() } else { "" }
            
            $blocks += [PSCustomObject]@{
                Success = $true
                Type    = "ContextRequest"
                File    = $file
                Reason  = $reason
            }
        }
    }
    
    if ($blocks.Count -eq 0) {
        $pattern = '(?ms)(?:^FILE:\s*(?<file>[^\r\n]+)\r?\n)?^SEARCH:\s*(?<search>.*?)\s*^REPLACE:\s*(?<replace>.*?)(?=^FILE:|^SEARCH:|\z)'
        $matches = [regex]::Matches($rawOutput, $pattern)
        foreach ($m in $matches) {
            $file = if ($m.Groups["file"].Success) { $m.Groups["file"].Value.Trim() } else { "" }
            $search = $m.Groups["search"].Value.Trim()
            $replace = $m.Groups["replace"].Value.Trim()
            $blocks += [PSCustomObject]@{
                Success = $true
                Type    = "Patch"
                File    = $file
                Search  = $search
                Replace = $replace
            }
        }
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

function Resolve-AgenticPatchFile {
    param(
        [string]$RequestedFile,
        [string]$DefaultFile,
        [string]$WorkspaceRoot
    )

    $file = if (![string]::IsNullOrWhiteSpace($RequestedFile)) { $RequestedFile } else { $DefaultFile }
    if ([string]::IsNullOrWhiteSpace($file)) {
        throw "Patch file could not be resolved because both FILE and TargetFile are empty."
    }

    $resolved = if ([System.IO.Path]::IsPathRooted($file)) {
        [System.IO.Path]::GetFullPath($file)
    }
    else {
        [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($WorkspaceRoot, $file))
    }

    $root = [System.IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if (!$resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Patch file '$resolved' is outside the workspace root '$root'."
    }

    return $resolved
}

function Restore-AgenticTransaction {
    param([hashtable]$OriginalContents)

    foreach ($path in $OriginalContents.Keys) {
        Set-Content -LiteralPath $path -Value $OriginalContents[$path] -Encoding UTF8 -NoNewline
    }
}

function Invoke-AgenticValidationCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [int]$TimeoutSeconds = 120,

        [string]$WorkingDirectory = ""
    )

    if ([string]::IsNullOrWhiteSpace($Command)) {
        return [PSCustomObject]@{ Success = $true; ExitCode = 0; Output = ""; TimedOut = $false }
    }

    if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
        $WorkingDirectory = $PWD.ProviderPath
    }

    $powershellExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
    if ([string]::IsNullOrWhiteSpace($powershellExe)) {
        $powershellExe = (Get-Command powershell -ErrorAction Stop).Source
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $powershellExe
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command $Command"
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $process.Start() | Out-Null

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = !$process.WaitForExit([math]::Max(1, $TimeoutSeconds) * 1000)
    if ($timedOut) {
        try { $process.Kill() } catch { }
        try { $process.WaitForExit() } catch { }
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $combined = (($stdout, $stderr) | Where-Object { ![string]::IsNullOrWhiteSpace($_) }) -join "`n"
    $exitCode = if ($timedOut) { -1 } else { $process.ExitCode }

    [PSCustomObject]@{
        Success = (!$timedOut -and $exitCode -eq 0)
        ExitCode = $exitCode
        Output = $combined
        TimedOut = $timedOut
    }
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

VALID OUTPUT FORMATS:
You can output either a SEARCH/REPLACE patch (if you have enough context) or a REQUEST_CONTEXT block (if you need more file context).

1. SEARCH/REPLACE block:
CRITICAL FORMATTING RULES:
- Provide ONLY the SEARCH and REPLACE blocks.
- DO NOT use markdown code blocks (e.g. ```powershell).
- If you need to edit a file other than the main target file, put `FILE: path/to/file` immediately before that patch block.
- The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
- Your output MUST start exactly with SEARCH: and end with the replacement code.
- DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.

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

2. REQUEST_CONTEXT block:
If you need to see another file's content to successfully complete the request, output a context request.
CRITICAL FORMATTING RULES:
- Provide ONLY the REQUEST_CONTEXT block.
- DO NOT use markdown code blocks.
- Your output must start exactly with REQUEST_CONTEXT and specify the file path.

EXAMPLE (HOW YOU MUST RESPOND):
REQUEST_CONTEXT
file: path/to/other/file.ps1
reason: need to see helper function signature

Context Manifest:
$manifest

User Prompt:
"@
        } else {
            $systemPrompt = @"
You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

VALID OUTPUT FORMATS:
You can output either a SEARCH/REPLACE patch (if you have enough context) or a REQUEST_CONTEXT block (if you need more file context).

1. SEARCH/REPLACE block:
CRITICAL FORMATTING RULES:
- Provide ONLY the SEARCH and REPLACE blocks.
- DO NOT use markdown code blocks (e.g. ```powershell).
- If you need to edit a file other than the main target file, put `FILE: path/to/file` immediately before that patch block.
- The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
- Your output MUST start exactly with SEARCH: and end with the replacement code.
- DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.

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

2. REQUEST_CONTEXT block:
If you need to see another file's content to successfully complete the request, output a context request.
CRITICAL FORMATTING RULES:
- Provide ONLY the REQUEST_CONTEXT block.
- DO NOT use markdown code blocks.
- Your output must start exactly with REQUEST_CONTEXT and specify the file path.

EXAMPLE (HOW YOU MUST RESPOND):
REQUEST_CONTEXT
file: path/to/other/file.ps1
reason: need to see helper function signature

User Prompt:
"@
        }

        $combinedPrompt = "$systemPrompt`n$Prompt"
        if (![string]::IsNullOrWhiteSpace($feedback)) {
            $combinedPrompt += "`n`n=== PREVIOUS ATTEMPT FEEDBACK ===`n$feedback`nDO NOT REPEAT THE SAME MISTAKE."
        }

        Set-Content -Path $tempPromptFile -Value $combinedPrompt -Encoding UTF8
        
        $invokeScript = Join-Path $scriptDir "Invoke-LocalLLM.ps1"
        
        # Candidate generation. Keep the default cheap: one worker output, then
        # rely on schema/apply/syntax gates. Turn on extra candidates explicitly.
        $N = [math]::Max(1, $CandidateCount)
        $isParallel = ($N -gt 1 -and $N -le 4 -and $Model -notmatch "32b|40b|70b")
        Write-Host "Attempt $($attempt): Candidate generation (N=$N, Parallel=$isParallel) using $Model..." -ForegroundColor Cyan
        $candidates = @()
        
        if (-not $isParallel) {
            # Sequential for single-candidate runs and larger models (VRAM constraints).
            for ($i = 1; $i -le $N; $i++) {
                $candOut = Join-Path $env:TEMP "cand_$($i)_$([guid]::NewGuid()).md"
                & $invokeScript -PromptFile $tempPromptFile.FullName -OutputFile $candOut -Model $Model -NumCtx $NumCtx -TaskTitle "$TaskTitle (Candidate $i)" -TaskType $TaskType -SelectedBy $modelBudget.SelectedBy -SelectionReason $modelBudget.SelectionReason | Out-Null
                if (Test-Path $candOut) { 
                    $candidates += Get-Content -Path $candOut -Raw -Encoding UTF8
                    Remove-Item $candOut -ErrorAction SilentlyContinue
                }
            }
        } else {
            # Parallel for smaller models using native Jobs
            $jobList = @()
            for ($i = 1; $i -le $N; $i++) {
                $candOut = Join-Path $env:TEMP "cand_$($i)_$([guid]::NewGuid()).md"
                $jobArgs = @{
                    ScriptPath = $invokeScript
                    PromptFile = $tempPromptFile.FullName
                    OutputFile = $candOut
                    Model = $Model
                    NumCtx = $NumCtx
                    TaskTitle = "$TaskTitle (Candidate $i)"
                    TaskType = $TaskType
                    SelectedBy = $modelBudget.SelectedBy
                    SelectionReason = $modelBudget.SelectionReason
                }
                $jobObj = Start-Job -ScriptBlock {
                    param($argsObj)
                    & $argsObj.ScriptPath -PromptFile $argsObj.PromptFile -OutputFile $argsObj.OutputFile -Model $argsObj.Model -NumCtx $argsObj.NumCtx -TaskTitle $argsObj.TaskTitle -TaskType $argsObj.TaskType -SelectedBy $argsObj.SelectedBy -SelectionReason $argsObj.SelectionReason | Out-Null
                } -ArgumentList $jobArgs
                
                $jobList += [PSCustomObject]@{ Job = $jobObj; OutputFile = $candOut }
            }
            
            # Wait for all parallel jobs to complete
            Wait-Job -Job ($jobList.Job) | Out-Null
            
            foreach ($item in $jobList) {
                Receive-Job -Job $item.Job | Out-Null
                Remove-Job -Job $item.Job -Force
                if (Test-Path $item.OutputFile) { 
                    $candidates += Get-Content -Path $item.OutputFile -Raw -Encoding UTF8
                    Remove-Item $item.OutputFile -ErrorAction SilentlyContinue
                }
            }
        }

        # Judge phase. This is intentionally tied to CandidateCount > 1 so the
        # caller makes the local runtime cost/latency decision up front.
        $llmOutput = ""
        if ($candidates.Count -gt 1) {
            Write-Host "Invoking Judge to select best candidate..." -ForegroundColor Magenta
            $judgeModel = if ($Model -match "32b|40b|70b") { $Model } else { "qwen2.5-coder:32b" }
            $judgePromptFile = Join-Path $env:TEMP "judge_prompt_$([guid]::NewGuid()).md"
            
            $judgePrompt = "You are a Judge. Select the BEST and most robust SEARCH/REPLACE patch from the following candidates. Output ONLY the winning SEARCH/REPLACE block exactly as it was provided. Do not add markdown or explanation.`n`n"
            for ($c = 0; $c -lt $candidates.Count; $c++) {
                $judgePrompt += "=== CANDIDATE $c ===`n$($candidates[$c])`n`n"
            }
            Set-Content -Path $judgePromptFile -Value $judgePrompt -Encoding UTF8
            & $invokeScript -PromptFile $judgePromptFile -OutputFile $tempOutputFile.FullName -Model $judgeModel -NumCtx $NumCtx -TaskTitle "Judge" -TaskType "routing_review" -SelectedBy "agentic-loop-judge" -SelectionReason "CandidateCount=$N requested; judge selected the patch candidate." | Out-Null
            Remove-Item $judgePromptFile -ErrorAction SilentlyContinue
        } elseif ($candidates.Count -eq 1) {
            Set-Content -Path $tempOutputFile.FullName -Value $candidates[0] -Encoding UTF8
        }
        
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

            # Process Context Requests
            $contextRequests = $schemaResults | Where-Object { $_.Type -eq "ContextRequest" }
            if ($null -ne $contextRequests -and @($contextRequests).Count -gt 0) {
                foreach ($req in $contextRequests) {
                    $reqFile = $req.File
                    if ([string]::IsNullOrWhiteSpace($reqFile)) {
                        $reqFile = $TargetFile
                    }
                    $resolvedPath = if ([System.IO.Path]::IsPathRooted($reqFile)) {
                        $reqFile
                    } else {
                        [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PWD.ProviderPath, $reqFile))
                    }
                    
                    if (Test-Path -LiteralPath $resolvedPath) {
                        if ($null -eq $Files) {
                            $Files = @()
                        }
                        $Files += $resolvedPath
                        $Files = $Files | Select-Object -Unique
                        
                        # Rebuild manifest
                        $manifest = & (Join-Path $scriptDir "New-ContextManifest.ps1") -Files $Files -LineRanges $LineRanges
                        $feedback += "`nGranted context for file: '$resolvedPath' (Reason: $($req.Reason))."
                    } else {
                        $feedback += "`nDenied context for file: '$resolvedPath' (file not found)."
                    }
                }
                $attempt++
                continue
            }
            
            $patchResults = @($schemaResults | Where-Object { $_.Type -eq "Patch" })
            foreach ($res in $patchResults) {
                $resolvedPatchFile = Resolve-AgenticPatchFile -RequestedFile $res.File -DefaultFile $TargetFile -WorkspaceRoot $PWD.ProviderPath
                Add-Member -InputObject $res -NotePropertyName PatchFile -NotePropertyValue $resolvedPatchFile -Force
            }

            # Validate the complete transaction on temp copies before touching real files.
            $validatorResult = [PSCustomObject]@{ Success = $true }
            $tempFiles = @{}

            try {
                foreach ($patchFile in @($patchResults | ForEach-Object { $_.PatchFile } | Select-Object -Unique)) {
                    if (!(Test-Path -LiteralPath $patchFile -PathType Leaf)) {
                        throw "Patch target does not exist: $patchFile"
                    }
                    $ext = [System.IO.Path]::GetExtension($patchFile)
                    if ([string]::IsNullOrEmpty($ext)) { $ext = ".tmp" }
                    $tempTestFile = Join-Path $env:TEMP "agentic_patch_test_$([guid]::NewGuid())$ext"
                    Copy-Item -LiteralPath $patchFile -Destination $tempTestFile
                    $tempFiles[$patchFile] = $tempTestFile
                }

                foreach ($res in $patchResults) {
                    Apply-SearchReplacePatch -targetFile $tempFiles[$res.PatchFile] -search $res.Search -replace $res.Replace
                }

                if ($ValidatorProfile -in @("syntax", "syntax_and_command")) {
                    foreach ($patchFile in $tempFiles.Keys) {
                        $syntaxResult = Test-SearchReplaceSyntax -targetFile $tempFiles[$patchFile] -search "" -replace ""
                        if (!$syntaxResult.Success) {
                            $validatorResult = [PSCustomObject]@{ Success = $false; Errors = "Syntax validation failed for '$patchFile': $($syntaxResult.Errors)" }
                            break
                        }
                    }
                }
            }
            catch {
                $validatorResult = [PSCustomObject]@{ Success = $false; Errors = "Apply failed during transaction dry-run: $($_.Exception.Message)" }
            }
            finally {
                foreach ($tempFile in $tempFiles.Values) {
                    Remove-Item -LiteralPath $tempFile -ErrorAction SilentlyContinue
                }
            }

            if (-not $validatorResult.Success) {
                Write-Warning "Validator Gate failed on attempt $($attempt): $($validatorResult.Errors)"
                $feedback += "`nAttempt $($attempt) failed syntax validation: $($validatorResult.Errors). Your REPLACE code must be valid PowerShell."
                $attempt++
                continue
            }
            
            # Optional breaker phase. Basic safety is still enforced above by
            # schema/apply/syntax gates; the breaker is for high-risk changes.
            if ($EnableBreaker) {
                Write-Host "Invoking Breaker to aggressively verify the patch..." -ForegroundColor Magenta
                $breakerPromptFile = Join-Path $env:TEMP "breaker_prompt_$([guid]::NewGuid()).md"
                $breakerOutputFile = Join-Path $env:TEMP "breaker_output_$([guid]::NewGuid()).md"
                $breakerPrompt = @"
You are the Breaker. Your ONLY job is to find reasons why this SEARCH/REPLACE patch is dangerous or breaks syntax/AST in PowerShell.
Do not fix it. Just find flaws. 

Proposed Patch:
$llmOutput

If the patch breaks syntax, introduces unhandled exceptions, or breaks indentation, output exactly: [YES_BREAKS] and explain why.
If the patch is completely safe and robust, output exactly: [NO_SAFE].
"@
                Set-Content -Path $breakerPromptFile -Value $breakerPrompt -Encoding UTF8
                & $invokeScript -PromptFile $breakerPromptFile -OutputFile $breakerOutputFile -Model $Model -NumCtx $NumCtx -TaskTitle "Breaker" -TaskType "routing_review" -SelectedBy "agentic-loop-breaker" -SelectionReason "EnableBreaker was requested for high-risk patch verification." | Out-Null
                
                $breakerResponse = ""
                if (Test-Path $breakerOutputFile) { $breakerResponse = Get-Content -Path $breakerOutputFile -Raw -Encoding UTF8 }
                Remove-Item $breakerPromptFile, $breakerOutputFile -ErrorAction SilentlyContinue
                
                if ($breakerResponse -match '\[YES_BREAKS\]') {
                    Write-Warning "Breaker Gate failed: The Breaker agent detected a flaw."
                    $feedback += "`nAttempt $($attempt) failed Breaker validation: $breakerResponse`nFix the logic so it passes the Breaker."
                    $attempt++
                    continue
                }
                Write-Host "Breaker approved the patch as safe." -ForegroundColor Green
            }
            else {
                Write-Host "Breaker skipped. Schema/apply/syntax gates remain active." -ForegroundColor DarkGray
            }
            
            # Actually apply the patches
            $isReadOnly = $SandboxMode.IsPresent -or ($StateMachine -eq 'ArchitectureReview')
            $transactionOriginals = @{}
            foreach ($patchFile in @($patchResults | ForEach-Object { $_.PatchFile } | Select-Object -Unique)) {
                $transactionOriginals[$patchFile] = Get-Content -LiteralPath $patchFile -Raw -Encoding UTF8
            }
            try {
                foreach ($res in $patchResults) {
                    Apply-SearchReplacePatch -targetFile $res.PatchFile -search $res.Search -replace $res.Replace -ReadOnly:$isReadOnly
                }
                if (!$isReadOnly -and ![string]::IsNullOrWhiteSpace($ValidationCommand) -and $ValidatorProfile -ne "none") {
                    Write-Host "Running validation command: $ValidationCommand" -ForegroundColor Cyan
                    $commandResult = Invoke-AgenticValidationCommand -Command $ValidationCommand -TimeoutSeconds $ValidationTimeoutSeconds -WorkingDirectory $PWD.ProviderPath
                    if (!$commandResult.Success) {
                        Restore-AgenticTransaction -OriginalContents $transactionOriginals
                        $validationSummary = "Validation command failed with exit code $($commandResult.ExitCode)."
                        if ($commandResult.TimedOut) {
                            $validationSummary = "Validation command timed out after $ValidationTimeoutSeconds seconds."
                        }
                        if (![string]::IsNullOrWhiteSpace($commandResult.Output)) {
                            $validationSummary = "$validationSummary`n$($commandResult.Output)"
                        }
                        Write-Warning "Validation Command Gate failed on attempt $($attempt): $validationSummary"
                        $feedback += "`nAttempt $($attempt) failed validation command after applying the patch transaction. All changed files were restored before retry.`n$validationSummary"
                        $attempt++
                        continue
                    }
                    Write-Host "Validation command passed." -ForegroundColor Green
                }
                Write-Host "Successfully applied patch on attempt $attempt."
                break
            } catch {
                if (!$isReadOnly -and $transactionOriginals.Count -gt 0) {
                    Restore-AgenticTransaction -OriginalContents $transactionOriginals
                }
                Write-Warning "Apply Gate failed on attempt $($attempt): $($_.Exception.Message)"
                $feedback += "`nAttempt $($attempt) failed to apply transaction: $($_.Exception.Message). All changed files were restored. Ensure each SEARCH string exactly matches its target file."
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

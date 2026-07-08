You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

VALID OUTPUT FORMATS:
You can output either a SEARCH/REPLACE patch (if you have enough context) or a REQUEST_CONTEXT block (if you need more file context).

1. SEARCH/REPLACE block:
CRITICAL FORMATTING RULES:
- Provide ONLY the SEARCH and REPLACE blocks.
- DO NOT use markdown code blocks (e.g. `powershell).
- The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
- Your output MUST start exactly with SEARCH: and end with the replacement code.
- DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.

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
| File | Start | End | Length |
|------|-------|-----|--------|
| C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\New-ContextManifest.ps1 | 1 | ALL | 1723 | 

### File: C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\New-ContextManifest.ps1
```powershell
param (
    [Parameter(Mandatory=$true)]
    [string[]]$Files,
    
    [hashtable]$LineRanges = @{}
)

$outputMarkdownTable = @"
| File | Start | End | Length |
|------|-------|-----|--------|
"@

$fileContentsBlocks = ""

foreach ($file in $Files) {
    if (Test-Path -LiteralPath $file) {
        # Get file length without reading the entire content
        $length = (Get-Item -LiteralPath $file).Length
        
        if ($LineRanges.ContainsKey($file)) {
            $range = $LineRanges[$file]
            if ($null -ne $range.Start -and $null -ne $range.End) {
                $start = $range.Start
                $end = $range.End
            } else {
                throw "Invalid range format for file '$file'. Expected an object with Start and End properties."
            }
        } else {
            # Use 1 as start and ALL to indicate the whole file
            $start = 1
            $end = "ALL"
        }

        $outputMarkdownTable += "`n| $($file) | $($start) | $($end) | $($length) |"
        
        $fileContentsBlocks += "`n`n### File: $file`n" + '```powershell' + "`n"
        if ($start -eq 1 -and $end -eq "ALL") {
            $fileContentsBlocks += Get-Content -Path $file -Raw
        } else {
            $lines = Get-Content -Path $file
            # Array indexing is 0-based
            $rangeStart = [Math]::Max(0, $start - 1)
            $rangeEnd = [Math]::Min($lines.Length - 1, $end - 1)
            $fileContentsBlocks += ($lines[$rangeStart..$rangeEnd] -join "`n")
        }
        $fileContentsBlocks += "`n" + '```' + "`n"
    } else {
        Write-Warning "File '$file' not found. Skipping."
    }
}

Write-Output $outputMarkdownTable
Write-Output $fileContentsBlocks

```


User Prompt:
New-ContextManifest.ps1를 안전한 Context Pack Builder Lite로 개선하라.

정확한 요구사항:
1. 모든 파일 읽기는 -LiteralPath 와 -Encoding UTF8 을 사용한다.
2. Get-Item, Test-Path 는 이미 LiteralPath를 쓰는 방향을 유지한다.
3. 코드펜스 언어는 확장자별로 정한다.
   - .ps1, .psm1, .psd1 => powershell
   - .json => json
   - .js, .ts => javascript
   - .md => markdown
   - .txt => text
   - 그 외 => text
4. 파일이 존재하지 않으면 warning만 출력하고 계속한다.
5. LineRanges가 지정된 경우 start/end를 파일 범위 안으로 clamp한다.
6. 빈 파일이나 잘못된 범위여도 예외로 전체 루프를 죽이지 말고 해당 파일 블록에 빈 내용을 넣거나 warning을 남겨라.
7. 기존 출력 형식인 markdown table + file content blocks는 유지한다.
8. 필요한 SEARCH/REPLACE 블록만 출력하라.

=== PREVIOUS ATTEMPT FEEDBACK ===

Attempt 1 failed syntax validation: Apply failed during dry-run: Apply Gate failed: The SEARCH string was not found in the target file. (Search string: 'if ($LineRanges.ContainsKey($file)) {
    $range = $LineRanges[$file]
    if ($null -ne $range.Start -and $null -ne $range.End) {
        $start = $range.Start
        $end = $range.End
    } else {
        throw "Invalid range format for file '$file'. Expected an object with Start and End properties."
    }
} else {
    # Use 1 as start and ALL to indicate the whole file
    $start = 1
    $end = "ALL"
}'). Your REPLACE code must be valid PowerShell.
Attempt 2 failed syntax validation: Apply failed during dry-run: Apply Gate failed: The SEARCH string was not found in the target file. (Search string: 'if ($LineRanges.ContainsKey($file)) {
    $range = $LineRanges[$file]
    if ($null -ne $range.Start -and $null -ne $range.End) {
        $start = $range.Start
        $end = $range.End
    } else {
        throw "Invalid range format for file '$file'. Expected an object with Start and End properties."
    }
} else {
    # Use 1 as start and ALL to indicate the whole file
    $start = 1
    $end = "ALL"
}

$outputMarkdownTable += "`n| $($file) | $($start) | $($end) | $($length) |"'). Your REPLACE code must be valid PowerShell.
DO NOT REPEAT THE SAME MISTAKE.

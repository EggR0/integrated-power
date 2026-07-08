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
New-ContextManifest.ps1에서 파일 내용을 읽는 Get-Content 호출만 고쳐라.

정확한 요구사항:
1. 전체 파일을 읽는 `Get-Content -Path $file -Raw` 를 `Get-Content -LiteralPath $file -Raw -Encoding UTF8` 로 바꿔라.
2. 라인 배열을 읽는 `Get-Content -Path $file` 를 `Get-Content -LiteralPath $file -Encoding UTF8` 로 바꿔라.
3. 다른 코드는 절대 바꾸지 마라.
4. 필요한 SEARCH/REPLACE 블록만 출력하라.

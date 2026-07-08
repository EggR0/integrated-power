You are qwen2.5-coder:32b acting as a direct code-generation worker.

Task:
Rewrite `scripts/dispatch/New-ContextManifest.ps1` as a complete file.

Return only the full PowerShell file content. Do not use markdown fences. Do not explain.

Current file:

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
            $fileContentsBlocks += Get-Content -LiteralPath $file -Raw -Encoding UTF8
        } else {
            $lines = Get-Content -LiteralPath $file -Encoding UTF8
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

Requirements:
1. Keep the same parameters and output shape: markdown table, then file content blocks.
2. Use `Test-Path -LiteralPath`, `Get-Item -LiteralPath`, and `Get-Content -LiteralPath ... -Encoding UTF8`.
3. Pick the markdown code fence language by extension:
   - `.ps1`, `.psm1`, `.psd1` => `powershell`
   - `.json` => `json`
   - `.js`, `.ts` => `javascript`
   - `.md` => `markdown`
   - `.txt` => `text`
   - default => `text`
4. If `LineRanges` is provided, clamp Start/End into the actual line count.
5. If a range object is invalid, warn and include an empty content block instead of throwing.
6. If a file is empty, include an empty content block instead of throwing.
7. If Start > End after clamping, warn and include an empty content block.
8. Preserve Windows PowerShell 5.1 compatibility.

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

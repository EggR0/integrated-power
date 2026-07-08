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
        
        # Determine code fence language based on file extension
        $extension = [System.IO.Path]::GetExtension($file).ToLower()
        switch ($extension) {
            '.ps1', '.psm1', '.psd1' { $language = 'powershell'; break }
            '.json' { $language = 'json'; break }
            '.js', '.ts' { $language = 'javascript'; break }
            '.md' { $language = 'markdown'; break }
            '.txt' { $language = 'text'; break }
            default { $language = 'text' }
        }

        if ($LineRanges.ContainsKey($file)) {
            $range = $LineRanges[$file]
            if ($null -ne $range.Start -and $null -ne $range.End) {
                $start = [int]$range.Start
                $end = [int]$range.End
            } else {
                Write-Warning "Invalid range format for file '$file'. Expected an object with Start and End properties. Including empty content block."
                $start = 1
                $end = 0 # This will trigger the Start > End condition
            }
        } else {
            # Use 1 as start and ALL to indicate the whole file
            $start = 1
            $end = "ALL"
        }

        # Read lines if needed for range validation
        $lines = Get-Content -LiteralPath $file -Encoding UTF8
        $lineCount = $lines.Length

        # Clamp Start/End into actual line count
        $clampedStart = [Math]::Max(1, [Math]::Min($start, $lineCount))
        if ($end -eq "ALL") {
            $clampedEnd = $lineCount
        } else {
            $clampedEnd = [Math]::Max($clampedStart, [Math]::Min($end, $lineCount))
        }

        # Check if Start > End after clamping
        if ($clampedStart -gt $clampedEnd) {
            Write-Warning "Clamped range for file '$file' results in Start > End. Including empty content block."
            $clampedStart = 1
            $clampedEnd = 0 # This will result in an empty content block
        }

        $outputMarkdownTable += "`n| $($file) | $($clampedStart) | $($clampedEnd) | $($length) |"
        
        $fileContentsBlocks += "`n`n### File: $file`n" + "```$language`n"
        if ($clampedStart -eq 1 -and $clampedEnd -eq $lineCount) {
            $fileContentsBlocks += Get-Content -LiteralPath $file -Raw -Encoding UTF8
        } elseif ($clampedStart -le $clampedEnd) {
            # Array indexing is 0-based
            $rangeStart = [Math]::Max(0, $clampedStart - 1)
            $rangeEnd = [Math]::Min($lines.Length - 1, $clampedEnd - 1)
            $fileContentsBlocks += ($lines[$rangeStart..$rangeEnd] -join "`n")
        }
        $fileContentsBlocks += "`n" + '```' + "`n"
    } else {
        Write-Warning "File '$file' not found. Skipping."
    }
}

Write-Output $outputMarkdownTable
Write-Output $fileContentsBlocks

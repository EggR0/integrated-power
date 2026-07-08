SEARCH:
        $outputMarkdownTable += "`n| $($file) | $($start) | $($end) | $($length) |"
REPLACE:
        $lineCount = (Get-Content -LiteralPath $file -Encoding UTF8).Count
        if ($lineCount -eq 0) {
            Write-Warning "File '$file' is empty. Using empty content."
            $start = $null
            $end = $null
        } else {
            $clampedStart = [Math]::Max(1, [Math]::Min($start, $lineCount))
            $clampedEnd = [Math]::Max(1, [Math]::Min($end, $lineCount))
            if ($clampedStart -gt $clampedEnd) {
                Write-Warning "Invalid range for file '$file'. Using empty content."
                $start = $null
                $end = $null
            } else {
                $start = $clampedStart
                $end = $clampedEnd
            }
        }
        $outputMarkdownTable += "`n| $($file) | $($start) | $($end) | $($length) |"

SEARCH:
        if ($start -eq 1 -and $end -eq "ALL") {
            $fileContentsBlocks += Get-Content -Path $file -Raw
        } else {
            $lines = Get-Content -Path $file
            # Array indexing is 0-based
            $rangeStart = [Math]::Max(0, $start - 1)
            $rangeEnd = [Math]::Min($lines.Length - 1, $end - 1)
            $fileContentsBlocks += ($lines[$rangeStart..$rangeEnd] -join "`n")
        }
REPLACE:
        if ($start -eq 1 -and $end -eq "ALL") {
            $fileContentsBlocks += Get-Content -LiteralPath $file -Encoding UTF8 -Raw
        } elseif ($null -eq $start -or $null -eq $end) {
            # Empty content due to invalid range or empty file
        } else {
            $lines = Get-Content -LiteralPath $file -Encoding UTF8
            # Array indexing is 0-based
            $rangeStart = [Math]::Max(0, $start - 1)
            $rangeEnd = [Math]::Min($lines.Length - 1, $end - 1)
            $fileContentsBlocks += ($lines[$rangeStart..$rangeEnd] -join "`n")
        }

SEARCH:
        $fileContentsBlocks += "`n`n### File: $file`n" + '```powershell' + "`n"
REPLACE:
        $ext = [System.IO.Path]::GetExtension($file).ToLower()
        switch ($ext) {
            '.ps1','.psm1','.psd1' { $lang = 'powershell' }
            '.json' { $lang = 'json' }
            '.js','.ts' { $lang = 'javascript' }
            '.md' { $lang = 'markdown' }
            '.txt' { $lang = 'text' }
            default { $lang = 'text' }
        }
        $fileContentsBlocks += "`n`n### File: $file`n" + "```$lang`n"

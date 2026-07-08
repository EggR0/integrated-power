SEARCH:
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

REPLACE:
# Compute line count
$lineCount = (Get-Content -LiteralPath $file -Encoding UTF8 | Measure-Object -Line).Lines
if ($LineRanges.ContainsKey($file)) {
    $range = $LineRanges[$file]
    $start = if ($null -ne $range.Start -and [int]$range.Start -gt 0) { [int]$range.Start } else { 1 }
    $end   = if ($null -ne $range.End -and [int]$range.End -gt 0) { [int]$range.End } else { "ALL" }
    if ($end -ne "ALL") {
        $end = [Math]::Min($end, $lineCount)
    }
    $start = [Math]::Max(1, $start)
    if ($start -gt $lineCount) {
        $start = $lineCount + 1
    }
} else {
    # Use 1 as start and ALL to indicate the whole file
    $start = 1
    $end = "ALL"
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
    $fileContentsBlocks += Get-Content -LiteralPath $file -Raw -Encoding UTF8
} else {
    $lines = Get-Content -LiteralPath $file -Encoding UTF8
    if ($null -eq $lines -or $lines.Length -eq 0) {
        Write-Warning "File '$file' is empty."
        $fileContentsBlocks += ""
    } else {
        $clampedStart = [Math]::Max(1, $start)
        $clampedEnd   = if ($end -eq "ALL") { $lines.Length } else { [Math]::Min([int]$end, $lines.Length) }
        if ($clampedStart -gt $clampedEnd) {
            Write-Warning "Empty range for file '$file'."
            $fileContentsBlocks += ""
        } else {
            $rangeStart = [Math]::Max(0, $clampedStart - 1)
            $rangeEnd   = [Math]::Min($lines.Length - 1, $clampedEnd - 1)
            $fileContentsBlocks += ($lines[$rangeStart..$rangeEnd] -join "`n")
        }
    }
}

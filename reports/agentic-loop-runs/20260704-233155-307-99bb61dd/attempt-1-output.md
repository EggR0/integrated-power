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
REPLACE:
$lines = Get-Content -LiteralPath $file -Encoding UTF8
$lineCount = $lines.Count
if ($LineRanges.ContainsKey($file)) {
    $range = $LineRanges[$file]
    $start = $range.Start
    $end = $range.End
    $start = [math]::Max(1, [math]::Min($lineCount, [int]$start))
    $end = [math]::Max(1, [math]::Min($lineCount, [int]$end))
    if ($start -gt $end) {
        $temp = $start
        $start = $end
        $end = $temp
    }
} else {
    $start = 1
    $end = $lineCount
}
if ($lineCount -eq 0) {
    Write-Warning "File '$file' is empty."
}

SEARCH:
$fileContentsBlocks += "`n`n### File: $file`n" + '```powershell' + "`n"
REPLACE:
$ext = [System.IO.Path]::GetExtension($file).ToLower()
switch ($ext) {
  '.ps1','.psm1','.psd1' { $lang='powershell' }
  '.json' { $lang='json' }
  '.js','.ts' { $lang='javascript' }
  '.md' { $lang='markdown' }
  '.txt' { $lang='text' }
  default { $lang='text' }
}
$fileContentsBlocks += "`n`n### File: $file`n" + "```$lang" + "`n"

SEARCH:
$fileContentsBlocks += Get-Content -Path $file -Raw
REPLACE:
$fileContentsBlocks += Get-Content -LiteralPath $file -Encoding UTF8 -Raw

SEARCH:
$lines = Get-Content -Path $file
REPLACE:
$lines = Get-Content -LiteralPath $file -Encoding UTF8

SEARCH:
if ($start -eq 1 -and $end -eq "ALL") {
REPLACE:
if ($start -eq 1 -and $end -eq $lineCount) {

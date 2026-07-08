SEARCH:
$tempTestFile = Join-Path $env:TEMP "ast_test_$([guid]::NewGuid()).ps1"
Copy-Item -Path $TargetFile -Destination $tempTestFile
REPLACE:
$extension = [System.IO.Path]::GetExtension($TargetFile)
if (-not $extension) { $extension = ".tmp" }
$tempTestFile = Join-Path $env:TEMP ("ast_test_$([guid]::NewGuid())$extension")
Copy-Item -LiteralPath $TargetFile -Destination $tempTestFile

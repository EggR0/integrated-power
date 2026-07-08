SEARCH:
            $tempTestFile = Join-Path $env:TEMP "ast_test_$([guid]::NewGuid()).ps1"
            Copy-Item -Path $TargetFile -Destination $tempTestFile
REPLACE:
            $ext = [System.IO.Path]::GetExtension($TargetFile)
            if ([string]::IsNullOrEmpty($ext)) { $ext = ".tmp" }
            $tempTestFile = Join-Path $env:TEMP "ast_test_$([guid]::NewGuid())$ext"
            Copy-Item -LiteralPath $TargetFile -Destination $tempTestFile

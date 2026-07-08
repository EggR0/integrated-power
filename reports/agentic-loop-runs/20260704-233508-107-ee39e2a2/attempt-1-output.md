SEARCH:
            $fileContentsBlocks += Get-Content -Path $file -Raw
REPLACE:
            $fileContentsBlocks += Get-Content -LiteralPath $file -Raw -Encoding UTF8
SEARCH:
            $lines = Get-Content -Path $file
REPLACE:
            $lines = Get-Content -LiteralPath $file -Encoding UTF8

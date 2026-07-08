SEARCH:
        $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
        $ArtifactDir = Join-Path (Join-Path "reports" "agentic-loop-runs") $timestamp
REPLACE:
        $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss-fff") + "-" + [guid]::NewGuid().ToString("N").Substring(0,8)
        $ArtifactDir = Join-Path (Join-Path "reports" "agentic-loop-runs") $timestamp

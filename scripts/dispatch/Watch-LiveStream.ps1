[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$LogFile
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LogFile)) {
    Write-Host "Waiting for log file to be created: $LogFile" -ForegroundColor Yellow
    $retries = 0
    while (-not (Test-Path $LogFile) -and $retries -lt 100) {
        Start-Sleep -Milliseconds 100
        $retries++
    }
}

if (-not (Test-Path $LogFile)) {
    Write-Host "Log file not found: $LogFile" -ForegroundColor Red
    Start-Sleep -Seconds 3
    exit 1
}

Write-Host "--- AI Background Task Live Stream ---" -ForegroundColor Cyan

# Use FileStream and StreamReader to avoid PowerShell Get-Content pipeline buffering
$fileStream = [System.IO.File]::Open($LogFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$streamReader = New-Object System.IO.StreamReader($fileStream, [System.Text.Encoding]::UTF8)

try {
    while ($true) {
        $line = $streamReader.ReadLine()
        if ($null -ne $line) {
            if ($line -match "\[__EOF__\]") {
                Write-Host "--- Task Completed ---" -ForegroundColor Cyan
                break
            }
            Write-Host $line
        } else {
            Start-Sleep -Milliseconds 100
        }
    }
} finally {
    $streamReader.Close()
    $fileStream.Close()
}

Write-Host "Closing terminal in 3 seconds..." -ForegroundColor DarkGray
Start-Sleep -Seconds 3
exit 0

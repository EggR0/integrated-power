[CmdletBinding()]
param(
    [string]$Prompt = "Please write a short haiku about debugging code.",
    [string]$Model = "qwen2.5-coder:32b",
    [string]$LogFile = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$startMsg = "Connecting to Ollama ($Model) using .NET Stream...`n"
if ($LogFile) { [System.IO.File]::AppendAllText($LogFile, $startMsg) }
Write-Host $startMsg -ForegroundColor Cyan

$body = @{
    model = $Model
    prompt = $Prompt
    stream = $true
} | ConvertTo-Json -Depth 5

$request = [System.Net.WebRequest]::Create("http://localhost:11434/api/generate")
$request.Method = "POST"
$request.ContentType = "application/json"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$request.ContentLength = $bytes.Length

$reqStream = $request.GetRequestStream()
$reqStream.Write($bytes, 0, $bytes.Length)
$reqStream.Close()

try {
    $response = $request.GetResponse()
    $resStream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($resStream, [System.Text.Encoding]::UTF8)

    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line) { break }
        
        if (![string]::IsNullOrWhiteSpace($line)) {
            try {
                $chunk = $line | ConvertFrom-Json
                if ($chunk.response) {
                    if ($LogFile) { [System.IO.File]::AppendAllText($LogFile, $chunk.response) }
                    [Console]::Write($chunk.response)
                }
            } catch {}
        }
    }
    [Console]::WriteLine()
    $endMsg = "`n`n[Streaming Completed]`n[__EOF__]"
    if ($LogFile) { [System.IO.File]::AppendAllText($LogFile, $endMsg) }
    Write-Host "`n[Streaming Completed]" -ForegroundColor Green
} finally {
    if ($reader) { $reader.Close() }
    if ($resStream) { $resStream.Close() }
    if ($response) { $response.Close() }
}

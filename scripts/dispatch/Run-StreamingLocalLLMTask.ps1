[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$log = "C:\Users\jsp0\Documents\Intergrated POWER\.agents\localllm-streaming-run.log"
if (Test-Path $log) { Remove-Item $log -Force }

try {
    & "C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-StreamingLocalLLM.ps1" -LogFile $log
} catch {
    Write-Error $_
}

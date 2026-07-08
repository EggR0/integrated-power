[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

$log = "C:\Users\jsp0\Documents\Intergrated POWER\.agents\localllm-run.log"
"" | Out-File $log

try {
    & "C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-LocalLLM.ps1" `
        -PromptFile "C:\Users\jsp0\Documents\Intergrated POWER\reports\ai-router-runs\localllm-prompt.md" `
        -Model "qwen2.5-coder:32b" 2>&1 | Tee-Object -FilePath $log -Append
} finally {
    "[__EOF__]" | Out-File $log -Append
}

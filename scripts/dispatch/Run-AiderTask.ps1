[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

$log = "C:\Users\jsp0\Documents\Intergrated POWER\.agents\aider-run.log"
"" | Out-File $log

try {
    & "C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-DelegatedAgentTask.ps1" `
        -PromptFile "C:\Users\jsp0\Documents\Intergrated POWER\reports\ai-router-runs\fix-duplicate-errors\prompt.md" `
        -FilesListFile "C:\Users\jsp0\Documents\Intergrated POWER\reports\ai-router-runs\fix-duplicate-errors\files.txt" `
        -RequiresFileWrite `
        -WorkerBackend Auto `
        -PreferCloudTokenConservation `
        -ValidatorProfile auto `
        -AllowDestructive `
        -KeepArtifacts 2>&1 | Tee-Object -FilePath $log -Append
} finally {
    "[__EOF__]" | Out-File $log -Append
}

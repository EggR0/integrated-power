param(
    [Parameter(Mandatory = $true)]
    [string]$TaskName,

    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [Parameter(Mandatory = $true)]
    [string]$DailyAt,

    [ValidateSet("read-only", "workspace-write", "danger-full-access")]
    [string]$Sandbox = "read-only",

    [string]$Model = "gpt-5.5",

    [ValidateSet("minimal", "low", "medium", "high", "xhigh")]
    [string]$ReasoningEffort = "high"
)

$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel).Trim()
$runner = Join-Path $repoRoot "scripts\Invoke-CodexJob.ps1"
$promptPath = Resolve-Path -LiteralPath $PromptFile

if (!(Test-Path -LiteralPath $runner)) {
    throw "Runner not found: $runner"
}

$time = [datetime]::Parse($DailyAt)
$stamp = $time.ToString("HHmm")
$output = Join-Path $repoRoot "reports\$TaskName-$stamp.md"

$argument = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$runner`"",
    "-PromptFile", "`"$promptPath`"",
    "-OutputFile", "`"$output`"",
    "-Sandbox", $Sandbox,
    "-Model", $Model,
    "-ReasoningEffort", $ReasoningEffort
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Quota-aware Codex job from Integrated POWER"

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Prompt: $promptPath"
Write-Host "Output: $output"


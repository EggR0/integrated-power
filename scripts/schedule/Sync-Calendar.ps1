$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel).Trim()

Write-Host "Determining current AI Window from Google Calendar..."

# Get current time block
$now = Get-Date
$startStr = $now.ToString("HH:mm")
$endStr = $now.AddMinutes(5).ToString("HH:mm")

try {
    $agenda = gcalcli agenda $startStr $endStr --tsv --details all | Out-String
} catch {
    throw "Failed to fetch agenda."
}

# Parse the agenda to find the JOB ID from the description or title
$jobId = $null
if ($agenda -match "(JOB-\d+)") {
    $jobId = $matches[1]
}

if (!$jobId) {
    Write-Host "No active Window found right now, or current block has no JOB ID specified."
    exit 0
}

Write-Host "Current Active Window found! Target Goal: $jobId"

Write-Host "`n>>> ANTIGRAVITY_TRIGGER: /goal $jobId"
Write-Host "Antigravity or Codex will now automatically execute the goal for $jobId."

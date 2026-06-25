# Active TODOs and FIXMEs

Generated at 2026-06-25 10:05:09

## ?뱚 Project: C:\Users\jsp0\Documents\Intergrated POWER

`	ext
docs\weekly-quota-operations.md:50 - - Review open TODOs and propose priority order.
scripts\Extract-Todos.ps1:9 - $reportFile = Join-Path $repoRoot "reports\current_todos.md"
scripts\Extract-Todos.ps1:19 - $reportContent = "# Active TODOs and FIXMEs`n`nGenerated at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n`n"
scripts\Extract-Todos.ps1:45 - $todos = $filesToScan | Select-String -Pattern "(TODO|FIXME):?\s*(.*)" -CaseSensitive:$false 2>$null
scripts\Extract-Todos.ps1:47 - if ($todos) {
scripts\Extract-Todos.ps1:51 - foreach ($match in $todos) {
scripts\Extract-Todos.ps1:64 - if ($todos.Count -gt 50) {
scripts\Extract-Todos.ps1:65 - $reportContent += "...and $($todos.Count - 50) more.`n"
scripts\Extract-Todos.ps1:69 - $reportContent += "*No TODOs found.*`n`n"
scripts\Extract-Todos.ps1:78 - Write-Host "TODOs extracted to $reportFile"
``n

$ErrorActionPreference = "Stop"

Write-Host "Creating 4 Time Blocks for the next 30 days..."

# Window 1: 09:00 - 12:00 (180 mins)
# Window 2: 12:00 - 18:00 (360 mins)
# Window 3: 18:00 - 23:59 (359 mins)
# Window 4: 00:00 - 09:00 (540 mins)

$startDate = (Get-Date).Date

for ($i=0; $i -lt 30; $i++) {
    $currentDate = $startDate.AddDays($i).ToString("yyyy-MM-dd")
    
    # We use Try/Catch to ignore errors if an event already exists or network fails
    try {
        gcalcli --calendar "yip1004@gmail.com" add --title "AI Block: Window 4" --when "$currentDate 00:00" --duration 540 --description "JOB-004" --noprompt
        gcalcli --calendar "yip1004@gmail.com" add --title "AI Block: Window 1" --when "$currentDate 09:00" --duration 180 --description "JOB-001" --noprompt
        gcalcli --calendar "yip1004@gmail.com" add --title "AI Block: Window 2" --when "$currentDate 12:00" --duration 360 --description "JOB-002" --noprompt
        gcalcli --calendar "yip1004@gmail.com" add --title "AI Block: Window 3" --when "$currentDate 18:00" --duration 359 --description "JOB-003" --noprompt
        Write-Host "Added blocks for $currentDate"
    } catch {
        Write-Host "Failed to add blocks for $currentDate : $_"
    }
}

Write-Host "Done! 4 daily blocks created for the next 30 days."

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$LogFile,
    
    [Parameter(Mandatory=$true)]
    [string]$TerminalName
)

$scriptDir = Split-Path $MyInvocation.MyCommand.Path
$cmd = "& '$scriptDir\Watch-LiveStream.ps1' -LogFile '$LogFile'"
& "$scriptDir\Invoke-VisibleTask.ps1" -CommandLine $cmd -Name $TerminalName

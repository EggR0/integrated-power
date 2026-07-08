[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$LogFile,
    
    [Parameter(Mandatory=$true)]
    [string]$TerminalName
)

$cmd = "& 'C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Watch-LiveStream.ps1' -LogFile '$LogFile'"
& "C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-VisibleTask.ps1" -CommandLine $cmd -Name $TerminalName

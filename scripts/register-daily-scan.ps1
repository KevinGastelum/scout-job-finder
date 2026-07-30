<#
.SYNOPSIS
Registers (or removes) the Windows Scheduled Task that runs Scout's daily scan.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\register-daily-scan.ps1
powershell -ExecutionPolicy Bypass -File scripts\register-daily-scan.ps1 -At 06:30
powershell -ExecutionPolicy Bypass -File scripts\register-daily-scan.ps1 -Unregister
#>
[CmdletBinding()]
param(
    [string] $TaskName = 'Scout Daily Scan',
    [string] $At = '07:00',
    [switch] $Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed scheduled task '$TaskName'."
    return
}

$scanScript = Join-Path $PSScriptRoot 'daily-scan.ps1'
if (-not (Test-Path $scanScript)) { throw "daily-scan.ps1 not found next to this script." }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scanScript`""

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# StartWhenAvailable matters more than the exact time: this runs on a laptop that is often
# asleep at 07:00, and a scan that fires late still beats one that silently never fires.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4)

# Interactive logon type: the scan shells out to the claude CLI, which needs the logged-on
# user's credentials. Running it as SYSTEM or with stored credentials would not be logged in.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Output "Registered '$TaskName' to run daily at $At."
Write-Output "Run now:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "Log:      .tmp\daily-scan.log"

#requires -version 5.1
#requires -RunAsAdministrator
<#
  register-task.ps1 - creates the daily Windows Scheduled Task that runs
  backup.ps1. Run this ONCE, as Administrator, after backup.ps1 is configured
  and backup_token.txt has a real token in it.

  The task runs as SYSTEM, so it does not need a stored Windows password and
  will run whether or not anyone is logged in.
#>

$TaskName   = "alaa-eldin-daily-backup"
$ScriptPath = Join-Path $PSScriptRoot "backup.ps1"
$RunTime    = "03:15"

if (-not (Test-Path $ScriptPath)) {
    Write-Error "backup.ps1 not found next to this script at $ScriptPath"
    exit 1
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At $RunTime

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -DontStopOnIdleEnd

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force `
    -Description "Daily database backup download for alaa-eldin, over the app's own HTTPS backup endpoint." | Out-Null

Write-Host "Task '$TaskName' registered: runs daily at $RunTime, retries on a missed start, retries up to 3 times (10 min apart) on failure."
Write-Host ""
Write-Host "To check it:      Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "To run it by hand: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Then check:        D:\alaa-eldin-backups\backup.log"

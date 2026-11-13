# Installs the vigia home agent for the current user (no admin needed).
# Usage: powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Url https://vigia.example.com -Token XXX -PiLanIp 192.168.1.37
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$PiLanIp = '192.168.1.37'
)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:LOCALAPPDATA 'vigia'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'vigia-home.ps1') (Join-Path $dir 'vigia-home.ps1')
@{ url = $Url; token = $Token; piLanIp = $PiLanIp } | ConvertTo-Json | Set-Content -Encoding UTF8 -Path (Join-Path $dir 'config.json')

$script = Join-Path $dir 'vigia-home.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -Hidden -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'vigia-home' -Action $action -Trigger @($every5, $logon) -Settings $settings `
    -Description 'vigia home agent: reports whether this PC can reach the Raspberry Pi' -Force | Out-Null
Start-ScheduledTask -TaskName 'vigia-home'

Write-Host "vigia-home installed in $dir and scheduled every 5 minutes (also at logon)."
Write-Host 'To remove it: Unregister-ScheduledTask -TaskName vigia-home -Confirm:$false; Remove-Item -Recurse $env:LOCALAPPDATA\vigia'

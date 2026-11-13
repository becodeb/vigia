# vigia home agent (Windows PowerShell 5.1, no modules). Runs from Task Scheduler; nothing stays resident.
# Config: $env:ProgramData\vigia\home.json, or config.json next to this script:
#   { "url": "https://vigia.example.com", "token": "...", "piLanIp": "192.168.1.37" }
$ErrorActionPreference = 'Stop'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $cfgPath = Join-Path $env:ProgramData 'vigia\home.json'
    if (-not (Test-Path $cfgPath)) { $cfgPath = Join-Path $PSScriptRoot 'config.json' }
    $cfg = Get-Content -Raw -Path $cfgPath | ConvertFrom-Json

    function Test-Port([string]$ip, [int]$port) {
        $c = New-Object System.Net.Sockets.TcpClient
        try {
            $ar = $c.BeginConnect($ip, $port, $null, $null)
            return ($ar.AsyncWaitHandle.WaitOne(2000, $false) -and $c.Connected)
        } catch { return $false } finally { $c.Close() }
    }

    $ping = $false
    $p = New-Object System.Net.NetworkInformation.Ping
    try { $ping = ($p.Send($cfg.piLanIp, 1000).Status -eq 'Success') } catch { }

    $body = @{
        host       = $env:COMPUTERNAME
        os         = [Environment]::OSVersion.VersionString
        lanPiPing  = [bool]$ping
        lanPiSsh   = [bool](Test-Port $cfg.piLanIp 22)
        lanPiHttps = [bool](Test-Port $cfg.piLanIp 443)
        piLanIp    = $cfg.piLanIp
    } | ConvertTo-Json -Compress

    $url = ([string]$cfg.url).TrimEnd('/') + '/api/home/heartbeat'
    Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType 'application/json' `
        -Headers @{ Authorization = "Bearer $($cfg.token)" } -TimeoutSec 8 | Out-Null
} catch {
    # Silent on purpose: this runs unattended.
}
exit 0

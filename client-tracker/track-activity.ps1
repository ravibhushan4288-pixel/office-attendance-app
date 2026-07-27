# Windows PowerShell Screen Activity Tracker for In-House Attendance
# This script pings the local attendance server every 5 minutes when the laptop is active and unlocked.

# Set error action to silent for clean execution
$ErrorActionPreference = "SilentlyContinue"

# Path to the configuration file
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$configFile = Join-Path $scriptPath "config.txt"
$logFile = Join-Path $scriptPath "tracker-log.txt"

# Helper to log messages locally
function Write-Log($message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $message" | Out-File -FilePath $logFile -Append
}

# 1. Load Configuration
if (-not (Test-Path $configFile)) {
    # Default placeholder config if not exists
    "server_url=http://localhost:5000`r`nemployee_id=emp_1" | Out-File -FilePath $configFile -Encoding utf8
}

$config = @{}
Get-Content $configFile | Foreach-Object {
    if ($_ -match "^\s*([^=]+)\s*=\s*(.+)$") {
        $config[$Matches[1].Trim()] = $Matches[2].Trim()
    }
}

$serverUrl = $config["server_url"]
$employeeId = $config["employee_id"]

if (-not $serverUrl -or -not $employeeId) {
    Write-Log "Error: Missing server_url or employee_id in config.txt"
    exit
}

Write-Log "Tracker started. Target Server: $serverUrl | Employee ID: $employeeId"

# 2. Add Win32 API to check Idle Time (Last Input Info)
$signature = @'
[DllImport("user32.dll")]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
}
'@
Add-Type -MemberDefinition $signature -Name "Win32Input" -Namespace "Win32"

function Get-IdleTimeSeconds {
    $lii = New-Object Win32.Win32Input+LASTINPUTINFO
    $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
    if ([Win32.Win32Input]::GetLastInputInfo([ref]$lii)) {
        # Get uptime in ms
        $uptime = [Environment]::TickCount
        $idleMs = $uptime - $lii.dwTime
        return [Math]::Round($idleMs / 1000)
    }
    return 0
}

# 3. Main Loop
while ($true) {
    # Wait 5 minutes between checks (300 seconds)
    # (We wait at the start of the loop to allow the computer to boot up before the first ping)
    Start-Sleep -Seconds 300

    try {
        # Check A: Screen is locked if LogonUI.exe is running in the current user session
        $mySessionId = (Get-Process -Id $PID).SessionId
        $logonUI = Get-Process -Name LogonUI -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $mySessionId }
        $isLocked = $null -ne $logonUI

        # Check B: Check Idle Time (Inactive if no mouse/keyboard movement for > 10 minutes)
        $idleSeconds = Get-IdleTimeSeconds
        $isIdle = $idleSeconds -gt 600 # 10 minutes

        if ($isLocked) {
            Write-Log "Status: Screen Locked. Ping skipped."
            continue
        }

        if ($isIdle) {
            Write-Log "Status: Idle for $idleSeconds seconds. Ping skipped."
            continue
        }

        # Screen is awake, unlocked, and user is active -> Send Ping
        $url = "$serverUrl/api/screen-ping?employeeId=$employeeId"
        
        # Use Invoke-WebRequest to ping the server silently
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10
        
        if ($response.success) {
            Write-Log "Status: Active. Ping sent successfully. Daily active time: $($response.activeMinutes) mins."
        } else {
            Write-Log "Status: Active. Ping sent but server responded with warning: $($response.message)"
        }
    }
    catch {
        Write-Log "Status: Active. Ping failed (Server offline or network disconnected). Error: $($_.Exception.Message)"
    }
}

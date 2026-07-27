const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');

// Determine execution paths
const isPackaged = typeof process.pkg !== 'undefined';
const baseDir = isPackaged ? path.dirname(process.execPath) : __dirname;
const configPath = path.join(baseDir, 'client_config.json');
const logPath = path.join(baseDir, 'client_tracker_log.txt');

// Global configuration
let config = {
  serverUrl: '',
  employeeId: '',
  employeeName: '',
  employeeDesignation: '',
  autoPopup: 'true'
};

// Check CLI arguments
const isSilent = process.argv.includes('--silent');

// Readline interface for terminal input
let rl;
function initReadline() {
  if (rl) rl.close();
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

// Log messages locally to text file
function logLocal(message) {
  const timestamp = new Date().toLocaleString();
  const logMsg = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logPath, logMsg, 'utf-8');
  } catch (err) {
    // Fail silently on logging issues
  }
}

// Helper to ask terminal questions synchronously using Promises
function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Check if windows lock screen is active
function checkScreenLocked() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq LogonUI.exe"', (err, stdout) => {
      if (err) {
        resolve(false); // Default to unlocked if tasklist command fails
        return;
      }
      resolve(stdout.includes('LogonUI.exe'));
    });
  });
}

// Check mouse/keyboard idle time using Windows API via temporary PowerShell executor
function getIdleTime() {
  return new Promise((resolve) => {
    const tempPsFile = path.join(baseDir, 'temp_idle.ps1');
    const psCode = `
$signature = '[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii); public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }'
Add-Type -MemberDefinition $signature -Name "Win32Input" -Namespace "Win32" -ErrorAction SilentlyContinue
$lii = New-Object Win32.Win32Input+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
if ([Win32.Win32Input]::GetLastInputInfo([ref]$lii)) {
    $uptime = [Environment]::TickCount
    $idleMs = $uptime - $lii.dwTime
    Write-Output [Math]::Round($idleMs / 1000)
} else {
    Write-Output 0
}
`.trim();

    try {
      fs.writeFileSync(tempPsFile, psCode, 'utf-8');
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPsFile}"`, (err, stdout) => {
        try { fs.unlinkSync(tempPsFile); } catch (e) {} // cleanup
        if (err) {
          resolve(0);
          return;
        }
        const seconds = parseInt(stdout.trim(), 10);
        resolve(isNaN(seconds) ? 0 : seconds);
      });
    } catch (e) {
      try { fs.unlinkSync(tempPsFile); } catch (err) {}
      resolve(0);
    }
  });
}

// Perform background tracking ping
async function runActivityCheck() {
  try {
    const isLocked = await checkScreenLocked();
    if (isLocked) {
      logLocal("Status: Screen Locked. Ping skipped.");
      return;
    }

    const idleSeconds = await getIdleTime();
    if (idleSeconds > 600) { // 10 minutes
      logLocal(`Status: Idle for ${idleSeconds} seconds. Ping skipped.`);
      return;
    }

    // screen is awake, unlocked and active -> Ping server
    const url = `${config.serverUrl}/api/screen-ping?employeeId=${config.employeeId}`;
    const res = await fetch(url);
    if (!res.ok) {
      logLocal(`Status: Active but server returned error status ${res.status}.`);
      return;
    }

    const data = await res.json();
    if (data.success) {
      logLocal(`Status: Active. Ping sent. Daily active time: ${data.activeMinutes || 0} mins.`);
    } else {
      logLocal(`Status: Active. Ping sent but server responded: ${data.message || 'Warning'}`);
    }
  } catch (err) {
    logLocal(`Status: Active. Ping failed (Server offline or network down). Error: ${err.message}`);
  }
}

// Onboarding Configuration Screen
async function runOnboarding() {
  console.clear();
  console.log('====================================================');
  console.log('         ILUMINA ATTENDANCE CLIENT SETUP            ');
  console.log('====================================================');
  console.log('Welcome! Please configure connection to the Server.\n');

  initReadline();
  let serverIp = await askQuestion('Enter central Server URL or IP (e.g. http://192.168.1.100:5000): ');
  serverIp = serverIp.trim();
  if (!serverIp) {
    console.log('\n[!] Server URL cannot be empty.');
    await askQuestion('\nPress Enter to try again...');
    return runOnboarding();
  }

  // Ensure http:// or https:// prefix
  if (!/^https?:\/\//i.test(serverIp)) {
    serverIp = 'http://' + serverIp;
  }

  // Trim trailing slash
  if (serverIp.endsWith('/')) {
    serverIp = serverIp.slice(0, -1);
  }

  console.log('\nContacting server...');
  let employees = [];
  try {
    const res = await fetch(`${serverIp}/api/employees`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    employees = await res.json();
  } catch (err) {
    console.log(`\n[!] Failed to connect to server: ${err.message}`);
    console.log('Ensure the server is running and your IP is correct.');
    await askQuestion('\nPress Enter to try again...');
    return runOnboarding();
  }

  console.log('\nCentral Server found!');
  const empIdInput = await askQuestion('Enter your Employee ID (e.g. emp_1): ');
  const employeeId = empIdInput.trim();

  const foundEmp = employees.find(e => e.id === employeeId);
  if (!foundEmp) {
    console.log(`\n[!] Employee ID "${employeeId}" not found on the server registry.`);
    console.log('Verify your ID or request the administrator to register you.');
    await askQuestion('\nPress Enter to try again...');
    return runOnboarding();
  }

  // Save config
  config = {
    serverUrl: serverIp,
    employeeId: foundEmp.id,
    employeeName: foundEmp.name,
    employeeDesignation: foundEmp.designation,
    autoPopup: config.autoPopup || 'true'
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`\n[+] Setup successful! Welcome, ${config.employeeName}.`);
    logLocal(`Tracker configured successfully. Employee: ${config.employeeName}`);
    await askQuestion('\nPress Enter to launch Client Dashboard...');
  } catch (err) {
    console.log(`\n[!] Error writing client_config.json: ${err.message}`);
    await askQuestion('\nPress Enter to exit...');
    process.exit(1);
  }
}

// Helper to check if Windows Startup Auto-Start registry exists
function getStartupShortcutPath() {
  const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  return path.join(startupDir, 'AttendanceClient.lnk');
}

function checkStartupRegistered() {
  return fs.existsSync(getStartupShortcutPath());
}

// Toggle Windows Startup run via vbs and shortcut
function toggleStartupAutoRun() {
  const shortcutPath = getStartupShortcutPath();
  const vbsPath = path.join(baseDir, 'run-silently.vbs');
  const exePath = isPackaged ? process.execPath : 'node';
  const targetScript = isPackaged ? '' : ` "${path.join(baseDir, 'client.js')}"`;

  if (fs.existsSync(shortcutPath)) {
    // Deregister
    try {
      fs.unlinkSync(shortcutPath);
      if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
      console.log('\n[+] Auto-run removed from Windows Startup.');
      logLocal('Deregistered client from Windows Startup.');
    } catch (err) {
      console.log(`\n[!] Failed to remove startup entry: ${err.message}`);
    }
  } else {
    // Register
    try {
      // 1. Create silent runner script
      let runCmd;
      if (isPackaged) {
        runCmd = `CreateObject("Wscript.Shell").Run "cmd /c """ & WScript.Arguments(0) & """ --silent", 0, False`;
      } else {
        const fullNodeCmd = `node """ & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """ --silent`;
        runCmd = `CreateObject("Wscript.Shell").Run "cmd /c ${fullNodeCmd}", 0, False`;
      }
      fs.writeFileSync(vbsPath, runCmd, 'utf-8');

      // 2. Create shortcut in Windows Startup directory utilizing PowerShell
      const targetArgs = isPackaged 
        ? `'"${vbsPath}"' '"${exePath}"'` 
        : `'"${vbsPath}"' '"${exePath}"' '"${path.join(baseDir, 'client.js')}"'`;

      const psCommand = `$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('${shortcutPath}'); $Shortcut.TargetPath = 'wscript.exe'; $Shortcut.Arguments = '${targetArgs}'; $Shortcut.WorkingDirectory = '${baseDir}'; $Shortcut.Save()`;
      
      exec(`powershell -Command "${psCommand}"`, (err) => {
        if (err) {
          console.log(`\n[!] Failed to register startup shortcut: ${err.message}`);
        } else {
          console.log('\n[+] Registered to Windows Startup! The client will now run silently on boot.');
          logLocal('Registered client to Windows Startup.');
        }
      });
    } catch (err) {
      console.log(`\n[!] Setup failed: ${err.message}`);
    }
  }
}

// Fetch active status and screen minutes from central server
async function fetchCurrentStatus() {
  try {
    const res = await fetch(`${config.serverUrl}/api/employee-status?employeeId=${config.employeeId}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Fallback on error
  }
  return { status: 'Offline', clockIn: null, clockOut: null, activeMinutes: 0 };
}

// Client Dashboard loop
async function runDashboard() {
  console.clear();
  const liveStatus = await fetchCurrentStatus();
  
  console.log('====================================================');
  console.log('             ILUMINA ATTENDANCE CLIENT              ');
  console.log('====================================================');
  console.log(` Employee:   ${config.employeeName}`);
  console.log(` Designation: ${config.employeeDesignation}`);
  console.log(` Server URL:  ${config.serverUrl}`);
  console.log('----------------------------------------------------');
  
  let statusStr = liveStatus.status;
  if (liveStatus.clockIn && !liveStatus.clockOut) {
    statusStr = `Active (In: ${liveStatus.clockIn.slice(0, 5)})`;
  } else if (liveStatus.clockIn && liveStatus.clockOut) {
    statusStr = `Left (Out: ${liveStatus.clockOut.slice(0, 5)})`;
  }
  
  console.log(` Clock Status: ${statusStr}`);
  console.log(` Active Screen Today: ${liveStatus.activeMinutes || 0} minutes`);
  console.log(` Windows Auto-run:  ${checkStartupRegistered() ? 'ENABLED' : 'DISABLED'}`);
  console.log('----------------------------------------------------');
  console.log(' [1] Clock In');
  console.log(' [2] Clock Out');
  console.log(' [3] Open Web Portal');
  console.log(' [4] Toggle Windows Auto-run');
  console.log(' [5] Reset Server/Employee Settings');
  console.log(' [6] Refresh Status');
  console.log(' [7] Exit');
  console.log('====================================================');

  initReadline();
  const choice = await askQuestion('Choose option (1-7): ');
  
  switch (choice.trim()) {
    case '1': // Clock In
      await handleClockAction('in');
      break;
    case '2': // Clock Out
      await handleClockAction('out');
      break;
    case '3': // Open Web Portal
      console.log('\nOpening web browser...');
      const targetUrl = `${config.serverUrl}/`;
      exec(`start ${targetUrl}`); // opens default Windows browser
      await askQuestion('\nPress Enter to return...');
      break;
    case '4': // Toggle Auto-run
      toggleStartupAutoRun();
      await askQuestion('\nPress Enter to return...');
      break;
    case '5': // Reset config
      const confirmReset = await askQuestion('\nAre you sure you want to reset settings? (y/n): ');
      if (confirmReset.toLowerCase().trim() === 'y') {
        try {
          fs.unlinkSync(configPath);
          console.log('\nConfiguration deleted. Restarting...');
          config = { serverUrl: '', employeeId: '', employeeName: '', employeeDesignation: '', autoPopup: 'true' };
          await runOnboarding();
        } catch (e) {
          console.log('\n[!] Error clearing config.');
        }
      }
      break;
    case '6': // Refresh
      break;
    case '7': // Exit
      console.log('\nExiting application. Goodbye!');
      process.exit(0);
      break;
    default:
      console.log('\n[!] Invalid choice.');
      await askQuestion('\nPress Enter to try again...');
      break;
  }
  
  // Recurse menu loop
  setTimeout(runDashboard, 100);
}

// Clock in / clock out handler
async function handleClockAction(type) {
  const pin = await askQuestion('\nEnter your 4-digit PIN: ');
  if (!/^\d{4}$/.test(pin)) {
    console.log('\n[!] Error: PIN must be exactly 4 digits.');
    await askQuestion('\nPress Enter to return...');
    return;
  }

  const endpoint = type === 'in' ? 'clock-in' : 'clock-out';
  const url = `${config.serverUrl}/api/attendance/${endpoint}`;
  
  console.log('\nSending punch request...');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: config.employeeId, pin })
    });
    const data = await res.json();
    
    if (res.ok && data.success) {
      const timeStr = data.record.clockOut || data.record.clockIn;
      console.log(`\n[+] SUCCESS! Registered Clock-${type === 'in' ? 'In' : 'Out'} successfully at ${timeStr}`);
      logLocal(`Manual Clock-${type.toUpperCase()} successful via client CLI.`);
    } else {
      console.log(`\n[!] FAILED: ${data.message || 'Incorrect PIN or server error'}`);
    }
  } catch (err) {
    console.log(`\n[!] Network Error: ${err.message}`);
  }
  await askQuestion('\nPress Enter to return...');
}

// Main execution initialization
async function main() {
  logLocal("Client process started.");

  // Check configuration existence
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      logLocal("Error reading config. Initiating onboarding.");
    }
  }

  if (!config.serverUrl || !config.employeeId) {
    if (isSilent) {
      // In silent background mode, config is required.
      logLocal("Configuration missing. Exiting background tracker.");
      process.exit(1);
    }
    await runOnboarding();
  }

  // Start background tracking interval (runs every 5 minutes / 300 seconds)
  // Run first check immediately, then schedule it
  runActivityCheck();
  setInterval(runActivityCheck, 300 * 1000);

  if (isSilent) {
    logLocal("Running silently in background tracking loop...");
    // Keep process alive indefinitely
    setInterval(() => {}, 1000 * 60 * 60);
  } else {
    runDashboard();
  }
}

main().catch(err => {
  logLocal(`Fatal execution error: ${err.message}`);
  console.error("Fatal error: " + err.message);
  process.exit(1);
});

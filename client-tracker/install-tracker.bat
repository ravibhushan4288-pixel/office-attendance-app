@echo off
title In-House Attendance Tracker - Installer
echo ====================================================
echo    IN-HOUSE ATTENDANCE LAPTOP TRACKER INSTALLER
echo ====================================================
echo.
echo This installer sets up the background screen activity tracker
echo to run silently in the background whenever this laptop starts up.
echo.

:: 1. Ask for Server IP and Employee ID
set /p SERVER_IP="Enter the Attendance Server IP and Port (e.g. 192.168.1.100:5000): "
set /p EMPLOYEE_ID="Enter the Employee ID for this laptop (e.g. emp_1): "

if "%SERVER_IP%"=="" (
    echo Error: Server URL cannot be empty.
    pause
    exit /b
)
if "%EMPLOYEE_ID%"=="" (
    echo Error: Employee ID cannot be empty.
    pause
    exit /b
)

:: Ensure URL starts with http://
echo %SERVER_IP% | findstr /I "http://" >nul
if errorlevel 1 (
    set SERVER_URL=http://%SERVER_IP%
) else (
    set SERVER_URL=%SERVER_IP%
)

:: 2. Create the config.txt file
echo Writing configuration...
echo server_url=%SERVER_URL% > config.txt
echo employee_id=%EMPLOYEE_ID% >> config.txt
echo Config file created!

:: 3. Create run-silently.vbs in the current directory
echo Creating silent runner script...
echo CreateObject("Wscript.Shell").Run "powershell -NoProfile -WindowStyle Hidden -File """ ^& WScript.Arguments(0) ^& """", 0, False > run-silently.vbs

:: 4. Create a startup shortcut using PowerShell
echo Registering tracker to run at Windows startup...
set TARGET_DIR=%CD%
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_DIR%\AttendanceTracker.lnk'); $Shortcut.TargetPath = 'wscript.exe'; $Shortcut.Arguments = '\"%TARGET_DIR%\run-silently.vbs\" \"%TARGET_DIR%\track-activity.ps1\"'; $Shortcut.WorkingDirectory = '%TARGET_DIR%'; $Shortcut.Save()"

echo.
echo ====================================================
echo SUCCESS! The tracker is installed and registered.
echo It will now run automatically in the background 
echo whenever this laptop starts.
echo.
echo Launching the tracker for the first time now...
echo ====================================================

:: Launch it immediately in background
wscript.exe "%TARGET_DIR%\run-silently.vbs" "%TARGET_DIR%\track-activity.ps1"

echo.
echo Done! You can close this window.
pause

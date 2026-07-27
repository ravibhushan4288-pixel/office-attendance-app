@echo off
title In-House Attendance Server
cd /d "%~dp0"

echo ====================================================
echo         IN-HOUSE ATTENDANCE APP SERVER
echo ====================================================
echo Checking configuration and files...
echo.

:: Check if server dependencies are installed
if not exist "server\node_modules" (
    echo [!] Server dependencies missing. Installing...
    cd server
    call npm install
    cd ..
)

:: Check if frontend was compiled
if not exist "dist\index.html" (
    echo [!] Frontend is not built yet. Compiling frontend now...
    if not exist "node_modules" (
        echo [!] Root dependencies missing. Installing...
        call npm install
    )
    echo Building frontend...
    call npm run build
)

echo.
echo ====================================================
echo Starting Attendance Server...
echo ====================================================
echo.

cd server
node server.js

pause

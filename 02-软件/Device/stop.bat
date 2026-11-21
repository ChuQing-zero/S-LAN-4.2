@echo off
title S-LAN V1.3 [DEV] Device Console - Stop
echo Stopping TCG Camera Console (port 6001)...
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":6001" ^| findstr "LISTENING"') do (
    set FOUND=%%p
)
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   Stopped PID %FOUND% [OK]
) else (
    echo   Console not running, skip
)
pause
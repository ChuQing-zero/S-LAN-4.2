@echo off
title S-LAN V1.3 [TEST] - Stop All
setlocal
echo ================================
echo   S-LAN V1.3 [TEST] - Stop All
echo ================================
echo.

echo [1/4] Stopping backend (port 4002)...
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4002" ^| findstr "LISTENING"') do set FOUND=%%p
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   Backend stopped PID %FOUND% [OK]
) else (
    echo   Backend not running, skip
)

echo [2/4] Stopping client (port 6173)...
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":6173" ^| findstr "LISTENING"') do set FOUND=%%p
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   Client stopped PID %FOUND% [OK]
) else (
    echo   Client not running, skip
)

echo [3/4] Stopping device console (port 6001)...
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":6001" ^| findstr "LISTENING"') do set FOUND=%%p
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   Device console stopped PID %FOUND% [OK]
) else (
    echo   Device console not running, skip
)

echo [4/4] MongoDB (port 28018)...
choice /C YN /M "Also stop V1.3 MongoDB (28018) (Y/N)"
if errorlevel 2 goto done
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":28018" ^| findstr "LISTENING"') do set FOUND=%%p
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   MongoDB stopped PID %FOUND% [OK]
) else (
    echo   MongoDB not running, skip
)

:done
echo.
echo   Done. V1.2 services were NOT touched.
echo   Press any key to exit.
pause >nul

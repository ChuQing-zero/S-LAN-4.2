@echo off
title S-LAN V1.3 [DEV] - Stop All
setlocal
echo ================================
echo   S-LAN V1.3 [DEV] - Stop All
echo ================================
echo.

echo [1/3] Stopping backend and host (port 4002)...
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4002" ^| findstr "LISTENING"') do (
    set FOUND=%%p
)
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   Backend stopped PID %FOUND% [OK]
) else (
    echo   Backend not running, skip
)

echo [2/3] Stopping device console (port 6001)...
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":6001" ^| findstr "LISTENING"') do (
    set FOUND=%%p
)
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   Device console stopped PID %FOUND% [OK]
) else (
    echo   Device console not running, skip
)

echo [3/3] Stopping listing host (node processes of Host)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*Host*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
echo   Host stopped [OK]

echo.
choice /C YN /M "Also stop V1.3 DEV MongoDB (port 28018) (Y/N)"
if errorlevel 2 goto done
:: �� 28018 上的 V1.3 数据库，避免�� V1.1 正式版的 mongod
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":28018" ^| findstr "LISTENING"') do (
    set FOUND=%%p
)
if defined FOUND (
    taskkill /F /PID %FOUND% >nul 2>&1
    echo   V1.3 MongoDB stopped PID %FOUND% [OK]
) else (
    echo   V1.3 MongoDB not running, skip
)
:done
echo.
echo   Done. Press any key to exit.
pause >nul
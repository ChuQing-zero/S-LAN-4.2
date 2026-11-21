@echo off
title S-LAN V1.3 [DEV] Server Console
setlocal
set ROOT=%~dp0..

:: ---- locate mongod.exe ----
set MONGOD_EXE=
if exist "D:\App\mongodb\mongodb-win32-x86_64-windows-8.0.5\bin\mongod.exe" set MONGOD_EXE=D:\App\mongodb\mongodb-win32-x86_64-windows-8.0.5\bin\mongod.exe
if "%MONGOD_EXE%"=="" (
    where mongod >nul 2>&1
    if %errorlevel%==0 set MONGOD_EXE=mongod
)

echo ================================
echo   S-LAN V1.3 [DEV] - Start All
echo ================================
echo.

echo [1/3] Checking ports...
netstat -an | findstr ":4002.*LISTENING" >nul
if %errorlevel%==0 (
    echo   [WARN] Port 4002 is already in use!
    echo   Run Deploy\stop.bat first, or close the old server window.
    choice /C YN /M "Continue anyway (Y/N)"
    if errorlevel 2 goto end
)

netstat -an | findstr ":6001.*LISTENING" >nul
if %errorlevel%==0 (
    echo   [OK] Device console already running on :6001
) else (
    echo   Starting device console ... port 6001
    start "S-LAN Device Console" /min "%ROOT%\Device\start.bat"
)

netstat -an | findstr ":28018.*LISTENING" >nul
if %errorlevel%==0 goto mongo_ok

if not exist "%ROOT%\Storage\mongo\WiredTiger" (
    echo   [WARN] Storage\mongo is empty.
    echo   First run? Please run Deploy\migrate-mongo.bat to migrate old data.
    echo   Or start with empty database now.
    choice /C YN /M "Continue with empty database (Y/N)"
    if errorlevel 2 goto end
)

if "%MONGOD_EXE%"=="" (
    echo   [ERROR] mongod.exe not found. Install MongoDB or edit this file.
    pause
    exit /b 1
)

echo   Starting MongoDB...
start "S-LAN V1.3 MongoDB [DEV]" /min "%MONGOD_EXE%" --dbpath "%ROOT%\Storage\mongo" --port 28018

:: wait up to 15s for mongod to be ready
set WAIT_COUNT=0
:wait_mongo
ping -n 4 127.0.0.1 >nul
netstat -an | findstr ":28018.*LISTENING" >nul
if %errorlevel%==0 goto mongo_ok
set /a WAIT_COUNT+=1
if %WAIT_COUNT% LSS 5 goto wait_mongo

echo   [ERROR] MongoDB failed to start after 15 seconds.
echo   Check the "S-LAN MongoDB" window for error details.
pause
exit /b 1

:mongo_ok
echo   MongoDB running [OK]
echo.

echo [2/3] Starting backend server...
cd /d "%ROOT%\Server"
if not exist node_modules (
    echo   First run, installing dependencies...
    call npm install
)
echo   Server starting, logs below:
echo.
call npm start

:end
echo.
echo Exiting. Press any key.
pause >nul
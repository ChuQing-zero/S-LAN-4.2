@echo off
title S-LAN V1.3 [TEST] Start All
setlocal
set ROOT=%~dp0

set MONGOD_EXE=
if exist "D:\App\mongodb\mongodb-win32-x86_64-windows-8.0.5\bin\mongod.exe" set MONGOD_EXE=D:\App\mongodb\mongodb-win32-x86_64-windows-8.0.5\bin\mongod.exe
if "%MONGOD_EXE%"=="" (
    where mongod >nul 2>&1
    if %errorlevel%==0 set MONGOD_EXE=mongod
)

echo ================================
echo   S-LAN V1.3 [TEST] - Start All
echo ================================
echo   MongoDB  28018
echo   Device   6001
echo   Client   6173
echo   Server   4002
echo ================================
echo.

echo [1/4] Checking ports...
netstat -an | findstr ":4002.*LISTENING" >nul
if %errorlevel%==0 (
    echo   [WARN] Port 4002 already in use!
    echo   Run ֹͣV1.3.bat first.
    choice /C YN /M "Continue anyway (Y/N)"
    if errorlevel 2 goto end
)

echo [2/4] Device console ...
netstat -an | findstr ":6001.*LISTENING" >nul
if %errorlevel%==0 (
    echo   [OK] already running on 6001
) else (
    echo   starting device console ... port 6001
    start "S-LAN V1.3 Device" /min "%ROOT%\Device\start.bat"
)

echo [3/4] Client (frontend) ...
netstat -an | findstr ":6173.*LISTENING" >nul
if %errorlevel%==0 (
    echo   [OK] already running on 6173
) else (
    echo   starting client ... port 6173
    start "S-LAN V1.3 Client" /min "%ROOT%\Client\start-dev.bat"
)

echo [4/4] MongoDB ...
netstat -an | findstr ":28018.*LISTENING" >nul
if %errorlevel%==0 goto mongo_ok

if "%MONGOD_EXE%"=="" (
    echo   [ERROR] mongod.exe not found.
    pause
    exit /b 1
)
if not exist "%ROOT%\Storage\mongo" mkdir "%ROOT%\Storage\mongo"
if not exist "%ROOT%\Storage\logs" mkdir "%ROOT%\Storage\logs"

echo   starting MongoDB ... port 28018
start "S-LAN V1.3 MongoDB" /min "%MONGOD_EXE%" --dbpath "%ROOT%\Storage\mongo" --port 28018 --logpath "%ROOT%\Storage\logs\mongod.log" --logappend

set WAIT_COUNT=0
:wait_mongo
ping -n 4 127.0.0.1 >nul
netstat -an | findstr ":28018.*LISTENING" >nul
if %errorlevel%==0 goto mongo_ok
set /a WAIT_COUNT+=1
if %WAIT_COUNT% LSS 6 goto wait_mongo

echo   [ERROR] MongoDB failed to start after 20s.
echo   check the MongoDB window for details.
pause
exit /b 1

:mongo_ok
echo   MongoDB running [OK]
echo.

echo ================================================
echo   Frontend : http://localhost:6173
echo   Device   : http://127.0.0.1:6001
echo   API      : http://localhost:4002
echo ================================================
echo.
echo Starting backend server below ...
echo.
cd /d "%ROOT%\Server"
if not exist node_modules (
    echo First run, installing dependencies...
    call npm install
)
call npm start

:end
echo.
echo Exiting. Press any key.
pause >nul

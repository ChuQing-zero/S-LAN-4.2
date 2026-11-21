@echo off
title S-LAN - MongoDB Data Migration
setlocal
set ROOT=%~dp0..

echo ================================
echo   MongoDB Data Migration
echo   From: V1.0.1\S-LAN-Local\data\user-data
echo   To:   V1.1\Storage\mongo
echo ================================
echo.
echo   [WARN] This will stop the running MongoDB first!
choice /C YN /M "Confirm migration (Y/N)"
if errorlevel 2 (
    echo   Canceled
    pause
    exit /b
)

echo.
echo [1/3] Stopping MongoDB...
taskkill /F /IM mongod.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo   MongoDB stopped [OK]

echo [2/3] Copying data files...
robocopy "D:\Project\S-LAN\Code\V1.0.1\S-LAN-Local\data\user-data" "%ROOT%\Storage\mongo" /E /NFL /NDL /NP /R:1 /W:1
echo   Data copy done [OK]

echo [3/3] Verifying...
if exist "%ROOT%\Storage\mongo\WiredTiger" (
    echo   Migration success! Business data is in place.
) else (
    echo   [WARN] WiredTiger file not found, check Storage\mongo folder.
)
echo.
echo   Done. Now double-click Deploy\start.bat to start.
pause

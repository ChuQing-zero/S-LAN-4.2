@echo off
title S-LAN Device Console (port 6001)
cd /d "%~dp0"
echo ================================
echo   TCG Camera Console - Start
echo ================================
echo.
echo   Browser: http://localhost:6001
echo.
netstat -an | findstr ":6001.*LISTENING" >nul
if %errorlevel%==0 (
    echo   [WARN] Port 6001 already in use, console may be running.
    pause
    exit /b 1
)
python app.py
pause
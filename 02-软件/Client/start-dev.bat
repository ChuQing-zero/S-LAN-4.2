@echo off
title S-LAN V1.3 Client (6173)
cd /d "%~dp0"
echo ================================================
echo   S-LAN V1.3 Client  -  npm run dev  (6173)
echo ================================================
echo.
if not exist node_modules (
    echo First run, installing dependencies...
    call npm install
)
call npm run dev
echo.
echo client exited. press any key.
pause >nul

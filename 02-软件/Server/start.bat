@echo off
title S-LAN Server (backend)
cd /d "%~dp0"
if not exist node_modules (
    echo First run, installing dependencies...
    call npm install
)
echo Backend starting. Close this window = stop server.
echo.
call npm start
pause

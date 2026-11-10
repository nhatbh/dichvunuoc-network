@echo off
rem Double-click: read-only status of the SYSTEM 3D deployment on the dev cluster (VPN on).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\status.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

@echo off
rem Double-click: build and deploy the whole SYSTEM 3D platform to the dev k3s cluster.
rem Needs VPN, the tino32 access pack, Docker Desktop (logged in to the registry) and pnpm.
rem It asks each step (y/n) and any missing setting, saved in deploy\dev\deploy.env.
rem See deploy\dev\README.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\deploy.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

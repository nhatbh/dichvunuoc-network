@echo off
rem Double-click: build and deploy the whole SYSTEM 3D platform to the dev k3s cluster.
rem Needs VPN, the tino32 access pack, Docker Desktop (logged in to the registry) and pnpm.
rem First run creates deploy\dev\deploy.env to fill in. See deploy\dev\README.md.
rem Options are passed through: -Discover, -DryRun, -SkipBuild, -SkipInstall, -Seed, -Yes, -Tag TAG
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\deploy.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

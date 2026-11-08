@echo off
rem Double-click: SYSTEM 3D against the real backend on this machine (Docker Desktop must be running).
rem Starts the backend in Docker, seeds the demo network, starts the app on http://localhost:4610
rem and runs the Phase 0 gate check. Options: -Down (stop all), -Reset (fresh database), -NoBuild, -SkipSmoke
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\gis-3d\scripts\local-stack\local-stack.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

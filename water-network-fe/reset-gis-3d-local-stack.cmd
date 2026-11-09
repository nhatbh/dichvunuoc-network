@echo off
rem Double-click: wipe the local backend's data and start fresh (Docker Desktop must be running).
rem Drops the database volumes, rebuilds and restarts the backend, seeds the Vinh Thinh Dot 3
rem network, starts the app on http://localhost:4610 and runs the gate check.
rem Extra options are passed through: -NoBuild, -SkipSmoke
echo This deletes all local network data (databases, queues, topology) and reseeds it.
choice /c YN /m "Continue"
if errorlevel 2 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\gis-3d\scripts\local-stack\local-stack.ps1" -Reset %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

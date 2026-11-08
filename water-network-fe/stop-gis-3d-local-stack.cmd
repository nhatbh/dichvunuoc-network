@echo off
rem Double-click: stop SYSTEM 3D local stack (the app dev server on :4610 and the backend containers).
rem The database is kept; run-gis-3d-local-stack.cmd -Reset starts again from an empty one.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\gis-3d\scripts\local-stack\local-stack.ps1" -Down
echo.
pause

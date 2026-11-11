@echo off
rem Double-click: why does /api/gis answer 403? Paste the signed-in user's access token; checks the
rem token, the app-catalog gate and the BFF in turn (read-only; VPN on).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\check-access.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

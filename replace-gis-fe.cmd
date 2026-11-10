@echo off
rem Double-click: serve SYSTEM 3D in place of the current GIS frontend (gis-dev.dichvunuoc.vn) on the
rem dev cluster, with a backup for rollback (run again to roll back). VPN on; run deploy-system.cmd first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\replace-gis-fe.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

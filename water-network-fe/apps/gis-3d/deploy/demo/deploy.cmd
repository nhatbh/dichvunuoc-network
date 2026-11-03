@echo off
rem Double-click: build the 3D GIS demo and publish it to https://gis3d-dev.dichvunuoc.vn (VPN on).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
echo.
pause

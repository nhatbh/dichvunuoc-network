@echo off
rem Double-click: remove the 3D GIS demo from the cluster (the uploaded files are kept).
cd /d "%~dp0"
choice /C YN /M "Remove the 3D GIS demo (gis3d-dev.dichvunuoc.vn) from the cluster"
if errorlevel 2 goto :end
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0undeploy.ps1" %*
:end
echo.
pause

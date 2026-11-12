@echo off
rem Double-click: load the demo network (Vinh Thinh Dot 3) into the unit of one account on the
rem deployed SYSTEM 3D - CAD import, submit, approve and publish with that account's token.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\seed-demo.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

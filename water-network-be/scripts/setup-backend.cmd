@echo off
rem Backend setup: .NET 10 SDK, restore, build, tests, BFF OpenAPI, offline package feed.
rem Options: -Yes -SkipTests -SkipOpenApi -SkipFeed -StartStack   (see setup-backend.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-backend.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

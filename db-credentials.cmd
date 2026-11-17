@echo off
rem Double-click: find a PostgreSQL login that works for the deploy (after setup-longvan.cmd).
rem Tests the logins in deploy\dev\deploy.env, the database pod and its secrets, saves a working
rem one; if none works it can create a dedicated login. See deploy\dev\README.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\db-credentials.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

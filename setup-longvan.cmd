@echo off
rem Double-click once: install the longvan-dev access pack (ssh profile longvan-ubuntu) and check
rem the server for the deploy scripts; saves SSH_HOST and KUBECTL in deploy\dev\deploy.env.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\dev\setup-ssh.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%

@echo off
rem Double-click: rebuild and republish quickly, skipping "pnpm install" (use deploy.cmd after dependency changes).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -SkipInstall %*
echo.
pause

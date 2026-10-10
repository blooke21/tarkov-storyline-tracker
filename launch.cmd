@echo off
title Tarkov Storyline Tracker (close this window to stop)
cd /d "%~dp0"

if not exist "dist\app.js" (
  echo First run: building the tracker...
  call npm run build
  if errorlevel 1 goto failed
)

node dist\app.js
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo The tracker could not start. See the message above.
pause
exit /b 1

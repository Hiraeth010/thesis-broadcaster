@echo off
chcp 65001 >nul 2>nul
title thesis broadcaster
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js isn't installed.
  echo.
  echo   1. Go to  https://nodejs.org
  echo   2. Download the big green LTS button, install it
  echo   3. Close this window and double-click start.bat again
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   First run - installing. This takes a minute, only happens once.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

node src/server.js
echo.
echo   Stopped.
pause

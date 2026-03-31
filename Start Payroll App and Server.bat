@echo off
setlocal

REM Always run from this script's folder.
cd /d "%~dp0"

if not exist "package.json" (
  echo Could not find package.json in:
  echo %cd%
  echo Make sure this .bat file is inside the project folder.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not installed or not in PATH.
  echo Install Node.js from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies first...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Payroll API server...
start "Payroll API Server" cmd /k "cd /d \"%~dp0\" && npm run dev:server"

echo Starting Payroll web app...
start "Payroll Web App" cmd /k "cd /d \"%~dp0\" && npm run dev:client"

echo.
echo Started:
echo   API: http://localhost:3001
echo   App: http://localhost:5173
echo.
echo You can close this launcher window.
exit /b 0

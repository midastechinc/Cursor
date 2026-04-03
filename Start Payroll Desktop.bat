@echo off
setlocal

cd /d "%~dp0"

set "PACKAGED_APP=%~dp0release\win-unpacked\Midas Payroll.exe"
set "ELECTRON_CMD=%~dp0node_modules\.bin\electron.cmd"
set "WAIT_ON_CMD=%~dp0node_modules\.bin\wait-on.cmd"

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not installed or not in PATH.
  echo Install Node.js, then try again.
  pause
  exit /b 1
)

if exist "%ELECTRON_CMD%" if exist "%WAIT_ON_CMD%" (
  echo Starting Payroll API server...
  start "Payroll API Server" cmd /k "cd /d ""%~dp0"" && npm run dev:server"

  echo Starting Payroll web app...
  start "Payroll Web App" cmd /k "cd /d ""%~dp0"" && npm run dev:client"

  echo Waiting for desktop services to become ready...
  call "%WAIT_ON_CMD%" tcp:3001 tcp:5173
  if errorlevel 1 (
    echo The API server or web app did not start correctly.
    echo Check the "Payroll API Server" and "Payroll Web App" windows for errors.
    pause
    exit /b 1
  )

  echo Opening Electron desktop app...
  call "%ELECTRON_CMD%" .
  set "ELECTRON_EXIT=%errorlevel%"
  echo.
  echo Electron process exited with code %ELECTRON_EXIT%.
  if not "%ELECTRON_EXIT%"=="0" (
    echo If no app window opened, check the API/Web App windows for errors first.
  )
  pause
  exit /b %ELECTRON_EXIT%
)

if exist "%PACKAGED_APP%" (
  echo Opening packaged desktop app...
  start "" "%PACKAGED_APP%"
  exit /b 0
)

echo Desktop launch files were not found.
echo Run npm install in this folder, or build the packaged app first.
pause
exit /b 1

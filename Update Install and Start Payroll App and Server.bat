@echo off
setlocal EnableDelayedExpansion

REM Always run from this script's folder.
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or not in PATH.
  echo Install Git from https://git-scm.com/download/win and try again.
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

if not exist ".git" (
  echo This folder is not a Git repository:
  echo %cd%
  echo Move this .bat file into your project folder and try again.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo Could not find package.json in:
  echo %cd%
  echo Make sure this .bat file is inside the project folder.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH (
  echo Could not detect the current Git branch.
  pause
  exit /b 1
)

if /i "%CURRENT_BRANCH%"=="HEAD" (
  echo You are in a detached HEAD state.
  echo Checkout a branch first, then run this script again.
  pause
  exit /b 1
)

set "HAS_CHANGES=0"
set "STASH_CREATED=0"

git diff --cached --quiet --ignore-submodules --
if errorlevel 1 set "HAS_CHANGES=1"

git diff --quiet --ignore-submodules --
if errorlevel 1 set "HAS_CHANGES=1"

if "%HAS_CHANGES%"=="0" (
  for /f "delims=" %%U in ('git ls-files --others --exclude-standard') do (
    set "HAS_CHANGES=1"
    goto :checked_untracked
  )
)
:checked_untracked

if "%HAS_CHANGES%"=="1" (
  set "STASH_LABEL=auto-stash-before-update-%RANDOM%"
  echo Local changes detected. Creating stash "!STASH_LABEL!"...
  git stash push -u -m "!STASH_LABEL!"
  if errorlevel 1 (
    echo Could not stash local changes. Update cancelled.
    pause
    exit /b 1
  )
  set "STASH_CREATED=1"
)

echo Fetching latest changes for branch "%CURRENT_BRANCH%"...
git fetch origin "%CURRENT_BRANCH%"
if errorlevel 1 (
  echo Fetch failed. Check your internet connection and remote access.
  if "%STASH_CREATED%"=="1" (
    echo Attempting to restore your stashed changes...
    git stash pop
  )
  pause
  exit /b 1
)

echo Pulling latest changes into "%CURRENT_BRANCH%"...
git pull origin "%CURRENT_BRANCH%"
if errorlevel 1 (
  echo Pull failed. Resolve any merge issues and try again.
  if "%STASH_CREATED%"=="1" (
    echo Attempting to restore your stashed changes...
    git stash pop
  )
  pause
  exit /b 1
)

if "%STASH_CREATED%"=="1" (
  echo Re-applying your stashed local changes...
  git stash pop
  if errorlevel 1 (
    echo Stash re-apply reported conflicts.
    echo Resolve conflicts, then run this script again.
    pause
    exit /b 1
  )
)

echo Installing/updating npm dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed. Fix the errors and run again.
  pause
  exit /b 1
)

echo Starting Payroll API server...
start "Payroll API Server" cmd /k "cd /d ""%~dp0"" && npm run dev:server"

echo Starting Payroll web app...
start "Payroll Web App" cmd /k "cd /d ""%~dp0"" && npm run dev:client"

echo.
echo Update + install + launch complete.
if "%STASH_CREATED%"=="1" (
  echo Your local changes were stashed and restored automatically.
) else (
  echo No local changes were found.
)
echo Branch: %CURRENT_BRANCH%
echo API: http://localhost:3001
echo App: http://localhost:5173
echo.
echo You can close this launcher window.
exit /b 0

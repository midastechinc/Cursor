@echo off
setlocal

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

git diff --quiet --ignore-submodules --
if errorlevel 1 (
  echo You have uncommitted changes.
  echo Commit or stash changes before updating from GitHub.
  pause
  exit /b 1
)

git diff --cached --quiet --ignore-submodules --
if errorlevel 1 (
  echo You have staged changes.
  echo Commit or stash changes before updating from GitHub.
  pause
  exit /b 1
)

echo Fetching latest changes for branch "%CURRENT_BRANCH%"...
git fetch origin "%CURRENT_BRANCH%"
if errorlevel 1 (
  echo Fetch failed. Check your internet connection and remote access.
  pause
  exit /b 1
)

echo Pulling latest changes into "%CURRENT_BRANCH%"...
git pull origin "%CURRENT_BRANCH%"
if errorlevel 1 (
  echo Pull failed. Resolve any merge issues and try again.
  pause
  exit /b 1
)

echo Installing/updating npm dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed. Fix the errors and run again.
  pause
  exit /b 1
)

echo.
echo Update and dependency sync complete.
echo Branch: %CURRENT_BRANCH%
echo Folder: %cd%
echo.
pause
exit /b 0

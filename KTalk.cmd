@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Execute: node scripts/bootstrap-npm.mjs install
  echo Depois: node scripts/bootstrap-npm.mjs run setup:electron
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Execute primeiro: node scripts/setup-python.mjs
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Execute primeiro: node scripts/bootstrap-npm.mjs run build
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .

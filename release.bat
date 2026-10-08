@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1"
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" echo Release packaging failed. See errors above.
if /i not "%~1"=="--no-pause" pause
exit /b %RESULT%

@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-EggRWin11.ps1" -VerifyOnly
set "eggrExitCode=%ERRORLEVEL%"
echo.
pause
exit /b %eggrExitCode%

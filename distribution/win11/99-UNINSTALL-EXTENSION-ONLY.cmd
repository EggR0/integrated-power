@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-EggRWin11.ps1"
set "eggrExitCode=%ERRORLEVEL%"
echo.
if not "%eggrExitCode%"=="0" echo Uninstall failed. Review the message above.
pause
exit /b %eggrExitCode%

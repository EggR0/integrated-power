@echo off
title Integrated Power Control Center Launcher
cd /d "%~dp0"

echo [Integrated Power] Starting Control Center...

if exist "%~dp0..\integrated-power-control-center\src-tauri\target\release\integrated-power-control-center.exe" (
    start "" "%~dp0..\integrated-power-control-center\src-tauri\target\release\integrated-power-control-center.exe"
    echo [Integrated Power] Desktop application launched.
) else (
    echo [Integrated Power] Opening web interface...
    start "" "http://127.0.0.1:5173"
)

start "" "http://127.0.0.1:5173"

exit /b 0

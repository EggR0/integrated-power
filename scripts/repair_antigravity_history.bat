@echo off
chcp 65001 >nul
echo ========================================================
echo [Integrated Power] Antigravity IDE 대화 기록 완전 복구
echo ========================================================
echo.
echo 주의: Antigravity IDE가 완전히 종료된 상태에서 실행되어야
echo 메모리 캐시 덮어쓰기 없이 대화 목록이 100%% 안전하게 복구됩니다.
echo.
set SCRIPT_DIR=%~dp0
set PY_REPAIR=%SCRIPT_DIR%..\vscode-extension\assets\antigravity\repair_and_restart.py

python "%PY_REPAIR%" --workspace "%SCRIPT_DIR%.."
echo.
echo [완료] 복구 작업이 완료되었으며 Antigravity IDE를 다시 실행했습니다.
timeout /t 5
